/**
 * Light OpenPrintTag decode for NDEF MIME payloads that Web NFC can already see
 * (e.g. OPT written on NTAG). Does NOT unlock ISO 15693 / ICODE SLIX2 — Chrome
 * Web NFC cannot talk to those tags. Spec: https://specs.openprinttag.org/#/nfc_data_format
 * Repo: https://github.com/OpenPrintTag/openprinttag-specification
 */

import {
  decodeCbor,
  mapGetBytes,
  mapGetNumber,
  mapGetString,
  type CborValue,
} from './cbor.ts'
import type { MaterialCategory } from './types.ts'

export const OPT_MIME = 'application/vnd.openprinttag'
export const OPT_MIME_LEGACY = 'application/vnd.prusa3d.nfc'

export function isOpenPrintTagMime(mediaType?: string): boolean {
  if (!mediaType) return false
  const m = mediaType.toLowerCase()
  return m === OPT_MIME || m === OPT_MIME_LEGACY
}

/** Main field keys (subset) — https://specs.openprinttag.org/#/nfc_data_format */
const MAIN = {
  materialClass: 8,
  materialType: 9,
  materialName: 10,
  brandName: 11,
  nominalNettoFullWeight: 16,
  actualNettoFullWeight: 17,
  primaryColor: 19,
} as const

/** Aux field keys */
const AUX = {
  consumedWeight: 0,
  purchasePrice: 6,
  purchaseCurrency: 7,
} as const

/** Meta */
const META = {
  mainRegionOffset: 0,
  auxRegionOffset: 2,
} as const

/** material_type enum abbreviations (OpenPrintTag material_type_enum.yaml) */
const MATERIAL_TYPE_ABBREV: Record<number, string> = {
  0: 'PLA',
  1: 'PETG',
  2: 'TPU',
  3: 'ABS',
  4: 'ASA',
  5: 'PC',
  6: 'PCTG',
  7: 'PP',
  8: 'PA6',
  9: 'PA11',
  10: 'PA12',
  11: 'PA66',
  12: 'CPE',
  13: 'TPE',
  14: 'HIPS',
  15: 'PHA',
  16: 'PET',
  42: 'PA612',
}

export interface OpenPrintTagFields {
  brandName?: string
  materialName?: string
  materialTypeAbbrev?: string
  materialClass?: 'FFF' | 'SLA'
  colorHex?: string
  fullWeightG?: number
  remainingWeightG?: number
  consumedWeightG?: number
  purchasePrice?: number
  purchaseCurrency?: string
}

export function parseOpenPrintTagPayload(payload: Uint8Array): OpenPrintTagFields | null {
  try {
    const metaDecoded = decodeCbor(payload, 0)
    if (!(metaDecoded.value instanceof Map)) return null
    const meta = metaDecoded.value as Map<CborValue, CborValue>

    let mainOffset = mapGetNumber(meta, META.mainRegionOffset)
    if (mainOffset == null) mainOffset = metaDecoded.offset
    const auxOffset = mapGetNumber(meta, META.auxRegionOffset)

    if (mainOffset < 0 || mainOffset >= payload.length) return null
    const mainDecoded = decodeCbor(payload, mainOffset)
    if (!(mainDecoded.value instanceof Map)) return null
    const main = mainDecoded.value as Map<CborValue, CborValue>

    let aux: Map<CborValue, CborValue> | null = null
    if (auxOffset != null && auxOffset >= 0 && auxOffset < payload.length) {
      try {
        const auxDecoded = decodeCbor(payload, auxOffset)
        if (auxDecoded.value instanceof Map) aux = auxDecoded.value
      } catch {
        /* aux optional / may be empty map padding */
      }
    }

    const brandName = mapGetString(main, MAIN.brandName)
    const materialName = mapGetString(main, MAIN.materialName)
    const materialTypeKey = mapGetNumber(main, MAIN.materialType)
    const materialClassKey = mapGetNumber(main, MAIN.materialClass)
    const colorBytes = mapGetBytes(main, MAIN.primaryColor)
    const nominal = mapGetNumber(main, MAIN.nominalNettoFullWeight)
    const actual = mapGetNumber(main, MAIN.actualNettoFullWeight)
    const fullWeightG = actual ?? nominal

    let consumedWeightG: number | undefined
    let purchasePrice: number | undefined
    let purchaseCurrency: string | undefined
    if (aux) {
      consumedWeightG = mapGetNumber(aux, AUX.consumedWeight)
      purchasePrice = mapGetNumber(aux, AUX.purchasePrice)
      purchaseCurrency = mapGetString(aux, AUX.purchaseCurrency)
    }

    let remainingWeightG: number | undefined
    if (fullWeightG != null && consumedWeightG != null) {
      remainingWeightG = Math.max(0, fullWeightG - consumedWeightG)
    } else if (fullWeightG != null) {
      remainingWeightG = fullWeightG
    }

    return {
      brandName,
      materialName,
      materialTypeAbbrev:
        materialTypeKey != null ? MATERIAL_TYPE_ABBREV[materialTypeKey] : undefined,
      materialClass: materialClassKey === 1 ? 'SLA' : materialClassKey === 0 ? 'FFF' : undefined,
      colorHex: colorBytes ? rgbaToHex(colorBytes) : undefined,
      fullWeightG,
      remainingWeightG,
      consumedWeightG,
      purchasePrice,
      purchaseCurrency,
    }
  } catch {
    return null
  }
}

function rgbaToHex(bytes: Uint8Array): string {
  const r = bytes[0] ?? 0
  const g = bytes[1] ?? 0
  const b = bytes[2] ?? 0
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

export function mapOptMaterialToCategory(fields: OpenPrintTagFields): MaterialCategory {
  if (fields.materialClass === 'SLA') return 'Resin'
  const t = (fields.materialTypeAbbrev || '').toUpperCase()
  if (t === 'PLA') return 'PLA'
  if (t === 'PETG' || t === 'PET' || t === 'PCTG' || t === 'CPE') return 'PETG'
  if (t === 'ASA' || t === 'ABS') return 'ASA'
  if (t === 'TPU' || t === 'TPE' || t === 'TPC') return 'TPU'
  if (t.startsWith('PA') || t === 'NYLON') return 'Nylon'
  if ((fields.materialName || '').toLowerCase().includes('wood')) return 'Woodfill'
  return 'Other'
}

export function formatOptSummary(fields: OpenPrintTagFields): string {
  const parts: string[] = ['OpenPrintTag']
  if (fields.brandName) parts.push(fields.brandName)
  if (fields.materialName) parts.push(fields.materialName)
  else if (fields.materialTypeAbbrev) parts.push(fields.materialTypeAbbrev)
  if (fields.colorHex) parts.push(fields.colorHex)
  if (fields.remainingWeightG != null) parts.push(`${Math.round(fields.remainingWeightG)} g`)
  return parts.join(' · ')
}
