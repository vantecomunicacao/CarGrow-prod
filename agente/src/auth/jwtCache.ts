import type { User } from '@supabase/supabase-js'

interface CacheEntry {
  user: User
  exp: number
}

const TTL_MS = 60_000
const MAX_ENTRIES = 1000

const cache = new Map<string, CacheEntry>()

export function get(token: string): User | null {
  const entry = cache.get(token)
  if (!entry) return null
  if (entry.exp < Date.now()) {
    cache.delete(token)
    return null
  }
  return entry.user
}

export function set(token: string, user: User): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey) cache.delete(oldestKey)
  }
  cache.set(token, { user, exp: Date.now() + TTL_MS })
}

export function clear(): void {
  cache.clear()
}
