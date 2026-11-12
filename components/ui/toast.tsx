"use client"

import * as React from "react"
import { X } from "lucide-react"
import { failureOf, post, walletsChanged, type Failure } from "@/lib/api"
import { chain } from "@/lib/chain"
import { cn } from "@/lib/cn"

/**
 * Toasts: one call from anywhere (`toast()` / `toastFailure()`), rendered by the <Toaster /> in the layout.
 *
 * A toast can carry buttons (`actions`) that fix the problem it reports: "Download backup", "Open settings",
 * "Go to Wallets". An API error is said in plain words first (FRIENDLY below, by its code), with the button that
 * helps; the API's own message, code and docs link stay underneath in small print.
 */
export type ToastTone = "ok" | "error" | "warn" | "muted"
export type ToastAction = { label: string; run: () => void | Promise<void>; primary?: boolean }
export type ToastItem = { id: number; tone: ToastTone; title: React.ReactNode; detail?: React.ReactNode; sticky?: boolean; actions?: ToastAction[]; small?: React.ReactNode }

type Listener = (t: ToastItem) => void
const listeners = new Set<Listener>()
const dismissers = new Set<(id: number) => void>()
let seq = 0

export function toast(t: Omit<ToastItem, "id">): number {
  const item: ToastItem = { id: ++seq, ...t }
  for (const l of listeners) l(item)
  return item.id
}
export function dismissToast(id: number) {
  for (const d of dismissers) d(id)
}

// ── the buttons a toast can offer ──────────────────────────────────────────

/** Download every key that is not backed up yet (one file), then the wallets are usable. */
export const backupAction = (label = "Download backup"): ToastAction => ({
  label, primary: true,
  run: async () => {
    const r = await post<{ count: number; files: string[] }>("/api/wallets/backup")
    walletsChanged()
    toast(r.count ? { tone: "ok", title: `Backed up ${r.count} wallet${r.count === 1 ? "" : "s"}`, detail: "The key file is in your downloads. Try again now." } : { tone: "muted", title: "Every wallet is already backed up" })
  },
})
/** Settings (the API key): the top bar opens its sheet on this event. */
export const settingsAction = (label = "Open settings"): ToastAction => ({ label, primary: true, run: () => { window.dispatchEvent(new Event("open-settings")) } })
const goAction = (label: string, href: string, primary = true): ToastAction => ({ label, primary, run: () => { window.location.assign(href) } })

/** Plain words for the API's error codes, and the button that helps. Anything not listed shows the API's own message. */
const FRIENDLY: Record<string, (f: Failure) => { title: string; detail?: string; actions?: ToastAction[]; tone?: ToastTone }> = {
  wallet_unavailable: () => ({ title: "That wallet is archived or not in this app", detail: "Restore it under Wallets → Archived wallets (or import its key), then try again.", actions: [goAction("Go to Wallets", "/wallets")] }),
  not_backed_up: () => ({ title: "Back up this wallet first", detail: "Its key only lives in this browser. Download the backup file once, then try again.", actions: [backupAction()] }),
  unauthorized: () => ({ title: "Add your API key", detail: "Every action goes through the TrenchyTools API and needs a key. It is free to create.", actions: [settingsAction("Add API key")] }),
  invalid_api_key: () => ({ title: "Your API key was refused", detail: "Check it in Settings, or create a new one.", actions: [settingsAction("Fix API key")] }),
  rate_limited: () => ({ title: "Too many requests", detail: "Wait a few seconds, then try again.", tone: "warn" }),
  no_balance: () => ({ title: `Not enough ${chain.symbol}`, detail: `That wallet cannot pay for this. Send it some ${chain.symbol} first.`, actions: [goAction("Go to Wallets", "/wallets")] }),
  nothing_to_collect: () => ({ title: "Nothing to claim yet", detail: "There are no creator fees waiting right now.", tone: "muted" }),
  no_wallet: () => ({ title: "That wallet is not in this app", detail: "Add it on the Wallets page (Import a key) or pick another one.", actions: [goAction("Go to Wallets", "/wallets")] }),
  simulation_failed: (f) => ({ title: "This would fail, so nothing was sent", detail: f.hint ?? "Usually: not enough balance, or the price moved. Try a smaller amount or more slippage." }),
  send_failed: (f) => ({ title: "It did not go through", detail: f.hint ?? "The network did not take the transaction. Nothing was spent; try again." }),
  bundle_failed: (f) => ({ title: "The bundle did not land", detail: f.hint ?? "Try again, or pick a faster speed (a bigger tip)." }),
  ipfs_failed: () => ({ title: "The image upload failed", detail: "Try again in a moment, or use a smaller image." }),
  tx_too_large: () => ({ title: "Too much in one transaction", detail: "Use fewer bundle buyers, or move some to later buyers." }),
  unreachable: () => ({ title: "Cannot reach the TrenchyTools API", detail: "Check your connection and try again." }),
}

/** Some failures carry no code; recognise them by their words. */
function codeOf(f: Failure): string | undefined {
  const m = f.error.toLowerCase()
  // the same 409 code covers a wallet that is archived / gone: that one needs Restore, not a backup
  if (m.includes("not in this browser") || m.includes("is archived")) return "wallet_unavailable"
  if (f.code && FRIENDLY[f.code]) return f.code
  if (m.includes("not backed up")) return "not_backed_up"
  if (f.status === 401 || m.includes("missing api-key") || m.includes("api key")) return f.status === 401 && m.includes("invalid") ? "invalid_api_key" : "unauthorized"
  if (f.status === 429) return "rate_limited"
  if (m.includes("insufficient") || m.includes("not enough sol") || m.includes("not enough eth")) return "no_balance"
  return f.code
}

/** An API failure, in plain words with a button that helps when we know one. Stays until dismissed. */
export function toastFailure(f: Failure, title?: React.ReactNode): number {
  const known = codeOf(f)
  const friendly = known ? FRIENDLY[known]?.(f) : undefined
  const noMain = /no main wallet/i.test(f.error)
  const tech = (
    <span className="flex flex-wrap items-center gap-x-1.5">
      {friendly || title ? <span>{f.error}</span> : null}
      {f.code ? <code>{f.code}</code> : null}
      {f.status ? <span>HTTP {f.status}</span> : null}
      {f.docs ? <a className="underline underline-offset-2" href={f.docs} target="_blank" rel="noreferrer">docs</a> : null}
      {f.dir ? <span className="font-mono break-all">{f.dir}</span> : null}
    </span>
  )
  if (friendly) return toast({ tone: friendly.tone ?? "error", sticky: friendly.tone !== "muted", title: friendly.title, detail: friendly.detail, actions: friendly.actions, small: tech })
  if (noMain) return toast({ tone: "error", sticky: true, title: "Create your main wallet first", detail: "It pays for everything. Make one at the top of the Wallets page, then send it some " + chain.symbol + ".", actions: [goAction("Go to Wallets", "/wallets")], small: tech })
  return toast({ tone: "error", sticky: true, title: title ?? f.error, detail: f.hint, small: tech })
}

function ActionButton({ a, onDone }: { a: ToastAction; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false)
  return (
    <button
      type="button" disabled={busy}
      onClick={async () => { setBusy(true); try { await a.run(); onDone() } catch (e) { toastFailure(failureOf(e)) } finally { setBusy(false) } }}
      className={cn("inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition-opacity disabled:opacity-50", a.primary ? "bg-foreground text-background hover:opacity-90" : "border hover:bg-muted")}
    >
      {busy ? "…" : a.label}
    </button>
  )
}

export function Toaster() {
  const [items, setItems] = React.useState<ToastItem[]>([])
  const dismiss = React.useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), [])
  React.useEffect(() => {
    const l: Listener = (t) => {
      setItems((xs) => [...xs, t].slice(-6))
      if (!t.sticky) setTimeout(() => dismiss(t.id), t.actions?.length ? 15000 : 8000)
    }
    listeners.add(l)
    dismissers.add(dismiss)
    return () => { listeners.delete(l); dismissers.delete(dismiss) }
  }, [dismiss])
  if (!items.length) return null
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[80] flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-2 max-sm:right-2 max-sm:bottom-24 max-sm:w-[calc(100vw-1rem)]">
      {items.map((t) => (
        <div key={t.id} role="status" className={cn("bg-card pointer-events-auto flex gap-3 rounded-xl border border-l-4 p-3 text-sm shadow-xl", t.tone === "error" ? "border-l-destructive" : t.tone === "ok" ? "border-l-ok" : t.tone === "warn" ? "border-l-warn" : "border-l-border")}>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className={cn("font-semibold break-words", t.tone === "error" && "text-destructive", t.tone === "warn" && "text-warn")}>{t.title}</div>
            {t.detail ? <div className="text-muted-foreground text-[13px] leading-snug break-words">{t.detail}</div> : null}
            {t.actions?.length ? <div className="mt-1 flex flex-wrap gap-1.5">{t.actions.map((a) => <ActionButton key={a.label} a={a} onDone={() => dismiss(t.id)} />)}</div> : null}
            {t.small ? <div className="text-muted-foreground/70 mt-0.5 text-[11px] break-words">{t.small}</div> : null}
          </div>
          <button type="button" aria-label="Dismiss" className="text-muted-foreground hover:text-foreground self-start" onClick={() => dismiss(t.id)}><X className="size-4" /></button>
        </div>
      ))}
    </div>
  )
}
