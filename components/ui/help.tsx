"use client"

/**
 * The little "?" next to every option: hover (or tap, or focus with the keyboard) to read what the option does, in
 * detail. The bubble is drawn on <body> at a fixed position, clamped to the window, so a card's edge never cuts it.
 * Clicking it never toggles the switch or field it sits in.
 */
import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/cn"

/** `alert`: the option is on. The "?" wiggles the moment it turns on and stays highlighted while it is on. */
export function Help({ children, className, title, alert }: { children: React.ReactNode; className?: string; title?: string; alert?: boolean }) {
  const ref = React.useRef<HTMLButtonElement>(null)
  const [wiggle, setWiggle] = React.useState(0)
  const was = React.useRef(alert)
  React.useEffect(() => { if (alert && !was.current) setWiggle((n) => n + 1); was.current = alert }, [alert])
  const [pos, setPos] = React.useState<{ left: number; top: number; above: boolean } | null>(null)
  const [pinned, setPinned] = React.useState(false)
  const show = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const w = 320
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))
    const above = window.innerHeight - r.bottom < 220 && r.top > 220
    setPos({ left, top: above ? r.top - 8 : r.bottom + 8, above })
  }
  const hide = () => { if (!pinned) setPos(null) }
  React.useEffect(() => {
    if (!pos) return
    const close = () => { setPinned(false); setPos(null) }
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    const outside = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close() }
    document.addEventListener("mousedown", outside)
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); document.removeEventListener("mousedown", outside) }
  }, [pos])
  return (
    <>
      <button
        ref={ref}
        key={wiggle}
        type="button"
        aria-label={title ? `What is “${title}”?` : "What is this?"}
        className={cn("hover:text-foreground hover:border-foreground/60 inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-full border align-middle font-sans text-[10px] leading-none font-semibold normal-case tracking-normal transition-colors", alert ? "border-brand bg-brand text-background hover:text-background" : "text-muted-foreground", wiggle > 0 && "tt-wiggle", className)}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={() => { setPinned(false); setPos(null) }}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (pinned) { setPinned(false); setPos(null) } else { setPinned(true); show() } }}
      >
        ?
      </button>
      {pos && typeof document !== "undefined"
        ? createPortal(
            <div role="tooltip" className="bg-popover text-popover-foreground pointer-events-none fixed z-[100] w-80 rounded-lg border px-3 py-2.5 text-xs leading-relaxed font-normal normal-case tracking-normal shadow-xl" style={{ left: pos.left, top: pos.top, transform: pos.above ? "translateY(-100%)" : undefined }}>
              {title ? <p className="text-foreground mb-1 font-semibold">{title}</p> : null}
              <div className="text-muted-foreground flex flex-col gap-1.5 [&_b]:text-foreground [&_b]:font-medium">{children}</div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
