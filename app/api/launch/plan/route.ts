import { body, fail, ok } from "@/lib/http"
import { fundingPlan } from "@/lib/launch"
import { readForm } from "../form"

export const dynamic = "force-dynamic"

/** POST /api/launch/plan (LaunchForm) → the funding plan: per wallet buy + 0.5 % API fee + a gas buffer; the dev adds the pons launch fee and the create's gas. No API call. */
export async function POST(req: Request) {
  try {
    return ok(await fundingPlan(readForm(await body(req))))
  } catch (e) {
    return fail(e)
  }
}
