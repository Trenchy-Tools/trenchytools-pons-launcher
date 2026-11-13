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
  { id: "pumpfun", name: "Solana", sub: "pump.fun · StonkFun · letsbonk", url: "https://pumpfun.trenchy.tools", repo: `${ORG}/trenchytools-pumpfun-launcher`, logo: "/logos/chains/solana.svg", status: "live" },
  { id: "pons", name: "Robinhood Chain", sub: "pons · pools.trade · circus · Sushi · pools.fun", url: "https://pons.trenchy.tools", repo: `${ORG}/trenchytools-pons-launcher`, logo: "/logos/chains/robinhood.svg", status: "live" },
  { id: "bnb", name: "BNB Chain", sub: "Flap · four.meme", url: "https://bnb.trenchy.tools", repo: `${ORG}/trenchytools-bnb-launcher`, logo: "/logos/chains/bnb.svg", status: "live" },
  { id: "base", name: "Base", sub: "Clanker", url: "https://base.trenchy.tools", repo: `${ORG}/trenchytools-base-launcher`, logo: "/logos/chains/base.svg", status: "live" },
  { id: "eth", name: "Ethereum", sub: "Sender · Stockereum", url: "https://eth.trenchy.tools", repo: `${ORG}/trenchytools-eth-launcher`, logo: "/logos/chains/ethereum.svg", status: "live" },
  { id: "arc", name: "Arc", sub: "Tolly · Argus · pools.trade", url: "https://arc.trenchy.tools", repo: `${ORG}/trenchytools-arc-launcher`, logo: "/logos/chains/arc.png", status: "live" },
  { id: "elysium", name: "Elysium", sub: "Montra · Ascend · Volta · BOXA", url: "https://elysium.trenchy.tools", repo: `${ORG}/trenchytools-elysium-launcher`, logo: "/logos/chains/elysium.svg", status: "live" },
]

export const TOOLS: SuiteItem[] = [
  { id: "mover", name: "Wallet mover", sub: "move SOL and ETH between wallets and chains", url: "https://mover.trenchy.tools", repo: `${ORG}/trenchytools-wallet-mover`, logo: "/logos/tools/mover.svg", status: "live" },
]

export const suiteItem = (id: string): SuiteItem | undefined => [...LAUNCHERS, ...TOOLS].find((x) => x.id === id)
