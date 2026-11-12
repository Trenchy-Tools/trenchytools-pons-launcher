"use client"

/**
 * "Are you sure?" in the app's own popup instead of the browser's window.confirm (which some embedded browsers never
 * show, so the action silently did nothing). `await ask("Archive 6 wallets?\n\nThey leave the list…")`: the first
 * paragraph is the title, the rest the explanation; the button is named after the title's first word ("Archive").
 * <ConfirmHost /> sits once in the layout.
 */
import * as React from "react"
import { Button } from "./button"
import { Dialog } from "./dialog"

type Ask = { message: string; confirmLabel?: string; danger?: boolean; resolve: (ok: boolean) => void }
let show: ((a: Ask) => void) | null = null

export function ask(message: string, opts: { confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  if (!show) return Promise.resolve(window.confirm(message)) // no host mounted (should not happen): the browser's own
  return new Promise((resolve) => show!({ message, ...opts, resolve }))
}

export function ConfirmHost() {
  const [cur, setCur] = React.useState<Ask | null>(null)
  React.useEffect(() => { show = (a) => setCur(a); return () => { show = null } }, [])
  const done = (ok: boolean) => { cur?.resolve(ok); setCur(null) }
  if (!cur) return null
  const [title, ...rest] = cur.message.split("\n\n")
  const verb = cur.confirmLabel ?? (title.match(/^[A-Za-z]+/)?.[0] ?? "OK")
  const danger = cur.danger ?? /^(archive|send|delete|remove)/i.test(title)
  return (
    <Dialog open onClose={() => done(false)} title={title}>
      {rest.length ? <div className="text-muted-foreground text-sm leading-relaxed whitespace-pre-line">{rest.join("\n\n")}</div> : null}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={() => done(false)}>Cancel</Button>
        <Button autoFocus variant={danger ? "destructive" : "default"} onClick={() => done(true)}>{verb}</Button>
      </div>
    </Dialog>
  )
}
