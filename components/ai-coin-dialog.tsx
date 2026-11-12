"use client"

/**
 * "Create with AI": describe your coin (or leave it empty), pick a style, and the TrenchyTools API writes the name,
 * ticker and description and draws the logo (POST /api/ai/coin). Rate limited by the API (a few per hour per key and per
 * IP); the dialog shows how many tries are left. "Use this" hands the result to the launch form, image as a File.
 * Chain-neutral (demos/_shared).
 */
import * as React from "react"
import { RefreshCw, Sparkles } from "lucide-react"
import { failureOf, post, type Failure } from "@/lib/api"
import { cn } from "@/lib/cn"
import { Button } from "./ui/button"
import { Dialog } from "./ui/dialog"
import { Input } from "./ui/input"
import { FailureBox } from "./failure"

type Style = "meme" | "mascot" | "clean"
type Made = { name: string; symbol: string; description: string; image: string; left?: { hour?: number; day?: number } }
export type AiPick = { name: string; symbol: string; description: string; file: File }

const STYLES: Array<{ id: Style; label: string; hint: string }> = [
  { id: "meme", label: "Meme", hint: "loud, funny, internet-native" },
  { id: "mascot", label: "Mascot", hint: "a character people want to hold" },
  { id: "clean", label: "Clean", hint: "a simple, sharp logo" },
]
const IDEAS = ["a frog who trades in his sleep", "cat astronaut on a budget", "a coin for people who buy the top", "pixel samurai hamster"]

/** A data URL as a File (the launch form uploads it like a picked image). */
function fileOf(dataUrl: string, name: string): File {
  const [head, b64] = dataUrl.split(",")
  const type = /data:([^;]+)/.exec(head)?.[1] ?? "image/png"
  const bin = atob(b64 ?? "")
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], `${name || "coin"}.${type.split("/")[1] ?? "png"}`, { type })
}

export function AiCoinDialog({ open, onClose, onUse }: { open: boolean; onClose: () => void; onUse: (p: AiPick) => void }) {
  const [idea, setIdea] = React.useState("")
  const [style, setStyle] = React.useState<Style>("meme")
  const [busy, setBusy] = React.useState(false)
  const [made, setMade] = React.useState<Made | null>(null)
  const [failure, setFailure] = React.useState<Failure | null>(null)
  const [left, setLeft] = React.useState<Made["left"] | null>(null)

  const generate = async () => {
    setBusy(true); setFailure(null)
    try {
      const r = await post<Made>("/api/ai/coin", { idea: idea.trim() || undefined, style })
      setMade(r)
      if (r.left) setLeft(r.left)
    } catch (e) { setFailure(failureOf(e)) } finally { setBusy(false) }
  }
  const use = () => {
    if (!made) return
    onUse({ name: made.name, symbol: made.symbol, description: made.description, file: fileOf(made.image, made.symbol.toLowerCase()) })
    onClose()
  }
  const out = left && (left.hour === 0 || left.day === 0)

  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose() }} title={<span className="inline-flex items-center gap-2"><Sparkles className="text-brand size-4" />Create your coin with AI</span>}>
      <p className="text-muted-foreground -mt-1 text-xs">Describe it in a few words, or leave it empty and let the AI surprise you. You get the name, ticker, description and logo; change anything after.</p>
      <div className="flex flex-col gap-2">
        <Input value={idea} maxLength={200} onChange={(e) => setIdea(e.target.value)} placeholder={`e.g. ${IDEAS[0]}`} disabled={busy} onKeyDown={(e) => { if (e.key === "Enter" && !busy && !out) void generate() }} aria-label="Your idea" />
        <div className="flex flex-wrap gap-1">
          {IDEAS.slice(1).map((x) => <button key={x} type="button" disabled={busy} onClick={() => setIdea(x)} className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-full border px-2 py-0.5 text-[11px] transition-colors">{x}</button>)}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {STYLES.map((s) => (
            <button key={s.id} type="button" disabled={busy} onClick={() => setStyle(s.id)} className={cn("flex flex-col items-start rounded-lg border px-2.5 py-1.5 text-left transition-colors", style === s.id ? "border-brand bg-brand/10" : "hover:bg-muted")}>
              <span className="text-sm font-medium">{s.label}</span>
              <span className="text-muted-foreground text-[10px] leading-tight">{s.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {busy ? (
        <div className="flex items-center gap-3 rounded-lg border p-3">
          <div className="bg-muted size-16 shrink-0 animate-pulse rounded-lg" />
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="bg-muted h-3 w-1/2 animate-pulse rounded" />
            <div className="bg-muted h-3 w-3/4 animate-pulse rounded" />
            <p className="text-muted-foreground text-[11px]">Writing and drawing… this takes 10 to 40 seconds.</p>
          </div>
        </div>
      ) : made ? (
        <div className="flex gap-3 rounded-lg border p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={made.image} alt={made.name} className="size-20 shrink-0 rounded-lg border object-cover" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="truncate text-sm font-semibold">{made.name} <span className="text-muted-foreground font-mono text-xs font-normal">${made.symbol}</span></p>
            <p className="text-muted-foreground line-clamp-4 text-xs">{made.description}</p>
          </div>
        </div>
      ) : null}

      <FailureBox failure={failure} />

      <div className="flex flex-wrap items-center gap-2">
        {made && !busy ? <Button onClick={use} className="bg-brand hover:bg-brand/90 text-background">Use this</Button> : null}
        <Button variant={made ? "outline" : "default"} onClick={() => void generate()} disabled={busy || !!out}>
          {busy ? "Creating…" : made ? <><RefreshCw className="size-3.5" />Try again</> : <><Sparkles className="size-3.5" />Generate</>}
        </Button>
        <span className="text-muted-foreground ml-auto text-[11px]">
          {out ? "No tries left for now: come back later." : left ? `${left.hour ?? "?"} left this hour · ${left.day ?? "?"} today` : "A few tries per hour, free"}
        </span>
      </div>
    </Dialog>
  )
}
