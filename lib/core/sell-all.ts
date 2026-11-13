/**
 * Many wallets selling one coin in the same instant (the Trading page's Sell all, Close out, the launch's auto-sell).
 * Shared by local mode and demo mode. No node imports.
 */
import { sendAll, waitSuccess } from "./evm"
import type { Env } from "./launch"
import type { TradeResult } from "./trading"
import { same } from "./wallet-record"

/** builds this many wallets' sells per burst (the API allows 25 requests a second per key) */
const SELL_WAVE = 10
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type SellAllResult = Array<(TradeResult & { retried?: boolean }) | { publicKey: string; skipped?: string; error?: string; code?: string }>

/**
 * The slippage each sell needs when many wallets sell the same coin in the same block. Every sell is quoted as if it
 * were alone, but they land one after another, so the later ones get a worse price: the batch's own price impact (two
 * quotes: the whole batch and a sliver of it) is added on top of the usual allowance. Robinhood-style chains order by
 * arrival (no public mempool to sandwich from), so a wide limit here costs nothing but protects against reverts.
 */
async function batchSlippage(env: Env, token: string, tokens: number, wallet: string | undefined): Promise<number> {
  const base = Math.max(env.slippage, 25)
  if (!(tokens > 0)) return base
  try {
    const [all, sliver] = await Promise.all([
      env.api.evm.quote({ token, action: "sell", amount: tokens, wallet }),
      env.api.evm.quote({ token, action: "sell", amount: tokens / 1000, wallet }),
    ])
    if (!all.ethOut || !sliver.ethOut) return 50
    const impact = Math.max(0, 1 - all.ethOut / (sliver.ethOut * 1000))   // 0.3 = the batch gets 30 % less than at today's price
    return Math.min(90, Math.round(base + 200 * impact))                 // the last seller pays about twice the average impact
  } catch { return 50 }
}

/**
 * Sell `percent` from each wallet at the same instant: 1. build every sell and read every account first (in waves of
 * SELL_WAVE), with one slippage for the whole batch (batchSlippage), 2. send them all together ([approve] sell fee per
 * wallet, back to back), 3. confirm them together. At 100 %, every wallet that still holds afterwards (a sell that
 * reverted, tokens that arrived meanwhile) sells again right away, wider. Wallets holding none are skipped.
 */
export async function sellAll(env: Env, publicKeys: string[], token: string, percent: number): Promise<SellAllResult> {
  const first = await sellRound(env, publicKeys, token, percent, null)
  if (percent < 100) return first.out
  const tried = first.out.filter((r) => !("skipped" in r && r.skipped)).map((r) => r.publicKey)
  if (!tried.length) return first.out
  await sleep(1500)
  const rows = await env.api.evm.walletBalances(tried, token).catch(() => [])
  const left = rows.filter((r) => r.raw !== "0").map((r) => tried.find((pk) => same(pk, r.wallet)) ?? r.wallet)
  if (!left.length) return first.out
  const again = await sellRound(env, left, token, 100, Math.min(95, first.slippage + 30))
  for (const r of again.out) {
    const i = first.out.findIndex((x) => same(x.publicKey, r.publicKey))
    const ok = "hash" in r && !("error" in r && r.error)
    if (i >= 0 && (ok || !("hash" in first.out[i]))) first.out[i] = ok ? { ...(r as TradeResult), retried: true } : r
  }
  return first.out
}

async function sellRound(env: Env, publicKeys: string[], token: string, percent: number, slip: number | null): Promise<{ out: SellAllResult; slippage: number }> {
  const api = env.api
  const rows = await api.evm.walletBalances(publicKeys, token)
  const held = new Map(rows.map((r) => [r.wallet.toLowerCase(), r]))
  const pct = Math.max(1, Math.min(100, Math.round(percent)))
  const out: SellAllResult = new Array(publicKeys.length)
  const fail = (i: number, e: unknown) => { out[i] = { publicKey: publicKeys[i], error: e instanceof Error ? e.message : String(e), code: (e as { code?: string })?.code } }
  const waves = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, k) => xs.slice(k * n, k * n + n))

  const todo = publicKeys.map((pk, i) => ({ pk, i })).filter(({ pk, i }) => {
    if ((held.get(pk.toLowerCase())?.raw ?? "0") !== "0") return true
    out[i] = { publicKey: pk, skipped: "holds none" }
    return false
  })
  // one slippage for the whole batch: what all of it does to the price
  const selling = todo.map(({ pk }) => (held.get(pk.toLowerCase())?.tokens ?? 0) * (pct / 100))
  const top = todo[selling.indexOf(Math.max(0, ...selling))]?.pk
  const slippage = slip ?? (todo.length > 1 ? await batchSlippage(env, token, selling.reduce((a, b) => a + b, 0), top) : env.slippage)

  // 1. build every sell + read every account
  type Ready = { i: number; pk: string; built: Awaited<ReturnType<typeof api.evm.tradeLocal>>; acct: Awaited<ReturnType<typeof api.evm.account>> }
  const ready: Ready[] = []
  for (const wave of waves(todo, SELL_WAVE)) {
    await Promise.all(wave.map(async ({ pk, i }) => {
      try {
        env.wallets.accountOf(pk) // the key must be backed up: NotBackedUpError otherwise
        const [built, acct] = await Promise.all([
          api.evm.tradeLocal({ wallet: pk, action: "sell", token, amount: `${pct}%`, denominatedInEth: "false", slippage }),
          api.evm.account(pk),
        ])
        ready.push({ i, pk, built, acct })
      } catch (e) { fail(i, e) }
    }))
  }

  // 2. send them all in the same instant
  const sent: Array<Ready & { hash: string; hashes: string[] }> = []
  await Promise.all(ready.map(async (r) => {
    try {
      let hash = ""
      const hashes = await sendAll(api, env.wallets.accountOf(r.pk), r.built.transactions, { confirm: false, pipeline: true, acct: r.acct, onStep: (label, h) => { if (label === "sell") hash = h } })
      sent.push({ ...r, hash: hash || hashes[0], hashes })
    } catch (e) { fail(r.i, e) }
  }))

  // 3. confirm them together (the status checks are batched into one request per poll)
  await Promise.all(sent.map(async (r) => {
    let confirmed = false
    try { confirmed = await waitSuccess(api, r.hash, 30_000) } catch (e) { fail(r.i, e); return }
    out[r.i] = { publicKey: r.pk, hash: r.hash, hashes: r.hashes, action: "sell", expected: r.built.expected, confirmed }
  }))
  return { out, slippage }
}

