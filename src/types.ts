export type MaterialCategory =
  | 'PLA'
  | 'PLA+'
  | 'PETG'
  | 'PCTG'
  | 'ABS'
  | 'ASA'
  | 'PC'
  | 'TPU'
  | 'Nylon'
  | 'Woodfill'
  | 'Resin'
  | 'Other'

export type TabId = 'zaloga' | 'nfc' | 'kalkulator' | 'nastavitve'

export interface Spool {
  id: string
  material: MaterialCategory
  color: string
  /** Hex from palette / OpenPrintTag — preferred for list swatches. */
  colorHex?: string
  brandName: string
  remainingGrams: number
  fullSpoolGrams: number
  pricePerKg: number
  notes: string
  nfcTagId?: string
  /** Nominalna teža neznana (npr. Filamentium) — UI kaže «neznano», gramov ne računa. */
  weightUnknown?: boolean
  /** Preostanek v % ko je teža neznana. */
  remainingPct?: number
  createdAt: string
  updatedAt: string
}

export interface AppData {
  version: 1
  spools: Spool[]
  seeded: boolean
  /** Verzije uvoza iz seznama, ki so že bile uporabljene (enkrat na verzijo). */
  docSeeds?: string[]
}

export interface PrinterDef {
  id: string
  name: string
  price: number
  lifeHours: number
  serviceCost: number
  energyKwhPerH: number
}

export interface MaterialDef {
  id: string
  name: string
  category: MaterialCategory
  pricePerKg: number
  spoolPrice?: number
  spoolKg?: number
}

export interface AppSettings {
  version: 1
  electricityEurPerKwh: number
  laborEurPerHour: number
  failureRatePct: number
  defaultMarkup: number
  /** Za nakup: tuljava je «nizka» pod tem % … */
  lowStockPct: number
  /** … ali pod toliko grami (samo pri znani teži). */
  lowStockGrams: number
  printers: PrinterDef[]
  materials: MaterialDef[]
}

export interface CalcInput {
  printerId: string
  materialId: string
  weightG: number
  printHours: number
  prepMin: number
  postMin: number
  consumables: number
  markup: number
  failureRate: number
}

export interface CalcBreakdown {
  filamentCost: number
  electricity: number
  depreciation: number
  preparation: number
  postProcessing: number
  consumables: number
  subtotal: number
  withFailures: number
  suggested: number
  printHours: number
}

/** Catalog entry for “Manjka” (common Prusa/Bambu colors+materials). */
export interface CatalogColor {
  material: MaterialCategory
  color: string
  brandHint: string
}

/** Palette swatch for manual stock add/edit (name + hex). */
export interface PaletteColor {
  name: string
  hex: string
}
