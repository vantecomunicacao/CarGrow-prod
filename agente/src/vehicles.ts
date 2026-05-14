import { supabase } from './db'

interface VehicleFilters {
  marca?: string
  modelo?: string
  preco_min?: number
  preco_max?: number
  ano_min?: number
  ano_max?: number
  combustivel?: string
  transmissao?: string
}

interface Vehicle {
  brand: string
  model: string
  version: string | null
  year_model: number
  color: string
  mileage: number
  fuel: string
  transmission: string
  price: number
  price_negotiable: boolean
  features: string[]
  description: string | null
}

const FUEL_LABELS: Record<string, string> = {
  flex: 'Flex', gasoline: 'Gasolina', diesel: 'Diesel',
  electric: 'Elétrico', hybrid: 'Híbrido', gas: 'GNV',
}

const TRANSMISSION_LABELS: Record<string, string> = {
  manual: 'Manual', automatic: 'Automático',
  automated: 'Automatizado', cvt: 'CVT',
}

function formatPrice(price: number): string {
  return price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatMileage(km: number): string {
  return km === 0 ? '0 km' : `${km.toLocaleString('pt-BR')} km`
}

function vehicleToText(v: Vehicle): string {
  const lines = [
    `🚗 *${v.brand} ${v.model}${v.version ? ' ' + v.version : ''} ${v.year_model}*`,
    `💰 ${formatPrice(v.price)}${v.price_negotiable ? ' (negociável)' : ''}`,
    `🎨 Cor: ${v.color} | 📍 KM: ${formatMileage(v.mileage)}`,
    `⚙️ Câmbio: ${TRANSMISSION_LABELS[v.transmission] ?? v.transmission} | ⛽ ${FUEL_LABELS[v.fuel] ?? v.fuel}`,
  ]
  if (v.features.length > 0) {
    lines.push(`✅ ${v.features.slice(0, 4).join(', ')}${v.features.length > 4 ? '...' : ''}`)
  }
  if (v.description) {
    lines.push(`📝 ${v.description.slice(0, 120)}${v.description.length > 120 ? '...' : ''}`)
  }
  return lines.join('\n')
}

export async function searchVehicles(storeId: string, filters: VehicleFilters, limit = 1000): Promise<string> {
  let query = supabase
    .from('vehicles')
    .select('brand,model,version,year_model,color,mileage,fuel,transmission,price,price_negotiable,features,description')
    .eq('store_id', storeId)
    .eq('status', 'available')
    .order('featured', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (filters.marca) query = query.ilike('brand', `%${filters.marca}%`)
  if (filters.modelo) query = query.ilike('model', `%${filters.modelo}%`)
  if (filters.preco_min) query = query.gte('price', filters.preco_min)
  if (filters.preco_max) query = query.lte('price', filters.preco_max)
  if (filters.ano_min) query = query.gte('year_model', filters.ano_min)
  if (filters.ano_max) query = query.lte('year_model', filters.ano_max)
  if (filters.combustivel) query = query.eq('fuel', filters.combustivel)
  if (filters.transmissao) query = query.eq('transmission', filters.transmissao)

  const { data, error } = await query

  if (error || !data || data.length === 0) {
    return 'Nenhum veículo encontrado com esses critérios no momento.'
  }

  const items = (data as Vehicle[]).map(vehicleToText).join('\n\n---\n\n')
  return `Encontrei ${data.length} veículo(s):\n\n${items}`
}

/** Busca as imagens de um veículo pelo id */
export async function getVehicleImages(vehicleId: string): Promise<string[]> {
  const { data } = await supabase
    .from('vehicle_images')
    .select('url')
    .eq('vehicle_id', vehicleId)
    .order('sort_order', { ascending: true })
  return (data ?? []).map(r => r.url as string)
}

/** Busca o id do veículo pelo nome (marca + modelo) dentro da loja */
export async function findVehicleId(storeId: string, brand: string, model: string): Promise<string | null> {
  // Tenta match completo primeiro (ex: "Corolla XEi")
  const { data } = await supabase
    .from('vehicles')
    .select('id')
    .eq('store_id', storeId)
    .eq('status', 'available')
    .ilike('brand', `%${brand}%`)
    .ilike('model', `%${model}%`)
    .limit(1)
    .single()

  if (data?.id) return data.id

  // Fallback: tenta só a primeira palavra do modelo (ex: "Corolla" sem "XEi")
  // Isso cobre o caso onde o DB tem model="Corolla" e version="XEi"
  const modelFirstWord = model.split(/\s+/)[0]
  if (modelFirstWord && modelFirstWord !== model) {
    const { data: fallback } = await supabase
      .from('vehicles')
      .select('id')
      .eq('store_id', storeId)
      .eq('status', 'available')
      .ilike('brand', `%${brand}%`)
      .ilike('model', `%${modelFirstWord}%`)
      .limit(1)
      .single()
    return fallback?.id ?? null
  }

  return null
}

function vehicleToSummary(v: Vehicle): string {
  const price = formatPrice(v.price) + (v.price_negotiable ? ' (negociável)' : '')
  return `- ${v.brand} ${v.model}${v.version ? ' ' + v.version : ''} ${v.year_model} — ${price}`
}

// Cache do contexto de estoque por loja (TTL 60s) — evita query repetida a cada mensagem
const stockCache = new Map<string, { content: string; expiresAt: number }>()
const STOCK_TTL_MS = 60 * 1000

/** Retorna todos os veículos disponíveis da loja formatados para injetar no system prompt */
export async function getStockContext(storeId: string, limit = 20, format: 'full' | 'summary' = 'full'): Promise<string> {
  const cacheKey = `${storeId}:${limit}:${format}`
  const cached = stockCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.content

  const { data, error } = await supabase
    .from('vehicles')
    .select('brand,model,version,year_model,color,mileage,fuel,transmission,price,price_negotiable,features,description')
    .eq('store_id', storeId)
    .eq('status', 'available')
    .order('featured', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  let content: string
  if (error || !data || data.length === 0) {
    content = 'Nenhum veículo disponível no estoque no momento.'
  } else if (format === 'summary') {
    const items = (data as Vehicle[]).map(vehicleToSummary).join('\n')
    content = `## Estoque atual (${data.length} veículo(s) disponíveis):\n${items}\n\nQuando o cliente pedir detalhes de UM veículo específico, apresente todas as informações disponíveis sobre ele.`
  } else {
    const items = (data as Vehicle[]).map(vehicleToText).join('\n\n')
    content = `## Estoque atual (${data.length} veículo(s) disponíveis):\n\n${items}`
  }

  stockCache.set(cacheKey, { content, expiresAt: Date.now() + STOCK_TTL_MS })
  return content
}
