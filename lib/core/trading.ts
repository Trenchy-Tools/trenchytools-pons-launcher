/**
 * Trading after the launch, shared by local mode (lib/trading.ts) and demo mode (lib/browser/engine.ts). Every trade is
 * built by POST /api/rh/trade-local (the API follows the coin from the pons curve to its Uniswap v4 pool), signed with
 * the wallet's key, sent in order with POST /api/rh/send ([approve] trade fee) and confirmed with GET /api/rh/txs. Live
 * trades come from the API websocket wss://…/api/rh/data (subscribeTokenTrade): the message shapes are here, the socket
 * itself belongs to each mode. The answers have the pump.fun starter's shapes (the Trading page is the same file), with
 * EVM names where they differ (`hash`, `eth`). No node imports.
 */
import { chain } from "../chain"
import { sendAll, waitSuccess } from "./evm"
import type { Env } from "./launch"
import { TOTAL_SUPPLY, claimTarget } from "./launch"
import type { Expected, TokenInfo } from "../trenchy"
import { same, type WalletInfo } from "./wallet-record"
import { controlAutomation, viewAutomations, type Automation } from "../automations"

export type Holding = WalletInfo & { eth: number; tokens: number; raw: string }

/** Every wallet with its ETH and this coin's balance (GET /api/rh/balances?wallets=…&token=…, 100 per call). */
export async function holdings(env: Env, token: string): Promise<Holding[]> {
  const wallets = env.wallets.list()
  if (!wallets.length) return []
  const rows = await env.api.evm.walletBalances(wallets.map((w) => w.publicKey), token)
  const by = new Map(rows.map((r) => [r.wallet.toLowerCase(), r]))
  return wallets.map((w) => { const r = by.get(w.publicKey.toLowerCase()); return { ...w, eth: r?.eth ?? 0, tokens: r?.tokens ?? 0, raw: r?.raw ?? "0" } })
}

/**
 * GET /api/rh/token/:token: name, symbol, venue (pons curve or Uniswap v4), curve state. Priced in ETH (`quote`), and
 * `curve.marketCapSol` carries the market cap in ETH under the name the shared Trading page reads.
 */
export async function tokenInfo(env: Env, token: string): Promise<Omit<TokenInfo, "curve"> & { curveAddress: string; quote: { symbol: string }; custom: false; curve: { marketCapSol: number | null; marketCapQuote: number } | null }> {
  const t = await env.api.evm.token(token)
  const cs = t.curveState ?? {}
  const price = t.priceNative ?? (typeof cs.priceEth === "number" ? cs.priceEth : typeof cs.spotPriceEth === "number" ? cs.spotPriceEth : null)
  const supply = t.totalSupply || TOTAL_SUPPLY
  return { ...t, curveAddress: t.curve, quote: { symbol: chain.symbol }, custom: false, curve: price ? { marketCapSol: price * supply, marketCapQuote: price * supply } : null }
}

/** GET /api/wallets/balances: every wallet's ETH (`native`) and, with `token`, its balance of that coin. */
export async function balanceRows(env: Env, token?: string | null) {
  const wallets = env.wallets.list()
  if (!wallets.length) return { token: token ?? null, rows: [] as Array<{ publicKey: string; native: number; eth: number; tokens: number; raw: string }> }
  const rows = await env.api.evm.walletBalances(wallets.map((w) => w.publicKey), token)
  const by = new Map(rows.map((r) => [r.wallet.toLowerCase(), r]))
  return { token: token ?? null, rows: wallets.map((w) => { const r = by.get(w.publicKey.toLowerCase()); return { publicKey: w.publicKey, native: r?.eth ?? 0, eth: r?.eth ?? 0, tokens: r?.tokens ?? 0, raw: r?.raw ?? "0" } }) }
}

export type TradeResult = { publicKey: string; hash: string; hashes: string[]; action: "buy" | "sell"; expected: Expected; confirmed: boolean }

/** One wallet sells `percent` of its balance ("NN%" is resolved by the API from the real balance): [approve] sell fee, back to back. */
export async function sell(env: Env, publicKey: string, token: string, percent: number, slippage = env.slippage, confirmMs = 60_000): Promise<TradeResult> {
  const pct = Math.max(1, Math.min(100, Math.round(percent)))
  const account = env.wallets.accountOf(publicKey) // the key must be backed up: NotBackedUpError otherwise
  const built = await env.api.evm.tradeLocal({ wallet: publicKey, action: "sell", token, amount: `${pct}%`, denominatedInEth: "false", slippage })
  let hash = ""
  const hashes = await sendAll(env.api, account, built.transactions, { confirm: false, pipeline: true, onStep: (label, h) => { if (label === "sell") hash = h } })
  hash = hash || hashes[0]
  const confirmed = await waitSuccess(env.api, hash, confirmMs).catch(() => false)
  return { publicKey, hash, hashes, action: "sell", expected: built.expected, confirmed }
}

/** One wallet buys for `eth` ETH. */
export async function buy(env: Env, publicKey: string, token: string, eth: number, slippage = env.slippage): Promise<TradeResult> {
  env.wallets.assertBackedUp(publicKey)
  const account = env.wallets.accountOf(publicKey)
  const built = await env.api.evm.tradeLocal({ wallet: publicKey, action: "buy", token, amount: eth, denominatedInEth: "true", slippage })
  let hash = ""
  const hashes = await sendAll(env.api, account, built.transactions, { confirm: false, onStep: (label, h) => { if (label === "buy") hash = h } })
  hash = hash || hashes[0]
  const confirmed = await waitSuccess(env.api, hash, 60_000).catch(() => false)
  return { publicKey, hash, hashes, action: "buy", expected: built.expected, confirmed }
}

export { sellAll, type SellAllResult } from "./sell-all"

export type Pnl = {
  spent: number; received: number; net: number; trades: number; truncated: boolean
  /** this coin still held across the wallets */
  tokensHeld: number
  /** what selling everything still held would bring back right now, in ETH (a live quote minus the API fee and gas); null when nothing is held */
  exitNative: number | null
  /** wallets still holding the coin */
  holders: number
  wallets: Array<{ publicKey: string; label: string; spent: number; received: number; net: number; tokens: number }>
}

/**
 * The profit or loss of every wallet on this coin (GET /api/rh/pnl, 100 wallets per call): what they paid and got back
 * in ETH, gas and the API fee in it. For a coin launched here, only trades since the launch count; wallets of its
 * launches that were archived since are counted too. Wallets that never touched the coin are left out.
 */
export async function pnl(env: Env, token: string): Promise<Pnl> {
  const wallets = env.wallets.list()
  const launches = env.launches.list().filter((l) => same(l.token ?? "", token))
  const launch = launches[0]
  const since = launch ? Math.floor(new Date(launch.createdAt).getTime() / 1000) - 60 : undefined
  const roleOf = new Map<string, string>()
  for (const l of launches) {
    const w = l.wallets
    const add = (pk: string | undefined, role: string) => { if (pk && !roleOf.has(pk.toLowerCase())) roleOf.set(pk.toLowerCase(), role) }
    add(w.dev, "dev (archived)"); w.bundle.forEach((pk, i) => add(pk, `bundle ${i + 1} (archived)`)); w.sniper.forEach((pk, i) => add(pk, `sniper ${i + 1} (archived)`))
    w.holder.forEach((pk, i) => add(pk, `later buyer ${i + 1} (archived)`)); (w.volume ?? []).forEach((pk, i) => add(pk, `volume ${i + 1} (archived)`))
  }
  const spelled = new Map<string, string>()
  for (const w of wallets) spelled.set(w.publicKey.toLowerCase(), w.publicKey)
  for (const l of launches) for (const pk of [l.wallets.dev, ...l.wallets.bundle, ...l.wallets.sniper, ...l.wallets.holder, ...(l.wallets.volume ?? [])]) if (!spelled.has(pk.toLowerCase())) spelled.set(pk.toLowerCase(), pk)
  const keys = [...spelled.values()]
  if (!keys.length) return { spent: 0, received: 0, net: 0, trades: 0, truncated: false, tokensHeld: 0, exitNative: null, holders: 0, wallets: [] }
  const parts = []
  for (let i = 0; i < keys.length; i += 100) parts.push(await env.api.evm.pnl(token, keys.slice(i, i + 100), since))
  const held = new Map((await env.api.evm.walletBalances(keys, token)).map((r) => [r.wallet.toLowerCase(), r.tokens]))
  const label = new Map<string, string>([...roleOf.entries(), ...wallets.map((w) => [w.publicKey.toLowerCase(), w.label] as [string, string])])
  const rows = parts.flatMap((p) => p.wallets).map((w) => ({ publicKey: w.wallet, label: label.get(w.wallet.toLowerCase()) ?? w.wallet.slice(0, 8), spent: w.spent, received: w.received, net: w.net, tokens: held.get(w.wallet.toLowerCase()) ?? 0 }))
  const used = rows.filter((r) => r.spent || r.received || r.tokens)
  const sum = (k: "spent" | "received" | "net") => +used.reduce((s, r) => s + r[k], 0).toFixed(9)
  const tokensHeld = used.reduce((s, r) => s + r.tokens, 0)
  const holders = used.filter((r) => r.tokens > 0).length
  let exitNative: number | null = null
  if (tokensHeld > 0) {
    // one quote for everything held, as the biggest holder (an exact sell quote needs a wallet that holds the tokens)
    const top = used.filter((r) => r.tokens > 0).sort((a, b) => b.tokens - a.tokens)[0]
    const q = await env.api.evm.quote({ token, action: "sell", amount: tokensHeld, wallet: top?.publicKey }).catch(() => null)
    if (typeof q?.ethOut === "number") exitNative = +Math.max(0, q.ethOut * (1 - chain.apiFeeRate) - holders * chain.minGas * 0.3).toFixed(9)
  }
  return { exitNative, holders, spent: sum("spent"), received: sum("received"), net: sum("net"), trades: parts.reduce((s, p) => s + p.trades, 0), truncated: parts.some((p) => p.truncated), tokensHeld, wallets: used }
}

/** The creator of a coin we launched (from the launch records), else the main wallet. */
export function creatorOf(env: Env, token: string): string | null {
  return env.launches.list().find((l) => same(l.token ?? "", token))?.wallets.dev ?? env.wallets.main()?.publicKey ?? null
}

// ── creator fees: the pons escrow (GET /api/rh/creator-fees, trade-local collectCreatorFee) ────────────────────────

/** The coin's creator and what it can claim: the escrow now + what the coin's curve still holds. `sol` carries the ETH under the name the shared Trading page reads. */
export async function creatorFees(env: Env, token: string) {
  const t = claimTarget(env, token)
  const creator = t.creator ?? creatorOf(env, token) ?? (await env.api.evm.token(token)).creator
  if (t.none) return { creator, sol: 0, eth: 0, claimableEth: 0, pendingEth: 0, sweepable: false, reason: undefined, none: t.none }
  const f = await env.api.evm.creatorFees(creator, token, t.at)
  const total = +f.eth.toFixed(9)   // what one claim pays now (the API's `eth` already includes the curve it sweeps)
  return { creator, sol: total, eth: total, claimableEth: f.claimableEth, pendingEth: f.curve?.pendingEth ?? 0, sweepable: f.curve?.sweepable ?? false, reason: f.curve?.reason }
}

/** Claim them: trade-local { action: "collectCreatorFee", token } → [sweep] claim, signed and sent in order by the creator. */
export async function collectCreatorFees(env: Env, token: string): Promise<{ creator: string; signature: string; hash: string; hashes: string[]; confirmed: boolean }> {
  const t = claimTarget(env, token)
  if (t.none) throw new Error(t.none)
  const creator = t.creator ?? creatorOf(env, token) ?? (await env.api.evm.token(token)).creator
  const account = env.wallets.accountOf(creator) // the creator's key must be stored and backed up here
  const built = await env.api.evm.tradeLocal({ wallet: creator, action: "collectCreatorFee", token, ...t.at })
  let claim = ""
  const hashes = await sendAll(env.api, account, built.transactions, { confirm: true, onStep: (label, h) => { if (label === "claim" || (label === "collect" && !claim)) claim = h } })
  const hash = claim || hashes[hashes.length - 1]
  return { creator, signature: hash, hash, hashes, confirmed: true }
}

// ── what the coin's launches keep running (lib/automations.ts) ───────────────

/** Auto-sell, the volume maker, the later buyers, auto-claim of this coin's launches: where each stands (the Trading page's panel). */
export const automations = (env: Env, token: string): Automation[] =>
  viewAutomations(token, env.launches.list().filter((l) => same(l.token ?? "", token)).map((l) => ({ id: l.id, automations: l.automations })))
/** Pause, resume or stop one of them. Null when nothing runs it any more (the page that launched was reloaded). */
export const controlAutomations = (id: string, action: "pause" | "resume" | "stop"): Automation | null => controlAutomation(id, action)

// ── live trades: wss://…/api/rh/data, subscribeTokenTrade per coin ──────────

export type LiveTrade = { hash: string; token: string; type: "buy" | "sell"; trader: string; eth: number; tokens: number; priceEth: number | null; marketCapEth: number | null; timestamp: number; ours: string | null; venue: string | null }

/** The subscribe message for one coin on wss://…/api/rh/data. */
export const tradeSubscription = (token: string, on = true) => JSON.stringify({ method: on ? "subscribeTokenTrade" : "unsubscribeTokenTrade", keys: [token] })

/** One websocket message → a trade of `token`, or null (another coin, not a trade, not JSON). `ours` labels our own wallets. */
export function parseTrade(data: string, token: string, ours: (trader: string) => WalletInfo | undefined): LiveTrade | null {
  try {
    const raw = JSON.parse(data) as Record<string, unknown>
    if ((raw.txType !== "buy" && raw.txType !== "sell") || String(raw.token ?? "").toLowerCase() !== token.toLowerCase()) return null
    const hash = String(raw.hash ?? "")
    if (!hash) return null
    const trader = String(raw.trader ?? "")
    const w = ours(trader)
    const eth = Number(raw.ethAmount ?? 0), tokens = Number(raw.tokenAmount ?? 0)
    const priceEth = typeof raw.priceEth === "number" ? raw.priceEth : tokens > 0 ? eth / tokens : null
    return {
      hash, token, type: raw.txType, trader, eth, tokens, priceEth, marketCapEth: priceEth ? priceEth * TOTAL_SUPPLY : null,
      timestamp: typeof raw.ts === "number" ? raw.ts : Date.now(), ours: w ? `${w.label} · ${w.role}` : null, venue: typeof raw.venue === "string" ? raw.venue : null,
    }
  } catch {
    return null // not a trade
  }
}
