import { fail, isAddress, ok } from "@/lib/http"
import { pnl } from "@/lib/trading"

export const dynamic = "force-dynamic"

/** GET /api/trading/pnl?token=0x… → the profit or loss of every wallet on the coin (GET /api/rh/pnl), and what they still hold. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const token = q.get("token") ?? q.get("mint")
  if (!isAddress(token)) return fail(new Error("token: a 0x address"), 400)
  try {
    return ok(await pnl(token))
  } catch (e) {
    return fail(e)
  }
}
