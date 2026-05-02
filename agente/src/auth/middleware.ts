import crypto from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import { supabase } from '../db'
import * as jwtCache from './jwtCache'
import { verifyTicket } from './sseTicket'

declare module 'express-serve-static-core' {
  interface Request {
    storeId?: string
    isMaster?: boolean
  }
}

function isAuthEnabled(): boolean {
  return process.env.AUTH_ENABLED === 'true'
}

function reject(req: Request, res: Response, next: NextFunction, reason: string): void {
  if (isAuthEnabled()) {
    res.status(401).json({ error: 'unauthorized', reason })
    return
  }
  console.warn(`[auth-shadow] would-reject ${req.method} ${req.path}: ${reason}`)
  next()
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return reject(req, res, next, 'no-token')

  let user = jwtCache.get(token)
  if (!user) {
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data.user) return reject(req, res, next, 'invalid-token')
    user = data.user
    jwtCache.set(token, user)
  }

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>
  const appMeta = (user.app_metadata ?? {}) as Record<string, unknown>
  const storeId = (meta.store_id as string | undefined) ?? (appMeta.store_id as string | undefined)
  const isMaster = meta.is_master === true || appMeta.is_master === true

  if (!storeId && !isMaster) return reject(req, res, next, 'no-store-id')

  const override = req.query.store_id_override
  req.storeId = isMaster && typeof override === 'string' && override
    ? override
    : (storeId ?? '')
  req.isMaster = isMaster
  next()
}

export function requireWebhookSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.EVOLUTION_WEBHOOK_SECRET ?? ''
  const provided = req.params.secret ?? ''

  if (!expected) {
    console.error('[auth] EVOLUTION_WEBHOOK_SECRET não configurado — rejeitando webhook')
    res.sendStatus(404)
    return
  }

  const providedBuf = Buffer.from(provided, 'utf8')
  const expectedBuf = Buffer.from(expected, 'utf8')
  if (providedBuf.length !== expectedBuf.length) {
    res.sendStatus(404)
    return
  }
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    res.sendStatus(404)
    return
  }
  next()
}

export function requireSseTicket(req: Request, res: Response, next: NextFunction): void {
  const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : ''
  if (!ticket) return reject(req, res, next, 'no-ticket')

  const payload = verifyTicket(ticket)
  if (!payload) return reject(req, res, next, 'invalid-ticket')

  req.storeId = payload.store_id
  req.isMaster = payload.is_master
  next()
}
