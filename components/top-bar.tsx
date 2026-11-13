"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { BookOpen, Ellipsis, KeyRound, Settings } from "lucide-react"
import { apiFetch } from "@/lib/client"
import { chain } from "@/lib/chain"
import { cn } from "@/lib/cn"
import { LogoMark } from "./logo"
import { SuiteSwitcher } from "./suite-switcher"
import { SUITE } from "@/lib/suite"
import { Menu, MenuItem } from "./ui/menu"
import { SettingsSheet } from "./settings-sheet"
import { type Status } from "./status-strip"
import { ThemeToggle } from "./theme-toggle"

/** The launchers' pages; a tool (the wallet mover) names its own in lib/chain.ts `nav`. */
const NAV: Array<{ href: string; label: string }> = (chain as { nav?: Array<{ href: string; label: string }> }).nav ?? [
  { href: "/launch", label: "Launch" },
  { href: "/trading", label: "Trading" },
  { href: "/wallets", label: "Wallets" },
]

/**
 * Seven targets: wordmark · Launch · Trading · Wallets · one status dot (opens Settings) · Get an API key · ⋯ menu
 * (docs, examples, GitHub, theme, Settings). Everything about keys, wallets and folders lives behind the dot.
 */
export function TopBar() {
  const pathname = usePathname()
  const [status, setStatus] = useState<Status | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const refresh = useCallback(() => { void apiFetch<Status>("/api/settings/status").then(setStatus).catch(() => {}) }, [])
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 30_000)
    window.addEventListener("wallets-changed", refresh)
    // a toast's "Add API key" button (components/ui/toast.tsx) opens Settings
    const openSettings = () => setSettingsOpen(true)
    window.addEventListener("open-settings", openSettings)
    return () => { clearInterval(t); window.removeEventListener("wallets-changed", refresh); window.removeEventListener("open-settings", openSettings) }
  }, [refresh])

  // the dot: green = key accepted and a ★ wallet exists; amber = something to do; red = the key is rejected
  const pending = status?.backups.pending ?? 0
  const tone = !status ? "bg-muted-foreground" : status.api.configured && !status.api.connected ? "bg-destructive" : status.api.connected && status.funding && !pending ? "bg-ok" : "bg-warn"
  const text = !status ? "checking…" : status.api.configured && !status.api.connected ? `API key rejected${status.api.code ? ` (${status.api.code})` : ""}` : !status.api.connected ? "no API key yet" : !status.funding ? "key ok · no main wallet yet" : pending ? `${pending} wallet${pending === 1 ? "" : "s"} not backed up` : `key ok · main wallet ${status.funding.sol === null ? "" : `${status.funding.sol.toFixed(3)} ${chain.symbol}`}`

  return (
    <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur-md">
      <div className="flex h-14 w-full items-center gap-2 px-3 sm:gap-5 sm:px-6">
        <div className="flex items-center gap-1 sm:gap-1.5">
          <a href={SUITE.home} aria-label="trenchy.tools" title="trenchy.tools: every tool, the API and its docs" className="hover:bg-muted rounded-md p-1.5 transition-colors"><LogoMark small className="h-5" /></a>
          <span className="text-muted-foreground/40 text-lg font-light select-none" aria-hidden>/</span>
          <SuiteSwitcher />
        </div>
        <nav className="flex items-center gap-0.5 text-sm sm:gap-1">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cn("rounded-md px-2 py-1.5 transition-colors sm:px-2.5", pathname?.startsWith(n.href) ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <a href={SUITE.docs} className="text-muted-foreground hover:text-foreground hidden items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors lg:inline-flex"><BookOpen className="size-4" />API &amp; docs</a>
          <button type="button" onClick={() => setSettingsOpen(true)} className="text-muted-foreground hover:text-foreground hidden h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors sm:inline-flex" title={`${text}. Click for Settings.`}>
            <span className={cn("size-2 rounded-full", tone)} />
            <span className="hidden whitespace-nowrap xl:inline">{text}</span>
          </button>
          <a href={SUITE.apiKey} target="_blank" rel="noreferrer" className="bg-foreground text-background hidden h-9 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-opacity hover:opacity-90 sm:inline-flex">Get API key</a>
          <Menu trigger={() => <button type="button" aria-label="More" className="hover:bg-accent inline-flex size-9 items-center justify-center rounded-md border transition-colors"><Ellipsis className="size-4" /></button>}>
            <div className="flex items-center justify-between px-2.5 py-1.5 text-sm" onClick={(e) => e.stopPropagation()}><span>Theme</span><ThemeToggle /></div>
            <MenuItem onClick={() => setSettingsOpen(true)}><span className="inline-flex items-center gap-2"><Settings className="size-4" /> Settings</span></MenuItem>
            <div className="mt-1 border-t pt-1 lg:hidden"><a role="menuitem" href={SUITE.docs} className="hover:bg-muted flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm"><BookOpen className="size-4" />API &amp; docs</a></div>
            <a role="menuitem" href={SUITE.apiKey} target="_blank" rel="noreferrer" className="hover:bg-muted flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm sm:hidden"><KeyRound className="size-4" />Get an API key</a>
          </Menu>
        </div>
      </div>
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} status={status} onSaved={refresh} />
    </header>
  )
}
