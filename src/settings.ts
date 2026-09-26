import {
  DEFAULT_FAILURE_RATE,
  DEFAULT_MARKUP,
  ENERGY_COST,
  LABOR_RATE,
  MATERIALS,
  PRINTERS,
} from './data.ts'
import { DEFAULT_LOW_GRAMS, DEFAULT_LOW_PCT } from './buyList.ts'
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
    lowStockPct: DEFAULT_LOW_PCT,
    lowStockGrams: DEFAULT_LOW_GRAMS,
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
    const merged = normalizeSettings(parsed, defaults)
    // Persist merge-missing so new catalog ids survive without wiping custom prices.
    const beforeIds = new Set(
      (Array.isArray(parsed.materials) ? parsed.materials : [])
        .map((m) => (m && typeof m === 'object' && 'id' in m ? String((m as { id: unknown }).id) : ''))
        .filter(Boolean),
    )
    const added = merged.materials.some((m) => !beforeIds.has(m.id))
    const beforePrinterIds = new Set(
      (Array.isArray(parsed.printers) ? parsed.printers : [])
        .map((p) => (p && typeof p === 'object' && 'id' in p ? String((p as { id: unknown }).id) : ''))
        .filter(Boolean),
    )
    const addedPrinters = merged.printers.some((p) => !beforePrinterIds.has(p.id))
    if (added || addedPrinters) saveSettings(merged)
    return merged
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

/**
 * Merge catalog defaults into saved lists by id.
 * - Keeps user prices / custom rows untouched.
 * - Appends any new default printer/material ids that are missing
 *   (so catalog expansions appear without wiping localStorage).
 * - «Ponastavi Excel» (resetSettings) replaces everything with defaults.
 */
function mergeMissingById<T extends { id: string }>(saved: T[], defaults: T[]): T[] {
  const have = new Set(saved.map((x) => x.id))
  const out = saved.map((x) => ({ ...x }))
  for (const d of defaults) {
    if (!have.has(d.id)) {
      out.push({ ...d })
      have.add(d.id)
    }
  }
  return out
}

function normalizeSettings(parsed: Partial<AppSettings>, defaults: AppSettings): AppSettings {
  const printersRaw = Array.isArray(parsed.printers)
    ? parsed.printers.map(coercePrinter).filter((p): p is PrinterDef => !!p)
    : []
  const materialsRaw = Array.isArray(parsed.materials)
    ? parsed.materials.map(coerceMaterial).filter((m): m is MaterialDef => !!m)
    : []

  const printers = mergeMissingById(
    printersRaw.length ? printersRaw : defaults.printers.map((p) => ({ ...p })),
    defaults.printers,
  )
  const materials = mergeMissingById(
    materialsRaw.length ? materialsRaw : defaults.materials.map((m) => ({ ...m })),
    defaults.materials,
  )

  return {
    version: 1,
    electricityEurPerKwh: numOr(parsed.electricityEurPerKwh, defaults.electricityEurPerKwh),
    laborEurPerHour: numOr(parsed.laborEurPerHour, defaults.laborEurPerHour),
    failureRatePct: numOr(parsed.failureRatePct, defaults.failureRatePct),
    defaultMarkup: numOr(parsed.defaultMarkup, defaults.defaultMarkup),
    lowStockPct: numOr(parsed.lowStockPct, defaults.lowStockPct),
    lowStockGrams: numOr(parsed.lowStockGrams, defaults.lowStockGrams),
    printers,
    materials,
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
