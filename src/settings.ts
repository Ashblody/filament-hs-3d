import {
  DEFAULT_FAILURE_RATE,
  DEFAULT_MARKUP,
  ENERGY_COST,
  LABOR_RATE,
  MATERIALS,
  PRINTERS,
} from './data.ts'
import type { AppSettings, MaterialDef, PrinterDef } from './types.ts'

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
    ? parsed.printers.filter(isPrinter).map((p) => ({ ...p }))
    : defaults.printers.map((p) => ({ ...p }))
  const materials = Array.isArray(parsed.materials)
    ? parsed.materials.filter(isMaterial).map((m) => ({ ...m }))
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

function isPrinter(raw: unknown): raw is PrinterDef {
  if (!raw || typeof raw !== 'object') return false
  const p = raw as Partial<PrinterDef>
  return typeof p.id === 'string' && typeof p.name === 'string'
}

function isMaterial(raw: unknown): raw is MaterialDef {
  if (!raw || typeof raw !== 'object') return false
  const m = raw as Partial<MaterialDef>
  return typeof m.id === 'string' && typeof m.name === 'string' && typeof m.category === 'string'
}

export function findPrinterIn(settings: AppSettings, id: string): PrinterDef {
  return settings.printers.find((p) => p.id === id) ?? settings.printers[0]!
}

export function findMaterialIn(settings: AppSettings, id: string): MaterialDef {
  return settings.materials.find((m) => m.id === id) ?? settings.materials[0]!
}
