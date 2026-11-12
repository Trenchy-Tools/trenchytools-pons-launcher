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
import { ExternalLink, RefreshCw } from "lucide-react"
import { Chart } from "@/components/chart"
import { FailureBox } from "@/components/failure"
import { Button } from "@/components/ui/button"
import { Checkbox, Input, Select } from "@/components/ui/input"
import { Pill } from "@/components/ui/pill"
import { Mono } from "@/components/ui/table"
import { toast, toastFailure } from "@/components/ui/toast"
import { del, failureOf, get, post, readChosenCoin, subscribe, writeChosenCoin, type Failure } from "@/lib/api"
import { chain } from "@/lib/chain"
import { cn } from "@/lib/cn"
import { DEMO, TAB_NOTE } from "@/lib/browser/demo"

type Launch = { id: string; name: string; symbol: string; mint?: string | null; token?: string | null; status: string; createdAt: string }
type Wallet = { publicKey: string; label: string; role: string }
type Row = { publicKey: string; native: number; tokens?: number }
/** GET /api/trading/token, either starter: name / symbol / venue, plus pump.fun's quote + Mayhem flags or pons's curve state. */
type Token = { name?: string | null; symbol?: string | null; venue?: string; quote?: { symbol: string }; custom?: boolean; mayhem?: { enabled: boolean }; holderReward?: boolean; creatorFeeBps?: number; graduated?: boolean; curveState?: Record<string, number> | null }
type Trade = { signature?: string; hash?: string; type: "buy" | "sell"; trader: string; sol?: number; eth?: number; tokens: number; timestamp: number; ours: string | null }
type Timer = { id: string; publicKeys: string[]; percent: number; dueAt: number; status: string; error?: string; result?: Array<{ publicKey: string; signature?: string; hash?: string; error?: string; skipped?: string }> }
/** A trade's answer, either starter: `signature` (Solana) or `hash` (EVM); `expected.quoteAmount` or `expected.eth`. */
type Result = { publicKey: string; signature?: string; hash?: string; confirmed?: boolean; expected?: { tokens: number; quoteAmount?: number; eth?: number }; quote?: { symbol: string }; error?: string; code?: string; skipped?: string }
type Fees = { creator: string; sol: number }

const fmtTokens = (n: number | undefined) => (n === undefined ? "–" : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 4 : 0 }))
const ago = (ms: number) => { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h` }
const countdown = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` }
const txOf = (x: { signature?: string; hash?: string }) => x.signature ?? x.hash
const nativeOf = (t: Trade) => t.sol ?? t.eth ?? 0
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
/** A colored uppercase tag that names a terminal row, like the launcher's bulk-tag. */
function Tag({ tone, children }: { tone: "buy" | "sell"; children: React.ReactNode }) {
  return <span className={cn("rounded px-2 py-1 font-mono text-[11px] font-bold tracking-wide uppercase", tone === "buy" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-destructive/10 text-destructive")}>{children}</span>
}

export default function TradingPage() {
  const [launches, setLaunches] = React.useState<Launch[]>([])
  const [coin, setCoin] = React.useState("")
  const [token, setToken] = React.useState<Token | null>(null)
  const [wallets, setWallets] = React.useState<Wallet[]>([])
  const [main, setMain] = React.useState<string | null>(null)
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
  // a launch that just happened (?launch=<id> from the Launch page): its log keeps streaming here while the holders buy
  const [launchId, setLaunchId] = React.useState<string | null>(null)
  const [launchLog, setLaunchLog] = React.useState<Array<{ stage: string; message: string; error: boolean }>>([])
  const [launchDone, setLaunchDone] = React.useState(false)

  const valid = chain.isCoin(coin)
  const cp = chain.coinParam
  const q = (c: string) => `${cp}=${encodeURIComponent(c)}`
  const sym = token?.quote?.symbol ?? chain.symbol
  const mayhem = chain.features.mayhem && token?.mayhem?.enabled === true
  const row = (pk: string) => rows.get(pk.toLowerCase())
  const held = (pk: string) => (row(pk)?.tokens ?? 0) > 0
  const last = trades.find((t) => t.tokens > 0 && nativeOf(t) > 0)
  const price = last ? nativeOf(last) / last.tokens : null
  // Buy all / Sell all / Later act on every wallet, the dev wallet too unless "include the dev wallet" is off.
  const bulkTargets = wallets.filter((w) => includeDev || w.publicKey !== main).map((w) => w.publicKey)
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
      if (e.stage === "holder" || e.stage === "holders" || e.stage === "sniper" || e.stage === "snipers" || e.done) void load()
    })
  }, [launchId]) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  const load = React.useCallback(async () => {
    if (!valid) return
    try {
      const [f, b] = await Promise.all([get<{ wallets: Wallet[]; mainWallet: string | null }>("/api/wallets"), get<{ rows: Row[] }>(`/api/wallets/balances?${q(coin)}`)])
      setWallets(f.wallets); setMain(f.mainWallet)
      setRows(new Map(b.rows.map((r) => [r.publicKey.toLowerCase(), r])))
      setFailure(null)
    } catch (e) { setFailure(failureOf(e)) }
    if (chain.features.creatorFees) get<Fees>(`/api/trading/creator-fees?${q(coin)}`).then(setFees).catch(() => setFees(null))
  }, [coin, valid]) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void load() }, [load])

  // the coin: name, symbol, venue, flags; remembered for the Wallets page's balance column
  React.useEffect(() => {
    setToken(null); setPartialFill(false)
    if (!valid) return
    get<Token>(`/api/trading/token?${q(coin)}`).then((t) => { setToken(t); writeChosenCoin({ coin, symbol: t.symbol ?? undefined }) }).catch(() => { setToken(null); writeChosenCoin({ coin }) })
  }, [coin, valid]) // eslint-disable-line react-hooks/exhaustive-deps

  // timers: the list every 5 s while one is pending
  const loadTimers = React.useCallback(() => { if (valid) get<{ timers: Timer[] }>(`/api/trading/timers?${q(coin)}`).then((r) => setTimers(r.timers)).catch(() => {}) }, [coin, valid]) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { loadTimers() }, [loadTimers])
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
    await load()
  })
  const sell = (pk: string, percent: number) => run(`sell:${pk}:${percent}`, async () => {
    const r = await post<Result>("/api/trading/sell", { publicKey: pk, [cp]: coin, percent })
    const s = txOf(r)
    toast({ tone: "ok", title: `${label(pk)} sold ${percent}%${r.expected ? ` · ${fmtTokens(r.expected.tokens)} tokens for ${amountOf(r)} ${r.quote?.symbol ?? sym}` : ""}`, detail: <>{r.confirmed === false ? "sent, not confirmed yet · " : ""}{s ? link(s) : null}</> })
    await load()
  })

  // ── Buy all / Sell all: the whole fleet (or all but the dev) in one press ─
  const buyAll = () => run("buy-all", async () => {
    const a = Number(eachBuy)
    if (!(a > 0)) throw { error: `Enter the ${sym} amount each wallet buys with` }
    if (bulkTargets.length === 0) throw { error: "No wallets to buy from" }
    const out: Result[] = []
    for (let i = 0; i < bulkTargets.length; i++) {
      const pk = bulkTargets[i]
      try { out.push(await post<Result>("/api/trading/buy", { publicKey: pk, [cp]: coin, amount: a, ...(mayhem && partialFill ? { partialFill: true } : {}) })) }
      catch (e) { const f = failureOf(e); out.push({ publicKey: pk, error: f.error, code: f.code }) }
      // stagger: a short human-ish gap between wallets so the buys don't all hit the same block
      if (stagger && i < bulkTargets.length - 1) await sleep(300 + Math.random() * 900)
    }
    report(`Buy ${a} ${sym} each${skipDev ? " · no dev" : ""}${stagger ? " · staggered" : ""}`, out)
    await load()
  })
  const sellAll = (percent: number) => run(`sellall:${percent}`, async () => {
    const targets = bulkTargets.filter(held)
    if (targets.length === 0) throw { error: "No wallet holds this coin" }
    const r = await post<{ results: Result[] }>("/api/trading/sell-all", { publicKeys: targets, [cp]: coin, percent })
    report(`Sell ${percent}%${skipDev ? " · no dev" : ""}`, r.results)
    await load()
  })

  const report = (title: string, results: Result[]) => {
    const failed = results.filter((r) => r.error).length
    toast({
      tone: failed ? "error" : "ok", sticky: failed > 0, title: `${title}: ${results.length - failed}/${results.length} done`,
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
    const targets = bulkTargets.filter(held)
    if (targets.length === 0) throw { error: "No wallet holds this coin yet" }
    await post("/api/trading/timers", { [cp]: coin, publicKeys: targets, percent: Number(timerPct) || 100, minutes: Number(timerMin) || 0 })
    toast({ tone: "ok", title: `Set: sell ${timerPct}% from ${targets.length} wallet${targets.length === 1 ? "" : "s"} in ${timerMin} min`, detail: DEMO ? TAB_NOTE : "Kept in the server's memory; a restart forgets it." })
    loadTimers()
  })
  const cancelTimer = (id: string) => run(`cancel:${id}`, async () => { await del(`/api/trading/timers?id=${encodeURIComponent(id)}`); loadTimers() })
  const claim = () => run("claim", async () => {
    const r = await post<{ creator: string; signature: string; confirmed: boolean }>("/api/trading/creator-fees", { [cp]: coin })
    toast({ tone: "ok", title: `Creator fees claimed to ${chain.short(r.creator)}`, detail: <>{r.confirmed ? "confirmed · " : "sent · "}{link(r.signature)}</> })
    await load()
  })

  const pendingTimers = timers.filter((t) => t.status === "pending" || t.status === "running").length
  const badges: React.ReactNode[] = []
  if (token?.venue) badges.push(<Pill key="venue">{token.venue}</Pill>)
  if (token?.custom && token.quote) badges.push(<Pill key="pair" title={`priced and traded in ${token.quote.symbol}; wallets must hold it. Fees are still ${chain.symbol}.`}>pair · {token.quote.symbol}</Pill>)
  if (mayhem) badges.push(<Pill key="mayhem" tone="warn" title="pump.fun's agent trades this coin for its first 24 h; a buy past the remaining supply fails unless partial fill">Mayhem</Pill>)
  if (token?.holderReward) badges.push(<Pill key="hr" tone="ok" title="the creator fee goes to the holders">holder rewards</Pill>)
  if (token?.creatorFeeBps) badges.push(<Pill key="fee">creator fee {token.creatorFeeBps} bps</Pill>)
  if (token?.graduated) badges.push(<Pill key="grad" tone="ok">graduated</Pill>)
  if (token?.curveState?.bondingProgressPct !== undefined) badges.push(<Pill key="curve">curve {token.curveState.bondingProgressPct.toFixed(1)} %</Pill>)
  if (token?.curveState?.snipeTaxBps) badges.push(<Pill key="tax" tone="warn">snipe tax {token.curveState.snipeTaxBps} bps</Pill>)

  return (
    <div className="flex flex-col gap-4">
      {/* coin picker + header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Coin</span>
        <Select value={launches.find((l) => (l.mint ?? l.token) === coin)?.id ?? ""} onChange={(e) => setCoin(launches.find((l) => l.id === e.target.value)?.mint ?? launches.find((l) => l.id === e.target.value)?.token ?? "")} className="w-60 text-xs" aria-label="My launches">
          <option value="">my launches…</option>
          {launches.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.symbol}) · {l.status}</option>)}
        </Select>
        <Input placeholder={`or paste a ${chain.coinNoun}`} value={coin} onChange={(e) => setCoin(e.target.value.trim())} className="min-w-64 flex-1 font-mono text-xs" />
        <Button variant="outline" size="icon-sm" aria-label="Refresh" onClick={() => void load()} disabled={!valid || !!busy}><RefreshCw /></Button>
      </div>
      {valid ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{token?.name ?? chain.short(coin)}</span>
          {token?.symbol ? <span className="text-muted-foreground">· {token.symbol}</span> : null}
          {price !== null ? <span className="text-muted-foreground font-mono text-xs" title="from the latest trade in the feed">· last {price.toPrecision(3)} {sym}/token</span> : null}
          {badges}
          <span className="ml-auto flex flex-wrap items-center gap-3 text-xs">
            {chain.coinLinks(coin).map((l) => <a key={l.label} className="inline-flex items-center gap-1 underline underline-offset-4" href={l.href} target="_blank" rel="noreferrer">{l.label} <ExternalLink className="size-3" /></a>)}
          </span>
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

      {valid ? <Chart coin={coin} /> : null}

      {valid ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="flex flex-col gap-3">
            {/* ── the terminal: one press buys / sells / schedules over every wallet ── */}
            <div className="flex flex-col divide-y rounded-xl border-2">
              <div className="flex flex-wrap items-center gap-2 px-3 py-3">
                <Tag tone="buy">Buy all</Tag>
                <Input inputMode="decimal" value={eachBuy} onChange={(e) => setEachBuy(e.target.value)} className="h-8 w-24 font-mono text-xs" aria-label="Buy amount each" />
                <span className="text-muted-foreground text-xs">{sym} each</span>
                <BuyBtn className="px-3 py-2" disabled={!!busy || bulkTargets.length === 0} onClick={buyAll}>{busy === "buy-all" ? "Buying…" : `Buy with ${bulkTargets.length} wallet${bulkTargets.length === 1 ? "" : "s"}`}</BuyBtn>
                <label className="text-muted-foreground ml-auto inline-flex cursor-pointer items-center gap-1.5 text-xs" title="A short random pause between wallets instead of all at once"><Checkbox checked={stagger} onChange={(e) => setStagger(e.target.checked)} className="size-3.5" /> one by one</label>
                {mayhem ? <label className="text-muted-foreground inline-flex cursor-pointer items-center gap-1.5 text-xs" title="Mayhem coins: a buy past the remaining supply takes what is left instead of failing"><Checkbox checked={partialFill} onChange={(e) => setPartialFill(e.target.checked)} className="size-3.5" /> partial fill</label> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 px-3 py-3">
                <Tag tone="sell">Sell all</Tag>
                {[25, 50, 100].map((p) => <SellBtn key={p} hot={p === 100} className="px-3 py-2" disabled={!!busy} onClick={() => void sellAll(p)}>{busy === `sellall:${p}` ? "…" : `${p}%`}</SellBtn>)}
                <span className="text-muted-foreground text-xs">from every wallet that holds it</span>
                <label className="text-muted-foreground ml-auto inline-flex cursor-pointer items-center gap-1.5 text-xs" title="Off: Buy all, Sell all and Later leave the dev wallet alone"><Checkbox checked={includeDev} onChange={(e) => setIncludeDev(e.target.checked)} className="size-3.5" /> include the dev wallet</label>
              </div>
              <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-xs">
                <span className="bg-muted text-muted-foreground rounded px-2 py-1 font-mono text-[11px] font-bold tracking-wide uppercase">Later</span>
                <span className="text-muted-foreground">sell</span>
                <Input inputMode="numeric" value={timerPct} onChange={(e) => setTimerPct(e.target.value)} className="h-7 w-14 font-mono text-xs" aria-label="Percent" />
                <span className="text-muted-foreground">% of everything in</span>
                <Input inputMode="numeric" value={timerMin} onChange={(e) => setTimerMin(e.target.value)} className="h-7 w-14 font-mono text-xs" aria-label="Minutes" />
                <span className="text-muted-foreground">min</span>
                <Button size="xs" variant="outline" onClick={addTimer} disabled={!!busy}>{busy === "timer" ? "Setting…" : "Set"}</Button>
                {pendingTimers ? <span className="text-warn">{pendingTimers} waiting</span> : null}
              </div>
            </div>

            {/* ── every wallet, with its own balance, buy and sell ── */}
            {wallets.length === 0 ? (
              <p className="text-muted-foreground rounded-xl border px-3 py-6 text-center text-sm">No wallets yet: <a href="/wallets" className="underline underline-offset-4">add some on the Wallets page</a>, or launch a coin (the Launch page makes them).</p>
            ) : (
              <div className="flex flex-col divide-y rounded-xl border">
                <div className="text-muted-foreground flex items-center gap-3 px-3 py-1.5 text-[11px] tracking-wide uppercase">
                  <span className="flex-1">Wallet</span>
                  <span className="w-20 text-right">{chain.symbol}</span>
                  <span className="w-20 text-right">Tokens</span>
                  {/* invisible copies of the row's controls, so the column titles sit over their numbers */}
                  <span aria-hidden className="invisible inline-flex h-0 items-center gap-1"><span className="w-20" /><BuyBtn tabIndex={-1}>Buy</BuyBtn></span>
                  <span aria-hidden className="invisible inline-flex h-0 gap-1">{[25, 50, 100].map((p) => <SellBtn key={p} tabIndex={-1}>{p}%</SellBtn>)}</span>
                </div>
                {ordered.map((w) => {
                  const r = row(w.publicKey)
                  const has = (r?.tokens ?? 0) > 0
                  const isDev = w.publicKey === main
                  return (
                    <div key={w.publicKey} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5", isDev ? "bg-ok/5" : "")}>
                      <div className="flex min-w-36 flex-1 items-center gap-1.5">
                        {isDev ? <span className="bg-ok text-background rounded px-1.5 py-0.5 text-[10px] font-bold tracking-[0.12em] uppercase">Dev</span> : null}
                        <span className="font-medium">{isDev ? "Dev wallet" : w.label}</span>
                        <Mono className="text-muted-foreground text-xs">{chain.short(w.publicKey)}</Mono>
                      </div>
                      <span className="w-20 text-right font-mono text-xs">{chain.fmt(r?.native)}</span>
                      <span className={cn("w-20 text-right font-mono text-xs", has ? "" : "text-muted-foreground")}>{fmtTokens(r?.tokens)}</span>
                      <span className="inline-flex items-center gap-1">
                        <Input inputMode="decimal" className="h-7 w-20 font-mono text-xs" value={buyAmt[w.publicKey] ?? chain.defaultBuy} onChange={(e) => setBuyAmt((s) => ({ ...s, [w.publicKey]: e.target.value }))} aria-label={`${w.label} buy amount`} />
                        <BuyBtn disabled={!!busy} onClick={() => void buy(w.publicKey, buyAmt[w.publicKey] ?? chain.defaultBuy)}>{busy === `buy:${w.publicKey}` ? "…" : "Buy"}</BuyBtn>
                      </span>
                      <span className="inline-flex gap-1">
                        {[25, 50, 100].map((p) => <SellBtn key={p} hot={p === 100} disabled={!!busy || !has} title={has ? `Sell ${p}% of this wallet's tokens now` : "holds none"} onClick={() => void sell(w.publicKey, p)}>{busy === `sell:${w.publicKey}:${p}` ? "…" : `${p}%`}</SellBtn>)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            {timers.length > 0 ? (
              <div className="flex flex-col gap-1 text-sm">
                <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">{DEMO ? "Sells set for later (keep this tab open)" : "Sells set for later (a server restart forgets them)"}</span><button type="button" className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline" onClick={() => void del("/api/trading/timers").then(loadTimers)}>clear finished</button></div>
                {timers.map((t) => (
                  <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-1.5">
                    <Pill tone={t.status === "done" ? "ok" : t.status === "error" ? "error" : t.status === "pending" ? "warn" : "muted"}>{t.status}</Pill>
                    <span>sell {t.percent}% from {t.publicKeys.length} wallet{t.publicKeys.length === 1 ? "" : "s"}</span>
                    {t.status === "pending" ? <Mono className="text-xs">in {countdown(t.dueAt - now)}</Mono> : null}
                    {t.error ? <span className="text-destructive text-xs">{t.error}</span> : null}
                    {t.result ? <span className="text-muted-foreground text-xs">{t.result.filter((r) => txOf(r)).length} sold · {t.result.filter((r) => r.error).length} failed{t.result.filter((r) => r.error).map((r) => ` · ${chain.short(r.publicKey)}: ${r.error}`).join("")}</span> : null}
                    {t.status === "pending" ? <Button size="xs" variant="ghost" className="ml-auto" onClick={() => void cancelTimer(t.id)} disabled={!!busy}>cancel</Button> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* right column */}
          <div className="flex flex-col gap-3">
            {chain.features.creatorFees ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <span className="text-muted-foreground">Creator fees</span>
                <span className="font-mono text-xs">{fees ? `${fees.sol.toFixed(4)} ${chain.symbol} unclaimed · ${chain.short(fees.creator)}` : "no creator known for this coin"}</span>
                <Button size="xs" variant="outline" className="ml-auto" onClick={claim} disabled={!fees || fees.sol <= 0 || !!busy}>{busy === "claim" ? "Claiming…" : "Claim"}</Button>
              </div>
            ) : null}
            <div className="flex flex-col gap-1 rounded-lg border p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Live trades</span>
                <span className="text-muted-foreground text-xs">{feed === "connecting" ? "connecting…" : trades.length === 0 ? "no trades yet" : `${trades.length} trade${trades.length === 1 ? "" : "s"}`}</span>
              </div>
              <div className="flex max-h-[32rem] flex-col gap-0.5 overflow-y-auto text-xs">
                {feed === "live" && trades.length === 0 ? <span className="text-muted-foreground py-2">Listening. Trades on this coin show up here as they land.</span> : null}
                {trades.map((t) => {
                  const id = txOf(t) ?? `${t.trader}-${t.timestamp}`
                  return (
                    <div key={id} className={`flex items-center gap-2 rounded px-1.5 py-1 ${t.ours ? "bg-muted" : ""}`}>
                      <span className={`w-7 ${t.type === "buy" ? "text-ok" : "text-destructive"}`}>{t.type}</span>
                      <span className="w-20 font-mono">{nativeOf(t).toFixed(4)}</span>
                      {txOf(t) ? <a className="font-mono underline-offset-4 hover:underline" href={chain.explorerTx(txOf(t)!)} target="_blank" rel="noreferrer">{chain.short(t.trader)}</a> : <span className="font-mono">{chain.short(t.trader)}</span>}
                      {t.ours ? <Pill className="h-5">{t.ours.split(" · ")[0]}</Pill> : null}
                      <span className="text-muted-foreground ml-auto">{ago(t.timestamp)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
