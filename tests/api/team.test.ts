import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))

type Result = { data: unknown; error: { message: string } | null }

interface MockOpts {
  authUser?: { id: string } | null
  /** Linha de store_users encontrada na verificação de autorização (POST /invite). */
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

  // .single() pode ser chamado em 2 contextos diferentes (invite ou delete-member).
  // Distinguimos pelo argumento atual de from(): se for 'store_users' E o filtro
  // de id já foi aplicado (eq 2x), é a busca de membro; caso contrário, é storeUser.
  let singleCallCount = 0
  adminClient.single = vi.fn().mockImplementation(() => {
    singleCallCount += 1
    // 1ª chamada — sempre a busca por store_user (autorização)
    if (singleCallCount === 1) {
      // Se o teste forneceu member explicitamente, este single é o do DELETE → member
      // Caso contrário, retorna storeUser (POST /invite)
      // Heurística: o POST sempre passa por storeUser primeiro. Vamos definir via env do teste.
      return Promise.resolve({
        data: opts.member !== undefined ? member : storeUser,
        error: opts.member !== undefined ? memberFetchError : null,
      })
    }
    return Promise.resolve({ data: null, error: null })
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
//
// ⚠️ ATENÇÃO: esta rota NÃO verifica autenticação e NÃO filtra por store_id da
// loja do caller. Item registrado no BACKLOG como [alta] severidade.
// Os testes abaixo documentam o comportamento atual; quando o bug for corrigido,
// adicione casos para 401 (sem auth) e 403 (cross-tenant).

describe('DELETE /api/team/[id] — comportamento atual', () => {
  it('404 quando o membro não existe', async () => {
    setupMocks({ member: null, memberFetchError: { message: 'not found' } })
    const { DELETE } = await import('@/app/api/team/[id]/route')
    const res = await DELETE(new Request('http://x') as never, makeParams('inexistente') as never)
    expect(res.status).toBe(404)
  })

  it('403 quando o membro é owner (não pode ser removido)', async () => {
    setupMocks({ member: { id: 'owner-1', role: 'owner', is_active: true } })
    const { DELETE } = await import('@/app/api/team/[id]/route')
    const res = await DELETE(new Request('http://x') as never, makeParams('owner-1') as never)
    expect(res.status).toBe(403)
  })

  it('200 e soft-delete (is_active: false) para membro staff', async () => {
    const { adminClient } = setupMocks({
      member: { id: 'staff-1', role: 'staff', is_active: true },
    })
    const { DELETE } = await import('@/app/api/team/[id]/route')

    const res = await DELETE(new Request('http://x') as never, makeParams('staff-1') as never)
    expect(res.status).toBe(200)
    expect(adminClient.update).toHaveBeenCalledWith({ is_active: false })
    expect(adminClient.eq).toHaveBeenCalledWith('id', 'staff-1')
  })

  it('500 quando o update falha', async () => {
    setupMocks({
      member: { id: 'staff-1', role: 'staff', is_active: true },
      updateResult: { data: null, error: { message: 'db error' } },
    })
    const { DELETE } = await import('@/app/api/team/[id]/route')
    const res = await DELETE(new Request('http://x') as never, makeParams('staff-1') as never)
    expect(res.status).toBe(500)
  })
})
