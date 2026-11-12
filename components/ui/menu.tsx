"use client"

/** A small drop-down: a trigger button and a list of rows. Closes on a click outside or on any row. */
import * as React from "react"
import { cn } from "@/lib/cn"

export function Menu({ trigger, children, align = "right", className }: { trigger: (open: boolean) => React.ReactNode; children: React.ReactNode; align?: "left" | "right"; className?: string }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])
  return (
    <div ref={ref} className={cn("relative inline-flex", className)}>
      <span className="contents" onClick={() => setOpen((v) => !v)}>{trigger(open)}</span>
      {open ? (
        <div className={cn("bg-background absolute top-full z-50 mt-1.5 flex min-w-56 flex-col rounded-xl border p-1.5 shadow-xl", align === "right" ? "right-0" : "left-0")} onClick={() => setOpen(false)}>
          {children}
        </div>
      ) : null}
    </div>
  )
}

export function MenuItem({ className, danger, hint, children, ...p }: React.ComponentProps<"button"> & { danger?: boolean; hint?: React.ReactNode }) {
  return (
    <button type="button" className={cn("hover:bg-muted flex w-full flex-col items-start rounded-lg px-2.5 py-1.5 text-left text-sm disabled:pointer-events-none disabled:opacity-40", danger ? "text-destructive" : "", className)} {...p}>
      <span>{children}</span>
      {hint ? <span className="text-muted-foreground text-[11px] leading-snug">{hint}</span> : null}
    </button>
  )
}
