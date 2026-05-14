import { vi } from 'vitest'

type ChainResult = { data: unknown; error: { message: string } | null }

/**
 * Builder fluente que mimetiza o cliente Supabase (`from().select().eq()...`).
 * Cada método encadeável retorna o próprio chain; os terminadores (`single`, `maybeSingle`)
 * e o `await` direto devolvem o `ChainResult` configurado.
 *
 * Uso:
 *   const supa = makeSupabaseChain([
 *     { data: { id: '1' }, error: null },        // 1ª query
 *     { data: null, error: { message: 'fail' } } // 2ª query
 *   ])
 */
export function makeSupabaseChain(results: ChainResult[] = []): Record<string, unknown> {
  const queue = [...results]

  const nextResult = (): ChainResult =>
    queue.shift() ?? { data: null, error: null }

  const chain: Record<string, unknown> = {}
  const chainable = ['from', 'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in', 'is', 'not', 'order', 'limit', 'range', 'rpc']

  chainable.forEach(method => {
    chain[method] = vi.fn().mockReturnValue(chain)
  })

  // Terminadores: retornam o próximo ChainResult
  chain.single = vi.fn().mockImplementation(() => Promise.resolve(nextResult()))
  chain.maybeSingle = vi.fn().mockImplementation(() => Promise.resolve(nextResult()))

  // Quando o caller faz `await query` direto (sem .single()), o builder vira thenable.
  chain.then = vi.fn().mockImplementation((onFulfilled: (v: ChainResult) => unknown) =>
    Promise.resolve(nextResult()).then(onFulfilled)
  )

  // Supabase Auth admin (usado em master/stores)
  chain.auth = {
    admin: {
      createUser: vi.fn().mockImplementation(() => Promise.resolve(nextResult())),
      deleteUser: vi.fn().mockResolvedValue({ data: null, error: null }),
      getUserById: vi.fn().mockImplementation(() => Promise.resolve(nextResult())),
    },
    getUser: vi.fn().mockImplementation(() => Promise.resolve(nextResult())),
  }

  return chain
}

/** Helper para preparar mock da rota: substitui os exports de '@/lib/supabase/server'. */
export function mockSupabaseModule(
  client: Record<string, unknown>,
  adminClient: Record<string, unknown> = client
) {
  vi.doMock('@/lib/supabase/server', () => ({
    createClient: vi.fn().mockResolvedValue(client),
    createAdminClient: vi.fn().mockReturnValue(adminClient),
  }))
}
