/**
 * Trading after the launch, in local mode: the flows in lib/core/trading.ts run on the wallet folder (lib/env.ts).
 * Live trades come from the API websocket wss://…/api/rh/data (subscribeTokenTrade), held in server memory and
 * relayed to the page as server-sent events.
 */
import WebSocket from "ws"
import * as core from "./core/trading"
import { serverEnv } from "./env"
import { serverState } from "./paths"
import { trenchy } from "./settings"
import { listWallets } from "./wallets"
import { same } from "./core/wallet-record"
import { chain } from "./chain"
import type { LiveTrade, SellAllResult, TradeResult } from "./core/trading"

export type { Holding, LiveTrade, SellAllResult, TradeResult } from "./core/trading"

export const holdings = (token: string) => core.holdings(serverEnv(), token)
export const balanceRows = (token?: string | null) => core.balanceRows(serverEnv(), token)
export const sell = (publicKey: string, token: string, percent: number, slippage?: number): Promise<TradeResult> => core.sell(serverEnv(), publicKey, token, percent, slippage)
export const buy = (publicKey: string, token: string, eth: number, slippage?: number): Promise<TradeResult> => core.buy(serverEnv(), publicKey, token, eth, slippage)
export const sellAll = (publicKeys: string[], token: string, percent: number): Promise<SellAllResult> => core.sellAll(serverEnv(), publicKeys, token, percent)
export const creatorOf = (token: string) => core.creatorOf(serverEnv(), token)
export const creatorFees = (token: string) => core.creatorFees(serverEnv(), token)
export const collectCreatorFees = (token: string) => core.collectCreatorFees(serverEnv(), token)
export const tokenInfo = (token: string) => core.tokenInfo(serverEnv(), token)
export const pnl = (token: string) => core.pnl(serverEnv(), token)

// ── live trades: one websocket to wss://…/api/rh/data, subscribeTokenTrade per coin ─────────────────────────────

type Feed = { ws: WebSocket | null; url: string | null; token: string | null; trades: LiveTrade[]; seen: Set<string>; listeners: Set<(t: LiveTrade) => void>; backfilled: string | null }
const feed = serverState<Feed>("feed", () => ({ ws: null, url: null, token: null, trades: [], seen: new Set(), listeners: new Set(), backfilled: null }))

/**
 * The coin's history (GET /api/rh/trades: the dev buy, the bundle, everything before this page subscribed), merged
 * into the tape once per followed coin. Returns the whole tape, newest first.
 */
export async function backfillToken(token: string): Promise<LiveTrade[]> {
  const key = token.toLowerCase()
  if (feed.token?.toLowerCase() !== key || feed.backfilled === key) return feed.trades
  feed.backfilled = key
  const api = trenchy()
  if (!api.configured) return feed.trades
  try {
    const h = await api.evm.tradeHistory(token, 100)
    const lookup = (trader: string) => listWallets().find((w) => same(w.publicKey, trader))
    for (const raw of h.trades) {
      const t = core.parseTrade(JSON.stringify(raw), token, lookup)
      if (!t || feed.seen.has(t.hash)) continue
      feed.seen.add(t.hash)
      feed.trades.push(t)
    }
    feed.trades.sort((a, b) => b.timestamp - a.timestamp)
    if (feed.trades.length > 300) feed.trades.length = 300
  } catch (e) { console.warn("[feed] history:", e instanceof Error ? e.message : e) }
  return feed.trades
}

function connect(): void {
  if (!feed.url) return
  const ws = new WebSocket(feed.url)
  feed.ws = ws
  ws.on("open", () => { if (feed.token) ws.send(core.tradeSubscription(feed.token)) })
  ws.on("message", (data) => {
    if (!feed.token) return
    const t = core.parseTrade(data.toString(), feed.token, (trader) => listWallets().find((w) => same(w.publicKey, trader)))
    if (!t || feed.seen.has(t.hash)) return
    feed.seen.add(t.hash)
    feed.trades.unshift(t)
    if (feed.trades.length > 200) feed.trades.length = 200
    for (const cb of feed.listeners) cb(t)
  })
  ws.on("close", () => { if (feed.ws === ws && feed.token) setTimeout(connect, 3000) })
  ws.on("error", (e) => console.warn("[feed]", e.message))
}

/** A chain the API does not stream (lib/chain.ts evm.ws false): GET <api>/trades?fromBlock= every 2.5 s for the followed coin. */
const poll = serverState("feedPoll", () => ({ timer: null as ReturnType<typeof setInterval> | null, head: 0 }))
function startPolling(): void {
  if (poll.timer) return
  poll.timer = setInterval(async () => {
    const token = feed.token
    const api = trenchy()
    if (!token || !api.configured || feed.backfilled !== token.toLowerCase()) return
    try {
      const h = await api.evm.tradeHistory(token, 50, poll.head ? poll.head + 1 : undefined)
      if (feed.token !== token) return
      const lookup = (trader: string) => listWallets().find((w) => same(w.publicKey, trader))
      for (const raw of [...h.trades].reverse()) {
        const t = core.parseTrade(JSON.stringify(raw), token, lookup)
        if (!t || feed.seen.has(t.hash)) continue
        feed.seen.add(t.hash)
        feed.trades.unshift(t)
        for (const cb of feed.listeners) cb(t)
      }
      if (feed.trades.length > 200) feed.trades.length = 200
      if (h.head) poll.head = h.head
    } catch (e) { console.warn("[feed] poll:", e instanceof Error ? e.message : e) }
  }, 2500)
}

/** Follow one coin (the previous one is dropped). Returns the trades seen so far. */
export function followToken(token: string): LiveTrade[] {
  if (!chain.evm?.ws) {
    if (feed.token?.toLowerCase() !== token.toLowerCase()) { feed.token = token; feed.trades = []; feed.seen = new Set(); feed.backfilled = null; poll.head = 0 }
    startPolling()
    return feed.trades
  }
  const api = trenchy()
  const url = api.configured ? api.wsUrl() : null
  if (url !== feed.url || !feed.ws || feed.ws.readyState > WebSocket.OPEN) {
    feed.url = url
    try { feed.ws?.close() } catch { /* closing */ }
    feed.ws = null
    feed.token = token
    feed.trades = []
    feed.seen = new Set()
    connect()
  } else if (feed.token?.toLowerCase() !== token.toLowerCase()) {
    if (feed.token && feed.ws.readyState === WebSocket.OPEN) feed.ws.send(core.tradeSubscription(feed.token, false))
    feed.token = token
    feed.trades = []
    feed.seen = new Set()
    if (feed.ws.readyState === WebSocket.OPEN) feed.ws.send(core.tradeSubscription(token))
  }
  return feed.trades
}

export function onTrade(cb: (t: LiveTrade) => void): () => void {
  feed.listeners.add(cb)
  return () => feed.listeners.delete(cb)
}
