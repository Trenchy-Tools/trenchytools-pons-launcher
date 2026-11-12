"use client"

/**
 * Wallets, the simple way.
 *
 *   ┌ DEV WALLET ┐  the one wallet that creates coins and pays for everything (components/dev-wallet-card.tsx)
 *   Buyer wallets   + Add wallets · Import · then, over EVERY buyer wallet (or only the ticked ones):
 *                   Fund [x] each from the dev wallet · Collect everything back to the dev wallet · More ▾
 *   one row each    name · address · balance · coin balance · [Fund] [Key] [⋯ make dev wallet / rename / archive]
 *
 * Ticking rows is optional: nothing needs a selection, it only narrows what the buttons act on.
 * This file is the same in the pump.fun and pons starters; lib/chain.ts holds what differs.
 */
import * as React from "react"
import { Check, Copy, Ellipsis, RefreshCw, X } from "lucide-react"
import { BrandIcon } from "@/components/ui/brand"
import { ask } from "@/components/ui/confirm"
import { DevWalletCard } from "@/components/dev-wallet-card"
import { FailureBox } from "@/components/failure"
import { Button } from "@/components/ui/button"
import { Checkbox, Input, Select } from "@/components/ui/input"
import { Menu, MenuItem } from "@/components/ui/menu"
import { Pill } from "@/components/ui/pill"
import { Mono, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { toast, toastFailure } from "@/components/ui/toast"
import { copyText, downloadText, failureOf, get, post, readChosenCoin, walletsChanged, writeChosenCoin, type ChosenCoin, type Failure } from "@/lib/api"
import { chain } from "@/lib/chain"
import { DEMO } from "@/lib/browser/demo"
import { Q } from "@/lib/help"

type Wallet = { publicKey: string; label: string; role: string; createdAt: string; file: string }
/** `pending`: demo mode only, the wallets whose key has not been downloaded yet (not usable until it is). */
type Folder = { dir: string; wallets: Wallet[]; mainWallet: string | null; archived: number; missing: Array<{ publicKey: string; label: string }>; pending?: Array<{ publicKey: string; label: string }> }
type Row = { publicKey: string; native: number; tokens?: number }
type Venues = { exchange: string; venues: Record<string, { status: string; reason?: string; default?: boolean }> }
/** One exchange leg, as either starter's fund-exchange route answers it (`signature` on Solana, `depositHash` on EVM). */
type Leg = { publicKey: string; transferId?: string; status?: string; venue?: string | null; error?: string; code?: string; receipt?: string; signature?: string; depositHash?: string }
type Archived = { publicKey: string; label: string; createdAt: string; archivedAt?: string; native: number | null }
type Sent = { publicKey: string; signature?: string; hash?: string; error?: string; code?: string; skipped?: string; recovered?: number; eth?: number }

const LEG_FINAL = ["completed", "failed", "expired", "refunded", "cancelled"]

export default function WalletsPage() {
  const [folder, setFolder] = React.useState<Folder | null>(null)
  const [rows, setRows] = React.useState<Map<string, Row>>(new Map())
  const [coin, setCoin] = React.useState<ChosenCoin | null>(null)
  const [failure, setFailure] = React.useState<Failure | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState("")
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [venues, setVenues] = React.useState<Venues | null>(null)
  const [legs, setLegs] = React.useState<Leg[]>([])
  const [archived, setArchived] = React.useState<Archived[] | null>(null)
  const [archivedOpen, setArchivedOpen] = React.useState(false)

  const [newCount, setNewCount] = React.useState("3")
  const [importOpen, setImportOpen] = React.useState(false)
  const [importKey, setImportKey] = React.useState("")
  const [editing, setEditing] = React.useState<{ publicKey: string; label: string } | null>(null)
  const [funding, setFunding] = React.useState<{ publicKey: string; amount: string } | null>(null)
  const [shownKey, setShownKey] = React.useState<{ publicKey: string; privateKey: string } | null>(null)
  const [each, setEach] = React.useState(chain.defaultEach)
  // the two panels "More ▾" opens
  const [panel, setPanel] = React.useState<"send" | "exchange" | null>(null)
  const [sendTo, setSendTo] = React.useState("")
  const [sendAmt, setSendAmt] = React.useState("")
  const [mode, setMode] = React.useState<"float" | "fixed" | "private">("float")
  const [venue, setVenue] = React.useState("random")

  const main = folder?.mainWallet ?? null
  const buyers = (folder?.wallets ?? []).filter((w) => w.publicKey !== main)
  const q = search.trim().toLowerCase()
  const shown = q ? buyers.filter((w) => w.label.toLowerCase().includes(q) || w.publicKey.toLowerCase().includes(q)) : buyers
  const ticked = [...selected].filter((pk) => buyers.some((w) => w.publicKey === pk))
  /** What the buttons act on: the ticked rows, or every buyer wallet when none is ticked. */
  const targets = ticked.length ? ticked : buyers.map((w) => w.publicKey)
  const scope = ticked.length ? `${ticked.length} ticked` : `all ${buyers.length}`
  const row = (pk: string) => rows.get(pk.toLowerCase())
  const total = buyers.reduce((s, w) => s + (row(w.publicKey)?.native ?? 0), 0)

  React.useEffect(() => { setCoin(readChosenCoin()) }, [])

  const load = React.useCallback(async (withBalances = true) => {
    try {
      const f = await get<Folder>("/api/wallets")
      setFolder(f)
      setFailure(null)
      if (f.archived) get<{ wallets: Archived[] }>("/api/wallets/archived").then((r) => setArchived(r.wallets)).catch(() => {})
      else setArchived([])
      if (withBalances && f.wallets.length) {
        const c = readChosenCoin()
        const r = await get<{ rows: Row[] }>(`/api/wallets/balances${c?.coin ? `?${chain.coinParam}=${encodeURIComponent(c.coin)}` : ""}`).catch((e) => { setFailure(failureOf(e)); return { rows: [] as Row[] } })
        setRows(new Map(r.rows.map((x) => [x.publicKey.toLowerCase(), x])))
      }
    } catch (e) {
      setFailure(failureOf(e))
    }
  }, [])
  React.useEffect(() => { void load() }, [load])
  React.useEffect(() => {
    const on = () => void load()
    window.addEventListener("wallets-changed", on)
    return () => window.removeEventListener("wallets-changed", on)
  }, [load])
  React.useEffect(() => { get<Venues>("/api/transfer/venues").then(setVenues).catch(() => setVenues(null)) }, [])

  // follow exchange legs until they are final (GET /api/transfer/:id)
  React.useEffect(() => {
    const open = legs.filter((l) => l.transferId && !LEG_FINAL.includes(l.status ?? "") && l.status !== "sent-final")
    if (!open.length) return
    const t = setTimeout(async () => {
      const next = await Promise.all(legs.map(async (l) => {
        if (!open.includes(l)) return l
        const s = await get<{ status: string; venue: string | null; receipt?: string; reason?: string }>(`/api/transfer/${l.transferId}`).catch(() => null)
        return s ? { ...l, status: s.status, venue: s.venue ?? l.venue, receipt: s.receipt ?? l.receipt, error: s.reason ?? l.error } : l
      }))
      setLegs(next)
    }, 5000)
    return () => clearTimeout(t)
  }, [legs])

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name)
    try { await fn() } catch (e) { toastFailure(failureOf(e)) } finally { setBusy(null) }
  }
  /** After an action: balances right away, then again at 2.5 s and 7 s, because the chain needs a moment to show a transfer. */
  const later = () => { setTimeout(() => void load(), 2500); setTimeout(() => { void load(); walletsChanged() }, 7000) }
  const refreshAfter = () => { void load(); walletsChanged(); later() }
  const changed = async () => { await load(); walletsChanged(); later() }
  const toggle = (pk: string) => setSelected((s) => { const n = new Set(s); if (n.has(pk)) n.delete(pk); else n.add(pk); return n })
  const tx = (x: Sent) => x.signature ?? x.hash
  const sentLines = (results: Sent[], word: (x: Sent) => React.ReactNode) => (
    <span className="flex flex-col gap-0.5">
      {results.map((x) => (
        <span key={x.publicKey} className="flex flex-wrap items-center gap-1.5">
          <Mono className="text-xs">{chain.short(x.publicKey)}</Mono>
          {x.error ? <span className="text-destructive">{x.error}{x.code ? ` · ${x.code}` : ""}</span> : x.skipped ? <span>{x.skipped}</span> : word(x)}
          {tx(x) ? <a className="underline underline-offset-4" href={chain.explorerTx(tx(x)!)} target="_blank" rel="noreferrer"><Mono className="text-xs">{chain.short(tx(x)!)}</Mono></a> : null}
        </span>
      ))}
    </span>
  )

  // ── actions ───────────────────────────────────────────────────────────────
  const createWallets = () => run("create", async () => {
    const n = Math.max(1, Math.min(100, Math.floor(Number(newCount)) || 1))
    const r = await post<{ dir: string; wallets: Array<Wallet & { path: string }>; mainWallet: string | null }>("/api/wallets", { count: n })
    if (DEMO) await post("/api/wallets/backup")
    toast({ tone: "ok", title: `${r.wallets.length} new wallet${r.wallets.length === 1 ? "" : "s"} added`, detail: DEMO ? "Their key file just downloaded: keep it safe." : <>Keys saved to <span className="font-mono text-xs break-all">{r.dir}</span></> })
    await changed()
  })
  const importWallet = () => run("import", async () => {
    const r = await post<{ dir: string; wallet: Wallet & { path: string; existed: boolean } }>("/api/wallets/import", { privateKey: importKey.trim() })
    if (DEMO) await post("/api/wallets/backup")
    setImportKey(""); setImportOpen(false)
    toast({ tone: "ok", title: r.wallet.existed ? `${r.wallet.label} was already here` : `Imported ${r.wallet.label}` })
    await changed()
  })
  const makeDev = (pk: string) => run(`dev:${pk}`, async () => {
    await post("/api/wallets/main", { publicKey: pk })
    toast({ tone: "ok", title: `${buyers.find((w) => w.publicKey === pk)?.label ?? "That wallet"} is now the main wallet` })
    await changed()
  })
  const saveEdit = () => run("rename", async () => {
    if (!editing) return
    await post("/api/wallets/update", { publicKey: editing.publicKey, label: editing.label })
    setEditing(null)
    await changed()
  })
  const fund = (publicKeys: string[], amount: string) => run("fund", async () => {
    const a = Number(amount)
    if (!(a > 0)) throw { error: `Enter the ${chain.symbol} amount each wallet gets` }
    if (!publicKeys.length) throw { error: "Add some buyer wallets first" }
    const r = await post<{ results: Sent[] }>("/api/wallets/fund", { publicKeys, amount: a })
    setFunding(null)
    const failed = r.results.filter((x) => x.error).length
    toast({ tone: failed ? "error" : "ok", sticky: failed > 0, title: `Funded ${r.results.length - failed}/${r.results.length} wallet${r.results.length === 1 ? "" : "s"} · ${a} ${chain.symbol} each from the main wallet`, detail: sentLines(r.results, () => <span>+{a} {chain.symbol}</span>) })
    refreshAfter()
  })
  const collect = () => run("collect", async () => {
    if (!targets.length) throw { error: "No buyer wallets to collect from" }
    if (!await ask(`Send everything from ${scope} buyer wallet${targets.length === 1 ? "" : "s"} back to the main wallet?`)) return
    const r = await post<{ to: string; results: Sent[] }>("/api/wallets/gather", { publicKeys: targets })
    const got = r.results.reduce((s, x) => s + (x.recovered ?? x.eth ?? 0), 0)
    const failed = r.results.filter((x) => x.error).length
    toast({ tone: failed ? "error" : "ok", sticky: failed > 0, title: `Collected ${chain.fmt(got)} ${chain.symbol} into the main wallet`, detail: sentLines(r.results, (x) => <span>{chain.fmt(x.recovered ?? x.eth)} {chain.symbol}</span>) })
    refreshAfter()
  })
  const fundViaExchange = () => run("exchange", async () => {
    const a = Number(each)
    if (!(a > 0)) throw { error: `Enter the ${chain.symbol} amount each wallet gets` }
    const r = await post<{ batchId?: string; legs: Leg[] }>("/api/wallets/fund-exchange", { publicKeys: targets, amount: a, mode, venue })
    setLegs(r.legs)
    const failed = r.legs.filter((l) => l.error).length
    toast({ tone: failed ? "error" : "ok", sticky: failed > 0, title: `Fund via exchange: ${r.legs.length - failed}/${r.legs.length} order${r.legs.length === 1 ? "" : "s"} opened · ${a} ${chain.symbol} each`, detail: failed ? r.legs.filter((l) => l.error).map((l) => `${chain.short(l.publicKey)}: ${l.error}${l.code ? ` · ${l.code}` : ""}`).join("; ") : "Each wallet is paid by an exchange, not by the main wallet. The list below updates until they complete." })
    refreshAfter()
  })
  const sendDirect = (amount: string | "max") => run("send", async () => {
    const to = sendTo.trim()
    if (!chain.isAddress(to)) throw { error: "Pick or paste the address to send to" }
    const a = amount === "max" ? "max" : Number(amount)
    if (a !== "max" && !(a > 0)) throw { error: `Enter the ${chain.symbol} amount each wallet sends, or press Send everything` }
    const from = targets.filter((pk) => pk.toLowerCase() !== to.toLowerCase())
    if (!from.length) throw { error: "The only wallet is the destination" }
    if (!await ask(`Send ${a === "max" ? "everything (minus the fee)" : `${a} ${chain.symbol}`} from ${from.length} wallet${from.length === 1 ? "" : "s"} to ${chain.short(to)}?`)) return
    const r = await post<{ to: string; results: Sent[] }>("/api/wallets/send", { publicKeys: from, to, amount: a })
    const sent = r.results.reduce((s, x) => s + (x.recovered ?? x.eth ?? 0), 0)
    const failed = r.results.filter((x) => x.error).length
    toast({ tone: failed ? "error" : "ok", sticky: failed > 0, title: `Sent ${chain.fmt(sent)} ${chain.symbol} to ${chain.short(to)}`, detail: sentLines(r.results, (x) => <span>{chain.fmt(x.recovered ?? x.eth ?? 0)} {chain.symbol}</span>) })
    refreshAfter()
  })
  const closeAccounts = () => run("close", async () => {
    const r = await post<{ totalClosed: number; results: Array<{ publicKey: string; closed: number; error?: string }> }>("/api/wallets/close-accounts", { publicKeys: targets })
    const failed = r.results.filter((x) => x.error)
    toast({ tone: failed.length ? "error" : "ok", sticky: failed.length > 0, title: `Closed ${r.totalClosed} empty token account${r.totalClosed === 1 ? "" : "s"}; the rent went to the main wallet`, detail: failed.length ? failed.map((x) => `${chain.short(x.publicKey)}: ${x.error}`).join("; ") : undefined })
    refreshAfter()
  })
  const showKey = (pk: string) => run(`key:${pk}`, async () => {
    if (shownKey?.publicKey === pk) { setShownKey(null); return }
    if (!await ask(`Show the ${chain.keyNoun} of this wallet on screen?\n\nAnyone who sees it controls the wallet.`)) return
    const r = await post<{ wallets: Array<{ publicKey: string; privateKey: string }> }>("/api/wallets/export", { publicKeys: [pk] })
    setShownKey({ publicKey: pk, privateKey: r.wallets[0].privateKey })
  })
  const exportKeys = () => run("export", async () => {
    const pks = [...(main ? [main] : []), ...targets]
    if (!await ask(`Download the ${chain.keyNoun}s of ${pks.length} wallet${pks.length === 1 ? "" : "s"} as a file?\n\nAnyone with the file controls the wallets.`)) return
    const r = await post<{ wallets: Array<{ publicKey: string; privateKey: string; label: string }> }>("/api/wallets/export", { publicKeys: pks })
    downloadText(`wallet-keys-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`, JSON.stringify(r.wallets.map((w) => ({ label: w.label, publicKey: w.publicKey, privateKey: w.privateKey, chain: chain.name })), null, 2))
    toast({ tone: "ok", title: `Downloaded ${r.wallets.length} key${r.wallets.length === 1 ? "" : "s"}` })
  })
  const archive = (pks: string[]) => run("archive", async () => {
    const holding = pks.filter((pk) => (row(pk)?.native ?? 0) > 0)
    const msg = `Archive ${pks.length} wallet${pks.length === 1 ? "" : "s"}?\n\nThey leave the list and are never used; the keys are kept, nothing is deleted. Restore them any time under Archived wallets.` + (holding.length ? `\n\n${holding.length} of them still hold ${chain.symbol}: Collect first if you want it back.` : "")
    if (!await ask(msg)) return
    const r = await post<{ archived: string[] }>("/api/wallets/archive", { publicKeys: pks })
    setSelected(new Set())
    toast({ tone: "ok", title: `Archived ${r.archived.length} wallet${r.archived.length === 1 ? "" : "s"}` })
    await changed()
  })
  const restore = (pks: string[]) => run(`restore:${pks.join(",")}`, async () => {
    const r = await post<{ restored: string[] }>("/api/wallets/unarchive", { publicKeys: pks })
    toast({ tone: "ok", title: `Restored ${r.restored.length} wallet${r.restored.length === 1 ? "" : "s"}`, detail: "They are back in the list and can be funded, traded and collected." })
    await changed()
  })
  const rewrite = () => run("rewrite", async () => {
    const r = await post<{ dir: string; files: number; restored: string[]; csvAdded: number }>("/api/wallets/rewrite-backups")
    toast({ tone: "ok", title: `Backups rewritten: ${r.files} wallet file${r.files === 1 ? "" : "s"}`, detail: `${r.restored.length} restored from wallets.csv · ${r.csvAdded} CSV line${r.csvAdded === 1 ? "" : "s"} added · ${r.dir}` })
    await changed()
  })
  const downloadBackup = () => run("backup", async () => {
    const r = await post<{ count: number; files: string[] }>("/api/wallets/backup")
    toast(r.count ? { tone: "ok", title: `Key file downloaded: ${r.count} wallet${r.count === 1 ? "" : "s"}, now usable` } : { tone: "muted", title: "Every wallet is already backed up" })
    await changed()
  })
  const exportAll = () => run("export-all", async () => {
    if (!await ask(`Download every ${chain.keyNoun} stored in this browser?\n\nAnyone with the file controls the wallets.`)) return
    const r = await post<{ count: number; files: string[] }>("/api/wallets/export-all")
    toast({ tone: "ok", title: `Downloaded ${r.count} key${r.count === 1 ? "" : "s"}` })
  })
  const clearCoin = () => { writeChosenCoin(null); setCoin(null); void load() }

  const venueList = venues ? Object.entries(venues.venues) : []
  const noMain = !main
  const pending = (folder?.pending ?? []).filter((p) => p.publicKey !== main)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Wallets</h1>
        <p className="text-muted-foreground text-sm">Your main wallet pays for everything. Buyer wallets buy your coin; fund them from the main wallet and collect it all back when you are done.</p>
      </div>

      <DevWalletCard onChanged={() => void load()} />

      <FailureBox failure={failure} />
      {folder && folder.missing.length > 0 ? (
        <div className="border-destructive/40 bg-destructive/5 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <span className="text-destructive font-medium">{folder.missing.length} wallet{folder.missing.length === 1 ? "" : "s"} in wallets.csv have no file.</span>
          <Button size="xs" variant="outline" className="ml-auto" onClick={rewrite} disabled={!!busy}>Rewrite backups</Button>
        </div>
      ) : null}
      {pending.length > 0 ? (
        <div className="border-destructive/40 bg-destructive/5 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <span className="text-destructive font-medium">{pending.length} wallet{pending.length === 1 ? "'s key is" : "s' keys are"} not saved yet, so {pending.length === 1 ? "it" : "they"} can&apos;t be used.</span>
          <Button size="sm" className="ml-auto" onClick={downloadBackup} disabled={!!busy}>{busy === "backup" ? "Downloading…" : "Download key file"}</Button>
        </div>
      ) : null}

      {/* ── buyer wallets ── */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-1 inline-flex items-center gap-1.5 text-[15px] font-semibold">Buyer wallets <span className="text-muted-foreground font-normal">{buyers.length}{buyers.length ? ` · ${chain.fmt(total)} ${chain.symbol}` : ""}</span></h2>
          <span className="inline-flex items-center gap-1">
            <Button size="sm" onClick={createWallets} disabled={!!busy}>{busy === "create" ? "Adding…" : "+ Add"}</Button>
            <Input inputMode="numeric" value={newCount} onChange={(e) => setNewCount(e.target.value)} className="h-8 w-12 text-center font-mono" aria-label="How many wallets to add" />
            <span className="text-muted-foreground text-xs">wallets</span>
          </span>
          <Button size="sm" variant="outline" onClick={() => setImportOpen((v) => !v)} disabled={!!busy}>Import a key</Button>
          <Button variant="ghost" size="icon-sm" aria-label="Refresh" title="Refresh the balances" onClick={() => void load()} disabled={!!busy}><RefreshCw /></Button>
          {coin ? (
            <Pill className="ml-auto" title={`The coin you opened on Trading: its balance per wallet is the ${coin.symbol ?? "Tokens"} column`}>
              {coin.symbol ?? chain.short(coin.coin)}
              <button type="button" aria-label="Hide the coin column" onClick={clearCoin} className="hover:text-foreground"><X className="size-3" /></button>
            </Pill>
          ) : null}
        </div>
        {importOpen ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
            <Input type="password" autoComplete="off" autoFocus placeholder={`paste a ${chain.keyNoun}`} value={importKey} onChange={(e) => setImportKey(e.target.value)} className="min-w-0 flex-1 font-mono text-xs" onKeyDown={(e) => { if (e.key === "Enter" && importKey.trim()) importWallet() }} />
            <Button onClick={importWallet} disabled={!!busy || !importKey.trim()}>{busy === "import" ? "Importing…" : "Import"}</Button>
            <Button variant="ghost" onClick={() => { setImportOpen(false); setImportKey("") }} disabled={busy === "import"}>Cancel</Button>
          </div>
        ) : null}

        {/* the actions, all in view: they act on every buyer wallet, or on the ticked ones */}
        {buyers.length > 0 ? (
          <div className="bg-muted/40 flex flex-col gap-2.5 rounded-xl border px-3 py-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{ticked.length ? `${ticked.length} ticked` : "All wallets"}</span>
              {ticked.length ? <button type="button" className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4" onClick={() => setSelected(new Set())}>untick</button> : null}
              <span className="bg-border mx-1 h-5 w-px" />
              <span className="text-muted-foreground">Give each</span>
              <Input inputMode="decimal" value={each} onChange={(e) => setEach(e.target.value)} className="h-8 w-20 font-mono" aria-label="Amount each" />
              <span className="text-muted-foreground">{chain.symbol}</span>
              <Button size="sm" onClick={() => void fund(targets, each)} disabled={!!busy || noMain} title={noMain ? "Create the main wallet first" : `Send ${each} ${chain.symbol} from the main wallet to each of the ${scope} wallets`}>{busy === "fund" ? "Sending…" : "Fund"}</Button>
              <Q k="fundAll" />
              <span className="bg-border mx-1 h-5 w-px" />
              <Button size="sm" variant="outline" onClick={collect} disabled={!!busy || noMain} title={`Every wallet sends its whole ${chain.symbol} balance (minus the fee) back to the main wallet`}>{busy === "collect" ? "Collecting…" : "Collect all to main wallet"}</Button>
              <Q k="collectAll" />
            </div>
            <div className="flex flex-wrap items-center gap-1.5 border-t pt-2.5">
              <Button size="xs" variant={panel === "send" ? "secondary" : "outline"} onClick={() => setPanel(panel === "send" ? null : "send")} disabled={!!busy}>Send to an address</Button>
              <Button size="xs" variant={panel === "exchange" ? "secondary" : "outline"} onClick={() => setPanel(panel === "exchange" ? null : "exchange")} disabled={!!busy || noMain || venues?.exchange === "off"} title={venues?.exchange === "off" ? "Exchange routing is switched off on the API right now" : undefined}>Fund through an exchange</Button>
              {chain.features.tokenAccounts ? <Button size="xs" variant="outline" onClick={closeAccounts} disabled={!!busy || noMain}>{busy === "close" ? "Closing…" : "Close empty token accounts"}</Button> : null}
              <Button size="xs" variant="outline" onClick={exportKeys} disabled={!!busy}>{busy === "export" ? "Reading…" : "Download keys"}</Button>
              {DEMO ? <Button size="xs" variant="outline" onClick={exportAll} disabled={!!busy}>Download every key</Button> : <Button size="xs" variant="outline" onClick={rewrite} disabled={!!busy}>Rewrite backup files</Button>}
              <Button size="xs" variant="outline" className="text-destructive" onClick={() => void archive(ticked)} disabled={!!busy || !ticked.length} title={ticked.length ? "Keys are kept, nothing is deleted; find them under Archived wallets" : "Tick the wallets to archive first"}>{busy === "archive" ? "Archiving…" : `Archive${ticked.length ? ` ${ticked.length} ticked` : " ticked"}`}</Button>
              <Q k="more" />
            </div>
          </div>
        ) : null}

        {panel === "send" ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm">
            <span className="text-muted-foreground">Send from {scope} wallets to</span>
            <Select value={(folder?.wallets ?? []).some((w) => w.publicKey === sendTo) ? sendTo : ""} onChange={(e) => setSendTo(e.target.value)} className="h-8 w-56 text-xs" aria-label="Destination wallet">
              <option value="">one of my wallets…</option>
              {(folder?.wallets ?? []).map((w) => <option key={w.publicKey} value={w.publicKey}>{w.publicKey === main ? "Main wallet" : w.label} · {chain.short(w.publicKey)}</option>)}
            </Select>
            <span className="text-muted-foreground">or</span>
            <Input value={sendTo} onChange={(e) => setSendTo(e.target.value.trim())} placeholder="paste any address" className="h-8 w-72 font-mono text-xs" aria-label="Destination address" />
            <Input inputMode="decimal" value={sendAmt} onChange={(e) => setSendAmt(e.target.value)} placeholder={`${chain.symbol} each`} className="h-8 w-24 font-mono" aria-label="Amount each wallet sends" />
            <Button size="sm" onClick={() => void sendDirect(sendAmt)} disabled={!!busy || !chain.isAddress(sendTo) || !(Number(sendAmt) > 0)}>{busy === "send" ? "Sending…" : "Send"}</Button>
            <Button size="sm" variant="outline" onClick={() => void sendDirect("max")} disabled={!!busy || !chain.isAddress(sendTo)}>Send everything</Button>
            <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>Close</Button>
          </div>
        ) : null}
        {panel === "exchange" ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm">
            <span className="text-muted-foreground">Send {each} {chain.symbol} to each of {scope} wallets through an exchange · mode</span>
            <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="h-8 w-28 text-xs"><option value="float">float</option><option value="fixed">fixed</option><option value="private">private</option></Select>
            <span className="text-muted-foreground">venue</span>
            <Select value={venue} onChange={(e) => setVenue(e.target.value)} className="h-8 w-48 text-xs">
              <option value="auto">auto</option>
              <option value="random">random</option>
              {venueList.map(([name, v]) => <option key={name} value={name} disabled={v.status !== "open"}>{name}{v.default ? " (default)" : ""}{v.status !== "open" ? ` · ${v.reason ?? v.status}` : ""}</option>)}
            </Select>
            <Button size="sm" onClick={fundViaExchange} disabled={!!busy || targets.length > 25}>{busy === "exchange" ? "Opening orders…" : "Send"}</Button>
            {targets.length > 25 ? <span className="text-destructive text-xs">at most 25 wallets at a time: tick fewer</span> : null}
            <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>Close</Button>
          </div>
        ) : null}

        <Table>
          <THead>
            <TR>
              <TH className="w-8"><Checkbox checked={shown.length > 0 && shown.every((w) => selected.has(w.publicKey))} onChange={(e) => setSelected(e.target.checked ? new Set([...selected, ...shown.map((w) => w.publicKey)]) : new Set([...selected].filter((pk) => !shown.some((w) => w.publicKey === pk))))} aria-label="Tick all" /></TH>
              <TH>Name</TH>
              <TH>Address</TH>
              <TH className="text-right">{chain.symbol}</TH>
              {coin ? <TH className="text-right">{coin.symbol ?? "Tokens"}</TH> : null}
              <TH className="w-px">
                <span className="inline-flex items-center gap-2">
                  {buyers.length > 8 ? <Input placeholder="search…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-7 w-36 text-xs font-normal normal-case" /> : null}
                </span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {folder && buyers.length === 0 ? <TR><TD colSpan={6} className="text-muted-foreground py-8 text-center">No buyer wallets yet. Press <b>+ Add</b>, or let the Launch page make them for you.</TD></TR> : null}
            {folder && buyers.length > 0 && shown.length === 0 ? <TR><TD colSpan={6} className="text-muted-foreground py-6 text-center">Nothing matches “{search}”.</TD></TR> : null}
            {shown.map((w) => {
              const b = row(w.publicKey)
              const open = editing?.publicKey === w.publicKey || funding?.publicKey === w.publicKey || shownKey?.publicKey === w.publicKey
              return (
                <React.Fragment key={w.publicKey}>
                  <TR data-selected={selected.has(w.publicKey)}>
                    <TD><Checkbox checked={selected.has(w.publicKey)} onChange={() => toggle(w.publicKey)} aria-label={`Tick ${w.label}`} /></TD>
                    <TD>{w.label}</TD>
                    <TD>
                      <span className="inline-flex items-center gap-1">
                        <Mono>{chain.short(w.publicKey)}</Mono>
                        <Button variant="ghost" size="icon-xs" aria-label="Copy address" title="Copy address" onClick={() => { void copyText(w.publicKey); toast({ tone: "muted", title: "Address copied" }) }}><Copy /></Button>
                        <a className="inline-flex opacity-70 transition-opacity hover:opacity-100" href={chain.explorerAddress(w.publicKey)} target="_blank" rel="noreferrer" aria-label={`Open on ${chain.explorer.name}`} title={`Open on ${chain.explorer.name}`}><BrandIcon src={chain.explorer.logo} label={chain.explorer.name} size={13} /></a>
                      </span>
                    </TD>
                    <TD className="text-right font-mono text-xs">{chain.fmt(b?.native)}</TD>
                    {coin ? <TD className="text-right font-mono text-xs">{b?.tokens === undefined ? "–" : b.tokens.toLocaleString("en-US", { maximumFractionDigits: 2 })}</TD> : null}
                    <TD>
                      <span className="inline-flex items-center gap-1">
                        <Button size="xs" variant="outline" onClick={() => { setEditing(null); setShownKey(null); setFunding(funding?.publicKey === w.publicKey ? null : { publicKey: w.publicKey, amount: each }) }} disabled={!!busy || noMain} title={`Send ${chain.symbol} from the main wallet to this one`}>Fund</Button>
                        <Button size="xs" variant="outline" onClick={() => { setEditing(null); setFunding(null); void showKey(w.publicKey) }} disabled={!!busy}>Key</Button>
                        <Menu trigger={() => <Button size="icon-xs" variant="ghost" aria-label="More for this wallet"><Ellipsis /></Button>}>
                          <MenuItem onClick={() => void makeDev(w.publicKey)} hint="it will create coins and pay for buys">Make this the main wallet</MenuItem>
                          <MenuItem onClick={() => { setFunding(null); setShownKey(null); setEditing({ publicKey: w.publicKey, label: w.label }) }}>Rename</MenuItem>
                          <MenuItem danger onClick={() => void archive([w.publicKey])} hint="the key is kept; restore it under Archived wallets">Archive</MenuItem>
                        </Menu>
                      </span>
                    </TD>
                  </TR>
                  {open ? (
                    <TR className="bg-muted/30">
                      <TD colSpan={coin ? 6 : 5} className="py-2">
                        {editing?.publicKey === w.publicKey ? (
                          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); saveEdit() }}>
                            <Input autoFocus value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} className="h-8 w-56" aria-label="Name" />
                            <Button size="sm" type="submit" disabled={!!busy || !editing.label.trim()}><Check />Save</Button>
                            <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(null)}>Cancel</Button>
                          </form>
                        ) : null}
                        {funding?.publicKey === w.publicKey ? (
                          <form className="flex flex-wrap items-center gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); void fund([w.publicKey], funding.amount) }}>
                            <span className="text-muted-foreground">Send</span>
                            <Input autoFocus inputMode="decimal" value={funding.amount} onChange={(e) => setFunding({ ...funding, amount: e.target.value })} className="h-8 w-28 font-mono" aria-label="Amount" />
                            <span className="text-muted-foreground">{chain.symbol} from the main wallet to {w.label}</span>
                            <Button size="sm" type="submit" disabled={!!busy || noMain}>{busy === "fund" ? "Sending…" : "Send"}</Button>
                            <Button size="sm" variant="ghost" type="button" onClick={() => setFunding(null)}>Cancel</Button>
                          </form>
                        ) : null}
                        {shownKey?.publicKey === w.publicKey ? (
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <Mono className="bg-background rounded border px-2 py-1 text-xs break-all select-all">{shownKey.privateKey}</Mono>
                            <Button size="xs" variant="outline" onClick={() => { void copyText(shownKey.privateKey); toast({ tone: "muted", title: "Key copied" }) }}><Copy />Copy</Button>
                            <Button size="xs" variant="ghost" onClick={() => setShownKey(null)}>Hide</Button>
                          </div>
                        ) : null}
                      </TD>
                    </TR>
                  ) : null}
                </React.Fragment>
              )
            })}
          </TBody>
        </Table>
        {ticked.length === 0 && buyers.length > 1 ? <p className="text-muted-foreground -mt-1 text-xs">Tip: tick some rows to fund, collect or send from only those.</p> : null}
      </section>

      {/* archived wallets */}
      {archived && archived.length > 0 ? (
        <section className="flex flex-col gap-2">
          <button type="button" className="flex items-center gap-2 self-start text-left" onClick={() => setArchivedOpen((v) => !v)} aria-expanded={archivedOpen}>
            <h2 className="text-[15px] font-semibold">Archived wallets <span className="text-muted-foreground font-normal">{archived.length}{archived.some((a) => (a.native ?? 0) > 0) ? ` · ${chain.fmt(archived.reduce((s, a) => s + (a.native ?? 0), 0))} ${chain.symbol} inside` : ""}</span></h2>
            <span className="text-muted-foreground text-sm">{archivedOpen ? "▴" : "▾"}</span>
          </button>
          {archivedOpen ? (
            <>
              <p className="text-muted-foreground text-xs">Wallets you archived: out of the list and never used, keys kept. Restore one to fund, trade or collect from it again.</p>
              <Table>
                <THead><TR><TH>Name</TH><TH>Address</TH><TH className="text-right">{chain.symbol}</TH><TH className="w-px" /></TR></THead>
                <TBody>
                  {archived.map((a) => (
                    <React.Fragment key={a.publicKey}>
                      <TR>
                        <TD>{a.label}</TD>
                        <TD>
                          <span className="inline-flex items-center gap-1">
                            <Mono>{chain.short(a.publicKey)}</Mono>
                            <Button variant="ghost" size="icon-xs" aria-label="Copy address" onClick={() => { void copyText(a.publicKey); toast({ tone: "muted", title: "Address copied" }) }}><Copy /></Button>
                            <a className="inline-flex opacity-70 transition-opacity hover:opacity-100" href={chain.explorerAddress(a.publicKey)} target="_blank" rel="noreferrer" aria-label={`Open on ${chain.explorer.name}`} title={`Open on ${chain.explorer.name}`}><BrandIcon src={chain.explorer.logo} label={chain.explorer.name} size={13} /></a>
                          </span>
                        </TD>
                        <TD className={`text-right font-mono text-xs ${(a.native ?? 0) > 0 ? "text-foreground" : "text-muted-foreground"}`}>{a.native === null ? "–" : chain.fmt(a.native)}</TD>
                        <TD>
                          <span className="inline-flex gap-1">
                            <Button size="xs" variant="outline" onClick={() => void restore([a.publicKey])} disabled={!!busy}>{busy === `restore:${a.publicKey}` ? "Restoring…" : "Restore"}</Button>
                            <Button size="xs" variant="outline" onClick={() => void showKey(a.publicKey)} disabled={!!busy}>Key</Button>
                          </span>
                        </TD>
                      </TR>
                      {shownKey?.publicKey === a.publicKey ? (
                        <TR className="bg-muted/30"><TD colSpan={4} className="py-2">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <Mono className="bg-background rounded border px-2 py-1 text-xs break-all select-all">{shownKey.privateKey}</Mono>
                            <Button size="xs" variant="outline" onClick={() => { void copyText(shownKey.privateKey); toast({ tone: "muted", title: "Key copied" }) }}><Copy />Copy</Button>
                            <Button size="xs" variant="ghost" onClick={() => setShownKey(null)}>Hide</Button>
                          </div>
                        </TD></TR>
                      ) : null}
                    </React.Fragment>
                  ))}
                </TBody>
              </Table>
              {archived.length > 1 ? <Button size="xs" variant="outline" className="self-start" onClick={() => void restore(archived.map((a) => a.publicKey))} disabled={!!busy}>Restore all {archived.length}</Button> : null}
            </>
          ) : null}
        </section>
      ) : null}

      {/* exchange orders */}
      {legs.length > 0 ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">Exchange orders (update every 5 s)</span><button type="button" className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline" onClick={() => setLegs([])}>clear</button></div>
          <Table>
            <THead><TR><TH>Wallet</TH><TH>Status</TH><TH>Venue</TH><TH>Deposit</TH><TH>Receipt</TH></TR></THead>
            <TBody>
              {legs.map((l) => {
                const dep = l.signature ?? l.depositHash
                return (
                  <TR key={l.publicKey}>
                    <TD><Mono>{chain.short(l.publicKey)}</Mono></TD>
                    <TD><Pill tone={l.status === "completed" ? "ok" : l.error ? "error" : "muted"}>{l.status ?? "–"}</Pill>{l.error ? <span className="text-destructive ml-2 text-xs">{l.error}{l.code ? ` · ${l.code}` : ""}</span> : null}</TD>
                    <TD>{l.venue ?? "–"}</TD>
                    <TD>{dep ? <a className="underline underline-offset-4" href={chain.explorerTx(dep)} target="_blank" rel="noreferrer"><Mono className="text-xs">{chain.short(dep)}</Mono></a> : "–"}</TD>
                    <TD>{l.receipt ? <a className="underline underline-offset-4" href={l.receipt} target="_blank" rel="noreferrer">receipt</a> : "–"}</TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        </div>
      ) : null}

      {DEMO ? (
        <p className="text-muted-foreground text-xs">Keys live in this browser and download to your computer as files. Clearing this site&apos;s data deletes the copies here, so keep the files. <button type="button" className="hover:text-foreground underline underline-offset-4" onClick={downloadBackup} disabled={!!busy}>Download the key file again</button></p>
      ) : (
        <p className="text-muted-foreground text-xs">Keys are saved as files in <span className="font-mono break-all">{folder?.dir ?? "…"}</span></p>
      )}
    </div>
  )
}
