"use client"

/**
 * A phone dock: a slim bar fixed to the bottom of the screen (always visible, thumb-reachable) with a drawer that
 * slides up above it when its handle is tapped. Chain-neutral: the page passes what goes in the bar and the drawer.
 * Escape, the backdrop and the handle close it; the page behind does not scroll while it is open.
 */
import * as React from "react"
import { createPortal } from "react-dom"
import { ChevronUp } from "lucide-react"
import { cn } from "@/lib/cn"

export function BottomDock({ open, onOpenChange, title, bar, children, className }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** the handle's label (what the drawer holds), e.g. "Wallets · 7" */
  title: React.ReactNode
  /** always visible, under the handle */
  bar: React.ReactNode
  /** the drawer */
  children: React.ReactNode
  className?: string
}) {
  const [mounted, setMounted] = React.useState(false)
  const drawer = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => setMounted(true), [])
  // every opening starts at the top of the drawer
  React.useEffect(() => { if (open && drawer.current) drawer.current.scrollTop = 0 }, [open])
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange(false) }
    document.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev }
  }, [open, onOpenChange])
  if (!mounted) return null
  // a portal onto <body>: an ancestor with a transform or backdrop blur would otherwise trap this fixed panel
  return createPortal(
    <>
      <div aria-hidden className={cn("fixed inset-0 z-40 bg-black/50 transition-opacity duration-200", open ? "opacity-100" : "pointer-events-none opacity-0")} onClick={() => onOpenChange(false)} />
      <div className={cn("bg-card fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-xl border-t shadow-[0_-8px_24px_rgba(0,0,0,0.35)]", className)} style={{ paddingBottom: "env(safe-area-inset-bottom)" }} role={open ? "dialog" : undefined} aria-modal={open || undefined}>
        <button type="button" onClick={() => onOpenChange(!open)} aria-expanded={open} className="flex flex-col items-center gap-1 px-3 pt-1.5 pb-1">
          <span aria-hidden className="bg-muted-foreground/40 h-1 w-9 rounded-full" />
          <span className="text-muted-foreground flex w-full items-center gap-1 text-[11px]">
            <span className="text-foreground font-medium">{title}</span>
            <ChevronUp className={cn("ml-auto size-3.5 transition-transform duration-200", open && "rotate-180")} />
          </span>
        </button>
        {/* the drawer: a 0fr → 1fr grid row animates its height without measuring it */}
        <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
          <div className="min-h-0 overflow-hidden">
            <div ref={drawer} className="max-h-[62dvh] overflow-y-auto overscroll-contain border-t">{children}</div>
          </div>
        </div>
        <div className="border-t px-2 py-1.5">{bar}</div>
      </div>
    </>,
    document.body,
  )
}

/** True while the media query matches (false on the server and the first render). */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = React.useState(false)
  React.useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setMatch(m.matches)
    on()
    m.addEventListener("change", on)
    return () => m.removeEventListener("change", on)
  }, [query])
  return match
}
