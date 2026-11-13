"use client"

import { useEffect, useRef, useState } from "react"
import { failureOf, get, post } from "@/lib/api"
import { DEMO, REPO_URL, startEngine } from "@/lib/browser/demo"
import { chain } from "@/lib/chain"
import { backupAction, dismissToast, toast, toastFailure } from "./ui/toast"

/**
 * Demo mode only: the one quiet line under the top bar. Where the keys live (this browser), the backup download, the
 * repo. It also starts the browser engine as soon as any page opens.
 */
export function DemoBanner() {
  const [downloading, setDownloading] = useState(false)
  useEffect(() => { startEngine() }, [])
  // wallets whose key was never downloaded cannot be funded or used: say so, with the button, until they are backed up
  const nudge = useRef<{ id: number; count: number } | null>(null)
  useEffect(() => {
    if (!DEMO) return
    const check = () => get<{ pending?: Array<{ publicKey: string; label?: string }> }>("/api/wallets").then((r) => {
      const n = r.pending?.length ?? 0
      const names = (r.pending ?? []).slice(0, 4).map((w) => w.label || `${w.publicKey.slice(0, 4)}…${w.publicKey.slice(-4)}`).join(", ") + (n > 4 ? ` and ${n - 4} more` : "")
      if (nudge.current && nudge.current.count !== n) { dismissToast(nudge.current.id); nudge.current = null }
      if (n > 0 && !nudge.current) nudge.current = { count: n, id: toast({ tone: "warn", sticky: true, title: `${n} wallet${n === 1 ? " is" : "s are"} not backed up yet`, small: names, detail: n === 1 ? "Its key only lives in this browser, and it cannot be funded or used until you save the backup file." : "Their keys only live in this browser, and they cannot be funded or used until you save the backup file.", actions: [backupAction()] }) }
    }).catch(() => {})
    const t = setTimeout(check, 1500)
    window.addEventListener("wallets-changed", check)
    return () => { clearTimeout(t); window.removeEventListener("wallets-changed", check) }
  }, [])
  if (!DEMO) return null
  const downloadBackup = async () => {
    setDownloading(true)
    try {
      const r = await post<{ count: number; files: string[] }>("/api/wallets/backup")
      toast(r.count ? { tone: "ok", title: `Backup downloaded: ${r.count} wallet${r.count === 1 ? "" : "s"}, now usable` } : { tone: "muted", title: "Every wallet is already backed up" })
      window.dispatchEvent(new Event("wallets-changed"))
    } catch (e) { toastFailure(failureOf(e)) } finally { setDownloading(false) }
  }
  return (
    <div role="note" className="text-muted-foreground truncate border-b px-3 py-1 text-center text-[11px] sm:px-6 sm:py-1.5 sm:text-xs">
      Demo: all keys are stored in your browser.{chain.apiFeeRate > 0 ? <span className="hidden md:inline"> Trades pay a {+(chain.apiFeeRate * 100).toFixed(2)} % API fee.</span> : null}{" "}
      <button type="button" className="hover:text-foreground underline underline-offset-4" onClick={() => void downloadBackup()} disabled={downloading}>{downloading ? "Downloading…" : <>Download<span className="hidden sm:inline"> backup</span></>}</button>
      {" · "}
      <a className="hover:text-foreground underline underline-offset-4" href={REPO_URL} target="_blank" rel="noreferrer">Clone it</a><span className="hidden sm:inline"> to run locally</span>.
    </div>
  )
}
