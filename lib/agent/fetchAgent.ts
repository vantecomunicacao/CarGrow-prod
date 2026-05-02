import { createClient } from '@/lib/supabase/client'

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? 'http://localhost:3001'

async function getAccessToken(): Promise<string | null> {
  const supabase = createClient()
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

export async function fetchAgent(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  const token = await getAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(`${AGENT_URL}${path}`, { ...init, headers })
}

export async function getSseTicket(): Promise<string> {
  const res = await fetchAgent('/auth/sse-ticket', { method: 'POST' })
  if (!res.ok) throw new Error(`SSE ticket request failed: ${res.status}`)
  const data = await res.json() as { ticket: string }
  return data.ticket
}

export function buildSseUrl(path: string, ticket: string): string {
  const sep = path.includes('?') ? '&' : '?'
  return `${AGENT_URL}${path}${sep}ticket=${encodeURIComponent(ticket)}`
}
