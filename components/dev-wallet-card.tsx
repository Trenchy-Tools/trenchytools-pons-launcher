"use client"

/**
 * THE DEV WALLET, one card. It creates the coin, pays for every buy, and is where "Collect" sends money back. There is
 * exactly one; no stars, no roles. No dev wallet yet → [Create dev wallet] (in demo mode the key file downloads in the
 * same click, so it is usable at once) or [Import my wallet]. One exists → its address (copy), balance, what to do next,
 * [Show key] and [Switch]. The same file in the pump.fun and pons starters; lib/chain.ts holds what differs.
 */
import * as React from "react"
import { Copy, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input, Select } from "@/components/ui/input"
import { Mono } from "@/components/ui/table"
import { toast, toastFailure } from "@/components/ui/toast"
import { copyText, failureOf, get, post, walletsChanged } from "@/lib/api"
import { DEMO } from "@/lib/browser/demo"
import { chain } from "@/lib/chain"
import { cn } from "@/lib/cn"

type Wallet = { publicKey: string; label: string }
type Folder = { wallets: Wallet[]; mainWallet: string | null; pending?: Array<{ publicKey: string }> }

/** `need`: what the next action costs (the Launch page passes the launch total), to say "short by X". */
export function DevWalletCard({ need, onChanged, className }: { need?: number; onChanged?: () => void; className?: string }) {
  const [folder, setFolder] = React.useState<Folder | null>(null)
  const [balance, setBalance] = React.useState<number | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [importing, setImporting] = React.useState(false)
  const [key, setKey] = React.useState("")
  const [shownKey, setShownKey] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    const f = await get<Folder>("/api/wallets").catch(() => null)
    if (!f) return
    setFolder(f)
    if (f.mainWallet) {
      const b = await get<{ rows: Array<{ publicKey: string; native: number }> }>("/api/wallets/balances").catch(() => null)
      setBalance(b?.rows.find((r) => r.publicKey.toLowerCase() === f.mainWallet!.toLowerCase())?.native ?? null)
    } else setBalance(null)
  }, [])
  React.useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 15_000)
    const on = () => void load()
    window.addEventListener("wallets-changed", on)
    return () => { clearInterval(t); window.removeEventListener("wallets-changed", on) }
  }, [load])

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name)
    try { await fn(); await load(); walletsChanged(); onChanged?.() } catch (e) { toastFailure(failureOf(e)) } finally { setBusy(null) }
  }
  /** Demo mode: a key that is not downloaded is not usable; download it in the same click. */
  const backup = async () => { if (DEMO) await post("/api/wallets/backup") }
  const create = () => run("create", async () => {
    await post("/api/wallets", { count: 1, label: "Dev wallet" })
    await backup()
    toast({ tone: "ok", title: "Dev wallet created", detail: DEMO ? `Its key file just downloaded: keep it safe. Now send ${chain.symbol} to the address on the card.` : `Its key is saved in the wallets folder. Now send ${chain.symbol} to the address on the card.` })
  })
  const doImport = () => run("import", async () => {
    const r = await post<{ wallet: Wallet }>("/api/wallets/import", { privateKey: key.trim(), label: "Dev wallet" })
    if (folder?.mainWallet && folder.mainWallet !== r.wallet.publicKey) await post("/api/wallets/main", { publicKey: r.wallet.publicKey })
    await backup()
    setKey(""); setImporting(false)
    toast({ tone: "ok", title: "Your wallet is now the dev wallet" })
  })
  const switchTo = (pk: string) => run("switch", async () => { await post("/api/wallets/main", { publicKey: pk }) })
  const showKey = () => run("key", async () => {
    if (shownKey) { setShownKey(null); return }
    if (!window.confirm(`Show the dev wallet's ${chain.keyNoun} on screen?\n\nAnyone who sees it controls the wallet.`)) return
    const r = await post<{ wallets: Array<{ privateKey: string }> }>("/api/wallets/export", { publicKeys: [folder!.mainWallet!] })
    setShownKey(r.wallets[0].privateKey)
  })
  const saveBackup = () => run("backup", async () => { await post("/api/wallets/backup") })

  const main = folder?.mainWallet ?? null
  const wallet = main ? folder?.wallets.find((w) => w.publicKey === main) : null
  const pending = !!main && !!folder?.pending?.some((p) => p.publicKey === main)
  const others = (folder?.wallets ?? []).filter((w) => w.publicKey !== main)

  const badge = <span className="bg-ok text-background rounded-md px-2 py-0.5 text-[11px] font-bold tracking-[0.15em] uppercase">Dev wallet</span>

  if (!folder) return <div className={cn("rounded-xl border p-4 text-sm", className)}><span className="text-muted-foreground">Loading the dev wallet…</span></div>

  if (!main) {
    return (
      <div className={cn("border-ok/50 bg-ok/5 flex flex-col gap-3 rounded-xl border-2 border-dashed p-4", className)}>
        <div className="flex flex-wrap items-center gap-2">{badge}<span className="text-sm font-semibold">You don&apos;t have one yet</span></div>
        <p className="text-muted-foreground text-sm">The dev wallet creates your coin and pays for every buy. Make one, send it {chain.symbol}, and you are ready to launch.</p>
        {others.length ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Use one you already have:</span>
            <Select className="h-9 w-72 text-sm" value="" onChange={(e) => e.target.value && void switchTo(e.target.value)} aria-label="Pick the dev wallet">
              <option value="">pick a wallet…</option>
              {others.map((w) => <option key={w.publicKey} value={w.publicKey}>{w.label} · {chain.short(w.publicKey)}</option>)}
            </Select>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button size="lg" onClick={create} disabled={!!busy}>{busy === "create" ? "Creating…" : "Create dev wallet"}</Button>
          <Button size="lg" variant="outline" onClick={() => setImporting((v) => !v)} disabled={!!busy}>I have a wallet · import it</Button>
        </div>
        {importing ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input type="password" autoComplete="off" autoFocus placeholder={`paste the ${chain.keyNoun}`} value={key} onChange={(e) => setKey(e.target.value)} className="min-w-0 flex-1 font-mono text-xs" onKeyDown={(e) => { if (e.key === "Enter" && key.trim()) doImport() }} />
            <Button onClick={doImport} disabled={!!busy || !key.trim()}>{busy === "import" ? "Importing…" : "Import"}</Button>
          </div>
        ) : null}
        {DEMO ? <p className="text-muted-foreground text-xs">The key stays in this browser and downloads to your computer as a file. Nothing is sent anywhere.</p> : null}
      </div>
    )
  }

  const empty = balance !== null && balance <= 0
  const short = need !== undefined && balance !== null && balance < need ? need - balance : 0
  const state = pending
    ? { tone: "text-destructive", text: "Save its key first: nothing can use this wallet until the key file is downloaded." }
    : empty
      ? { tone: "text-warn", text: `Send ${chain.symbol} to this address to get started.` }
      : short > 0
        ? { tone: "text-warn", text: `This launch needs ${chain.fmt(need)} ${chain.symbol}: send ${chain.fmt(short)} more.` }
        : balance === null
          ? { tone: "text-muted-foreground", text: "Reading the balance…" }
          : { tone: "text-ok", text: "Ready." }

  return (
    <div className={cn("border-ok/40 flex flex-col gap-2.5 rounded-xl border-2 p-4", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {badge}
        <span className="text-sm font-semibold">{wallet?.label ?? "Dev wallet"}</span>
        <span className="ml-auto font-mono text-xl font-semibold tabular-nums">{balance === null ? "…" : chain.fmt(balance)} <span className="text-muted-foreground text-sm font-normal">{chain.symbol}</span></span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="bg-muted hover:bg-accent inline-flex max-w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors" title="Copy the address" onClick={() => { void copyText(main); toast({ tone: "muted", title: "Dev wallet address copied" }) }}>
          <Mono className="min-w-0 truncate text-xs">{main}</Mono>
          <Copy className="text-muted-foreground size-3.5 shrink-0" />
        </button>
        <a className="text-muted-foreground hover:text-foreground" href={chain.explorerAddress(main)} target="_blank" rel="noreferrer" aria-label="Open in explorer"><ExternalLink className="size-3.5" /></a>
      </div>
      <p className={cn("text-sm font-medium", state.tone)}>{state.text}</p>
      <div className="flex flex-wrap items-center gap-2">
        {pending ? <Button size="sm" onClick={saveBackup} disabled={!!busy}>{busy === "backup" ? "Downloading…" : "Download key file"}</Button> : null}
        <Button size="sm" variant="outline" onClick={showKey} disabled={!!busy}>{shownKey ? "Hide key" : "Show key"}</Button>
        {others.length ? (
          <Select className="h-8 w-56 text-xs" value="" onChange={(e) => e.target.value && void switchTo(e.target.value)} aria-label="Use another wallet as the dev wallet" disabled={!!busy}>
            <option value="">Switch to another wallet…</option>
            {others.map((w) => <option key={w.publicKey} value={w.publicKey}>{w.label} · {chain.short(w.publicKey)}</option>)}
          </Select>
        ) : null}
      </div>
      {shownKey ? (
        <div className="flex flex-wrap items-center gap-2">
          <Mono className="bg-background rounded border px-2 py-1 text-xs break-all select-all">{shownKey}</Mono>
          <Button size="xs" variant="outline" onClick={() => { void copyText(shownKey); toast({ tone: "muted", title: "Key copied" }) }}><Copy />Copy</Button>
        </div>
      ) : null}
    </div>
  )
}
