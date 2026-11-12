/**
 * THE TRENCHYTOOLS SUITE: every tool we host, for the suite bar on top of every demo (components/suite-bar.tsx).
 * Shared: the same file in every demo (demos/_shared, synced by `node demos/_shared/sync.mjs`). Each demo says which
 * one it is through `chain.suiteId` in its own lib/chain.ts. Add a launcher here once and every demo lists it.
 */
export type SuiteStatus = "live" | "soon"
export type SuiteItem = {
  id: string
  /** what people call it ("pump.fun", "pons") */
  name: string
  /** the chain or what it does ("Solana", "Robinhood Chain") */
  sub: string
  /** the hosted demo; null while it is coming */
  url: string | null
  /** its open-source repository */
  repo: string | null
  /** a logo under public/logos/ (every demo ships the same logo set) */
  logo: string
  status: SuiteStatus
}

export const SUITE = {
  home: "https://trenchy.tools",
  docs: "https://trenchy.tools/docs",
  apiKey: "https://trenchy.tools/docs/api-keys",
  github: "https://github.com/Trenchy-Tools",
}

const ORG = SUITE.github

export const LAUNCHERS: SuiteItem[] = [
  { id: "pumpfun", name: "pump.fun", sub: "Solana", url: "https://pumpfun.trenchy.tools", repo: `${ORG}/trenchytools-pumpfun-launcher`, logo: "/logos/launchpads/pumpfun.svg", status: "live" },
  { id: "pons", name: "pons", sub: "Robinhood Chain", url: "https://pons.trenchy.tools", repo: `${ORG}/trenchytools-pons-launcher`, logo: "/logos/launchpads/pons.png", status: "live" },
  { id: "bnb", name: "Flap", sub: "BNB Chain", url: "https://bnb.trenchy.tools", repo: `${ORG}/trenchytools-bnb-launcher`, logo: "/logos/launchpads/flap.png", status: "live" },
  // private for now (the user's call): no hosted page or public repo yet
  { id: "elysium", name: "Montra", sub: "Elysium (Hyperliquid L2)", url: null, repo: null, logo: "/logos/chains/elysium.svg", status: "soon" },
  { id: "base", name: "Clanker", sub: "Base", url: "https://base.trenchy.tools", repo: `${ORG}/trenchytools-base-launcher`, logo: "/logos/launchpads/clanker.png", status: "live" },
]

export const TOOLS: SuiteItem[] = [
  { id: "mover", name: "Wallet mover", sub: "fund, sweep and route wallets on every chain", url: "https://mover.trenchy.tools", repo: `${ORG}/trenchytools-wallet-mover`, logo: "/logos/chains/solana.svg", status: "live" },
]

export const suiteItem = (id: string): SuiteItem | undefined => [...LAUNCHERS, ...TOOLS].find((x) => x.id === id)
