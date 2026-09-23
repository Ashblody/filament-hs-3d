import {
  formatOptSummary,
  isOpenPrintTagMime,
  parseOpenPrintTagPayload,
  type OpenPrintTagFields,
} from './openprinttag.ts'
import { parseSpoolPayload } from './qr.ts'

export function isNfcSupported(): boolean {
  return typeof window !== 'undefined' && 'NDEFReader' in window
}

export type NfcReadKind = 'spool' | 'openprinttag' | 'empty' | 'unknown'

export interface NfcReadResult {
  serialNumber: string
  kind: NfcReadKind
  /** Spool id when kind === 'spool' */
  spoolId?: string
  /** Parsed OPT fields when kind === 'openprinttag' */
  openPrintTag?: OpenPrintTagFields
  /** Human-readable texts / URLs found on the tag */
  texts: string[]
  /** Short Slovenian summary for UI */
  summary: string
}

export class NfcUserError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'unsupported'
      | 'permission'
      | 'abort'
      | 'read_error'
      | 'empty'
      | 'unknown_format'
      | 'timeout'
      | 'generic',
  ) {
    super(message)
    this.name = 'NfcUserError'
  }
}

const SCAN_TIMEOUT_MS = 25_000

export async function readNfcOnce(signal?: AbortSignal): Promise<NfcReadResult> {
  if (!window.NDEFReader) {
    throw new NfcUserError(
      'NFC ni podprt v tem brskalniku. Uporabi Chrome na Androidu (HTTPS).',
      'unsupported',
    )
  }

  const reader = new window.NDEFReader()
  const localAbort = new AbortController()
  const onOuterAbort = () => localAbort.abort()
  signal?.addEventListener('abort', onOuterAbort)

  const timeoutId = window.setTimeout(() => localAbort.abort(), SCAN_TIMEOUT_MS)

  try {
    return await new Promise<NfcReadResult>((resolve, reject) => {
      const onAbort = () => {
        cleanup()
        if (signal?.aborted) {
          reject(new NfcUserError('Prekinjeno', 'abort'))
        } else {
          reject(
            new NfcUserError(
              'Ni oznake v času. Če gre za Prusament/OpenPrintTag (ISO 15693), brskalnik ga ne vidi — glej razlago spodaj. Za naše NTAG oznake poskusi znova.',
              'timeout',
            ),
          )
        }
      }
      const onReading = (ev: Event) => {
        const e = ev as NDEFReadingEvent
        cleanup()
        resolve(interpretNdefMessage(e.message, e.serialNumber || ''))
      }
      const onError = () => {
        cleanup()
        reject(
          new NfcUserError(
            'Oznake ni mogoče prebrati (ni NDEF ali poškodovana). To je lahko tudi OpenPrintTag / ISO 15693 — Web NFC ga ne podpira.',
            'read_error',
          ),
        )
      }
      const cleanup = () => {
        window.clearTimeout(timeoutId)
        signal?.removeEventListener('abort', onOuterAbort)
        localAbort.signal.removeEventListener('abort', onAbort)
        reader.removeEventListener('reading', onReading)
        reader.removeEventListener('readingerror', onError)
      }
      localAbort.signal.addEventListener('abort', onAbort)
      reader.addEventListener('reading', onReading)
      reader.addEventListener('readingerror', onError)
      reader.scan({ signal: localAbort.signal }).catch((err: unknown) => {
        cleanup()
        reject(mapScanError(err))
      })
    })
  } finally {
    window.clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onOuterAbort)
  }
}

export async function writeNfcUrl(url: string): Promise<void> {
  if (!window.NDEFReader) {
    throw new NfcUserError(
      'NFC ni podprt v tem brskalniku. Uporabi Chrome na Androidu.',
      'unsupported',
    )
  }
  const reader = new window.NDEFReader()
  try {
    await reader.write({
      records: [{ recordType: 'url', data: url }],
    })
  } catch (err) {
    throw mapScanError(err)
  }
}

function mapScanError(err: unknown): NfcUserError {
  if (err instanceof NfcUserError) return err
  if (err instanceof DOMException) {
    if (err.name === 'AbortError') return new NfcUserError('Prekinjeno', 'abort')
    if (err.name === 'NotAllowedError') {
      return new NfcUserError(
        'Dovoljenje za NFC zavrnjeno. V Chrome dovoli NFC za to stran in poskusi znova (tapni gumb).',
        'permission',
      )
    }
    if (err.name === 'NotSupportedError') {
      return new NfcUserError(
        'NFC ni podprt na tej napravi. Potreben je Android telefon z NFC in Chrome.',
        'unsupported',
      )
    }
    if (err.name === 'NotReadableError') {
      return new NfcUserError(
        'Oznake ni mogoče prebrati. Preveri, da je NDEF (NTAG). OpenPrintTag ISO 15693 brskalnik ne vidi.',
        'read_error',
      )
    }
    return new NfcUserError(err.message || 'Napaka NFC', 'generic')
  }
  if (err instanceof Error) return new NfcUserError(err.message || 'Napaka NFC', 'generic')
  return new NfcUserError('Neznana napaka NFC', 'generic')
}

export function interpretNdefMessage(message: NDEFMessage, serialNumber: string): NfcReadResult {
  const texts: string[] = []
  let openPrintTag: OpenPrintTagFields | undefined
  let emptyOnly = message.records.length === 0

  for (const record of message.records) {
    if (record.recordType === 'empty') {
      emptyOnly = emptyOnly || message.records.length === 1
      continue
    }
    emptyOnly = false

    if (isOpenPrintTagMime(record.mediaType) || record.recordType === 'mime') {
      if (isOpenPrintTagMime(record.mediaType) && record.data) {
        const bytes = dataViewToBytes(record.data)
        const parsed = parseOpenPrintTagPayload(bytes)
        if (parsed) {
          openPrintTag = parsed
          texts.push(formatOptSummary(parsed))
          continue
        }
      }
    }

    if (!record.data) continue

    if (record.recordType === 'text') {
      texts.push(decodeTextRecord(record))
    } else if (record.recordType === 'url') {
      texts.push(decodeUrlRecord(record))
    } else if (record.recordType === 'absolute-url') {
      texts.push(new TextDecoder().decode(record.data))
    } else if (record.recordType === 'smart-poster') {
      /* ignore nested for now */
    }
  }

  if (openPrintTag) {
    return {
      serialNumber,
      kind: 'openprinttag',
      openPrintTag,
      texts,
      summary: formatOptSummary(openPrintTag),
    }
  }

  for (const t of texts) {
    const id = parseSpoolPayload(t)
    if (id) {
      return {
        serialNumber,
        kind: 'spool',
        spoolId: id,
        texts,
        summary: `Tuljava ${id}`,
      }
    }
  }

  if (emptyOnly || (texts.length === 0 && message.records.every((r) => r.recordType === 'empty'))) {
    return {
      serialNumber,
      kind: 'empty',
      texts,
      summary: 'Prazna NFC oznaka (brez NDEF vsebine)',
    }
  }

  return {
    serialNumber,
    kind: 'unknown',
    texts,
    summary:
      texts.length > 0
        ? `Neprepoznana vsebina: ${texts[0]!.slice(0, 80)}`
        : 'Oznaka nima URL/besedila za tuljavo (#spool/… ali spool:id)',
  }
}

function dataViewToBytes(data: DataView): Uint8Array {
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

function decodeTextRecord(record: NDEFRecord): string {
  const bytes = dataViewToBytes(record.data!)
  const status = bytes[0] ?? 0
  const langLen = status & 0x3f
  const encoding = status & 0x80 ? 'utf-16' : 'utf-8'
  return new TextDecoder(encoding).decode(bytes.slice(1 + langLen))
}

function decodeUrlRecord(record: NDEFRecord): string {
  const bytes = dataViewToBytes(record.data!)
  const prefixCode = bytes[0] ?? 0
  const prefixes = [
    '',
    'http://www.',
    'https://www.',
    'http://',
    'https://',
    'tel:',
    'mailto:',
    'ftp://anonymous:anonymous@',
    'ftp://ftp.',
    'ftps://',
    'sftp://',
    'smb://',
    'nfs://',
    'ftp://',
    'dav://',
    'news:',
    'telnet://',
    'imap:',
    'rtsp://',
    'urn:',
    'pop:',
    'sip:',
    'sips:',
    'tftp:',
    'btspp://',
    'btl2cap://',
    'btgoep://',
    'tcpobex://',
    'irdaobex://',
    'file://',
    'urn:epc:id:',
    'urn:epc:tag:',
    'urn:epc:pat:',
    'urn:epc:raw:',
    'urn:epc:',
    'urn:nfc:',
  ]
  const prefix = prefixes[prefixCode] ?? ''
  return prefix + new TextDecoder().decode(bytes.slice(1))
}

/** Build NfcReadResult from native OpenPrintTag NFC-V bridge payload. */
export function resultFromOpenPrintTagBytes(
  payload: Uint8Array,
  serialNumber: string,
): NfcReadResult {
  const openPrintTag = parseOpenPrintTagPayload(payload)
  if (!openPrintTag) {
    throw new NfcUserError(
      'Oznaka je NFC-V, a OpenPrintTag CBOR ni prepoznan.',
      'unknown_format',
    )
  }
  return {
    serialNumber,
    kind: 'openprinttag',
    openPrintTag,
    texts: [formatOptSummary(openPrintTag)],
    summary: formatOptSummary(openPrintTag),
  }
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
