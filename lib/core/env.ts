/**
 * What the shared flows (lib/core/launch.ts, trading.ts, funding.ts) need from the outside world, as one object.
 *
 *   local mode  lib/wallets.ts + lib/launch.ts (files in the backup folder), key and slippage from settings.json/.env
 *   demo mode   lib/browser/keystore.ts + the browser engine (localStorage), the visitor's own key
 *
 * Every store method is synchronous on purpose: both stores are (fs sync calls / localStorage), and the flows read like
 * the server code they came from. No node imports.
 */
import type { PrivateKeyAccount } from "viem/accounts"
import type { Trenchy } from "../trenchy"
import type { Role, WalletInfo } from "./wallet-record"

export type WalletStore = {
  /** where keys live, for messages: "folder" (local mode: "not in the folder") or "browser" ("not in this browser") */
  place: "folder" | "browser"
  /** every usable wallet (not archived), oldest first; `role` filters by the tag */
  list(role?: Role): WalletInfo[]
  /** a usable wallet by address (any letter case), or null */
  get(publicKey: string): WalletInfo | null
  /** the main wallet: pays for everything, receives gathers, is the default creator */
  main(): WalletInfo | null
  /** the backup rule: throws NotBackedUpError unless the key is safely backed up */
  assertBackedUp(publicKey: string): void
  /** the viem account that signs; throws NotBackedUpError when the wallet is unknown or not backed up */
  accountOf(publicKey: string): PrivateKeyAccount
  /** create (and store) `count` wallets; the first wallet ever becomes the main wallet. count < 1 makes none. */
  create(count: number, role?: Role, label?: string): WalletInfo[]
  /** one line for the Simulate "backup" check: where the key is kept */
  backupNote(w: WalletInfo): string
}

export type Env<LaunchRecord = unknown> = {
  api: Trenchy
  wallets: WalletStore
  /** launch records, newest first */
  launches: { list(): LaunchRecord[]; save(rec: LaunchRecord): void }
  /** percent, the default of every trade and launch */
  slippage: number
}

/** "in the folder" / "in this browser": where a missing wallet is not. */
export const where = (w: WalletStore) => (w.place === "folder" ? "in the folder" : "in this browser")
/** "not in folder" / "not in this browser" (a plan row label), or with `the` for a sentence ("is not in the folder"). */
export const notIn = (w: WalletStore, sentence = false) => (w.place === "folder" ? (sentence ? "not in the folder" : "not in folder") : "not in this browser")

/** Defaults both modes use when the visitor / settings.json / .env says nothing. */
export const DEFAULT_API_URL = "https://api.trenchy.tools"
export const DEFAULTS = { slippage: 10 }
/** percent */
export const DEFAULT_SLIPPAGE = DEFAULTS.slippage
