import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))

type Result = { data: unknown; error: { message: string } | null }

interface MockOpts {
  authUser?: { id: string } | null
  /** Linha de store_users encontrada na verificação de autorização (caller). */
  storeUser?: { store_id: string; role?: string } | null
  /** Linha de store_users encontrada na busca pelo membro a remover (DELETE /[id]). */
  member?: { id: string; role: string; is_active: boolean } | null
  memberFetchError?: { message: string } | null
  /** Resultado do auth.admin.inviteUserByEmail. */
  inviteResult?: { data: unknown; error: { message: string } | null }
  /** Resultado do update is_active: false. */
  updateResult?: Result
}

function setupMocks(opts: MockOpts = {}) {
  const {
    authUser = { id: 'user-1' },
    storeUser = { store_id: 'store-1', role: 'owner' },
    member = { id: 'member-1', role: 'staff', is_active: true },
    memberFetchError = null,
    inviteResult = { data: null, error: null },
    updateResult = { data: null, error: null },
  } = opts

  const userClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: authUser }, error: null }),
    },
  }

  const adminClient: Record<string, unknown> = {}
  const chainable = ['from', 'select', 'insert', 'update', 'delete', 'eq']
  chainable.forEach(m => { adminClient[m] = vi.fn().mockReturnValue(adminClient) })

  // .single() é chamado em sequência:
  //   1ª — caller (store_users do user logado)
  //   2ª — member alvo (apenas no DELETE)
  let singleCallCount = 0
  adminClient.single = vi.fn().mockImplementation(() => {
    singleCallCount += 1
    if (singleCallCount === 1) {
      // Caller (autorização)
      return Promise.resolve({ data: storeUser, error: null })
    }
    // 2ª chamada (DELETE): membro alvo
    return Promise.resolve({ data: member, error: memberFetchError })
  })

  // Update is_active: false (delete) — caller faz await direto após eq()
  adminClient.then = vi.fn().mockImplementation((onFulfilled: (v: Result) => unknown) =>
    Promise.resolve(updateResult).then(onFulfilled)
  )

  adminClient.auth = {
    admin: {
      inviteUserByEmail: vi.fn().mockResolvedValue(inviteResult),
    },
  }

  vi.doMock('@/lib/supabase/server', () => ({
    createClient: vi.fn().mockResolvedValue(userClient),
    createAdminClient: vi.fn().mockReturnValue(adminClient),
  }))

  return { userClient, adminClient }
}

function makeReq(body?: unknown) {
  return new Request('http://localhost/api/team/invite', {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
  })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.resetModules()
})

// ── POST /api/team/invite ────────────────────────────────────────────────────

describe('POST /api/team/invite', () => {
  it('401 quando não autenticado', async () => {
    setupMocks({ authUser: null })
    const { POST } = await import('@/app/api/team/invite/route')
    const res = await POST(makeReq({ email: 'a@b.com', store_id: 'store-1' }) as never)
    expect(res.status).toBe(401)
  })

  it('400 quando o body não é JSON válido', async () => {
    setupMocks({})
    const { POST } = await import('@/app/api/team/invite/route')
    const req = new Request('http://localhost/api/team/invite', {
      method: 'POST',
      body: 'not-json',
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
  })

  it('422 com e-mail inválido', async () => {
    setupMocks({})
    const { POST } = await import('@/app/api/team/invite/route')
    const res = await POST(makeReq({ email: 'sem-arroba', store_id: 'store-1' }) as never)
    expect(res.status).toBe(422)
  })

  it('422 sem store_id', async () => {
    setupMocks({})
    const { POST } = await import('@/app/api/team/invite/route')
    const res = await POST(makeReq({ email: 'a@b.com' }) as never)
    expect(res.status).toBe(422)
  })

  it('403 quando o usuário não pertence à loja indicada (anti-cross-tenant)', async () => {
    setupMocks({ storeUser: null })
    const { POST } = await import('@/app/api/team/invite/route')
    const res = await POST(makeReq({ email: 'a@b.com', store_id: 'outra-loja' }) as never)
    expect(res.status).toBe(403)
  })

  it('200 e dispara o convite quando autorizado', async () => {
    const { adminClient } = setupMocks({})
    const { POST } = await import('@/app/api/team/invite/route')
    const res = await POST(makeReq({ email: 'novo@vendedor.com', store_id: 'store-1' }) as never)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    const invite = (adminClient.auth as { admin: { inviteUserByEmail: ReturnType<typeof vi.fn> } }).admin.inviteUserByEmail
    expect(invite).toHaveBeenCalledWith('novo@vendedor.com', { data: { store_id: 'store-1' } })
  })

  it('500 quando o invite do Supabase falha', async () => {
    setupMocks({
      inviteResult: { data: null, error: { message: 'rate limit' } },
    })
    const { POST } = await import('@/app/api/team/invite/route')
    const res = await POST(makeReq({ email: 'a@b.com', store_id: 'store-1' }) as never)
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'rate limit' })
  })

  it('verifica autorização por (user_id, store_id) — ambos filtros aplicados', async () => {
    const { adminClient } = setupMocks({})
    const { POST } = await import('@/app/api/team/invite/route')
    await POST(makeReq({ email: 'a@b.com', store_id: 'store-1' }) as never)

    expect(adminClient.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(adminClient.eq).toHaveBeenCalledWith('store_id', 'store-1')
  })
})

// ── DELETE /api/team/[id] ────────────────────────────────────────────────────

describe('DELETE /api/team/[id]', () => {
  it('401 quando não autenticado', async () => {
    setupMocks({ authUser: null })
    const { DELETE } = await import('@/app/api/team/[id]/route')
    const res = await DELETE(new Request('http://x') as never, makeParams('any') as never)
    expect(res.status).toBe(401)
  })

  it('404 quando caller não tem store_user vinculado', async () => {
    setupMocks({ storeUser: null })
    const { DELETE } = await import('@/app/api/team/[id]/route')
    const res = await DELETE(new Request('http://x') as never, makeParams('any') as never)
    expect(res.status).toBe(404)
  })

  it('403 quando caller não é owner', async () => {
    setupMocks({ storeUser: { store_id: 'store-1', role: 'staff' } })
    const { DELETE } = await import('@/app/api/team/[id]/route')
    const res = await DELETE(new Request('http://x') as never, makeParams('member-1') as never)
    expect(res.status).toBe(403)
  })

  it('404 quando alvo está em OUTRA loja (anti-cross-tenant)', async () => {
    // Caller é owner da store-1; query do membro alvo retorna null porque
    // o filtro eq(store_id, store-1) não encontra o membro de outra loja.
    setupMocks({
      storeUser: { store_id: 'store-1', role: 'owner' },
      member: null,
      memberFetchError: { message: 'not found' },
    })
    const { DELETE } = await import('@/app/api/team/[id]/route')
    const res = await DELETE(new Request('http://x') as never, makeParams('alvo-de-outra-loja') as never)
    expect(res.status).toBe(404)
  })

  it('403 quando o membro alvo é owner (proteção contra auto-remoção)', async () => {
    setupMocks({
      storeUser: { store_id: 'store-1', role: 'owner' },
      member: { id: 'owner-1', role: 'owner', is_active: true },
    })
    const { DELETE } = await import('@/app/api/team/[id]/route')
    const res = await DELETE(new Request('http://x') as never, makeParams('owner-1') as never)
    expect(res.status).toBe(403)
  })

  it('200 e soft-delete quando owner remove membro staff da mesma loja', async () => {
    const { adminClient } = setupMocks({
      storeUser: { store_id: 'store-1', role: 'owner' },
      member: { id: 'staff-1', role: 'staff', is_active: true },
    })
    const { DELETE } = await import('@/app/api/team/[id]/route')

    const res = await DELETE(new Request('http://x') as never, makeParams('staff-1') as never)
    expect(res.status).toBe(200)
    expect(adminClient.update).toHaveBeenCalledWith({ is_active: false })
    expect(adminClient.eq).toHaveBeenCalledWith('id', 'staff-1')
    expect(adminClient.eq).toHaveBeenCalledWith('store_id', 'store-1')
  })

  it('500 quando o update final falha', async () => {
    setupMocks({
      storeUser: { store_id: 'store-1', role: 'owner' },
      member: { id: 'staff-1', role: 'staff', is_active: true },
      updateResult: { data: null, error: { message: 'db error' } },
    })
    const { DELETE } = await import('@/app/api/team/[id]/route')
    const res = await DELETE(new Request('http://x') as never, makeParams('staff-1') as never)
    expect(res.status).toBe(500)
  })
})
