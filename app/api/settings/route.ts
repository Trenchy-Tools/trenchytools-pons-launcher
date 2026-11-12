import { BACKUP_DIR, SETTINGS_FILE } from "@/lib/paths"
import { body, fail, ok } from "@/lib/http"
import { effectiveSettings, readSettings, updateSettings } from "@/lib/settings"

export const dynamic = "force-dynamic"

/** The settings as the shared Settings sheet reads them (no tip on this chain). */
const view = () => {
  const e = effectiveSettings()
  const s = readSettings()
  return { apiUrl: e.apiUrl, apiKeyConfigured: !!e.apiKey, apiKeyPrefix: e.apiKey ? e.apiKey.slice(0, 6) + "…" : null, apiKeyFrom: e.apiKeyFrom, slippage: e.slippage, overrides: { apiUrl: !!s.apiUrl, slippage: s.slippage !== undefined }, dir: BACKUP_DIR, file: SETTINGS_FILE }
}

/** GET /api/settings → the effective settings (the key itself is never returned). */
export async function GET() {
  return ok(view())
}

/** PUT /api/settings { apiKey?, apiUrl?, slippage? } → saved to _app/<app>-starter/settings.json; "" or null clears a field. */
export async function PUT(req: Request) {
  const b = await body<{ apiKey: string | null; apiUrl: string | null; slippage: number | null }>(req)
  try {
    updateSettings({ apiKey: b.apiKey, apiUrl: b.apiUrl, slippage: b.slippage })
    return ok(view())
  } catch (e) {
    return fail(e)
  }
}
