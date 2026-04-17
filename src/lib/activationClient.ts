/**
 * Calls /activate/* on the Gated control plane.
 * IMPORTANT: this client is the ONLY thing in the extension that talks to /activate.
 * It must NEVER call /api/v1/* — that's the connected-mode client (lib/client.ts).
 */
import type { ActivationStatusResponse, ActivationVerifyResponse } from '@gated/types'

const DEFAULT_BASE = 'https://api.gated.fyi'

export class ActivationClient {
  constructor(private base: string = DEFAULT_BASE) {}

  async request(email: string): Promise<void> {
    const r = await fetch(`${this.base}/activate/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (!r.ok) throw new Error(`activate/request failed: ${r.status}`)
  }

  async verify(email: string, code: string, extension_instance_id: string): Promise<ActivationVerifyResponse> {
    const r = await fetch(`${this.base}/activate/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, code, extension_instance_id }),
    })
    if (!r.ok) throw new Error(`activate/verify failed: ${r.status}`)
    return (await r.json()) as ActivationVerifyResponse
  }

  async resend(email: string): Promise<void> {
    const r = await fetch(`${this.base}/activate/resend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (!r.ok) throw new Error(`activate/resend failed: ${r.status}`)
  }

  async status(token: string): Promise<ActivationStatusResponse> {
    const r = await fetch(`${this.base}/activate/status`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!r.ok) throw new Error(`activate/status failed: ${r.status}`)
    return (await r.json()) as ActivationStatusResponse
  }
}
