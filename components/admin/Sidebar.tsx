'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Car, Users, UserCheck,
  Settings, Bot, Plug, LogOut, Store, ScrollText, BookMarked, MessagesSquare,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  badge?: number
}

const NAV_MAIN: NavItem[] = [
  { label: 'Dashboard',    href: '/admin/dashboard',       icon: LayoutDashboard },
  { label: 'Veículos',    href: '/admin/vehicles',        icon: Car },
  { label: 'Leads',       href: '/admin/leads',           icon: Users },
  { label: 'Conversas',   href: '/admin/conversations',   icon: MessagesSquare },
  { label: 'Equipe',      href: '/admin/team',            icon: UserCheck },
]

const NAV_CONFIG: NavItem[] = [
  { label: 'Vitrine',        href: '/admin/storefront',   icon: Store },
  { label: 'Configurações',  href: '/admin/settings',     icon: Settings },
  { label: 'Agente de IA',   href: '/admin/agent',        icon: Bot },
  { label: 'Logs do Agente', href: '/admin/logs',         icon: ScrollText },
  { label: 'Integrações',    href: '/admin/integrations', icon: Plug },
  { label: 'Documentação',   href: '/admin/docs',         icon: BookMarked },
]

interface SidebarProps {
  storeName: string
  plan: string
  userName: string
  userRole: string
  userInitials: string
  isMaster?: boolean
  newLeadsCount?: number
}

export function Sidebar({
  storeName,
  plan,
  userName,
  userRole,
  userInitials,
  isMaster = false,
  newLeadsCount = 0,
}: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/admin/login')
  }

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + '/')
  }

  return (
    <aside
      className="w-[240px] flex-shrink-0 flex flex-col h-screen fixed left-0 top-0 z-30"
      style={{ background: 'var(--ds-sidebar-bg)' }}
    >
      {/* Logo */}
      <div
        className="flex items-center px-5 py-5"
        style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}
      >
        <Image
          src="/brand/cargrow-logo-light.png"
          alt="CarGrow"
          width={1000}
          height={200}
          priority
          className="h-7 w-auto"
        />
      </div>

      {/* Store info */}
      <div className="mx-3 mt-3 mb-1 px-3 py-2.5 rounded-[10px]" style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Loja atual</p>
        <p className="text-[13px] text-slate-200 font-medium truncate">{storeName}</p>
        <span className="inline-block mt-1 text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'rgba(37,99,235,0.25)', color: '#60A5FA' }}>
          {plan}
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 overflow-y-auto">
        <p className="text-[10px] text-slate-600 uppercase tracking-[0.06em] px-2 pt-3 pb-1.5">
          Menu principal
        </p>
        {NAV_MAIN.map(item => {
          const active = isActive(item.href)
          const Icon = item.icon
          const count = item.label === 'Leads' ? newLeadsCount : 0
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2.5 px-2.5 py-[9px] rounded-lg mb-[1px] text-[13px] transition-colors"
              style={{
                color: active ? '#ffffff' : '#94A3B8',
                background: active ? 'var(--ds-primary-600)' : 'transparent',
              }}
              onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLElement).style.color = '#CBD5E1' } }}
              onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#94A3B8' } }}
            >
              <Icon size={16} />
              <span className="flex-1">{item.label}</span>
              {count > 0 && (
                <span className="bg-red-600 text-white text-[10px] font-medium px-1.5 py-0.5 rounded-full">
                  {count}
                </span>
              )}
            </Link>
          )
        })}

        <p className="text-[10px] text-slate-600 uppercase tracking-[0.06em] px-2 pt-4 pb-1.5">
          Configurações
        </p>
        {NAV_CONFIG.filter(item => item.href !== '/admin/logs' || isMaster).map(item => {
          const active = isActive(item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2.5 px-2.5 py-[9px] rounded-lg mb-[1px] text-[13px] transition-colors"
              style={{
                color: active ? '#ffffff' : '#94A3B8',
                background: active ? 'var(--ds-primary-600)' : 'transparent',
              }}
              onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLElement).style.color = '#CBD5E1' } }}
              onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#94A3B8' } }}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Footer: user */}
      <div style={{ borderTop: '0.5px solid rgba(255,255,255,0.07)', padding: '12px' }}>
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg group cursor-default">
          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-[12px] font-medium text-white" style={{ background: '#1D4ED8' }}>
            {userInitials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-slate-200 font-medium truncate">{userName}</p>
            <p className="text-[11px] text-slate-500">{userRole}</p>
          </div>
          <button
            onClick={handleLogout}
            title="Sair"
            className="opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <LogOut size={14} className="text-slate-500 hover:text-slate-300" />
          </button>
        </div>
      </div>
    </aside>
  )
}
