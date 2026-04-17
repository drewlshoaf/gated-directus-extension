import { GRACE_PERIOD_DAYS } from './fallback.js'
import type { SettingsAccess } from './instanceId.js'

const LAST_OK_KEY = 'activation_last_ok_at'

/**
 * Architectural Rule 6 (the 30-day rule).
 * Returns true when we have NOT had a successful /activate/status response
 * in the last 30 days — extension should serve bundled fallback in that case.
 */
export async function inFallback(settings: SettingsAccess): Promise<boolean> {
  const ts = await settings.get(LAST_OK_KEY)
  if (!ts) return false // never verified yet → still in initial grace
  const last = new Date(ts).getTime()
  if (Number.isNaN(last)) return true
  const ageDays = (Date.now() - last) / (1000 * 60 * 60 * 24)
  return ageDays > GRACE_PERIOD_DAYS
}

export async function markActivationOk(settings: SettingsAccess): Promise<void> {
  await settings.set(LAST_OK_KEY, new Date().toISOString())
}
