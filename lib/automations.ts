/**
 * What a launch keeps doing after the coin is live: auto-sell, the main wallet's own auto-sell, the volume maker, the
 * later buyers, auto-claim. Each one registers here with what it does, where it stands and when it acts next, and
 * obeys Pause / Resume / Stop from the Trading page. Shared by every launcher (demos/_shared) and by both modes: the
 * registry lives in the process that runs the launch (the server in local mode, this tab in demo mode), so a reload
 * ends them; what was set stays in the launch record (LaunchRecord.automations) and is shown as "stopped".
 * No imports, no chain knowledge.
 */
export type AutomationKind = "autosell" | "autosell-main" | "volume" | "later" | "claim"
/** waiting = armed, nothing done yet · running = acting now · paused · done · stopped = by the user · lost = its page or server went away */
export type AutomationStatus = "waiting" | "running" | "paused" | "done" | "stopped" | "lost"
export type Automation = {
  id: string
  launchId: string
  coin: string
  kind: AutomationKind
  /** "Auto-sell" */
  title: string
  /** what it does, in one sentence: "Buyer wallets sell everything when outside buyers put in 2 SOL or 10 min pass" */
  rule: string
  status: AutomationStatus
  /** the live line: "outside buyers +0.42 of 2 SOL", "12 trades so far" */
  note?: string
  progress?: { done: number; total: number }
  /** when its time trigger fires or it ends (ms since epoch); moved forward by pauses */
  endsAt?: number
  /** when it acts next (ms since epoch); moved forward by pauses */
  nextAt?: number
  /** set while paused: when Pause was pressed (a countdown stands still at endsAt − pausedAt) */
  pausedAt?: number
  /** how it ended: "sold: 10 min passed", "stopped by you" */
  result?: string
  createdAt: number
  updatedAt: number
}
/** What the launch record keeps of one (enough to show it after a reload). */
export type SavedAutomation = Pick<Automation, "id" | "kind" | "title" | "rule" | "status" | "result">

export type Handle = {
  readonly a: Automation
  /** true once the user pressed Stop */
  readonly stopped: boolean
  readonly paused: boolean
  /** milliseconds spent paused so far: subtract from elapsed time so a pause does not eat a countdown */
  readonly pausedMs: number
  set(patch: Partial<Pick<Automation, "status" | "note" | "progress" | "endsAt" | "nextAt">>): void
  /** Sleep `ms` of un-paused time. Resolves false the moment Stop is pressed (the caller ends its loop), true otherwise. */
  sleep(ms: number): Promise<boolean>
  /** It is over: `status` done (it ran its course) or stopped (the user ended it). */
  finish(result: string, status?: "done" | "stopped"): void
}

type Entry = { a: Automation; stopped: boolean; paused: boolean; pausedAt: number; pausedMs: number; before: AutomationStatus; onChange?: (a: Automation) => void }
const ACTIVE: AutomationStatus[] = ["waiting", "running", "paused"]
export const isActive = (s: AutomationStatus) => ACTIVE.includes(s)

/** One registry per process, kept across dev reloads of this module. */
const REG: Map<string, Entry> = ((globalThis as unknown as { __trenchyAutomations?: Map<string, Entry> }).__trenchyAutomations ??= new Map())
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))
const norm = (coin: string) => (coin.startsWith("0x") ? coin.toLowerCase() : coin)

export function startAutomation(init: { launchId: string; coin: string; kind: AutomationKind; title: string; rule: string; endsAt?: number; progress?: { done: number; total: number }; note?: string }, onChange?: (a: Automation) => void): Handle {
  const now = Date.now()
  const a: Automation = { id: `${init.launchId}:${init.kind}`, ...init, coin: norm(init.coin), status: "waiting", createdAt: now, updatedAt: now }
  const e: Entry = { a, stopped: false, paused: false, pausedAt: 0, pausedMs: 0, before: "waiting", onChange }
  REG.set(a.id, e)
  const changed = () => { a.updatedAt = Date.now(); try { e.onChange?.({ ...a }) } catch { /* saving the record must never stop a launch */ } }
  changed()
  return {
    a,
    get stopped() { return e.stopped },
    get paused() { return e.paused },
    get pausedMs() { return e.pausedMs + (e.paused ? Date.now() - e.pausedAt : 0) },
    set(patch) {
      if (!isActive(a.status)) return
      // while paused the status stays "paused"; what it was doing is restored on resume
      if (patch.status && e.paused) { e.before = patch.status; const { status: _s, ...rest } = patch; void _s; Object.assign(a, rest) }
      else Object.assign(a, patch)
      changed()
    },
    async sleep(ms) {
      let left = ms
      for (;;) {
        if (e.stopped) return false
        if (e.paused) { await tick(250); continue }
        if (left <= 0) return true
        const step = Math.min(250, left)
        await tick(step)
        left -= step
      }
    },
    finish(result, status = e.stopped ? "stopped" : "done") {
      if (!isActive(a.status)) return
      Object.assign(a, { status, result, note: undefined, nextAt: undefined, endsAt: undefined })
      changed()
    },
  }
}

/** Pause, resume or stop one. Returns it as it stands now, or null when this process does not run it (any more). */
export function controlAutomation(id: string, action: "pause" | "resume" | "stop"): Automation | null {
  const e = REG.get(id)
  if (!e || !isActive(e.a.status)) return e ? { ...e.a } : null
  const a = e.a
  if (action === "pause" && !e.paused) { e.paused = true; e.pausedAt = Date.now(); e.before = a.status; a.status = "paused"; a.pausedAt = e.pausedAt }
  else if (action === "resume" && e.paused) {
    const d = Date.now() - e.pausedAt
    e.paused = false; e.pausedMs += d
    if (a.endsAt) a.endsAt += d
    if (a.nextAt) a.nextAt += d
    a.status = e.before
    a.pausedAt = undefined
  } else if (action === "stop") {
    if (e.paused) { e.paused = false; e.pausedMs += Date.now() - e.pausedAt; a.status = e.before }
    e.stopped = true
    a.pausedAt = undefined
    a.note = "stopping…"
  }
  a.updatedAt = Date.now()
  try { e.onChange?.({ ...a }) } catch { /* as above */ }
  return { ...a }
}

/**
 * Everything set on a coin, newest launch first: the ones running in this process as they stand, and the ones a launch
 * record remembers but nothing runs any more (the page was reloaded, the server restarted) as "lost".
 */
export function viewAutomations(coin: string, records: Array<{ id: string; automations?: SavedAutomation[] }>): Automation[] {
  const c = norm(coin)
  const live = [...REG.values()].map((e) => e.a).filter((a) => a.coin === c)
  const out: Automation[] = live.map((a) => ({ ...a }))
  for (const r of records) for (const s of r.automations ?? []) {
    if (live.some((a) => a.id === s.id)) continue
    const gone = isActive(s.status)
    out.push({ ...s, launchId: r.id, coin: c, status: gone ? "lost" : s.status, result: gone ? "It stopped when the page that ran this launch was closed or reloaded" : s.result, createdAt: 0, updatedAt: 0 })
  }
  const order: AutomationKind[] = ["autosell", "autosell-main", "volume", "later", "claim"]
  return out.sort((x, y) => Number(isActive(y.status)) - Number(isActive(x.status)) || order.indexOf(x.kind) - order.indexOf(y.kind))
}
