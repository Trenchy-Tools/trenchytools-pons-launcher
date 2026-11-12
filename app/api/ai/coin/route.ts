import { body, fail, ok } from "@/lib/http"
import { trenchy } from "@/lib/settings"

export const dynamic = "force-dynamic"

/** POST /api/ai/coin { idea?, style? } → the API's POST /api/ai/coin: an AI-written coin and its logo (a data URL). */
export async function POST(req: Request) {
  try {
    const b = await body<{ idea?: string; style?: "meme" | "mascot" | "clean" }>(req)
    return ok(await trenchy().aiCoin({ idea: typeof b.idea === "string" ? b.idea.slice(0, 200) : undefined, style: b.style }))
  } catch (e) {
    return fail(e)
  }
}
