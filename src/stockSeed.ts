import type { AppData, MaterialCategory, Spool } from './types.ts'

/**
 * Andrejev fizični seznam «Filamenti na zalogi» (Google Doc, 26. 9. 2026).
 * Uvozi se enkrat na verzijo (DOC_SEED_VERSION) in se združi po id:
 * nikoli ne podvaja, ne briše in ne prepisuje obstoječe zaloge.
 */
export const DOC_SEED_VERSION = 'doc-2026-09-26-v2'
const SEED_DATE = '2026-09-26T09:00:00.000Z'

interface Row {
  material: MaterialCategory
  color: string
  colorHex: string
  /** Ime materiala iz kataloga (settings.materials name). */
  brandName: string
  pricePerKg: number
  pct: number
  /** Nominalna teža v g; null = neznano (uporabnik lahko uredi). */
  weight: number | null
  notes?: string
}

const T_PLA = { brandName: 'PLASTIKA TRCEK PLA', pricePerKg: 21 }
const T_PLA_HS = { brandName: 'Trček PLA HS', pricePerKg: 22 }
const T_PLA_HSM = { brandName: 'Trček PLA HS Matte', pricePerKg: 23 }
const T_PETG = { brandName: 'PLASTIKA TRCEK PETG', pricePerKg: 22 }
const T_ASA = { brandName: 'Trček ASA', pricePerKg: 20 / 0.7 }
const T_ASA_P = { brandName: 'Trček ASA+', pricePerKg: 22 }
const T_TPU = { brandName: 'TPU Trcek', pricePerKg: 27 / 0.7 }
const T_PCTG = { brandName: 'Trček PCTG', pricePerKg: 30 }
const P_PLA = { brandName: 'PRUSAMENT PLA', pricePerKg: 32 }
const P_PETG = { brandName: 'PRUSAMENT PETG', pricePerKg: 32 }
const P_PETG_M = { brandName: 'Prusament PETG Matte', pricePerKg: 32 }
const P_PC = { brandName: 'PC Blend Prusa', pricePerKg: 45 / 0.97 }
const P_TPU = { brandName: 'TPU Prusa', pricePerKg: 39 / 0.5 }
const B_PLA = { brandName: 'Buddy3D PLA', pricePerKg: 20 }
const F_GAL = { brandName: 'Filamentium PLA Galaxy', pricePerKg: 27.5 / 0.75 }
const PA12 = { brandName: 'PA12 (neznan proizvajalec)', pricePerKg: 40 / 0.7 }

const C = {
  crna: ['Črna', '#1a1a1a'],
  bela: ['Bela', '#f5f5f5'],
  siva: ['Siva', '#8a8f98'],
  rjava: ['Rjava', '#6d4c41'],
  rdeca: ['Rdeča', '#c41e3a'],
  modra: ['Modra', '#1e5aa8'],
  rumena: ['Rumena', '#f5c518'],
  roza: ['Roza', '#e91e8c'],
  zelena: ['Zelena', '#2e7d32'],
  vijolicna: ['Vijolična', '#7b2cbf'],
  oranzna: ['Oranžna', '#e85d04'],
  babyModra: ['Baby modra', '#89cff0'],
  limeta: ['Limeta zelena', '#a8e10c'],
  neon: ['Neon zelena', '#39ff14'],
  antracit: ['Antracitno siva', '#3b3f46'],
  svetloSiva: ['Svetlo siva', '#c4c7cc'],
  urbanSiva: ['Urbano siva', '#6b6e70'],
  dzungla: ['Džungla zelena', '#3b5d3a'],
  slonokost: ['Slonokoščena', '#f3ecd8'],
  naravna: ['Naravna', '#e8e0d0'],
  gModra: ['Galaxy modra', '#1c3f8c'],
  gZelena: ['Galaxy zelena', '#1f5a3a'],
  gCesnja: ['Galaxy češnjeva', '#7b1e3a'],
  gRjava: ['Galaxy rjava', '#4a3024'],
  gZelRjava: ['Galaxy zeleno-rjava', '#4b4a2a'],
  gSrebrna: ['Galaxy srebrna', '#9ea3aa'],
  gRdeca: ['Galaxy rdeča', '#8b1a1a'],
  mRjava: ['Mystic rjava', '#5a3d2b'],
  mZelena: ['Mystic zelena', '#2f4f3a'],
} as const satisfies Record<string, readonly [string, string]>

type ColorKey = keyof typeof C

function r(
  material: MaterialCategory,
  color: ColorKey,
  mat: { brandName: string; pricePerKg: number },
  pct: number,
  weight: number | null = 1000,
  notes = '',
): Row {
  const [name, hex] = C[color]
  return { material, color: name, colorHex: hex, ...mat, pct, weight, notes }
}

const FIL = 'Filamentium rola 750 g'

/** Vrstni red = vrstni red v Google Docu. */
export const DOC_STOCK_ROWS: Row[] = [
  r('PLA', 'crna', T_PLA, 80),
  r('PLA', 'rjava', T_PLA, 20),
  r('PLA', 'rdeca', T_PLA, 80),
  r('PLA', 'modra', T_PLA, 80),
  r('ASA', 'crna', T_ASA, 80),
  r('PETG', 'crna', T_PETG, 80),
  r('TPU', 'crna', T_TPU, 80),
  r('PC', 'crna', P_PC, 70),
  r('PLA', 'babyModra', T_PLA, 80),
  r('PLA', 'rumena', T_PLA, 80),
  r('PLA', 'roza', T_PLA, 80),
  r('PLA', 'zelena', T_PLA, 30),
  r('PLA', 'vijolicna', T_PLA, 30),
  r('PLA', 'bela', B_PLA, 100),
  r('PLA', 'crna', B_PLA, 100, 1000, 'Kos 1/2'),
  r('PLA', 'crna', B_PLA, 100, 1000, 'Kos 2/2'),
  r('PLA', 'gModra', F_GAL, 50, 750, FIL),
  r('PLA', 'gZelena', F_GAL, 50, 750, FIL),
  r('PLA', 'gCesnja', F_GAL, 80, 750, FIL),
  r('PLA', 'gRjava', F_GAL, 90, 750, FIL),
  r('PLA', 'gZelRjava', F_GAL, 90, 750, FIL),
  r('PLA', 'gSrebrna', F_GAL, 90, 750, FIL),
  r('PLA', 'gRdeca', F_GAL, 80, 750, FIL),
  r('PLA', 'bela', T_PLA, 20, 1000, 'Refill spool'),
  r('PLA', 'rdeca', T_PLA_HSM, 50),
  r('PETG', 'dzungla', P_PETG, 50, 1000, 'Jungle Green'),
  r('ASA', 'antracit', T_ASA_P, 20, 1000, 'Anthracite Grey'),
  r('PLA', 'modra', T_PLA, 75),
  r('PETG', 'oranzna', P_PETG, 20),
  r('PLA', 'limeta', T_PLA, 50),
  r('PLA', 'bela', B_PLA, 100),
  r('PETG', 'urbanSiva', P_PETG, 100, 1000, 'Urban Grey'),
  r('PETG', 'crna', P_PETG_M, 100, 1000, 'Matte Black'),
  r('PLA', 'crna', T_PLA_HS, 100),
  r('ASA', 'bela', T_ASA_P, 100),
  r('PLA', 'gSrebrna', P_PLA, 100, 1000, 'Galaxy Silver'),
  r('PLA', 'neon', T_PLA, 100),
  r('PLA', 'gZelena', P_PLA, 80, 1000, 'Galaxy Green, 2024'),
  r('PLA', 'mRjava', P_PLA, 90, 1000, 'Mystic Brown, 2024'),
  r('PLA', 'mZelena', P_PLA, 90, 1000, 'Mystic Green, 2024'),
  r('PLA', 'rumena', T_PLA, 100),
  r('PCTG', 'siva', T_PCTG, 100),
  r('PLA', 'oranzna', T_PLA, 100),
  r('PLA', 'vijolicna', T_PLA, 100),
  r('TPU', 'crna', T_TPU, 100, 750, 'TPU Flex'),
  r('ASA', 'svetloSiva', T_ASA_P, 100, 800),
  r('PLA', 'siva', T_PLA_HSM, 100),
  r('PLA', 'slonokost', T_PLA, 100, 1000, 'Light Ivory'),
  r('TPU', 'naravna', P_TPU, 100, 600),
  r('Nylon', 'bela', PA12, 100, 700, 'PA12 — proizvajalec neznan'),
]

export function docSeedSpools(): Spool[] {
  return DOC_STOCK_ROWS.map((row, i) => {
    const known = row.weight != null
    const full = row.weight ?? 0
    const spool: Spool = {
      id: `doc-2026-09-26-${String(i + 1).padStart(2, '0')}`,
      material: row.material,
      color: row.color,
      colorHex: row.colorHex,
      brandName: row.brandName,
      remainingGrams: known ? Math.round((row.pct / 100) * full) : 0,
      fullSpoolGrams: full,
      pricePerKg: Math.round(row.pricePerKg * 100) / 100,
      notes: [row.notes, 'Uvoz iz seznama 26. 9. 2026'].filter(Boolean).join(' · '),
      createdAt: SEED_DATE,
      updatedAt: SEED_DATE,
    }
    if (!known) {
      spool.weightUnknown = true
      spool.remainingPct = row.pct
    }
    return spool
  })
}

const FIL_750_IDS = new Set(
  ['17', '18', '19', '20', '21', '22', '23'].map((n) => `doc-2026-09-26-${n}`),
)

/**
 * Doda samo manjkajoče id-je. Vrne število dodanih.
 * addMissing=false: samo popravek teže (seznam je bil že uvožen v prejšnji verziji,
 * zato ne vračamo tuljav, ki jih je uporabnik medtem izbrisal).
 */
export function mergeDocStock(data: AppData, addMissing = true): number {
  const have = new Set(data.spools.map((s) => s.id))
  let added = 0
  for (const s of addMissing ? docSeedSpools() : []) {
    if (have.has(s.id)) continue
    data.spools.push(s)
    have.add(s.id)
    added++
  }
  // v1 (1.3.0) je Filamentium uvozil z neznano težo; lastnik potrdil 750 g.
  // Popravi samo nedotaknjene uvožene tuljave (še neznana teža in nespremenjene).
  for (const s of data.spools) {
    if (!FIL_750_IDS.has(s.id) || !s.weightUnknown || s.updatedAt !== SEED_DATE) continue
    const pct = Number(s.remainingPct) || 0
    s.fullSpoolGrams = 750
    s.remainingGrams = Math.round((pct / 100) * 750)
    s.notes = [FIL, 'Uvoz iz seznama 26. 9. 2026'].join(' · ')
    delete s.weightUnknown
    delete s.remainingPct
  }
  const applied = new Set(data.docSeeds ?? [])
  applied.add(DOC_SEED_VERSION)
  data.docSeeds = [...applied]
  return added
}
