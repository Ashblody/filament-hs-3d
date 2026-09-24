import './style.css'
import {
  APP_PAGES_URL,
  CATALOG_COLORS,
  COLOR_PALETTE,
  DEFAULT_FULL_SPOOL_G,
  DEFAULT_POST_MIN,
  DEFAULT_PREP_MIN,
  MATERIAL_CATEGORIES,
  colorInitial,
  colorToCss,
  formatEuro,
  formatGrams,
  gramsFromPercent,
  normalizeColorKey,
  paletteHexForName,
  parsePrintHours,
  percentFromGrams,
  resolveSpoolColor,
} from './data.ts'
import { calculatePrice, sanitySuggested } from './calc.ts'
import {
  isNfcSupported,
  NfcUserError,
  readNfcOnce,
  writeNfcUrl,
  resultFromOpenPrintTagBytes,
  base64ToBytes,
  type NfcReadResult,
} from './nfc.ts'
import { mapOptMaterialToCategory } from './openprinttag.ts'
import OpenPrintTagNfc, { isAndroidNative, isNativeCapacitor } from './plugins/openprinttag-nfc.ts'
import {
  decodeQrFromFile,
  decodeQrFromVideo,
  parseSpoolPayload,
  renderQrToCanvas,
  spoolAbsoluteLink,
  startCamera,
  stopCamera,
} from './qr.ts'
import {
  findMaterialIn,
  loadSettings,
  pricePerKgFromSpool,
  resetSettings,
  saveSettings,
  slugId,
} from './settings.ts'
import {
  escapeHtml,
  formatDateTime,
  loadData,
  registerServiceWorker,
  saveData,
  uid,
} from './storage.ts'
import type {
  AppData,
  AppSettings,
  CatalogColor,
  MaterialCategory,
  MaterialDef,
  Spool,
  TabId,
} from './types.ts'

const app = document.querySelector<HTMLDivElement>('#app')!

let data: AppData = loadData()
let settings: AppSettings = loadSettings()
let tab: TabId = 'zaloga'
let materialFilter: MaterialCategory | 'vse' = 'vse'
let colorFilter: string | 'vse' = 'vse'
let stockView: 'zaloga' | 'manjka' = 'zaloga'
let expandedId: string | null = null
let editingId: string | null = null
let showEditor = false
let toastTimer: number | undefined
let cameraStream: MediaStream | null = null
let scanLoop = 0
let nfcAbort: AbortController | null = null
let clickTimer: number | undefined
let pendingClickId: string | null = null

// Calculator state — defaults from settings
let calcPrinter = settings.printers[0]?.id ?? 'core-one-indx'
let calcMaterial = 'trcek-pla'
let calcWeight = '61.46'
let calcTime = '3:46'
let calcPrep = String(DEFAULT_PREP_MIN)
let calcPost = String(DEFAULT_POST_MIN)
let calcConsumables = '0'
let calcMarkup = String(settings.defaultMarkup)
let calcFailure = String(settings.failureRatePct)

function persist() {
  saveData(data)
}

function persistSettings() {
  saveSettings(settings)
}

function showToast(msg: string) {
  document.querySelector('.toast')?.remove()
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = msg
  document.body.appendChild(el)
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el.remove(), 2800)
}

function stopScan() {
  window.cancelAnimationFrame(scanLoop)
  scanLoop = 0
  stopCamera(cameraStream)
  cameraStream = null
  nfcAbort?.abort()
  nfcAbort = null
}

function openSpool(id: string) {
  const spool = data.spools.find((s) => s.id === id)
  if (!spool) {
    showToast('Tuljava ni najdena')
    return
  }
  editingId = id
  showEditor = true
  tab = 'zaloga'
  stockView = 'zaloga'
  if (location.hash !== `#spool/${id}`) {
    history.replaceState(null, '', `#spool/${id}`)
  }
  render()
}

function closeEditor() {
  showEditor = false
  editingId = null
  if (location.hash.startsWith('#spool/')) {
    history.replaceState(null, '', location.pathname + location.search)
  }
  render()
}

function handleHash() {
  const hash = location.hash.replace(/^#/, '')
  const m = hash.match(/^spool\/(.+)$/)
  if (m?.[1]) {
    openSpool(m[1])
  }
}

function summaryByMaterial(): Array<{ material: string; colors: number; count: number; grams: number }> {
  const map = new Map<string, { colors: Set<string>; count: number; grams: number }>()
  for (const s of data.spools) {
    const entry = map.get(s.material) ?? { colors: new Set(), count: 0, grams: 0 }
    entry.colors.add(normalizeColorKey(s.color) || '?')
    entry.count += 1
    entry.grams += s.remainingGrams
    map.set(s.material, entry)
  }
  return [...map.entries()]
    .map(([material, v]) => ({
      material,
      colors: v.colors.size,
      count: v.count,
      grams: v.grams,
    }))
    .sort((a, b) => a.material.localeCompare(b.material, 'sl'))
}

function uniqueStockColors(): string[] {
  const map = new Map<string, string>()
  for (const s of data.spools) {
    const key = normalizeColorKey(s.color)
    if (!key) continue
    if (!map.has(key)) map.set(key, s.color.trim())
  }
  return [...map.values()].sort((a, b) => a.localeCompare(b, 'sl'))
}

function filteredSpools(): Spool[] {
  let list = [...data.spools]
  if (materialFilter !== 'vse') {
    list = list.filter((s) => s.material === materialFilter)
  }
  if (colorFilter !== 'vse') {
    const key = normalizeColorKey(colorFilter)
    list = list.filter((s) => normalizeColorKey(s.color) === key)
  }
  return list.sort(
    (a, b) =>
      a.material.localeCompare(b.material, 'sl') || a.color.localeCompare(b.color, 'sl'),
  )
}

function missingCatalog(): CatalogColor[] {
  const owned = new Set(
    data.spools.map((s) => `${s.material}|${normalizeColorKey(s.color)}`),
  )
  return CATALOG_COLORS.filter((c) => {
    if (materialFilter !== 'vse' && c.material !== materialFilter) return false
    if (colorFilter !== 'vse' && normalizeColorKey(c.color) !== normalizeColorKey(colorFilter)) {
      return false
    }
    return !owned.has(`${c.material}|${normalizeColorKey(c.color)}`)
  })
}

function emptySpool(): Spool {
  const now = new Date().toISOString()
  const defMat = settings.materials.find((m) => m.id === 'trcek-pla') ?? settings.materials[0]
  return {
    id: uid('spool'),
    material: defMat?.category ?? 'PLA',
    color: 'Črna',
    colorHex: '#1a1a1a',
    brandName: defMat?.name ?? 'PLASTIKA TRCEK PLA',
    remainingGrams: DEFAULT_FULL_SPOOL_G,
    fullSpoolGrams: DEFAULT_FULL_SPOOL_G,
    pricePerKg: defMat?.pricePerKg ?? 21,
    notes: '',
    createdAt: now,
    updatedAt: now,
  }
}

function renderSwatch(color: string, colorHex?: string): string {
  const css = resolveSpoolColor(color, colorHex)
  if (!css) {
    return `<span class="spool-swatch unknown" title="${escapeHtml(color || '?')}">${escapeHtml(colorInitial(color))}</span>`
  }
  const light = isLightColor(css)
  return `<span class="spool-swatch${light ? ' light-fg' : ''}" style="background:${escapeHtml(css)}" title="${escapeHtml(color)}"></span>`
}

function isLightColor(css: string): boolean {
  const hex = css.match(/^#([0-9a-f]{6})$/i)
  if (!hex?.[1]) return /rgba?\([^)]+,\s*0?\.[0-4]/.test(css) || css.includes('f5f5f5') || css.includes('fffff')
  const n = parseInt(hex[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return (r * 299 + g * 587 + b * 114) / 1000 > 160
}

function renderHeader() {
  return `
    <header class="app-header">
      <div>
        <h1>Filament / HS 3D</h1>
        <div class="sub">Zaloga · NFC/QR · Kalkulator · Nastavitve</div>
      </div>
    </header>
  `
}

function renderTabs() {
  const items: Array<{ id: TabId; label: string; ico: string }> = [
    { id: 'zaloga', label: 'Zaloga', ico: '🧵' },
    { id: 'nfc', label: 'NFC', ico: '📲' },
    { id: 'kalkulator', label: 'Kalkulator', ico: '🧮' },
    { id: 'nastavitve', label: 'Nastavitve', ico: '⚙️' },
  ]
  return `
    <nav class="tab-nav" aria-label="Glavni zavihki">
      ${items
        .map(
          (t) => `
        <button type="button" data-tab="${t.id}" class="${tab === t.id ? 'active' : ''}">
          <span class="ico">${t.ico}</span>
          <span>${t.label}</span>
        </button>`,
        )
        .join('')}
    </nav>
  `
}

function renderZaloga() {
  const summary = summaryByMaterial()
  const colors = uniqueStockColors()
  const list = filteredSpools()
  const missing = missingCatalog()

  return `
    <section class="card">
      <div class="row-between">
        <h2>Zaloga tuljav</h2>
        <button type="button" class="btn btn-primary btn-sm" id="add-spool">+ Nova</button>
      </div>
      <div class="view-toggle" role="tablist">
        <button type="button" data-stock-view="zaloga" class="${stockView === 'zaloga' ? 'active' : ''}">Zaloga</button>
        <button type="button" data-stock-view="manjka" class="${stockView === 'manjka' ? 'active' : ''}">Manjka (${missing.length})</button>
      </div>
      <p class="hint">Tap = razširi · dvojni tap = uredi. Lokalno v localStorage.</p>
      <div class="summary-chips">
        <button type="button" class="chip ${materialFilter === 'vse' ? 'active' : ''}" data-filter-mat="vse">
          Material: vse
        </button>
        ${summary
          .map(
            (s) => `
          <button type="button" class="chip ${materialFilter === s.material ? 'active' : ''}" data-filter-mat="${escapeHtml(s.material)}">
            ${escapeHtml(s.material)} · ${s.count}×
          </button>`,
          )
          .join('')}
      </div>
      <div class="summary-chips">
        <button type="button" class="chip ${colorFilter === 'vse' ? 'active' : ''}" data-filter-color="vse">
          Barva: vse
        </button>
        ${colors
          .map((c) => {
            const css = colorToCss(c)
            const sw = css
              ? `<span class="mini-swatch" style="background:${escapeHtml(css)}"></span>`
              : `<span class="mini-swatch" style="background:var(--surface-3)"></span>`
            return `
          <button type="button" class="chip ${colorFilter === c ? 'active' : ''}" data-filter-color="${escapeHtml(c)}">
            ${sw}${escapeHtml(c)}
          </button>`
          })
          .join('')}
      </div>
      ${
        stockView === 'manjka'
          ? renderManjka(missing)
          : list.length === 0
            ? `<div class="empty">Ni tuljav. Dodaj novo ali počisti filter.</div>`
            : `<div class="spool-list">
          ${list.map((s) => renderSpoolRow(s)).join('')}
        </div>`
      }
    </section>
  `
}

function renderSpoolRow(s: Spool): string {
  const pct = percentFromGrams(s.remainingGrams, s.fullSpoolGrams || DEFAULT_FULL_SPOOL_G)
  const expanded = expandedId === s.id
  return `
    <div class="spool-item${expanded ? ' expanded' : ''}" data-spool-id="${escapeHtml(s.id)}" role="button" tabindex="0">
      <div class="spool-row">
        ${renderSwatch(s.color, s.colorHex)}
        <div class="spool-main">
          <div class="title">${escapeHtml(s.color || 'brez barve')} · ${escapeHtml(s.material)}</div>
          <div class="basics">${escapeHtml(s.brandName)}${s.nfcTagId ? ' · NFC' : ''}</div>
        </div>
        <div class="spool-amt">${formatGrams(s.remainingGrams)}<span class="pct">${pct.toFixed(0)} %</span></div>
      </div>
      <div class="spool-details">
        <div class="meta-line">${s.pricePerKg.toFixed(2)} €/kg · polna ${formatGrams(s.fullSpoolGrams || DEFAULT_FULL_SPOOL_G)}</div>
        ${s.notes ? `<div class="meta-line">${escapeHtml(s.notes)}</div>` : ''}
        <div class="bar"><span style="width:${pct.toFixed(0)}%"></span></div>
        <div class="edit-hint">Dvojni tap za urejanje parametrov</div>
      </div>
    </div>`
}

function renderManjka(missing: CatalogColor[]): string {
  if (missing.length === 0) {
    return `<div class="empty">Vse barve iz kataloga so v zalogi. 🎉</div>`
  }
  return `
    <p class="hint">Barve/materiali iz kataloga Prusa/Bambu, ki jih še nimaš.</p>
    <div class="manjka-list">
      ${missing
        .map(
          (c) => `
        <button type="button" class="manjka-item" data-add-missing="${escapeHtml(c.material)}|${escapeHtml(c.color)}|${escapeHtml(c.brandHint)}">
          ${renderSwatch(c.color)}
          <div>
            <div class="title">${escapeHtml(c.color)} · ${escapeHtml(c.material)}</div>
            <div class="meta">${escapeHtml(c.brandHint)}</div>
          </div>
          <span class="tag">Manjka</span>
        </button>`,
        )
        .join('')}
    </div>`
}

function renderEditorModal() {
  if (!showEditor) return ''
  const spool = editingId ? data.spools.find((s) => s.id === editingId) : null
  const s = spool ?? emptySpool()
  const isNew = !spool
  const pct = percentFromGrams(s.remainingGrams, s.fullSpoolGrams || DEFAULT_FULL_SPOOL_G)
  const nfcOk = isNfcSupported()
  const link = spoolAbsoluteLink(s.id, APP_PAGES_URL)

  return `
    <div class="modal-backdrop" id="editor-backdrop">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h2>${isNew ? 'Nova tuljava' : 'Uredi tuljavo'}</h2>
          <button type="button" class="btn btn-ghost btn-sm" id="close-editor">Zapri</button>
        </div>
        <form id="spool-form">
          <div class="row">
            <div class="field inline">
              <label for="f-material">Material</label>
              <select id="f-material" name="material">
                ${MATERIAL_CATEGORIES.map(
                  (m) => `<option value="${m}" ${s.material === m ? 'selected' : ''}>${m}</option>`,
                ).join('')}
              </select>
            </div>
          </div>
          <div class="field">
            <label>Barva</label>
            <div class="color-palette" role="listbox" aria-label="Paleta barv">
              ${COLOR_PALETTE.map((c) => {
                const selected =
                  normalizeColorKey(s.color) === normalizeColorKey(c.name) ||
                  (s.colorHex || '').toLowerCase() === c.hex.toLowerCase()
                const light = isLightColor(c.hex)
                return `<button type="button" class="palette-swatch${selected ? ' selected' : ''}${light ? ' light-fg' : ''}" data-palette-name="${escapeHtml(c.name)}" data-palette-hex="${escapeHtml(c.hex)}" style="background:${escapeHtml(c.hex)}" title="${escapeHtml(c.name)}" aria-pressed="${selected ? 'true' : 'false'}"></button>`
              }).join('')}
            </div>
            <input type="hidden" id="f-color" name="color" value="${escapeHtml(s.color)}" required />
            <input type="hidden" id="f-color-hex" name="colorHex" value="${escapeHtml(s.colorHex || paletteHexForName(s.color) || '')}" />
            <div class="palette-selected" id="palette-selected">${escapeHtml(s.color || 'Izberi barvo')}${s.colorHex || paletteHexForName(s.color) ? ` · ${escapeHtml(s.colorHex || paletteHexForName(s.color) || '')}` : ''}</div>
            <details class="color-custom">
              <summary>Druga barva (ime + hex)</summary>
              <div class="row" style="margin-top:6px">
                <div class="field inline">
                  <label for="f-color-custom-name">Ime</label>
                  <input id="f-color-custom-name" type="text" placeholder="npr. Neon Green" />
                </div>
                <div class="field inline">
                  <label for="f-color-custom-hex">Hex</label>
                  <input id="f-color-custom-hex" type="color" value="${escapeHtml((s.colorHex || paletteHexForName(s.color) || '#888888').slice(0, 7))}" />
                </div>
              </div>
              <button type="button" class="btn btn-ghost btn-sm" id="apply-custom-color">Uporabi</button>
            </details>
          </div>
          <div class="field">
            <label for="f-brand">Znamka / ime</label>
            <input id="f-brand" name="brandName" list="material-names" value="${escapeHtml(s.brandName)}" placeholder="PLASTIKA TRCEK PLA" />
            <datalist id="material-names">
              ${settings.materials.map((m) => `<option value="${escapeHtml(m.name)}"></option>`).join('')}
            </datalist>
          </div>
          <div class="row">
            <div class="field inline">
              <label for="f-grams">Preostalo (g)</label>
              <input id="f-grams" name="grams" type="number" min="0" step="1" value="${s.remainingGrams}" />
            </div>
            <div class="field inline">
              <label for="f-percent">ali %</label>
              <input id="f-percent" name="percent" type="number" min="0" max="100" step="1" value="${pct.toFixed(0)}" />
            </div>
            <div class="field inline">
              <label for="f-full">Polna tuljava (g)</label>
              <input id="f-full" name="full" type="number" min="1" step="1" value="${s.fullSpoolGrams || DEFAULT_FULL_SPOOL_G}" />
            </div>
          </div>
          <div class="field">
            <label for="f-price">Cena (€/kg)</label>
            <input id="f-price" name="price" type="number" min="0" step="0.01" value="${s.pricePerKg}" />
          </div>
          <div class="field">
            <label for="f-notes">Opombe</label>
            <textarea id="f-notes" name="notes" placeholder="Opcijsko">${escapeHtml(s.notes)}</textarea>
          </div>
          <div class="field">
            <label for="f-nfc">NFC tag ID (opcijsko)</label>
            <input id="f-nfc" name="nfcTagId" value="${escapeHtml(s.nfcTagId || '')}" placeholder="serijska št. oznake" />
          </div>
          <p class="hint">Ustvarjeno: ${formatDateTime(s.createdAt)}</p>
          <div class="row" style="margin-bottom:10px">
            <button type="submit" class="btn btn-primary" style="flex:1">Shrani</button>
            ${
              !isNew
                ? `<button type="button" class="btn btn-danger" id="delete-spool">Izbriši</button>`
                : ''
            }
          </div>
        </form>
        ${
          !isNew
            ? `
          <div class="card" style="margin:0;padding:12px;background:var(--surface)">
            <h3>QR / NFC</h3>
            <div class="qr-box">
              <canvas id="spool-qr" width="220" height="220"></canvas>
              <code style="font-size:0.7rem;word-break:break-all;color:#333">${escapeHtml(link)}</code>
              <button type="button" class="btn btn-ghost btn-sm no-print" id="print-qr">Natisni QR</button>
            </div>
            ${
              nfcOk
                ? `<button type="button" class="btn btn-secondary btn-block" id="write-nfc" style="margin-top:10px">Zapiši NFC</button>
                   <p class="hint">Chrome Android + NTAG: po tapu približaj prazno NTAG. Ne piši čez Prusament OpenPrintTag (ISO 15693).</p>`
                : `<p class="note warn">NFC ni na voljo v tem brskalniku. Uporabi QR kodo.</p>`
            }
          </div>`
            : ''
        }
      </div>
    </div>
  `
}

function handleNfcReadResult(result: NfcReadResult, statusEl: Element | null) {
  if (statusEl) statusEl.textContent = result.summary

  if (result.kind === 'spool' && result.spoolId) {
    const spool = data.spools.find((s) => s.id === result.spoolId)
    if (spool && result.serialNumber) {
      spool.nfcTagId = result.serialNumber
      spool.updatedAt = new Date().toISOString()
      persist()
    }
    if (!spool) {
      showToast('Tuljava ni v zalogi — ID prebran, vendar manjka lokalno')
      if (statusEl) {
        statusEl.textContent = `Prebran ID ${result.spoolId}, a tuljava ni v tej napravi.`
      }
      return
    }
    openSpool(result.spoolId)
    showToast('Odprto iz NFC')
    return
  }

  if (result.kind === 'openprinttag' && result.openPrintTag) {
    const id = upsertSpoolFromOpenPrintTag(result)
    openSpool(id)
    showToast(isNativeCapacitor() ? 'OpenPrintTag → zaloga' : 'OpenPrintTag (NDEF) → tuljava')
    return
  }

  if (result.kind === 'empty') {
    showToast('Prazna oznaka — zapiši naš URL ali vnesi tuljavo ročno')
    return
  }

  showToast(result.summary)
}

function upsertSpoolFromOpenPrintTag(result: NfcReadResult): string {
  const f = result.openPrintTag!
  const serial = result.serialNumber || ''
  const existing =
    (serial && data.spools.find((s) => s.nfcTagId === serial)) ||
    data.spools.find(
      (s) =>
        s.brandName === (f.brandName || s.brandName) &&
        s.notes.includes('OpenPrintTag') &&
        (f.materialName ? s.notes.includes(f.materialName) : false),
    )

  const material = mapOptMaterialToCategory(f)
  const color = f.colorHex || existing?.color || '#888888'
  const brandName = f.brandName || existing?.brandName || 'OpenPrintTag'
  const full = Math.round(f.fullWeightG ?? existing?.fullSpoolGrams ?? DEFAULT_FULL_SPOOL_G)
  const remaining = Math.round(f.remainingWeightG ?? existing?.remainingGrams ?? full)
  const pricePerKg =
    f.purchasePrice != null && full > 0
      ? f.purchasePrice / (full / 1000)
      : (existing?.pricePerKg ?? 0)
  const notesParts = [
    'Uvoženo iz OpenPrintTag.',
    f.materialName ? `Material: ${f.materialName}` : '',
    f.materialTypeAbbrev ? `Tip: ${f.materialTypeAbbrev}` : '',
    f.filamentDiameterUm != null ? `Premer: ${(f.filamentDiameterUm / 1000).toFixed(2)} mm` : '',
    f.purchasePrice != null
      ? `Cena: ${f.purchasePrice}${f.purchaseCurrency ? ' ' + f.purchaseCurrency : ''}`
      : '',
    'Vir: OpenPrintTag (ISO 15693 NFC-V ali NDEF MIME).',
  ].filter(Boolean)

  const now = new Date().toISOString()
  if (existing) {
    existing.material = material
    existing.color = color
    existing.colorHex = /^#/i.test(color) ? color : (existing.colorHex || paletteHexForName(color) || undefined)
    existing.brandName = brandName
    existing.fullSpoolGrams = full
    existing.remainingGrams = remaining
    if (pricePerKg > 0) existing.pricePerKg = pricePerKg
    if (serial) existing.nfcTagId = serial
    existing.notes = notesParts.join(' ')
    existing.updatedAt = now
    persist()
    return existing.id
  }

  const spool: Spool = {
    id: uid('spool'),
    material,
    color,
    colorHex: /^#/i.test(color) ? color : paletteHexForName(color) || undefined,
    brandName,
    remainingGrams: remaining,
    fullSpoolGrams: full,
    pricePerKg,
    notes: notesParts.join(' '),
    nfcTagId: serial || undefined,
    createdAt: now,
    updatedAt: now,
  }
  data.spools.unshift(spool)
  persist()
  return spool.id
}

function renderNfc() {
  const nfcOk = isNfcSupported()
  return `
    <section class="card">
      <h2>NFC + QR</h2>
      <p class="hint">Odpri tuljavo s skeniranjem <strong>naše</strong> NTAG oznake (URL/QR). NFC deluje samo v <strong>Chrome na Androidu</strong>, po tapu gumba.</p>
      ${
        nfcOk
          ? `
        <button type="button" class="btn btn-primary btn-block" id="nfc-read">Preberi NFC oznako</button>
        <p class="hint" id="nfc-status">Približaj NTAG oznako. Podprto: URL z <code>#spool/…</code>, <code>spool:id</code>, ali OpenPrintTag MIME na NTAG.</p>
      `
          : `
        <div class="note warn">Web NFC ni podprt (potreben Chrome na Androidu + HTTPS). Na voljo je samo QR.</div>
      `
      }
    </section>
    <section class="card">
      <h2>OpenPrintTag / Prusament</h2>
      ${
        isAndroidNative()
          ? `
        <button type="button" class="btn btn-primary btn-block" id="opt-read">Preberi OpenPrintTag</button>
        <p class="hint" id="opt-status">Približaj Prusament / OpenPrintTag (ICODE SLIX2, ISO 15693) hrbtu telefona. Branje je samo za branje — ne pišemo na tovarniške oznake.</p>
        <div class="note" style="margin-top:10px">
          Uvozi v <strong>Zalogo</strong>: znamka, material, barva, polna/preostala teža, premer. Zapis (write) ni omogočen (zaščita Prusa tagov).
        </div>
      `
          : `
        <div class="note warn">
          Tovarniške <strong>Prusament / OpenPrintTag</strong> oznake so <strong>ISO 15693 (NFC-V)</strong>.
          Web NFC jih ne vidi. Namesti <strong>Android APK</strong> (Filament HS 3D) za gumb
          <em>Preberi OpenPrintTag</em>, ali uporabi zunanjo app in vnesi ročno.
        </div>
        <p class="hint" style="margin-top:8px">
          Spec: <a href="https://openprinttag.org" target="_blank" rel="noopener">openprinttag.org</a>.
          Ne piši našega URL-ja čez OpenPrintTag oznako.
        </p>
      `
      }
    </section>
    <section class="card">
      <h2>Skeniraj QR</h2>
      <div class="row" style="margin-bottom:10px">
        <button type="button" class="btn btn-secondary" id="qr-start">Kamera</button>
        <button type="button" class="btn btn-ghost" id="qr-stop">Ustavi</button>
        <label class="btn btn-ghost" style="min-height:var(--tap);display:inline-flex;align-items:center">
          Iz datoteke
          <input type="file" accept="image/*" capture="environment" id="qr-file" hidden />
        </label>
      </div>
      <div class="video-wrap hidden" id="qr-video-wrap">
        <video id="qr-video" playsinline muted></video>
      </div>
      <p class="hint" id="qr-status">Pripravljen.</p>
    </section>
    <section class="card">
      <h2>Kako zapisati našo NFC oznako</h2>
      <ol style="margin:0;padding-left:1.2rem;font-size:0.86rem;color:var(--muted)">
        <li>Uporabi prazno <strong>NTAG213/215/216</strong> (ne Prusament SLIX2).</li>
        <li>Odpri tuljavo v zavihku Zaloga.</li>
        <li>Tapni <strong>Zapiši NFC</strong> (Chrome Android).</li>
        <li>Približaj oznako — zapiše se URL z <code>#spool/id</code>.</li>
      </ol>
    </section>
  `
}

function renderKalkulator() {
  const hours = parsePrintHours(calcTime)
  const result = calculatePrice(
    {
      printerId: calcPrinter,
      materialId: calcMaterial,
      weightG: Number(calcWeight) || 0,
      printHours: hours,
      prepMin: Number(calcPrep) || 0,
      postMin: Number(calcPost) || 0,
      consumables: Number(calcConsumables) || 0,
      markup: Number(calcMarkup) || settings.defaultMarkup,
      failureRate: Number(calcFailure) || 0,
    },
    settings,
  )
  const mat = findMaterialIn(settings, calcMaterial)

  return `
    <section class="card">
      <h2>Kalkulator 3D tiska</h2>
      <p class="hint">Formule iz HS Pricing Sheet. Energija ${settings.electricityEurPerKwh.toFixed(2)} €/kWh · delo ${settings.laborEurPerHour.toFixed(0)} €/h · <button type="button" class="btn btn-ghost btn-sm" id="goto-settings" style="display:inline;min-height:auto;padding:2px 6px">Nastavitve</button></p>
      <div class="field">
        <label for="c-printer">Tiskalnik</label>
        <select id="c-printer">
          ${settings.printers
            .map(
              (p) =>
                `<option value="${p.id}" ${calcPrinter === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`,
            )
            .join('')}
        </select>
      </div>
      <div class="field">
        <label for="c-material">Filament</label>
        <select id="c-material">
          ${settings.materials
            .map(
              (m) =>
                `<option value="${m.id}" ${calcMaterial === m.id ? 'selected' : ''}>${escapeHtml(m.name)} (${m.pricePerKg.toFixed(2)} €/kg)</option>`,
            )
            .join('')}
        </select>
      </div>
      <div class="row">
        <div class="field inline">
          <label for="c-weight">Teža (g)</label>
          <input id="c-weight" type="number" min="0" step="0.01" value="${escapeHtml(calcWeight)}" />
        </div>
        <div class="field inline">
          <label for="c-time">Čas (hh:mm ali h)</label>
          <input id="c-time" type="text" inputmode="decimal" value="${escapeHtml(calcTime)}" placeholder="3:46" />
        </div>
      </div>
      <div class="row">
        <div class="field inline">
          <label for="c-prep">Priprava (min)</label>
          <input id="c-prep" type="number" min="0" step="1" value="${escapeHtml(calcPrep)}" />
        </div>
        <div class="field inline">
          <label for="c-post">Naknadna (min)</label>
          <input id="c-post" type="number" min="0" step="1" value="${escapeHtml(calcPost)}" />
        </div>
      </div>
      <div class="row">
        <div class="field inline">
          <label for="c-cons">Potrošni (€)</label>
          <input id="c-cons" type="number" min="0" step="0.01" value="${escapeHtml(calcConsumables)}" />
        </div>
        <div class="field inline">
          <label for="c-markup">Marža (×)</label>
          <input id="c-markup" type="number" min="0.1" step="0.1" value="${escapeHtml(calcMarkup)}" />
        </div>
        <div class="field inline">
          <label for="c-fail">Izmet (%)</label>
          <input id="c-fail" type="number" min="0" step="1" value="${escapeHtml(calcFailure)}" />
        </div>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" id="calc-sample">Naloži vzorec (61,46 g · 3:46)</button>
    </section>
    <section class="card">
      <h2>Razčlenitev</h2>
      <p class="hint">${escapeHtml(mat.name)} · ${hours.toFixed(2)} h tiska</p>
      <table class="breakdown">
        <tr><td>Filament</td><td>${formatEuro(result.filamentCost)}</td></tr>
        <tr><td>Elektrika</td><td>${formatEuro(result.electricity)}</td></tr>
        <tr><td>Amortizacija</td><td>${formatEuro(result.depreciation)}</td></tr>
        <tr><td>Priprava</td><td>${formatEuro(result.preparation)}</td></tr>
        <tr><td>Naknadna obdelava</td><td>${formatEuro(result.postProcessing)}</td></tr>
        <tr><td>Potrošni material</td><td>${formatEuro(result.consumables)}</td></tr>
        <tr><td>Vmesna vsota</td><td>${formatEuro(result.subtotal)}</td></tr>
        <tr><td>Z izmetom</td><td>${formatEuro(result.withFailures)}</td></tr>
        <tr class="total"><td>Predlagana cena</td><td>${formatEuro(result.suggested)}</td></tr>
      </table>
      <div class="suggested">
        <div class="label">Predlagana cena</div>
        <div class="price">${formatEuro(result.suggested)}</div>
      </div>
    </section>
  `
}

function renderNastavitve() {
  return `
    <section class="card">
      <div class="row-between">
        <h2>Nastavitve kalkulatorja</h2>
        <button type="button" class="btn btn-ghost btn-sm" id="reset-settings">Ponastavi Excel</button>
      </div>
      <p class="hint">Vrednosti v localStorage (<code>filament-hs-3d-settings-v1</code>). Kalkulator jih bere tukaj. Ponastavi Excel obnovi privzete — potem lahko znova dodaš svoje.</p>
      <div class="row">
        <div class="field inline">
          <label for="s-energy">Elektrika (€/kWh)</label>
          <input id="s-energy" type="number" min="0" step="0.01" value="${settings.electricityEurPerKwh}" />
        </div>
        <div class="field inline">
          <label for="s-labor">Delo (€/h)</label>
          <input id="s-labor" type="number" min="0" step="0.5" value="${settings.laborEurPerHour}" />
        </div>
      </div>
      <div class="row">
        <div class="field inline">
          <label for="s-fail">Privzeti izmet (%)</label>
          <input id="s-fail" type="number" min="0" step="1" value="${settings.failureRatePct}" />
        </div>
        <div class="field inline">
          <label for="s-markup">Privzeta marža (×)</label>
          <input id="s-markup" type="number" min="0.1" step="0.1" value="${settings.defaultMarkup}" />
        </div>
      </div>
      <button type="button" class="btn btn-primary btn-block" id="save-rates">Shrani stopnje</button>
    </section>
    <section class="card">
      <h2>Tiskalniki</h2>
      <p class="hint">Polja iz lista Naprave: ime, cena €, življenje h, servis €, energija kWh/h.</p>
      <div class="crud-list">
        ${settings.printers
          .map(
            (p, i) => `
          <div class="crud-item" data-printer-idx="${i}">
            <div class="field">
              <label>Ime</label>
              <input data-p="name" type="text" value="${escapeHtml(p.name)}" />
            </div>
            <div class="row">
              <div class="field inline">
                <label>Cena €</label>
                <input data-p="price" type="number" min="0" step="1" value="${p.price}" />
              </div>
              <div class="field inline">
                <label>Živ. h</label>
                <input data-p="lifeHours" type="number" min="1" step="1" value="${p.lifeHours}" />
              </div>
            </div>
            <div class="row">
              <div class="field inline">
                <label>Servis €</label>
                <input data-p="serviceCost" type="number" min="0" step="1" value="${p.serviceCost}" />
              </div>
              <div class="field inline">
                <label>kWh/h</label>
                <input data-p="energyKwhPerH" type="number" min="0" step="0.01" value="${p.energyKwhPerH}" />
              </div>
            </div>
            <div class="crud-actions">
              <button type="button" class="btn btn-secondary btn-sm" data-save-printer="${i}">Shrani</button>
              <button type="button" class="btn btn-danger btn-sm" data-del-printer="${i}">Izbriši</button>
            </div>
          </div>`,
          )
          .join('')}
      </div>
      <div class="crud-add">
        <h3>Dodaj tiskalnik</h3>
        <div class="field">
          <label for="np-name">Ime</label>
          <input id="np-name" type="text" placeholder="npr. Bambu X1C" />
        </div>
        <div class="row">
          <div class="field inline">
            <label for="np-price">Cena €</label>
            <input id="np-price" type="number" min="0" step="1" value="1000" />
          </div>
          <div class="field inline">
            <label for="np-life">Živ. h</label>
            <input id="np-life" type="number" min="1" step="1" value="3000" />
          </div>
        </div>
        <div class="row">
          <div class="field inline">
            <label for="np-service">Servis €</label>
            <input id="np-service" type="number" min="0" step="1" value="100" />
          </div>
          <div class="field inline">
            <label for="np-energy">kWh/h</label>
            <input id="np-energy" type="number" min="0" step="0.01" value="0.2" />
          </div>
        </div>
        <button type="button" class="btn btn-primary btn-block" id="add-printer">Dodaj tiskalnik</button>
      </div>
    </section>
    <section class="card">
      <h2>Materiali / filamenti</h2>
      <p class="hint">€/kg ali cena tuljave + kg → €/kg. Seznam v spustnem meniju kalkulatorja.</p>
      <div class="crud-list">
        ${settings.materials
          .map(
            (m, i) => `
          <div class="crud-item" data-material-idx="${i}">
            <div class="field">
              <label>Ime</label>
              <input data-m="name" type="text" value="${escapeHtml(m.name)}" />
            </div>
            <div class="row">
              <div class="field inline">
                <label>Kategorija</label>
                <select data-m="category">
                  ${MATERIAL_CATEGORIES.map(
                    (c) =>
                      `<option value="${c}" ${m.category === c ? 'selected' : ''}>${c}</option>`,
                  ).join('')}
                </select>
              </div>
              <div class="field inline">
                <label>€/kg</label>
                <input data-m="pricePerKg" type="number" min="0" step="0.01" value="${Number(m.pricePerKg.toFixed(4))}" />
              </div>
            </div>
            <div class="row">
              <div class="field inline">
                <label>Cena tuljave €</label>
                <input data-m="spoolPrice" type="number" min="0" step="0.01" value="${m.spoolPrice ?? ''}" placeholder="opcijsko" />
              </div>
              <div class="field inline">
                <label>Tuljava kg</label>
                <input data-m="spoolKg" type="number" min="0" step="0.01" value="${m.spoolKg ?? ''}" placeholder="opcijsko" />
              </div>
            </div>
            <div class="crud-actions">
              <button type="button" class="btn btn-secondary btn-sm" data-save-material="${i}">Shrani</button>
              <button type="button" class="btn btn-danger btn-sm" data-del-material="${i}">Izbriši</button>
            </div>
          </div>`,
          )
          .join('')}
      </div>
      <div class="crud-add">
        <h3>Dodaj material</h3>
        <div class="field">
          <label for="nm-name">Ime</label>
          <input id="nm-name" type="text" placeholder="npr. Bambu PLA Basic" />
        </div>
        <div class="row">
          <div class="field inline">
            <label for="nm-cat">Kategorija</label>
            <select id="nm-cat">
              ${MATERIAL_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
          <div class="field inline">
            <label for="nm-ppk">€/kg</label>
            <input id="nm-ppk" type="number" min="0" step="0.01" value="25" />
          </div>
        </div>
        <div class="row">
          <div class="field inline">
            <label for="nm-spool-price">Cena tuljave €</label>
            <input id="nm-spool-price" type="number" min="0" step="0.01" placeholder="opcijsko" />
          </div>
          <div class="field inline">
            <label for="nm-spool-kg">Tuljava kg</label>
            <input id="nm-spool-kg" type="number" min="0" step="0.01" placeholder="npr. 1" />
          </div>
        </div>
        <p class="hint">Če vpišeš ceno tuljave + kg, se €/kg izračuna samodejno.</p>
        <button type="button" class="btn btn-primary btn-block" id="add-material">Dodaj material</button>
      </div>
    </section>
  `
}

function render() {
  stopScan()
  const body =
    tab === 'zaloga'
      ? renderZaloga()
      : tab === 'nfc'
        ? renderNfc()
        : tab === 'kalkulator'
          ? renderKalkulator()
          : renderNastavitve()
  app.innerHTML = renderHeader() + body + renderTabs() + renderEditorModal()
  bind()
}

function bind() {
  app.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      tab = (btn as HTMLElement).dataset.tab as TabId
      showEditor = false
      editingId = null
      render()
    })
  })

  app.querySelectorAll('[data-stock-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      stockView = (btn as HTMLElement).dataset.stockView as 'zaloga' | 'manjka'
      render()
    })
  })

  app.querySelectorAll('[data-filter-mat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const f = (btn as HTMLElement).dataset.filterMat!
      materialFilter = f === 'vse' ? 'vse' : (f as MaterialCategory)
      render()
    })
  })

  app.querySelectorAll('[data-filter-color]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const f = (btn as HTMLElement).dataset.filterColor!
      colorFilter = f === 'vse' ? 'vse' : f
      render()
    })
  })

  app.querySelectorAll('[data-spool-id]').forEach((el) => {
    const id = (el as HTMLElement).dataset.spoolId!
    el.addEventListener('click', (e) => {
      e.preventDefault()
      if (pendingClickId === id && clickTimer) {
        window.clearTimeout(clickTimer)
        clickTimer = undefined
        pendingClickId = null
        openSpool(id)
        return
      }
      pendingClickId = id
      window.clearTimeout(clickTimer)
      clickTimer = window.setTimeout(() => {
        clickTimer = undefined
        pendingClickId = null
        expandedId = expandedId === id ? null : id
        render()
      }, 280)
    })
    el.addEventListener('dblclick', (e) => {
      e.preventDefault()
      window.clearTimeout(clickTimer)
      clickTimer = undefined
      pendingClickId = null
      openSpool(id)
    })
  })

  app.querySelectorAll('[data-add-missing]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const raw = (btn as HTMLElement).dataset.addMissing!
      const [material, color, brandHint] = raw.split('|')
      const now = new Date().toISOString()
      const matchMat = settings.materials.find((m) => m.category === material)
      const spool: Spool = {
        id: uid('spool'),
        material: (material as MaterialCategory) || 'PLA',
        color: color || '',
        colorHex: paletteHexForName(color || '') || colorToCss(color || '') || undefined,
        brandName: matchMat?.name || brandHint || material || '',
        remainingGrams: DEFAULT_FULL_SPOOL_G,
        fullSpoolGrams: DEFAULT_FULL_SPOOL_G,
        pricePerKg: matchMat?.pricePerKg ?? 0,
        notes: `Dodano iz Manjka (${brandHint || ''})`,
        createdAt: now,
        updatedAt: now,
      }
      data.spools.unshift(spool)
      persist()
      editingId = spool.id
      showEditor = true
      stockView = 'zaloga'
      showToast('Dodano — uredi parametre')
      render()
    })
  })

  app.querySelector('#add-spool')?.addEventListener('click', () => {
    editingId = null
    showEditor = true
    render()
  })

  app.querySelector('#close-editor')?.addEventListener('click', () => closeEditor())
  app.querySelector('#editor-backdrop')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeEditor()
  })

  const form = app.querySelector<HTMLFormElement>('#spool-form')
  if (form) {
    const gramsEl = form.querySelector<HTMLInputElement>('#f-grams')!
    const percentEl = form.querySelector<HTMLInputElement>('#f-percent')!
    const fullEl = form.querySelector<HTMLInputElement>('#f-full')!
    const priceEl = form.querySelector<HTMLInputElement>('#f-price')!
    const brandEl = form.querySelector<HTMLInputElement>('#f-brand')!

    percentEl.addEventListener('input', () => {
      const full = Number(fullEl.value) || DEFAULT_FULL_SPOOL_G
      gramsEl.value = String(Math.round(gramsFromPercent(Number(percentEl.value) || 0, full)))
    })
    gramsEl.addEventListener('input', () => {
      const full = Number(fullEl.value) || DEFAULT_FULL_SPOOL_G
      percentEl.value = String(Math.round(percentFromGrams(Number(gramsEl.value) || 0, full)))
    })
    fullEl.addEventListener('input', () => {
      const full = Number(fullEl.value) || DEFAULT_FULL_SPOOL_G
      percentEl.value = String(Math.round(percentFromGrams(Number(gramsEl.value) || 0, full)))
    })
    brandEl.addEventListener('change', () => {
      const match = settings.materials.find((m) => m.name === brandEl.value)
      if (match) {
        priceEl.value = String(Number(match.pricePerKg.toFixed(4)))
        const matSelect = form.querySelector<HTMLSelectElement>('#f-material')!
        matSelect.value = match.category
      }
    })

    const colorNameEl = form.querySelector<HTMLInputElement>('#f-color')!
    const colorHexEl = form.querySelector<HTMLInputElement>('#f-color-hex')!
    const selectedLabel = form.querySelector('#palette-selected')
    const setPaletteSelection = (name: string, hex: string) => {
      colorNameEl.value = name
      colorHexEl.value = hex
      if (selectedLabel) selectedLabel.textContent = `${name} · ${hex}`
      form.querySelectorAll('.palette-swatch').forEach((btn) => {
        const el = btn as HTMLElement
        const on =
          normalizeColorKey(el.dataset.paletteName || '') === normalizeColorKey(name) ||
          (el.dataset.paletteHex || '').toLowerCase() === hex.toLowerCase()
        el.classList.toggle('selected', on)
        el.setAttribute('aria-pressed', on ? 'true' : 'false')
      })
      const customHex = form.querySelector<HTMLInputElement>('#f-color-custom-hex')
      if (customHex && /^#[0-9a-f]{6}$/i.test(hex)) customHex.value = hex
    }
    form.querySelectorAll('[data-palette-name]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const el = btn as HTMLElement
        setPaletteSelection(el.dataset.paletteName || '', el.dataset.paletteHex || '')
      })
    })
    form.querySelector('#apply-custom-color')?.addEventListener('click', () => {
      const name =
        (form.querySelector('#f-color-custom-name') as HTMLInputElement).value.trim() ||
        colorNameEl.value.trim() ||
        'Po meri'
      const hex = (form.querySelector('#f-color-custom-hex') as HTMLInputElement).value
      setPaletteSelection(name, hex)
    })

    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const now = new Date().toISOString()
      const existing = editingId ? data.spools.find((s) => s.id === editingId) : null
      const spool: Spool = {
        id: existing?.id ?? uid('spool'),
        material: (form.querySelector('#f-material') as HTMLSelectElement).value as MaterialCategory,
        color: (form.querySelector('#f-color') as HTMLInputElement).value.trim(),
        colorHex: (form.querySelector('#f-color-hex') as HTMLInputElement)?.value.trim() || undefined,
        brandName: brandEl.value.trim(),
        remainingGrams: Number(gramsEl.value) || 0,
        fullSpoolGrams: Number(fullEl.value) || DEFAULT_FULL_SPOOL_G,
        pricePerKg: Number(priceEl.value) || 0,
        notes: (form.querySelector('#f-notes') as HTMLTextAreaElement).value.trim(),
        nfcTagId: (form.querySelector('#f-nfc') as HTMLInputElement).value.trim() || undefined,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      if (existing) {
        data.spools = data.spools.map((s) => (s.id === existing.id ? spool : s))
      } else {
        data.spools.unshift(spool)
      }
      persist()
      showToast('Shranjeno')
      editingId = spool.id
      showEditor = true
      history.replaceState(null, '', `#spool/${spool.id}`)
      render()
    })

    app.querySelector('#delete-spool')?.addEventListener('click', () => {
      if (!editingId) return
      if (!confirm('Res izbrišem to tuljavo?')) return
      data.spools = data.spools.filter((s) => s.id !== editingId)
      persist()
      showToast('Izbrisano')
      closeEditor()
    })

    const qrCanvas = app.querySelector<HTMLCanvasElement>('#spool-qr')
    if (qrCanvas && editingId) {
      const link = spoolAbsoluteLink(editingId, APP_PAGES_URL)
      void renderQrToCanvas(qrCanvas, link).catch(() => showToast('QR ni uspel'))
    }

    app.querySelector('#print-qr')?.addEventListener('click', () => window.print())

    app.querySelector('#write-nfc')?.addEventListener('click', async () => {
      if (!editingId) return
      const link = spoolAbsoluteLink(editingId, APP_PAGES_URL)
      try {
        showToast('Približaj prazno NTAG oznako…')
        await writeNfcUrl(link)
        const spool = data.spools.find((s) => s.id === editingId)
        if (spool) {
          spool.updatedAt = new Date().toISOString()
          persist()
        }
        showToast('NFC zapisan (URL tuljave)')
      } catch (err) {
        if (err instanceof NfcUserError && err.code === 'abort') return
        showToast(err instanceof Error ? err.message : 'Napaka NFC')
      }
    })
  }

  app.querySelector('#nfc-read')?.addEventListener('click', async () => {
    const statusEl = app.querySelector('#nfc-status')
    try {
      nfcAbort?.abort()
      nfcAbort = new AbortController()
      if (statusEl) statusEl.textContent = 'Čakam na NTAG oznako… (do 25 s)'
      showToast('Približaj NFC…')
      const result = await readNfcOnce(nfcAbort.signal)
      handleNfcReadResult(result, statusEl)
    } catch (err) {
      if (err instanceof NfcUserError && err.code === 'abort') return
      if (err instanceof DOMException && err.name === 'AbortError') return
      const msg = err instanceof Error ? err.message : 'NFC napaka'
      if (statusEl) statusEl.textContent = msg
      showToast(msg)
    }
  })

  app.querySelector('#opt-read')?.addEventListener('click', async () => {
    const statusEl = app.querySelector('#opt-status')
    try {
      if (!isAndroidNative()) {
        throw new Error('OpenPrintTag NFC-V deluje samo v Android APK.')
      }
      if (statusEl) statusEl.textContent = 'Pripravljen — približaj OpenPrintTag… (do 30 s)'
      showToast('Približaj OpenPrintTag…')
      const scan = await OpenPrintTagNfc.scan({ timeoutMs: 30_000 })
      const bytes = base64ToBytes(scan.payloadBase64)
      const result = resultFromOpenPrintTagBytes(bytes, scan.uidHex || '')
      if (statusEl) statusEl.textContent = result.summary
      handleNfcReadResult(result, statusEl)
      showToast('OpenPrintTag uvožen v zalogo')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Napaka OpenPrintTag'
      if (statusEl) statusEl.textContent = msg
      showToast(msg)
    }
  })

  const video = app.querySelector<HTMLVideoElement>('#qr-video')
  const wrap = app.querySelector('#qr-video-wrap')
  const status = app.querySelector('#qr-status')

  const onPayload = (raw: string) => {
    const id = parseSpoolPayload(raw)
    if (!id) {
      showToast('QR ni tuljava')
      if (status) status.textContent = `Neprepoznano: ${raw.slice(0, 60)}`
      return
    }
    stopScan()
    openSpool(id)
    showToast('Odprto iz QR')
  }

  app.querySelector('#qr-start')?.addEventListener('click', async () => {
    if (!video || !wrap) return
    try {
      stopScan()
      wrap.classList.remove('hidden')
      cameraStream = await startCamera(video)
      if (status) status.textContent = 'Iščem QR…'
      const loop = () => {
        const code = decodeQrFromVideo(video)
        if (code) {
          onPayload(code)
          return
        }
        scanLoop = requestAnimationFrame(loop)
      }
      scanLoop = requestAnimationFrame(loop)
    } catch {
      showToast('Kamera ni na voljo')
      if (status) status.textContent = 'Kamera zavrnjena ali ni na voljo.'
    }
  })

  app.querySelector('#qr-stop')?.addEventListener('click', () => {
    stopScan()
    wrap?.classList.add('hidden')
    if (status) status.textContent = 'Ustavljeno.'
  })

  app.querySelector('#qr-file')?.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    const code = await decodeQrFromFile(file)
    if (!code) {
      showToast('QR ni prebran')
      return
    }
    onPayload(code)
  })

  // Calculator
  const syncCalc = () => {
    calcPrinter = (app.querySelector('#c-printer') as HTMLSelectElement)?.value ?? calcPrinter
    calcMaterial = (app.querySelector('#c-material') as HTMLSelectElement)?.value ?? calcMaterial
    calcWeight = (app.querySelector('#c-weight') as HTMLInputElement)?.value ?? calcWeight
    calcTime = (app.querySelector('#c-time') as HTMLInputElement)?.value ?? calcTime
    calcPrep = (app.querySelector('#c-prep') as HTMLInputElement)?.value ?? calcPrep
    calcPost = (app.querySelector('#c-post') as HTMLInputElement)?.value ?? calcPost
    calcConsumables = (app.querySelector('#c-cons') as HTMLInputElement)?.value ?? calcConsumables
    calcMarkup = (app.querySelector('#c-markup') as HTMLInputElement)?.value ?? calcMarkup
    calcFailure = (app.querySelector('#c-fail') as HTMLInputElement)?.value ?? calcFailure
  }

  ;['c-printer', 'c-material', 'c-weight', 'c-time', 'c-prep', 'c-post', 'c-cons', 'c-markup', 'c-fail'].forEach(
    (id) => {
      app.querySelector(`#${id}`)?.addEventListener('change', () => {
        syncCalc()
        render()
      })
    },
  )

  app.querySelector('#goto-settings')?.addEventListener('click', () => {
    tab = 'nastavitve'
    render()
  })

  app.querySelector('#calc-sample')?.addEventListener('click', () => {
    calcPrinter = 'core-one-indx'
    calcMaterial = 'trcek-pla'
    calcWeight = '61.46'
    calcTime = '3:46'
    calcPrep = '20'
    calcPost = '10'
    calcConsumables = '0'
    calcMarkup = '1.5'
    calcFailure = '20'
    render()
    showToast(`Vzorec → ${formatEuro(sanitySuggested(settings))}`)
  })

  // Settings
  app.querySelector('#save-rates')?.addEventListener('click', () => {
    settings.electricityEurPerKwh = Number((app.querySelector('#s-energy') as HTMLInputElement).value) || 0
    settings.laborEurPerHour = Number((app.querySelector('#s-labor') as HTMLInputElement).value) || 0
    settings.failureRatePct = Number((app.querySelector('#s-fail') as HTMLInputElement).value) || 0
    settings.defaultMarkup = Number((app.querySelector('#s-markup') as HTMLInputElement).value) || 1
    persistSettings()
    calcMarkup = String(settings.defaultMarkup)
    calcFailure = String(settings.failureRatePct)
    showToast('Stopnje shranjene')
    render()
  })

  const readPrinterFromRow = (row: Element) => {
    const name = (row.querySelector('[data-p="name"]') as HTMLInputElement).value.trim()
    const price = Number((row.querySelector('[data-p="price"]') as HTMLInputElement).value) || 0
    const lifeHours = Number((row.querySelector('[data-p="lifeHours"]') as HTMLInputElement).value) || 1
    const serviceCost = Number((row.querySelector('[data-p="serviceCost"]') as HTMLInputElement).value) || 0
    const energyKwhPerH =
      Number((row.querySelector('[data-p="energyKwhPerH"]') as HTMLInputElement).value) || 0
    return { name, price, lifeHours, serviceCost, energyKwhPerH }
  }

  app.querySelectorAll('[data-save-printer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number((btn as HTMLElement).dataset.savePrinter)
      const row = app.querySelector(`[data-printer-idx="${i}"]`)
      const p = settings.printers[i]
      if (!row || !p) return
      const vals = readPrinterFromRow(row)
      if (!vals.name) {
        showToast('Ime tiskalnika je obvezno')
        return
      }
      Object.assign(p, vals)
      persistSettings()
      showToast('Tiskalnik shranjen')
      render()
    })
  })

  app.querySelectorAll('[data-del-printer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number((btn as HTMLElement).dataset.delPrinter)
      if (settings.printers.length <= 1) {
        showToast('Vsaj en tiskalnik mora ostati')
        return
      }
      if (!confirm('Izbrišem ta tiskalnik?')) return
      const removed = settings.printers.splice(i, 1)[0]
      if (calcPrinter === removed?.id) calcPrinter = settings.printers[0]!.id
      persistSettings()
      showToast('Tiskalnik izbrisan')
      render()
    })
  })

  app.querySelector('#add-printer')?.addEventListener('click', () => {
    const name = (app.querySelector('#np-name') as HTMLInputElement).value.trim()
    if (!name) {
      showToast('Vnesi ime tiskalnika')
      return
    }
    const price = Number((app.querySelector('#np-price') as HTMLInputElement).value) || 0
    const lifeHours = Number((app.querySelector('#np-life') as HTMLInputElement).value) || 3000
    const serviceCost = Number((app.querySelector('#np-service') as HTMLInputElement).value) || 0
    const energyKwhPerH = Number((app.querySelector('#np-energy') as HTMLInputElement).value) || 0.2
    settings.printers.push({
      id: slugId('printer', name),
      name,
      price,
      lifeHours: Math.max(1, lifeHours),
      serviceCost,
      energyKwhPerH,
    })
    persistSettings()
    showToast('Tiskalnik dodan')
    render()
  })

  const readMaterialFromRow = (row: Element) => {
    const name = (row.querySelector('[data-m="name"]') as HTMLInputElement).value.trim()
    const category = (row.querySelector('[data-m="category"]') as HTMLSelectElement)
      .value as MaterialCategory
    let pricePerKg = Number((row.querySelector('[data-m="pricePerKg"]') as HTMLInputElement).value) || 0
    const spoolPriceRaw = (row.querySelector('[data-m="spoolPrice"]') as HTMLInputElement).value
    const spoolKgRaw = (row.querySelector('[data-m="spoolKg"]') as HTMLInputElement).value
    const spoolPrice = spoolPriceRaw === '' ? undefined : Number(spoolPriceRaw)
    const spoolKg = spoolKgRaw === '' ? undefined : Number(spoolKgRaw)
    if (
      spoolPrice != null &&
      Number.isFinite(spoolPrice) &&
      spoolKg != null &&
      Number.isFinite(spoolKg) &&
      spoolKg > 0
    ) {
      pricePerKg = pricePerKgFromSpool(spoolPrice, spoolKg)
    }
    return { name, category, pricePerKg, spoolPrice, spoolKg }
  }

  app.querySelectorAll('[data-save-material]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number((btn as HTMLElement).dataset.saveMaterial)
      const row = app.querySelector(`[data-material-idx="${i}"]`)
      const m = settings.materials[i]
      if (!row || !m) return
      const vals = readMaterialFromRow(row)
      if (!vals.name) {
        showToast('Ime materiala je obvezno')
        return
      }
      m.name = vals.name
      m.category = vals.category
      m.pricePerKg = vals.pricePerKg
      if (vals.spoolPrice != null && Number.isFinite(vals.spoolPrice)) m.spoolPrice = vals.spoolPrice
      else delete m.spoolPrice
      if (vals.spoolKg != null && Number.isFinite(vals.spoolKg) && vals.spoolKg > 0) m.spoolKg = vals.spoolKg
      else delete m.spoolKg
      persistSettings()
      showToast('Material shranjen')
      render()
    })
  })

  app.querySelectorAll('[data-del-material]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number((btn as HTMLElement).dataset.delMaterial)
      if (settings.materials.length <= 1) {
        showToast('Vsaj en material mora ostati')
        return
      }
      if (!confirm('Izbrišem ta material?')) return
      const removed = settings.materials.splice(i, 1)[0]
      if (calcMaterial === removed?.id) calcMaterial = settings.materials[0]!.id
      persistSettings()
      showToast('Material izbrisan')
      render()
    })
  })

  app.querySelector('#add-material')?.addEventListener('click', () => {
    const name = (app.querySelector('#nm-name') as HTMLInputElement).value.trim()
    if (!name) {
      showToast('Vnesi ime materiala')
      return
    }
    const category = (app.querySelector('#nm-cat') as HTMLSelectElement).value as MaterialCategory
    let pricePerKg = Number((app.querySelector('#nm-ppk') as HTMLInputElement).value) || 0
    const spoolPriceRaw = (app.querySelector('#nm-spool-price') as HTMLInputElement).value
    const spoolKgRaw = (app.querySelector('#nm-spool-kg') as HTMLInputElement).value
    const spoolPrice = spoolPriceRaw === '' ? undefined : Number(spoolPriceRaw)
    const spoolKg = spoolKgRaw === '' ? undefined : Number(spoolKgRaw)
    if (
      spoolPrice != null &&
      Number.isFinite(spoolPrice) &&
      spoolKg != null &&
      Number.isFinite(spoolKg) &&
      spoolKg > 0
    ) {
      pricePerKg = pricePerKgFromSpool(spoolPrice, spoolKg)
    }
    const mat: MaterialDef = {
      id: slugId('material', name),
      name,
      category,
      pricePerKg,
    }
    if (spoolPrice != null && Number.isFinite(spoolPrice)) mat.spoolPrice = spoolPrice
    if (spoolKg != null && Number.isFinite(spoolKg) && spoolKg > 0) mat.spoolKg = spoolKg
    settings.materials.push(mat)
    persistSettings()
    showToast('Material dodan')
    render()
  })

  app.querySelector('#reset-settings')?.addEventListener('click', () => {
    if (!confirm('Ponastavim vse nastavitve na Excel privzete?')) return
    settings = resetSettings()
    calcMarkup = String(settings.defaultMarkup)
    calcFailure = String(settings.failureRatePct)
    calcPrinter = settings.printers[0]?.id ?? calcPrinter
    showToast('Ponastavljeno na Excel')
    render()
  })
}


window.addEventListener('hashchange', handleHash)

void registerServiceWorker()
handleHash()
if (!showEditor) render()

console.info('[filament-hs-3d] sanity suggested ≈', sanitySuggested(settings).toFixed(2), '€')
