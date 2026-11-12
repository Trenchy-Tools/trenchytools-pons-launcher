/**
 * The TrenchyTools API client: the one file that talks to https://api.trenchy.tools.
 *
 * Every method names the endpoint it calls. The API builds the EVM transactions and broadcasts them; this app signs
 * them with viem (lib/core/evm.ts) and never talks to an RPC node or IPFS itself.
 *
 * Client-safe (no node imports): the server libs use it with the key from settings (lib/settings.ts `trenchy()`), the
 * hosted demo uses the same class in the browser with the visitor's own key (lib/browser/engine.ts). The key is injected
 * through the constructor; nothing here reads settings.
 *
 * Copy this file into your own project with lib/core/evm.ts and lib/core/errors.ts. It depends only on viem. Docs for every endpoint:
 * https://api.trenchy.tools/AGENTS.md and https://trenchy.tools/openapi.json
 */
import type { PrivateKeyAccount } from "viem/accounts"
import { sendAll, waitSuccess, type AccountData, type SendOptions, type UnsignedTx } from "./core/evm"
import { ApiError } from "./core/errors"
import { chain } from "./chain"

export { ApiError }

// ── shapes ──────────────────────────────────────────────────────────────────

export type TxLabel = "approve" | "buy" | "sell" | "create" | "graduate" | "fee" | "transfer" | "deposit" | "sweep" | "claim"
/** One entry of a `trade-local` answer: an unsigned EVM transaction. Send them in order. */
export type EvmTx = { chainId: number; from: string; to: string; data: string; value: string; valueEth?: string; gas?: string; label: TxLabel }
export type Expected = { tokens: number; eth: number }
export type TokenMetadata = { name: string; symbol: string; image: string; description?: string; twitter?: string; telegram?: string; website?: string }
/** The body of POST /api/<chain>/trade-local. */
export type TradeBody = {
  wallet: string
  /** collectCreatorFee: `[sweep?] claim` for the creator wallet (token = sweep that curve's pending fees first) */
  action: "buy" | "sell" | "create" | "collectCreatorFee"
  token?: string
  /** buys: ETH · sells: tokens or "NN%" · create: the dev buy in ETH */
  amount?: number | string
  denominatedInEth?: "true" | "false"
  slippage?: number
  tokenMetadata?: TokenMetadata
  /** create: up to 31 wallets that skip the launch-window snipe tax (pons) */
  exemptWallets?: string[]
  /** the launchpad of a create (lib/chain.ts evm.createVenue when absent); trades detect it */
  venue?: string
}
export type Built = { chainId: number; transactions: EvmTx[]; expected: Expected; venue: "curve" | "v4"; predicted?: { token: string; curve: string }; launchFeeEth?: number }
export type TxStatus = { hash: string; status: "success" | "reverted" | "pending_or_unknown"; block?: number; gasUsed?: string }
/** One wallet's ETH and, when asked with a coin, its balance of that coin (GET /api/<chain>/balances?wallets=…&token=…). */
export type WalletBalance = { wallet: string; eth: number; tokens: number; raw: string }
/** GET /api/<chain>/pnl: what every wallet put into the coin and got back, in ETH (gas and the API fee in it). */
export type CoinPnl = { token: string; spent: number; received: number; net: number; trades: number; truncated: boolean; wallets: Array<{ wallet: string; spent: number; received: number; net: number; buys: number; sells: number; gasEth: number }> }
/** POST /api/ai/coin: a name, ticker, description and logo made from an idea (rate limited per key). */
export type AiCoin = { name: string; symbol: string; description: string; image: string; via?: { writer?: string; drawer?: string }; left?: { hour?: number; day?: number } }
export type Simulation = { ok: boolean; steps: Array<{ label: string; ok: boolean; gasUsed: string | null; error: string | null }> }
export type Quote = { venue: string; action: "buy" | "sell"; ethIn?: number; tokensOut?: number; tokensIn?: number; ethOut?: number; snipeTaxBps?: number; bondingProgressPct?: number; [k: string]: unknown }
/** GET /api/<chain>/token/:token, the fields every chain answers (+ priceNative / totalSupply where the chain gives them). */
export type TokenInfo = { token: string; name: string; symbol: string; venue: string; curve: string; graduated: boolean; creator: string; curveState: Record<string, number> | null; priceNative?: number | null; totalSupply?: number | null }
/** GET /api/<chain>/creator-fees: the escrow balance (claimable now, every coin of the creator) and, with a token, that curve's pending fees. */
export type CreatorFees = { wallet: string; escrow: string; claimableWei: string; claimableEth: number; eth: number; curve: { token: string; curve: string; creator: string; graduated: boolean; pendingEth: number; sweepable: boolean; reason?: string } | null }

export type TransferMode = "float" | "fixed" | "private"
export type TransferVenues = { exchange: "on" | "off" | "degraded"; checkedAt: string | null; venues: Record<string, { status: "open" | "closed" | "unknown"; reason?: string; default?: boolean }>; note?: string }
/** The deposit of a transfer leg: on Robinhood chain it is `evm` `{ chainId, from, to, value, gas }`, a plain transfer to sign. */
export type DepositTx = { chain: string; encoding: "base64" | "evm"; transaction?: string; evm?: { chainId: number; from: string; to: string; value: string; gas: string; data: "0x"; label: "deposit" } }
export type TransferCreated = {
  transferId: string; status: string; route: "direct" | "exchange"; mode?: TransferMode; venue?: string; venueRequested?: string; venueHonoured?: boolean
  from: { chain: string; wallet: string }; to: { chain: string; address: string }; amount: number; expected?: { receive: number; fee: number; etaS: number }
  deposit: { chain: string; address: string; amount: number; deadline?: string } | null
  transaction?: DepositTx; poll?: string; warning?: string
}
export type TransferLegError = { error: string; code: string; leg: { to: { address: string }; amount: number } }
export type TransferBatch = { batchId: string; legs: Array<TransferCreated | TransferLegError>; venues: string[] }
export const isLegError = (l: TransferCreated | TransferLegError): l is TransferLegError => "error" in l
export type TransferStatus = {
  transferId: string; status: string; route: "direct" | "exchange"; mode: TransferMode | null; venue: string | null
  from: { chain: string; wallet: string }; to: { chain: string; address: string }; amount: number; expectedReceive: number | null
  depositHash: string | null; payoutHash: string | null; reason?: string; receipt?: string; help?: Record<string, unknown>; createdAt: number; updatedAt: number
}
/** Statuses after which a transfer will not change any more ("sent" is final for direct transfers only). */
export const transferDone = (t: { status: string; route: string }) =>
  ["completed", "failed", "expired", "refunded", "cancelled"].includes(t.status) || (t.route === "direct" && t.status === "sent")

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class Trenchy {
  constructor(public readonly url: string, private readonly key: string) {}

  get configured(): boolean {
    return !!this.key
  }

  /** The websocket for live data (one connection, many subscriptions): wss://…/api/<chain>/data?api-key=… */
  wsUrl(): string {
    return `${this.url.replace(/^http/, "ws")}${this.base}/data?api-key=${encodeURIComponent(this.key)}`
  }

  /** The dry run's trace: while on, every call is recorded (method, path, status, ms, what came back). */
  private trace: ApiCall[] | null = null
  beginTrace(): void { this.trace = [] }
  endTrace(): ApiCall[] { const t = this.trace ?? []; this.trace = null; return t }
  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.trace) return this.callRaw<T>(path, init)
    const t0 = Date.now(), method = (init.method ?? "GET").toUpperCase(), shown = path.replace(/\?format=json$/, "")
    try {
      const r = await this.callRaw<T>(path, init)
      this.trace.push({ method, path: shown, status: 200, ms: Date.now() - t0, note: noteOf(shown, r) })
      return r
    } catch (e) {
      this.trace.push({ method, path: shown, status: e instanceof ApiError ? e.status : 0, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) })
      throw e
    }
  }
  private async callRaw<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.key) throw new ApiError(`No TrenchyTools API key. Create one at ${this.url}/api/create-api-key?label=${chain.suiteId}-starter and paste it in Settings.`, 401, "no_key")
    const headers = new Headers(init.headers)
    headers.set("x-api-key", this.key)
    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await fetch(`${this.url}${path}`, { ...init, headers, signal: AbortSignal.timeout((init as { timeoutMs?: number }).timeoutMs ?? 45_000) })
      } catch (e) {
        if (attempt < 2) { await sleep(500 * (attempt + 1)); continue }
        throw new ApiError(`TrenchyTools API unreachable at ${this.url} (${e instanceof Error ? e.message : e})`, 0, "unreachable")
      }
      // 429 carries retry-after: wait as the API says, a few times, rather than failing a launch midway.
      if (res.status === 429 && attempt < 4) { await sleep((Number(res.headers.get("retry-after")) || 1) * 1000); continue }
      const text = await res.text()
      let body: Record<string, unknown> | null = null
      try { body = JSON.parse(text) } catch { /* not JSON */ }
      if (!res.ok) throw new ApiError(String(body?.error ?? `TrenchyTools API ${res.status}`), res.status, body?.code as string, body?.hint as string, body?.docs as string)
      return body as T
    }
  }
  private get<T>(path: string) { return this.call<T>(path) }
  private post<T>(path: string, body: unknown) {
    return this.call<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  }

  // ── account ──────────────────────────────────────────────────────────────

  /** GET /api/me: the key's prefix and 30-day usage. The "Connected" check. */
  me() { return this.get<{ keyPrefix?: string; usage30d?: unknown[] }>("/api/me") }

  // ── the chain: /api/<chain> (lib/chain.ts evm.api: /api/rh, /api/bnb, /api/elysium, /api/base) ──────────
  /** the chain's API prefix */
  private get base(): string { return chain.evm!.api }


  evm = {
    /** GET /api/<chain>/account?wallet=0x…: chainId, pendingNonce, maxFeePerGas, maxPriorityFeePerGas, balanceEth. Read it once per wallet per batch. */
    account: async (wallet: string): Promise<AccountData> => {
      const a = await this.get<AccountData & Record<string, string | number>>(`${this.base}/account?wallet=${wallet}`)
      // every chain under one shape: the balance under its own name, and gas as EIP-1559 fields (a gasPrice-only chain: both = gasPrice)
      return { ...a, balanceEth: String(a.balanceEth ?? a.balanceBnb ?? a.balanceHype ?? a.balanceUsdc ?? a.balance ?? "0"), maxFeePerGas: String(a.maxFeePerGas ?? a.gasPrice), maxPriorityFeePerGas: String(a.maxPriorityFeePerGas ?? (a.maxFeePerGas ? "0" : a.gasPrice)), transferGas: String(a.transferGas ?? "21000") }
    },

    /** POST /api/<chain>/trade-local: the ordered unsigned transactions for a buy, sell or create ([approve?] trade [fee]; create → + predicted.token). */
    tradeLocal: async (b: TradeBody): Promise<Built> => {
      // a create goes to the chain's launchpad (lib/chain.ts evm.createVenue) unless the body names one
      const body = b.action === "create" && !b.venue && chain.evm?.createVenue ? { ...b, venue: chain.evm.createVenue } : b
      const r = await this.post<Built & { token?: string; expected: Record<string, number> }>(`${this.base}/trade-local`, body)
      const e = r.expected ?? {}
      return { ...r, predicted: r.predicted ?? (r.token ? { token: r.token, curve: "" } : undefined), expected: { ...e, tokens: e.tokens ?? e.tokensOut ?? e.tokensIn ?? 0, eth: e.eth ?? e.bnb ?? e.hypeIn ?? e.hypeOut ?? e.devBuyHype ?? 0 } }
    },

    /** POST /api/<chain>/simulate { transactions }: run trade-local transactions in order on a copy of the chain. Nothing is sent. */
    simulate: (transactions: EvmTx[]) => this.post<Simulation>(`${this.base}/simulate`, { transactions }),

    /** POST /api/<chain>/send { transaction: "0x…signed" } → { hash }. */
    send: (transaction: string) => this.post<{ hash: string }>(`${this.base}/send`, { transaction }),

    /**
     * The status of one transaction. Calls made within ~150 ms of each other are asked together in ONE request
     * (GET /api/<chain>/txs, up to 100 hashes), so a launch or a sell-all waiting on 20 transactions costs one request a
     * poll, not 20. An API without /txs gets GET /api/<chain>/tx/:hash one by one instead.
     */
    tx: (hash: string) => this.txStatus(hash),

    /** GET /api/<chain>/created?hash=: the coin a create transaction made (read from its receipt). */
    created: (hash: string) => this.get<{ hash: string; status: string; token: string | null; block?: number }>(`${this.base}/created?hash=${hash}`),

    /** GET /api/<chain>/pnl?token=&wallets=&since=: the ETH profit or loss of up to 100 wallets on the coin. */
    pnl: (token: string, wallets: string[], since?: number) => this.get<CoinPnl>(`${this.base}/pnl?token=${token}&wallets=${wallets.join(",")}${since ? `&since=${since}` : ""}`),

    /**
     * ETH of many wallets and, with `token`, their balance of that coin: GET /api/<chain>/balances?wallets=…&token=… (100 per
     * call). An API that answers without the coin's balances is asked per wallet instead.
     */
    walletBalances: async (wallets: string[], token?: string | null): Promise<WalletBalance[]> => {
      const out: WalletBalance[] = []
      for (let i = 0; i < wallets.length; i += 100) {
        const chunk = wallets.slice(i, i + 100)
        const r = await this.get<{ wallets: Array<{ wallet: string; eth?: string; native?: string; bnb?: string; hype?: string; token?: { balance: string; raw: string } }> }>(`${this.base}/balances?wallets=${chunk.join(",")}${token ? `&token=${token}` : ""}`)
        for (const w of r.wallets) out.push({ wallet: w.wallet, eth: Number(w.eth ?? w.native ?? w.bnb ?? w.hype ?? 0), tokens: Number(w.token?.balance ?? 0), raw: w.token?.raw ?? "0" })
        if (token && r.wallets.length && !r.wallets[0].token) {
          // an older API: one call per wallet for the coin
          await Promise.all(chunk.map(async (pk, k) => {
            const b = await this.evm.balances(pk, [token]).catch(() => null)
            const row = out[out.length - chunk.length + k]
            row.tokens = Number(b?.tokens?.[0]?.balance ?? 0)
            row.raw = row.tokens > 0 ? "1" : "0"
          }))
        }
      }
      return out
    },

    /** GET /api/<chain>/quote?token&action&amount[&wallet]: the exact numbers before a trade (snipe tax depends on the wallet). */
    quote: (p: { token: string; action: "buy" | "sell"; amount: number; wallet?: string }) =>
      this.get<Quote>(`${this.base}/quote?token=${p.token}&action=${p.action}&amount=${p.amount}${p.wallet ? `&wallet=${p.wallet}` : ""}`).then((q) => ({ ...q, ethOut: (q.ethOut ?? q.bnbOut ?? q.hypeOut ?? q.usdcOut) as number | undefined, ethIn: (q.ethIn ?? q.bnbIn ?? q.hypeIn ?? q.usdcIn) as number | undefined })),

    /** GET /api/<chain>/token/:token: name, symbol, venue (pons-curve | uniswap-v4), curve state. */
    token: async (token: string): Promise<TokenInfo> => {
      const t = await this.get<TokenInfo & Record<string, unknown>>(`${this.base}/token/${token}`)
      const cs = (t.curveState ?? {}) as Record<string, number>
      const price = typeof cs.priceEth === "number" ? cs.priceEth : typeof t.priceBnb === "number" ? t.priceBnb : typeof t.priceUsdc === "number" ? t.priceUsdc : typeof t.priceEth === "number" ? t.priceEth : null
      return { ...t, venue: (t.venue ?? t.launchpad) as TokenInfo["venue"], graduated: t.graduated === true, creator: String(t.creator ?? t.founder ?? ""), curve: String(t.curve ?? ""), priceNative: price, totalSupply: typeof t.totalSupply === "number" ? t.totalSupply : null }
    },

    /** GET /api/<chain>/trades?token=&limit=: the coin's past trades, newest first, in the websocket's payload shape (the tape's history). */
    tradeHistory: (token: string, limit = 100, fromBlock?: number) => this.get<{ token: string; head?: number; trades: Array<Record<string, unknown>> }>(`${this.base}/trades?token=${token}&limit=${limit}${fromBlock ? `&fromBlock=${fromBlock}` : ""}`),

    /** GET /api/<chain>/creator-fees?wallet=&token=: what the creator can claim (escrow) and what the coin's curve still holds. */
    creatorFees: async (wallet: string, token?: string): Promise<CreatorFees> => {
      const f = await this.get<CreatorFees & Record<string, unknown>>(`${this.base}/creator-fees?wallet=${wallet}${token ? `&token=${token}` : ""}`)
      // pons: escrow eth + the curve's pending · Elysium pads: claimableHype (+ pendingHype) · Flap: the processor's pendingBnb
      const n = (v: unknown) => (typeof v === "number" ? v : 0)
      const eth = n(f.eth ?? f.claimableEth ?? f.claimableHype ?? f.pendingBnb ?? f.claimableUsdc ?? f.claimable)
      return { ...f, eth, claimableEth: n(f.claimableEth ?? f.claimableHype ?? f.pendingBnb ?? f.claimableUsdc ?? f.claimable), curve: f.curve ?? (f.pendingHype ? { token: token ?? "", curve: "", creator: wallet, graduated: false, pendingEth: n(f.pendingHype), sweepable: false } : null) }
    },

    /** GET /api/<chain>/balances?wallets=a,b,…: ETH for up to 100 wallets per call. */
    ethBalances: async (wallets: string[]): Promise<Map<string, number>> => {
      const out = new Map<string, number>()
      for (let i = 0; i < wallets.length; i += 100) {
        const r = await this.get<{ wallets: Array<{ wallet: string; eth?: string; native?: string; bnb?: string; hype?: string }> }>(`${this.base}/balances?wallets=${wallets.slice(i, i + 100).join(",")}`)
        for (const w of r.wallets) out.set(w.wallet.toLowerCase(), Number(w.eth ?? w.native ?? w.bnb ?? w.hype ?? 0))
      }
      return out
    },

    /** GET /api/<chain>/balances?wallet=&tokens=: ETH + token balances of one wallet. */
    balances: (wallet: string, tokens: string[]) =>
      this.get<{ wallet: string; eth?: string; bnb?: string; hype?: string; usdc?: string; tokens: Array<{ token: string; balance: string }> }>(`${this.base}/balances?wallet=${wallet}${tokens.length ? `&tokens=${tokens.join(",")}` : ""}`).then((r) => ({ ...r, eth: r.eth ?? r.bnb ?? r.hype ?? r.usdc ?? "0" })),
  }

  private txStatus(hash: string): Promise<TxStatus> {
    return new Promise((resolve, reject) => {
      const list = this.statusWaiters.get(hash) ?? []
      list.push({ resolve, reject })
      this.statusWaiters.set(hash, list)
      if (!this.statusTimer) this.statusTimer = setTimeout(() => void this.flushStatuses(), 150)
    })
  }
  private statusWaiters = new Map<string, Array<{ resolve: (s: TxStatus) => void; reject: (e: unknown) => void }>>()
  private statusTimer: ReturnType<typeof setTimeout> | null = null
  private batchStatuses = true
  private async flushStatuses() {
    this.statusTimer = null
    const waiting = new Map(this.statusWaiters)
    this.statusWaiters.clear()
    const hashes = [...waiting.keys()]
    const settle = (h: string, f: (w: { resolve: (s: TxStatus) => void; reject: (e: unknown) => void }) => void) => (waiting.get(h) ?? []).forEach(f)
    for (let i = 0; i < hashes.length; i += 100) {
      const chunk = hashes.slice(i, i + 100)
      if (this.batchStatuses) {
        try {
          const r = await this.get<{ statuses: TxStatus[] }>(`${this.base}/txs?hashes=${chunk.join(",")}`)
          const by = new Map(r.statuses.map((x) => [x.hash.toLowerCase(), x]))
          for (const h of chunk) settle(h, (w) => w.resolve(by.get(h.toLowerCase()) ?? { hash: h, status: "pending_or_unknown" }))
          continue
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 404)) { for (const h of chunk) settle(h, (w) => w.reject(e)); continue }
          this.batchStatuses = false // an older API: one by one from now on
        }
      }
      await Promise.all(chunk.map(async (h) => {
        try { const st = await this.get<TxStatus>(`${this.base}/tx/${h}`); settle(h, (w) => w.resolve(st)) } catch (e) { settle(h, (w) => w.reject(e)) }
      }))
    }
  }

  /** Poll GET /api/<chain>/tx/:hash until success (true), reverted (throws) or timed out (false). (lib/core/evm.ts waitSuccess) */
  waitSuccess(hash: string, timeoutMs = 60_000, onProgress?: (msg: string) => void): Promise<boolean> {
    return waitSuccess(this, hash, timeoutMs, onProgress)
  }

  /**
   * Sign and send a run of transactions for one wallet, in order: GET /api/<chain>/account once, nonce + 1 per
   * transaction, POST /api/<chain>/send each. An `approve` or `graduate` is confirmed (GET /api/<chain>/tx) before the next one
   * goes out; the last trade is confirmed when `confirm` is true. Returns every hash, in order. (lib/core/evm.ts sendAll)
   */
  sendAll(account: PrivateKeyAccount, txs: UnsignedTx[], opts: SendOptions = {}): Promise<string[]> {
    return sendAll(this, account, txs, opts)
  }

  // ── transfers (wallet → wallet, direct or through an exchange hop) ──────

  /** GET /api/transfer/venues: which exchange venues are open right now. */
  transferVenues() { return this.get<TransferVenues>("/api/transfer/venues") }
  /** POST /api/transfer/batch: one source → many destinations (or many → one); one order + unsigned deposit per leg (≤ 25 legs). */
  createTransferBatch(body: { from: { chain: string; wallet: string }; to: Array<{ chain: string; address: string; amount: number }>; mode?: TransferMode; venue?: string }) {
    return this.post<TransferBatch>("/api/transfer/batch", body)
  }
  /** GET /api/transfer/:id: awaiting_deposit → exchanging → completed (payoutHash), or a terminal failure with `help`. */
  transferStatus(id: string) { return this.get<TransferStatus>(`/api/transfer/${encodeURIComponent(id)}`) }
  /** POST /api/transfer/:id/sent: record the hash of the deposit you sent. */
  transferSent(id: string, hash: string) { return this.post<{ ok: boolean }>(`/api/transfer/${encodeURIComponent(id)}/sent`, { hash }) }

  /** The EVM deposit of a transfer leg as an UnsignedTx; checked to be a plain transfer from our wallet to the deposit address for the agreed amount. */
  static depositTx(leg: TransferCreated, from: string): UnsignedTx {
    const d = leg.transaction?.evm
    if (!leg.transaction || leg.transaction.encoding !== "evm" || !d) throw new Error("transfer leg carries no EVM deposit transaction")
    if (d.from.toLowerCase() !== from.toLowerCase()) throw new Error("deposit transaction is not paid by our wallet")
    if (d.data !== "0x") throw new Error("deposit transaction is not a plain transfer")
    if (!leg.deposit || d.to.toLowerCase() !== leg.deposit.address.toLowerCase()) throw new Error("deposit transaction does not send to this transfer's deposit address")
    return { label: "deposit", to: d.to, data: "0x", value: d.value, gas: d.gas, chainId: d.chainId }
  }

  // ── metadata ────────────────────────────────────────────────────────────

  /** POST /api/ai/coin: a coin made from an idea (name, ticker, description, logo as a data URL). Up to ~60 s. */
  aiCoin(p: { idea?: string; style?: "meme" | "mascot" | "clean" }) {
    return this.call<AiCoin>("/api/ai/coin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p), timeoutMs: 120_000 } as RequestInit)
  }

  /** POST /api/ipfs (multipart): pin the image + metadata. Robinhood creates use `metadata.image`. Pass the browser's FormData straight through. */
  async uploadMetadata(form: FormData): Promise<{ metadataUri: string; metadata?: { image?: string; [k: string]: unknown } }> {
    return this.call("/api/ipfs", { method: "POST", body: form })
  }
}

// ── the dry run's trace ───────────────────────────────────────────────────

/** One call of the dry run (components/api-calls.tsx shows the list). */
export type ApiCall = { method: string; path: string; status: number; ms: number; note?: string; error?: string }

/** One line about what an answer held, for the trace: the fields a reader of the docs would look for. */
function noteOf(path: string, r: unknown): string {
  const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>
  const n = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 4 }) : String(v))
  const parts: string[] = []
  if (typeof o.metadataUri === "string") parts.push(`metadataUri ${o.metadataUri}`)
  if (typeof o.transaction === "string") parts.push(`unsigned transaction, ${Math.round(o.transaction.length * 0.75)} bytes, you sign it`)
  if (Array.isArray(o.transactions)) parts.push(`${o.transactions.length} unsigned transaction${o.transactions.length === 1 ? "" : "s"}${o.transactions.every((t) => t && typeof t === "object" && "label" in t) ? ` (${(o.transactions as Array<{ label: string }>).map((t) => t.label).join(", ")})` : ""}, you sign them`)
  const exp = o.expected as Record<string, unknown> | undefined
  if (exp && typeof exp.tokens === "number") parts.push(`~${n(exp.tokens)} tokens expected`)
  const pred = o.predicted as Record<string, unknown> | undefined
  if (pred && typeof pred.token === "string") parts.push(`coin will be ${pred.token}`)
  if (typeof o.unitsConsumed === "number" && o.ok !== false) parts.push(`simulated ok, ${n(o.unitsConsumed)} compute units`)
  if (Array.isArray(o.steps)) parts.push(`${(o.steps as Array<{ ok?: boolean }>).filter((s) => s.ok).length}/${o.steps.length} steps simulate ok`)
  if (o.ok === false && o.err !== undefined) parts.push(`simulation failed: ${JSON.stringify(o.err).slice(0, 80)}`)
  if (typeof o.keyPrefix === "string") parts.push(`key ${o.keyPrefix}… accepted`)
  if (typeof o.balanceEth === "string" || typeof o.balanceEth === "number") parts.push(`balance ${n(o.balanceEth)} ETH`)
  if (typeof o.sol === "number") parts.push(`balance ${n(o.sol)} SOL`)
  if (Array.isArray(o.balances)) parts.push(`${o.balances.length} balance${o.balances.length === 1 ? "" : "s"}`)
  if (Array.isArray(o.wallets)) parts.push(`${o.wallets.length} wallet balance${o.wallets.length === 1 ? "" : "s"}`)
  if (Array.isArray(o.pairs)) parts.push(`${o.pairs.length} pairs a coin can be priced in`)
  if (Array.isArray(o.venues)) parts.push(`${o.venues.length} exchange venues, with health`)
  if (typeof o.blockhash === "string") parts.push("recent blockhash")
  if (typeof o.priorityFee === "number" || typeof o.microLamports === "number") parts.push("priority fee estimate")
  if (parts.length) return parts.join(" · ")
  const keys = Object.keys(o)
  return keys.length ? `{ ${keys.slice(0, 6).join(", ")}${keys.length > 6 ? ", …" : ""} }` : path.includes("/api/me") ? "ok" : "ok"
}
