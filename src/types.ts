export type MaterialCategory =
  | 'PLA'
  | 'PETG'
  | 'ASA'
  | 'TPU'
  | 'Nylon'
  | 'Woodfill'
  | 'Resin'
  | 'Other'

export type TabId = 'zaloga' | 'nfc' | 'kalkulator'

export interface Spool {
  id: string
  material: MaterialCategory
  color: string
  brandName: string
  remainingGrams: number
  fullSpoolGrams: number
  pricePerKg: number
  notes: string
  nfcTagId?: string
  createdAt: string
  updatedAt: string
}

export interface AppData {
  version: 1
  spools: Spool[]
  seeded: boolean
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
