/**
 * A pons launch on Robinhood Chain, start to finish, on the TrenchyTools API: the executor shared by local mode
 * (lib/launch.ts, keys in the backup folder, run by the server) and demo mode (lib/browser/engine.ts, keys in the
 * visitor's browser, run in the tab). The Launch page is the same file as the pump.fun starter's, so the form, the plan,
 * the record and the log have the same shapes; only the chain work below differs. Every amount is ETH (the form keeps
 * pump.fun's field names, `devBuySol` and `solEach`). Read top to bottom:
 *
 *   0. plan         what every wallet needs (fundingPlan): its buy + the 0.5 % API fee + a gas buffer; the dev adds the
 *                   pons launch fee and the create's gas.
 *   1. wallets      the main wallet is the creator unless the form names another; buyers are explicit lists
 *                   `{ publicKey, amount }[]` per group, "new wallet" rows are created (and backed up) first. Every
 *                   buyer (and volume wallet) goes on pons' exempt list (≤ 31) so the launch-window snipe tax skips it.
 *   2. funding      optional: ETH from the main wallet to every short wallet (plain transfers, nonce + 1 each, sent
 *                   back to back, confirmed together).
 *   3. create       POST /api/rh/trade-local { action: "create", tokenMetadata, amount, exemptWallets } → [create, fee]
 *                   + predicted.token; signed with the dev wallet's account data (GET /api/rh/account), POST /api/rh/send
 *                   in order, GET /api/rh/tx until the create succeeds. There is no Jito here: the chain has a
 *                   sequencer and no public mempool.
 *   4. bundle       the moment it does: every bundle wallet's buy (trade-local buy → sign → send), all at once, or one
 *                   by one with a random pause (skipping the rest once outside money passes the form's limit).
 *   5. after        auto-sell, auto-claim and the volume maker start; snipers buy `gapMs` apart; later buyers spread
 *                   over `windowS` after `delayS`.
 *
 * Every stage is emitted through `emit` (the launch log). No node imports.
 */
import { ApiError, type Expected, type Simulation, type TokenMetadata } from "../trenchy"
import { AppError } from "./errors"
import { sendAll, waitSuccess } from "./evm"
import { fundDirect } from "./funding"
import { sellAll } from "./sell-all"
import { notIn, type Env as BaseEnv } from "./env"
import { chain } from "../chain"
import { launchWalletLabel, type Role, type WalletInfo } from "./wallet-record"
import { padById, padCoinUrl, padFeatures, type Launchpad } from "../launchpad"

/** The API fee on every buy and sell (0.5 %), so a wallet funded for a buy can also pay it. */
const API_FEE = chain.apiFeeRate
const GAS_RESERVE = chain.gasBuffer
/** creating the coin: the pons launch fee + the create's gas, paid by the dev wallet (lib/chain.ts) */
const CREATE_COST = chain.createCost
/** pons exempts at most this many wallets from the launch-window snipe tax */
export const MAX_EXEMPT = 31
export const MAX_BUNDLE_WALLETS = chain.maxBundle
/** the smallest buy pons takes (and the volume maker's smallest trade) */
const MIN_BUY = chain.evm!.minBuy
/** pons coins have a fixed supply of 1 billion: market cap = price × 1e9 */
export const TOTAL_SUPPLY = chain.evm!.totalSupply
/** where the coin is seen on its launchpad (the first of lib/chain.ts coinLinks) */
const padLink = (token: string) => chain.coinLinks(token)[0]?.href ?? chain.explorerAddress(token)
const SYM = chain.symbol
/** the form's launchpad, and what it changes */
const padOf = (f: { launchpad?: string }): Launchpad => padById(f.launchpad)
const minBuyOf = (f: { launchpad?: string }) => padOf(f).minBuy ?? MIN_BUY
const exemptOf = (f: { launchpad?: string }) => padOf(f).exemptList ?? chain.evm!.exemptList
const quietOf = (f: { launchpad?: string }) => padOf(f).launchQuietS ?? chain.evm!.launchQuietS ?? 0
const PAD = chain.launchpad

/** One picked buyer: a wallet of the folder (or null = a new wallet, created at launch) and its buy, in ETH. */
export type Buyer = { publicKey: string | null; amount: number }
export type BuyerGroup = { count: number; solEach: number; wallets?: Buyer[] }
/** A buyer with its wallet record. */
export type Picked = WalletInfo & { amount: number }

export type LaunchForm = {
  name: string
  symbol: string
  description: string
  /** from POST /api/ipfs (kept on the record; the create itself takes `image`) */
  metadataUri: string
  /** the image link the create puts on chain: metadata.image from POST /api/ipfs */
  image: string
  twitter: string
  telegram: string
  website: string
  /** the launchpad (lib/chain.ts launchpads; the chain's first when absent) and its create-body fields (venue, taxes, fees) */
  launchpad?: string
  venueOptions?: Record<string, unknown>
  /** the creator: the main wallet when empty */
  devWallet?: string
  /** the plan only: the dev wallet will be a new wallet made at launch (the Launch page then sends it as devWallet) */
  devFresh?: boolean
  /** the dev buy, ETH (pump.fun's field name; the Launch page is shared) */
  devBuySol: number
  /** Each buyer group: an explicit list of wallets with their own amounts, or the old `count × solEach`. */
  bundle: BuyerGroup
  snipers: BuyerGroup & { gapMs: number }
  holders: BuyerGroup & { delayS: number; windowS: number }
  /** send ETH from the main wallet to every short wallet first (per the funding plan) */
  fundFirst: boolean
  slippage: number
  /** the bundle: a random pause between the buys, ms (0 / 0 = all at once) */
  bundleGap?: { fromMs: number; toMs: number }
  /** the bundle: skip the buys still to come once outside wallets have put in more than this, ETH (0 = never) */
  bundleMaxOutside?: number
  /** sell automatically after the launch (absent = never) */
  autoSell?: AutoSell
  /** claim the creator fees once: after every one of our wallets has sold the coin, or N minutes after the launch */
  claim?: AutoClaim
  /** the volume maker (absent = off) */
  volume?: Volume
}

/**
 * Volume maker: `count` wallets (made by the Launch page right before the launch, so their keys are saved first) get
 * `budget` ETH between them from the main wallet, then buy and sell small amounts at the chosen pace for `minutes`.
 * It stops when the time is up, when auto-sell fires, the moment the main wallet has sold everything, or when the
 * wallets run dry; then every volume wallet sells what it holds.
 */
export type Volume = { count: number; wallets: string[]; budget: number; pace: "light" | "normal" | "heavy"; minutes: number; size?: "calm" | "normal" | "wild" }
const VOLUME_PACE: Record<Volume["pace"], [number, number]> = { light: [8000, 15000], normal: [3000, 7000], heavy: [1000, 3000] }
/** How big each trade is (the same table as the pump.fun starter): a buy spends this share of the spendable ETH, a sell this % of the tokens. */
const VOLUME_SIZE: Record<NonNullable<Volume["size"]>, { buy: [number, number]; sell: [number, number]; sellP: number; runs: boolean }> = {
  calm: { buy: [0.1, 0.25], sell: [20, 50], sellP: 0.4, runs: false },
  normal: { buy: [0.15, 0.4], sell: [30, 100], sellP: 0.45, runs: false },
  wild: { buy: [0.4, 0.9], sell: [60, 100], sellP: 0.5, runs: true },
}
const between = ([lo, hi]: [number, number]) => lo + Math.random() * (hi - lo)

/** Auto-claim, once: "sold" = when none of our wallets holds the coin any more (after it held some); "after" = afterMin minutes after the launch. */
export type AutoClaim = { when: "sold" | "after"; afterMin: number }
/**
 * Auto-sell: once outside wallets (not ours) have put in `netIn` ETH more than they took out, or `afterMin` minutes after
 * the launch (whichever comes first; 0 turns that trigger off), every buyer wallet sells 100 %: all at once, or spread
 * over `spreadSec`. The main wallet sells with them, `mainLaterSec` later, on its own trigger, or keeps its coins.
 */
export type AutoSell = { netIn: number; afterMin: number; bundle: "all" | "spread"; spreadSec: number; main: "with" | "later" | "own" | "keep"; mainLaterSec: number; mainNetIn?: number; mainAfterMin?: number }
export const autoSellArmed = (a: AutoSell | undefined): boolean =>
  !!a && (a.netIn > 0 || a.afterMin > 0 || (a.main === "own" && ((a.mainNetIn ?? 0) > 0 || (a.mainAfterMin ?? 0) > 0)))

export type LaunchRecord = {
  id: string
  name: string
  symbol: string
  /** the coin (predicted by the API before the create, confirmed by it) */
  token: string | null
  status: "running" | "confirmed" | "error"
  createdAt: string
  wallets: { dev: string; bundle: string[]; sniper: string[]; holder: string[]; volume?: string[] }
  hashes: { create?: string; bundle: string[]; snipers: string[]; holders: string[] }
  /** the launchpad it was made on (lib/chain.ts launchpads id) */
  pad?: string
  metadataUri?: string
  error?: string
}

/** One line of the launch log: `hash` = a transaction, `token` = the coin, `link` = where to see it. */
export type LaunchEvent = { at: number; stage: string; message: string; hash?: string; token?: string; link?: string }
export type Env = BaseEnv<LaunchRecord>
export type Emit = (stage: string, message: string, extra?: Partial<LaunchEvent>) => void

// ── funding plan ────────────────────────────────────────────────────────────

export type PlanRow = {
  role: Role | "dev"; label: string; publicKey: string | null
  /** the buy, ETH */
  buy: number
  /** ETH the wallet needs: buy + 0.5 % fee + the gas buffer; the dev adds the launch fee and the create's gas (pump.fun's field name) */
  needSol: number
}
/** The same shape as the pump.fun starter's plan (the Launch page reads it); pairs, tips and tables do not exist here. */
export type Plan = {
  rows: PlanRow[]; total: number; tipSol: 0; useLut: false
  quote: { mint: string; symbol: string; decimals: number; kind: "native" }; custom: false
  mayhem: false; holderReward: false; creatorFeeBps: 0; totalQuote: 0; shortfalls: []; refusal: null; ok: boolean
  /** buyers past pons' exempt list (they pay the launch-window snipe tax) and other notes */
  warnings: string[]
}
const NATIVE_QUOTE: Plan["quote"] = { mint: chain.symbol, symbol: chain.symbol, decimals: 18, kind: "native" }

const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 1e9) / 1e9
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/** The explicit buyers of a group, or null when the form uses the old count × solEach shape. */
const explicit = (g: BuyerGroup): Buyer[] | null => (g.wallets && g.wallets.length ? g.wallets : null)
/** How many buyers a group has, whichever shape it uses. */
export const groupSize = (g: BuyerGroup): number => explicit(g)?.length ?? g.count
/** The creator: the form's dev wallet (must be in the store) or the main wallet. */
export function devWallet(env: Env, form: LaunchForm): WalletInfo | null {
  if (form.devWallet) return env.wallets.get(form.devWallet)
  return env.wallets.main()
}

/** What every wallet needs before the launch: buy + 0.5 % API fee + the gas buffer; the dev adds the create's cost. No API call. */
export async function fundingPlan(env: Env, form: LaunchForm): Promise<Plan> {
  const need = (buy: number) => buy * (1 + API_FEE) + GAS_RESERVE
  const dev = form.devFresh ? null : devWallet(env, form)
  const rows: PlanRow[] = [{ role: "dev", label: form.devFresh ? "new dev wallet (made at launch)" : dev?.label ?? (form.devWallet ? `${form.devWallet.slice(0, 8)}… (${notIn(env.wallets)})` : "Main wallet"), publicKey: form.devFresh ? null : dev?.publicKey ?? form.devWallet ?? null, buy: form.devBuySol, needSol: need(form.devBuySol) + padFeatures(padOf(form)).createCost }]
  const group = (role: Exclude<Role, "funding" | "trader">, g: BuyerGroup) => {
    const picked = explicit(g)
    if (picked) {
      picked.forEach((b, i) => {
        if (!b.publicKey) { rows.push({ role, label: `${role === "bundle" ? "buyer" : role === "holder" ? "later buyer" : role} ${i + 1} (new)`, publicKey: null, buy: b.amount, needSol: need(b.amount) }); return }
        const w = env.wallets.get(b.publicKey)
        rows.push({ role, label: w?.label ?? `${b.publicKey.slice(0, 8)}… (${notIn(env.wallets)})`, publicKey: w?.publicKey ?? b.publicKey, buy: b.amount, needSol: need(b.amount) })
      })
      return
    }
    const have = env.wallets.list(role)
    for (let i = 0; i < g.count; i++) rows.push({ role, label: have[i]?.label ?? `${role === "bundle" ? "buyer" : role === "holder" ? "later buyer" : role} ${i + 1} (new)`, publicKey: have[i]?.publicKey ?? null, buy: g.solEach, needSol: need(g.solEach) })
  }
  group("bundle", form.bundle)
  group("sniper", form.snipers)
  group("holder", form.holders)
  const v = form.volume
  if (v && v.count > 0) {
    for (let i = 0; i < v.count; i++) {
      const pk = v.wallets[i] ?? null
      rows.push({ role: "trader", label: (pk && env.wallets.get(pk)?.label) || `volume ${i + 1} (new)`, publicKey: pk, buy: 0, needSol: +(v.budget / v.count + GAS_RESERVE).toFixed(6) })
    }
  }
  const warnings: string[] = []
  const exemptable = rows.filter((r) => r.role !== "dev").length
  const PAD = padOf(form).name, minBuy = minBuyOf(form)
  if (padOf(form).disabled) warnings.push(`${PAD} cannot launch right now: ${padOf(form).disabled}`)
  if (exemptOf(form) && exemptable > MAX_EXEMPT) warnings.push(`${exemptable} buyer and volume wallets, but ${PAD} exempts at most ${MAX_EXEMPT} from the launch-window snipe tax: the last ${exemptable - MAX_EXEMPT} pay it.`)
  if (form.devBuySol > 0 && form.devBuySol < minBuy) warnings.push(`The dev buy must be at least ${minBuy} ${SYM} on ${PAD} (or 0).`)
  return { rows, total: sum(rows.map((r) => r.needSol)), tipSol: 0, useLut: false, quote: NATIVE_QUOTE, custom: false, mayhem: false, holderReward: false, creatorFeeBps: 0, totalQuote: 0, shortfalls: [], refusal: null, ok: !(form.devBuySol > 0 && form.devBuySol < minBuy) && !padOf(form).disabled, warnings }
}

/** One line per problem, for an error message or the launch log. */
export function planProblems(plan: Plan): string[] {
  return plan.ok ? [] : plan.warnings
}

/**
 * The buyers of a group with their amounts: the explicit list (every wallet must be in the store), or the first
 * `count` wallets of the role, creating (and backing up) the missing ones.
 */
function pick(env: Env, role: Exclude<Role, "funding" | "trader">, g: BuyerGroup, symbol?: string): Picked[] {
  const picked = explicit(g)
  if (picked) {
    const missing = picked.filter((b) => !b.publicKey).length
    const fresh = missing > 0 ? env.wallets.create(missing, role, launchWalletLabel(symbol, role)) : []
    return picked.map((b) => {
      const publicKey = b.publicKey ?? fresh.shift()!.publicKey
      env.wallets.assertBackedUp(publicKey) // unknown or not backed up: NotBackedUpError
      const w = env.wallets.get(publicKey)!
      return { ...w, amount: b.amount }
    })
  }
  const have = env.wallets.list(role).slice(0, g.count)
  const made = g.count > have.length ? env.wallets.create(g.count - have.length, role, launchWalletLabel(symbol, role)) : []
  const all = [...have, ...made].map((w) => ({ ...w, amount: g.solEach }))
  for (const w of all) env.wallets.assertBackedUp(w.publicKey)
  return all
}

/** "0.001 ETH each", or the range when the picked amounts differ. */
function amounts(ws: Picked[]): string {
  const xs = ws.map((w) => w.amount)
  const lo = Math.min(...xs), hi = Math.max(...xs)
  return lo === hi ? `${lo} ${SYM} each` : `${lo}–${hi} ${SYM}`
}

/** The form with every "new wallet" row (publicKey null) replaced by a wallet created now (stored first). */
export function materialize(env: Env, form: LaunchForm): LaunchForm {
  const fill = <G extends BuyerGroup>(g: G, role: Exclude<Role, "funding" | "trader">): G => {
    const picked = explicit(g)
    if (!picked || !picked.some((b) => !b.publicKey)) return g
    const fresh = env.wallets.create(picked.filter((b) => !b.publicKey).length, role, launchWalletLabel(form.symbol, role))
    return { ...g, wallets: picked.map((b) => ({ publicKey: b.publicKey ?? fresh.shift()!.publicKey, amount: b.amount })) }
  }
  return { ...form, bundle: fill(form.bundle, "bundle"), snipers: fill(form.snipers, "sniper"), holders: fill(form.holders, "holder") }
}

/**
 * Top up every short wallet in the plan from the main wallet: one plain transfer each (GET /api/rh/account once, nonce
 * + 1 per transfer, sent back to back), then all confirmed together. A dev wallet that is not the main wallet is topped
 * up too (its buy, the launch fee, gas).
 */
export async function fundPlan(env: Env, form: LaunchForm, note: (msg: string) => void = () => {}): Promise<Array<{ publicKey: string; role: string; sent: number; hash?: string; error?: string }>> {
  const funding = env.wallets.main()
  if (!funding) throw new AppError("No main wallet yet: create one at the top of the Launch or Wallets page", "no_funding_wallet", 400)
  form = materialize(env, form)
  const plan = await fundingPlan(env, form)
  const volume = (form.volume?.wallets ?? []).map((pk) => env.wallets.get(pk)).filter((w): w is WalletInfo => !!w)
  const dev = devWallet(env, form)
  const buyers: WalletInfo[] = [...(dev && !same(dev.publicKey, funding.publicKey) ? [dev] : []), ...pick(env, "bundle", form.bundle, form.symbol), ...pick(env, "sniper", form.snipers, form.symbol), ...pick(env, "holder", form.holders, form.symbol), ...volume].filter((w) => !same(w.publicKey, funding.publicKey))
  if (!buyers.length) return []
  for (const w of buyers) env.wallets.assertBackedUp(w.publicKey) // all or nothing
  const balances = new Map((await env.api.evm.walletBalances(buyers.map((b) => b.publicKey))).map((b) => [b.wallet.toLowerCase(), b.eth]))
  const targets: Array<{ w: WalletInfo; eth: number }> = []
  for (const w of buyers) {
    const need = plan.rows.find((r) => same(r.publicKey, w.publicKey))?.needSol ?? 0
    const topUp = Math.ceil((need - (balances.get(w.publicKey.toLowerCase()) ?? 0)) * 1e8) / 1e8
    if (topUp > 0.00001 && !targets.some((t) => same(t.w.publicKey, w.publicKey))) targets.push({ w, eth: topUp })
  }
  if (!targets.length) return buyers.map((w) => ({ publicKey: w.publicKey, role: w.role, sent: 0 }))
  const r = await fundDirect(env, targets.map((t) => ({ publicKey: t.w.publicKey, eth: t.eth })))
  return targets.map((t) => {
    const x = r.results.find((y) => same(y.publicKey, t.w.publicKey))
    const error = x?.error ?? (!x ? "not sent (an earlier transfer failed)" : x.confirmed === false ? "sent, not confirmed yet" : undefined)
    note(error ? `${t.w.label}: funding failed: ${error}` : `${t.w.label}: +${t.eth} ${SYM} (${x!.hash!.slice(0, 10)}…)`)
    return { publicKey: t.w.publicKey, role: t.w.role, sent: error ? 0 : t.eth, hash: x?.hash, error }
  })
}

// ── the launch ──────────────────────────────────────────────────────────────

export const metadataOf = (f: LaunchForm, image = f.image): TokenMetadata => ({ name: f.name, symbol: f.symbol, image, description: f.description || undefined, twitter: f.twitter || undefined, telegram: f.telegram || undefined, website: f.website || undefined })

/** Check the form and record a new launch (status running). The caller then runs it: `void runLaunch(env, rec, form, emit)`. */
export function prepareLaunch(env: Env, form: LaunchForm): LaunchRecord {
  const dev = devWallet(env, form)
  if (!dev) throw new Error(form.devWallet ? `Main wallet ${form.devWallet.slice(0, 10)}… is ${notIn(env.wallets, true)}` : "No main wallet yet: create one at the top of the Launch or Wallets page")
  if (!form.name || !form.symbol) throw new Error("Name and symbol are required")
  if (!form.image) throw new Error("Upload the image first (its link is missing)")
  const pad = padOf(form)
  if (pad.disabled) throw new Error(`${pad.name} cannot launch right now: ${pad.disabled}`)
  if (form.devBuySol > 0 && form.devBuySol < minBuyOf(form)) throw new Error(`The dev buy must be at least ${minBuyOf(form)} ${SYM} on ${pad.name} (or 0)`)
  if (groupSize(form.bundle) > MAX_BUNDLE_WALLETS) throw new Error(`At most ${MAX_BUNDLE_WALLETS} bundle buyers; add the rest as later buyers`)
  env.wallets.assertBackedUp(dev.publicKey)
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
  const rec: LaunchRecord = { id, name: form.name, symbol: form.symbol, token: null, status: "running", createdAt: new Date().toISOString(), wallets: { dev: dev.publicKey, bundle: [], sniper: [], holder: [] }, hashes: { bundle: [], snipers: [], holders: [] }, pad: padOf(form).id, metadataUri: form.metadataUri || undefined }
  env.launches.save(rec)
  return rec
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const errText = (e: unknown) => (e instanceof ApiError ? `${e.message}${e.code ? ` · ${e.code}` : ""}` : e instanceof Error ? e.message : String(e))

/** Run a prepared launch to the end. Never throws: a failure is recorded on the launch and emitted as stage "error". */
export async function runLaunch(env: Env, rec: LaunchRecord, form: LaunchForm, emit: Emit): Promise<void> {
  const api = env.api
  const saveLaunch = (r: LaunchRecord) => env.launches.save(r)
  const pad = padOf(form)
  const PAD = pad.name
  const padLink = (t: string) => padCoinUrl(pad, t)
  try {
    // 0. plan ("new wallet" rows are created first)
    form = materialize(env, form)
    const plan = await fundingPlan(env, form)
    if (!plan.ok) throw new Error(`Not launched: ${planProblems(plan).join("; ")}`)
    emit("plan", `${plan.total.toFixed(5)} ${SYM} across ${plan.rows.length} wallet(s), the ${PAD} launch fee and the 0.5 % API fee included`)
    for (const w of plan.warnings) emit("warning", w)

    // 1. wallets
    const bundle = pick(env, "bundle", form.bundle, form.symbol)
    const snipers = pick(env, "sniper", form.snipers, form.symbol)
    const holders = pick(env, "holder", form.holders, form.symbol)
    const volume = form.volume?.wallets ?? []
    rec.wallets = { dev: rec.wallets.dev, bundle: bundle.map((w) => w.publicKey), sniper: snipers.map((w) => w.publicKey), holder: holders.map((w) => w.publicKey), volume }
    // the exempt list: bundle first (they buy in the launch window), then snipers, volume, later buyers
    const exempt = !exemptOf(form) ? [] : [...new Set([...rec.wallets.bundle, ...rec.wallets.sniper, ...volume, ...rec.wallets.holder].filter((pk) => !same(pk, rec.wallets.dev)))].slice(0, MAX_EXEMPT)
    saveLaunch(rec)
    emit("wallets", `Creator ${rec.wallets.dev.slice(0, 10)}… · ${bundle.length} bundle · ${snipers.length} sniper · ${holders.length} later buyer${volume.length ? ` · ${volume.length} volume` : ""} wallet(s), all backed up${exemptOf(form) ? ` · ${exempt.length} on the snipe-tax exempt list` : ""}`)

    // 2. funding
    if (form.fundFirst) {
      emit("fund", "Funding the wallets from the main wallet…")
      const r = await fundPlan(env, form, (m) => emit("fund", m))
      const failed = r.filter((x) => x.error)
      if (failed.length) throw new Error(`${failed.length} wallet(s) could not be funded; nothing launched`)
      emit("fund", `Funding done (${r.filter((x) => x.sent > 0).length} transfer(s))`)
    }
    const devNeed = plan.rows[0].needSol
    const devAcct = await api.evm.account(rec.wallets.dev)
    if (Number(devAcct.balanceEth) < devNeed - GAS_RESERVE / 2) throw new AppError(`The dev wallet holds ${Number(devAcct.balanceEth).toFixed(5)} ${SYM}; the create needs about ${devNeed.toFixed(5)} ${SYM} (dev buy + launch fee + API fee + gas). Nothing was sent.`, "insufficient_funds", 409, `Send ${SYM} to the main wallet, then launch again`)

    // 3. the create: POST /api/rh/trade-local { action: "create" } → create + fee, predicted.token
    emit("build", `Building the create on ${PAD} + dev buy ${form.devBuySol} ${SYM} (POST ${chain.evm!.api}/trade-local)`)
    const built = await api.evm.tradeLocal({ wallet: rec.wallets.dev, action: "create", tokenMetadata: metadataOf(form), amount: form.devBuySol, ...(exempt.length ? { exemptWallets: exempt } : {}), slippage: form.slippage, ...(form.venueOptions ?? {}) })
    // most launchpads let the API predict the coin; the rest (Ascend, a Volta CREATE) are read from the receipt below
    let token = built.predicted?.token ?? ""
    if (token) { rec.token = token; saveLaunch(rec) }
    emit("mint", `${token ? `Coin will be ${token}` : "The coin's address comes from the create's receipt"} (${PAD} launch fee ${built.launchFeeEth ?? 0} ${SYM}${form.devBuySol > 0 ? `, the dev buy gets ~${Math.round(built.expected.tokens).toLocaleString()} tokens` : ""})`, { token })
    const hashes = await sendAll(api, env.wallets.accountOf(rec.wallets.dev), built.transactions, { confirm: false, acct: devAcct })
    const createHash = hashes[built.transactions.findIndex((t) => t.label === "create")] ?? hashes[0]
    rec.hashes.create = createHash
    saveLaunch(rec)
    if (!(await waitSuccess(api, createHash, 120_000, (m) => emit("confirm", m)))) throw new Error(`Create ${createHash.slice(0, 12)}… not confirmed in 2 minutes; check ${chain.explorerTx(createHash)} before launching again`)
    // the coin the create really made (GET <api>/created): fills an unpredicted address and corrects a stale one
    const made = await api.evm.created(createHash).catch(() => null)
    if (made?.token && made.token.toLowerCase() !== token.toLowerCase()) {
      if (token) emit("warning", `The coin landed at ${made.token}, not the predicted ${token}`)
      token = made.token
    }
    if (!token) throw new Error(`Create ${createHash.slice(0, 12)}… landed but its coin could not be read; find it on ${chain.explorerTx(createHash)}`)
    rec.token = token
    saveLaunch(rec)
    emit("confirm", `Create confirmed (${createHash.slice(0, 12)}…): ${token}`, { hash: createHash, token })

    // a launchpad that taxes the first seconds (Clanker: 99 % falling to the normal tax over 20 s) is left alone until then
    const quiet = quietOf(form)
    if (quiet > 0 && (bundle.length || snipers.length || holders.length || volume.length)) {
      emit("wait", `Waiting ${quiet} s before any other buy: ${PAD} charges a launch-window fee on buys in the first seconds`)
      await sleep(quiet * 1000)
    }

    // 4. the bundle, right after
    const ours = ourWallets(rec)
    if (bundle.length) rec.hashes.bundle = await bundleBuys(env, token, bundle, form, emit, ours)
    rec.status = "confirmed"
    saveLaunch(rec)
    emit("live", `Live on ${PAD}: ${padLink(token)}`, { token, hash: createHash, link: padLink(token) })

    // 5. after the launch: auto-sell watches the coin while the snipers and later buyers buy; auto-claim runs on its own
    const stop = { sold: false }
    const selling = form.autoSell && autoSellArmed(form.autoSell) ? autoSell(env, rec, form.autoSell, token, emit, stop) : null
    if (form.claim && padFeatures(pad).creatorFees) void autoClaim(env, rec, token, form.claim, emit)
    else if (form.claim) emit("claim", `Auto-claim skipped: ${pad.feeNote ?? `${PAD} pays no creator fees you can claim`}`)
    const volumeRun = volume.length ? volumeMaker(env, rec, form.volume!, token, emit, stop) : null

    if (snipers.length) {
      emit("snipers", `${snipers.length} sniper buy(s) of ${amounts(snipers)}, ${form.snipers.gapMs} ms apart`)
      for (const [i, w] of snipers.entries()) {
        if (i > 0 && form.snipers.gapMs > 0) await sleep(form.snipers.gapMs)
        const h = await oneBuy(env, token, w, w.amount, form.slippage, emit, "sniper")
        if (h) rec.hashes.snipers.push(h)
      }
      saveLaunch(rec)
    }
    if (holders.length) {
      emit("holders", `${holders.length} later buy(s) of ${amounts(holders)} after ${form.holders.delayS}s, spread over ${form.holders.windowS}s`)
      await sleep(form.holders.delayS * 1000)
      const times = holders.map(() => Math.random() * form.holders.windowS * 1000).sort((a, b) => a - b)
      const t0 = Date.now()
      for (const [i, w] of holders.entries()) {
        await sleep(Math.max(0, t0 + times[i] - Date.now()))
        if (stop.sold) { emit("holders", `Auto-sell has sold: the ${holders.length - i} later buy(s) still to come are skipped`); break }
        const h = await oneBuy(env, token, w, w.amount, form.slippage, emit, "holder")
        if (h) rec.hashes.holders.push(h)
      }
      saveLaunch(rec)
    }
    if (selling) await selling
    if (volumeRun) await volumeRun
    emit("done", "Launch complete", { token, link: padLink(token) })
  } catch (e) {
    rec.status = "error"
    rec.error = e instanceof ApiError ? `${e.message}${e.code ? ` · ${e.code}` : ""}${e.hint ? ` · ${e.hint}` : ""}` : e instanceof Error ? e.message : String(e)
    saveLaunch(rec)
    emit("error", rec.error)
  }
}

/** One buy: trade-local → sign → send (not waited for). Failures are logged, never fatal for the launch. */
async function oneBuy(env: Env, token: string, w: WalletInfo, amount: number, slippage: number, emit: Emit, stage: string): Promise<string | null> {
  try {
    const b = await env.api.evm.tradeLocal({ wallet: w.publicKey, action: "buy", token, amount, denominatedInEth: "true", slippage: Math.max(slippage, 20) })
    let hash = ""
    const hs = await sendAll(env.api, env.wallets.accountOf(w.publicKey), b.transactions, { confirm: false, onStep: (label, h) => { if (label === "buy") hash = h } })
    hash = hash || hs[0]
    emit(stage, `${w.label} bought ${amount} ${SYM} (${hash.slice(0, 12)}…)`, { hash })
    return hash
  } catch (e) {
    emit("warning", `${w.label} buy failed: ${errText(e)}`)
    return null
  }
}

/**
 * The bundle, right after the create: with no pause set, every buy is built at once and sent in the same instant; with
 * a pause, one after the other (skipping the rest once outside money passes `bundleMaxOutside`).
 */
async function bundleBuys(env: Env, token: string, wallets: Picked[], form: LaunchForm, emit: Emit, ours: Set<string>): Promise<string[]> {
  const lo = Math.max(0, form.bundleGap?.fromMs ?? 0), hi = Math.max(lo, form.bundleGap?.toMs ?? 0)
  if (hi === 0) {
    emit("bundle", `${wallets.length} bundle buy(s) of ${amounts(wallets)}, all at once`)
    const hs = await Promise.all(wallets.map((w) => oneBuy(env, token, w, w.amount, form.slippage, emit, "bundle")))
    return hs.filter((h): h is string => !!h)
  }
  emit("bundle", `${wallets.length} bundle buy(s) of ${amounts(wallets)}, one by one ${lo}–${hi} ms apart`)
  const out: string[] = []
  const max = form.bundleMaxOutside ?? 0
  for (const [i, w] of wallets.entries()) {
    if (i > 0) await sleep(lo + Math.random() * (hi - lo))
    if (max > 0) {
      const net = await outsideNetIn(env, token, ours).catch(() => 0)
      if (net > max) { emit("bundle", `Outside buyers already put in ${net.toFixed(4)} ${SYM} (limit ${max}): the ${wallets.length - i} bundle buy(s) still to come are skipped`); break }
    }
    const h = await oneBuy(env, token, w, w.amount, form.slippage, emit, "bundle")
    if (h) out.push(h)
  }
  return out
}

/** Our own wallets on a launch, lower case: their trades never count as outside money. */
const ourWallets = (rec: LaunchRecord) => new Set([rec.wallets.dev, ...rec.wallets.bundle, ...rec.wallets.sniper, ...rec.wallets.holder, ...(rec.wallets.volume ?? [])].map((x) => x.toLowerCase()))

/** ETH that wallets other than ours have put into the coin, minus what they took out (GET /api/rh/trades). */
async function outsideNetIn(env: Env, token: string, ours: Set<string>): Promise<number> {
  const h = await env.api.evm.tradeHistory(token, 200)
  let net = 0
  for (const t of h.trades) {
    const trader = String(t.trader ?? "").toLowerCase()
    if (!trader || ours.has(trader)) continue
    const eth = Number(t.ethAmount ?? 0)
    if (t.txType === "buy") net += eth
    else if (t.txType === "sell") net -= eth
  }
  return net
}

/** One wallet sells everything: trade-local sell 100 % → [approve] sell fee, sent back to back. */
async function sellEverything(env: Env, pk: string, token: string, emit: Emit, who: string): Promise<void> {
  try {
    const b = await env.api.evm.tradeLocal({ wallet: pk, action: "sell", token, amount: "100%", denominatedInEth: "false", slippage: Math.max(env.slippage, 25) })
    let hash = ""
    await sendAll(env.api, env.wallets.accountOf(pk), b.transactions, { confirm: false, pipeline: true, onStep: (label, h) => { if (label === "sell") hash = h } })
    emit("autosell", `${who} sold everything (${hash.slice(0, 12)}…)`, { hash })
  } catch (e) {
    emit("warning", `${who} sell failed: ${errText(e)}`)
  }
}

/** All at once, through the shared batch sell (lib/core/sell-all.ts): one slippage that covers the batch's own price
 *  impact, then a second round for any wallet still holding. Only confirmed sells are reported as sold. */
async function sellTogether(env: Env, list: Array<{ pk: string; who: string }>, token: string, emit: Emit): Promise<void> {
  const who = new Map(list.map((x) => [x.pk.toLowerCase(), x.who]))
  const results = await sellAll(env, list.map((x) => x.pk), token, 100)
  for (const r of results) {
    const name = who.get(r.publicKey.toLowerCase()) ?? r.publicKey.slice(0, 8)
    if ("hash" in r) emit("autosell", `${name} sold everything${r.retried ? " (second try)" : ""}${r.confirmed ? "" : ", not confirmed yet"} (${r.hash.slice(0, 12)}…)`, { hash: r.hash })
    else if ("error" in r && r.error) emit("warning", `${name} sell failed: ${r.error}`)
  }
}

/** Auto-sell (see AutoSell): check every 3 s; the buyers and the main wallet's own trigger share one outside-money reading per tick. */
async function autoSell(env: Env, rec: LaunchRecord, a: AutoSell, token: string, emit: Emit, stop: { sold: boolean }): Promise<void> {
  const ours = ourWallets(rec)
  const t0 = Date.now()
  let reading: { at: number; net: Promise<number | null> } | null = null
  const netNow = () => {
    if (!reading || Date.now() - reading.at > 2500) reading = { at: Date.now(), net: outsideNetIn(env, token, ours).catch(() => null) }
    return reading.net
  }
  const rule = (netIn: number, afterMin: number) => [netIn > 0 ? `outside buyers put in ${netIn} ${SYM}` : "", afterMin > 0 ? `${afterMin} min pass` : ""].filter(Boolean).join(" or ")
  const watch = async (netIn: number, afterMin: number, who: string): Promise<string> => {
    let lastNote = 0
    for (;;) {
      await sleep(3000)
      if (afterMin > 0 && Date.now() - t0 >= afterMin * 60_000) return `${afterMin} min passed`
      if (netIn > 0) {
        const net = await netNow()
        if (net !== null && net >= netIn) return `outside buyers put in ${net.toFixed(4)} ${SYM}`
        if (net !== null && Date.now() - lastNote > 30_000) { lastNote = Date.now(); emit("autosell", `Watching (${who}): outside buyers ${net >= 0 ? "+" : ""}${net.toFixed(4)} of ${netIn} ${SYM}`) }
      }
    }
  }
  const buyersArmed = a.netIn > 0 || a.afterMin > 0
  const mainNetIn = a.mainNetIn ?? 0
  const mainAfterMin = a.mainAfterMin ?? 0
  const mainOwn = a.main === "own" && (mainNetIn > 0 || mainAfterMin > 0)
  emit("autosell", `Auto-sell armed: ${[buyersArmed ? `buyer wallets sell when ${rule(a.netIn, a.afterMin)}` : "", mainOwn ? `the main wallet sells when ${rule(mainNetIn, mainAfterMin)}` : ""].filter(Boolean).join("; ")}`)
  const label = (pk: string) => env.wallets.get(pk)?.label ?? pk.slice(0, 10)

  const mainOwnRun = mainOwn
    ? watch(mainNetIn, mainAfterMin, "main wallet").then(async (why) => { emit("autosell", `Main wallet selling: ${why}`); await sellEverything(env, rec.wallets.dev, token, emit, "Main wallet") })
    : null

  if (buyersArmed) {
    const why = await watch(a.netIn, a.afterMin, "buyers")
    stop.sold = true
    const buyers = [...rec.wallets.bundle, ...rec.wallets.sniper, ...rec.wallets.holder]
    emit("autosell", `Selling: ${why}`)
    const together = a.bundle === "all" || buyers.length < 2
    const main = a.main === "with" && !together ? sellEverything(env, rec.wallets.dev, token, emit, "Main wallet") : null
    if (together) await sellTogether(env, [...(a.main === "with" ? [{ pk: rec.wallets.dev, who: "Main wallet" }] : []), ...buyers.map((pk) => ({ pk, who: label(pk) }))], token, emit)
    else {
      const gap = (Math.max(1, a.spreadSec) * 1000) / (buyers.length - 1)
      for (const [i, pk] of buyers.entries()) { if (i) await sleep(gap); await sellEverything(env, pk, token, emit, label(pk)) }
    }
    await main
    if (a.main === "later") { await sleep(Math.max(1, a.mainLaterSec) * 1000); await sellEverything(env, rec.wallets.dev, token, emit, "Main wallet") }
  }
  await mainOwnRun
  emit("autosell", a.main === "keep" ? "Auto-sell done; the main wallet keeps its coins" : "Auto-sell done")
}

/** The volume maker (see Volume): one trade at a time from a random volume wallet, until a stop condition, then they sell out. */
async function volumeMaker(env: Env, rec: LaunchRecord, v: Volume, token: string, emit: Emit, stop: { sold: boolean }): Promise<void> {
  const ws = v.wallets
  const [lo, hi] = VOLUME_PACE[v.pace] ?? VOLUME_PACE.normal
  const size = VOLUME_SIZE[v.size ?? "normal"] ?? VOLUME_SIZE.normal
  const end = Date.now() + Math.max(1, v.minutes) * 60_000
  emit("volume", `Volume maker on (${v.size ?? "normal"} trades): ${ws.length} wallets trade ${v.budget} ${SYM} between them for up to ${v.minutes} min. It stops early when the main wallet sells out or auto-sell fires.`)
  const run = { dir: "buy" as "buy" | "sell", left: 0 }
  let why = ""
  let trades = 0
  let mainHad = false
  let fails = 0
  while (!why) {
    await sleep(size.runs && Math.random() < 0.2 ? 300 + Math.random() * 500 : lo + Math.random() * (hi - lo))
    if (stop.sold) { why = "auto-sell fired"; break }
    if (Date.now() >= end) { why = `${v.minutes} min passed`; break }
    const rows = await env.api.evm.walletBalances([rec.wallets.dev, ...ws], token).catch(() => null)
    if (!rows) continue
    const by = new Map(rows.map((r) => [r.wallet.toLowerCase(), r]))
    const mainTokens = by.get(rec.wallets.dev.toLowerCase())?.tokens ?? 0
    if (mainTokens > 0) mainHad = true
    else if (mainHad) { why = "the main wallet sold out"; break }
    const spend = (pk: string) => (by.get(pk.toLowerCase())?.eth ?? 0) - GAS_RESERVE
    const held = (pk: string) => by.get(pk.toLowerCase())?.tokens ?? 0
    if (ws.every((pk) => spend(pk) < MIN_BUY && held(pk) === 0)) { why = `the volume wallets ran out of ${SYM}`; break }
    let pk = ws[Math.floor(Math.random() * ws.length)]
    let sellIt = held(pk) > 0 && (spend(pk) < MIN_BUY || Math.random() < size.sellP)
    if (size.runs) {
      if (run.left <= 0) { run.dir = run.dir === "buy" ? "sell" : "buy"; run.left = run.dir === "buy" ? 3 + Math.floor(Math.random() * 4) : 2 + Math.floor(Math.random() * 3) }
      const able = ws.filter((w) => (run.dir === "buy" ? spend(w) >= MIN_BUY : held(w) > 0))
      if (!able.length) { run.left = 0; continue }
      pk = able[Math.floor(Math.random() * able.length)]
      sellIt = run.dir === "sell"
      run.left--
    }
    if (!sellIt && spend(pk) < MIN_BUY) continue
    try {
      const b = sellIt
        ? await env.api.evm.tradeLocal({ wallet: pk, action: "sell", token, amount: `${Math.round(between(size.sell))}%`, denominatedInEth: "false", slippage: Math.max(env.slippage, 25) })
        : await env.api.evm.tradeLocal({ wallet: pk, action: "buy", token, amount: +Math.max(MIN_BUY, spend(pk) * between(size.buy) / (1 + API_FEE)).toFixed(6), denominatedInEth: "true", slippage: Math.max(env.slippage, 25) })
      await sendAll(env.api, env.wallets.accountOf(pk), b.transactions, { confirm: false, pipeline: true })
      trades++
      fails = 0
      if (trades % 10 === 0) emit("volume", `Volume maker: ${trades} trades so far`)
    } catch (e) {
      if (++fails >= 5) { why = `5 trades in a row failed (${errText(e)})`; break }
    }
  }
  emit("volume", `Volume maker stopped: ${why} (${trades} trades). The volume wallets now sell what they hold…`)
  const rows = await env.api.evm.walletBalances(ws, token).catch(() => [])
  await sellTogether(env, rows.filter((r) => r.tokens > 0).map((r) => ({ pk: r.wallet, who: `Volume wallet ${r.wallet.slice(0, 8)}…` })), token, emit)
  emit("volume", `Volume wallets sold out. Their ${SYM} stays in them: press Collect all on the Wallets page to bring it back to the main wallet.`)
}

/** Where a coin's creator fees live: its creator, its pad (from our launch record; the API detects it otherwise) and the
 *  create transaction (pools.trade pays through a position minted in it). `none` = the pad pays nothing to claim. */
export function claimTarget(env: Env, token: string): { creator: string | null; pad: Launchpad | null; at: { venue?: string; launchTx?: string }; none: string | null } {
  const rec = env.launches.list().find((l) => same(l.token ?? "", token))
  const pad = rec?.pad ? padById(rec.pad) : null
  const at = { ...(pad ? { venue: pad.body?.venue as string | undefined ?? pad.id } : {}), ...(pad?.id === "pools-trade" && rec?.hashes.create ? { launchTx: rec.hashes.create } : {}) }
  const none = pad && !padFeatures(pad).creatorFees ? pad.feeNote ?? `${pad.name} pays no creator fees you can claim` : null
  return { creator: rec?.wallets.dev ?? null, pad, at, none }
}

/** Auto-claim (see AutoClaim), once. A failed claim is tried twice more, a minute apart. */
async function autoClaim(env: Env, rec: LaunchRecord, token: string, c: AutoClaim, emit: Emit): Promise<void> {
  const creator = rec.wallets.dev
  if (c.when === "after") {
    emit("claim", `Auto-claim on: the creator fees are claimed ${c.afterMin} min after the launch`)
    await sleep(Math.max(1, c.afterMin) * 60_000)
  } else {
    emit("claim", "Auto-claim on: the creator fees are claimed once every one of your wallets has sold the coin")
    const ours = [...ourWallets(rec)]
    let held = false
    for (const end = Date.now() + 6 * 3600_000; ; ) {
      if (Date.now() > end) { emit("claim", "Auto-claim stopped: your wallets still hold the coin after 6 h. Claim on the Trading page when you are done."); return }
      await sleep(15_000)
      const rows = await env.api.evm.walletBalances(ours, token).catch(() => null)
      if (!rows) continue
      const any = rows.some((r) => r.tokens > 0)
      if (any) held = true
      else if (held) break
    }
    emit("claim", "Every wallet has sold: claiming the creator fees…")
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { at } = claimTarget(env, token)
      const fees = await env.api.evm.creatorFees(creator, token, at)
      const total = fees.eth   // the API's `eth` = what this claim pays now (pons: the escrow + the curve it sweeps)
      if (total <= 0) { emit("claim", "No creator fees to claim"); return }
      const b = await env.api.evm.tradeLocal({ wallet: creator, action: "collectCreatorFee", token, ...at })
      let hash = ""
      await sendAll(env.api, env.wallets.accountOf(creator), b.transactions, { confirm: true, onStep: (label, h) => { if (label === "claim" || (label === "collect" && !hash)) hash = h } })
      emit("claim", `Claimed about ${total.toFixed(5)} ${SYM} of creator fees into the creator wallet (${hash.slice(0, 12)}…)`, { hash })
      return
    } catch (e) {
      emit("warning", `Auto-claim try ${attempt}/3: ${errText(e)}`)
      if (attempt < 3) await sleep(60_000)
    }
  }
}

// ── simulate ────────────────────────────────────────────────────────────────

export type SimulateResult = { ok: boolean; checks: Array<{ name: string; ok: boolean; detail: string }>; plan: Plan; simulation: Simulation | null; expected: Expected | null; quote: Plan["quote"] }

/**
 * Dry run, nothing is sent: API reachable, the creator backed up and holding enough ETH for the plan, then the create +
 * dev buy is built (POST /api/rh/trade-local, the creator, the form's metadata) and run on a copy of the chain
 * (POST /api/rh/simulate). The API's answer is returned as is.
 */
export async function simulateLaunch(env: Env, form: LaunchForm): Promise<SimulateResult> {
  const api = env.api
  const checks: SimulateResult["checks"] = []
  const plan = await fundingPlan(env, form)
  const creator = devWallet(env, form)
  if (!creator) throw new Error(form.devWallet ? `Main wallet ${form.devWallet.slice(0, 10)}… is ${notIn(env.wallets, true)}` : "No main wallet yet: create one at the top of the Launch or Wallets page")
  env.wallets.assertBackedUp(creator.publicKey)
  checks.push({ name: "backup", ok: true, detail: `creator ${creator.publicKey.slice(0, 10)}… ${env.wallets.backupNote(creator)}` })
  const me = await api.me()
  checks.push({ name: "api", ok: true, detail: `connected to ${api.url} (key ${me.keyPrefix ?? "…"})` })
  const main = env.wallets.main()
  const acct = await api.evm.account((main ?? creator).publicKey)
  const balance = Number(acct.balanceEth)
  checks.push({ name: "balance", ok: balance >= plan.total, detail: `main wallet holds ${balance.toFixed(5)} ${SYM}, the plan needs ${plan.total.toFixed(5)} ${SYM}` })
  if (plan.warnings.length) checks.push({ name: "plan", ok: plan.ok, detail: plan.warnings.join(" ") })
  checks.push({ name: "metadata", ok: !!form.image, detail: form.image ? `image ${form.image}` : "no image yet: pick one (the dry run used a placeholder)" })
  if (groupSize(form.bundle) > MAX_BUNDLE_WALLETS) checks.push({ name: "bundle", ok: false, detail: `at most ${MAX_BUNDLE_WALLETS} bundle buyers` })
  const exempt = exemptOf(form) ? plan.rows.filter((r) => r.role !== "dev" && r.publicKey).map((r) => r.publicKey!).slice(0, MAX_EXEMPT) : []
  const built = await api.evm.tradeLocal({ wallet: creator.publicKey, action: "create", tokenMetadata: metadataOf({ ...form, name: form.name || "Simulation", symbol: form.symbol || "SIM" }, form.image || "https://trenchy.tools/og.png"), amount: form.devBuySol, ...(exempt.length ? { exemptWallets: exempt } : {}), slippage: form.slippage, ...(form.venueOptions ?? {}) })
  const simulation = await api.evm.simulate(built.transactions)
  const failed = simulation.steps.find((s) => !s.ok)
  checks.push({ name: "simulation", ok: simulation.ok, detail: simulation.ok ? `create + dev buy simulates fine (${simulation.steps.map((s) => s.label).join(", ")}${form.devBuySol > 0 ? `, ~${Math.round(built.expected.tokens).toLocaleString()} tokens for ${form.devBuySol} ${SYM}` : ""}; coin would be ${built.predicted?.token ?? "?"})` : `simulation failed at ${failed?.label ?? "a step"}: ${failed?.error ?? "reverted"}` })
  return { ok: checks.every((c) => c.ok), checks, plan, simulation, expected: built.expected, quote: plan.quote }
}
