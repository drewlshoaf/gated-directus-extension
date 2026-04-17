import { randomBytes } from 'node:crypto'

const SETTING_KEY = 'extension_instance_id'

/**
 * Get or generate the extension_instance_id, persisted in the gated_settings collection.
 * Survives Directus restarts. Used to scope activation tokens.
 */
export async function getOrCreateInstanceId(settings: SettingsAccess): Promise<string> {
  const existing = await settings.get(SETTING_KEY)
  if (existing) return existing
  const id = 'inst_' + randomBytes(12).toString('hex')
  await settings.set(SETTING_KEY, id)
  return id
}

export interface SettingsAccess {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}
