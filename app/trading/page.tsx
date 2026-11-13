"use client"

/**
 * Trading, the simple way: pick a coin (my launches | paste), then
 *
 *   BUY ALL   [amount] each  [Buy N wallets]          ☐ stagger
 *   SELL ALL  [25%] [50%] [100%]                      ☑ include the dev wallet
 *   LATER     sell [50]% of everything in [5] min [Set]
 *   one row per wallet: balance · tokens · [amount][Buy] · [25][50][100]%
 *
 * Nothing needs selecting: the big buttons act on every wallet, the row buttons on that wallet. Live trades on the
 * right; creator fees as one small row. This file is the same in the pump.fun and pons starters; lib/chain.ts holds
 * what differs.
 */
import * as React from "react"
import { Check, RefreshCw } from "lucide-react"
import { Chart } from "@/components/chart"
import { FailureBox } from "@/components/failure"
import { Button } from "@/components/ui/button"
import { BrandIcon } from "@/components/ui/brand"
import { BottomDock, useMediaQuery } from "@/components/ui/bottom-dock"
import { Dialog } from "@/components/ui/dialog"
import { Checkbox, Input, Select } from "@/components/ui/input"
import { Pill } from "@/components/ui/pill"
import { Mono } from "@/components/ui/table"
import { dismissToast, toast, toastFailure, type ToastAction } from "@/components/ui/toast"
import { del, failureOf, get, post, readChosenCoin, subscribe, walletsChanged, writeChosenCoin, type Failure } from "@/lib/api"
import { chain } from "@/lib/chain"
import { cn } from "@/lib/cn"
import { DEMO, TAB_NOTE } from "@/lib/browser/demo"
import { Q } from "@/lib/help"
import { Nudge } from "@/components/ui/motion"

type Pnl = { spent: number; received: number; net: number; trades: number; truncated: boolean; tokensHeld: number; exitNative?: number | null; holders?: number; wallets: Array<{ publicKey: string; label: string; spent: number; received: number; net: number; tokens: number }> }
type Launch = { id: string; name: string; symbol: string; mint?: string | null; token?: string | null; status: string; createdAt: string; wallets?: { dev?: string; bundle?: string[]; sniper?: string[]; holder?: string[]; volume?: string[] } }
type Wallet = { publicKey: string; label: string; role: string }
type Row = { publicKey: string; native: number; tokens?: number }
/** GET /api/trading/token, either starter: name / symbol / venue, plus pump.fun's quote + Mayhem flags or pons's curve state. */
type Token = { name?: string | null; symbol?: string | null; venue?: string; quote?: { symbol: string }; custom?: boolean; mayhem?: { enabled: boolean }; holderReward?: boolean; creatorFeeBps?: number; graduated?: boolean; curveState?: Record<string, number> | null; curve?: { marketCapSol: number | null; marketCapQuote: number } | null }
type Trade = { signature?: string; hash?: string; type: "buy" | "sell"; trader: string; sol?: number; eth?: number; tokens: number; timestamp: number; ours: string | null; marketCapSol?: number | null; marketCapEth?: number | null }
type Timer = { id: string; publicKeys: string[]; percent: number; dueAt: number; status: string; error?: string; result?: Array<{ publicKey: string; signature?: string; hash?: string; error?: string; skipped?: string }> }
/** A trade's answer, either starter: `signature` (Solana) or `hash` (EVM); `expected.quoteAmount` or `expected.eth`. */
type Result = { publicKey: string; signature?: string; hash?: string; confirmed?: boolean; expected?: { tokens: number; quoteAmount?: number; eth?: number }; quote?: { symbol: string }; error?: string; code?: string; skipped?: string }
type Fees = { creator: string; sol: number; /** the coin's launchpad pays nothing to claim: why */ none?: string }

const fmtTokens = (n: number | undefined) => (n === undefined ? "–" : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 4 : 0 }))
const ago = (ms: number) => { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h` }
const countdown = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` }
const txOf = (x: { signature?: string; hash?: string }) => x.signature ?? x.hash
const nativeOf = (t: Trade) => t.sol ?? t.eth ?? 0
/** A market cap, short: 28.4 · 1.25K · 3.1M */
const fmtCap = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(2)}K` : n >= 100 ? n.toFixed(0) : n.toFixed(1))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The launcher's terminal buttons: tiny, bold, monospace, green for buys and red for sells. */
const BUY_BTN = "rounded px-2.5 py-1.5 font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
const SELL_BTN = "rounded px-2.5 py-1.5 font-mono text-xs font-bold text-destructive hover:bg-destructive/30 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
function BuyBtn({ className, ...p }: React.ComponentProps<"button">) {
  return <button type="button" className={cn(BUY_BTN, className)} {...p} />
}
function SellBtn({ hot, className, ...p }: React.ComponentProps<"button"> & { hot?: boolean }) {
  return <button type="button" className={cn(SELL_BTN, hot ? "bg-destructive/20" : "bg-destructive/10", className)} {...p} />
}
/** A colored uppercase tag that names a terminal row; one width, so the rows' controls line up. */
function Tag({ tone, children }: { tone: "buy" | "sell" | "muted"; children: React.ReactNode }) {
  return <span className={cn("w-16 shrink-0 rounded py-1 text-center font-mono text-[10px] font-bold tracking-wide uppercase", tone === "buy" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : tone === "sell" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>{children}</span>
}
/** One wallet row of the terminal: fixed columns from sm up (wallet · balance · tokens · buy · sell), wrapping on a phone. */
const ROW = "flex flex-wrap items-center gap-x-2 gap-y-1 px-2 sm:grid sm:grid-cols-[minmax(0,1fr)_72px_60px_112px_124px] sm:gap-x-3"

export default function TradingPage() {
  const [launches, setLaunches] = React.useState<Launch[]>([])
  const [coin, setCoin] = React.useState("")
  const [token, setToken] = React.useState<Token | null>(null)
  const [wallets, setWallets] = React.useState<Wallet[]>([])
  const [main, setMain] = React.useState<string | null>(null)
  // phones get the terminal as a bottom dock (components/ui/bottom-dock.tsx)
  const phone = useMediaQuery("(max-width: 767px)")
  const [dockOpen, setDockOpen] = React.useState(false)
  const [rows, setRows] = React.useState<Map<string, Row>>(new Map())
  const [failure, setFailure] = React.useState<Failure | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [buyAmt, setBuyAmt] = React.useState<Record<string, string>>({})
  const [eachBuy, setEachBuy] = React.useState(chain.defaultBuy)
  const [stagger, setStagger] = React.useState(false)
  const [includeDev, setIncludeDev] = React.useState(true)
  const [partialFill, setPartialFill] = React.useState(false)
  const [timers, setTimers] = React.useState<Timer[]>([])
  const [timerMin, setTimerMin] = React.useState("5")
  const [timerPct, setTimerPct] = React.useState("50")
  const [now, setNow] = React.useState(Date.now())
  const [trades, setTrades] = React.useState<Trade[]>([])
  const [feed, setFeed] = React.useState<"off" | "connecting" | "live">("off")
  const [fees, setFees] = React.useState<Fees | null>(null)
  const [pnl, setPnl] = React.useState<Pnl | null>(null)
  const [pnlLoading, setPnlLoading] = React.useState(false)
  // a launch that just happened (?launch=<id> from the Launch page): its log keeps streaming here while the holders buy
  const [launchId, setLaunchId] = React.useState<string | null>(null)
  const [launchLog, setLaunchLog] = React.useState<Array<{ stage: string; message: string; error: boolean }>>([])
  const [launchDone, setLaunchDone] = React.useState(false)
  // the close-out popup: opens by itself once every wallet of the run has sold out (once per coin and tab), or from its button
  const [closeOpen, setCloseOpen] = React.useState(false)
  const [closedAccounts, setClosedAccounts] = React.useState(false)
  const [archiveToo, setArchiveToo] = React.useState(true)
  const [rowsCoin, setRowsCoin] = React.useState("")
  const everHeld = React.useRef(false)

  const valid = chain.isCoin(coin)
  const cp = chain.coinParam
  const q = (c: string) => `${cp}=${encodeURIComponent(c)}`
  const sym = token?.quote?.symbol ?? chain.symbol
  const mayhem = chain.features.mayhem && token?.mayhem?.enabled === true
  const row = (pk: string) => rows.get(pk.toLowerCase())
  const held = (pk: string) => (row(pk)?.tokens ?? 0) > 0
  const last = trades.find((t) => t.tokens > 0 && nativeOf(t) > 0)
  const price = last ? nativeOf(last) / last.tokens : null
  // the market cap, in the coin's quote: the newest trade's (live), else the token read's (on load)
  const lastCap = trades.find((t) => (t.marketCapSol ?? t.marketCapEth ?? 0) > 0)
  const marketCap = token?.custom ? (token.curve?.marketCapQuote ?? null) : (lastCap ? (lastCap.marketCapSol ?? lastCap.marketCapEth ?? null) : (token?.curve?.marketCapSol ?? null))
  // our own wallets, to mark their trades in the feed (the feed tags them too; this also catches wallets added since)
  const mine = new Map(wallets.map((w) => [w.publicKey.toLowerCase(), w.publicKey === main ? "Main" : w.label]))
  const ourTrade = (t: Trade) => mine.get(t.trader.toLowerCase()) ?? (t.ours ? t.ours.split(" · ")[0] : null)
  const ourCount = trades.filter((t) => ourTrade(t)).length
  // Buy all / Sell all / Later act on every wallet, the dev wallet too unless "include the dev wallet" is off.
  const bulkTargets = wallets.filter((w) => includeDev || w.publicKey !== main).map((w) => w.publicKey)
  /** Buy all only uses wallets that can pay: the amount, the API fee and a little for gas (on a SOL coin). */
  const canBuy = (a: number) => bulkTargets.filter((pk) => token?.custom || (row(pk)?.native ?? 0) >= a * (1 + chain.apiFeeRate) + chain.minGas)
  const skipDev = !includeDev
  // the dev wallet first, then the rest
  const ordered = [...wallets].sort((a, b) => (a.publicKey === main ? -1 : b.publicKey === main ? 1 : 0))

  // my launches + the coin: ?mint= / ?token= in the address (the Launch page sends you here), else the one from last time
  React.useEffect(() => {
    get<{ launches: Launch[] }>("/api/launch").then((r) => setLaunches(r.launches.filter((l) => l.mint || l.token))).catch(() => {})
    const q = new URLSearchParams(window.location.search)
    const fromUrl = q.get(chain.coinParam)?.trim()
    if (fromUrl && chain.isCoin(fromUrl)) { setCoin(fromUrl); setLaunchId(q.get("launch")); return }
    const c = readChosenCoin()
    if (c?.coin) setCoin(c.coin)
  }, [])
  // the launch log of a coin launched a moment ago, until it says done
  React.useEffect(() => {
    if (!launchId) return
    setLaunchLog([]); setLaunchDone(false)
    return subscribe<Record<string, unknown>>(chain.launchLog.path(launchId), (raw) => {
      const e = chain.launchLog.read(raw)
      setLaunchLog((xs) => [...xs, e])
      if (e.done) setLaunchDone(true)
      if (e.stage === "holder" || e.stage === "holders" || e.stage === "sniper" || e.stage === "snipers" || e.stage === "autosell" || e.done) void load()
    })
  }, [launchId]) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  const load = React.useCallback(async () => {
    if (!valid) return
    try {
      const [f, b] = await Promise.all([get<{ wallets: Wallet[]; mainWallet: string | null }>("/api/wallets"), get<{ rows: Row[] }>(`/api/wallets/balances?${q(coin)}`)])
      setWallets(f.wallets); setMain(f.mainWallet)
      setRows(new Map(b.rows.map((r) => [r.publicKey.toLowerCase(), r]))); setRowsCoin(coin)
      setFailure(null)
    } catch (e) { setFailure(failureOf(e)) }
    if (chain.features.creatorFees) get<Fees>(`/api/trading/creator-fees?${q(coin)}`).then(setFees).catch(() => setFees(null))
  }, [coin, valid]) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void load() }, [load])
  /** Wallets and balances read NOW (and shown): what Sell all goes by, so a wallet that bought a moment ago is included. */
  const freshRows = async () => {
    const [f, b] = await Promise.all([get<{ wallets: Wallet[]; mainWallet: string | null }>("/api/wallets"), get<{ rows: Row[] }>(`/api/wallets/balances?${q(coin)}`)])
    const map = new Map(b.rows.map((r) => [r.publicKey.toLowerCase(), r]))
    setWallets(f.wallets); setMain(f.mainWallet); setRows(map); setRowsCoin(coin)
    return { wallets: f.wallets, main: f.mainWallet, rows: map }
  }

  // the coin: name, symbol, venue, flags; remembered for the Wallets page's balance column
  React.useEffect(() => {
    setToken(null); setPartialFill(false)
    if (!valid) return
    // tried again a few times: on a first visit the demo's API key is still being made when the page asks
    let stop = false
    const read = (left: number) => get<Token>(`/api/trading/token?${q(coin)}`).then((t) => { if (stop) return; setToken(t); writeChosenCoin({ coin, symbol: t.symbol ?? undefined }) }).catch(() => {
      if (stop) return
      setToken(null); writeChosenCoin({ coin })
      if (left > 0) setTimeout(() => { if (!stop) void read(left - 1) }, 3000)
    })
    void read(3)
    return () => { stop = true }
  }, [coin, valid]) // eslint-disable-line react-hooks/exhaustive-deps

  // timers: the list every 5 s while one is pending
  const loadTimers = React.useCallback(() => { if (valid) get<{ timers: Timer[] }>(`/api/trading/timers?${q(coin)}`).then((r) => setTimers(r.timers)).catch(() => {}) }, [coin, valid]) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { loadTimers() }, [loadTimers])

  // profit / loss: on opening a coin, every minute, and a few seconds after each of our trades
  const loadPnl = React.useCallback(() => {
    if (!valid) return
    setPnlLoading(true)
    get<Pnl>(`/api/trading/pnl?${q(coin)}`).then(setPnl).catch(() => {}).finally(() => setPnlLoading(false))
  }, [coin, valid]) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { setPnl(null); loadPnl(); const t = setInterval(loadPnl, 60_000); return () => clearInterval(t) }, [loadPnl])
  /** After a buy, sell or claim: balances right away, again at 2.5 s and 7 s (the chain needs a moment), then the PnL. */
  const refreshAfter = () => {
    void load()
    walletsChanged()
    setTimeout(() => void load(), 2500)
    setTimeout(() => { void load(); walletsChanged(); loadPnl() }, 7000)
  }
  React.useEffect(() => {
    if (!timers.some((t) => t.status === "pending" || t.status === "running")) return
    const i = setInterval(loadTimers, 5000)
    return () => clearInterval(i)
  }, [timers, loadTimers])

  // live trades: server-sent events relaying the API websocket
  React.useEffect(() => {
    setTrades([])
    if (!valid) { setFeed("off"); return }
    setFeed("connecting")
    return subscribe<{ type: "initial" | "snapshot"; trades: Trade[] } | { type: "trade"; trade: Trade }>(`/api/trading/feed?${q(coin)}`, (e) => {
      if (e.type === "trade") setTrades((xs) => [e.trade, ...xs].slice(0, 200))
      else { setTrades(e.trades); setFeed("live") }
    }, undefined, () => setFeed("connecting"))
  }, [coin, valid]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name)
    try { await fn() } catch (e) { toastFailure(failureOf(e)) } finally { setBusy(null) }
  }
  const label = (pk: string) => wallets.find((w) => w.publicKey === pk)?.label ?? chain.short(pk)
  const link = (sig: string) => <a className="underline underline-offset-4" href={chain.explorerTx(sig)} target="_blank" rel="noreferrer"><Mono className="text-xs">{chain.short(sig)}</Mono></a>
  const amountOf = (r: Result) => r.expected?.quoteAmount ?? r.expected?.eth

  // ── trades: act at once, one toast per result ───────────────────────────
  const buy = (pk: string, amount: string) => run(`buy:${pk}`, async () => {
    const a = Number(amount)
    if (!(a > 0)) throw { error: `Enter the ${sym} amount to buy with` }
    const r = await post<Result>("/api/trading/buy", { publicKey: pk, [cp]: coin, amount: a, ...(mayhem && partialFill ? { partialFill: true } : {}) })
    const s = txOf(r)
    toast({ tone: "ok", title: `${label(pk)} bought ${r.expected ? `~${fmtTokens(r.expected.tokens)} tokens` : ""} for ${amountOf(r) ?? a} ${r.quote?.symbol ?? sym}`, detail: <>{r.confirmed === false ? "sent, not confirmed yet · " : ""}{s ? link(s) : null}</> })
    refreshAfter()
  })
  // ── gas: a wallet must hold chain.minGas to send any trade; one that does not is topped up from the main wallet ──
  const TOP_UP = +(chain.minGas * 2).toFixed(6)
  const lowGas = (pk: string) => (row(pk)?.native ?? 0) < chain.minGas
  const topUp = async (pks: string[]) => {
    const r = await post<{ results: Array<{ publicKey: string; error?: string }> }>("/api/wallets/fund", { publicKeys: pks, amount: TOP_UP })
    const failed = r.results.filter((x) => x.error)
    if (failed.length) throw { error: `Could not top up ${failed.map((x) => label(x.publicKey)).join(", ")}: ${failed[0].error}` }
    await sleep(1500)
  }
  /** "This wallet cannot pay the fee": one button sends it a little from the main wallet, then does the trade. */
  const askTopUp = (pks: string[], what: string, then: () => Promise<void>) => toast({
    tone: "warn", sticky: true,
    title: pks.length === 1 ? `${label(pks[0])} has too little ${chain.symbol} to ${what}` : `${pks.length} wallets have too little ${chain.symbol} to ${what}`,
    detail: `Every trade pays a small network fee, and the chain keeps a little ${chain.symbol} in each wallet. Send ${TOP_UP} ${chain.symbol} to ${pks.length === 1 ? "it" : "each"} from your main wallet, then ${what}.`,
    actions: [{ label: `Send ${TOP_UP} ${chain.symbol} & ${what}`, primary: true, run: async () => { await topUp(pks); await then(); refreshAfter() } }],
  })
  const sellRaw = async (pk: string, percent: number) => {
    const r = await post<Result>("/api/trading/sell", { publicKey: pk, [cp]: coin, percent })
    const s = txOf(r)
    toast({ tone: "ok", title: `${label(pk)} sold ${percent}%${r.expected ? ` · ${fmtTokens(r.expected.tokens)} tokens for ${amountOf(r)} ${r.quote?.symbol ?? sym}` : ""}`, detail: <>{r.confirmed === false ? "sent, not confirmed yet · " : ""}{s ? link(s) : null}</> })
  }
  const sell = (pk: string, percent: number) => run(`sell:${pk}:${percent}`, async () => {
    if (lowGas(pk)) { askTopUp([pk], `sell ${percent}%`, () => sellRaw(pk, percent)); return }
    await sellRaw(pk, percent)
    refreshAfter()
  })

  // ── Buy all / Sell all: the whole fleet (or all but the dev) in one press ─
  const buyAll = () => run("buy-all", async () => {
    const a = Number(eachBuy)
    if (!(a > 0)) throw { error: `Enter the ${sym} amount each wallet buys with` }
    const buyers = canBuy(a)
    if (buyers.length === 0) throw { error: `No wallet holds ${a} ${sym} plus fees: fund them on the Wallets page first` }
    const working = toast({ tone: "muted", sticky: true, title: `Buying with ${buyers.length} wallet${buyers.length === 1 ? "" : "s"}…`, detail: "Each buy is sent and confirmed; this takes a few seconds." })
    // all at once; "one by one" starts them with a short human-ish gap, so they don't land in the same block
    const out = await Promise.all(buyers.map(async (pk, i): Promise<Result> => {
      if (stagger && i) await sleep(i * (300 + Math.random() * 900))
      try { return await post<Result>("/api/trading/buy", { publicKey: pk, [cp]: coin, amount: a, ...(mayhem && partialFill ? { partialFill: true } : {}) }) }
      catch (e) { const f = failureOf(e); return { publicKey: pk, error: f.error, code: f.code } }
    }))
    dismissToast(working)
    report(`Buy ${a} ${sym} each${skipDev ? " · no dev" : ""}${stagger ? " · staggered" : ""}`, out)
    refreshAfter()
  })
  const sellAll = (percent: number) => run(`sellall:${percent}`, async () => {
    // balances read at the press: a wallet that bought since the page last looked (a later buyer, a volume wallet) sells too
    const now = await freshRows().catch(() => null)
    const tokensOf = (pk: string) => (now ? now.rows.get(pk.toLowerCase())?.tokens : row(pk)?.tokens) ?? 0
    const low = (pk: string) => ((now ? now.rows.get(pk.toLowerCase())?.native : row(pk)?.native) ?? 0) < chain.minGas
    const everyone = now ? now.wallets.filter((w) => includeDev || w.publicKey !== now.main).map((w) => w.publicKey) : bulkTargets
    const holders = everyone.filter((pk) => tokensOf(pk) > 0)
    if (holders.length === 0) throw { error: "No wallet holds this coin" }
    // wallets that cannot pay the fee are left out and offered a top-up; the rest sell now
    const starved = holders.filter(low)
    const targets = holders.filter((pk) => !low(pk))
    if (starved.length) askTopUp(starved, `sell ${percent}%`, async () => {
      const r = await post<{ results: Result[] }>("/api/trading/sell-all", { publicKeys: starved, [cp]: coin, percent })
      report(`Sell ${percent}% (topped up)`, r.results, true)
    })
    if (!targets.length) return
    const working = toast({ tone: "muted", sticky: true, title: `Selling ${percent}% from ${targets.length} wallet${targets.length === 1 ? "" : "s"}…`, detail: "All at once; each sell is sent and confirmed, usually within 10 seconds." })
    const r = await post<{ results: Result[] }>("/api/trading/sell-all", { publicKeys: targets, [cp]: coin, percent }).finally(() => dismissToast(working))
    report(`Sell ${percent}%${skipDev ? " · no dev" : ""}`, r.results, true)
    refreshAfter()
  })

  /** One toast for a batch of trades. A sell also offers what usually comes next: claim the fees, close out. */
  const report = (title: string, results: Result[], sold = false) => {
    const failed = results.filter((r) => r.error).length
    const next: ToastAction[] = sold && failed < results.length
      ? [...(chain.features.creatorFees && fees && fees.sol > 0 ? [{ label: `Claim ${chain.fmt(fees.sol)} ${chain.symbol} fees`, primary: true, run: async () => { await claimRaw(); refreshAfter() } }] : []), { label: "Close out…", run: () => setCloseOpen(true) }]
      : []
    toast({
      tone: failed ? "error" : "ok", sticky: failed > 0, actions: next, title: `${title}: ${results.length - failed}/${results.length} done`,
      detail: (
        <span className="flex flex-col gap-0.5">
          {results.map((r) => (
            <span key={r.publicKey} className="flex flex-wrap items-center gap-1.5">
              <span>{label(r.publicKey)}</span>
              {r.error ? <span className="text-destructive">{r.error}{r.code ? ` · ${r.code}` : ""}</span> : r.skipped ? <span>skipped: {r.skipped}</span> : <span>{r.expected ? `${fmtTokens(r.expected.tokens)} tokens · ${amountOf(r)} ${r.quote?.symbol ?? sym}` : "done"}</span>}
              {txOf(r) ? link(txOf(r)!) : null}
            </span>
          ))}
        </span>
      ),
    })
  }
  const addTimer = () => run("timer", async () => {
    const now = await freshRows().catch(() => null)
    const targets = now ? now.wallets.filter((w) => includeDev || w.publicKey !== now.main).map((w) => w.publicKey).filter((pk) => (now.rows.get(pk.toLowerCase())?.tokens ?? 0) > 0) : bulkTargets.filter(held)
    if (targets.length === 0) throw { error: "No wallet holds this coin yet" }
    await post("/api/trading/timers", { [cp]: coin, publicKeys: targets, percent: Number(timerPct) || 100, minutes: Number(timerMin) || 0 })
    toast({ tone: "ok", title: `Set: sell ${timerPct}% from ${targets.length} wallet${targets.length === 1 ? "" : "s"} in ${timerMin} min`, detail: DEMO ? TAB_NOTE : "Kept in the server's memory; a restart forgets it." })
    loadTimers()
  })
  const cancelTimer = (id: string) => run(`cancel:${id}`, async () => { await del(`/api/trading/timers?id=${encodeURIComponent(id)}`); loadTimers() })
  const claimRaw = async () => {
    // the creator wallet gets the fees: bring it back if it was archived, and give it gas if a sweep emptied it
    const creator = fees?.creator
    if (creator) {
      const arch = await get<{ wallets: Array<{ publicKey: string }> }>("/api/wallets/archived").catch(() => null)
      if (arch?.wallets.some((w) => w.publicKey === creator)) {
        await post("/api/wallets/unarchive", { publicKeys: [creator] })
        toast({ tone: "muted", title: `Restored ${chain.short(creator)} to claim its creator fees`, detail: "It was archived; it stays in your wallet list now." })
        await load()
      }
      const native = (await get<{ rows: Row[] }>(`/api/wallets/balances?${q(coin)}`).catch(() => null))?.rows.find((r) => r.publicKey === creator)?.native ?? 0
      if (native < chain.minGas) await topUp([creator])
    }
    const r = await post<{ creator: string; signature: string; confirmed: boolean }>("/api/trading/creator-fees", { [cp]: coin })
    toast({ tone: "ok", title: `Creator fees claimed to ${chain.short(r.creator)}`, detail: <>{r.confirmed ? "confirmed · " : "sent · "}{link(r.signature)}</> })
  }
  const claim = () => run("claim", async () => { await claimRaw(); refreshAfter() })

  // ── close out: the wallets of this coin's run (its launches' wallets, every wallet that traded it, every holder) ──
  const runSet = new Set<string>()
  for (const l of launches) {
    if ((l.mint ?? l.token) !== coin || !l.wallets) continue
    const w = l.wallets
    for (const pk of [w.dev, ...(w.bundle ?? []), ...(w.sniper ?? []), ...(w.holder ?? []), ...(w.volume ?? [])]) if (pk) runSet.add(pk.toLowerCase())
  }
  for (const w of pnl?.wallets ?? []) runSet.add(w.publicKey.toLowerCase())
  for (const w of wallets) if (held(w.publicKey)) runSet.add(w.publicKey.toLowerCase())
  const runWallets = ordered.filter((w) => runSet.has(w.publicKey.toLowerCase()))
  const holdersLeft = runWallets.filter((w) => held(w.publicKey))
  const tokensLeft = holdersLeft.reduce((t, w) => t + (row(w.publicKey)?.tokens ?? 0), 0)
  const runBuyers = runWallets.filter((w) => w.publicKey !== main)
  // the coin's creator wallet(s): creator fees keep arriving there as long as the coin trades, so Close out keeps them
  const creators = new Set<string>([...(fees?.creator ? [fees.creator] : []), ...launches.filter((l) => (l.mint ?? l.token) === coin && l.wallets?.dev).map((l) => l.wallets!.dev!)].map((x) => x.toLowerCase()))
  const archivable = runBuyers.filter((w) => !creators.has(w.publicKey.toLowerCase()))
  const keptCreator = runBuyers.find((w) => creators.has(w.publicKey.toLowerCase()))
  const sweepable = runBuyers.filter((w) => (row(w.publicKey)?.native ?? 0) > 0.0001)
  const sweepSum = sweepable.reduce((t, w) => t + (row(w.publicKey)?.native ?? 0), 0)
  const timersWaiting = timers.filter((t) => t.status === "pending").length

  const sellLeftRaw = async () => {
    // close out: a holder that cannot pay the fee gets a small top-up first (it comes back with the sweep)
    const now = await freshRows().catch(() => null)
    const left = now ? runWallets.map((w) => w.publicKey).filter((pk) => (now.rows.get(pk.toLowerCase())?.tokens ?? 0) > 0) : holdersLeft.map((w) => w.publicKey)
    const starved = left.filter((pk) => ((now ? now.rows.get(pk.toLowerCase())?.native : row(pk)?.native) ?? 0) < chain.minGas)
    if (starved.length) await topUp(starved)
    if (!left.length) return
    const r = await post<{ results: Result[] }>("/api/trading/sell-all", { publicKeys: left, [cp]: coin, percent: 100 })
    report("Sell what is left", r.results)
  }
  const closeAccountsRaw = async () => {
    const r = await post<{ totalClosed: number; results: Array<{ publicKey: string; closed: number; error?: string }> }>("/api/wallets/close-accounts", { publicKeys: runWallets.map((w) => w.publicKey) })
    const failed = r.results.filter((x) => x.error)
    toast({ tone: failed.length ? "error" : "ok", sticky: failed.length > 0, title: `Closed ${r.totalClosed} empty token account${r.totalClosed === 1 ? "" : "s"}; the rent went to the main wallet`, detail: failed.length ? failed.map((x) => `${label(x.publicKey)}: ${x.error}`).join(" · ") : undefined })
    // done only when every wallet went through; a failure keeps the step open so it can be tried again
    if (!failed.length) setClosedAccounts(true)
  }
  /** Everything in the buyer wallets back to the main wallet; returns the wallets that are empty now (safe to archive). */
  const sweepRaw = async (): Promise<string[]> => {
    if (!runBuyers.length) return []
    const r = await post<{ to: string; results: Array<{ publicKey: string; error?: string; recovered?: number; eth?: number }> }>("/api/wallets/gather", { publicKeys: runBuyers.map((w) => w.publicKey) })
    const got = r.results.reduce((t, x) => t + (x.recovered ?? x.eth ?? 0), 0)
    const failed = r.results.filter((x) => x.error)
    toast({ tone: failed.length ? "error" : "ok", sticky: failed.length > 0, title: `Swept ${chain.fmt(got)} ${chain.symbol} into the main wallet`, detail: failed.length ? failed.map((x) => `${label(x.publicKey)}: ${x.error}`).join(" · ") : undefined })
    const bad = new Set(failed.map((x) => x.publicKey))
    return runBuyers.map((w) => w.publicKey).filter((pk) => !bad.has(pk))
  }
  const archiveRaw = async (pks: string[]) => {
    if (!pks.length) return
    const r = await post<{ archived: string[] }>("/api/wallets/archive", { publicKeys: pks })
    toast({ tone: "ok", title: `Archived ${r.archived.length} wallet${r.archived.length === 1 ? "" : "s"}`, detail: "Their keys stay in your backup; Wallets → Archived wallets → Restore brings them back." })
  }
  /** The whole close-out, in order: sell → claim → close accounts → sweep → archive (only wallets the sweep emptied). */
  const closeAll = () => run("close:all", async () => {
    if (holdersLeft.length) { await sellLeftRaw(); await sleep(2500) }
    if (chain.features.creatorFees && fees && fees.sol > 0) await claimRaw().catch((e) => toastFailure(failureOf(e)))
    if (chain.features.tokenAccounts && !closedAccounts) { await closeAccountsRaw().catch((e) => toastFailure(failureOf(e))); await sleep(1500) }
    const empty = await sweepRaw()
    if (archiveToo) {
      // never archive a wallet that still holds the coin (a sell that failed): fresh balances decide
      const b = await get<{ rows: Row[] }>(`/api/wallets/balances?${q(coin)}`).catch(() => null)
      const holding = new Set((b?.rows ?? []).filter((r) => (r.tokens ?? 0) > 0).map((r) => r.publicKey.toLowerCase()))
      await archiveRaw(b ? empty.filter((pk) => !holding.has(pk.toLowerCase()) && !creators.has(pk.toLowerCase())) : [])
    }
    refreshAfter()
  })
  type CloseStep = { key: string; title: string; detail: string; done: boolean; label: string; blocked?: string; act: () => Promise<void> }
  const closeSteps: CloseStep[] = [
    { key: "sell", title: "Sell what is left", detail: holdersLeft.length ? `${holdersLeft.length} wallet${holdersLeft.length === 1 ? " still holds" : "s still hold"} ${fmtTokens(tokensLeft)} tokens` : "Every wallet has sold", done: holdersLeft.length === 0, label: "Sell 100%", act: sellLeftRaw },
    ...(chain.features.creatorFees && !fees?.none ? [{ key: "claim", title: "Claim creator fees", detail: fees && fees.sol > 0 ? `${chain.fmt(fees.sol)} ${chain.symbol} waiting for you` : "Nothing to claim right now", done: !fees || fees.sol <= 0, label: "Claim", act: claimRaw }] : []),
    ...(chain.features.tokenAccounts ? [{ key: "close", title: "Close empty token accounts", detail: `Each one holds about 0.002 ${chain.symbol} of rent; it comes back to your main wallet`, done: closedAccounts || runWallets.length === 0, label: "Close", blocked: holdersLeft.length ? "Sell what is left first" : undefined, act: closeAccountsRaw }] : []),
    { key: "sweep", title: "Sweep everything to the main wallet", detail: sweepable.length ? `${chain.fmt(sweepSum)} ${chain.symbol} in ${sweepable.length} buyer wallet${sweepable.length === 1 ? "" : "s"}` : "The buyer wallets are empty", done: sweepable.length === 0, label: "Sweep", act: async () => { await sweepRaw() } },
    { key: "archive", title: "Archive the used wallets", detail: (archivable.length ? `${archivable.length} wallet${archivable.length === 1 ? "" : "s"} leave your lists; keys stay in your backup, Restore brings them back` : "No buyer wallets to archive") + (keptCreator ? `. ${keptCreator.label} stays: it is the creator, and creator fees keep coming to it` : ""), done: archivable.length === 0, label: "Archive", blocked: sweepable.some((w) => !creators.has(w.publicKey.toLowerCase())) ? "Sweep first" : undefined, act: () => archiveRaw(archivable.map((w) => w.publicKey)) },
  ]
  const allClosed = closeSteps.every((c) => c.done)

  // open it by itself when the run is over: some wallet of it held the coin on this page, now none does
  React.useEffect(() => { everHeld.current = false }, [coin])
  React.useEffect(() => {
    if (!valid || rowsCoin !== coin || !runWallets.length) return
    if (holdersLeft.length) { everHeld.current = true; return }
    if (!everHeld.current) return
    everHeld.current = false
    try { const k = `closeout:${coin}`; if (window.sessionStorage.getItem(k)) return; window.sessionStorage.setItem(k, "1") } catch { /* storage blocked: open anyway */ }
    setCloseOpen(true)
  }, [valid, coin, rowsCoin, runWallets.length, holdersLeft.length])
  // re-read balances every 15 s while the page is open: later buyers, auto-sell and other tabs change them behind this page
  React.useEffect(() => {
    if (!valid) return
    const t = setInterval(() => { if (document.visibilityState === "visible") void load() }, 15_000)
    return () => clearInterval(t)
  }, [valid, load])

  const pendingTimers = timers.filter((t) => t.status === "pending" || t.status === "running").length
  const badges: React.ReactNode[] = []
  if (token?.venue) badges.push(<Pill key="venue" title={`trades on ${token.venue}`}><BrandIcon src={chain.launchpadLogo} label={chain.launchpad} size={12} />{token.venue}</Pill>)
  if (token?.custom && token.quote) badges.push(<Pill key="pair" title={`priced and traded in ${token.quote.symbol}; wallets must hold it. Fees are still ${chain.symbol}.`}>pair · {token.quote.symbol}</Pill>)
  if (mayhem) badges.push(<Pill key="mayhem" tone="warn" title={`${chain.launchpad}'s agent trades this coin for its first 24 h; a buy past the remaining supply fails unless partial fill`}>Mayhem</Pill>)
  if (token?.holderReward) badges.push(<Pill key="hr" tone="ok" title="the creator fee goes to the holders">holder rewards</Pill>)
  if (token?.creatorFeeBps) badges.push(<Pill key="fee">creator fee {token.creatorFeeBps} bps</Pill>)
  if (token?.graduated) badges.push(<Pill key="grad" tone="ok">graduated</Pill>)
  if (token?.curveState?.bondingProgressPct !== undefined) badges.push(<Pill key="curve">curve {token.curveState.bondingProgressPct.toFixed(1)} %</Pill>)
  if (token?.curveState?.snipeTaxBps) badges.push(<Pill key="tax" tone="warn">snipe tax {token.curveState.snipeTaxBps} bps</Pill>)

  // ── the terminal's parts: inline on a wide screen, in the bottom dock on a phone ──
  const staggerBox = <label className="text-muted-foreground inline-flex cursor-pointer items-center gap-1" title="A short random pause between wallets instead of all at once"><Checkbox checked={stagger} onChange={(e) => setStagger(e.target.checked)} className="size-3.5" /> one by one <Q k="oneByOne" /></label>
  const partialBox = mayhem ? <label className="text-muted-foreground inline-flex cursor-pointer items-center gap-1" title="Mayhem coins: a buy past the remaining supply takes what is left instead of failing"><Checkbox checked={partialFill} onChange={(e) => setPartialFill(e.target.checked)} className="size-3.5" /> partial fill <Q k="partialFill" /></label> : null
  const includeBox = <label className="text-muted-foreground inline-flex cursor-pointer items-center gap-1" title="Off: Buy all, Sell all and Later leave the main wallet alone"><Checkbox checked={includeDev} onChange={(e) => setIncludeDev(e.target.checked)} className="size-3.5" /> include main wallet <Q k="includeMain" /></label>
  const buyCount = canBuy(Number(eachBuy) || 0).length
  const buyAllLabel = busy === "buy-all" ? "Buying…" : `Buy · ${buyCount}`
  const sellAllBtns = (cls: string) => [25, 50, 100].map((p) => <SellBtn key={p} hot={p === 100} className={cls} disabled={!!busy} onClick={() => void sellAll(p)}>{busy === `sellall:${p}` ? "…" : `${p}%`}</SellBtn>)
  const CELL = "bg-card flex flex-wrap items-center gap-1.5 px-2 py-1.5"
  const closeOutBtn = <Button size="xs" variant="outline" onClick={() => setCloseOpen(true)} title="Sell what is left, claim, sweep to the main wallet, archive">Close out…</Button>
  const laterCell = (
    <div className={CELL}>
      <Tag tone="muted">Later</Tag><Q k="laterSell" />
      <span className="text-muted-foreground">sell</span>
      <Input inputMode="numeric" value={timerPct} onChange={(e) => setTimerPct(e.target.value)} className="h-7 w-12 font-mono text-xs" aria-label="Percent" />
      <span className="text-muted-foreground">%<span className="hidden sm:inline"> of everything</span> in</span>
      <Input inputMode="numeric" value={timerMin} onChange={(e) => setTimerMin(e.target.value)} className="h-7 w-12 font-mono text-xs" aria-label="Minutes" />
      <span className="text-muted-foreground">min</span>
      <Button size="xs" variant="outline" onClick={addTimer} disabled={!!busy}>{busy === "timer" ? "Setting…" : "Set"}</Button>
      {pendingTimers ? <span className="text-warn">{pendingTimers} waiting</span> : null}
      {chain.features.creatorFees ? null : <span className="ml-auto">{closeOutBtn}</span>}
    </div>
  )
  const feesCell = chain.features.creatorFees ? (
    <div className={CELL} title={fees ? `Creator: ${fees.creator}` : undefined}>
      <Tag tone="muted">Fees</Tag><Q k="creatorFees" />
      <span className="text-muted-foreground">creator fees</span>
      {fees?.none ? <span className="text-muted-foreground truncate" title={fees.none}>{fees.none}</span> : <>
      <span className={cn("font-mono tabular-nums", fees && fees.sol > 0 ? "text-ok" : "")}>{fees ? `${fees.sol.toFixed(chain.decimals)} ${chain.symbol}` : "–"}</span>
      <span className="text-muted-foreground hidden sm:inline">unclaimed</span></>}
      <span className="ml-auto inline-flex gap-1.5">{fees?.none ? null : <Button size="xs" variant="outline" onClick={claim} disabled={!fees || fees.sol <= 0 || !!busy}>{busy === "claim" ? "Claiming…" : "Claim"}</Button>}{closeOutBtn}</span>
    </div>
  ) : null
  const walletRows = wallets.length === 0 ? (
    <p className="text-muted-foreground px-2 py-4 text-center">No wallets yet: <a href="/wallets" className="underline underline-offset-4">add some on the Wallets page</a>, or launch a coin (the Launch page makes them).</p>
  ) : (
    <>
      <div className={cn(ROW, "text-muted-foreground bg-muted/40 hidden py-1 text-[10px] tracking-wide uppercase sm:grid", phone && "sm:hidden")}>
        <span>Wallet</span>
        <span className="text-right">{chain.symbol}</span>
        <span className="text-right">Tokens</span>
        <span className="text-right">Buy</span>
        <span className="text-right">Sell</span>
      </div>
      {phone ? (
        <div className="text-muted-foreground bg-muted/40 flex items-center gap-1.5 px-2 py-1 text-[10px] tracking-wide uppercase">
          <span className="flex-1">Wallet</span>
          <span className="w-14 text-right">{chain.symbol}</span>
          <span className="w-10 text-right">Tokens</span>
          <span className="w-[8.5rem] text-right normal-case tracking-normal">buy {eachBuy} {sym} · sell</span>
        </div>
      ) : null}
      {ordered.map((w) => {
        const r = row(w.publicKey)
        const has = (r?.tokens ?? 0) > 0
        const isDev = w.publicKey === main
        if (phone) return (
          <div key={w.publicKey} className={cn("flex items-center gap-1.5 px-2 py-1", isDev ? "bg-brand/5" : "")}>
            <span className="flex min-w-0 flex-1 items-center gap-1">
              {isDev ? <span className="bg-brand text-background rounded px-1 py-px text-[9px] font-bold tracking-widest uppercase">Main</span> : <span className="truncate font-medium">{w.label}</span>}
            </span>
            <span className="w-14 text-right font-mono text-[11px] tabular-nums">{chain.fmt(r?.native)}</span>
            <span className={cn("w-10 text-right font-mono text-[11px] tabular-nums", has ? "" : "text-muted-foreground")}>{fmtTokens(r?.tokens)}</span>
            <BuyBtn className="px-1.5 py-1 text-[10px]" disabled={!!busy} title={`Buy ${eachBuy} ${sym} with this wallet`} onClick={() => void buy(w.publicKey, eachBuy)}>{busy === `buy:${w.publicKey}` ? "…" : "Buy"}</BuyBtn>
            {[25, 50, 100].map((p) => <SellBtn key={p} hot={p === 100} className="px-1 py-1 text-[10px]" disabled={!!busy || !has} title={has ? `Sell ${p}% of this wallet's tokens now` : "holds none"} onClick={() => void sell(w.publicKey, p)}>{busy === `sell:${w.publicKey}:${p}` ? "…" : `${p}%`}</SellBtn>)}
          </div>
        )
        return (
          <div key={w.publicKey} className={cn(ROW, "py-1", isDev ? "bg-brand/5" : "")}>
            <div className="flex min-w-0 flex-[1_1_9rem] items-center gap-1.5">
              {isDev ? <span className="bg-brand text-background rounded px-1 py-px text-[9px] font-bold tracking-widest uppercase">Main</span> : null}
              <span className="truncate font-medium">{isDev ? "Main wallet" : w.label}</span>
              <Mono className="text-muted-foreground hidden text-[11px] sm:inline">{chain.short(w.publicKey)}</Mono>
            </div>
            <span className="w-16 text-right font-mono tabular-nums sm:w-auto">{chain.fmt(r?.native)}</span>
            <span className={cn("w-14 text-right font-mono tabular-nums sm:w-auto", has ? "" : "text-muted-foreground")}>{fmtTokens(r?.tokens)}</span>
            <span className="inline-flex items-center justify-end gap-1">
              <Input inputMode="decimal" className="h-6 w-14 px-1.5 font-mono text-xs" value={buyAmt[w.publicKey] ?? chain.defaultBuy} onChange={(e) => setBuyAmt((s) => ({ ...s, [w.publicKey]: e.target.value }))} aria-label={`${w.label} buy amount`} />
              <BuyBtn className="px-2 py-1" disabled={!!busy} onClick={() => void buy(w.publicKey, buyAmt[w.publicKey] ?? chain.defaultBuy)}>{busy === `buy:${w.publicKey}` ? "…" : "Buy"}</BuyBtn>
            </span>
            <span className="inline-flex justify-end gap-1">
              {[25, 50, 100].map((p) => <SellBtn key={p} hot={p === 100} className="px-1.5 py-1" disabled={!!busy || !has} title={has ? `Sell ${p}% of this wallet's tokens now` : "holds none"} onClick={() => void sell(w.publicKey, p)}>{busy === `sell:${w.publicKey}:${p}` ? "…" : `${p}%`}</SellBtn>)}
            </span>
          </div>
        )
      })}
    </>
  )
  const timersBox = timers.length > 0 ? (
    <div className="flex flex-col divide-y overflow-hidden rounded-xl border text-xs">
      <div className="text-muted-foreground bg-muted/40 flex items-center justify-between px-2 py-1"><span>{DEMO ? "Sells set for later (keep this tab open)" : "Sells set for later (a server restart forgets them)"}</span><button type="button" className="hover:text-foreground underline-offset-4 hover:underline" onClick={() => void del("/api/trading/timers").then(loadTimers)}>clear finished</button></div>
      {timers.map((t) => (
        <div key={t.id} className="flex flex-wrap items-center gap-2 px-2 py-1">
          <Pill tone={t.status === "done" ? "ok" : t.status === "error" ? "error" : t.status === "pending" ? "warn" : "muted"}>{t.status}</Pill>
          <span>sell {t.percent}% from {t.publicKeys.length} wallet{t.publicKeys.length === 1 ? "" : "s"}</span>
          {t.status === "pending" ? <Mono className="text-xs">in {countdown(t.dueAt - now)}</Mono> : null}
          {t.error ? <span className="text-destructive">{t.error}</span> : null}
          {t.result ? <span className="text-muted-foreground">{t.result.filter((r) => txOf(r)).length} sold · {t.result.filter((r) => r.error).length} failed{t.result.filter((r) => r.error).map((r) => ` · ${chain.short(r.publicKey)}: ${r.error}`).join("")}</span> : null}
          {t.status === "pending" ? <Button size="xs" variant="ghost" className="ml-auto" onClick={() => void cancelTimer(t.id)} disabled={!!busy}>cancel</Button> : null}
        </div>
      ))}
    </div>
  ) : null
  const holding = ordered.filter((w) => (row(w.publicKey)?.tokens ?? 0) > 0).length

  return (
    <div className={cn("flex flex-col gap-2 sm:gap-3", valid && phone ? "pb-24" : "")}>
      {/* coin picker + header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="hidden items-center gap-1.5 text-sm font-medium sm:inline-flex">Coin</span>
        <Select value={launches.find((l) => (l.mint ?? l.token) === coin)?.id ?? ""} onChange={(e) => setCoin(launches.find((l) => l.id === e.target.value)?.mint ?? launches.find((l) => l.id === e.target.value)?.token ?? "")} className="h-8 w-28 text-xs sm:h-9 sm:w-60" aria-label="My launches">
          <option value="">my launches…</option>
          {launches.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.symbol}) · {l.status}</option>)}
        </Select>
        <Input placeholder={`or paste a ${chain.coinNoun}`} value={coin} onChange={(e) => setCoin(e.target.value.trim())} className="h-8 min-w-0 flex-1 font-mono text-xs sm:h-9 sm:min-w-64" />
        <Button variant="outline" size="icon-sm" className="size-8" aria-label="Refresh" onClick={() => void load()} disabled={!valid || !!busy}><RefreshCw /></Button>
      </div>
      {valid ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm [&_[data-pill]]:h-5 sm:[&_[data-pill]]:h-6">
          <span className="font-semibold">{token?.name ?? chain.short(coin)}</span>
          {token?.symbol && token.symbol !== token.name ? <span className="text-muted-foreground">· {token.symbol}</span> : null}
          {marketCap !== null ? <span className="font-mono text-xs" title={`market cap${price !== null ? ` · last price ${price.toPrecision(3)} ${sym} per token` : ""}`}><span className="text-muted-foreground">MC </span>{fmtCap(marketCap)} <span className="text-muted-foreground">{sym}</span></span> : price !== null ? <span className="text-muted-foreground font-mono text-xs" title="from the latest trade in the feed">{price.toPrecision(3)} {sym}</span> : null}
          {badges}
        </div>
      ) : <p className="text-muted-foreground text-sm">Pick one of your launches or paste a {chain.coinNoun}. Every wallet then shows its balance of the coin and can buy or sell from its row.</p>}
      <FailureBox failure={failure} />

      {/* the launch that brought you here: its last line, the whole log on request */}
      {launchId && launchLog.length ? (
        <details className={`rounded-lg border px-3 py-2 text-xs ${launchLog.some((e) => e.error) ? "border-destructive/40" : launchDone ? "border-ok/40" : ""}`}>
          <summary className="flex cursor-pointer items-center gap-2 select-none">
            <Pill tone={launchLog.some((e) => e.error) ? "error" : launchDone ? "ok" : "warn"}>{launchDone ? "launch done" : "launch running"}</Pill>
            <span className="truncate">{launchLog[launchLog.length - 1].message}</span>
            <span className="text-muted-foreground ml-auto shrink-0">{launchLog.length} lines</span>
          </summary>
          <div className="mt-2 flex max-h-48 flex-col gap-0.5 overflow-y-auto border-t pt-2 font-mono">
            {launchLog.map((e, i) => <div key={i} className={e.error ? "text-destructive" : ""}><span className="text-muted-foreground">[{e.stage}]</span> {e.message}</div>)}
          </div>
        </details>
      ) : null}

      {valid ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Chart coin={coin} trades={trades.filter((t) => t.tokens > 0 && nativeOf(t) > 0).map((t) => ({ timestamp: t.timestamp, price: nativeOf(t) / t.tokens, native: nativeOf(t), type: t.type }))} className="min-w-0" />

          {/* next to the chart: profit / loss on top, the live trades fill the rest of the chart's height */}
          <div className="flex min-h-80 min-w-0 flex-col overflow-hidden rounded-xl border text-xs">
            <div className="flex flex-col gap-1 border-b px-2.5 py-2">
              <div className="flex items-center gap-1.5">
                <span className="font-medium">Profit / loss</span>
                <Q k="pnl" />
                <button type="button" aria-label="Refresh the profit / loss" title="Refresh" className="text-muted-foreground hover:text-foreground ml-auto" onClick={loadPnl} disabled={pnlLoading}><RefreshCw className={cn("size-3.5", pnlLoading && "animate-spin")} /></button>
              </div>
              {pnl ? (
                pnl.trades === 0 ? <p className="text-muted-foreground">None of your wallets has traded this coin yet.</p> : (
                  <>
                    <p className={cn("font-mono text-xl leading-tight font-semibold tabular-nums", pnl.net > 0 ? "text-ok" : pnl.net < 0 ? "text-destructive" : "")}>
                      <Nudge value={pnl.net.toFixed(chain.decimals)}>{pnl.net > 0 ? "+" : ""}{pnl.net.toFixed(chain.decimals)} {chain.symbol}</Nudge>
                    </p>
                    <p className="text-muted-foreground -mt-0.5 text-[10px] tracking-wide uppercase">{pnl.tokensHeld > 0 ? "realised so far" : "final · every wallet has sold"}</p>
                    <div className="text-muted-foreground flex flex-col text-[11px]">
                      <div className="flex justify-between"><span>Spent (buys + every fee)</span><Mono className="text-[11px]"><Nudge value={pnl.spent.toFixed(chain.decimals)}>{pnl.spent.toFixed(chain.decimals)}</Nudge></Mono></div>
                      <div className="flex justify-between"><span>Got back (sells)</span><Mono className="text-[11px]"><Nudge value={pnl.received.toFixed(chain.decimals)}>{pnl.received.toFixed(chain.decimals)}</Nudge></Mono></div>
                      {pnl.tokensHeld > 0 ? (
                        <>
                          {(() => {
                            // the open part: a live sell quote of everything held (slippage + fees in it), else the last price
                            const exit = pnl.exitNative ?? (price !== null ? pnl.tokensHeld * price : null)
                            const quoted = pnl.exitNative !== null && pnl.exitNative !== undefined
                            const total = exit === null ? null : pnl.net + exit
                            return (
                              <>
                                <div className="flex justify-between"><span>Still holding{pnl.holders ? ` (${pnl.holders} wallet${pnl.holders === 1 ? "" : "s"})` : ""}</span><Mono className="text-[11px]">{fmtTokens(pnl.tokensHeld)} tokens{exit !== null ? ` ≈ ${exit.toFixed(chain.decimals)}` : ""}</Mono></div>
                                {total !== null ? <div className="text-foreground mt-0.5 flex justify-between border-t pt-0.5 font-medium" title={quoted ? "A live sell quote of all the tokens at once: the curve's slippage, pump.fun's and our fee and the network fees are in it" : "Last trade's price x tokens: the price drop of selling is not in it"}><span>If you sold everything now ≈</span><Mono className={cn("text-[11px]", total >= 0 ? "text-ok" : "text-destructive")}>{total >= 0 ? "+" : ""}{total.toFixed(chain.decimals)}</Mono></div> : null}
                                <p className="text-muted-foreground/80 text-[10px] leading-snug">Not final until every wallet has sold: the open part is {quoted ? "a live sell quote of all of it at once" : "the last price (no quote yet)"}, and it moves with the price.</p>
                              </>
                            )
                          })()}
                        </>
                      ) : null}
                    </div>
                    <details className="text-muted-foreground text-[11px]">
                      <summary className="hover:text-foreground cursor-pointer select-none">Per wallet · {pnl.trades} transaction{pnl.trades === 1 ? "" : "s"}</summary>
                      <div className="mt-1 flex max-h-28 flex-col overflow-y-auto">
                        {pnl.wallets.map((w) => (
                          <div key={w.publicKey} className="flex justify-between gap-2">
                            <span className="truncate">{w.publicKey === main ? "Main wallet" : w.label}</span>
                            <Mono className={cn("text-[11px]", w.net > 0 ? "text-ok" : w.net < 0 ? "text-destructive" : "")}>{w.net > 0 ? "+" : ""}{w.net.toFixed(chain.decimals)}</Mono>
                          </div>
                        ))}
                      </div>
                    </details>
                    {pnl.truncated ? <p className="text-warn text-[11px]">A wallet has a very long history; only its last 2000 transactions were read.</p> : null}
                  </>
                )
              ) : <p className="text-muted-foreground">{pnlLoading ? "Reading every transaction of your wallets on this coin…" : "…"}</p>}
            </div>
            <div className="bg-muted/40 flex items-center justify-between border-b px-2.5 py-1">
              <span className="font-medium">Live trades</span>
              <span className="text-muted-foreground text-[11px]">{feed === "connecting" ? "connecting…" : trades.length === 0 ? "no trades yet" : `${trades.length} trade${trades.length === 1 ? "" : "s"}${ourCount ? ` · ${ourCount} yours` : ""}`}</span>
            </div>
            {/* h-0 + a 0px basis: the list takes the height that is left (the chart's) and never stretches the row */}
            <div className="h-0 min-h-40 flex-[1_1_0px] overflow-y-auto font-mono text-[11px] tabular-nums">
              {feed === "live" && trades.length === 0 ? <p className="text-muted-foreground px-2.5 py-2 font-sans">Listening. Trades on this coin show up here as they land.</p> : null}
              {trades.map((t) => {
                const id = txOf(t) ?? `${t.trader}-${t.timestamp}`
                return (
                  <div key={id} className={cn("grid grid-cols-[28px_64px_minmax(0,1fr)_auto] items-center gap-1.5 border-l-2 px-2.5 py-0.5", ourTrade(t) ? "border-brand bg-brand/10" : "border-transparent")}>
                    <span className={t.type === "buy" ? "text-ok" : "text-destructive"}>{t.type}</span>
                    <span className="text-right">{nativeOf(t).toFixed(chain.decimals)}</span>
                    <span className="flex min-w-0 items-center gap-1">
                      {txOf(t) ? <a className="truncate underline-offset-4 hover:underline" href={chain.explorerTx(txOf(t)!)} target="_blank" rel="noreferrer">{chain.short(t.trader)}</a> : <span className="truncate">{chain.short(t.trader)}</span>}
                      {ourTrade(t) ? <span className="bg-brand/20 text-brand truncate rounded px-1 font-sans text-[10px] font-semibold" title="one of your wallets">{ourTrade(t)}</span> : null}
                    </span>
                    <span className="text-muted-foreground">{ago(t.timestamp)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ) : null}

      {valid && !phone ? (
        <div className="flex flex-col gap-3">
          {/* ── the terminal: the bulk rows and creator fees on top, then every wallet with its own buy and sell ── */}
          <div className="bg-card flex flex-col divide-y overflow-hidden rounded-xl border text-xs">
            <div className="bg-border grid gap-px lg:grid-cols-2">
              <div className={CELL}>
                <Tag tone="buy">Buy all</Tag><Q k="buyAll" />
                <Input inputMode="decimal" value={eachBuy} onChange={(e) => setEachBuy(e.target.value)} className="h-7 w-16 font-mono text-xs" aria-label="Buy amount each" />
                <span className="text-muted-foreground">{sym} each</span>
                <BuyBtn disabled={!!busy || buyCount === 0} onClick={buyAll} title={buyCount < bulkTargets.length ? `${bulkTargets.length - buyCount} wallet(s) cannot pay ${eachBuy} ${sym} + fees and are skipped` : undefined}>{busy === "buy-all" ? "Buying…" : `Buy · ${buyCount} wallet${buyCount === 1 ? "" : "s"}`}</BuyBtn>
                <span className="ml-auto inline-flex items-center gap-3">{staggerBox}{partialBox}</span>
              </div>
              <div className={CELL}>
                <Tag tone="sell">Sell all</Tag><Q k="sellAll" />
                {sellAllBtns("w-12")}
                <span className="text-muted-foreground">of every holder</span>
                <span className="ml-auto">{includeBox}</span>
              </div>
              {laterCell}
              {feesCell}
            </div>
            {walletRows}
          </div>
          {timersBox}
        </div>
      ) : null}

      {/* ── on a phone: the terminal is a dock; the bar trades every wallet, the drawer holds the rest ── */}
      {valid && phone ? (
        <BottomDock
          open={dockOpen}
          onOpenChange={setDockOpen}
          title={<>Wallets · {wallets.length}<span className="text-muted-foreground font-normal">{holding ? ` · ${holding} holding` : ""} · options, later{chain.features.creatorFees ? ", fees" : ""}</span></>}
          bar={
            <div className="flex items-center gap-1 text-[11px]">
              <Input inputMode="decimal" value={eachBuy} onChange={(e) => setEachBuy(e.target.value)} className="h-7 w-14 px-1.5 font-mono text-xs" aria-label={`Buy all: ${chain.symbol} each`} />
              <BuyBtn className="px-2 py-1.5 text-[11px]" disabled={!!busy || buyCount === 0} onClick={buyAll} title={`Every wallet buys ${eachBuy} ${chain.symbol}`}>{buyAllLabel}</BuyBtn>
              <span className="text-muted-foreground ml-auto pr-0.5 font-mono text-[10px] font-bold uppercase">Sell</span>
              {sellAllBtns("px-2 py-1.5 text-[11px]")}
            </div>
          }
        >
          <div className="flex flex-col divide-y text-xs">
            <div className="bg-card flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5">
              {staggerBox}{includeBox}{partialBox}
            </div>
            {laterCell}
            {feesCell}
            {walletRows}
            {timersBox ? <div className="p-2">{timersBox}</div> : null}
          </div>
        </BottomDock>
      ) : null}

      <Dialog open={closeOpen} onClose={() => setCloseOpen(false)} title={<>Close out {token?.symbol ?? (valid ? chain.short(coin) : "")}</>}>
        {pnl && pnl.trades > 0 ? (
          <p className="text-sm">Result{pnl.tokensHeld > 0 ? " so far" : ""}: <b className={cn("font-mono tabular-nums", pnl.net > 0 ? "text-ok" : pnl.net < 0 ? "text-destructive" : "")}>{pnl.net > 0 ? "+" : ""}{pnl.net.toFixed(chain.decimals)} {chain.symbol}</b> <span className="text-muted-foreground text-xs">(every buy, sell and fee of your wallets)</span></p>
        ) : null}
        {timersWaiting ? <p className="text-warn text-xs">{timersWaiting} timed sell{timersWaiting === 1 ? " is" : "s are"} still waiting under the wallets; cancel {timersWaiting === 1 ? "it" : "them"} there if the run is over.</p> : null}
        <ol className="flex flex-col divide-y rounded-lg border text-xs">
          {closeSteps.map((c, i) => (
            <li key={c.key} className="flex items-center gap-2.5 px-2.5 py-2">
              <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border text-[10px] font-bold", c.done ? "border-ok bg-ok text-background" : "text-muted-foreground")}>{c.done ? <Check className="size-3" /> : i + 1}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("font-medium", c.done && "text-muted-foreground")}>{c.title}</span>
                <span className="text-muted-foreground">{c.detail}</span>
              </span>
              {c.done ? <span className="text-ok text-[11px] font-medium">done</span> : <Button size="xs" variant="outline" disabled={!!busy || !!c.blocked} title={c.blocked} onClick={() => void run(`close:${c.key}`, async () => { await c.act(); refreshAfter() })}>{busy === `close:${c.key}` ? "…" : c.label}</Button>}
            </li>
          ))}
        </ol>
        <label className="text-muted-foreground inline-flex cursor-pointer items-center gap-1.5 text-xs"><Checkbox checked={archiveToo} onChange={(e) => setArchiveToo(e.target.checked)} className="size-3.5" /> “Do all of it” archives the swept wallets too</label>
        <div className="flex items-center gap-2">
          <Button className="flex-1" onClick={closeAll} disabled={!!busy || allClosed}>{busy === "close:all" ? "Working…" : allClosed ? "All done" : "Do all of it"}</Button>
          <Button variant="ghost" onClick={() => setCloseOpen(false)}>{allClosed ? "Close" : "Later"}</Button>
        </div>
        <p className="text-muted-foreground text-[11px]">Opens by itself when every wallet of a run has sold. Open it any time with <b>Close out…</b> next to the creator fees{phone ? " (in the wallet panel)" : ""}.</p>
      </Dialog>
    </div>
  )
}
