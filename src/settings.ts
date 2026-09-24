import {
  DEFAULT_FAILURE_RATE,
  DEFAULT_MARKUP,
  ENERGY_COST,
  LABOR_RATE,
  MATERIALS,
  PRINTERS,
} from './data.ts'
import type { AppSettings, MaterialCategory, MaterialDef, PrinterDef } from './types.ts'

/** Keep compatible with existing installs. */
const SETTINGS_KEY = 'filament-hs-3d-settings-v1'

export function excelDefaultSettings(): AppSettings {
  return {
    version: 1,
    electricityEurPerKwh: ENERGY_COST,
    laborEurPerHour: LABOR_RATE,
    failureRatePct: DEFAULT_FAILURE_RATE,
    defaultMarkup: DEFAULT_MARKUP,
    printers: PRINTERS.map((p) => ({ ...p })),
    materials: MATERIALS.map((m) => ({ ...m })),
  }
}

export function loadSettings(): AppSettings {
  const defaults = excelDefaultSettings()
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return normalizeSettings(parsed, defaults)
  } catch {
    return defaults
  }
}

export function saveSettings(settings: AppSettings): void {
  settings.version = 1
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export function resetSettings(): AppSettings {
  const defaults = excelDefaultSettings()
  saveSettings(defaults)
  return defaults
}

function normalizeSettings(parsed: Partial<AppSettings>, defaults: AppSettings): AppSettings {
  const printers = Array.isArray(parsed.printers)
    ? parsed.printers.map(coercePrinter).filter((p): p is PrinterDef => !!p)
    : defaults.printers.map((p) => ({ ...p }))
  const materials = Array.isArray(parsed.materials)
    ? parsed.materials.map(coerceMaterial).filter((m): m is MaterialDef => !!m)
    : defaults.materials.map((m) => ({ ...m }))

  return {
    version: 1,
    electricityEurPerKwh: numOr(parsed.electricityEurPerKwh, defaults.electricityEurPerKwh),
    laborEurPerHour: numOr(parsed.laborEurPerHour, defaults.laborEurPerHour),
    failureRatePct: numOr(parsed.failureRatePct, defaults.failureRatePct),
    defaultMarkup: numOr(parsed.defaultMarkup, defaults.defaultMarkup),
    printers: printers.length ? printers : defaults.printers.map((p) => ({ ...p })),
    materials: materials.length ? materials : defaults.materials.map((m) => ({ ...m })),
  }
}

function numOr(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function coercePrinter(raw: unknown): PrinterDef | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Partial<PrinterDef>
  if (typeof p.id !== 'string' || typeof p.name !== 'string') return null
  return {
    id: p.id,
    name: p.name,
    price: numOr(p.price, 0),
    lifeHours: Math.max(1, numOr(p.lifeHours, 3000)),
    serviceCost: numOr(p.serviceCost, 0),
    energyKwhPerH: numOr(p.energyKwhPerH, 0.2),
  }
}

function coerceMaterial(raw: unknown): MaterialDef | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Partial<MaterialDef>
  if (typeof m.id !== 'string' || typeof m.name !== 'string') return null
  const category = (typeof m.category === 'string' ? m.category : 'Other') as MaterialCategory
  const spoolPrice = m.spoolPrice != null ? numOr(m.spoolPrice, NaN) : undefined
  const spoolKg = m.spoolKg != null ? numOr(m.spoolKg, NaN) : undefined
  let pricePerKg = numOr(m.pricePerKg, NaN)
  if (
    (!Number.isFinite(pricePerKg) || pricePerKg <= 0) &&
    spoolPrice != null &&
    Number.isFinite(spoolPrice) &&
    spoolKg != null &&
    Number.isFinite(spoolKg) &&
    spoolKg > 0
  ) {
    pricePerKg = spoolPrice / spoolKg
  }
  if (!Number.isFinite(pricePerKg)) pricePerKg = 0
  const out: MaterialDef = { id: m.id, name: m.name, category, pricePerKg }
  if (spoolPrice != null && Number.isFinite(spoolPrice)) out.spoolPrice = spoolPrice
  if (spoolKg != null && Number.isFinite(spoolKg) && spoolKg > 0) out.spoolKg = spoolKg
  return out
}

/** Id for user-added printers/materials. */
export function slugId(prefix: string, name: string): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'item'
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Date.now().toString(36).slice(-6)
  return `${prefix}-${base}-${suffix}`
}

export function pricePerKgFromSpool(spoolPrice: number, spoolKg: number): number {
  if (!(spoolKg > 0) || !Number.isFinite(spoolPrice)) return 0
  return spoolPrice / spoolKg
}

export function findPrinterIn(settings: AppSettings, id: string): PrinterDef {
  return settings.printers.find((p) => p.id === id) ?? settings.printers[0]!
}

export function findMaterialIn(settings: AppSettings, id: string): MaterialDef {
  return settings.materials.find((m) => m.id === id) ?? settings.materials[0]!
}
