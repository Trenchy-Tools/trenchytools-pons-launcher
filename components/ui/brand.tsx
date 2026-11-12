/**
 * Logos for chains, launchpads, terminals and explorers. The files live in public/logos/ and lib/chain.ts says which
 * ones this app uses (chain.logo, chain.launchpadLogo, chain.explorer.logo, each of chain.coinLinks' icon), so another
 * chain swaps paths there and these components stay as they are.
 */
import { cn } from "@/lib/cn"

/** A logo at text size. `label` is its name: the alt text and the hover title. */
export function BrandIcon({ src, label, size = 14, className }: { src: string; label: string; size?: number; className?: string }) {
  // a plain <img>: tiny static files from this origin, no resizing needed (and the CSP allows img-src 'self')
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={label} title={label} width={size} height={size} draggable={false} className={cn("inline-block shrink-0 rounded-[3px] object-contain align-[-0.15em]", className)} />
}

/** A site's logo as a link that opens in a new tab ("Open on GMGN" on hover). */
export function IconLink({ href, icon, label, size = 16, className }: { href: string; icon: string; label: string; size?: number; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" aria-label={`Open on ${label}`} title={`Open on ${label}`} className={cn("bg-muted/40 hover:bg-muted inline-flex shrink-0 items-center justify-center rounded-md border p-1 transition-colors", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={icon} alt="" width={size} height={size} draggable={false} className="rounded-[3px] object-contain" />
    </a>
  )
}
