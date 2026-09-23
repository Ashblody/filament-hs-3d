export function isNfcSupported(): boolean {
  return typeof window !== 'undefined' && 'NDEFReader' in window
}

export async function readNfcOnce(
  signal?: AbortSignal,
): Promise<{ serialNumber: string; texts: string[] }> {
  if (!window.NDEFReader) throw new Error('NFC ni podprt')
  const reader = new window.NDEFReader()
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(new DOMException('Prekinjeno', 'AbortError'))
    }
    const onReading = (ev: Event) => {
      const e = ev as NDEFReadingEvent
      const texts = decodeNdefTexts(e.message)
      cleanup()
      resolve({ serialNumber: e.serialNumber || '', texts })
    }
    const onError = () => {
      cleanup()
      reject(new Error('Napaka pri branju NFC'))
    }
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
      reader.removeEventListener('reading', onReading)
      reader.removeEventListener('readingerror', onError)
    }
    signal?.addEventListener('abort', onAbort)
    reader.addEventListener('reading', onReading)
    reader.addEventListener('readingerror', onError)
    reader.scan({ signal }).catch((err: unknown) => {
      cleanup()
      reject(err)
    })
  })
}

export async function writeNfcUrl(url: string): Promise<void> {
  if (!window.NDEFReader) throw new Error('NFC ni podprt')
  const reader = new window.NDEFReader()
  await reader.write({
    records: [{ recordType: 'url', data: url }],
  })
}

function decodeNdefTexts(message: NDEFMessage): string[] {
  const out: string[] = []
  for (const record of message.records) {
    if (!record.data) continue
    if (record.recordType === 'text') {
      out.push(decodeTextRecord(record))
    } else if (record.recordType === 'url') {
      out.push(decodeUrlRecord(record))
    } else if (record.recordType === 'absolute-url') {
      out.push(new TextDecoder().decode(record.data))
    }
  }
  return out
}

function decodeTextRecord(record: NDEFRecord): string {
  const bytes = new Uint8Array(record.data!.buffer, record.data!.byteOffset, record.data!.byteLength)
  const status = bytes[0] ?? 0
  const langLen = status & 0x3f
  const encoding = status & 0x80 ? 'utf-16' : 'utf-8'
  return new TextDecoder(encoding).decode(bytes.slice(1 + langLen))
}

function decodeUrlRecord(record: NDEFRecord): string {
  const bytes = new Uint8Array(record.data!.buffer, record.data!.byteOffset, record.data!.byteLength)
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
