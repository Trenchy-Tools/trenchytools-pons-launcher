"use client"

/**
 * The browser engine of demo mode: this app's /api/* routes, answered inside the visitor's tab.
 *
 * Same paths, same request bodies, same JSON answers and error shapes as the route handlers in app/api/** (local
 * mode), so the pages run unchanged on top of it (lib/browser/demo.ts appFetch / appEvents is the switch). The pages are
 * the same files as the pump.fun starter's: the routes and their answers have the same shapes, with the coin in `token`.
 * The flows are the shared ones in lib/core/* (launch executor, trading, funding, timers, form parsing); only the storage
 * differs:
 *
 *   wallets           lib/browser/keystore.ts (localStorage, backup rule: not usable until downloaded)
 *   API key           lib/browser/api-key.ts (one per visitor, created on first visit)
 *   launches + log    localStorage <prefix>.launches / <prefix>.launchLog.<id>; a launch runs in this tab
 *   timed sells       localStorage <prefix>.timers; fired by any open tab of the app, resumed on reload
 *   settings          localStorage <prefix>.settings (slippage)
 *
 * Signing needs chain data, and the API has it: GET /api/rh/account (pendingNonce, fees, chainId) → viem
 * `account.signTransaction` per transaction, nonce + 1 per transaction of a run → POST /api/rh/send → GET /api/rh/txs
 * (lib/core/evm.ts sendAll). Every call goes from the browser straight to https://api.trenchy.tools with the visitor's
 * key (lib/trenchy.ts, the same client class the server uses), the live-trades websocket too. Nothing touches the
 * app's own server.
 *
 * Loaded only in demo mode (a dynamic import in demo.ts).
 */
import * as launch from "../core/launch"
import * as trading from "../core/trading"
import { fundDirect, fundViaExchange, gather, sendDirect } from "../core/funding"
import { DEFAULTS, type WalletStore } from "../core/env"
import { RouteError, errorBody } from "../core/errors"
import { isAddress, num, readForm, strings } from "../core/form"
import { fireRule, forToken, isFinished, newTimerRule, type TimerRule } from "../core/timers"
import { APP_NAME, CHAIN, cleanLabel, isRole, newLabel, same, stampAt, type Role, type WalletInfo } from "../core/wallet-record"
import { ApiError, Trenchy, type TransferMode } from "../trenchy"
import { ensureApiKey, keyError, maskKey, readApiKey, replaceApiKey, setApiKey, type KeyOptions } from "./api-key"
import { DEMO_API_URL, DEMO_KEY_LABEL, KEYS_HOME, STORE_PREFIX, type EventStream } from "./demo"
import { createKeystore, type KeyView } from "./keystore"
import { generateKey, parseSecret, signerOf } from "./signer-evm"
import { chain } from "../chain"

const P = STORE_PREFIX
const KEY_OPTS: KeyOptions = { storageKey: `${P}.apiKey`, apiUrl: DEMO_API_URL, label: DEMO_KEY_LABEL }

// ── small storage helpers (settings, records) ───────────────────────────────

function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}
function save(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    throw new Error(`This browser refused to store the data (${e instanceof Error ? e.message : e})`)
  }
}

type BrowserSettings = { slippage?: number }
const okNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0
const settings = () => {
  const s = load<BrowserSettings>(`${P}.settings`, {})
  return { slippage: okNum(s.slippage) ? s.slippage : DEFAULTS.slippage, overrides: { apiUrl: false, slippage: okNum(s.slippage) } }
}

/** The API client with the visitor's key (the same class the server uses with its key). */
const api = () => new Trenchy(DEMO_API_URL, readApiKey(KEY_OPTS) ?? "")

// ── wallets: the keystore as the store the shared flows use ─────────────────

const ks = createKeystore({ prefix: P, chain: CHAIN, app: APP_NAME, fileTag: chain.suiteId })

/** An address as the keystore stores it (checksummed), whatever letter case the caller used (archived ones too). */
const canon = (publicKey: string): string => ks.list().find((w) => same(w.publicKey, publicKey))?.publicKey ?? ks.archivedList().find((w) => same(w.publicKey, publicKey))?.publicKey ?? publicKey

const info = (w: KeyView): WalletInfo & { backedUp: boolean } => ({ publicKey: w.publicKey, chain: w.chain, role: isRole(w.role) ? w.role : "trader", label: w.label, createdAt: w.createdAt, app: w.app, file: KEYS_HOME, backedUp: w.backedUp })

function createWallets(count: number, role: Role = "trader", label?: string) {
  const n = Math.min(Math.max(Math.floor(count) || 1, 1), 100)
  const start = ks.seen() + 1
  const out: Array<WalletInfo & { backedUp: boolean; path: string }> = []
  for (let i = 0; i < n; i++) {
    const k = generateKey()
    const { wallet } = ks.add({ ...k, chain: CHAIN, role, label: newLabel(label, n, i, start), createdAt: stampAt(i), app: APP_NAME })
    out.push({ ...info(wallet), path: KEYS_HOME })
  }
  return out
}

const walletStore: WalletStore = {
  place: "browser",
  list: (role) => ks.list().map(info).filter((w) => !role || w.role === role),
  get: (pk) => { const w = ks.get(canon(pk)); return w ? info(w) : null },
  main: () => { const pk = ks.main(); const w = pk ? ks.get(pk) : null; return w ? info(w) : null },
  assertBackedUp: (pk) => ks.assertBackedUp(canon(pk)),
  accountOf: (pk) => { const c = canon(pk); return signerOf(c, ks.signerSecret(c)) },
  // a wallet the launch executor makes itself is backed up on the spot (the key file downloads first), like the Launch page does
  create: (count, role, label) => { if (!(count >= 1)) return []; const out = createWallets(count, role, label); ks.downloadBackup(); return out.map((w) => ({ ...w, backedUp: true })) },
  backupNote: () => `is backed up (key downloaded; kept in ${KEYS_HOME})`,
}

// ── launches ────────────────────────────────────────────────────────────────

const readLaunches = () => load<launch.LaunchRecord[]>(`${P}.launches`, []).filter((l) => !!l?.wallets && typeof (l.wallets as { dev?: unknown }).dev === "string") // records of the older pons starter (another shape) are left out
function saveLaunch(rec: launch.LaunchRecord): void {
  save(`${P}.launches`, [...load<launch.LaunchRecord[]>(`${P}.launches`, []).filter((l) => l.id !== rec.id), rec].slice(-200))
}

/** The Env the shared flows run on, with the current key and settings. Cheap: build one per request. */
function env(): launch.Env {
  return { api: api(), wallets: walletStore, launches: { list: () => readLaunches().reverse(), save: saveLaunch }, slippage: settings().slippage }
}

// ── launch log: in memory, mirrored to localStorage so a reload still shows it ─────────────────────────────────────

const log = { events: new Map<string, launch.LaunchEvent[]>(), listeners: new Map<string, Set<(e: launch.LaunchEvent) => void>>() }
const eventsOf = (id: string): launch.LaunchEvent[] => log.events.get(id) ?? load<launch.LaunchEvent[]>(`${P}.launchLog.${id}`, [])
function emitter(id: string): launch.Emit {
  return (stage, message, extra = {}) => {
    const e: launch.LaunchEvent = { at: Date.now(), stage, message, ...extra }
    const list = [...eventsOf(id), e]
    log.events.set(id, list)
    try { save(`${P}.launchLog.${id}`, list.slice(-300)) } catch { /* the log is a convenience */ }
    for (const cb of log.listeners.get(id) ?? []) cb(e)
  }
}
function subscribeLaunch(id: string, cb: (e: launch.LaunchEvent) => void): () => void {
  if (!log.listeners.has(id)) log.listeners.set(id, new Set())
  log.listeners.get(id)!.add(cb)
  return () => log.listeners.get(id)?.delete(cb)
}

const locks = () => (typeof navigator !== "undefined" && "locks" in navigator ? navigator.locks : null)
const launchLock = (id: string) => `${P}.launch.${id}`

let running = 0
const holdPage = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = "" }

/** Run a prepared launch in this tab, holding a lock so another tab can tell it is still running. */
function runInTab(rec: launch.LaunchRecord, form: launch.LaunchForm): void {
  // while a launch runs in this tab, leaving or reloading the page asks first: the launch lives in this tab
  const go = async () => {
    running++
    if (running === 1) window.addEventListener("beforeunload", holdPage)
    try { await launch.runLaunch(env(), rec, form, emitter(rec.id)) } finally {
      running--
      if (running === 0) window.removeEventListener("beforeunload", holdPage)
    }
  }
  const l = locks()
  if (l) void l.request(launchLock(rec.id), go)
  else void go()
}

/** A launch still "running" whose tab is gone (no lock held) was interrupted: say so on the record and in its log. */
async function recoverLaunches(): Promise<void> {
  const l = locks()
  if (!l) return
  const held = new Set(((await l.query()).held ?? []).map((x) => x.name))
  for (const rec of readLaunches()) {
    if (rec.status !== "running" || held.has(launchLock(rec.id))) continue
    rec.status = "error"
    rec.error = "Interrupted: the tab running this launch was closed. Check the coin and the wallets before trying again."
    saveLaunch(rec)
    emitter(rec.id)("error", rec.error)
  }
}

// ── timed sells: localStorage, fired by whichever open tab gets the rule's lock first ──────────────────────────────

const readTimers = () => load<TimerRule[]>(`${P}.timers`, [])
function saveTimer(rule: TimerRule): void {
  const all = readTimers()
  const i = all.findIndex((r) => r.id === rule.id)
  if (i >= 0) all[i] = rule
  else all.push(rule)
  save(`${P}.timers`, all)
}
const timerLock = (id: string) => `${P}.timer.${id}`
const firing = new Set<string>()

async function fireTimer(id: string): Promise<void> {
  const run = async () => {
    const rule = readTimers().find((r) => r.id === id) // re-read: another tab may have fired it
    if (!rule || rule.status !== "pending") return
    rule.status = "running"
    saveTimer(rule)
    await fireRule(rule, (pks, token, pct) => trading.sellAll(env(), pks, token, pct))
    saveTimer(rule)
  }
  if (firing.has(id)) return
  firing.add(id)
  try {
    const l = locks()
    if (l) await l.request(timerLock(id), { ifAvailable: true }, async (lock) => { if (lock) await run() })
    else await run()
  } finally {
    firing.delete(id)
  }
}

/** Every 2 s: fire the rules that are due. A rule left "running" by a closed tab is marked interrupted. */
async function startTimers(): Promise<void> {
  const l = locks()
  if (l) {
    const held = new Set(((await l.query()).held ?? []).map((x) => x.name))
    for (const r of readTimers()) {
      if (r.status === "running" && !held.has(timerLock(r.id))) {
        r.status = "error"
        r.error = "Interrupted: the tab was closed while this sell ran. Check the balances before setting it again."
        saveTimer(r)
      }
    }
  }
  const tick = () => { for (const r of readTimers()) if (r.status === "pending" && r.dueAt <= Date.now()) void fireTimer(r.id) }
  tick()
  setInterval(tick, 2000)
}

// ── routes ──────────────────────────────────────────────────────────────────

const ok = (data: unknown, status = 200) => Response.json(data, { status })
const fail = (err: unknown, status?: number) => { const r = errorBody(err, status); return Response.json(r.body, { status: r.status }) }
async function body<T extends Record<string, unknown>>(req: Request): Promise<Partial<T>> {
  try { return (await req.json()) as Partial<T> } catch { return {} }
}
const query = (req: Request, k: string) => new URL(req.url).searchParams.get(k)
/** the coin of a request: `?token=` (this app's name) or `?mint=` */
const coin = (req: Request) => query(req, "token") || query(req, "mint") || ""

type Handler = (req: Request, params: string[]) => Promise<Response> | Response
/** [method, path pattern, handler, default status of a failure] — the same table as app/api/**. */
const routes: Array<[string, RegExp, Handler, number?]> = []
const route = (method: string, pattern: RegExp, h: Handler, failStatus?: number) => routes.push([method, pattern, h, failStatus])
const walletsView = () => ({ dir: KEYS_HOME, wallets: ks.list().map(info), mainWallet: ks.main(), archived: ks.archivedCount(), missing: [], pending: ks.pending().map((w) => ({ publicKey: w.publicKey, label: w.label })) })
/** `publicKeys` of a body: the 0x ones, in the keystore's spelling. */
const targetsOf = (v: unknown) => strings(v).filter(isAddress).map(canon)

// wallets
route("GET", /^\/api\/wallets$/, () => ok(walletsView()))
route("POST", /^\/api\/wallets$/, async (req) => {
  const b = await body<{ count: number; role: string; label: string }>(req)
  const wallets = createWallets(Number(b.count) || 1, isRole(b.role) ? b.role : "trader", typeof b.label === "string" ? b.label : undefined)
  return ok({ dir: `${KEYS_HOME}: press Download backup before funding`, wallets, mainWallet: ks.main() })
}, 409)
route("POST", /^\/api\/wallets\/import$/, async (req) => {
  const b = await body<{ privateKey: string; role: string; label: string }>(req)
  if (typeof b.privateKey !== "string" || !b.privateKey.trim()) throw new RouteError("privateKey (0x hex) is required")
  const k = parseSecret(b.privateKey)
  const role: Role = isRole(b.role) ? b.role : "trader"
  const { wallet, existed } = ks.add({ ...k, chain: CHAIN, role, label: (typeof b.label === "string" && b.label.trim()) || `Wallet ${ks.seen() + 1}`, createdAt: new Date().toISOString(), app: APP_NAME })
  return ok({ dir: KEYS_HOME, wallet: { ...info(wallet), path: KEYS_HOME, existed }, mainWallet: ks.main() })
}, 400)
route("POST", /^\/api\/wallets\/main$/, async (req) => {
  const b = await body<{ publicKey: string }>(req)
  if (!isAddress(b.publicKey)) throw new RouteError("publicKey: a 0x address")
  return ok({ mainWallet: info(ks.setMain(canon(b.publicKey))) })
})
route("POST", /^\/api\/wallets\/update$/, async (req) => {
  const b = await body<{ publicKey: string; label: string; role: string }>(req)
  if (!isAddress(b.publicKey)) throw new RouteError("publicKey: a 0x address")
  if (b.role !== undefined && !isRole(b.role)) throw new RouteError("role must be one of funding, bundle, sniper, holder, trader")
  const pk = canon(b.publicKey)
  const w = ks.get(pk)
  if (!w) throw ks.missing(pk)
  return ok({ wallet: info(ks.update(pk, { label: cleanLabel(typeof b.label === "string" ? b.label : undefined, w.label), role: isRole(b.role) ? b.role : undefined })) })
})
route("POST", /^\/api\/wallets\/export$/, async (req) => {
  const targets = targetsOf((await body<{ publicKeys: string[] }>(req)).publicKeys)
  if (!targets.length) throw new RouteError("publicKeys: at least one 0x wallet")
  return ok({ wallets: ks.secrets(targets).map((r) => ({ publicKey: r.publicKey, privateKey: r.privateKey, label: r.label, file: KEYS_HOME })) })
})
route("POST", /^\/api\/wallets\/archive$/, async (req) => {
  const b = await body<{ publicKeys: string[]; allowMain?: boolean }>(req)
  const targets = targetsOf(b.publicKeys)
  if (!targets.length) throw new RouteError("publicKeys: at least one 0x wallet")
  return ok({ archived: ks.archive(targets, b.allowMain === true), dir: `${KEYS_HOME} (archived wallets stay in every backup and export)` })
}, 409)
route("GET", /^\/api\/wallets\/archived$/, async () => {
  const list = ks.archivedList()
  const bal = list.length ? await api().evm.walletBalances(list.map((w) => w.publicKey)).catch(() => []) : []
  const by = new Map(bal.map((b) => [b.wallet.toLowerCase(), b.eth]))
  return ok({ wallets: list.map((w) => ({ ...info(w), archivedAt: w.archivedAt, native: by.get(w.publicKey.toLowerCase()) ?? null })) })
})
route("POST", /^\/api\/wallets\/unarchive$/, async (req) => {
  const targets = targetsOf((await body<{ publicKeys: string[] }>(req)).publicKeys)
  if (!targets.length) throw new RouteError("publicKeys: at least one 0x wallet")
  return ok({ restored: ks.unarchive(targets) })
})
/** Demo only: `Download backup` (the not-yet-backed-up wallets) and `Export all keys` (every wallet). One file per click. */
route("POST", /^\/api\/wallets\/backup$/, () => ok(ks.downloadBackup()))
route("POST", /^\/api\/wallets\/export-all$/, () => ok(ks.exportAll()))
/** Local mode's "Rewrite backups", in the browser: the same download as `Download backup`. */
route("POST", /^\/api\/wallets\/rewrite-backups$/, () => { const r = ks.downloadBackup(); return ok({ dir: KEYS_HOME, files: ks.list().length, restored: [], csvAdded: r.count, downloaded: r.files }) })
route("GET", /^\/api\/wallets\/balances$/, async (req) => {
  const token = coin(req)
  return ok(await trading.balanceRows(env(), isAddress(token) ? token : null))
})
route("GET", /^\/api\/wallets\/account$/, async (req) => {
  const wallet = query(req, "wallet")
  if (!isAddress(wallet)) throw new RouteError("wallet: a 0x address")
  return ok(await api().evm.account(wallet))
})
route("POST", /^\/api\/wallets\/fund$/, async (req) => {
  const b = await body<{ publicKeys: string[]; amount: number; amountEth: number }>(req)
  const targets = targetsOf(b.publicKeys)
  const amount = num(b.amount ?? b.amountEth, 0)
  if (!targets.length) throw new RouteError("publicKeys: at least one 0x wallet")
  if (!(amount > 0)) throw new RouteError("amount must be greater than zero")
  return ok({ amountEth: amount, ...(await fundDirect(env(), targets.map((publicKey) => ({ publicKey, eth: amount })))) })
})
route("POST", /^\/api\/wallets\/(fund-exchange|fund-via-exchange)$/, async (req) => {
  const b = await body<{ publicKeys: string[]; amount: number; amountEth: number; mode: TransferMode; venue: string }>(req)
  const targets = targetsOf(b.publicKeys)
  const amount = num(b.amount ?? b.amountEth, 0)
  if (!targets.length) throw new RouteError("publicKeys: at least one 0x wallet")
  if (!(amount > 0)) throw new RouteError("amount must be greater than zero")
  const mode: TransferMode = b.mode === "fixed" || b.mode === "private" ? b.mode : "float"
  return ok(await fundViaExchange(env(), targets.map((publicKey) => ({ publicKey, eth: amount })), mode, typeof b.venue === "string" && b.venue ? b.venue : "random"))
})
route("POST", /^\/api\/wallets\/send$/, async (req) => {
  const b = await body<{ publicKeys: string[]; to: string; amount: number | string }>(req)
  const from = targetsOf(b.publicKeys)
  if (!from.length) throw new RouteError("publicKeys: at least one 0x wallet")
  if (!isAddress(b.to)) throw new RouteError("to: a 0x address")
  const amount = b.amount === "max" ? "max" : num(b.amount, 0)
  if (amount !== "max" && !(amount > 0)) throw new RouteError('amount: ETH, or "max"')
  return ok(await sendDirect(env(), from, canon(b.to), amount))
})
route("POST", /^\/api\/wallets\/gather$/, async (req) => {
  const targets = targetsOf((await body<{ publicKeys: string[] }>(req)).publicKeys)
  if (!targets.length) throw new RouteError("publicKeys: at least one 0x wallet")
  return ok(await gather(env(), targets))
})
route("GET", /^\/api\/transfer\/venues$/, async () => ok(await api().transferVenues()))
route("GET", /^\/api\/transfer\/([^/]+)$/, async (_req, [id]) => ok(await api().transferStatus(decodeURIComponent(id))))

// settings: the same shapes as the pump.fun starter's (no tip on this chain)
const settingsView = () => {
  const s = settings()
  const key = readApiKey(KEY_OPTS)
  return { apiUrl: DEMO_API_URL, apiKeyConfigured: !!key, apiKeyPrefix: key ? maskKey(key) : null, apiKeyFrom: "browser", slippage: s.slippage, overrides: s.overrides, dir: KEYS_HOME, file: `${KEYS_HOME} (localStorage)`, demo: true, keyError: keyError() }
}
route("GET", /^\/api\/settings$/, async () => { await ensureApiKey(KEY_OPTS); return ok(settingsView()) })
route("PUT", /^\/api\/settings$/, async (req) => {
  const b = await body<{ apiKey: string | null; createKey: boolean; slippage: number | null }>(req)
  if (b.createKey === true) await replaceApiKey(KEY_OPTS) // the API's refusal (rate_limited, …) is thrown verbatim
  if (b.apiKey !== undefined) setApiKey(KEY_OPTS, typeof b.apiKey === "string" ? b.apiKey : null)
  const cur = load<BrowserSettings>(`${P}.settings`, {})
  if (b.slippage !== undefined) { if (okNum(b.slippage)) cur.slippage = b.slippage; else delete cur.slippage }
  save(`${P}.settings`, cur)
  return ok(settingsView())
})
route("GET", /^\/api\/settings\/status$/, async () => {
  const key = await ensureApiKey(KEY_OPTS)
  const a = api()
  const apiState: { configured: boolean; connected: boolean; url: string; keyPrefix?: string; error?: string; code?: string } = { configured: !!key, connected: false, url: a.url }
  const main = walletStore.main()
  let eth: number | null = null
  if (key) {
    try {
      const me = await a.me()
      apiState.connected = true
      apiState.keyPrefix = me.keyPrefix
      if (main) eth = await a.evm.account(main.publicKey).then((x) => Number(x.balanceEth)).catch(() => null)
    } catch (e) {
      apiState.error = e instanceof Error ? e.message : String(e)
      if (e instanceof ApiError) apiState.code = e.code
    }
  } else {
    const k = keyError()
    if (k) { apiState.error = k.error; apiState.code = k.code }
  }
  return ok({ api: apiState, keyError: keyError(), funding: main ? { publicKey: main.publicKey, label: main.label, sol: eth, eth, backedUp: ks.isBackedUp(main.publicKey) } : null, backups: { dir: KEYS_HOME, wallets: ks.list().length, pending: ks.pending().length }, demo: true })
})

// launch
const form = async (req: Request) => readForm(await body(req), settings().slippage)
route("GET", /^\/api\/launch$/, () => ok({ launches: readLaunches().reverse() }))
route("POST", /^\/api\/launch$/, async (req) => {
  const f = await form(req)
  const rec = launch.prepareLaunch(env(), f)
  runInTab(rec, f)
  return ok({ id: rec.id, events: `/api/launch/${rec.id}/events`, launch: rec })
}, 400)
route("POST", /^\/api\/launch\/plan$/, async (req) => ok(await launch.fundingPlan(env(), await form(req))))
route("POST", /^\/api\/launch\/fund$/, async (req) => ok({ results: await launch.fundPlan(env(), await form(req)) }))
route("POST", /^\/api\/launch\/simulate$/, async (req) => { const e = env(); e.api.beginTrace(); const r = await launch.simulateLaunch(e, await form(req)); return ok({ ...r, calls: e.api.endTrace() }) })
route("GET", /^\/api\/launch\/([^/]+)$/, (_req, [id]) => { const rec = readLaunches().find((l) => l.id === id); return rec ? ok(rec) : fail(new Error("Launch not found"), 404) })

// the AI coin and IPFS: the visitor's request goes straight to the API with their key
route("POST", /^\/api\/ai\/coin$/, async (req) => ok(await api().aiCoin(await body<{ idea?: string; style?: "meme" | "mascot" | "clean" }>(req))))
route("POST", /^\/api\/ipfs$/, async (req) => {
  const fd = await req.formData()
  if (!(fd.get("file") instanceof Blob)) throw new RouteError("file (png / jpg / gif / webp, up to 4 MB) is required")
  if (!fd.get("name") || !fd.get("symbol")) throw new RouteError("name and symbol are required")
  const r = await api().uploadMetadata(fd)
  if (!r.metadata?.image) throw new RouteError("the API answered without metadata.image", 502)
  return ok(r)
})

// trading
route("GET", /^\/api\/trading\/token$/, async (req) => {
  const token = coin(req)
  if (!isAddress(token)) throw new RouteError("token: a 0x address")
  return ok(await trading.tokenInfo(env(), token))
})
route("POST", /^\/api\/trading\/buy$/, async (req) => {
  const b = await body<{ publicKey: string; token: string; mint: string; amount: number; eth: number }>(req)
  const token = b.token ?? b.mint
  if (!isAddress(b.publicKey) || !isAddress(token)) throw new RouteError("publicKey and token: 0x addresses")
  const eth = num(b.amount ?? b.eth, 0)
  if (!(eth > 0)) throw new RouteError("amount must be greater than zero")
  return ok(await trading.buy(env(), canon(b.publicKey), token, eth))
})
route("POST", /^\/api\/trading\/sell$/, async (req) => {
  const b = await body<{ publicKey: string; token: string; mint: string; percent: number }>(req)
  const token = b.token ?? b.mint
  if (!isAddress(b.publicKey) || !isAddress(token)) throw new RouteError("publicKey and token: 0x addresses")
  return ok(await trading.sell(env(), canon(b.publicKey), token, num(b.percent, 100)))
})
route("POST", /^\/api\/trading\/sell-all$/, async (req) => {
  const b = await body<{ publicKeys: string[]; token: string; mint: string; percent: number }>(req)
  const token = b.token ?? b.mint
  const wallets = targetsOf(b.publicKeys)
  if (!wallets.length || !isAddress(token)) throw new RouteError("publicKeys (0x) and token (0x) are required")
  return ok({ results: await trading.sellAll(env(), wallets, token, num(b.percent, 100)) })
})
route("GET", /^\/api\/trading\/creator-fees$/, async (req) => {
  const token = coin(req)
  if (!isAddress(token)) throw new RouteError("token: a 0x address")
  return ok(await trading.creatorFees(env(), token))
})
// what the coin's launches keep running in this tab, and Pause / Resume / Stop for each
route("GET", /^\/api\/trading\/automations$/, (req) => {
  const token = new URL(req.url).searchParams.get("token")
  if (!token) throw new RouteError("token is required")
  return ok({ automations: trading.automations(env(), token) })
})
route("POST", /^\/api\/trading\/automations$/, async (req) => {
  const b = await body<{ id: string; action: string }>(req)
  if (typeof b.id !== "string" || (b.action !== "pause" && b.action !== "resume" && b.action !== "stop")) throw new RouteError("id and action (pause, resume or stop) are required")
  const a = trading.controlAutomations(b.id, b.action)
  if (!a) throw new RouteError("Nothing runs this any more: this tab was reloaded since the launch")
  return ok({ automation: a })
})
route("POST", /^\/api\/trading\/creator-fees$/, async (req) => {
  const b = await body<{ token: string; mint: string }>(req)
  const token = b.token ?? b.mint
  if (!isAddress(token)) throw new RouteError("token: a 0x address")
  return ok(await trading.collectCreatorFees(env(), token))
})
route("GET", /^\/api\/trading\/pnl$/, async (req) => {
  const token = coin(req)
  if (!isAddress(token)) throw new RouteError("token: a 0x address")
  return ok(await trading.pnl(env(), token))
})
route("GET", /^\/api\/trading\/quote$/, async (req) => {
  const token = coin(req), wallet = query(req, "wallet") ?? undefined
  const action = query(req, "action") === "sell" ? "sell" : "buy"
  const amount = num(query(req, "amount"), 0)
  if (!isAddress(token)) throw new RouteError("token: a 0x address")
  if (!(amount > 0)) throw new RouteError("amount must be greater than zero")
  return ok(await api().evm.quote({ token, action, amount, wallet: isAddress(wallet) ? wallet : undefined }))
})
route("GET", /^\/api\/trading\/timers$/, (req) => ok({ now: Date.now(), timers: forToken(readTimers(), coin(req) || null) }))
route("POST", /^\/api\/trading\/timers$/, async (req) => {
  const b = await body<{ token: string; mint: string; publicKeys: string[]; percent: number; minutes: number }>(req)
  const token = b.token ?? b.mint
  const wallets = targetsOf(b.publicKeys)
  if (!isAddress(token) || !wallets.length) throw new RouteError("token (0x) and publicKeys (0x) are required")
  for (const pk of wallets) walletStore.assertBackedUp(pk) // a rule for an unbacked wallet is refused when it is made, not when it fires
  const rule = newTimerRule({ token, publicKeys: wallets, percent: num(b.percent, 100), minutes: num(b.minutes, 5) })
  saveTimer(rule)
  return ok(rule)
}, 400)
const cancelTimer = (id: string) => {
  const rule = readTimers().find((r) => r.id === id)
  if (!rule) return fail(new Error("Timer not found"), 404)
  if (rule.status === "pending") { rule.status = "cancelled"; saveTimer(rule) }
  return ok(rule)
}
route("DELETE", /^\/api\/trading\/timers$/, (req) => {
  const id = query(req, "id")
  if (id) return cancelTimer(id)
  const keep = readTimers().filter((r) => !isFinished(r))
  const cleared = readTimers().length - keep.length
  save(`${P}.timers`, keep)
  return ok({ cleared })
})
route("DELETE", /^\/api\/trading\/timers\/([^/]+)$/, (_req, [id]) => cancelTimer(decodeURIComponent(id)))

/** One request → the route's Response (404 for an unknown path, the API's error shape for every failure). */
export async function handle(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname
  // a first visit: the visitor's key is still being made; every route waits for it (instant once it exists)
  await ensureApiKey(KEY_OPTS).catch(() => null)
  for (const [method, pattern, h, failStatus] of routes) {
    if (method !== req.method) continue
    const m = pattern.exec(path)
    if (!m) continue
    try {
      return await h(req, m.slice(1))
    } catch (e) {
      return fail(e, failStatus)
    }
  }
  return fail(new Error(`No route ${req.method} ${path} in the browser engine`), 404)
}

// ── event streams (the server's sse routes) ─────────────────────────────────

/** GET /api/launch/:id/events: the log so far, then every new stage until done / error. */
function launchEvents(id: string): EventStream {
  return (send, close) => {
    const history = eventsOf(id)
    for (const e of history) send(e)
    const rec = readLaunches().find((l) => l.id === id)
    if (!rec) { send({ at: Date.now(), stage: "error", message: "Launch not found" }); close(); return () => {} }
    const finished = (stage: string) => stage === "done" || stage === "error"
    if (history.some((e) => finished(e.stage)) || (rec.status !== "running" && !history.length)) {
      if (!history.length) send({ at: Date.now(), stage: rec.status === "error" ? "error" : "done", message: rec.error ?? `Launch ${rec.status}`, token: rec.token ?? undefined })
      close()
      return () => {}
    }
    return subscribeLaunch(id, (e) => { send(e); if (finished(e.stage)) close() })
  }
}

/**
 * GET /api/trading/feed on a chain the API does not stream (lib/chain.ts evm.ws false): the history once, then
 * GET <api>/trades?fromBlock= every 2.5 s for what is new (one small call a poll).
 */
function pollFeed(token: string): EventStream {
  return (send) => {
    let stopped = false
    let head = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const seen = new Set<string>()
    const ours = (trader: string) => walletStore.get(trader) ?? undefined
    const take = (raws: Array<Record<string, unknown>>) => {
      const out: NonNullable<ReturnType<typeof trading.parseTrade>>[] = []
      for (const raw of raws) { const t = trading.parseTrade(JSON.stringify(raw), token, ours); if (t && !seen.has(t.hash)) { seen.add(t.hash); out.push(t) } }
      return out
    }
    const tick = async () => {
      if (stopped) return
      const a = api()
      if (a.configured) {
        try {
          const h = await a.evm.tradeHistory(token, head ? 50 : 100, head ? head + 1 : undefined)
          const fresh = take(h.trades)
          if (!head) send({ type: "initial", trades: fresh })
          else for (const t of fresh.reverse()) send({ type: "trade", trade: t }) // oldest first
          if (h.head) head = h.head
        } catch { /* the next poll tries again */ }
      }
      if (!stopped) timer = setTimeout(() => void tick(), 2500)
    }
    send({ type: "initial", trades: [] })
    void tick()
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }
}

/** GET /api/trading/feed?token=0x…: the API websocket (wss://…/api/<chain>/data?api-key=…) opened from this tab. */
function tradeFeed(token: string): EventStream {
  if (!chain.evm?.ws) return pollFeed(token)
  return (send) => {
    let ws: WebSocket | null = null
    let stopped = false
    let retry: ReturnType<typeof setTimeout> | null = null
    let first = true
    const seen = new Set<string>()
    const ours = (trader: string) => walletStore.get(trader) ?? undefined
    const connect = () => {
      const a = api()
      if (!a.configured) { retry = setTimeout(connect, 3000); return } // the key is still being created
      ws = new WebSocket(a.wsUrl())
      ws.onopen = () => {
        ws?.send(trading.tradeSubscription(token))
        if (first) {
          first = false
          send({ type: "initial", trades: [] })
          // the history (GET /api/rh/trades): the dev buy and the bundle, everything before this tab subscribed
          void a.evm.tradeHistory(token, 100).then((h) => {
            const trades: ReturnType<typeof trading.parseTrade>[] = []
            for (const raw of h.trades) { const t = trading.parseTrade(JSON.stringify(raw), token, ours); if (t && !seen.has(t.hash)) { seen.add(t.hash); trades.push(t) } }
            if (!stopped) send({ type: "initial", trades })
          }).catch(() => {})
        }
      }
      ws.onmessage = (m) => {
        const t = trading.parseTrade(String(m.data), token, ours)
        if (!t || seen.has(t.hash)) return
        seen.add(t.hash)
        send({ type: "trade", trade: t })
      }
      ws.onclose = () => { if (!stopped) retry = setTimeout(connect, 3000) }
    }
    connect()
    return () => { stopped = true; if (retry) clearTimeout(retry); try { ws?.close() } catch { /* closing */ } }
  }
}

/** The event stream of a path, or null when it has none. */
export function stream(url: URL): EventStream | null {
  const m = /^\/api\/launch\/([^/]+)\/(events|log)$/.exec(url.pathname)
  if (m) return launchEvents(decodeURIComponent(m[1]))
  if (/^\/api\/trading\/(feed|trades)$/.test(url.pathname)) {
    const token = url.searchParams.get("token") || url.searchParams.get("mint") || ""
    return isAddress(token) ? tradeFeed(token) : null
  }
  return null
}

// ── start-up: the visitor's key, interrupted launches, timed sells ───────────

if (typeof window !== "undefined") {
  void ensureApiKey(KEY_OPTS)
  void recoverLaunches().catch(() => {})
  void startTimers().catch(() => {})
}
