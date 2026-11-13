import type { Metadata } from "next"
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google"
import { DemoBanner } from "@/components/demo-banner"
import { Providers } from "@/components/providers"
import { TopBar } from "@/components/top-bar"
import { Toaster } from "@/components/ui/toast"
import { ConfirmHost } from "@/components/ui/confirm"
import { chain } from "@/lib/chain"
import { suiteItem } from "@/lib/suite"
import "./globals.css"

const sans = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" })
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-ibm-plex-mono" })

const DESCRIPTION = `${(chain as { description?: string }).description ?? `Launch, bundle and trade ${chain.launchpad} coins on the TrenchyTools API`}${process.env.NEXT_PUBLIC_DEMO === "1" ? ", from your browser" : ""}.`
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? suiteItem(chain.suiteId)?.url ?? "https://trenchy.tools"),
  openGraph: { type: "website", siteName: "TrenchyTools", title: `${chain.appName} · TrenchyTools`, description: DESCRIPTION, images: [{ url: "/og.png", width: 1280, height: 640, alt: `${chain.appName} on the TrenchyTools API` }] },
  twitter: { card: "summary_large_image", site: "@trenchytools", title: `${chain.appName} · TrenchyTools`, description: DESCRIPTION, images: ["/og.png"] },
  title: { default: `${chain.appName} · TrenchyTools`, template: `%s · ${chain.appName}` },
  description: DESCRIPTION,
  icons: { icon: "/icon.svg" },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <body className="bg-background text-foreground min-h-dvh font-sans antialiased">
        <Providers>
          <TopBar />
          <DemoBanner />
          <main className="mx-auto w-full max-w-6xl px-3 py-3 sm:px-6 sm:py-6">{children}</main>
          <Toaster />
          <ConfirmHost />
        </Providers>
      </body>
    </html>
  )
}
