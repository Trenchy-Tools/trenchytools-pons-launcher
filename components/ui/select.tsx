"use client"

/**
 * A drop-down that looks like the rest of the app (the browser's own <select> list is grey and unstyled on Windows).
 * Same props as <select>: `value`, `onChange(e => e.target.value)`, `disabled`, `className`, `aria-label`, and
 * <option> / <optgroup> children, so every page keeps its code. The list opens under the button (or over it near the
 * bottom of the screen), scrolls when long, and works with the keyboard (arrows, Enter, Escape, typing a letter).
 * An option written "Name · detail · more" shows the name in full colour and the rest muted.
 */
import * as React from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/cn"

type Opt = { value: string; label: string; disabled: boolean; group?: string }

const text = (n: React.ReactNode): string => {
  if (n === null || n === undefined || typeof n === "boolean") return ""
  if (typeof n === "string" || typeof n === "number") return String(n)
  if (Array.isArray(n)) return n.map(text).join("")
  if (React.isValidElement<{ children?: React.ReactNode }>(n)) return text(n.props.children)
  return ""
}

function optionsOf(children: React.ReactNode, group?: string): Opt[] {
  const out: Opt[] = []
  React.Children.forEach(children, (c) => {
    if (!React.isValidElement<{ value?: unknown; disabled?: boolean; label?: string; children?: React.ReactNode }>(c)) return
    if (c.type === "option") out.push({ value: String(c.props.value ?? text(c.props.children)), label: text(c.props.children), disabled: !!c.props.disabled, group })
    else if (c.type === "optgroup") out.push(...optionsOf(c.props.children, c.props.label))
    else if (c.type === React.Fragment) out.push(...optionsOf(c.props.children, group))
  })
  return out
}

/** "Wallet 2 · Da64…dxVN" → the name strong, the rest muted. */
function Label({ label, muted }: { label: string; muted?: boolean }) {
  const [head, ...rest] = label.split(" · ")
  return (
    <span className="min-w-0 truncate">
      <span className={muted ? "text-muted-foreground" : ""}>{head}</span>
      {rest.length ? <span className="text-muted-foreground"> · {rest.join(" · ")}</span> : null}
    </span>
  )
}

type Props = Omit<React.ComponentProps<"select">, "onChange" | "value"> & {
  value?: string | number | readonly string[]
  onChange?: (e: { target: { value: string }; currentTarget: { value: string } }) => void
}

export function Select({ className, children, value, onChange, disabled, id, "aria-label": ariaLabel, title }: Props) {
  const opts = optionsOf(children)
  const current = String(value ?? "")
  const selected = opts.find((o) => o.value === current) ?? opts[0]
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(0)
  const [pos, setPos] = React.useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null)
  const button = React.useRef<HTMLButtonElement>(null)
  const list = React.useRef<HTMLDivElement>(null)

  const place = React.useCallback(() => {
    const r = button.current?.getBoundingClientRect()
    if (!r) return
    const below = window.innerHeight - r.bottom - 8
    const above = r.top - 8
    const width = Math.min(Math.max(r.width, 220), window.innerWidth - 16)
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8)
    if (below >= 200 || below >= above) setPos({ left, top: r.bottom + 4, width, maxHeight: Math.min(300, below) })
    else setPos({ left, bottom: window.innerHeight - r.top + 4, width, maxHeight: Math.min(300, above) })
  }, [])

  const show = () => { if (disabled) return; place(); setActive(Math.max(0, opts.findIndex((o) => o.value === selected?.value))); setOpen(true) }
  const pick = (o: Opt | undefined) => {
    if (!o || o.disabled) return
    setOpen(false)
    button.current?.focus()
    if (o.value !== current) onChange?.({ target: { value: o.value }, currentTarget: { value: o.value } })
  }

  React.useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (!button.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node)) setOpen(false) }
    const onMove = (e: Event) => { if (list.current?.contains(e.target as Node)) return; place() }
    document.addEventListener("mousedown", onDoc)
    window.addEventListener("resize", place)
    window.addEventListener("scroll", onMove, true)
    return () => { document.removeEventListener("mousedown", onDoc); window.removeEventListener("resize", place); window.removeEventListener("scroll", onMove, true) }
  }, [open, place])
  // keep the highlighted row in view
  React.useEffect(() => { if (open) list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" }) }, [open, active])

  const step = (from: number, dir: 1 | -1) => {
    for (let i = 1; i <= opts.length; i++) { const j = (from + dir * i + opts.length) % opts.length; if (!opts[j].disabled) return j }
    return from
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); show() }
      return
    }
    if (e.key === "Escape") { e.preventDefault(); setOpen(false) }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => step(a, 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => step(a, -1)) }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(opts[active]) }
    else if (e.key === "Tab") setOpen(false)
    else if (e.key.length === 1) {
      const k = e.key.toLowerCase()
      const j = opts.findIndex((o, i) => i > active && !o.disabled && o.label.toLowerCase().startsWith(k))
      const first = j >= 0 ? j : opts.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(k))
      if (first >= 0) setActive(first)
    }
  }

  const placeholder = selected?.value === ""
  return (
    <>
      <button
        ref={button} type="button" id={id} title={title} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKey}
        className={cn("border-input dark:bg-input/30 hover:bg-accent/40 flex h-9 w-full min-w-0 items-center gap-2 rounded-md border bg-transparent px-3 text-left text-sm shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50", open && "border-ring", className)}
      >
        <span className="flex min-w-0 flex-1"><Label label={selected?.label ?? ""} muted={placeholder} /></span>
        <ChevronDown className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={list} role="listbox" aria-label={ariaLabel} tabIndex={-1}
              className="bg-popover text-popover-foreground fixed z-[70] flex flex-col overflow-y-auto overscroll-contain rounded-lg border p-1 text-sm shadow-xl"
              style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight }}
            >
              {opts.map((o, i) => (
                <React.Fragment key={`${o.group ?? ""}:${o.value}:${i}`}>
                  {o.group && o.group !== opts[i - 1]?.group ? <div className="text-muted-foreground px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wide uppercase">{o.group}</div> : null}
                  <div
                    role="option" aria-selected={o.value === selected?.value} aria-disabled={o.disabled} data-i={i}
                    onMouseEnter={() => !o.disabled && setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)}
                    className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs", i === active && !o.disabled && "bg-muted", o.disabled && "cursor-not-allowed opacity-40")}
                  >
                    <span className="flex min-w-0 flex-1"><Label label={o.label} muted={o.value === ""} /></span>
                    {o.value === selected?.value ? <Check className="text-brand size-3.5 shrink-0" /> : null}
                  </div>
                </React.Fragment>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
