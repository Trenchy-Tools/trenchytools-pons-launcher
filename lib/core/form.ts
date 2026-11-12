/**
 * Request-body parsing shared by the server routes (local mode) and the browser engine (demo mode): the same JSON in,
 * the same bounds and defaults. The Launch page is the same file as the pump.fun starter's, so the launch form is the
 * same JSON: amounts keep their historic names (`devBuySol`, `solEach`) and are in ETH here. No node imports.
 */
import type { Buyer, LaunchForm } from "./launch"

/** A number from a form field, or the default. */
export const num = (v: unknown, d: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : d
}

export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [])

export const isAddress = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)

/** The Launch page's JSON → a LaunchForm with defaults and bounds. `defaultSlippage` is the settings' slippage. */
export function readForm(b: Record<string, unknown>, defaultSlippage: number): LaunchForm {
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "")
  const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {})
  const count = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(num(v, 0))))
  /**
   * `wallets: [{ publicKey, amount }]`: the explicit buyers of a group (at most `max`). `publicKey` null or "" means
   * "a new wallet": the executor creates (and backs up) one for that row at launch. Bad or repeated addresses are dropped.
   */
  const buyers = (v: unknown, max: number): Buyer[] | undefined => {
    if (!Array.isArray(v)) return undefined
    const out: Buyer[] = []
    for (const x of v) {
      const e = o(x)
      const publicKey = s(e.publicKey)
      const amount = Math.max(0, num(e.amount, 0))
      if (!publicKey) out.push({ publicKey: null, amount })
      else if (isAddress(publicKey) && !out.some((b) => b.publicKey?.toLowerCase() === publicKey.toLowerCase())) out.push({ publicKey, amount })
    }
    return out.slice(0, max)
  }
  const bundle = o(b.bundle), snipers = o(b.snipers), holders = o(b.holders)
  const image = s(b.image)
  return {
    name: s(b.name).slice(0, 32), symbol: s(b.symbol).slice(0, 10), description: s(b.description), metadataUri: s(b.metadataUri),
    // the create takes the image link itself (POST /api/ipfs answers it as metadata.image)
    image: /^(https?:\/\/|ipfs:\/\/)/.test(image) ? image : "",
    twitter: s(b.twitter), telegram: s(b.telegram), website: s(b.website),
    launchpad: s(b.launchpad) || undefined,
    venueOptions: optionsOf(b.venueOptions),
    devWallet: isAddress(s(b.devWallet)) ? s(b.devWallet) : undefined,
    devFresh: b.devFresh === true,
    devBuySol: Math.max(0, num(b.devBuySol, 0)),
    bundle: { count: count(bundle.count, 16), solEach: Math.max(0, num(bundle.solEach, 0)), wallets: buyers(bundle.wallets, 16) },
    snipers: { count: count(snipers.count, 50), solEach: Math.max(0, num(snipers.solEach, 0)), wallets: buyers(snipers.wallets, 50), gapMs: Math.max(0, num(snipers.gapMs, 400)) },
    holders: { count: count(holders.count, 100), solEach: Math.max(0, num(holders.solEach, 0)), wallets: buyers(holders.wallets, 100), delayS: Math.max(0, num(holders.delayS, 0)), windowS: Math.max(1, num(holders.windowS, 120)) },
    fundFirst: b.fundFirst === true,
    slippage: Math.max(1, Math.min(50, num(b.slippage, defaultSlippage))),
    bundleGap: { fromMs: Math.max(0, Math.min(30_000, num(o(b.bundleGap).fromMs, 0))), toMs: Math.max(0, Math.min(30_000, num(o(b.bundleGap).toMs, 0))) },
    bundleMaxOutside: Math.max(0, num(b.bundleMaxOutside, 0)),
    autoSell: b.autoSell && typeof b.autoSell === "object" ? autoSellOf(o(b.autoSell)) : undefined,
    claim: b.claim && typeof b.claim === "object" ? { when: o(b.claim).when === "after" ? "after" : "sold", afterMin: Math.max(1, Math.min(24 * 60, num(o(b.claim).afterMin, 30))) } : undefined,
    volume: b.volume && typeof b.volume === "object" ? volumeOf(o(b.volume)) : undefined,
  }
}

/** The launchpad's create-body fields: plain values, one object level deep (tax: { buyTaxBps }), nothing else. */
function optionsOf(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined
  const plain = (x: unknown) => typeof x === "string" ? x.slice(0, 80) : typeof x === "number" && Number.isFinite(x) ? x : typeof x === "boolean" ? x : undefined
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 20)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k)) continue
    if (x && typeof x === "object" && !Array.isArray(x)) {
      const inner: Record<string, unknown> = {}
      for (const [k2, y] of Object.entries(x as Record<string, unknown>).slice(0, 20)) { const p = plain(y); if (p !== undefined && /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k2)) inner[k2] = p }
      out[k] = inner
    } else { const p = plain(x); if (p !== undefined) out[k] = p }
  }
  return out
}

/** The volume maker with bounds: 1–20 wallets, a budget, a pace, 1 min to 2 h. */
function volumeOf(v: Record<string, unknown>): LaunchForm["volume"] {
  const wallets = strings(v.wallets).filter(isAddress).slice(0, 20)
  return {
    count: Math.max(wallets.length, Math.min(20, Math.max(0, Math.floor(num(v.count, wallets.length))))),
    wallets,
    budget: Math.max(0, Math.min(100, num(v.budget, 0))),
    pace: v.pace === "light" || v.pace === "heavy" ? v.pace : "normal",
    minutes: Math.max(1, Math.min(120, num(v.minutes, 10))),
    size: v.size === "calm" || v.size === "wild" ? v.size : "normal",
  }
}

/** The auto-sell rule with bounds; both triggers 0 = off. */
function autoSellOf(a: Record<string, unknown>): LaunchForm["autoSell"] {
  return {
    netIn: Math.max(0, Math.min(1000, num(a.netIn, 0))),
    afterMin: Math.max(0, Math.min(24 * 60, num(a.afterMin, 0))),
    bundle: a.bundle === "spread" ? "spread" : "all",
    spreadSec: Math.max(1, Math.min(600, num(a.spreadSec, 20))),
    main: a.main === "later" ? "later" : a.main === "own" ? "own" : a.main === "keep" ? "keep" : "with",
    mainLaterSec: Math.max(1, Math.min(3600, num(a.mainLaterSec, 30))),
    mainNetIn: Math.max(0, Math.min(1000, num(a.mainNetIn, 0))),
    mainAfterMin: Math.max(0, Math.min(24 * 60, num(a.mainAfterMin, 0))),
  }
}
