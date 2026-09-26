import type { AppData, Spool } from './types.ts'
import { DOC_SEED_VERSION, mergeDocStock } from './stockSeed.ts'

const DATA_KEY = 'filament-hs-3d-data-v1'

export function emptyData(): AppData {
  return { version: 1, spools: [], seeded: false }
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(DATA_KEY)
    if (!raw) {
      // Sveža namestitev: namesto vzorcev naloži dejansko zalogo iz seznama.
      const data: AppData = { version: 1, spools: [], seeded: true }
      mergeDocStock(data)
      saveData(data)
      return data
    }
    const parsed = JSON.parse(raw) as Partial<AppData>
    const spools = Array.isArray(parsed.spools)
      ? parsed.spools.filter(isSpool)
      : []
    const data: AppData = {
      version: 1,
      spools,
      seeded: !!parsed.seeded || spools.length > 0,
      docSeeds: Array.isArray(parsed.docSeeds)
        ? parsed.docSeeds.filter((x): x is string => typeof x === 'string')
        : [],
    }
    // Enkratni uvoz na verzijo: doda samo manjkajoče id-je, obstoječih ne spreminja.
    if (!data.docSeeds!.includes(DOC_SEED_VERSION)) {
      data.seeded = true
      const alreadyImported = data.docSeeds!.some((v) => v.startsWith('doc-2026-09-26-'))
      mergeDocStock(data, !alreadyImported)
      saveData(data)
    }
    return data
  } catch {
    return emptyData()
  }
}

export function saveData(data: AppData): void {
  data.version = 1
  localStorage.setItem(DATA_KEY, JSON.stringify(data))
}

function isSpool(raw: unknown): raw is Spool {
  if (!raw || typeof raw !== 'object') return false
  const s = raw as Partial<Spool>
  return typeof s.id === 'string' && typeof s.material === 'string' && typeof s.color === 'string'
}

export function uid(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('sl-SI', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    const base = import.meta.env.BASE_URL
    const swUrl = `${base}sw.js`
    await navigator.serviceWorker.register(swUrl, { scope: base })
  } catch (err) {
    console.warn('SW register failed', err)
  }
}
