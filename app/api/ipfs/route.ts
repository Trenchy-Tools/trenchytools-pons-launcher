import { fail, ok } from "@/lib/http"
import { trenchy } from "@/lib/settings"

/**
 * POST /api/ipfs (multipart: file, name, symbol, description, twitter, telegram, website) → passed straight to the API's
 * POST /api/ipfs → { metadataUri, metadata: { image } }. The pons create takes metadata.image.
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData()
    if (!(form.get("file") instanceof Blob)) return fail(new Error("file (png / jpg / gif / webp, up to 4 MB) is required"), 400)
    if (!form.get("name") || !form.get("symbol")) return fail(new Error("name and symbol are required"), 400)
    const r = await trenchy().uploadMetadata(form)
    if (!r.metadata?.image) return fail(new Error("the API answered without metadata.image"), 502)
    return ok(r)
  } catch (e) {
    return fail(e)
  }
}
