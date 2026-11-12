/**
 * The launchpads of this app's chain: which one a launch goes to, what it is called, how it behaves and what it lets
 * you set. lib/chain.ts lists them (`chain.launchpads`, the first is the default); the Launch page shows a picker and
 * the chosen launchpad's settings; the launch executor sends `body` + the settings with the create (POST
 * /api/<chain>/trade-local { action: "create", venue, … }). Buys and sells never need it: the API finds a coin's
 * market from the coin. Shared by every demo (demos/_shared); client-safe.
 */
import { chain } from "./chain"

/** One setting a launchpad takes on the create: a number (with bounds), a choice, or a switch. */
export type LaunchSetting = {
  /** where the value goes in the create body: "taxPercent", or a path like "tax.buyTaxBps" */
  field: string
  label: string
  /** one line next to the input */
  help?: string
  kind: "number" | "select" | "toggle"
  /** the default, as typed ("1", "WETH", true) */
  default: string | boolean
  /** number: shown after the input ("%", "bps") */
  unit?: string
  min?: number
  max?: number
  /** number: what the typed value is multiplied by before it is sent (a percent sent as bps: 100) */
  scale?: number
  /** select: the choices */
  options?: Array<{ value: string; label: string }>
}

export type Launchpad = {
  /** this app's id for it ("pump", "stonkfun", "montra") */
  id: string
  name: string
  /** a logo under public/logos/ */
  logo: string
  site: string
  /** one line under the picker: how it works, what it costs */
  note: string
  /** fixed fields of the create body: { venue: "launchlab", platform: "stonkfun" } */
  body: Record<string, string | number | boolean>
  settings?: LaunchSetting[]
  /** the coin's page on this launchpad (the launch log's "Live on …" link); the chain's first coin link when absent */
  coinUrl?: (coin: string) => string
  // ── what differs from the chain's defaults (lib/chain.ts) ──
  /** bundle buyers can land in the same block as the create (Solana: a Jito bundle; pump.fun only) */
  sameBlock?: boolean
  mayhem?: boolean
  pairs?: boolean
  holderRewards?: boolean
  /** a vanity address suffix ("pump"), or null for none */
  vanitySuffix?: string | null
  /** the launchpad pays the creator and the API can claim it */
  creatorFees?: boolean
  /** EVM: the creator names wallets that skip its launch-window tax (pons) */
  exemptList?: boolean
  /** EVM: seconds after the create before any other buy (Clanker's 20 s anti-snipe) */
  launchQuietS?: number
  /** the smallest buy it takes, in the native coin */
  minBuy?: number
  /** what creating the coin costs the dev wallet on top of its buy, and in a few words what that is */
  createCost?: number
  createCostNote?: string
  /** shown instead of the picker entry being usable: why it cannot launch right now */
  disabled?: string
}

/** The launchpad with this id, or the chain's default (the first). */
export const padById = (id?: string | null): Launchpad => chain.launchpads.find((p) => p.id === id) ?? chain.launchpads[0]

/** The chain's feature switches with the launchpad's differences applied. */
export function padFeatures(p: Launchpad) {
  const f = chain.features
  return {
    ...f,
    sameBlock: f.sameBlock && p.sameBlock !== false,
    mayhem: f.mayhem && p.mayhem !== false,
    pairs: f.pairs && p.pairs !== false,
    holderRewards: f.holderRewards && p.holderRewards !== false,
    creatorFees: p.creatorFees ?? f.creatorFees,
    vanitySuffix: p.vanitySuffix === undefined ? chain.vanitySuffix : p.vanitySuffix,
    createCost: p.createCost ?? chain.createCost,
    createCostNote: p.createCostNote ?? chain.createCostNote,
  }
}

/** The settings as the form starts them: every default. */
export const padDefaults = (p: Launchpad): Record<string, string | boolean> => Object.fromEntries((p.settings ?? []).map((s) => [s.field, s.default]))

/** The create body's launchpad part: `body` + every setting at its path (numbers clamped and scaled). */
export function padBody(p: Launchpad, values: Record<string, string | boolean | undefined> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...p.body }
  for (const s of p.settings ?? []) {
    const raw = values[s.field] ?? s.default
    let v: unknown = raw
    if (s.kind === "number") {
      const n = Number(raw)
      if (raw === "" || !Number.isFinite(n)) continue
      const clamped = Math.min(s.max ?? Infinity, Math.max(s.min ?? -Infinity, n))
      v = +(clamped * (s.scale ?? 1)).toFixed(6)
    } else if (s.kind === "toggle") v = raw === true || raw === "true"
    else v = String(raw)
    const path = s.field.split(".")
    let at = out
    for (const k of path.slice(0, -1)) at = (at[k] && typeof at[k] === "object" ? at[k] : (at[k] = {})) as Record<string, unknown>
    at[path[path.length - 1]] = v
  }
  return out
}

/** Where a coin of this launchpad is seen. */
export const padCoinUrl = (p: Launchpad, coin: string): string => p.coinUrl?.(coin) ?? chain.coinLinks(coin)[0]?.href ?? chain.explorerAddress(coin)
