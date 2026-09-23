import type { MaterialCategory, MaterialDef, PrinterDef, Spool } from './types.ts'
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
  'PETG',
  'ASA',
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
  { id: 'trcek-petg', name: 'PLASTIKA TRCEK PETG', category: 'PETG', pricePerKg: 22, spoolPrice: 22, spoolKg: 1 },
  { id: 'filamentium-pla', name: 'Filamentium PLA Extrafill', category: 'PLA', pricePerKg: 27.5 / 0.75, spoolPrice: 27.5, spoolKg: 0.75 },
  { id: 'prusament-pla', name: 'PRUSAMENT PLA', category: 'PLA', pricePerKg: 32, spoolPrice: 32, spoolKg: 1 },
  { id: 'prusament-petg', name: 'PRUSAMENT PETG', category: 'PETG', pricePerKg: 32, spoolPrice: 32, spoolKg: 1 },
  { id: 'prusament-asa', name: 'PRUSAMENT ASA', category: 'ASA', pricePerKg: 32, spoolPrice: 32, spoolKg: 1 },
  { id: 'tpu-trcek', name: 'TPU Trcek', category: 'TPU', pricePerKg: 27 / 0.7, spoolPrice: 27, spoolKg: 0.7 },
  { id: 'tpu-prusa', name: 'TPU Prusa', category: 'TPU', pricePerKg: 39 / 0.5, spoolPrice: 39, spoolKg: 0.5 },
  { id: 'nylon-trcek', name: 'Nylon Trcek', category: 'Nylon', pricePerKg: 40 / 0.7, spoolPrice: 40, spoolKg: 0.7 },
  { id: 'nylon-prusa', name: 'Nylon Prusa', category: 'Nylon', pricePerKg: 110 / 0.8, spoolPrice: 110, spoolKg: 0.8 },
  { id: 'woodfill-prusa', name: 'Woodfill PRUSA', category: 'Woodfill', pricePerKg: 40, spoolPrice: 40, spoolKg: 1 },
  { id: 'woodfill-trcek', name: 'woodfill trcek', category: 'Woodfill', pricePerKg: 24 / 0.7, spoolPrice: 24, spoolKg: 0.7 },
  { id: 'pc-blend', name: 'PC Blend Prusa', category: 'Other', pricePerKg: 45 / 0.97, spoolPrice: 45, spoolKg: 0.97 },
  { id: 'petg-cf-prusa', name: 'Prusament PETG CF', category: 'PETG', pricePerKg: 60, spoolPrice: 60, spoolKg: 1 },
  { id: 'pet-cf-trcek', name: 'Trcek PET CF', category: 'PETG', pricePerKg: 65, spoolPrice: 65, spoolKg: 1 },
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
      brandName: 'PLASTIKA TRCEK PLA',
      remainingGrams: 780,
      fullSpoolGrams: 1000,
      pricePerKg: 21,
      notes: 'Vzorec — Trcek PLA',
    },
    {
      material: 'PLA',
      color: 'Oranžna',
      brandName: 'PRUSAMENT PLA',
      remainingGrams: 920,
      fullSpoolGrams: 1000,
      pricePerKg: 32,
      notes: 'Vzorec — Prusament',
    },
    {
      material: 'PLA',
      color: 'Bela',
      brandName: 'PRUSAMENT PLA',
      remainingGrams: 450,
      fullSpoolGrams: 1000,
      pricePerKg: 32,
      notes: '',
    },
    {
      material: 'PETG',
      color: 'Transparentna',
      brandName: 'PRUSAMENT PETG',
      remainingGrams: 600,
      fullSpoolGrams: 1000,
      pricePerKg: 32,
      notes: '',
    },
    {
      material: 'ASA',
      color: 'Siva',
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
