import './style.css'
import {
  APP_PAGES_URL,
  DEFAULT_FAILURE_RATE,
  DEFAULT_FULL_SPOOL_G,
  DEFAULT_MARKUP,
  DEFAULT_POST_MIN,
  DEFAULT_PREP_MIN,
  MATERIAL_CATEGORIES,
  MATERIALS,
  PRINTERS,
  findMaterial,
  formatEuro,
  formatGrams,
  gramsFromPercent,
  parsePrintHours,
  percentFromGrams,
} from './data.ts'
import { calculatePrice, sanitySuggested } from './calc.ts'
import {
  isNfcSupported,
  NfcUserError,
  readNfcOnce,
  writeNfcUrl,
  type NfcReadResult,
} from './nfc.ts'
import { mapOptMaterialToCategory } from './openprinttag.ts'
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
  escapeHtml,
  formatDateTime,
  loadData,
  registerServiceWorker,
  saveData,
  uid,
} from './storage.ts'
import type { AppData, MaterialCategory, Spool, TabId } from './types.ts'

const app = document.querySelector<HTMLDivElement>('#app')!

let data: AppData = loadData()
let tab: TabId = 'zaloga'
let materialFilter: MaterialCategory | 'vse' = 'vse'
let editingId: string | null = null
let showEditor = false
let toastTimer: number | undefined
let cameraStream: MediaStream | null = null
let scanLoop = 0
let nfcAbort: AbortController | null = null

// Calculator state
let calcPrinter = PRINTERS[0]!.id
let calcMaterial = 'trcek-pla'
let calcWeight = '61.46'
let calcTime = '3:46'
let calcPrep = String(DEFAULT_PREP_MIN)
let calcPost = String(DEFAULT_POST_MIN)
let calcConsumables = '0'
let calcMarkup = String(DEFAULT_MARKUP)
let calcFailure = String(DEFAULT_FAILURE_RATE)

function persist() {
  saveData(data)
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
    entry.colors.add(s.color.trim().toLowerCase() || '?')
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

function filteredSpools(): Spool[] {
  let list = [...data.spools]
  if (materialFilter !== 'vse') {
    list = list.filter((s) => s.material === materialFilter)
  }
  return list.sort((a, b) => a.material.localeCompare(b.material, 'sl') || a.color.localeCompare(b.color, 'sl'))
}

function emptySpool(): Spool {
  const now = new Date().toISOString()
  return {
    id: uid('spool'),
    material: 'PLA',
    color: '',
    brandName: 'PLASTIKA TRCEK PLA',
    remainingGrams: DEFAULT_FULL_SPOOL_G,
    fullSpoolGrams: DEFAULT_FULL_SPOOL_G,
    pricePerKg: 21,
    notes: '',
    createdAt: now,
    updatedAt: now,
  }
}

function renderHeader() {
  return `
    <header class="app-header">
      <div>
        <h1>Filament / HS 3D</h1>
        <div class="sub">Zaloga · NFC/QR · Kalkulator</div>
      </div>
    </header>
  `
}

function renderTabs() {
  const items: Array<{ id: TabId; label: string; ico: string }> = [
    { id: 'zaloga', label: 'Zaloga', ico: '🧵' },
    { id: 'nfc', label: 'NFC', ico: '📲' },
    { id: 'kalkulator', label: 'Kalkulator', ico: '🧮' },
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
  const list = filteredSpools()
  return `
    <section class="card">
      <div class="row-between">
        <h2>Zaloga tuljav</h2>
        <button type="button" class="btn btn-primary btn-sm" id="add-spool">+ Nova</button>
      </div>
      <p class="hint">Podatki so shranjeni lokalno na telefonu (localStorage).</p>
      <div class="summary-chips">
        <button type="button" class="chip ${materialFilter === 'vse' ? 'active' : ''}" data-filter="vse">
          Vse (${data.spools.length})
        </button>
        ${summary
          .map(
            (s) => `
          <button type="button" class="chip ${materialFilter === s.material ? 'active' : ''}" data-filter="${escapeHtml(s.material)}">
            ${escapeHtml(s.material)}: ${s.colors} barv · ${s.count}× · ${formatGrams(s.grams)}
          </button>`,
          )
          .join('')}
      </div>
      ${
        list.length === 0
          ? `<div class="empty">Ni tuljav. Dodaj novo ali počisti filter.</div>`
          : `<div class="spool-list">
          ${list
            .map((s) => {
              const pct = percentFromGrams(s.remainingGrams, s.fullSpoolGrams || DEFAULT_FULL_SPOOL_G)
              return `
              <button type="button" class="spool-item" data-open="${escapeHtml(s.id)}">
                <div>
                  <div class="title">${escapeHtml(s.material)} · ${escapeHtml(s.color || 'brez barve')}</div>
                  <div class="meta">${escapeHtml(s.brandName)} · ${s.pricePerKg.toFixed(2)} €/kg${s.nfcTagId ? ' · NFC' : ''}</div>
                  <div class="bar"><span style="width:${pct.toFixed(0)}%"></span></div>
                </div>
                <div class="amt">${formatGrams(s.remainingGrams)}<br><span style="font-size:0.75rem;font-weight:600;color:var(--muted)">${pct.toFixed(0)} %</span></div>
              </button>`
            })
            .join('')}
        </div>`
      }
    </section>
  `
}

function renderEditorModal() {
  if (!showEditor) return ''
  const spool = editingId
    ? data.spools.find((s) => s.id === editingId)
    : null
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
            <div class="field inline">
              <label for="f-color">Barva</label>
              <input id="f-color" name="color" value="${escapeHtml(s.color)}" required placeholder="npr. Črna" />
            </div>
          </div>
          <div class="field">
            <label for="f-brand">Znamka / ime</label>
            <input id="f-brand" name="brandName" list="material-names" value="${escapeHtml(s.brandName)}" placeholder="PLASTIKA TRCEK PLA" />
            <datalist id="material-names">
              ${MATERIALS.map((m) => `<option value="${escapeHtml(m.name)}"></option>`).join('')}
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
              <code style="font-size:0.7rem;word-break:break-all">${escapeHtml(link)}</code>
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
    showToast('OpenPrintTag (NDEF) → tuljava')
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
    'Uvoženo iz OpenPrintTag (NDEF MIME).',
    f.materialName ? `Material: ${f.materialName}` : '',
    f.materialTypeAbbrev ? `Tip: ${f.materialTypeAbbrev}` : '',
    f.purchasePrice != null
      ? `Cena: ${f.purchasePrice}${f.purchaseCurrency ? ' ' + f.purchaseCurrency : ''}`
      : '',
    'Tovarniški Prusament SLIX2 (ISO 15693) Web NFC ne vidi — ta uvoz deluje samo, če je OPT na NTAG.',
  ].filter(Boolean)

  const now = new Date().toISOString()
  if (existing) {
    existing.material = material
    existing.color = color
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
      <div class="note warn">
        Tovarniške <strong>Prusament / OpenPrintTag</strong> oznake so <strong>ISO 15693 (NFC-V, ICODE SLIX2)</strong>.
        <strong>Chrome Web NFC jih ne more prebrati</strong> — samo NFC-A / NTAG z NDEF.
      </div>
      <p class="hint" style="margin-top:8px">
        Za branje OpenPrintTag uporabi nativno aplikacijo
        (<a href="https://openprinttag.org" target="_blank" rel="noopener">openprinttag.org</a>,
        Prusa NFC Reader, NFC Tools, SimplyPrint), nato tuljavo <strong>ročno vnesi v Zalogo</strong>.
        Ne piši našega URL-ja čez OpenPrintTag oznako — lahko pokvariš kompatibilnost.
      </p>
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
      <ol style="margin:0;padding-left:1.2rem;font-size:0.9rem;color:var(--muted)">
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
  const result = calculatePrice({
    printerId: calcPrinter,
    materialId: calcMaterial,
    weightG: Number(calcWeight) || 0,
    printHours: hours,
    prepMin: Number(calcPrep) || 0,
    postMin: Number(calcPost) || 0,
    consumables: Number(calcConsumables) || 0,
    markup: Number(calcMarkup) || DEFAULT_MARKUP,
    failureRate: Number(calcFailure) || 0,
  })
  const mat = findMaterial(calcMaterial)

  return `
    <section class="card">
      <h2>Kalkulator 3D tiska</h2>
      <p class="hint">Formule iz HS Pricing Sheet. Energija 0,20 €/kWh · delo 20 €/h.</p>
      <div class="field">
        <label for="c-printer">Tiskalnik</label>
        <select id="c-printer">
          ${PRINTERS.map(
            (p) =>
              `<option value="${p.id}" ${calcPrinter === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`,
          ).join('')}
        </select>
      </div>
      <div class="field">
        <label for="c-material">Filament</label>
        <select id="c-material">
          ${MATERIALS.map(
            (m) =>
              `<option value="${m.id}" ${calcMaterial === m.id ? 'selected' : ''}>${escapeHtml(m.name)} (${m.pricePerKg.toFixed(2)} €/kg)</option>`,
          ).join('')}
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

function render() {
  stopScan()
  app.innerHTML =
    renderHeader() +
    (tab === 'zaloga' ? renderZaloga() : tab === 'nfc' ? renderNfc() : renderKalkulator()) +
    renderTabs() +
    renderEditorModal()
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

  app.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const f = (btn as HTMLElement).dataset.filter!
      materialFilter = f === 'vse' ? 'vse' : (f as MaterialCategory)
      render()
    })
  })

  app.querySelectorAll('[data-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openSpool((btn as HTMLElement).dataset.open!)
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
      const match = MATERIALS.find((m) => m.name === brandEl.value)
      if (match) {
        priceEl.value = String(Number(match.pricePerKg.toFixed(4)))
        const matSelect = form.querySelector<HTMLSelectElement>('#f-material')!
        matSelect.value = match.category
      }
    })

    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const now = new Date().toISOString()
      const existing = editingId ? data.spools.find((s) => s.id === editingId) : null
      const spool: Spool = {
        id: existing?.id ?? uid('spool'),
        material: (form.querySelector('#f-material') as HTMLSelectElement).value as MaterialCategory,
        color: (form.querySelector('#f-color') as HTMLInputElement).value.trim(),
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

  // NFC tab — scan must start from this button tap (user gesture)
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
      app.querySelector(`#${id}`)?.addEventListener('input', () => {
        // live update on blur/change only for selects; for numbers re-render on change
      })
    },
  )

  // Live recalc on input for number fields without full remount thrash — re-render on change is fine for mobile
  ;['c-weight', 'c-time', 'c-prep', 'c-post', 'c-cons', 'c-markup', 'c-fail'].forEach((id) => {
    app.querySelector(`#${id}`)?.addEventListener('change', () => {
      syncCalc()
      render()
    })
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
    showToast(`Vzorec → ${formatEuro(sanitySuggested())}`)
  })
}

window.addEventListener('hashchange', handleHash)

void registerServiceWorker()
handleHash()
if (!showEditor) render()

console.info('[filament-hs-3d] sanity suggested ≈', sanitySuggested().toFixed(2), '€')
