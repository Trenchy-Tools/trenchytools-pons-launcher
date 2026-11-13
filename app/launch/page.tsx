"use client"

/**
 * Launch, top to bottom like a form:
 *
 *   1. DEV WALLET card: the wallet that creates the coin and pays (create / import / switch it right here)
 *   2. Coin: image, name, symbol, description, links
 *   3. Buys: dev buy · how many buyer wallets · one amount each (per-wallet amounts only if you ask for them)
 *   4. [Launch · total] — the image goes to IPFS, new buyer wallets are made and funded, the coin is created, and the
 *      Trading page opens on it the moment it is live
 *
 * Everything else (pair, Mayhem, holder rewards, creator fee, vanity mint, slippage, Jito) sits under Advanced.
 */
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ImagePlus, SlidersHorizontal, Sparkles } from "lucide-react"
import { ApiCalls, type ApiCall } from "@/components/api-calls"
import { DevWalletCard } from "@/components/dev-wallet-card"
import { FailureBox } from "@/components/failure"
import { Button } from "@/components/ui/button"
import { BrandIcon } from "@/components/ui/brand"
import { ask } from "@/components/ui/confirm"
import { toast } from "@/components/ui/toast"
import { AiCoinDialog, type AiPick } from "@/components/ai-coin-dialog"
import { Card } from "@/components/ui/card"
import { Field, Input, Select, Textarea } from "@/components/ui/input"
import { Pill } from "@/components/ui/pill"
import { Mono } from "@/components/ui/table"
import { Toggle } from "@/components/ui/toggle"
import { failureOf, get, post, subscribe, walletsChanged, type Failure } from "@/lib/api"
import { DEMO, TAB_NOTE } from "@/lib/browser/demo"
import { chain } from "@/lib/chain"
import { padBody, padById, padDefaults, padFeatures } from "@/lib/launchpad"
import { cn } from "@/lib/cn"
import { APP_NAME, launchWalletLabel } from "@/lib/core/wallet-record"
import { Q, type HelpKey } from "@/lib/help"
import { Appear, Nudge } from "@/components/ui/motion"

type Wallet = { publicKey: string; label: string; role: string }
type PlanRow = { role: string; label: string; publicKey: string | null; buy: number; needSol: number; needQuote?: number; haveQuote?: number; sendQuote?: number }
type Shortfall = { role: string; label: string; publicKey: string | null; send: number; symbol: string }
type Plan = { rows: PlanRow[]; total: number; tipSol: number; useLut: boolean; quote: { symbol: string }; custom: boolean; mayhem: boolean; holderReward: boolean; creatorFeeBps: number; totalQuote: number; shortfalls: Shortfall[]; refusal: Failure | null; ok: boolean }
type Pair = { mint: string; symbol: string; name?: string | null; decimals: number; source: "sol" | "global" | "quoteControl" | "pumpCoin"; kind: "sol" | "stable" | "stock" | "crypto" | "pump" }
type PoolView = { available: number; used: number }
type Job = { status: "idle" | "running" | "done" | "failed"; attempts: number; expectedAttempts: number; rate: number; found: string | null; error: string | null }
/** One line of the launch log: `signature` + `mint` on Solana, `hash` + `token` on EVM chains. */
type Event = { at: number; stage: string; message: string; signature?: string; hash?: string; mint?: string; token?: string; link?: string }
type Simulate = { ok: boolean; checks: Array<{ name: string; ok: boolean; detail: string }>; simulation: { ok: boolean; logs?: string[] } | null; calls?: ApiCall[] }
/** What POST /api/ipfs gave back: the metadata URI (pump.fun creates) and the image link (EVM creates take metadata.image). */
type Meta = { metadataUri: string; image: string }
/** One buyer row: a wallet of the folder, or null = a new wallet made at launch; the amount as typed. */
type Row = { publicKey: string | null; amount: string }

/** The colour of a launch-log line: errors red, warnings yellow, live / done green. */
const stageTone = (s: string) => (s === "error" ? "text-destructive" : s === "warning" ? "text-warn" : s === "live" || s === "done" ? "text-ok" : "")

// ── the last launch's settings, kept in this browser (no keys: buyer rows keep only their amounts) ──
const LAST_KEY = `${APP_NAME}.lastLaunch`
type SavedLaunch = {
  v: 1; savedAt: string
  f: Record<string, string>; image?: { name: string; type: string; dataUrl: string }
  devMode: "main" | "pick" | "new"; devPick: string
  perWallet: boolean; bundleEach: string; bundle: string[]; perWalletH: boolean; holdersEach: string; holders: string[]; snipers: string[]
  amountMode: "same" | "random"; range: { from: string; to: string }
  quoteMint: string; mayhem: boolean; holderReward: boolean; useJito: boolean; fundFirst: boolean; speed: "normal" | "fast" | "turbo"
  gap: { from: string; to: string }; maxOutside: string
  autoOn: boolean; auto: Record<string, string>; claimOn: boolean; claimWhen: "sold" | "after"; claimMin: string
  volOn: boolean; vol: { count: number; budget: string; pace: "light" | "normal" | "heavy"; minutes: string; size?: "calm" | "normal" | "wild" }
  /** the launchpad and its settings (absent on launches saved before there was a choice) */
  padId?: string; padVals?: Record<string, string | boolean>
}
const readLast = (): SavedLaunch | null => { try { const r = JSON.parse(window.localStorage.getItem(LAST_KEY) ?? "null"); return r?.v === 1 ? r : null } catch { return null } }
/** The image as a data URL (kept only when small enough for browser storage). */
const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(file) })
const dataUrlToFile = (d: { name: string; type: string; dataUrl: string }) => {
  const bin = atob(d.dataUrl.split(",")[1] ?? "")
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], d.name, { type: d.type })
}

const SOL_PAIR: Pair = { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Solana", decimals: 9, source: "sol", kind: "sol" }
const PAIR_GROUPS: Array<{ kind: Pair["kind"]; title: string }> = [{ kind: "stable", title: "Stablecoins" }, { kind: "stock", title: "Tokenized stocks (xStocks)" }, { kind: "crypto", title: "Crypto" }, { kind: "pump", title: "pump.fun coins" }]
const BUNDLE_COUNTS = [0, 1, 2, 3, 4, 6, 8, 12, 16].filter((c) => c <= chain.maxBundle)
const HOLDER_COUNTS = [0, 1, 2, 3, 4, 5, 6, 8, 10]
const DEV_CHIPS = chain.devBuyChips
const ALL_CHIPS = chain.buyChips

const n = (v: string, d = 0) => (v.trim() === "" || Number.isNaN(Number(v)) ? d : Number(v))
const resize = (rows: Row[], count: number, fill: string): Row[] => Array.from({ length: count }, (_, i) => rows[i] ?? { publicKey: null, amount: fill })
const fmt = (x: number) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${(x / 1e3).toFixed(1)}K` : String(x))

/** A small round choice button, the bundler's "chip". */
function Chip({ active, className = "", ...props }: React.ComponentProps<"button"> & { active?: boolean }) {
  return <button type="button" className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full border px-2.5 font-mono text-xs transition-colors disabled:opacity-50 ${active ? "bg-foreground text-background border-foreground" : "hover:bg-accent"} ${className}`} {...props} />
}

/** What every wallet carries on top of its buy (lib/core/launch.ts): the API fee on the buy, and a gas buffer. */
const API_FEE_RATE = chain.apiFeeRate
/** native amounts: the cost lines, and a shorter form for the button and the random amounts */
const DEC = chain.decimals
const DEC_SHORT = chain.decimals - 1
const GAS_BUFFER = chain.gasBuffer

/** One part of the cost: a label, an optional note under it, the amount (muted = fees and buffers). */
function CostLine({ label, value, note, muted }: { label: string; value: number; note?: string; muted?: boolean }) {
  return (
    <div className="flex flex-col">
      <div className={`flex items-baseline justify-between gap-2 ${muted ? "text-muted-foreground" : ""}`}>
        <span>{label}</span>
        <Mono><Nudge value={value.toFixed(DEC)}>{value.toFixed(DEC)}</Nudge></Mono>
      </div>
      {note ? <span className="text-muted-foreground text-[11px] leading-snug">{note}</span> : null}
    </div>
  )
}

/**
 * A link as people type it → a full https URL. X: "@coin", "coin", "x.com/coin", "twitter.com/coin" → https://x.com/coin.
 * Telegram: "@coin", "coin", "t.me/coin", "telegram.me/coin" → https://t.me/coin. Website: "coin.com" → https://coin.com.
 * http:// becomes https://; spaces go; empty stays empty.
 */
function normalizeLink(kind: "twitter" | "telegram" | "website", raw: string): string {
  let v = raw.trim().replace(/\s+/g, "")
  if (!v) return ""
  v = v.replace(/^http:\/\//i, "https://")
  const bare = v.replace(/^https:\/\//i, "").replace(/^www\./i, "")
  if (kind === "twitter") {
    const m = bare.match(/^(?:x\.com|twitter\.com|mobile\.twitter\.com)\/(.+)$/i)
    if (m) return `https://x.com/${m[1]}`
    if (/^@?[A-Za-z0-9_]{1,15}$/.test(bare)) return `https://x.com/${bare.replace(/^@/, "")}`
  }
  if (kind === "telegram") {
    const m = bare.match(/^(?:t\.me|telegram\.me|telegram\.dog)\/(.+)$/i)
    if (m) return `https://t.me/${m[1]}`
    if (/^@?[A-Za-z0-9_]{4,32}$/.test(bare)) return `https://t.me/${bare.replace(/^@/, "")}`
  }
  return /^https:\/\//i.test(v) ? v : `https://${bare}`
}

/** One setting on one line: a short label on the left, the controls after it. `wide` = the card's main labels' width. */
function Line({ label, wide, help, alert, children }: { label: string; wide?: boolean; help?: HelpKey; alert?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`${wide ? "font-medium sm:w-40" : "text-muted-foreground sm:w-32"} ${label || help ? "inline-flex" : "hidden sm:inline-flex"} w-full shrink-0 items-center gap-1.5 text-sm`}>{label}{help ? <Q k={help} alert={alert} /> : null}</span>
      {children}
    </div>
  )
}

export default function LaunchPage() {
  const router = useRouter()
  const [f, setF] = React.useState({ name: "", symbol: "", description: "", twitter: "", telegram: "", website: "", devBuySol: chain.defaultDevBuy, slippage: "15", creatorFeeBps: "", sniperGapMs: "400", holderDelayS: "10", holderWindowS: "60" })
  const [image, setImage] = React.useState<File | null>(null)
  const [preview, setPreview] = React.useState("")
  const [dragOver, setDragOver] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)
  // the wallets
  const [wallets, setWallets] = React.useState<Wallet[]>([])
  const [balances, setBalances] = React.useState<Map<string, number>>(new Map())
  const [main, setMain] = React.useState<string | null>(null)
  /** The dev wallet is the one on the card at the top; the form never overrides it. */
  const [devMode, setDevMode] = React.useState<"main" | "pick" | "new">("main")
  const [devPick, setDevPick] = React.useState("")
  /** volume wallets made by a launch attempt: a retry with the same count reuses them */
  const volMade = React.useRef<string[]>([])
  const devWallet = devMode === "pick" ? devPick : ""
  /** How the page names the coin's creator: the main wallet, or a separate dev wallet. */
  const devName = devMode === "main" ? "main wallet" : "dev wallet"
  const [perWallet, setPerWallet] = React.useState(false)
  const [bundleEach, setBundleEach] = React.useState(chain.buyChips[1])
  const [bundle, setBundle] = React.useState<Row[]>([])
  const [holders, setHolders] = React.useState<Row[]>([])
  const [snipers, setSnipers] = React.useState<Row[]>([])
  // mint
  const [mintMode, setMintMode] = React.useState<"random" | "vanity">("random")
  const [pool, setPool] = React.useState<PoolView>({ available: 0, used: 0 })
  const [job, setJob] = React.useState<Job | null>(null)
  // advanced
  const [advanced, setAdvanced] = React.useState(false)
  const [pairs, setPairs] = React.useState<Pair[]>([SOL_PAIR])
  const [quoteMint, setQuoteMint] = React.useState(SOL_PAIR.mint)
  const [mayhem, setMayhem] = React.useState(false)
  const [holderReward, setHolderReward] = React.useState(false)
  const [useJito, setUseJito] = React.useState(padFeatures(chain.launchpads[0]).sameBlock)
  const [fundFirst, setFundFirst] = React.useState(true)
  // speed, bundle extras, after the launch
  const [speed, setSpeed] = React.useState<"normal" | "fast" | "turbo">("normal")
  const [amountMode, setAmountMode] = React.useState<"same" | "random">("same")
  const [range, setRange] = React.useState({ from: chain.buyChips[0], to: String(+(Number(chain.buyChips[0]) * 3).toPrecision(3)) })
  const [gap, setGap] = React.useState({ from: "300", to: "1200" })
  const [maxOutside, setMaxOutside] = React.useState("")
  const [autoOn, setAutoOn] = React.useState(false)
  const [auto, setAuto] = React.useState({ netIn: "1", afterMin: "10", bundle: "all" as "all" | "spread", spreadSec: "20", main: "with" as "with" | "later" | "own" | "keep", mainLaterSec: "30", mainNetIn: "3", mainAfterMin: "30" })
  const [claimOn, setClaimOn] = React.useState(false)
  const [claimWhen, setClaimWhen] = React.useState<"sold" | "after">("sold")
  const [claimMin, setClaimMin] = React.useState("30")
  const [holdersEach, setHoldersEach] = React.useState(chain.buyChips[1])
  const [perWalletH, setPerWalletH] = React.useState(false)
  const [volOn, setVolOn] = React.useState(false)
  const [last, setLast] = React.useState<SavedLaunch | null>(null)
  const [aiOpen, setAiOpen] = React.useState(false)
  /** what the AI made, into the form: name, ticker, description and the logo as if it had been picked */
  const applyAi = (p: AiPick) => {
    setF((cur) => ({ ...cur, name: p.name.slice(0, 32), symbol: p.symbol.slice(0, 10), description: p.description }))
    setImage(p.file)
    toast({ tone: "ok", title: `${p.name} (${p.symbol}) is in the form`, detail: "Change anything you like, then launch." })
  }
  React.useEffect(() => { setLast(readLast()) }, [])
  const [vol, setVol] = React.useState({ count: 5, budget: chain.defaultVolumeBudget, pace: "normal" as "light" | "normal" | "heavy", minutes: "10", size: "normal" as "calm" | "normal" | "wild" })
  // plan, simulation, the run
  const [plan, setPlan] = React.useState<Plan | null>(null)
  const [sim, setSim] = React.useState<Simulate | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [failure, setFailure] = React.useState<Failure | null>(null)
  const [events, setEvents] = React.useState<Event[]>([])
  const [launchId, setLaunchId] = React.useState<string | null>(null)
  const [done, setDone] = React.useState<"live" | "error" | null>(null)
  const logRef = React.useRef<HTMLDivElement>(null)

  // the launchpad: which one, its settings, and the chain's switches as it changes them
  const [padId, setPadId] = React.useState(chain.launchpads[0].id)
  const [padVals, setPadVals] = React.useState<Record<string, string | boolean>>(() => padDefaults(chain.launchpads[0]))
  const pad = padById(padId)
  const feat = padFeatures(pad)
  const hasCoinOptions = feat.pairs || !!feat.vanitySuffix || feat.mayhem || feat.holderRewards
  /** Another launchpad: its default settings, and every option it does not have switched off. */
  const pickPad = (id: string, vals?: Record<string, string | boolean>) => {
    const p = padById(id)
    if (p.disabled) return
    const pf = padFeatures(p)
    setPadId(p.id); setPadVals({ ...padDefaults(p), ...(vals ?? {}) })
    setUseJito(pf.sameBlock)
    if (!pf.vanitySuffix) setMintMode("random")
    if (!pf.mayhem) setMayhem(false)
    if (!pf.holderRewards) setHolderReward(false)
    if (!pf.pairs) setQuoteMint(SOL_PAIR.mint)
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }))
  const pair = pairs.find((p) => p.mint === quoteMint) ?? SOL_PAIR
  const custom = pair.source !== "sol"
  /** what the coin is bought in: the chosen pair where the chain has pairs, else the native coin */
  const sym = feat.pairs ? pair.symbol : chain.symbol
  const mayhemAllowed = pair.source === "sol" || pair.source === "global"
  const feeAllowed = pair.source === "quoteControl" || pair.source === "pumpCoin"
  const dev = devWallet || main
  const mainBalance = main ? balances.get(main) : undefined
  const launching = launchId !== null && done === null

  /** The form the routes take (lib/core/form.ts). `publicKey: null` rows are new wallets; the launch resolves them first. */
  const form = (meta: Meta = { metadataUri: "", image: "" }, rows: { bundle: Row[]; snipers: Row[]; holders: Row[]; volume?: string[]; dev?: string } = { bundle, snipers, holders }) => ({
    name: f.name, symbol: f.symbol, description: f.description, twitter: normalizeLink("twitter", f.twitter), telegram: normalizeLink("telegram", f.telegram), website: normalizeLink("website", f.website), metadataUri: meta.metadataUri, image: meta.image,
    mint: { mode: feat.vanitySuffix ? mintMode : "random" },
    quoteMint: custom && feat.pairs ? pair.mint : "SOL", mayhemMode: mayhem && mayhemAllowed && feat.mayhem, holderReward: holderReward && feat.holderRewards, creatorFeeBps: feeAllowed && feat.pairs ? n(f.creatorFeeBps) : 0,
    // the launchpad: its id and the create-body fields it takes (venue, platform, taxes, fees)
    launchpad: pad.id, venueOptions: padBody(pad, padVals),
    devWallet: rows.dev || devWallet || undefined, devFresh: devMode === "new" && !rows.dev, devBuySol: n(f.devBuySol),
    bundle: { wallets: rows.bundle.map((r) => ({ publicKey: r.publicKey, amount: n(r.amount) })) },
    snipers: { wallets: rows.snipers.map((r) => ({ publicKey: r.publicKey, amount: n(r.amount) })), gapMs: n(f.sniperGapMs, 400) },
    holders: { wallets: rows.holders.map((r) => ({ publicKey: r.publicKey, amount: n(r.amount) })), delayS: n(f.holderDelayS, 10), windowS: n(f.holderWindowS, 60) },
    fundFirst, useJito: useJito && feat.sameBlock, slippage: n(f.slippage, 15),
    speed,
    bundleGap: useJito ? undefined : { fromMs: n(gap.from), toMs: n(gap.to) },
    bundleMaxOutside: useJito ? 0 : n(maxOutside),
    autoSell: autoOn ? { netIn: n(auto.netIn), afterMin: n(auto.afterMin), bundle: auto.bundle, spreadSec: n(auto.spreadSec, 20), main: auto.main, mainLaterSec: n(auto.mainLaterSec, 30), mainNetIn: n(auto.mainNetIn), mainAfterMin: n(auto.mainAfterMin) } : undefined,
    claim: claimOn ? { when: claimWhen, afterMin: n(claimMin, 30) } : undefined,
    volume: volOn ? { count: vol.count, wallets: rows.volume ?? [], budget: n(vol.budget), pace: vol.pace, minutes: n(vol.minutes, 10), size: vol.size } : undefined,
  })
  /** "Random" amounts: every buyer row gets its own amount between the two numbers (3 decimals). */
  const randomize = (rows: Row[]) => {
    const lo = n(range.from), hi = Math.max(lo, n(range.to))
    return rows.map((r) => ({ ...r, amount: String(+(lo + Math.random() * (hi - lo)).toFixed(DEC_SHORT)) }))
  }

  // ── data ──────────────────────────────────────────────────────────────────
  const loadWallets = React.useCallback(async () => {
    const r = await get<{ wallets: Wallet[]; mainWallet: string | null }>("/api/wallets")
    setWallets(r.wallets); setMain(r.mainWallet)
    if (r.wallets.length) get<{ rows: Array<{ publicKey: string; native: number }> }>("/api/wallets/balances").then((b) => setBalances(new Map(b.rows.map((x) => [x.publicKey, x.native])))).catch(() => {})
  }, [])
  const loadPool = React.useCallback(() => get<PoolView>("/api/vanity/pool").then((p) => setPool({ available: p.available, used: p.used })).catch(() => {}), [])
  React.useEffect(() => {
    void loadWallets().catch(() => {})
    if (chain.vanitySuffix) { void loadPool(); get<Job>("/api/vanity/status").then(setJob).catch(() => {}) }
    if (chain.features.pairs) get<{ pairs: Pair[] }>("/api/launch/pairs").then((r) => setPairs(r.pairs.some((p) => p.source === "sol") ? r.pairs : [SOL_PAIR, ...r.pairs])).catch(() => {})
  }, [loadWallets, loadPool])
  React.useEffect(() => { const t = setInterval(() => void loadWallets().catch(() => {}), 20_000); return () => clearInterval(t) }, [loadWallets])

  // the image preview
  React.useEffect(() => {
    if (!image) { setPreview(""); return }
    const url = URL.createObjectURL(image)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [image])

  // the cost, recomputed as the numbers change (the plan does not need the image)
  // "Random" amounts follow the range and the number of buyers
  React.useEffect(() => {
    if (amountMode === "random" && !perWallet) setBundle((b) => randomize(b))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountMode, perWallet, range.from, range.to, bundle.length])
  const planKey = JSON.stringify([padId, padVals, devMode, volOn && vol, speed, f.devBuySol, devWallet, bundle, snipers, holders, useJito, f.slippage, quoteMint, mayhem && mayhemAllowed, holderReward, feeAllowed ? f.creatorFeeBps : ""])
  React.useEffect(() => {
    const t = setTimeout(() => { post<Plan>("/api/launch/plan", form()).then(setPlan).catch(() => {}) }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey])

  // vanity grinding: follow the API job
  React.useEffect(() => {
    if (job?.status !== "running") return
    const t = setInterval(async () => {
      const j = await get<Job>("/api/vanity/status").catch(() => null)
      if (!j) return
      setJob(j)
      if (j.status !== "running") void loadPool()
    }, 2000)
    return () => clearInterval(t)
  }, [job?.status, loadPool])

  // the launch log, then the Trading page the moment the coin is live
  React.useEffect(() => {
    if (!launchId) return
    return subscribe<Event>(`/api/launch/${launchId}/events`, (e) => {
      setEvents((xs) => [...xs, e])
      if (e.stage === "error") setDone("error")
      const coin = e.mint ?? e.token
      if (e.stage === "live" && coin) {
        setDone("live")
        setTimeout(() => router.push(`/trading?${chain.coinParam}=${encodeURIComponent(coin)}&launch=${encodeURIComponent(launchId)}`), 900)
      }
    })
  }, [launchId, router])
  React.useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [events])
  // the log's elapsed seconds tick while a launch runs
  const [, setTick] = React.useState(0)
  React.useEffect(() => { if (!launchId || done) return; const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t) }, [launchId, done])

  // ── actions ───────────────────────────────────────────────────────────────
  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name); setFailure(null)
    try { await fn() } catch (e) { setFailure(failureOf(e)) } finally { setBusy(null) }
  }
  const note = (stage: string, message: string) => setEvents((xs) => [...xs, { at: Date.now(), stage, message }])

  /** Image + details → IPFS, as part of Launch (and Simulate, so the simulated create carries the real metadata). */
  const uploadMetadata = async (): Promise<Meta> => {
    if (!image) throw { error: "Pick an image first" }
    const fd = new FormData()
    fd.append("file", image)
    fd.append("name", f.name); fd.append("symbol", f.symbol); fd.append("description", f.description)
    for (const k of ["twitter", "telegram", "website"] as const) { const link = normalizeLink(k, f[k]); if (link) fd.append(k, link) }
    const res = await fetchApp("/api/ipfs", fd)
    return { metadataUri: res.metadataUri, image: res.metadata?.image ?? "" }
  }
  /** Every "new wallet" row becomes a real wallet (POST /api/wallets); in demo mode the keys are downloaded right away so the launch may use them. */
  const resolveRows = async (): Promise<{ bundle: Row[]; snipers: Row[]; holders: Row[]; volume: string[]; dev?: string }> => {
    const out: { bundle: Row[]; snipers: Row[]; holders: Row[]; volume: string[]; dev?: string } = { bundle: [...bundle], snipers: [...snipers], holders: [...holders], volume: [] }
    let made = 0
    try {
    if (devMode === "new") {
      const r = await post<{ wallets: Array<{ publicKey: string }> }>("/api/wallets", { count: 1, role: "trader", label: launchWalletLabel(f.symbol, "dev") })
      out.dev = r.wallets[0].publicKey
      made += 1
    }
    if (volOn && vol.count > 0) {
      if (volMade.current.length === vol.count) out.volume = [...volMade.current]
      else {
        const r = await post<{ wallets: Array<{ publicKey: string }> }>("/api/wallets", { count: vol.count, role: "trader", label: launchWalletLabel(f.symbol, "volume") })
        out.volume = r.wallets.map((w) => w.publicKey)
        volMade.current = [...out.volume]
        made += r.wallets.length
      }
    }
    for (const [key, role] of [["bundle", "bundle"], ["snipers", "sniper"], ["holders", "holder"]] as const) {
      const rows = out[key]
      const missing = rows.filter((r) => !r.publicKey).length
      if (!missing) continue
      const r = await post<{ dir: string; wallets: Array<{ publicKey: string; label: string }> }>("/api/wallets", { count: missing, role, label: launchWalletLabel(f.symbol, role) })
      const fresh = [...r.wallets]
      out[key] = rows.map((row) => (row.publicKey ? row : { ...row, publicKey: fresh.shift()!.publicKey }))
      made += r.wallets.length
    }
    } finally {
      // whatever happened above, every wallet made so far gets its key file now, and stays on its row: a retry reuses
      // it instead of making another one (an interrupted launch used to leave new wallets un-backed-up)
      if (made) {
        note("wallets", `${made} new wallet${made === 1 ? "" : "s"} created${DEMO ? "" : " and written to the folder"}`)
        if (DEMO) { const b = await post<{ count: number; files: string[] }>("/api/wallets/backup"); note("wallets", `Backup downloaded (${b.files.join(", ")}): the new keys are now usable`) }
        walletsChanged()
        void loadWallets().catch(() => {})
        setBundle(out.bundle); setSnipers(out.snipers); setHolders(out.holders)
        if (out.dev) { setDevMode("pick"); setDevPick(out.dev) }
      }
    }
    return out
  }

  /** The trenchy.tools coin with our logo and links, and the default launch numbers: one click to a complete form. */
  /** Everything on this form, saved when a launch starts (buyer rows as amounts only). */
  const saveLast = async () => {
    const amounts = (rows: Row[]) => rows.map((r) => r.amount)
    let img: SavedLaunch["image"]
    if (image && image.size < 1_500_000) img = { name: image.name, type: image.type, dataUrl: await fileToDataUrl(image).catch(() => "") }
    const saved: SavedLaunch = {
      v: 1, savedAt: new Date().toISOString(), f: { ...f }, image: img?.dataUrl ? img : undefined,
      devMode, devPick, perWallet, bundleEach, bundle: amounts(bundle), perWalletH, holdersEach, holders: amounts(holders), snipers: amounts(snipers),
      amountMode, range, quoteMint, mayhem, holderReward, useJito, fundFirst, speed, gap, maxOutside,
      autoOn, auto: { ...auto }, claimOn, claimWhen, claimMin, volOn, vol, padId, padVals,
    }
    try { window.localStorage.setItem(LAST_KEY, JSON.stringify(saved)) } catch {
      try { window.localStorage.setItem(LAST_KEY, JSON.stringify({ ...saved, image: undefined })) } catch { /* storage full: nothing saved */ }
    }
    setLast(readLast())
  }
  /** "Load last launch": the whole form as it was, buyer rows as new wallets with the same amounts. */
  const loadLast = () => {
    const l = readLast()
    if (!l) return
    const rows = (xs: string[]): Row[] => xs.map((amount) => ({ publicKey: null, amount }))
    setF((cur) => ({ ...cur, ...l.f }))
    if (l.image) { try { setImage(dataUrlToFile(l.image)) } catch { /* a broken image: pick it again */ } }
    const pickOk = l.devMode === "pick" && wallets.some((w) => w.publicKey === l.devPick)
    setDevMode(l.devMode === "pick" && !pickOk ? "main" : l.devMode); setDevPick(pickOk ? l.devPick : "")
    setPerWallet(l.perWallet); setBundleEach(l.bundleEach); setBundle(rows(l.bundle))
    setPerWalletH(l.perWalletH); setHoldersEach(l.holdersEach); setHolders(rows(l.holders)); setSnipers(rows(l.snipers))
    setAmountMode(l.amountMode); setRange(l.range)
    setQuoteMint(l.quoteMint); setMayhem(l.mayhem); setHolderReward(l.holderReward); setUseJito(l.useJito && padFeatures(padById(l.padId)).sameBlock); setFundFirst(l.fundFirst); setSpeed(l.speed)
    setGap(l.gap); setMaxOutside(l.maxOutside)
    setAutoOn(l.autoOn); setAuto((cur) => ({ ...cur, ...l.auto } as typeof cur)); setClaimOn(l.claimOn); setClaimWhen(l.claimWhen); setClaimMin(l.claimMin)
    setVolOn(l.volOn); setVol({ ...l.vol, size: l.vol.size ?? "normal" })
    setMintMode("random")
    if (l.padId && !padById(l.padId).disabled) pickPad(l.padId, l.padVals)
    toast({ tone: "ok", title: `Loaded the settings of ${l.f.name || "your last launch"}${l.f.symbol ? ` (${l.f.symbol})` : ""}`, detail: `Buyers come back as new wallets with the same amounts. Change the name and symbol for a new coin.${l.image ? "" : " Add the image again."}` })
  }
  const autofill = () => run("autofill", async () => {
    const blob = await fetch("/demo-logo.png").then((r) => r.blob())
    setImage(new File([blob], "trenchy-tools.png", { type: "image/png" }))
    setF((s) => ({ ...s, name: "trenchy.tools", symbol: "TRENCHY", description: "The easiest API to launch and trade with. One key, every launchpad, unsigned transactions you sign yourself.", twitter: "https://x.com/trenchytools", telegram: "https://t.me/trenchytools", website: "https://trenchy.tools", devBuySol: chain.defaultDevBuy }))
    setBundle([]); setBundleEach(chain.buyChips[0]); setPerWallet(false); setHolders([]); setSnipers([]); setMintMode("random"); setQuoteMint(SOL_PAIR.mint); setMayhem(false); setHolderReward(false)
  })

  const simulate = () => run("simulate", async () => {
    setSim(null)
    const meta = image ? await uploadMetadata().catch(() => undefined) : undefined
    setSim(await post<Simulate>("/api/launch/simulate", form(meta)))
  })
  const grind = () => run("grind", async () => setJob(await post<Job>("/api/vanity/start", { suffix: "pump", caseSensitive: true })))

  const buyers = bundle.length + snipers.length + holders.length
  const ready = !!f.name && !!f.symbol && !!image
  /** The cost card's parts: buys, volume budget, API fee, gas buffer, tip, table rent; and whether the main wallet has enough. */
  const cost = plan ? (() => {
    const tip = useJito ? plan.tipSol : 0
    const lut = plan.useLut ? 0.02 : 0
    let buys = 0, volume = 0, fee = 0, buffer = 0, wallets = 0, buyers = 0
    for (const r of plan.rows) {
      const extra = r.role === "dev" ? tip + lut + feat.createCost : 0
      const base = r.needSol - extra
      wallets++
      if (r.role === "trader") { volume += Math.max(0, base - GAS_BUFFER); buffer += Math.min(base, GAS_BUFFER); continue }
      if (r.role !== "dev") buyers++
      const buy = plan.custom ? 0 : r.buy
      const f = plan.custom ? Math.max(0, base - GAS_BUFFER) : r.buy * API_FEE_RATE
      buys += buy; fee += f; buffer += Math.max(0, base - buy - f)
    }
    const have = mainBalance
    const state: "short" | "ok" | "unknown" = have === undefined ? "unknown" : have < plan.total ? "short" : "ok"
    const create = plan.rows.some((r) => r.role === "dev") ? feat.createCost : 0
    return { buys, volume, fee, buffer, tip, lut, create, wallets, buyers, state, missing: have === undefined ? 0 : plan.total - have, left: have === undefined ? 0 : have - plan.total }
  })() : null
  const short = fundFirst && plan !== null && mainBalance !== undefined && mainBalance < plan.total
  /** What pressing Launch does, in order, in plain words (shown above the button and in the confirm dialog). */
  const steps: string[] = (() => {
    const out: string[] = ["Your image and details are uploaded."]
    const fresh = [...bundle, ...holders].filter((r) => !r.publicKey).length + (volOn ? vol.count : 0) + (devMode === "new" ? 1 : 0)
    if (fresh) out.push(`${fresh} new wallet${fresh === 1 ? " is" : "s are"} made and added to your Wallets list${DEMO ? " (their keys download as a file)" : ""}.`)
    if (fundFirst && (bundle.length || holders.length || volOn || devMode !== "main")) out.push(devMode !== "main" && !(bundle.length || holders.length || volOn) ? "Your main wallet sends the dev wallet what it needs." : "Your main wallet sends each of them what it needs.")
    out.push(`${f.symbol || "Your coin"} is created on ${pad.name} and your ${devName} buys ${n(f.devBuySol)} ${sym}${bundle.length ? (useJito ? `; ${bundle.length} bundle wallet${bundle.length === 1 ? "" : "s"} buy in the same block` : `; then ${bundle.length} first-buyer wallet${bundle.length === 1 ? "" : "s"} buy right after it, not in the same block`) : ""}.`)
    if (holders.length) out.push(`${holders.length} later buyer${holders.length === 1 ? "" : "s"} buy one by one over ${n(f.holderWindowS, 60)} s, starting ${n(f.holderDelayS, 10)} s after the launch.`)
    if (volOn) out.push(`The volume maker trades ${n(vol.budget)} ${chain.symbol} across ${vol.count} wallets for up to ${n(vol.minutes, 10)} min${vol.size === "wild" ? " in big runs of buys and sells" : vol.size === "calm" ? " in small trades" : ""}, and stops as soon as your ${devName} wallet has sold everything.`)
    if (autoOn) {
      const rule = (netIn: number, afterMin: number) => [netIn > 0 ? `outside buyers put in ${netIn} ${sym}` : "", afterMin > 0 ? `after ${afterMin} min` : ""].filter(Boolean).join(" or ")
      const when = rule(n(auto.netIn), n(auto.afterMin))
      const mainWhen = auto.main === "own" ? rule(n(auto.mainNetIn), n(auto.mainAfterMin)) : ""
      const mainPart = auto.main === "with" ? "sells with them" : auto.main === "later" ? `sells ${n(auto.mainLaterSec, 30)} s later` : auto.main === "own" ? (mainWhen ? `sells on its own when ${mainWhen}` : "never sells (set its amount or time)") : "keeps its coins"
      if (when) out.push(`Auto-sell sells every buyer wallet ${auto.bundle === "all" ? "at once" : `over ${n(auto.spreadSec, 20)} s`} when ${when}; the ${devName} ${mainPart}.`)
      else if (mainWhen) out.push(`Auto-sell: the ${devName} sells everything when ${mainWhen}; the buyer wallets keep their coins.`)
    }
    if (claimOn) out.push(claimWhen === "sold" ? "Once every one of your wallets has sold, the creator fees are claimed into your main wallet." : `${n(claimMin, 30)} min after the launch, the creator fees are claimed into your main wallet.`)
    out.push("The Trading page opens on your coin: buy or sell from any wallet there at any time.")
    return out
  })()
  const blocker = pad.disabled ? `${pad.name} cannot launch right now: pick another launchpad` : devMode === "pick" && !devPick ? "Pick the dev wallet (Who buys at launch)" : !main ? "Create the main wallet first (top of the page)" : !ready ? "Add an image, a name and a symbol" : plan && !plan.ok ? "Fix the cost card first" : short ? `Not enough ${chain.symbol}: send ${(plan!.total - mainBalance!).toFixed(DEC)} more` : null

  /** A launch is running or just ran: the log takes the top of the panel, the cost folds away. */
  const active = !!launchId || events.length > 0 || busy === "launch"
  const [startedAt, setStartedAt] = React.useState<number | null>(null)
  React.useEffect(() => { if (launchId && !startedAt) setStartedAt(Date.now()) }, [launchId, startedAt])
  /** back to the form: the log goes, the settings stay */
  const newLaunch = () => { setLaunchId(null); setEvents([]); setDone(null); setStartedAt(null); setFailure(null) }
  const launch = () => run("launch", async () => {
    if (blocker) throw { error: blocker }
    if (!await ask(`Launch ${f.name} (${f.symbol})?\n\n${steps.map((x, i) => `${i + 1}. ${x}`).join("\n")}\n\nAbout ${plan?.total.toFixed(DEC_SHORT) ?? "…"} ${chain.symbol} leaves your main wallet. This sends real transactions.`)) return
    setEvents([]); setDone(null); setSim(null)
    note("ipfs", "Uploading the image and details to IPFS…")
    const meta = await uploadMetadata()
    note("ipfs", `Metadata ready: ${meta.metadataUri}`)
    const rows = await resolveRows()
    const r = await post<{ id: string }>("/api/launch", form(meta, rows))
    volMade.current = []
    void saveLast()
    setLaunchId(r.id)
  })

  // ── pieces ────────────────────────────────────────────────────────────────
  const errors = events.filter((e) => e.stage === "error").length
  const warnings = events.filter((e) => e.stage === "warning").length
  const lastEvent = events[events.length - 1]
  const logCard = events.length || launchId ? (
    <Card className={cn("gap-2", done === "error" ? "border-destructive/50" : done === "live" ? "border-ok/50" : "border-warn/40")}>
      <div className="flex items-center gap-2">
        <h2 className={cn("text-[15px] font-semibold", done === "error" ? "text-destructive" : done === "live" ? "text-ok" : "")}>{done === "error" ? "Launch failed" : done === "live" ? "Live · opening Trading…" : "Launching…"}</h2>
        {!done ? <span className="bg-warn size-2 animate-pulse rounded-full" aria-hidden /> : null}
        <span className="text-muted-foreground ml-auto text-[11px]">{events.length} step{events.length === 1 ? "" : "s"}{warnings ? ` · ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}{errors ? ` · ${errors} error${errors === 1 ? "" : "s"}` : ""}{startedAt ? ` · ${Math.max(0, Math.round((Date.now() - startedAt) / 1000))}s` : ""}</span>
      </div>
      {lastEvent && !done ? <p className="bg-muted/50 rounded-md px-2 py-1.5 text-xs"><span className="text-muted-foreground">Now: </span>{lastEvent.message}</p> : null}
      <div ref={logRef} className="flex max-h-[min(55vh,32rem)] flex-col gap-1 overflow-y-auto rounded-md border p-2 text-xs">
        {events.map((e, i) => (
          <div key={i} className={cn("flex gap-2", stageTone(e.stage), (e.stage === "error" || e.stage === "warning") && "font-medium")}>
            <Mono className="text-muted-foreground w-16 shrink-0 text-[11px]">{e.stage}</Mono>
            <span className="min-w-0 break-words">{e.message}{e.signature ?? e.hash ? <> <a className="underline underline-offset-4" href={chain.explorerTx((e.signature ?? e.hash)!)} target="_blank" rel="noreferrer">tx</a></> : null}</span>
          </div>
        ))}
        {launching ? <span className="text-muted-foreground">…</span> : null}
      </div>
      {done ? (
        <div className="flex gap-2">
          {done === "error" ? <Button size="sm" onClick={newLaunch}>Try again</Button> : <Button size="sm" variant="outline" onClick={newLaunch}>New launch</Button>}
          <span className="text-muted-foreground self-center text-[11px]">{done === "error" ? "Your settings are kept; wallets already made are reused." : "The form keeps your settings."}</span>
        </div>
      ) : null}
    </Card>
  ) : null
  const taken = new Set([...(dev ? [dev] : []), ...[...bundle, ...snipers, ...holders].map((r) => r.publicKey).filter(Boolean)])
  const Rows = ({ rows, onChange, prefix }: { rows: Row[]; onChange: (rows: Row[]) => void; prefix: string }) => (
    <div className="flex flex-col gap-1.5">
      <p className="text-muted-foreground text-xs"><b className="text-foreground font-medium">New wallet</b> = made when you press Launch, funded by your main wallet, and added to your Wallets list. Or pick one of your wallets to use it instead.</p>
      {rows.length > 1 ? (
        <div className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs">set all to
          {ALL_CHIPS.map((v) => <Chip key={v} className="h-6" onClick={() => onChange(rows.map((r) => ({ ...r, amount: v })))}>{v}</Chip>)}
        </div>
      ) : null}
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-muted-foreground w-6 font-mono text-xs">{prefix}{i + 1}</span>
          <Input inputMode="decimal" className="h-8 w-24 font-mono text-xs" value={r.amount} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} aria-label={`${prefix}${i + 1} amount`} />
          <span className="text-muted-foreground text-xs">{sym}</span>
          <Select className="h-8 max-w-56 flex-1 text-xs" value={r.publicKey ?? ""} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, publicKey: e.target.value || null } : x)))} aria-label={`${prefix}${i + 1} wallet`}>
            <option value="">New wallet (funded by main)</option>
            {wallets.filter((w) => w.publicKey === r.publicKey || !taken.has(w.publicKey)).map((w) => <option key={w.publicKey} value={w.publicKey}>{w.label} · {chain.short(w.publicKey)} · {chain.fmt(balances.get(w.publicKey))} {chain.symbol}</option>)}
          </Select>
        </div>
      ))}
    </div>
  )

  return (
    <div className="grid gap-6 pb-28 lg:grid-cols-[1fr_360px] lg:pb-0">
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Launch a coin</h1>
          <p className="text-muted-foreground text-sm">Three steps: your main wallet, your coin, how many wallets buy it. Then press Launch.</p>
        </div>

        {/* ── 1. the main wallet ── */}
        <DevWalletCard need={plan?.ok ? plan.total : undefined} keyButton={false} onChanged={() => void loadWallets().catch(() => {})} />

        {/* ── 2. the coin ── */}
        <Card className="gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">Your coin <span className="text-muted-foreground inline-flex items-center gap-1 text-xs font-normal">· on <BrandIcon src={pad.logo} label={pad.name} size={13} />{pad.name}</span></h2>
            <span className="inline-flex items-center gap-1.5">
              <Button size="sm" onClick={() => setAiOpen(true)} disabled={!!busy || launching} className="bg-brand hover:bg-brand/90 text-background"><Sparkles className="size-3.5" />Create with AI</Button>
              <Button size="sm" variant="outline" onClick={loadLast} disabled={!last || !!busy || launching} title={last ? `${last.f.name || "Untitled"}${last.f.symbol ? ` (${last.f.symbol})` : ""} · launched ${new Date(last.savedAt).toLocaleString()}` : "No launch yet: the settings of your next launch are saved for this button"}>Load last launch</Button>
              <Button size="sm" variant="outline" onClick={() => void autofill()} disabled={!!busy || launching}>{busy === "autofill" ? "Filling…" : "Fill with an example"}</Button>
            </span>
          </div>
          {chain.launchpads.length > 1 ? (
            <div className="flex flex-col gap-2 rounded-lg border p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground mr-1 inline-flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">Launchpad <Q k="launchpad" /></span>
                {chain.launchpads.map((p) => (
                  <button key={p.id} type="button" disabled={!!p.disabled || launching} title={p.disabled ?? p.note} onClick={() => pickPad(p.id)}
                    className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors", p.id === pad.id ? "border-brand bg-brand/10 text-foreground font-medium" : "hover:bg-accent", p.disabled && "cursor-not-allowed opacity-45")}>
                    <BrandIcon src={p.logo} label={p.name} size={14} />{p.name}
                  </button>
                ))}
              </div>
              <p className="text-muted-foreground text-xs leading-snug">{pad.note}</p>
              {pad.settings?.length ? (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  {pad.settings.map((st) => (
                    <div key={st.field} className="inline-flex items-center gap-1.5 text-xs" title={st.help}>
                      <span className="font-medium">{st.label}</span>
                      {st.kind === "toggle" ? <Toggle checked={padVals[st.field] === true} onChange={(v) => setPadVals((x) => ({ ...x, [st.field]: v }))} label={<span className="text-muted-foreground">{padVals[st.field] === true ? "on" : "off"}</span>} />
                        : st.kind === "select" ? <Select className="h-7 w-auto text-xs" value={String(padVals[st.field] ?? st.default)} onChange={(e) => setPadVals((x) => ({ ...x, [st.field]: e.target.value }))}>{st.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
                          : <><Input inputMode="decimal" className="h-7 w-14 font-mono text-xs" value={String(padVals[st.field] ?? "")} onChange={(e) => setPadVals((x) => ({ ...x, [st.field]: e.target.value }))} aria-label={st.label} />{st.unit ? <span className="text-muted-foreground">{st.unit}</span> : null}</>}
                      {st.help ? <span className="text-muted-foreground hidden lg:inline">{st.help}</span> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-center">
            <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">Image</span>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const file = e.dataTransfer.files?.[0]; if (file) setImage(file) }}
              className={`flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition-colors ${dragOver ? "border-foreground bg-accent" : "hover:border-foreground/60"}`}
              title="Click or drop an image (png, jpg, gif, webp, up to 4 MB)"
            >
              {preview ? <img src={preview} alt="" className="size-full object-cover" /> : <span className="text-muted-foreground flex flex-col items-center gap-1 text-[11px]"><ImagePlus className="size-5" />add image</span>}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
            </button>
            </div>
            <div className="grid w-full flex-1 gap-3 sm:grid-cols-2">
              <Field label="Name"><Input maxLength={32} placeholder="My Coin" value={f.name} onChange={set("name")} /></Field>
              <Field label="Symbol"><Input maxLength={10} placeholder="COIN" value={f.symbol} onChange={(e) => setF((s) => ({ ...s, symbol: e.target.value.toUpperCase() }))} /></Field>
              <Field label="Description (optional)" className="sm:col-span-2"><Textarea className="min-h-14" placeholder="What is it?" value={f.description} onChange={set("description")} /></Field>
            </div>
          </div>
          <span className="text-muted-foreground -mb-1 inline-flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">Links (optional)</span>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input className="text-xs" inputMode="url" placeholder="https://x.com/yourcoin" value={f.twitter} onChange={set("twitter")} onBlur={() => setF((s) => ({ ...s, twitter: normalizeLink("twitter", s.twitter) }))} aria-label="X / Twitter link" />
            <Input className="text-xs" inputMode="url" placeholder="https://t.me/yourcoin" value={f.telegram} onChange={set("telegram")} onBlur={() => setF((s) => ({ ...s, telegram: normalizeLink("telegram", s.telegram) }))} aria-label="Telegram link" />
            <Input className="text-xs" inputMode="url" placeholder="https://yourcoin.com" value={f.website} onChange={set("website")} onBlur={() => setF((s) => ({ ...s, website: normalizeLink("website", s.website) }))} aria-label="Website" />
          </div>

          {/* the coin's own options: part of its info, folded until asked for (only on chains that have any) */}
          {hasCoinOptions ? (<>
          <button type="button" className="text-muted-foreground hover:text-foreground -mx-1 flex items-center justify-between gap-3 rounded-md border-t px-1 pt-3 text-left text-xs" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-foreground inline-flex items-center gap-1.5 text-sm font-medium"><SlidersHorizontal className="size-3.5" /> More coin options</span>
              <span className="truncate">{`${custom ? `paired with ${sym}` : `paired with ${chain.symbol}`}${feat.vanitySuffix ? ` · ${mintMode === "vanity" ? `address ends in …${feat.vanitySuffix}` : "random address"}` : ""}${mayhem && mayhemAllowed ? " · Mayhem" : ""}${holderReward ? " · holder rewards" : ""}${feeAllowed && f.creatorFeeBps ? ` · creator fee ${f.creatorFeeBps} bps` : ""}`}</span>
            </span>
            <span className="shrink-0 text-base">{advanced ? "▴" : "▾"}</span>
          </button>
          {advanced ? (
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
{feat.pairs ? (
                <Field label={<span className="inline-flex items-center gap-1.5">Pair with <Q k="pair" /></span>} hint={custom ? `buys are paid in ${sym}; every wallet must hold it. Fees stay in ${chain.symbol}.` : `${chain.symbol}: the ordinary ${chain.launchpad} coin`}>
                  <Select value={quoteMint} onChange={(e) => setQuoteMint(e.target.value)}>
                    <option value={SOL_PAIR.mint}>{chain.symbol} · {chain.name}</option>
                    {PAIR_GROUPS.map((g) => { const list = pairs.filter((p) => p.kind === g.kind && p.source !== "sol"); return list.length ? <optgroup key={g.kind} label={g.title}>{list.map((p) => <option key={p.mint} value={p.mint}>{p.symbol} · {p.name || chain.short(p.mint)}</option>)}</optgroup> : null })}
                  </Select>
                </Field>
) : null}
                {feeAllowed ? <Field label={<span className="inline-flex items-center gap-1.5">Creator fee (bps) <Q k="creatorFee" /></span>} hint={`100 = 1 %; empty = ${pad.name}'s schedule`}><Input inputMode="numeric" placeholder="e.g. 50" value={f.creatorFeeBps} onChange={set("creatorFeeBps")} /></Field> : null}
              </div>
{feat.vanitySuffix ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex w-full shrink-0 items-center gap-1.5 text-sm sm:w-32">Coin address <Q k="mintAddress" /></span>
                <Chip active={mintMode === "random"} onClick={() => setMintMode("random")}>Random</Chip>
                <Chip active={mintMode === "vanity"} onClick={() => setMintMode("vanity")}>Ends in …{feat.vanitySuffix}</Chip>
                {mintMode === "vanity" ? (
                  <span className="flex flex-wrap items-center gap-3 text-xs">
                    <span className={pool.available > 0 ? "text-ok font-semibold" : "text-destructive font-semibold"}>{pool.available} ready</span>
                    {job?.status === "running" ? <Mono className="text-warn text-xs">making one: {fmt(job.attempts)} / ~{fmt(job.expectedAttempts)} · {fmt(Math.round(job.rate))}/s</Mono> : null}
                    {job?.status === "failed" && job.error ? <span className="text-destructive">{job.error}</span> : null}
                    <Button size="xs" variant="outline" onClick={grind} disabled={!!busy || job?.status === "running"}>{job?.status === "running" ? "Making…" : "Make one"}</Button>
                    <Link href="/vanity" className="underline underline-offset-4">pool</Link>
                  </span>
                ) : null}
              </div>
) : null}
              <div className="flex flex-wrap gap-x-6 gap-y-2">
{feat.mayhem ? (
                <Toggle checked={mayhem && mayhemAllowed} onChange={(v) => mayhemAllowed && setMayhem(v)} label={<span className={`inline-flex items-center gap-1.5 ${mayhemAllowed ? "" : "opacity-60"}`}>Mayhem mode{mayhemAllowed ? "" : " (SOL / USDC pairs only)"} <Q k="mayhem" /></span>} />
) : null}
{feat.holderRewards ? (
                <Toggle checked={holderReward} onChange={setHolderReward} label={<span className="inline-flex items-center gap-1.5">Holder rewards <Q k="holderReward" /></span>} />
) : null}
              </div>
            </div>
          ) : null}
          </>) : null}
        </Card>

        {/* ── 3. the buys ── */}
        <Card className="gap-4">
          <h2 className="text-[15px] font-semibold">Who buys at launch</h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex w-full shrink-0 items-center gap-1.5 text-sm font-medium sm:w-40">Dev wallet <Q k="devWallet" alert={devMode !== "main"} /></span>
            <Chip active={devMode === "main"} onClick={() => setDevMode("main")}>Main wallet</Chip>
            <Chip active={devMode === "pick"} onClick={() => setDevMode("pick")} disabled={wallets.filter((w) => w.publicKey !== main).length === 0} title={wallets.filter((w) => w.publicKey !== main).length === 0 ? "Add wallets on the Wallets page first" : undefined}>One of my wallets</Chip>
            <Chip active={devMode === "new"} onClick={() => setDevMode("new")}>New wallet</Chip>
            {devMode === "pick" ? (
              <Select className="h-8 w-60 text-xs" value={devPick} onChange={(e) => setDevPick(e.target.value)} aria-label="Dev wallet">
                <option value="">pick a wallet…</option>
                {wallets.filter((w) => w.publicKey !== main).map((w) => <option key={w.publicKey} value={w.publicKey}>{w.label} · {chain.short(w.publicKey)} · {chain.fmt(balances.get(w.publicKey))} {chain.symbol}</option>)}
              </Select>
            ) : null}
          </div>
          {devMode !== "main" ? <p className="text-muted-foreground -mt-2 text-xs">{devMode === "new" ? "A new wallet is made when you press Launch, added to your Wallets list, and funded by your main wallet. It creates the coin and gets its creator fees." : "This wallet creates the coin and gets its creator fees. Your main wallet tops it up first if it is short."}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex w-full shrink-0 items-center gap-1.5 text-sm font-medium sm:w-40">Dev buy <Q k="devBuy" /></span>
            <Input inputMode="decimal" className="h-8 w-24 font-mono text-xs" value={f.devBuySol} onChange={set("devBuySol")} aria-label="Dev buy" />
            <span className="text-muted-foreground text-xs">{sym}</span>
            {DEV_CHIPS.map((v) => <Chip key={v} active={f.devBuySol === v} onClick={() => setF((s) => ({ ...s, devBuySol: v }))}>{v}</Chip>)}
          </div>

          {/* bundle buyers (same block: pump.fun) or first buyers (right after the create: everywhere else): off by default */}
          <div className={`flex flex-col gap-3 rounded-lg border p-3 ${bundle.length ? "" : "border-dashed"}`}>
            <Toggle checked={bundle.length > 0} onChange={(on) => { setBundle(on ? resize([], 2, bundleEach) : []); if (!on) setPerWallet(false) }} label={<span><span className="font-medium">{feat.sameBlock ? "Bundle buyers" : "First buyers"}</span> <Q k={feat.sameBlock ? "bundle" : "firstBuyers"} className="mx-0.5" alert={bundle.length > 0} /> <span className="text-muted-foreground text-xs">· {feat.sameBlock ? "extra wallets that buy with the launch" : "extra wallets that buy right after the coin is created"}</span></span>} />
            {bundle.length > 0 ? (
              <>
                <Line label="How many">
                  {BUNDLE_COUNTS.filter((c) => c > 0).map((c) => <Chip key={c} active={bundle.length === c} onClick={() => setBundle(resize(bundle, c, bundleEach))}>{c}</Chip>)}
                </Line>
{feat.sameBlock ? (
                <Line label="When" help="bundleWhen" alert={!useJito}>
                  <Chip active={useJito} onClick={() => setUseJito(true)}>Same block</Chip>
                  <Chip active={!useJito} onClick={() => setUseJito(false)}>Right after</Chip>
                  <span className="text-muted-foreground text-xs">{useJito ? "together with the launch, in the same block" : "one by one, once the coin is live"}</span>
                </Line>
) : null}
                <Line label="Each one buys" help="bundleAmount">
                  {perWallet ? <span className="text-muted-foreground text-xs">set per wallet below</span> : (
                    <>
                      <Chip active={amountMode === "same"} onClick={() => { setAmountMode("same"); setBundle(bundle.map((r) => ({ ...r, amount: bundleEach }))) }}>Same</Chip>
                      <Chip active={amountMode === "random"} onClick={() => setAmountMode("random")}>Random</Chip>
                      {amountMode === "same" ? (
                        <>
                          <Input inputMode="decimal" className="h-7 w-20 font-mono text-xs" value={bundleEach} onChange={(e) => { setBundleEach(e.target.value); setBundle(bundle.map((r) => ({ ...r, amount: e.target.value }))) }} aria-label="Each buyer buys" />
                          <span className="text-muted-foreground text-xs">{sym}</span>
                        </>
                      ) : (
                        <>
                          <Input inputMode="decimal" className="h-7 w-16 font-mono text-xs" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} aria-label="Random from" />
                          <span className="text-muted-foreground text-xs">to</span>
                          <Input inputMode="decimal" className="h-7 w-16 font-mono text-xs" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} aria-label="Random to" />
                          <span className="text-muted-foreground text-xs">{sym}</span>
                        </>
                      )}
                    </>
                  )}
                  <button type="button" className="text-muted-foreground hover:text-foreground ml-auto text-xs underline underline-offset-4" onClick={() => setPerWallet((v) => !v)}>{perWallet ? "back to simple" : "per wallet"}</button>
                </Line>
                {perWallet ? <Rows rows={bundle} onChange={setBundle} prefix="B" /> : null}
                {!useJito ? (
                  <>
                    <Line label="Pause between" help="bundleGap">
                      <Input inputMode="numeric" className="h-7 w-16 font-mono text-xs" value={gap.from} onChange={(e) => setGap((g) => ({ ...g, from: e.target.value }))} aria-label="Pause from (ms)" />
                      <span className="text-muted-foreground text-xs">to</span>
                      <Input inputMode="numeric" className="h-7 w-16 font-mono text-xs" value={gap.to} onChange={(e) => setGap((g) => ({ ...g, to: e.target.value }))} aria-label="Pause to (ms)" />
                      <span className="text-muted-foreground text-xs">ms, random</span>
                    </Line>
                    <Line label="Protection" help="bundleProtect" alert={n(maxOutside) > 0}>
                      <span className="text-muted-foreground text-xs">skip the rest if outsiders already put in more than</span>
                      <Input inputMode="decimal" className="h-7 w-16 font-mono text-xs" placeholder="off" value={maxOutside} onChange={(e) => setMaxOutside(e.target.value)} aria-label={`Skip above (${chain.symbol})`} />
                      <span className="text-muted-foreground text-xs">{sym}</span>
                    </Line>
                  </>
                ) : null}
                <p className="text-muted-foreground text-xs">{bundle.length} new wallet{bundle.length === 1 ? " is" : "s are"} made for you, funded by the main wallet, and added to your Wallets list.{DEMO ? " Their keys download as a file first." : ""} Pick your own under “per wallet”.</p>
              </>
            ) : null}
          </div>

          {/* later buyers: off by default */}
          <div className={`flex flex-col gap-3 rounded-lg border p-3 ${holders.length ? "" : "border-dashed"}`}>
            <Toggle checked={holders.length > 0} onChange={(on) => { setHolders(on ? resize([], 3, holdersEach) : []); if (!on) setPerWalletH(false) }} label={<span><span className="font-medium">Later buyers</span> <Q k="later" className="mx-0.5" alert={holders.length > 0} /> <span className="text-muted-foreground text-xs">· extra wallets that buy one by one after the launch</span></span>} />
            {holders.length > 0 ? (
              <>
                <Line label="How many">
                  {HOLDER_COUNTS.filter((c) => c > 0).map((c) => <Chip key={c} active={holders.length === c} onClick={() => setHolders(resize(holders, c, holdersEach))}>{c}</Chip>)}
                </Line>
                <Line label="Each one buys">
                  {perWalletH ? <span className="text-muted-foreground text-xs">set per wallet below</span> : (
                    <>
                      <Input inputMode="decimal" className="h-7 w-20 font-mono text-xs" value={holdersEach} onChange={(e) => { setHoldersEach(e.target.value); setHolders(holders.map((r) => ({ ...r, amount: e.target.value }))) }} aria-label="Each later buyer buys" />
                      <span className="text-muted-foreground text-xs">{sym}</span>
                    </>
                  )}
                  <button type="button" className="text-muted-foreground hover:text-foreground ml-auto text-xs underline underline-offset-4" onClick={() => setPerWalletH((v) => !v)}>{perWalletH ? "back to simple" : "per wallet"}</button>
                </Line>
                <Line label="Timing" help="laterTiming">
                  <span className="text-muted-foreground text-xs">start</span>
                  <Input inputMode="numeric" className="h-7 w-14 font-mono text-xs" value={f.holderDelayS} onChange={set("holderDelayS")} aria-label="Start after (s)" />
                  <span className="text-muted-foreground text-xs">s after the launch, spread over</span>
                  <Input inputMode="numeric" className="h-7 w-14 font-mono text-xs" value={f.holderWindowS} onChange={set("holderWindowS")} aria-label="Spread over (s)" />
                  <span className="text-muted-foreground text-xs">s</span>
                </Line>
                {perWalletH ? <Rows rows={holders} onChange={setHolders} prefix="H" /> : <p className="text-muted-foreground text-xs">{holders.length} new wallet{holders.length === 1 ? " is" : "s are"} made for you, funded by the main wallet, and added to your Wallets list. Pick your own under “per wallet”.</p>}
              </>
            ) : null}
          </div>

          {/* volume maker: off by default; runs only while the coin is live */}
          <div className={`flex flex-col gap-3 rounded-lg border p-3 ${volOn ? "" : "border-dashed"}`}>
            <Toggle checked={volOn} onChange={setVolOn} label={<span><span className="font-medium">Volume maker</span> <Q k="volume" className="mx-0.5" alert={volOn} /> <span className="text-muted-foreground text-xs">· wallets that keep buying and selling small amounts</span></span>} />
            {volOn ? (
              <>
                <Line label="Wallets">
                  {[3, 5, 10, 20].map((c) => <Chip key={c} active={vol.count === c} onClick={() => setVol((v) => ({ ...v, count: c }))}>{c}</Chip>)}
                </Line>
                <Line label="Budget" help="volumeBudget">
                  <Input inputMode="decimal" className="h-7 w-20 font-mono text-xs" value={vol.budget} onChange={(e) => setVol((v) => ({ ...v, budget: e.target.value }))} aria-label={`Volume budget (${chain.symbol})`} />
                  <span className="text-muted-foreground text-xs">{chain.symbol} in total, split across the wallets ({n(vol.budget) > 0 ? (n(vol.budget) / vol.count).toFixed(DEC_SHORT) : "0"} each)</span>
                </Line>
                <Line label="Pace" help="volumePace">
                  {(["light", "normal", "heavy"] as const).map((p) => <Chip key={p} active={vol.pace === p} onClick={() => setVol((v) => ({ ...v, pace: p }))} className="capitalize">{p}</Chip>)}
                  <span className="text-muted-foreground text-xs">a trade every {vol.pace === "light" ? "8–15" : vol.pace === "normal" ? "3–7" : "1–3"} s</span>
                </Line>
                <Line label="Trade size" help="volumeSize" alert={vol.size === "wild"}>
                  {(["calm", "normal", "wild"] as const).map((z) => <Chip key={z} active={vol.size === z} onClick={() => setVol((v) => ({ ...v, size: z }))} className="capitalize">{z}</Chip>)}
                  <span className="text-muted-foreground text-xs">{vol.size === "calm" ? "small buys and sells" : vol.size === "normal" ? "medium buys, partial sells" : "big buys and dumps in runs: big candles"}</span>
                </Line>
                <Line label="Run for up to">
                  <Input inputMode="numeric" className="h-7 w-14 font-mono text-xs" value={vol.minutes} onChange={(e) => setVol((v) => ({ ...v, minutes: e.target.value }))} aria-label="Minutes" />
                  <span className="text-muted-foreground text-xs">min</span>
                </Line>
                <p className="text-muted-foreground text-xs">Starts the moment the coin is live. Stops by itself when the time is up, when auto-sell fires, <b className="text-foreground font-medium">or as soon as the main wallet has sold everything</b> (that usually means the run is over). Then the volume wallets sell what they hold. Their {chain.symbol} stays in them: collect it on the Wallets page.{custom ? ` ${chain.symbol} pairs only.` : ""}</p>
              </>
            ) : null}
          </div>

          {chain.tipName ? (
            <Line label="Speed" wide help="speed" alert={speed !== "normal"}>
              {(["normal", "fast", "turbo"] as const).map((s) => <Chip key={s} active={speed === s} onClick={() => setSpeed(s)} className="capitalize">{s}</Chip>)}
              <span className="text-muted-foreground text-xs">{speed === "normal" ? "the usual fees" : speed === "fast" ? "2× tip, higher priority fee" : "4× tip, highest priority fee"}{plan && useJito ? ` · ${chain.tipName} ${plan.tipSol} ${chain.symbol}` : ""}</span>
            </Line>
          ) : null}
          <Line label="Slippage" wide help="slippage">
            <Input inputMode="numeric" className="h-7 w-16 font-mono text-xs" value={f.slippage} onChange={set("slippage")} aria-label="Slippage (%)" />
            <span className="text-muted-foreground text-xs">%</span>
          </Line>
          {bundle.length || holders.length || volOn || devMode !== "main" ? (
            <Line label="Funding" wide help="fundFirst">
              <Toggle checked={fundFirst} onChange={setFundFirst} label={<span className="text-muted-foreground text-xs">{fundFirst ? "the main wallet sends every new wallet what it needs first" : `off: every buyer wallet must already hold its ${chain.symbol}`}</span>} />
            </Line>
          ) : null}
        </Card>

        {/* ── 4. after the launch ── */}
        <Card className="gap-3">
          <h2 className="text-[15px] font-semibold">After the launch <span className="text-muted-foreground text-xs font-normal">· optional</span></h2>
          <div className={`flex flex-col gap-3 rounded-lg border p-3 ${autoOn ? "" : "border-dashed"}`}>
            <Toggle checked={autoOn} onChange={setAutoOn} label={<span><span className="font-medium">Auto-sell</span> <Q k="autoSell" className="mx-0.5" alert={autoOn} /> <span className="text-muted-foreground text-xs">· sell everything by itself</span></span>} />
            {autoOn ? (
              <>
                <Line label="Sell when" help="sellWhen">
                  <span className="text-muted-foreground text-xs">outside buyers put in</span>
                  <Input inputMode="decimal" className="h-7 w-16 font-mono text-xs" placeholder="off" value={auto.netIn} onChange={(e) => setAuto((a) => ({ ...a, netIn: e.target.value }))} aria-label={`Outside ${chain.symbol} in`} />
                  <span className="text-muted-foreground text-xs">{sym} or after</span>
                  <Input inputMode="numeric" className="h-7 w-14 font-mono text-xs" placeholder="off" value={auto.afterMin} onChange={(e) => setAuto((a) => ({ ...a, afterMin: e.target.value }))} aria-label="Minutes" />
                  <span className="text-muted-foreground text-xs">min</span>
                </Line>
                <Line label="Buyer wallets" help="sellBuyers">
                  <Chip active={auto.bundle === "all"} onClick={() => setAuto((a) => ({ ...a, bundle: "all" }))}>All at once</Chip>
                  <Chip active={auto.bundle === "spread"} onClick={() => setAuto((a) => ({ ...a, bundle: "spread" }))}>Spread out</Chip>
                  {auto.bundle === "spread" ? <><span className="text-muted-foreground text-xs">over</span><Input inputMode="numeric" className="h-7 w-14 font-mono text-xs" value={auto.spreadSec} onChange={(e) => setAuto((a) => ({ ...a, spreadSec: e.target.value }))} aria-label="Spread over (s)" /><span className="text-muted-foreground text-xs">s</span></> : null}
                </Line>
                <Line label={devMode === "main" ? "Main wallet" : "Dev wallet"} help="sellMain">
                  <Chip active={auto.main === "with"} onClick={() => setAuto((a) => ({ ...a, main: "with" }))}>Sells with them</Chip>
                  <Chip active={auto.main === "later"} onClick={() => setAuto((a) => ({ ...a, main: "later" }))}>Sells later</Chip>
                  <Chip active={auto.main === "own"} onClick={() => setAuto((a) => ({ ...a, main: "own" }))}>Own trigger</Chip>
                  <Chip active={auto.main === "keep"} onClick={() => setAuto((a) => ({ ...a, main: "keep" }))}>Keeps its coins</Chip>
                  {auto.main === "later" ? <><Input inputMode="numeric" className="h-7 w-14 font-mono text-xs" value={auto.mainLaterSec} onChange={(e) => setAuto((a) => ({ ...a, mainLaterSec: e.target.value }))} aria-label="Seconds later" /><span className="text-muted-foreground text-xs">s later</span></> : null}
                </Line>
                {auto.main === "own" ? (
                  <Line label="">
                    <span className="text-muted-foreground text-xs">it sells when outside buyers put in</span>
                    <Input inputMode="decimal" className="h-7 w-16 font-mono text-xs" placeholder="off" value={auto.mainNetIn} onChange={(e) => setAuto((a) => ({ ...a, mainNetIn: e.target.value }))} aria-label={`Main wallet: outside ${chain.symbol} in`} />
                    <span className="text-muted-foreground text-xs">{sym} or after</span>
                    <Input inputMode="numeric" className="h-7 w-14 font-mono text-xs" placeholder="off" value={auto.mainAfterMin} onChange={(e) => setAuto((a) => ({ ...a, mainAfterMin: e.target.value }))} aria-label="Main wallet: minutes" />
                    <span className="text-muted-foreground text-xs">min</span>
                  </Line>
                ) : null}
                {!(n(auto.netIn) > 0) && !(n(auto.afterMin) > 0) ? <p className="text-warn text-xs">{auto.main === "own" && (n(auto.mainNetIn) > 0 || n(auto.mainAfterMin) > 0) ? "No amount or time under “Sell when”: the buyer wallets never sell by themselves." : "Set an amount or a time, or auto-sell never fires."}</p> : null}
                {auto.main === "own" && !(n(auto.mainNetIn) > 0) && !(n(auto.mainAfterMin) > 0) ? <p className="text-warn text-xs">Set an amount or a time for the {devName}, or it never sells.</p> : null}
              </>
            ) : null}
          </div>
          <div className={`flex flex-col gap-3 rounded-lg border p-3 ${claimOn ? "" : "border-dashed"}`}>
            <Toggle checked={claimOn} onChange={setClaimOn} label={<span><span className="font-medium">Auto-claim creator fees</span> <Q k="autoClaim" className="mx-0.5" alert={claimOn} /> <span className="text-muted-foreground text-xs">· collect your creator fees by itself</span></span>} />
            {claimOn ? (
              <Line label="Claim">
                <Chip active={claimWhen === "sold"} onClick={() => setClaimWhen("sold")}>After every wallet has sold</Chip>
                <Chip active={claimWhen === "after"} onClick={() => setClaimWhen("after")}>After a time</Chip>
                {claimWhen === "after" ? <><Input inputMode="numeric" className="h-7 w-14 font-mono text-xs" value={claimMin} onChange={(e) => setClaimMin(e.target.value)} aria-label="Minutes after the launch" /><span className="text-muted-foreground text-xs">min after the launch</span></> : null}
              </Line>
            ) : null}
          </div>
          {(autoOn || claimOn) && DEMO ? <p className="text-muted-foreground text-xs">These run in this tab: keep it open after launching.</p> : null}
        </Card>

      </div>

      {/* ── right: the launch panel (sticks while the form scrolls), then the dry run and the launch log ── */}
      <div className="flex flex-col gap-3 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
        {logCard}
        <Card className="gap-3">
          {active ? null : <h2 className="text-[15px] font-semibold">Launch</h2>}
          {plan && cost ? (
            <details open={!active} className="group/cost">
              <summary className={cn("flex cursor-pointer list-none items-baseline justify-between gap-2 text-sm font-semibold select-none", !active && "hidden")}>
                <span>Cost <span className="text-muted-foreground text-xs font-normal group-open/cost:hidden">▾ show</span><span className="text-muted-foreground hidden text-xs font-normal group-open/cost:inline">▴ hide</span></span>
                <Mono>{plan.total.toFixed(DEC)} {chain.symbol}</Mono>
              </summary>
              <div className={cn("flex flex-col gap-3", active && "mt-2")}>
              {plan.refusal ? <FailureBox failure={plan.refusal} /> : null}
              <div className="flex flex-col gap-1.5 text-xs">
                <Appear className="flex flex-col gap-1.5" items={[
                  { key: "buys", node: <CostLine label={`Buys (${devName}${cost.buyers ? ` + ${cost.buyers} buyer${cost.buyers === 1 ? "" : "s"}` : ""})`} value={cost.buys} note={plan.custom ? `paid in ${plan.quote.symbol}, not ${chain.symbol}` : undefined} /> },
                  ...(cost.volume > 0 ? [{ key: "volume", node: <CostLine label="Volume maker budget" value={cost.volume} /> }] : []),
                  ...(cost.fee > 0 ? [{ key: "fee", node: <CostLine muted label={`API fee (${+(API_FEE_RATE * 100).toFixed(2)} % of each buy)`} value={cost.fee} note={plan.custom ? `kept in ${chain.symbol} for the fee on each buy` : undefined} /> }] : []),
                  { key: "buffer", node: <CostLine muted label={`Gas buffer (${GAS_BUFFER} × ${cost.wallets} wallet${cost.wallets === 1 ? "" : "s"}, mostly comes back)`} value={cost.buffer} /> },
                  ...(cost.create > 0 ? [{ key: "create", node: <CostLine muted label={`Creating the coin (${feat.createCostNote})`} value={cost.create} /> }] : []),
                  ...(cost.tip > 0 ? [{ key: "tip", node: <CostLine muted label={chain.tipName ?? "Tip"} value={cost.tip} /> }] : []),
                  ...(cost.lut > 0 ? [{ key: "lut", node: <CostLine muted label="Lookup table rent (refunded)" value={cost.lut} /> }] : []),
                ]} />
                <div className="mt-1 flex items-baseline justify-between gap-2 border-t pt-2 text-sm font-semibold">
                  <span>Total from your main wallet</span>
                  <Mono className={cost.state === "short" ? "text-destructive" : cost.state === "ok" ? "text-ok" : ""}><Nudge value={plan.total.toFixed(DEC)}>{plan.total.toFixed(DEC)} {chain.symbol}</Nudge></Mono>
                </div>
                <div className="text-muted-foreground flex items-baseline justify-between gap-2">
                  <span>Your main wallet has</span>
                  <Mono><Nudge value={mainBalance?.toFixed(DEC) ?? ""}>{mainBalance === undefined ? "…" : `${mainBalance.toFixed(DEC)} ${chain.symbol}`}</Nudge></Mono>
                </div>
                {plan.custom ? <div className="text-muted-foreground flex justify-between"><span>{plan.quote.symbol} the wallets must already hold</span><Mono>{plan.totalQuote}</Mono></div> : null}
              </div>
              <Appear items={cost.state === "short" ? [{ key: "short", node: <p className="text-destructive text-xs font-medium">Not enough {chain.symbol}: send <Nudge value={cost.missing.toFixed(DEC)}>{cost.missing.toFixed(DEC)}</Nudge> more to your main wallet.</p> }] : cost.state === "ok" ? [{ key: "ok", node: <p className="text-ok text-xs font-medium">Enough {chain.symbol}. <Nudge value={cost.left.toFixed(DEC)}>{cost.left.toFixed(DEC)}</Nudge> {chain.symbol} left after the launch.</p> }] : []} />
              {plan.shortfalls.length ? <p className="text-destructive text-xs">Short of {plan.quote.symbol}: {plan.shortfalls.map((s) => `${s.label} needs ${s.send}`).join("; ")}. This app moves {chain.symbol} only; send the {plan.quote.symbol} first.</p> : null}
              <details className="text-muted-foreground text-xs">
                <summary className="hover:text-foreground cursor-pointer select-none">Per wallet</summary>
                <div className="mt-1.5 flex flex-col gap-1">
                  {plan.rows.map((r, i) => {
                    const extra = r.role === "dev" ? cost.tip + cost.lut + cost.create : 0
                    const buy = plan.custom ? 0 : r.role === "trader" ? r.needSol - GAS_BUFFER : r.buy
                    const fee = plan.custom || r.role === "trader" ? 0 : r.buy * API_FEE_RATE
                    const buffer = Math.max(0, r.needSol - extra - buy - fee)
                    return (
                      <div key={i} className="flex items-baseline justify-between gap-2">
                        <span className="truncate">{r.role === "dev" ? (devMode === "main" ? "Main wallet" : r.label) : r.label}</span>
                        <span className="font-mono whitespace-nowrap">{(buy + fee + buffer + extra).toFixed(DEC)}</span>
                      </div>
                    )
                  })}
                </div>
              </details>
              </div>
            </details>
          ) : <p className="text-muted-foreground text-sm">…</p>}
          <FailureBox failure={failure} />
          <div className={cn("hidden flex-col gap-2", !active && "lg:flex")}>
            <Button size="lg" className={`h-auto min-h-12 w-full py-2 text-base leading-snug whitespace-normal text-balance ${blocker ? "text-sm" : "bg-brand hover:bg-brand/90 text-background"}`} onClick={launch} disabled={!!busy || launching || !!blocker}>
              {busy === "launch" ? "Starting…" : launching ? "Launching…" : blocker ?? `Launch ${f.symbol || "it"} · ${plan ? plan.total.toFixed(DEC_SHORT) : "…"} ${chain.symbol}`}
            </Button>
          </div>
          <div className={cn("flex items-center gap-2", active && "hidden")}>
            <Button size="sm" variant="outline" onClick={simulate} disabled={!!busy || launching || !main} title="Builds the launch and simulates it; every API call shows below. Nothing is sent.">{busy === "simulate" ? "Testing…" : "Test run"}</Button>
            <span className="text-muted-foreground text-xs">Nothing is sent</span>
          </div>
          <details open={!active} className="group border-t pt-2 text-xs">
            <summary className="text-foreground cursor-pointer list-none font-medium select-none">What happens when you press Launch <span className="text-muted-foreground group-open:hidden">▾</span><span className="text-muted-foreground hidden group-open:inline">▴</span></summary>
            <Appear as="ol" effect="flash" className="text-muted-foreground mt-1.5 flex list-decimal flex-col gap-1 pl-4" items={steps.map((x) => ({ key: x, node: x }))} />
            {DEMO ? <p className="text-muted-foreground mt-1.5">{TAB_NOTE}</p> : null}
          </details>
        </Card>

        {sim && !active ? (
          <Card className="gap-2">
            <h2 className={`text-[15px] font-semibold ${sim.ok ? "text-ok" : "text-warn"}`}>{sim.ok ? "Dry run passed" : "Dry run: fix these first"}</h2>
            <ul className="flex flex-col gap-1 text-xs">
              {sim.checks.map((c) => <li key={c.name} className="flex gap-2"><span className={c.ok ? "text-ok" : "text-destructive"}>{c.ok ? "✓" : "✗"}</span><span className="text-muted-foreground w-16 shrink-0">{c.name}</span><span className="break-all">{c.detail}</span></li>)}
            </ul>
            {sim.simulation && !sim.simulation.ok && sim.simulation.logs?.length ? <pre className="bg-muted max-h-32 overflow-auto rounded-md p-2 text-[10px] whitespace-pre-wrap">{sim.simulation.logs.join("\n")}</pre> : null}
            <details className="border-t pt-2 text-xs">
              <summary className="text-muted-foreground hover:text-foreground cursor-pointer select-none">API calls ({sim.calls?.length ?? 0}) · what this app sent and got back</summary>
              <div className="mt-2"><ApiCalls calls={sim.calls} title="" empty="No calls." /></div>
            </details>
          </Card>
        ) : null}

      </div>
      <AiCoinDialog open={aiOpen} onClose={() => setAiOpen(false)} onUse={applyAi} />
      {/* phones: the Launch button stays on screen */}
      <div className="bg-background/95 fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t px-4 py-3 backdrop-blur lg:hidden" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        <div className="min-w-0 flex-1">
          {cost?.state === "short" ? <><p className="text-destructive text-[11px] font-medium">Not enough {chain.symbol}: send {cost.missing.toFixed(DEC)} more</p><p className="text-destructive font-mono text-sm font-semibold">{plan!.total.toFixed(DEC)} {chain.symbol} needed</p></> : blocker ? <p className="text-warn text-xs leading-snug">{blocker}</p> : <><p className="text-muted-foreground text-[11px]">Total from your main wallet</p><p className="text-brand font-mono text-sm font-semibold">{plan ? plan.total.toFixed(DEC) : "…"} {chain.symbol}</p></>}
        </div>
        <Button size="lg" className={`h-11 shrink-0 px-6 ${blocker ? "" : "bg-brand hover:bg-brand/90 text-background"}`} onClick={launch} disabled={!!busy || launching || !!blocker}>{busy === "launch" ? "Starting…" : launching ? "Launching…" : "Launch"}</Button>
      </div>
    </div>
  )
}

/** POST a FormData to one of the app's routes (lib/api's post() is JSON-only). */
async function fetchApp(path: string, body: FormData): Promise<{ metadataUri: string; metadata?: { image?: string } }> {
  const { appFetch } = await import("@/lib/browser/demo")
  const res = await appFetch(path, { method: "POST", body })
  const text = await res.text()
  let data: Record<string, unknown> = {}
  try { data = JSON.parse(text) as Record<string, unknown> } catch { /* not JSON */ }
  if (!res.ok) throw { ...data, error: String(data.error ?? `HTTP ${res.status}`), status: res.status }
  return data as { metadataUri: string }
}
