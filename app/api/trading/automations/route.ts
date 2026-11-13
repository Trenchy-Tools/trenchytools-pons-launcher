import { body, fail, ok } from "@/lib/http"
import { automations, controlAutomations } from "@/lib/trading"

export const dynamic = "force-dynamic"

/** GET /api/trading/automations?token=… → what this coin's launches keep running: auto-sell, the volume maker, the later buyers, auto-claim. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token")
  if (!token) return fail(new Error("token is required"), 400)
  try {
    return ok({ automations: automations(token) })
  } catch (e) {
    return fail(e)
  }
}

/** POST /api/trading/automations { id, action: "pause" | "resume" | "stop" } → that one, as it stands now. */
export async function POST(req: Request) {
  const b = await body<{ id: string; action: string }>(req)
  if (typeof b.id !== "string" || (b.action !== "pause" && b.action !== "resume" && b.action !== "stop")) return fail(new Error("id and action (pause, resume or stop) are required"), 400)
  const a = controlAutomations(b.id, b.action)
  if (!a) return fail(Object.assign(new Error("Nothing runs this any more: the launch that set it has ended"), { code: "not_running" }), 409)
  return ok({ automation: a })
}
