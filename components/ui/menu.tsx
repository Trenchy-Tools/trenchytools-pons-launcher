"use client"

/**
 * A small drop-down: a trigger button and a list of rows. Closes on a click outside, on Escape, or on any row.
 * The list is drawn on top of the page (a portal on <body>, fixed position under the trigger, or over it near the
 * bottom of the screen), so a table or panel that scrolls or clips its content never cuts it off.
 */
import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/cn"

type Pos = { left: number; top?: number; bottom?: number; maxHeight: number }

export function Menu({ trigger, children, align = "right", className }: { trigger: (open: boolean) => React.ReactNode; children: React.ReactNode; align?: "left" | "right"; className?: string }) {
  const [open, setOpen] = React.useState(false)
  const [pos, setPos] = React.useState<Pos | null>(null)
  const ref = React.useRef<HTMLDivElement>(null)
  const list = React.useRef<HTMLDivElement>(null)

  const place = React.useCallback(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const width = Math.max(list.current?.offsetWidth ?? 224, 224)
    const left = Math.min(Math.max(8, align === "right" ? r.right - width : r.left), window.innerWidth - width - 8)
    const below = window.innerHeight - r.bottom - 8
    const above = r.top - 8
    if (below >= 240 || below >= above) setPos({ left, top: r.bottom + 6, maxHeight: below - 6 })
    else setPos({ left, bottom: window.innerHeight - r.top + 6, maxHeight: above - 6 })
  }, [align])

  React.useEffect(() => {
    if (!open) return
    place()
    const raf = requestAnimationFrame(place) // again once the list has its real width
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    const onMove = (e: Event) => { if (!list.current?.contains(e.target as Node)) place() }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onKey)
    window.addEventListener("resize", place)
    window.addEventListener("scroll", onMove, true)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", onMove, true)
    }
  }, [open, place])

  return (
    <div ref={ref} className={cn("relative inline-flex", className)}>
      <span className="contents" onClick={() => setOpen((v) => !v)}>{trigger(open)}</span>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={list} role="menu"
              className="bg-background fixed z-[70] flex min-w-56 flex-col overflow-y-auto rounded-xl border p-1.5 shadow-xl"
              style={pos ? { left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight } : { visibility: "hidden" }}
              onClick={() => setOpen(false)}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

export function MenuItem({ className, danger, hint, children, ...p }: React.ComponentProps<"button"> & { danger?: boolean; hint?: React.ReactNode }) {
  return (
    <button type="button" role="menuitem" className={cn("hover:bg-muted flex w-full flex-col items-start rounded-lg px-2.5 py-1.5 text-left text-sm disabled:pointer-events-none disabled:opacity-40", danger ? "text-destructive" : "", className)} {...p}>
      <span>{children}</span>
      {hint ? <span className="text-muted-foreground text-[11px] leading-snug">{hint}</span> : null}
    </button>
  )
}
