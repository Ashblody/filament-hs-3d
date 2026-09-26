import { normalizeColorKey, percentFromGrams, DEFAULT_FULL_SPOOL_G } from './data.ts'
import type { Spool } from './types.ts'

export const DEFAULT_LOW_PCT = 25
export const DEFAULT_LOW_GRAMS = 250

export interface BuyGroup {
  key: string
  material: Spool['material']
  color: string
  colorHex?: string
  manufacturer: string
  /** npr. «PLA», «PLA HS Matte», «PC Blend». */
  label: string
  count: number
  /** Vsota preostalih gramov (samo tuljave z znano težo). */
  grams: number
  /** Vse tuljave imajo znano težo. */
  gramsKnown: boolean
  /** Povprečen preostanek v %. */
  pct: number
}

const MFR: Array<[RegExp, string]> = [
  [/tr[cč]ek/i, 'Plastika Trček'],
  [/prusa/i, 'Prusament'],
  [/buddy\s*3d/i, 'Buddy3D'],
  [/filamentium/i, 'Filamentium'],
  [/bambu/i, 'Bambu Lab'],
]

/** Proizvajalec in oznaka materiala iz imena v katalogu (brandName). */
export function splitBrand(brandName: string, fallbackMaterial: string): { manufacturer: string; label: string } {
  const b = (brandName || '').trim()
  const hit = MFR.find(([re]) => re.test(b))
  const manufacturer = hit?.[1] ?? (/neznan/i.test(b) || !b ? 'Neznan proizvajalec' : b)
  const label =
    b
      .replace(/\(neznan proizvajalec\)/i, '')
      .replace(/\b(plastika|pastika|tr[cč]ek|prusament|prusa|buddy\s*3d|filamentium|bambu(\s*lab)?)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim() || fallbackMaterial
  // Neznano ime (uporabnikov vnos) — prikaži ga kot proizvajalca, oznaka = material.
  return { manufacturer, label: hit || /neznan/i.test(b) ? label : fallbackMaterial }
}

export function spoolPctOf(s: Spool): number {
  if (s.weightUnknown) return Math.max(0, Math.min(100, Number(s.remainingPct) || 0))
  return percentFromGrams(s.remainingGrams, s.fullSpoolGrams || DEFAULT_FULL_SPOOL_G)
}

export function isLowSpool(s: Spool, lowPct: number, lowGrams: number): boolean {
  if (spoolPctOf(s) < lowPct) return true
  return !s.weightUnknown && s.remainingGrams < lowGrams
}

/** Skupine material + barva + proizvajalec, kjer so VSE tuljave pod pragom. */
export function buyGroups(spools: Spool[], lowPct: number, lowGrams: number): BuyGroup[] {
  const map = new Map<string, { g: BuyGroup; allLow: boolean; pctSum: number }>()
  for (const s of spools) {
    const { manufacturer, label } = splitBrand(s.brandName, s.material)
    const key = `${s.material}|${normalizeColorKey(s.color)}|${manufacturer}|${label}`
    let e = map.get(key)
    if (!e) {
      e = {
        g: { key, material: s.material, color: s.color, colorHex: s.colorHex, manufacturer, label, count: 0, grams: 0, gramsKnown: true, pct: 0 },
        allLow: true,
        pctSum: 0,
      }
      map.set(key, e)
    }
    e.g.count++
    e.pctSum += spoolPctOf(s)
    if (s.weightUnknown) e.g.gramsKnown = false
    else e.g.grams += s.remainingGrams
    if (!isLowSpool(s, lowPct, lowGrams)) e.allLow = false
  }
  const out = [...map.values()].filter((e) => e.allLow).map((e) => ({ ...e.g, pct: e.pctSum / e.g.count }))
  // Najmanj preostanka prvo; brez teže: % preračunan na 1 kg.
  const sortKey = (g: BuyGroup) => (g.gramsKnown ? g.grams : (g.pct / 100) * DEFAULT_FULL_SPOOL_G)
  return out.sort((a, b) => sortKey(a) - sortKey(b) || a.label.localeCompare(b.label, 'sl'))
}

export function spoolCount(n: number): string {
  const m = n % 100
  const word = m === 1 ? 'tuljava' : m === 2 ? 'tuljavi' : m === 3 || m === 4 ? 'tuljave' : 'tuljav'
  return `${n} ${word}`
}

export function buyLine(g: BuyGroup): string {
  const rest = g.gramsKnown ? `~${Math.round(g.grams)} g` : `~${Math.round(g.pct)} %`
  const cnt = g.count > 1 ? `, ${spoolCount(g.count)}` : ''
  return `${g.manufacturer} ${g.label} — ${g.color.toLowerCase()} (ostane ${rest}${cnt})`
}
