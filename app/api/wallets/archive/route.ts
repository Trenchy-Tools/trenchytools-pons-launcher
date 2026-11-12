import { body, fail, isAddress, ok, strings } from "@/lib/http"
import { archiveWallets } from "@/lib/wallets"

/** POST /api/wallets/archive { publicKeys, allowMain? } → move their files to <folder>/archived/ (keys kept, never used again). The main wallet only with allowMain. */
export async function POST(req: Request) {
  const b = await body<{ publicKeys: string[]; allowMain?: boolean }>(req)
  const targets = strings(b.publicKeys).filter(isAddress)
  if (!targets.length) return fail(new Error("publicKeys: at least one 0x wallet"), 400)
  try {
    return ok(archiveWallets(targets, b.allowMain === true))
  } catch (e) {
    return fail(e, 409)
  }
}
