"use client"

/**
 * THE DEV WALLET, one card. It creates the coin, pays for every buy, and is where "Collect" sends money back. There is
 * exactly one; no stars, no roles. No dev wallet yet → [Create dev wallet] (in demo mode the key file downloads in the
 * same click, so it is usable at once) or [Import my wallet]. One exists → its address (copy), balance, what to do next,
 * [Show key] and [Switch]. The same file in the pump.fun and pons starters; lib/chain.ts holds what differs.
 */
import * as React from "react"
import { Copy, KeyRound } from "lucide-react"
import { BrandIcon } from "@/components/ui/brand"
import { ask } from "@/components/ui/confirm"
import { Button } from "@/components/ui/button"
import { Input, Select } from "@/components/ui/input"
import { Menu, MenuItem } from "@/components/ui/menu"
import { Mono } from "@/components/ui/table"
import { toast, toastFailure } from "@/components/ui/toast"
import { copyText, failureOf, get, post, walletsChanged } from "@/lib/api"
import { DEMO } from "@/lib/browser/demo"
import { chain } from "@/lib/chain"
import { cn } from "@/lib/cn"
import { Q } from "@/lib/help"

type Wallet = { publicKey: string; label: string }
type Folder = { wallets: Wallet[]; mainWallet: string | null; pending?: Array<{ publicKey: string }> }

/** `need`: what the next action costs (the Launch page passes the launch total), to say "short by X". */
/** `keyButton` false hides "Key" (the Launch page leaves keys to the Wallets page). */
export function DevWalletCard({ need, onChanged, className, keyButton = true }: { need?: number; onChanged?: () => void; className?: string; keyButton?: boolean }) {
  const [folder, setFolder] = React.useState<Folder | null>(null)
  const [balance, setBalance] = React.useState<number | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [importing, setImporting] = React.useState(false)
  const [key, setKey] = React.useState("")
  const [shownKey, setShownKey] = React.useState<string | null>(null)
  /** "Replace with a key I have": the paste field under the card */
  const [replacing, setReplacing] = React.useState(false)

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
    const on = () => { void load(); setTimeout(() => void load(), 3000) }
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
    await post("/api/wallets", { count: 1, label: "Main wallet" })
    await backup()
    toast({ tone: "ok", title: "Main wallet created", detail: DEMO ? `Its key file just downloaded: keep it safe. Now send ${chain.symbol} to the address on the card.` : `Its key is saved in the wallets folder. Now send ${chain.symbol} to the address on the card.` })
  })
  const doImport = () => run("import", async () => {
    const r = await post<{ wallet: Wallet }>("/api/wallets/import", { privateKey: key.trim(), label: "Main wallet" })
    if (folder?.mainWallet && folder.mainWallet !== r.wallet.publicKey) await post("/api/wallets/main", { publicKey: r.wallet.publicKey })
    await backup()
    setKey(""); setImporting(false)
    toast({ tone: "ok", title: "Your wallet is now the main wallet" })
  })
  const switchTo = (pk: string) => run("switch", async () => { await post("/api/wallets/main", { publicKey: pk }) })
  const showKey = () => run("key", async () => {
    if (shownKey) { setShownKey(null); return }
    if (!await ask(`Show the main wallet's ${chain.keyNoun} on screen?\n\nAnyone who sees it controls the wallet.`)) return
    const r = await post<{ wallets: Array<{ privateKey: string }> }>("/api/wallets/export", { publicKeys: [folder!.mainWallet!] })
    setShownKey(r.wallets[0].privateKey)
  })
  const saveBackup = () => run("backup", async () => { await post("/api/wallets/backup") })

  // ── replace / archive the main wallet ────────────────────────────────────
  const funds = balance !== null && balance > 0.00001
  const fundsText = funds ? `${chain.fmt(balance)} ${chain.symbol}` : ""
  /** The old main wallet hands over: its SOL goes to the new one (all of it), then it is archived (key kept, restorable). */
  const retire = async (oldPk: string, newPk: string) => {
    if (funds) await post("/api/wallets/send", { publicKeys: [oldPk], to: newPk, amount: "max" })
    await post("/api/wallets/archive", { publicKeys: [oldPk], allowMain: true })
  }
  const replaceNote = `${funds ? ` Its ${fundsText} moves to the new one first.` : ""} The current one is archived: its key is kept, and Archived wallets → Restore brings it back. Coins it holds stay in it.`
  const replaceWithNew = () => run("replace", async () => {
    if (!await ask(`Replace the main wallet with a new one?\n\nA fresh wallet becomes the main wallet.${replaceNote}`, { confirmLabel: "Replace" })) return
    const old = main!
    const r = await post<{ wallets: Array<{ publicKey: string }> }>("/api/wallets", { count: 1, label: "Main wallet" })
    await backup()
    const pk = r.wallets[0].publicKey
    await post("/api/wallets/main", { publicKey: pk })
    await retire(old, pk)
    toast({ tone: "ok", title: "New main wallet ready", detail: `${funds ? `${fundsText} moved over; ` : ""}the old one is under Archived wallets.${DEMO ? " Its key file just downloaded." : ""}` })
  })
  const replaceWithKey = () => run("replace", async () => {
    const old = main!
    if (!await ask(`Make the pasted wallet the main wallet?\n\nThe key you pasted becomes the main wallet.${replaceNote}`, { confirmLabel: "Replace" })) return
    const r = await post<{ wallet: Wallet }>("/api/wallets/import", { privateKey: key.trim(), label: "Main wallet" })
    if (r.wallet.publicKey === old) throw { error: "That key is already the main wallet" }
    await backup()
    await post("/api/wallets/main", { publicKey: r.wallet.publicKey })
    await retire(old, r.wallet.publicKey)
    setKey(""); setReplacing(false)
    toast({ tone: "ok", title: "Your wallet is now the main wallet", detail: `${funds ? `${fundsText} moved over from the old one; ` : ""}the old one is under Archived wallets.` })
  })
  const archiveMain = () => run("archive-main", async () => {
    if (!await ask(`Archive the main wallet?\n\n${funds ? `It still holds ${fundsText}, which stays in it. ` : ""}Its key is kept, and Archived wallets → Restore brings it back. You then make a new main wallet or import one before the next launch.`, { danger: true })) return
    await post("/api/wallets/archive", { publicKeys: [main!], allowMain: true })
    toast({ tone: "ok", title: "Main wallet archived", detail: "Make a new one or import a key on the card." })
  })

  const main = folder?.mainWallet ?? null
  const wallet = main ? folder?.wallets.find((w) => w.publicKey === main) : null
  const pending = !!main && !!folder?.pending?.some((p) => p.publicKey === main)
  const others = (folder?.wallets ?? []).filter((w) => w.publicKey !== main)

  const badge = <span className="bg-brand text-background rounded-md px-2 py-0.5 text-[11px] font-bold tracking-[0.15em] uppercase">Main wallet</span>

  if (!folder) return <div className={cn("rounded-xl border p-4 text-sm", className)}><span className="text-muted-foreground">Loading the main wallet…</span></div>

  if (!main) {
    return (
      <div className={cn("border-brand/50 bg-brand/5 flex flex-col gap-3 rounded-xl border-2 border-dashed p-4", className)}>
        <div className="flex flex-wrap items-center gap-2">{badge}<Q k="mainWallet" /><span className="text-sm font-semibold">You don&apos;t have one yet</span></div>
        <p className="text-muted-foreground text-sm">The main wallet creates your coin and pays for every buy. Make one, send it {chain.symbol}, and you are ready to launch.</p>
        {others.length ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Use one you already have:</span>
            <Select className="h-9 w-72 text-sm" value="" onChange={(e) => e.target.value && void switchTo(e.target.value)} aria-label="Pick the main wallet">
              <option value="">pick a wallet…</option>
              {others.map((w) => <option key={w.publicKey} value={w.publicKey}>{w.label} · {chain.short(w.publicKey)}</option>)}
            </Select>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button size="lg" onClick={create} disabled={!!busy}>{busy === "create" ? "Creating…" : "Create main wallet"}</Button>
          <Button size="lg" variant="outline" onClick={() => setImporting((v) => !v)} disabled={!!busy}>I have a wallet · import it</Button>
        </div>
        {importing ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input type="password" autoComplete="off" autoFocus placeholder={`paste the ${chain.keyNoun}`} value={key} onChange={(e) => setKey(e.target.value)} className="min-w-0 flex-1 font-mono text-xs" onKeyDown={(e) => { if (e.key === "Enter" && key.trim()) doImport() }} />
            <Button onClick={doImport} disabled={!!busy || !key.trim()}>{busy === "import" ? "Importing…" : "Import"}</Button>
          </div>
        ) : null}
        {DEMO ? <p className="text-muted-foreground text-xs">All keys are stored in your browser. Always download your backup.</p> : null}
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
        ? { tone: "text-destructive", text: `Not enough ${chain.symbol} for this launch: send ${chain.fmt(short)} more (it needs ${chain.fmt(need)}).` }
        : balance === null
          ? { tone: "text-muted-foreground", text: "Reading the balance…" }
          : { tone: "text-ok", text: "● Ready." }

  return (
    <div className={cn("border-brand/50 bg-brand/[0.04] flex flex-col gap-1.5 rounded-xl border-2 px-4 py-3", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex items-center gap-1.5">{badge}<Q k="mainWallet" /></span>
        <button type="button" className="hover:bg-accent inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors" title={`${main} · click to copy`} onClick={() => { void copyText(main); toast({ tone: "muted", title: "Main wallet address copied" }) }}>
          <Mono className="min-w-0 truncate text-xs">{main.slice(0, 6)}…{main.slice(-6)}</Mono>
          <Copy className="text-muted-foreground size-3.5 shrink-0" />
        </button>
        <a className="-ml-1.5 inline-flex opacity-70 transition-opacity hover:opacity-100" href={chain.explorerAddress(main)} target="_blank" rel="noreferrer" aria-label={`Open on ${chain.explorer.name}`} title={`Open on ${chain.explorer.name}`}><BrandIcon src={chain.explorer.logo} label={chain.explorer.name} size={15} /></a>
        {keyButton ? (
          <button type="button" onClick={showKey} disabled={!!busy} aria-label={shownKey ? "Hide the key" : "Show the key"} title={shownKey ? "Hide the key" : "Show the private key"}
            className={cn("hover:bg-accent text-muted-foreground hover:text-foreground -ml-1.5 inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] transition-colors disabled:opacity-50", shownKey && "bg-accent text-foreground")}>
            <KeyRound className="size-3.5" />{shownKey ? "Hide" : "Key"}
          </button>
        ) : null}
        <span className="ml-auto font-mono text-lg font-semibold tabular-nums">{balance === null ? "…" : chain.fmt(balance)} <span className="text-muted-foreground inline-flex items-center gap-1 text-xs font-normal"><BrandIcon src={chain.logo} label={chain.name} size={13} />{chain.symbol}</span></span>
        <span className="flex items-center gap-1">
          {pending ? <Button size="xs" onClick={saveBackup} disabled={!!busy}>{busy === "backup" ? "Downloading…" : "Download key file"}</Button> : null}
          <Menu trigger={(open) => <Button size="xs" variant="ghost" disabled={!!busy}>{busy === "replace" ? "Replacing…" : `Change ${open ? "▴" : "▾"}`}</Button>}>
            <p className="text-muted-foreground px-2.5 pt-1 pb-1 text-[11px] tracking-wide uppercase">Replace the main wallet</p>
            <MenuItem onClick={() => { setReplacing(true); setImporting(false) }} hint={`paste its key${funds ? `; the ${fundsText} here moves to it` : ""}; this one is archived`}>With a key I have</MenuItem>
            <MenuItem onClick={() => void replaceWithNew()} hint={`a fresh wallet${funds ? `; the ${fundsText} here moves to it` : ""}; this one is archived`}>With a new wallet</MenuItem>
            {others.length ? (
              <>
                <p className="text-muted-foreground border-t px-2.5 pt-2 pb-1 text-[11px] tracking-wide uppercase">Or use one of my wallets</p>
                <div className="max-h-48 overflow-y-auto">
                  {others.map((w) => <MenuItem key={w.publicKey} onClick={() => void switchTo(w.publicKey)}>{w.label} <span className="text-muted-foreground font-mono text-xs">· {chain.short(w.publicKey)}</span></MenuItem>)}
                </div>
              </>
            ) : null}
            <div className="mt-1 border-t pt-1"><MenuItem danger onClick={() => void archiveMain()} hint="its key is kept; you then make or import a new one">Archive this main wallet</MenuItem></div>
          </Menu>
        </span>
      </div>
      <p className="text-xs">
        <span className={cn("font-medium", state.tone)}>{state.text}</span>
        <span className="text-muted-foreground"> Creates your coin and pays for every buy.</span>
      </p>
      {replacing ? (
        <div className="flex flex-wrap items-center gap-2 border-t pt-2">
          <span className="text-muted-foreground text-xs">New main wallet:</span>
          <Input type="password" autoComplete="off" autoFocus placeholder={`paste its ${chain.keyNoun}`} value={key} onChange={(e) => setKey(e.target.value)} className="h-8 min-w-0 flex-1 font-mono text-xs" onKeyDown={(e) => { if (e.key === "Enter" && key.trim()) void replaceWithKey() }} aria-label="The new main wallet's key" />
          <Button size="sm" onClick={() => void replaceWithKey()} disabled={!!busy || !key.trim()}>{busy === "replace" ? "Replacing…" : "Replace"}</Button>
          <Button size="sm" variant="ghost" onClick={() => { setReplacing(false); setKey("") }}>Cancel</Button>
          <p className="text-muted-foreground w-full text-[11px]">{funds ? `The ${fundsText} in the current main wallet moves to it, then the current one is archived (restorable).` : "The current main wallet is archived (restorable)."}</p>
        </div>
      ) : null}
      {shownKey ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Mono className="bg-background rounded border px-2 py-1 text-xs break-all select-all">{shownKey}</Mono>
          <Button size="xs" variant="outline" onClick={() => { void copyText(shownKey); toast({ tone: "muted", title: "Key copied" }) }}><Copy />Copy</Button>
        </div>
      ) : null}
    </div>
  )
}
