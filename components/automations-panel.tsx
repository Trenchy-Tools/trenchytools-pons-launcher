"use client"

/**
 * The "Running" bar under the chart: everything the launch keeps doing after the coin is live (auto-sell, the main
 * wallet's own auto-sell, the volume maker, the later buyers, auto-claim) and every sell set for later, one small chip
 * each: a status dot, the name, a "?" with what it does, the time left or progress, and tiny pause / play / stop
 * buttons. Shared by every launcher (demos/_shared). Data: GET /api/trading/automations?<coin> every 2.5 s
 * (lib/automations.ts); the timed sells come from the page.
 */
import * as React from "react"
import { Pause, Play, Square, X } from "lucide-react"
import { get, post, failureOf } from "@/lib/api"
import { cn } from "@/lib/cn"
import type { Automation, AutomationKind } from "@/lib/automations"
import { Help } from "@/components/ui/help"
import { ask } from "@/components/ui/confirm"
import { toastFailure } from "@/components/ui/toast"

export type PanelTimer = { id: string; wallets: number; percent: number; dueAt: number; status: string; error?: string; summary?: string }

const clock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` }
const live = (a: Automation) => a.status === "waiting" || a.status === "running" || a.status === "paused"
const SHORT: Record<AutomationKind, string> = { autosell: "Auto-sell", "autosell-main": "Main auto-sell", volume: "Volume", later: "Later buys", claim: "Auto-claim" }
/** What Stop does, said before it is done. */
const STOP_TEXT: Record<AutomationKind, string> = {
  autosell: "Stop auto-sell? Your wallets keep their coins until you sell them yourself.",
  "autosell-main": "Stop the main wallet's auto-sell? It keeps its coins until you sell them yourself.",
  volume: "Stop the volume maker? Its wallets sell what they hold right away.",
  later: "Stop the later buyers? The buys that are still to come are not made.",
  claim: "Stop auto-claim? You can still claim the creator fees yourself.",
}

export function AutomationsPanel({ query, now, timers, onCancelTimer, onClearTimers, demo, className }: { query: string; now: number; timers: PanelTimer[]; onCancelTimer: (id: string) => void; onClearTimers: () => void; demo: boolean; className?: string }) {
  const [list, setList] = React.useState<Automation[]>([])
  const [busy, setBusy] = React.useState<string | null>(null)
  const [showDone, setShowDone] = React.useState(false)

  const load = React.useCallback(() => { void get<{ automations: Automation[] }>(`/api/trading/automations?${query}`).then((r) => setList(r.automations)).catch(() => {}) }, [query])
  React.useEffect(() => {
    setList([])
    load()
    const t = setInterval(() => { if (document.visibilityState === "visible") load() }, 2500)
    return () => clearInterval(t)
  }, [load])

  const act = async (a: Automation, action: "pause" | "resume" | "stop") => {
    if (action === "stop" && !(await ask(STOP_TEXT[a.kind], { confirmLabel: "Stop it", danger: true }))) return
    setBusy(a.id)
    try { await post("/api/trading/automations", { id: a.id, action }) } catch (e) { toastFailure(failureOf(e)) } finally { setBusy(null); load() }
  }

  const active = list.filter(live)
  const over = list.filter((a) => !live(a))
  const waiting = timers.filter((t) => t.status === "pending" || t.status === "running")
  const doneTimers = timers.filter((t) => t.status !== "pending" && t.status !== "running")
  if (!list.length && !timers.length) return null
  const nOver = over.length + doneTimers.length

  return (
    <section aria-label="Running on this coin" className={cn("bg-card flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border px-2 py-1 text-xs", className)}>
      <span className="text-muted-foreground inline-flex items-center gap-1 pr-1 font-medium">
        Running
        <Help title="Running">Everything this coin&apos;s launch is still doing, and every sell you set for later. {demo ? "They run in this browser tab: keep it open; a reload ends them." : "They run on this app's server: a restart ends them."} Pause holds the countdown, play continues it, stop ends it.</Help>
      </span>

      {active.map((a) => {
        const paused = a.status === "paused"
        const ref = paused && a.pausedAt ? a.pausedAt : now   // a paused countdown stands still
        const time = a.progress
          ? `${a.progress.done}/${a.progress.total}${a.nextAt && a.progress.done < a.progress.total ? ` · ${clock(a.nextAt - ref)}` : ""}`
          : a.endsAt ? clock(a.endsAt - ref) : null
        return (
          <Chip key={a.id} tone={paused ? "muted" : a.status === "running" ? "ok" : "warn"} state={paused ? "paused" : a.status === "running" ? "running" : "armed"}
            name={SHORT[a.kind]} help={<>{a.rule}.{a.note ? <> Now: {a.note}.</> : null}</>} time={time} note={a.note}>
            {paused
              ? <Tiny label={`Resume ${SHORT[a.kind]}`} disabled={busy === a.id} onClick={() => void act(a, "resume")}><Play /></Tiny>
              : <Tiny label={`Pause ${SHORT[a.kind]}`} disabled={busy === a.id} onClick={() => void act(a, "pause")}><Pause /></Tiny>}
            <Tiny label={`Stop ${SHORT[a.kind]}`} danger disabled={busy === a.id} onClick={() => void act(a, "stop")}><Square /></Tiny>
          </Chip>
        )
      })}
      {waiting.map((t) => (
        <Chip key={t.id} tone={t.status === "running" ? "ok" : "warn"} state={t.status === "running" ? "selling" : "waiting"} name={`Sell ${t.percent}%`}
          help={<>A sell you set for later: {t.percent}% from {t.wallets} wallet{t.wallets === 1 ? "" : "s"}.</>} time={t.status === "pending" ? clock(t.dueAt - now) : null}>
          {t.status === "pending" ? <Tiny label="Cancel this sell" danger onClick={() => onCancelTimer(t.id)}><X /></Tiny> : null}
        </Chip>
      ))}
      {!active.length && !waiting.length ? <span className="text-muted-foreground">nothing right now</span> : null}

      {nOver ? (
        <button type="button" onClick={() => setShowDone((v) => !v)} className="text-muted-foreground hover:text-foreground ml-auto px-1">{showDone ? "▾" : "▸"} {nOver} finished</button>
      ) : null}
      {showDone && nOver ? (
        <div className="flex w-full flex-wrap items-center gap-x-1.5 gap-y-1 border-t pt-1">
          {over.map((a) => <Chip key={a.id} dim tone={a.status === "lost" ? "error" : "muted"} state={a.status === "lost" ? "ended" : a.status} name={SHORT[a.kind]} help={<>{a.rule}.{a.result ? <> Result: {a.result}.</> : null}</>} note={a.result} />)}
          {doneTimers.map((t) => <Chip key={t.id} dim tone={t.status === "done" ? "muted" : "error"} state={t.status} name={`Sell ${t.percent}%`} help={<>A timed sell of {t.percent}% from {t.wallets} wallet{t.wallets === 1 ? "" : "s"}.{t.error ? ` ${t.error}` : t.summary ? ` ${t.summary}.` : ""}</>} note={t.error ?? t.summary} />)}
          {doneTimers.length ? <button type="button" className="text-muted-foreground hover:text-foreground ml-auto px-1 underline-offset-4 hover:underline" onClick={onClearTimers}>clear</button> : null}
        </div>
      ) : null}
    </section>
  )
}

/** One item: ● name ? · time · (a short live line on wide screens) · its tiny buttons. */
function Chip({ tone, state, name, help, time, note, dim, children }: { tone: "ok" | "warn" | "muted" | "error"; state: string; name: string; help: React.ReactNode; time?: string | null; note?: string; dim?: boolean; children?: React.ReactNode }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-md border pr-0.5 pl-1.5", dim && "opacity-70")}>
      <span title={state} className={cn("size-1.5 shrink-0 rounded-full", tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : tone === "error" ? "bg-destructive" : "bg-muted-foreground")} />
      <span className="font-medium whitespace-nowrap">{name}</span>
      <Help title={name}>{help}</Help>
      {time ? <span className="font-mono tabular-nums">{time}</span> : null}
      {note ? <span className="text-muted-foreground hidden max-w-40 truncate xl:inline" title={note}>{note}</span> : null}
      {tone === "muted" && !dim ? <span className="text-muted-foreground">paused</span> : null}
      {children ? <span className="inline-flex items-center">{children}</span> : <span className="w-0.5" />}
    </span>
  )
}

function Tiny({ label, danger, children, ...props }: { label: string; danger?: boolean } & React.ComponentProps<"button">) {
  return <button type="button" aria-label={label} title={label} className={cn("hover:bg-muted inline-flex size-5 items-center justify-center rounded transition-colors disabled:opacity-50 [&_svg]:size-3", danger ? "text-destructive" : "text-muted-foreground hover:text-foreground")} {...props}>{children}</button>
}
