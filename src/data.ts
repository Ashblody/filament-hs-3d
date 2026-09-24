import type { CatalogColor, MaterialCategory, MaterialDef, PaletteColor, PrinterDef, Spool } from './types.ts'
import { uid } from './storage.ts'

export const ENERGY_COST = 0.2
export const LABOR_RATE = 20
export const DEFAULT_FAILURE_RATE = 20
export const DEFAULT_MARKUP = 1.5
export const DEFAULT_PREP_MIN = 20
export const DEFAULT_POST_MIN = 10
export const DEFAULT_FULL_SPOOL_G = 1000
export const APP_PAGES_URL = 'https://ashblody.github.io/filament-hs-3d/'

export const MATERIAL_CATEGORIES: MaterialCategory[] = [
  'PLA',
  'PLA+',
  'PETG',
  'PCTG',
  'ABS',
  'ASA',
  'PC',
  'TPU',
  'Nylon',
  'Woodfill',
  'Resin',
  'Other',
]

export const PRINTERS: PrinterDef[] = [
  {
    id: 'core-one-indx',
    name: 'Prusa CORE ONE INDX',
    price: 2249,
    lifeHours: 3000,
    serviceCost: 100,
    energyKwhPerH: 0.2,
  },
  {
    id: 'core-one',
    name: 'PRUSA CORE ONE',
    price: 1200,
    lifeHours: 3000,
    serviceCost: 200,
    energyKwhPerH: 0.2,
  },
  {
    id: 'mini',
    name: 'Prusa MINI',
    price: 452,
    lifeHours: 3000,
    serviceCost: 100,
    energyKwhPerH: 0.1,
  },
]

export const MATERIALS: MaterialDef[] = [
  { id: 'trcek-pla', name: 'PLASTIKA TRCEK PLA', category: 'PLA', pricePerKg: 21, spoolPrice: 21, spoolKg: 1 },
  { id: 'trcek-pla-plus', name: 'Trček PLA+', category: 'PLA+', pricePerKg: 20, spoolPrice: 20, spoolKg: 1 },
  { id: 'filamentium-pla', name: 'Filamentium PLA Extrafill', category: 'PLA', pricePerKg: 27.5 / 0.75, spoolPrice: 27.5, spoolKg: 0.75 },
  { id: 'prusament-pla', name: 'PRUSAMENT PLA', category: 'PLA', pricePerKg: 32, spoolPrice: 32, spoolKg: 1 },
  { id: 'trcek-petg', name: 'PLASTIKA TRCEK PETG', category: 'PETG', pricePerKg: 22, spoolPrice: 22, spoolKg: 1 },
  { id: 'prusament-petg', name: 'PRUSAMENT PETG', category: 'PETG', pricePerKg: 32, spoolPrice: 32, spoolKg: 1 },
  { id: 'petg-cf-prusa', name: 'Prusament PETG CF', category: 'PETG', pricePerKg: 60, spoolPrice: 60, spoolKg: 1 },
  { id: 'pet-cf-trcek', name: 'Trcek PET CF', category: 'PETG', pricePerKg: 65, spoolPrice: 65, spoolKg: 1 },
  { id: 'pctg-generic', name: 'PCTG (generic)', category: 'PCTG', pricePerKg: 35, spoolPrice: 35, spoolKg: 1 },
  { id: 'trcek-abs', name: 'Trček ABS', category: 'ABS', pricePerKg: 18 / 0.7, spoolPrice: 18, spoolKg: 0.7 },
  { id: 'prusament-asa', name: 'PRUSAMENT ASA', category: 'ASA', pricePerKg: 32, spoolPrice: 32, spoolKg: 1 },
  { id: 'trcek-asa', name: 'Trček ASA', category: 'ASA', pricePerKg: 20 / 0.7, spoolPrice: 20, spoolKg: 0.7 },
  { id: 'trcek-asa-mix', name: 'Trček ASA MIX', category: 'ASA', pricePerKg: 19 / 0.7, spoolPrice: 19, spoolKg: 0.7 },
  { id: 'trcek-pc', name: 'Trček PC', category: 'PC', pricePerKg: 48, spoolPrice: 48, spoolKg: 1 },
  { id: 'pc-blend', name: 'PC Blend Prusa', category: 'PC', pricePerKg: 45 / 0.97, spoolPrice: 45, spoolKg: 0.97 },
  { id: 'tpu-trcek', name: 'TPU Trcek', category: 'TPU', pricePerKg: 27 / 0.7, spoolPrice: 27, spoolKg: 0.7 },
  { id: 'tpu-prusa', name: 'TPU Prusa', category: 'TPU', pricePerKg: 39 / 0.5, spoolPrice: 39, spoolKg: 0.5 },
  { id: 'nylon-trcek', name: 'Nylon Trcek', category: 'Nylon', pricePerKg: 40 / 0.7, spoolPrice: 40, spoolKg: 0.7 },
  { id: 'nylon-prusa', name: 'Nylon Prusa', category: 'Nylon', pricePerKg: 110 / 0.8, spoolPrice: 110, spoolKg: 0.8 },
  { id: 'trcek-paht-cf', name: 'Trček PAHT CF', category: 'Nylon', pricePerKg: 45, spoolPrice: 45, spoolKg: 1 },
  { id: 'woodfill-prusa', name: 'Woodfill PRUSA', category: 'Woodfill', pricePerKg: 40, spoolPrice: 40, spoolKg: 1 },
  { id: 'woodfill-trcek', name: 'woodfill trcek', category: 'Woodfill', pricePerKg: 24 / 0.7, spoolPrice: 24, spoolKg: 0.7 },
  { id: 'resin-generic', name: 'Resin (splošno)', category: 'Resin', pricePerKg: 50, spoolPrice: 50, spoolKg: 1 },
]

export function findPrinter(id: string): PrinterDef {
  return PRINTERS.find((p) => p.id === id) ?? PRINTERS[0]!
}

export function findMaterial(id: string): MaterialDef {
  return MATERIALS.find((m) => m.id === id) ?? MATERIALS[0]!
}

export function seedSpools(): Spool[] {
  const now = new Date().toISOString()
  const samples: Array<Omit<Spool, 'id' | 'createdAt' | 'updatedAt'>> = [
    {
      material: 'PLA',
      color: 'Črna',
      colorHex: '#1a1a1a',
      brandName: 'PLASTIKA TRCEK PLA',
      remainingGrams: 780,
      fullSpoolGrams: 1000,
      pricePerKg: 21,
      notes: 'Vzorec — Trcek PLA',
    },
    {
      material: 'PLA',
      color: 'Oranžna',
      colorHex: '#e85d04',
      brandName: 'PRUSAMENT PLA',
      remainingGrams: 920,
      fullSpoolGrams: 1000,
      pricePerKg: 32,
      notes: 'Vzorec — Prusament',
    },
    {
      material: 'PLA',
      color: 'Bela',
      colorHex: '#f5f5f5',
      brandName: 'PRUSAMENT PLA',
      remainingGrams: 450,
      fullSpoolGrams: 1000,
      pricePerKg: 32,
      notes: '',
    },
    {
      material: 'PETG',
      color: 'Transparentna',
      colorHex: '#c8dcf0',
      brandName: 'PRUSAMENT PETG',
      remainingGrams: 600,
      fullSpoolGrams: 1000,
      pricePerKg: 32,
      notes: '',
    },
    {
      material: 'ASA',
      color: 'Siva',
      colorHex: '#8a8f98',
      brandName: 'PRUSAMENT ASA',
      remainingGrams: 850,
      fullSpoolGrams: 1000,
      pricePerKg: 32,
      notes: 'Za zunanjo uporabo',
    },
  ]
  return samples.map((s) => ({
    ...s,
    id: uid('spool'),
    createdAt: now,
    updatedAt: now,
  }))
}

export function parsePrintHours(hhmmOrHours: string): number {
  const raw = hhmmOrHours.trim().replace(',', '.')
  if (!raw) return 0
  if (raw.includes(':')) {
    const [h, m] = raw.split(':')
    const hours = Number(h) || 0
    const mins = Number(m) || 0
    return hours + mins / 60
  }
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

export function formatEuro(n: number): string {
  return `${n.toFixed(2)} €`
}

export function formatGrams(n: number): string {
  return `${Math.round(n)} g`
}

export function percentFromGrams(remaining: number, full: number): number {
  if (full <= 0) return 0
  return Math.max(0, Math.min(100, (remaining / full) * 100))
}

export function gramsFromPercent(percent: number, full: number): number {
  return Math.max(0, (percent / 100) * full)
}


/** Map spool.color (Slovenian name, English, or #hex) → CSS color. Unknown → null. */
const COLOR_NAME_MAP: Record<string, string> = {
  črna: '#1a1a1a',
  crna: '#1a1a1a',
  black: '#1a1a1a',
  'galaxy black': '#0d0d0d',
  'jet black': '#111111',
  bela: '#f5f5f5',
  white: '#f5f5f5',
  'pearl white': '#f8f4ec',
  'natural': '#e8e0d0',
  naravna: '#e8e0d0',
  siva: '#8a8f98',
  gray: '#8a8f98',
  grey: '#8a8f98',
  'silver': '#c0c4cc',
  srebrna: '#c0c4cc',
  oranžna: '#e85d04',
  oranzna: '#e85d04',
  orange: '#e85d04',
  'prusa orange': '#e85d04',
  rdeča: '#c41e3a',
  rdeca: '#c41e3a',
  red: '#c41e3a',
  modra: '#1e5aa8',
  blue: '#1e5aa8',
  'royal blue': '#1e5aa8',
  zelena: '#2e7d32',
  green: '#2e7d32',
  rumena: '#f5c518',
  yellow: '#f5c518',
  roza: '#e91e8c',
  pink: '#e91e8c',
  vijolična: '#7b2cbf',
  vijolicna: '#7b2cbf',
  purple: '#7b2cbf',
  rjava: '#6d4c41',
  brown: '#6d4c41',
  transparentna: 'rgba(200,220,240,0.35)',
  transparent: 'rgba(200,220,240,0.35)',
  clear: 'rgba(200,220,240,0.35)',
  gold: '#d4a017',
  zlata: '#d4a017',
  copper: '#b87333',
  bakrena: '#b87333',
  cyan: '#00bcd4',
  magenta: '#d5006d',
  'army green': '#4b5320',
  'lime green': '#a8e10c',
  'sky blue': '#4fc3f7',
  'hot pink': '#ff69b4',
  'ivory white': '#fffff0',
  'anthracite grey': '#3b3f46',
  antracit: '#3b3f46',
}

export function colorToCss(color: string): string | null {
  const raw = (color || '').trim()
  if (!raw) return null
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return raw
  if (/^rgba?\(/i.test(raw) || /^hsla?\(/i.test(raw)) return raw
  const key = raw.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  // try with diacritics stripped AND original lowercased
  const keyOrig = raw.toLowerCase()
  return COLOR_NAME_MAP[keyOrig] ?? COLOR_NAME_MAP[key] ?? null
}

export function colorInitial(color: string): string {
  const t = (color || '?').trim()
  return (t[0] || '?').toUpperCase()
}


export function normalizeColorKey(color: string): string {
  return color.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

/** Primary palette for manual add/edit — Manjka + common Prusa/Bambu. */
export const COLOR_PALETTE: PaletteColor[] = [
  { name: 'Črna', hex: '#1a1a1a' },
  { name: 'Galaxy Black', hex: '#0d0d0d' },
  { name: 'Jet Black', hex: '#111111' },
  { name: 'Bela', hex: '#f5f5f5' },
  { name: 'Pearl White', hex: '#f8f4ec' },
  { name: 'Natural', hex: '#e8e0d0' },
  { name: 'Siva', hex: '#8a8f98' },
  { name: 'Anthracite Grey', hex: '#3b3f46' },
  { name: 'Silver', hex: '#c0c4cc' },
  { name: 'Oranžna', hex: '#e85d04' },
  { name: 'Prusa Orange', hex: '#e85d04' },
  { name: 'Rdeča', hex: '#c41e3a' },
  { name: 'Modra', hex: '#1e5aa8' },
  { name: 'Royal Blue', hex: '#1e5aa8' },
  { name: 'Sky Blue', hex: '#4fc3f7' },
  { name: 'Zelena', hex: '#2e7d32' },
  { name: 'Army Green', hex: '#4b5320' },
  { name: 'Lime Green', hex: '#a8e10c' },
  { name: 'Rumena', hex: '#f5c518' },
  { name: 'Roza', hex: '#e91e8c' },
  { name: 'Hot Pink', hex: '#ff69b4' },
  { name: 'Vijolična', hex: '#7b2cbf' },
  { name: 'Rjava', hex: '#6d4c41' },
  { name: 'Gold', hex: '#d4a017' },
  { name: 'Copper', hex: '#b87333' },
  { name: 'Cyan', hex: '#00bcd4' },
  { name: 'Magenta', hex: '#d5006d' },
  { name: 'Transparentna', hex: '#c8dcf0' },
]

/** Prefer stored hex, else name map / raw hex. */
export function resolveSpoolColor(color: string, colorHex?: string): string | null {
  const hex = (colorHex || '').trim()
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return hex
  return colorToCss(color)
}

export function paletteHexForName(name: string): string | undefined {
  const key = normalizeColorKey(name)
  const hit = COLOR_PALETTE.find((c) => normalizeColorKey(c.name) === key)
  return hit?.hex ?? colorToCss(name) ?? undefined
}

/**
 * Common Prusa / Bambu Lab colors+materials for the “Manjka” view.
 * Seed colors from seedSpools + sensible defaults.
 */
export const CATALOG_COLORS: CatalogColor[] = [
  // From seed data
  { material: 'PLA', color: 'Črna', brandHint: 'Trcek / Prusa / Bambu' },
  { material: 'PLA', color: 'Oranžna', brandHint: 'Prusament' },
  { material: 'PLA', color: 'Bela', brandHint: 'Prusament / Bambu' },
  { material: 'PETG', color: 'Transparentna', brandHint: 'Prusament' },
  { material: 'ASA', color: 'Siva', brandHint: 'Prusament' },
  // Prusa / Bambu commons — PLA
  { material: 'PLA', color: 'Galaxy Black', brandHint: 'Prusament' },
  { material: 'PLA', color: 'Prusa Orange', brandHint: 'Prusament' },
  { material: 'PLA', color: 'Jet Black', brandHint: 'Bambu' },
  { material: 'PLA', color: 'Red', brandHint: 'Prusa / Bambu' },
  { material: 'PLA', color: 'Blue', brandHint: 'Prusa / Bambu' },
  { material: 'PLA', color: 'Green', brandHint: 'Prusa / Bambu' },
  { material: 'PLA', color: 'Yellow', brandHint: 'Prusa / Bambu' },
  { material: 'PLA', color: 'Pink', brandHint: 'Bambu' },
  { material: 'PLA', color: 'Purple', brandHint: 'Bambu' },
  { material: 'PLA', color: 'Silver', brandHint: 'Prusa / Bambu' },
  { material: 'PLA', color: 'Gray', brandHint: 'Bambu' },
  { material: 'PLA', color: 'Natural', brandHint: 'Prusa' },
  // PETG
  { material: 'PETG', color: 'Črna', brandHint: 'Prusament / Bambu' },
  { material: 'PETG', color: 'Bela', brandHint: 'Prusament / Bambu' },
  { material: 'PETG', color: 'Oranžna', brandHint: 'Prusament' },
  { material: 'PETG', color: 'Siva', brandHint: 'Prusa / Bambu' },
  { material: 'PETG', color: 'Blue', brandHint: 'Prusa / Bambu' },
  { material: 'PETG', color: 'Red', brandHint: 'Prusa / Bambu' },
  // ASA
  { material: 'ASA', color: 'Črna', brandHint: 'Prusament / Trček' },
  { material: 'ASA', color: 'Bela', brandHint: 'Prusament / Trček' },
  { material: 'ASA', color: 'Oranžna', brandHint: 'Prusament' },
  { material: 'ASA', color: 'Natural', brandHint: 'Prusament' },
  { material: 'ASA', color: 'Siva', brandHint: 'Trček ASA MIX' },
  // PLA+
  { material: 'PLA+', color: 'Črna', brandHint: 'Trček' },
  { material: 'PLA+', color: 'Bela', brandHint: 'Trček' },
  { material: 'PLA+', color: 'Natural', brandHint: 'Trček' },
  // ABS
  { material: 'ABS', color: 'Črna', brandHint: 'Trček' },
  { material: 'ABS', color: 'Bela', brandHint: 'Trček' },
  { material: 'ABS', color: 'Natural', brandHint: 'Trček' },
  // PCTG
  { material: 'PCTG', color: 'Transparentna', brandHint: 'Bambu / Prusa-style' },
  { material: 'PCTG', color: 'Črna', brandHint: 'generic' },
  // PC
  { material: 'PC', color: 'Natural', brandHint: 'Trček / Prusa' },
  { material: 'PC', color: 'Črna', brandHint: 'Trček / Prusa' },
  // Nylon / PA-CF
  { material: 'Nylon', color: 'Črna', brandHint: 'Trček PAHT CF' },
  { material: 'Nylon', color: 'Natural', brandHint: 'Trček / Prusa' },
]
