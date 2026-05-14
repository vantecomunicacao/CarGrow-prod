import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeSupabaseChain, mockSupabaseModule } from '../helpers/supabase-mock'

// Stub do Next: cookies (não usado nesta rota, mas o helper de supabase importa de 'next/headers')
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))

async function importRoute() {
  return await import('@/app/api/leads/[id]/route')
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/leads/abc', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.resetModules()
})

describe('PATCH /api/leads/[id]', () => {
  it('retorna 400 quando o body não é JSON válido', async () => {
    mockSupabaseModule(makeSupabaseChain())
    const { PATCH } = await importRoute()

    const req = new Request('http://localhost/api/leads/abc', {
      method: 'PATCH',
      body: 'not-json',
      headers: { 'content-type': 'application/json' },
    })
    const res = await PATCH(req as never, makeParams('abc') as never)

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('inválido') })
  })

  it('retorna 422 para status inválido', async () => {
    mockSupabaseModule(makeSupabaseChain())
    const { PATCH } = await importRoute()

    const res = await PATCH(makeRequest({ status: 'invalid_status' }) as never, makeParams('abc') as never)

    expect(res.status).toBe(422)
    const json = await res.json() as { error: string }
    expect(json.error).toMatch(/Status inválido/)
  })

  it('retorna 400 quando nem status nem ai_active são informados', async () => {
    mockSupabaseModule(makeSupabaseChain())
    const { PATCH } = await importRoute()

    const res = await PATCH(makeRequest({}) as never, makeParams('abc') as never)

    expect(res.status).toBe(400)
  })

  it('atualiza status com sucesso', async () => {
    const chain = makeSupabaseChain([{ data: null, error: null }])
    mockSupabaseModule(chain)
    const { PATCH } = await importRoute()

    const res = await PATCH(makeRequest({ status: 'qualified' }) as never, makeParams('abc') as never)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'qualified' }))
    expect(chain.eq).toHaveBeenCalledWith('id', 'abc')
  })

  it('limpa ai_paused_reason quando ai_active vira true', async () => {
    const chain = makeSupabaseChain([{ data: null, error: null }])
    mockSupabaseModule(chain)
    const { PATCH } = await importRoute()

    const res = await PATCH(makeRequest({ ai_active: true }) as never, makeParams('abc') as never)

    expect(res.status).toBe(200)
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({
      ai_active: true,
      ai_paused_reason: null,
    }))
  })

  it('NÃO limpa ai_paused_reason quando ai_active vira false', async () => {
    const chain = makeSupabaseChain([{ data: null, error: null }])
    mockSupabaseModule(chain)
    const { PATCH } = await importRoute()

    await PATCH(makeRequest({ ai_active: false }) as never, makeParams('abc') as never)

    const updateArg = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(updateArg.ai_active).toBe(false)
    expect(updateArg).not.toHaveProperty('ai_paused_reason')
  })

  it('retorna 500 quando Supabase falha', async () => {
    mockSupabaseModule(makeSupabaseChain([
      { data: null, error: { message: 'conn refused' } },
    ]))
    const { PATCH } = await importRoute()

    const res = await PATCH(makeRequest({ status: 'qualified' }) as never, makeParams('abc') as never)

    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'conn refused' })
  })
})

describe('DELETE /api/leads/[id]', () => {
  it('deleta o lead com sucesso', async () => {
    const chain = makeSupabaseChain([{ data: null, error: null }])
    mockSupabaseModule(chain)
    const { DELETE } = await importRoute()

    const req = new Request('http://localhost/api/leads/abc', { method: 'DELETE' })
    const res = await DELETE(req as never, makeParams('abc') as never)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(chain.delete).toHaveBeenCalled()
    expect(chain.eq).toHaveBeenCalledWith('id', 'abc')
  })

  it('retorna 500 quando o delete falha', async () => {
    mockSupabaseModule(makeSupabaseChain([
      { data: null, error: { message: 'fk violation' } },
    ]))
    const { DELETE } = await importRoute()

    const req = new Request('http://localhost/api/leads/abc', { method: 'DELETE' })
    const res = await DELETE(req as never, makeParams('abc') as never)

    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'fk violation' })
  })
})
