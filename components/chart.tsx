"use client"

/**
 * The coin's candle chart. Where GMGN charts the chain, its widget is embedded (gmgn.cc/kline, the page's theme);
 * elsewhere (Elysium today) the chart is drawn here from the live trades the page already has: candles of the trade
 * prices and volume bars, nothing fetched. lib/chain.ts says which: chartUrl() gives GMGN's address or null. The
 * header's logo links (the launchpad, GMGN, DEX Screener, the explorer) are the one place the Trading page links out.
 * Shared by every demo.
 */
import * as React from "react"
import { useTheme } from "next-themes"
import { IconLink } from "@/components/ui/brand"
import { chain } from "@/lib/chain"
import { cn } from "@/lib/cn"

/** One trade for the built-in chart: when, the price in the native coin, how much native, buy or sell. */
export type ChartTrade = { timestamp: number; price: number; native: number; type: "buy" | "sell" }

export function Chart({ coin, trades = [], className = "" }: { coin: string; trades?: ChartTrade[]; className?: string }) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  const [open, setOpen] = React.useState(true)
  React.useEffect(() => setMounted(true), [])
  const theme = resolvedTheme === "light" ? "light" : "dark"
  const url = mounted ? chain.chartUrl(coin, theme) : null
  const own = mounted && !url
  const links = chain.coinLinks(coin)
  return (
    <div className={`bg-card overflow-hidden rounded-xl border ${className}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-xs">
        <span className="font-medium">Chart</span>
        <span className="text-muted-foreground hidden sm:inline">{own ? "from the live trades on this page" : "GMGN · a new coin shows up a few seconds after its first trade"}</span>
        <span className="ml-auto flex items-center gap-1">
          {links.map((l) => <IconLink key={l.label} href={l.href} icon={l.icon} label={l.label} size={14} />)}
          <button type="button" className="text-muted-foreground hover:text-foreground ml-1.5 underline-offset-4 hover:underline" onClick={() => setOpen((v) => !v)}>{open ? "hide" : "show"}</button>
        </span>
      </div>
      {open ? (
        url ? <iframe key={url} src={url} title={`${chain.name} chart`} className="bg-background block h-[300px] w-full sm:h-[420px]" loading="lazy" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups" />
          : own ? <TradeCandles trades={trades} />
            : <div className="text-muted-foreground flex h-[300px] items-center justify-center text-sm sm:h-[420px]">…</div>
      ) : null}
    </div>
  )
}

/** Candle sizes to pick from, seconds. */
const STEPS = [5, 15, 60, 300]

/** Candles + volume from trades, in an SVG that fills its box. Green when the candle closed up, red when down. */
function TradeCandles({ trades }: { trades: ChartTrade[] }) {
  const [step, setStep] = React.useState<number | null>(null)
  const valid = trades.filter((t) => t.price > 0 && Number.isFinite(t.price))
  // a trade whose native amount could not be read (paid in another token, a bot contract) prices far off: left out
  const med = [...valid].map((t) => t.price).sort((a, b) => a - b)[Math.floor(valid.length / 2)] ?? 0
  const pts = valid.filter((t) => t.price > med / 8 && t.price < med * 8).sort((a, b) => a.timestamp - b.timestamp)
  // the candle size: what the user picked, or about 40 candles over the span the trades cover
  const span = pts.length > 1 ? (pts[pts.length - 1].timestamp - pts[0].timestamp) / 1000 : 0
  const auto = STEPS.find((s) => span / s <= 60) ?? STEPS[STEPS.length - 1]
  const size = step ?? auto
  const candles: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }> = []
  for (const p of pts) {
    const t = Math.floor(p.timestamp / 1000 / size) * size
    const last = candles[candles.length - 1]
    if (last && last.t === t) { last.h = Math.max(last.h, p.price); last.l = Math.min(last.l, p.price); last.c = p.price; last.v += p.native }
    else candles.push({ t, o: last ? last.c : p.price, h: Math.max(p.price, last?.c ?? p.price), l: Math.min(p.price, last?.c ?? p.price), c: p.price, v: p.native })
  }
  const shown = candles.slice(-80)
  const W = 800, H = 420, VOL = 70, PAD = 8, AXIS = 64
  const hi = Math.max(...shown.map((c) => c.h)), lo = Math.min(...shown.map((c) => c.l))
  const range = hi - lo || hi * 0.02 || 1
  const y = (p: number) => PAD + (1 - (p - lo) / range) * (H - VOL - PAD * 3)
  const vmax = Math.max(...shown.map((c) => c.v), 1e-18)
  const slot = (W - AXIS - PAD) / Math.max(shown.length, 20)
  const fmt = (p: number) => (p >= 0.01 ? p.toPrecision(4) : p.toExponential(2))
  return (
    <div className="relative h-[300px] w-full sm:h-[420px]">
      <div className="absolute top-1.5 left-2 z-10 flex gap-1">
        {STEPS.map((s) => (
          <button key={s} type="button" onClick={() => setStep(s === size && step !== null ? null : s)} className={cn("rounded px-1.5 py-0.5 font-mono text-[10px]", s === size ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>{s < 60 ? `${s}s` : `${s / 60}m`}</button>
        ))}
      </div>
      {shown.length < 2 ? (
        <div className="text-muted-foreground flex h-full items-center justify-center text-sm">The chart draws itself from the trades as they come in.</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" role="img" aria-label={`price candles, ${size} s each`}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const p = lo + range * (1 - f)
            const yy = y(p)
            return <g key={f}><line x1={0} x2={W - AXIS} y1={yy} y2={yy} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" /><text x={W - AXIS + 4} y={yy + 4} className="fill-muted-foreground" fontSize={11}>{fmt(p)}</text></g>
          })}
          {shown.map((c, i) => {
            const x = PAD + i * slot + slot / 2
            const up = c.c >= c.o
            const color = up ? "var(--ok)" : "var(--destructive)"
            const bw = Math.max(1.5, slot * 0.6)
            const top = y(Math.max(c.o, c.c)), bot = y(Math.min(c.o, c.c))
            const vh = (c.v / vmax) * (VOL - 4)
            return (
              <g key={c.t}>
                <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                <rect x={x - bw / 2} y={top} width={bw} height={Math.max(1, bot - top)} fill={color} />
                <rect x={x - bw / 2} y={H - vh - 2} width={bw} height={vh} fill={color} opacity={0.35} />
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}
