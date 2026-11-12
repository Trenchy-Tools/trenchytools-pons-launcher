"use client"

/**
 * A popup: centred on a wide screen, a sheet from the bottom on a phone. Escape, the backdrop and the × close it; the
 * page behind does not scroll while it is open. Chain-neutral.
 */
import * as React from "react"
import { createPortal } from "react-dom"
import { XIcon } from "lucide-react"
import { cn } from "@/lib/cn"

export function Dialog({ open, onClose, title, children, className }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; className?: string }) {
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev }
  }, [open, onClose])
  if (!open || typeof document === "undefined") return null
  // a portal onto <body>: an ancestor with a transform or backdrop blur would otherwise trap this fixed panel
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className={cn("bg-card tt-in relative flex max-h-[88dvh] w-full flex-col gap-3 overflow-y-auto rounded-t-xl border p-4 shadow-2xl sm:max-w-md sm:rounded-xl", className)} style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
        <div className="flex items-start gap-3 pr-6">
          <h2 className="text-foreground text-[15px] font-semibold">{title}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground absolute top-4 right-4 rounded-xs transition-colors">
          <XIcon className="size-4" />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  )
}
