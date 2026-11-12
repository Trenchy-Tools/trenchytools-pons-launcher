"use client"

/**
 * Small attention cues (styles in app/globals.css):
 *   <Nudge value={x}>…</Nudge>       shakes once whenever `value` changes (not on the first render)
 *   <Appear items={[{ key, node }]}> each item shakes in when it appears and fades out when it goes;
 *                                    effect="flash": a new or changed item flashes green, a removed one just goes
 */
import * as React from "react"
import { cn } from "@/lib/cn"

export function Nudge({ value, children, className }: { value: unknown; children: React.ReactNode; className?: string }) {
  const [n, setN] = React.useState(0)
  const first = React.useRef(true)
  const key = typeof value === "string" || typeof value === "number" ? value : JSON.stringify(value)
  React.useEffect(() => {
    if (first.current) { first.current = false; return }
    setN((x) => x + 1)
  }, [key])
  return <span key={n} className={cn(n > 0 ? "tt-nudge" : "inline-block", className)}>{children}</span>
}

type Item = { key: string; node: React.ReactNode }
type Shown = Item & { phase: "still" | "in" | "out" }

/** A list whose items animate in and out. `as` is the wrapper element (ol / ul / div); items render as li in a list. */
export function Appear({ items, as = "div", className, itemClassName, effect = "shake" }: { items: Item[]; as?: "ol" | "ul" | "div"; className?: string; itemClassName?: string; effect?: "shake" | "flash" }) {
  const [shown, setShown] = React.useState<Shown[]>(() => items.map((i) => ({ ...i, phase: "still" })))
  const first = React.useRef(true)
  const sig = items.map((i) => i.key).join("\u0000")
  React.useEffect(() => {
    if (first.current) { first.current = false; return }
    setShown((prev) => {
      const now = new Set(items.map((i) => i.key))
      const before = new Set(prev.filter((p) => p.phase !== "out").map((p) => p.key))
      const out: Shown[] = []
      // keep the new order; slot leaving items back where they were
      let j = 0
      for (const p of prev) {
        if (!now.has(p.key)) { out.push({ ...p, phase: "out" }); continue }
        while (j < items.length && items[j].key !== p.key) { const it = items[j++]; if (!before.has(it.key)) out.push({ ...it, phase: "in" }) }
        if (j < items.length) { out.push({ ...items[j], phase: before.has(items[j].key) ? (p.phase === "in" ? "in" : "still") : "in" }); j++ }
      }
      while (j < items.length) { const it = items[j++]; if (!out.some((o) => o.key === it.key)) out.push({ ...it, phase: before.has(it.key) ? "still" : "in" }) }
      return out
    })
    const t = setTimeout(() => setShown((s) => s.filter((p) => p.phase !== "out")), 320)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])
  // text of items that stay can change (numbers in them): take the latest node
  const latest = new Map(items.map((i) => [i.key, i.node]))
  const Tag = as
  const Child = as === "div" ? "div" : "li"
  return (
    <Tag className={className}>
      {shown.filter((p) => effect === "shake" || p.phase !== "out").map((p) => <Child key={p.key} className={cn(itemClassName, p.phase === "in" && (effect === "flash" ? "tt-flash" : "tt-in"), p.phase === "out" && "tt-out")}>{latest.get(p.key) ?? p.node}</Child>)}
    </Tag>
  )
}
