/**
 * Connected-mode client for /api/v1/*. Only used when GATED_API_KEY is set.
 * MUST NOT call /activate/* — that's activationClient's job.
 */
export class GatedApiClient {
  constructor(private base: string, private apiKey: string) {}

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const r = await fetch(`${this.base}/api/v1${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
        ...(init.headers ?? {}),
      },
    })
    if (!r.ok) throw new Error(`${path} → ${r.status}`)
    return (await r.json()) as T
  }

  resolvePolicy(scope_type: string, scope_id: string) {
    return this.req(`/policy/resolve?scope_type=${scope_type}&scope_id=${encodeURIComponent(scope_id)}`)
  }

  ingestCrawlerEvent(syncToken: string, body: Record<string, unknown>) {
    // Note: ingest uses the sync_token, not the api_key.
    return fetch(`${this.base}/api/v1/ingest/crawler-event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${syncToken}` },
      body: JSON.stringify(body),
    })
  }
}
