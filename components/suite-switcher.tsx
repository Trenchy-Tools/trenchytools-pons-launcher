"use client"

/**
 * The TrenchyTools switcher in the header: this tool's logo and name with a ▾ that opens every tool we host (each
 * launcher, live or coming; the wallet mover), the API docs and this app's repository. One header row, like a team
 * switcher. Shared: the same file in every demo (demos/_shared); the list is lib/suite.ts, "this app" is chain.suiteId.
 */
import { BookOpen, ChevronsUpDown, Code, ExternalLink } from "lucide-react"
import { chain } from "@/lib/chain"
import { cn } from "@/lib/cn"
import { LAUNCHERS, SUITE, TOOLS, suiteItem, type SuiteItem } from "@/lib/suite"
import { BrandIcon } from "./ui/brand"
import { Menu } from "./ui/menu"

function Head({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wider uppercase">{children}</p>
}

/** One product: logo, name, what it is; "you are here", "soon", or a way out. */
function Row({ item, here }: { item: SuiteItem; here: boolean }) {
  const body = (
    <>
      <BrandIcon src={item.logo} label={item.name} size={22} className={cn(item.status === "soon" && "opacity-50 grayscale")} />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className={cn("truncate text-sm font-medium", item.status === "soon" && "text-muted-foreground")}>{item.name}</span>
        <span className="text-muted-foreground truncate text-xs">{item.sub}</span>
      </span>
      <span className="ml-auto shrink-0 pl-3">
        {here ? <span className="bg-brand/15 text-brand rounded px-1.5 py-0.5 text-[11px] font-semibold">you are here</span>
          : item.status === "soon" ? <span className="text-muted-foreground rounded border px-1.5 py-0.5 text-[11px]">soon</span>
            : <ExternalLink className="text-muted-foreground size-3.5" />}
      </span>
    </>
  )
  const cls = "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left"
  if (here || !item.url) return <div role="menuitem" aria-disabled className={cn(cls, here ? "bg-muted/60" : "cursor-default")}>{body}</div>
  return <a role="menuitem" href={item.url} className={cn(cls, "hover:bg-muted")}>{body}</a>
}

export function SuiteSwitcher() {
  const here = suiteItem(chain.suiteId)
  return (
    <Menu align="left" trigger={(open) => (
      <button type="button" aria-label="Switch tool" className={cn("hover:bg-muted inline-flex h-9 items-center gap-2 rounded-lg px-2 transition-colors", open && "bg-muted")}>
        <BrandIcon src={chain.launchpadLogo} label={chain.launchpad} size={22} />
        <span className="font-semibold whitespace-nowrap"><span className="sm:hidden">{chain.launchpad}</span><span className="hidden sm:inline">{chain.appName}</span></span>
        <ChevronsUpDown className="text-muted-foreground size-3.5" />
      </button>
    )}>
      <div className="w-[min(20rem,calc(100vw-1rem))]">
        <Head>Launchers</Head>
        {LAUNCHERS.map((x) => <Row key={x.id} item={x} here={x.id === chain.suiteId} />)}
        <div className="mt-1 border-t pt-1"><Head>Tools</Head>{TOOLS.map((t) => <Row key={t.id} item={t} here={t.id === chain.suiteId} />)}</div>
        <div className="mt-1 border-t pt-1">
          <Head>Build your own</Head>
          <a role="menuitem" href={SUITE.docs} className="hover:bg-muted flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm"><BookOpen className="size-4" /><span className="flex flex-col leading-tight">API &amp; docs<span className="text-muted-foreground text-xs">everything these tools do, as endpoints</span></span></a>
          {here?.repo ? <a role="menuitem" href={here.repo} target="_blank" rel="noreferrer" className="hover:bg-muted flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm"><Code className="size-4" /><span className="flex flex-col leading-tight">Clone this app<span className="text-muted-foreground text-xs">open source: change it, ship your own</span></span><ExternalLink className="text-muted-foreground ml-auto size-3.5" /></a> : null}
        </div>
      </div>
    </Menu>
  )
}
