import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))

interface AuthGetUserResult { data: { user: { id: string } | null }; error: null }
interface QueryResult { data: unknown; error: { message: string } | null }

/** Cria mocks específicos para o fluxo de master/stores. */
function setupMocks(opts: {
  authUser?: { id: string } | null
  adminUserMeta?: { is_master?: boolean } | null
  slugExists?: boolean
  storeInsertResult?: QueryResult
  createUserResult?: { data: { user: { id: string } | null }; error: { message: string } | null }
  linkResult?: QueryResult
}) {
  const {
    authUser = { id: 'user-1' },
    adminUserMeta = { is_master: true },
    slugExists = false,
    storeInsertResult = { data: { id: 'store-1', name: 'X', slug: 'x', plan: 'trial', is_active: true, created_at: 'now', city: null, state: null, phone: null }, error: null },
    createUserResult = { data: { user: { id: 'owner-1' } }, error: null },
    linkResult = { data: null, error: null },
  } = opts

  // Cliente "user" — só serve para auth.getUser()
  const userClient: Record<string, unknown> = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: authUser }, error: null } as AuthGetUserResult),
    },
  }

  // Cliente "admin" — chain para queries e auth.admin
  const adminClient: Record<string, unknown> = {}
  const chainable = ['from', 'select', 'insert', 'update', 'delete', 'eq']
  chainable.forEach(m => { adminClient[m] = vi.fn().mockReturnValue(adminClient) })

  // maybeSingle: usado na verificação de slug existente
  adminClient.maybeSingle = vi.fn().mockResolvedValue({
    data: slugExists ? { id: 'existing' } : null,
    error: null,
  })

  // single: usado no insert da store
  adminClient.single = vi.fn().mockResolvedValue(storeInsertResult)

  adminClient.auth = {
    admin: {
      getUserById: vi.fn().mockResolvedValue({
        data: { user: adminUserMeta ? { id: authUser?.id, user_metadata: adminUserMeta } : null },
        error: null,
      }),
      createUser: vi.fn().mockResolvedValue(createUserResult),
      deleteUser: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
  }

  // store_users.insert resolve com linkResult (caller faz `await admin.from().insert()`)
  // O insert retorna o chain, e o chain deve ser awaitable; configuramos via .then()
  adminClient.then = vi.fn().mockImplementation((onFulfilled: (v: QueryResult) => unknown) =>
    Promise.resolve(linkResult).then(onFulfilled)
  )

  vi.doMock('@/lib/supabase/server', () => ({
    createClient: vi.fn().mockResolvedValue(userClient),
    createAdminClient: vi.fn().mockReturnValue(adminClient),
  }))

  return { userClient, adminClient }
}

async function importRoute() {
  return await import('@/app/api/master/stores/route')
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/master/stores', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const VALID_BODY = {
  store_name: 'Loja Teste',
  plan: 'trial',
  owner_name: 'Dono',
  owner_email: 'dono@teste.com',
  owner_password: 'senha12345',
}

beforeEach(() => {
  vi.resetModules()
})

describe('POST /api/master/stores — autorização', () => {
  it('403 quando não há usuário logado', async () => {
    setupMocks({ authUser: null })
    const { POST } = await importRoute()

    const res = await POST(makeRequest(VALID_BODY) as never)

    expect(res.status).toBe(403)
  })

  it('403 quando usuário logado não é master', async () => {
    setupMocks({ adminUserMeta: { is_master: false } })
    const { POST } = await importRoute()

    const res = await POST(makeRequest(VALID_BODY) as never)

    expect(res.status).toBe(403)
  })
})

describe('POST /api/master/stores — validação', () => {
  it('400 quando store_name está vazio', async () => {
    setupMocks({})
    const { POST } = await importRoute()

    const res = await POST(makeRequest({ ...VALID_BODY, store_name: '' }) as never)

    expect(res.status).toBe(400)
  })

  it('400 quando senha tem menos de 8 caracteres', async () => {
    setupMocks({})
    const { POST } = await importRoute()

    const res = await POST(makeRequest({ ...VALID_BODY, owner_password: '1234' }) as never)

    expect(res.status).toBe(400)
    const json = await res.json() as { error: string }
    expect(json.error).toMatch(/8 caracteres/)
  })
})

describe('POST /api/master/stores — fluxo feliz', () => {
  it('201 quando cria loja, usuário e link com sucesso', async () => {
    const { adminClient } = setupMocks({})
    const { POST } = await importRoute()

    const res = await POST(makeRequest(VALID_BODY) as never)

    expect(res.status).toBe(201)
    expect(adminClient.from).toHaveBeenCalledWith('stores')
    expect((adminClient.auth as { admin: { createUser: ReturnType<typeof vi.fn> } }).admin.createUser).toHaveBeenCalled()
    expect(adminClient.from).toHaveBeenCalledWith('store_users')
  })
})

describe('POST /api/master/stores — rollback', () => {
  it('500 e deleta a loja quando createUser falha', async () => {
    const { adminClient } = setupMocks({
      createUserResult: { data: { user: null }, error: { message: 'email já existe' } },
    })
    const { POST } = await importRoute()

    const res = await POST(makeRequest(VALID_BODY) as never)

    expect(res.status).toBe(500)
    // Confirma que houve rollback: delete em 'stores'
    expect(adminClient.delete).toHaveBeenCalled()
  })

  it('500 e roda rollback duplo quando link store_users falha', async () => {
    const { adminClient } = setupMocks({
      linkResult: { data: null, error: { message: 'fk violation' } },
    })
    const { POST } = await importRoute()

    const res = await POST(makeRequest(VALID_BODY) as never)

    expect(res.status).toBe(500)
    expect((adminClient.auth as { admin: { deleteUser: ReturnType<typeof vi.fn> } }).admin.deleteUser).toHaveBeenCalledWith('owner-1')
    expect(adminClient.delete).toHaveBeenCalled()
  })
})
