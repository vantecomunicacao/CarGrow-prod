import crypto from 'crypto'

const TICKET_TTL_MS = 60_000

interface TicketPayload {
  store_id: string
  is_master: boolean
  exp: number
}

function getSecret(): Buffer {
  const secret = process.env.SSE_TICKET_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('SSE_TICKET_SECRET não definido ou muito curto (mín. 32 chars)')
  }
  return Buffer.from(secret, 'utf8')
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function fromB64url(str: string): Buffer {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4))
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

export function signTicket(storeId: string, isMaster: boolean): string {
  const payload: TicketPayload = {
    store_id: storeId,
    is_master: isMaster,
    exp: Date.now() + TICKET_TTL_MS,
  }
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const sig = b64url(crypto.createHmac('sha256', getSecret()).update(body).digest())
  return `${body}.${sig}`
}

export function verifyTicket(ticket: string): TicketPayload | null {
  const parts = ticket.split('.')
  if (parts.length !== 2) return null
  const [body, sig] = parts

  const expected = b64url(crypto.createHmac('sha256', getSecret()).update(body).digest())
  const sigBuf = Buffer.from(sig, 'utf8')
  const expBuf = Buffer.from(expected, 'utf8')
  if (sigBuf.length !== expBuf.length) return null
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null

  let payload: TicketPayload
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8'))
  } catch {
    return null
  }

  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
  if (typeof payload.store_id !== 'string') return null
  return payload
}
