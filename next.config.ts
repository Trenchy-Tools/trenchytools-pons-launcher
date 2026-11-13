import type { NextConfig } from "next"

/**
 * Demo mode (NEXT_PUBLIC_DEMO=1 at build time): the hosted app keeps every wallet key in the visitor's browser, so the
 * page gets a strict Content Security Policy. Scripts only from this origin, network only to this origin and the
 * TrenchyTools API (https + wss), no framing. Keys in browser storage are only as safe as the page that holds them.
 * ('unsafe-inline' scripts: Next's inline bootstrap needs them; styles: the theme switcher and Tailwind.)
 */
const DEMO = process.env.NEXT_PUBLIC_DEMO === "1"
// `next dev` only: React's dev build uses eval() for its debugging tools (call stacks, the error overlay). The production
// build (next build / next start) never gets 'unsafe-eval'.
const DEV = process.env.NODE_ENV === "development"
const CSP = [
  "default-src 'self'",
  // next dev may point the demo at a local API (NEXT_PUBLIC_TRENCHY_API_URL); production allows api.trenchy.tools only
  `connect-src 'self' https://api.trenchy.tools wss://api.trenchy.tools${DEV && process.env.NEXT_PUBLIC_TRENCHY_API_URL ? ` ${process.env.NEXT_PUBLIC_TRENCHY_API_URL} ${process.env.NEXT_PUBLIC_TRENCHY_API_URL.replace(/^http/, "ws")}` : ""}`,
  "img-src 'self' data: blob: https:",
  `script-src 'self' 'unsafe-inline'${DEV ? " 'unsafe-eval'" : ""}`,
  // the Vanity page grinds mint keys in Web Workers made from an inline blob
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // the Trading page embeds GMGN's chart widget
  "frame-src https://www.gmgn.cc",
  "frame-ancestors 'none'",
].join("; ")

const nextConfig: NextConfig = {
  // self-contained server for the Dockerfile (node server.js)
  output: "standalone",
  // the live-trades websocket client runs in route handlers on Node; keep it out of the bundle
  serverExternalPackages: ["ws"],
  async headers() {
    if (!DEMO) return []
    return [{ source: "/:path*", headers: [
      { key: "Content-Security-Policy", value: CSP },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ] }]
  },
}

export default nextConfig
