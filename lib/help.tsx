/**
 * Every "?" in the app: one plain explanation per option, in one place so they stay consistent and are easy to edit.
 * <Q k="bundle" /> renders the "?" for that key. Rule: every option a user can change has one (see components/ui/help.tsx).
 */
import * as React from "react"
import { Help } from "@/components/ui/help"
import { chain } from "@/lib/chain"

/** The chain's words (lib/chain.ts): the native coin, the launchpad, the tip, the vanity suffix. */
const S = chain.symbol
const L = chain.launchpad
const T = chain.tipName ?? "tip"
const V = chain.vanitySuffix ?? ""

type Entry = { title: string; body: React.ReactNode }

export const HELP = {
  // ── main wallet ──
  mainWallet: { title: "Main wallet", body: <><p>The one wallet that runs everything. It <b>creates your coin</b>, makes the first buy, and <b>pays for every other wallet</b> (it sends them the {S} they need right before the launch).</p><p>Send {S} to its address to get started. When you are done, "Collect all" on the Wallets page brings every other wallet's {S} back here.</p></> },
  // ── the coin ──
  // ── buys ──
  devWallet: { title: "Dev wallet", body: <><p>The wallet that creates the coin. It is shown as the coin's creator on {L}, makes the first buy, and receives the creator fees.</p><p><b>Main wallet</b>: your main wallet does it (simplest). <b>One of my wallets</b>: pick a wallet from your list. <b>New wallet</b>: a fresh wallet is made at launch, added to your Wallets list, so the creator is not your main wallet.</p><p>Whichever you pick, your main wallet pays: it sends a picked or new dev wallet what it needs before the launch.</p></> },
  launchpad: { title: "Launchpad", body: <><p>Where your coin is created on {chain.name}. Each launchpad has its own market (a bonding curve, or a pool from the first block), its own fees and its own extras; the line under the picker says how this one works, and its settings appear next to it.</p><p>Everything else stays the same: the same wallets, bundle buyers, later buyers, volume maker and auto-sell. Buying and selling never need the launchpad: the API finds every coin's market by itself.</p></> },
  devBuy: { title: "Dev buy", body: <><p>How much {S} the dev wallet spends buying its own coin in the same transaction that creates it. It is always the very first buy, at the lowest price.</p><p>0 = create the coin without buying. Bigger buys hold more of the supply but leave less for others.</p></> },
  bundle: { title: "Bundle buyers", body: <><p>Extra wallets that buy your coin <b>together with the launch</b>, so the coin starts with several holders instead of one.</p><p><b>How many:</b> up to <b>{chain.maxBundle}</b>. {chain.bundleHelp}</p><p>Each one is a new wallet, made when you press Launch, funded from your main wallet and added to your Wallets list (or pick wallets you already have under "per wallet"). Off = only the main wallet buys.</p></> },
  bundleWhen: { title: "When", body: <><p><b>Same block</b>: the create and every bundle buy go out together as one bundle, so they land in the very same block and nobody can buy in between. Costs the {T}.</p><p><b>Right after</b>: the coin is created first, then the bundle wallets buy one by one as soon as it is live. No tip; outsiders can buy in between. Unlocks "Pause between" and "Protection".</p></> },
  bundleAmount: { title: "Each one buys", body: <><p><b>Same</b>: every bundle wallet buys exactly this much {S}.</p><p><b>Random</b>: each wallet gets its own amount between the two numbers, so the buys don't all look identical. The cost card shows the amounts it picked.</p><p><b>per wallet</b>: set the amount for each wallet by hand, and choose your own existing wallets instead of new ones.</p></> },
  bundleGap: { title: "Pause between", body: <p>"Right after" only: a random wait between one bundle buy and the next, between these two numbers in milliseconds (1000 ms = 1 second). 0 to 0 = as fast as possible.</p> },
  bundleProtect: { title: "Protection", body: <><p>"Right after" only: before each bundle buy, the app checks how much {S} <b>other people</b> (not your wallets) have already put into the coin. If it is more than this, the remaining bundle buys are skipped, so you don't buy high after snipers.</p><p>Leave empty to always buy.</p></> },
  later: { title: "Later buyers", body: <><p>Extra wallets that buy <b>one by one after the launch</b>, at random moments in a time window, so buys keep coming in during the first minute or two.</p><p>Each one is a new wallet funded by your main wallet and added to your Wallets list (or pick your own under "per wallet").</p></> },
  laterTiming: { title: "Timing", body: <p>The first later buy can happen this many seconds after the coin is live; all of them land at random moments within the next "spread over" seconds. Example: start 10, spread 60 = every buy lands between 10 s and 70 s after the launch.</p> },
  volume: { title: "Volume maker", body: <><p>A few of your own wallets keep <b>buying and selling small amounts</b> of the coin after the launch, so trades keep showing up on the chart.</p><p>It only runs while the coin is live, and stops by itself when the time is up, when auto-sell fires, as soon as your main wallet has sold everything, or when its wallets run out of {S}. Then those wallets sell what they hold. Their {S} stays in them; "Collect all" on the Wallets page brings it back. Its trades never count as outside buyers.</p></> },
  volumeBudget: { title: "Budget", body: <p>The total {S} the volume maker gets, split evenly across its wallets. Each wallet trades with its share; the money moves in and out of the coin rather than being spent, minus fees and price movement.</p> },
  volumeSize: { title: "Trade size", body: <><p><b>Calm</b>: each buy spends 10–25 % of a wallet's {S}, each sell 20–50 % of its tokens. <b>Normal</b>: buys 15–40 %, sells 30–100 %. <b>Wild</b>: buys 40–90 %, sells 60–100 %, in runs: 3–6 buys in a row, then 2–4 sells, now and then two at once. Bigger moves make bigger candles.</p><p>Wild moves the price much more, so outside traders get bigger swings to trade against, and the volume wallets can end up down more. Same budget either way: Wild makes fewer, bigger trades.</p></> },
  volumePace: { title: "Pace", body: <p>How often a trade goes out: <b>Light</b> every 8–15 s, <b>Normal</b> every 3–7 s, <b>Heavy</b> every 1–3 s. Faster = more trades and more fees.</p> },
  speed: { title: "Speed", body: <><p>How hard every transaction pushes to land quickly. <b>Normal</b> uses your Settings tip and a small priority fee. <b>Fast</b> doubles the {T} and raises the priority fee; <b>Turbo</b> is 4× the tip and the highest priority fee.</p><p>Use Fast or Turbo when the network is busy; it costs a little more on every launch and buy.</p></> },
  // ── after the launch ──
  autoSell: { title: "Auto-sell", body: <><p>Sells for you automatically after the launch, so you don't have to watch the chart. Every buyer wallet sells <b>100 %</b> of its coins when the rule below is met. The main wallet follows your choice.</p><p>It runs in the app (in demo mode, in this tab: keep it open).</p></> },
  sellWhen: { title: "Sell when", body: <><p><b>Outside buyers put in X {S}</b>: counts only other people's money (their buys minus their sells, never your own wallets). When it reaches X, everything sells.</p><p><b>Or after N min</b>: sells after this long no matter what. Whichever comes first wins; leave one empty to turn it off.</p></> },
  sellBuyers: { title: "Buyer wallets", body: <p><b>All at once</b>: every bundle, later and sniper wallet sells at the same moment. <b>Spread out</b>: they sell one after another over this many seconds, which moves the price down more gently.</p> },
  sellMain: { title: "Main wallet", body: <p><b>Sells with them</b>: the main wallet sells everything together with the buyers. <b>Sells later</b>: it waits this many seconds after them. <b>Own trigger</b>: it has its own rule, watched from the launch on and separate from the buyers': sell when outside buyers have put in this much (set it higher than the buyers' to hold the main bag longer), or after this many minutes. <b>Keeps its coins</b>: it does not sell at all.</p> },
  autoClaim: { title: "Auto-claim creator fees", body: <><p>{L} pays the coin's creator (your main wallet) a small fee on every trade. These pile up until someone claims them.</p><p><b>After every wallet has sold</b>: the app watches your wallets (main, bundle, later buyers, volume) and claims once none of them holds the coin any more, whether auto-sell sold it or you sold by hand. It watches for up to 6 hours.</p><p><b>After a time</b>: claims once, this many minutes after the launch.</p><p>The fees go to your main wallet. You can always claim by hand on the Trading page too.</p></> },
  // ── advanced ──
  pair: { title: "Pair with", body: <p>What the coin is priced and bought in. <b>{S}</b> is the normal {L} coin. Other choices (USDC, tokenized stocks, other coins) make every buy pay in that asset, so every buying wallet must already hold it. Fees are still paid in {S}.</p> },
  slippage: { title: "Slippage", body: <p>How far the price may move between building a buy and it landing before it is cancelled, in %. Higher = fewer failed buys in a busy launch, but you may pay more. 15 % is a good default.</p> },
  creatorFee: { title: "Creator fee", body: <p>Only for coins paired with something other than {S} or USDC: your own creator fee on every trade, in basis points (100 = 1 %). Empty = {L}'s normal schedule.</p> },
  mintAddress: { title: "Coin address", body: <><p><b>Random</b>: a fresh address, made instantly.</p><p><b>Ends in …{V}</b>: an address that ends in "pump" like most {L} coins. It comes from a pool of pre-made addresses; "Make one" grinds a new one (takes a while).</p></> },
  fundFirst: { title: "The main wallet funds the buyers first", body: <p>On: right before the launch, the main wallet sends every buyer wallet exactly what it needs (its buy + fees + a little gas). Off: nothing is sent and every buyer wallet must already hold enough {S}.</p> },
  mayhem: { title: "Mayhem mode", body: <p>A {L} option: {L}'s own trading agent trades the coin for its first 24 hours, with a 2 billion supply. {S} and USDC pairs only.</p> },
  holderReward: { title: "Holder rewards", body: <p>The creator fee goes to the coin's holders instead of to you, permanently. It cannot be switched back after the launch.</p> },
  // ── trading ──
  buyAll: { title: "Buy all", body: <p>Every wallet in the list buys this much {S} of the coin, one after another, in one press. The main wallet joins in unless "include the main wallet" is off. Each wallet needs this amount plus a little gas.</p> },
  oneByOne: { title: "One by one", body: <p>Waits a short random moment (0.3–1.2 s) between wallets instead of sending every buy back to back, so the buys look less like one person.</p> },
  partialFill: { title: "Partial fill", body: <p>Mayhem coins only: if a buy is bigger than what is left to buy, it takes what is left instead of failing.</p> },
  sellAll: { title: "Sell all", body: <p>Every wallet that holds the coin sells this share of its coins: 25 %, half, or everything (100 %). Wallets that hold none are skipped.</p> },
  includeMain: { title: "Include the main wallet", body: <p>On: Buy all, Sell all and Later also use the main wallet. Off: they leave the main wallet alone, so you can sell the buyer wallets and keep the main wallet's coins (or the other way round with its own row).</p> },
  laterSell: { title: "Later", body: <p>Schedules a sell: in this many minutes, every wallet that holds the coin sells this share. It runs in the app (in demo mode, keep this tab open); you can cancel it in the list below until it fires.</p> },
  pnl: { title: "Profit / loss", body: <><p>The exact result of all your wallets on this coin, in {S}. For every transaction of your wallets that touched the coin, it takes the wallet's real {S} change, so {L}'s fees, the API fee, priority fees, the {T} and account rent are all included.</p><p>Moving {S} between your own wallets (funding, Collect all) is not counted. While your wallets still hold the coin the big number is an <b>estimate</b>: what you would end with if you sold everything now (a live sell quote of all of it, else the last price). It is marked "not final" and moves with the price; the real result shows once every wallet has sold. Creator fees you claim are not included.</p></> },
  creatorFees: { title: "Creator fees", body: <p>{L} pays the coin's creator a small fee on every trade. "Claim" sends what has piled up to the creator wallet (your main wallet for coins you launched here).</p> },
  // ── wallets ──
  fundAll: { title: "Give each … Fund", body: <p>Sends this much {S} from the main wallet to <b>every buyer wallet</b> (or only the ticked ones, if you tick some). Plain transfers, one per wallet.</p> },
  collectAll: { title: "Collect all to main wallet", body: <p>Every buyer wallet (or only the ticked ones) sends all its {S} back to the main wallet, minus exactly the network fee. Coins they hold are not touched: sell them on the Trading page first.</p> },
  more: { title: "Wallet tools", body: <><p><b>Send to an address</b>: send {S} from these wallets to any address, even outside this app.</p><p><b>Fund through an exchange</b>: each wallet is paid by an exchange instead of by the main wallet, so they are not linked on-chain.</p><p><b>Close empty token accounts</b>: every coin a wallet held leaves a small account behind; closing the empty ones returns their rent (about 0.002 {S} each) to the main wallet.</p><p><b>Download keys</b>: a file with the private keys. <b>Archive</b>: take the ticked wallets out of the list; keys are kept and you can restore them under Archived wallets.</p></> },
  // ── the button area ──
} satisfies Record<string, Entry>

export type HelpKey = keyof typeof HELP

/** The "?" for one option. */
export function Q({ k, className, alert }: { k: HelpKey; className?: string; alert?: boolean }) {
  const e: Entry = HELP[k]
  return <Help title={e.title} className={className} alert={alert}>{e.body}</Help>
}
