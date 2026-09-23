/**
 * Minimal CBOR decoder for OpenPrintTag maps (ints, floats, bytes, text, arrays, indefinite maps).
 * Enough for read-only field extraction; not a full CBOR suite.
 */

export type CborValue =
  | number
  | bigint
  | string
  | Uint8Array
  | CborValue[]
  | Map<CborValue, CborValue>
  | boolean
  | null
  | undefined

export function decodeCbor(bytes: Uint8Array, offset = 0): { value: CborValue; offset: number } {
  if (offset >= bytes.length) throw new Error('CBOR: prazno')
  const ib = bytes[offset]!
  const major = ib >> 5
  const additional = ib & 0x1f
  let pos = offset + 1

  const readLen = (): number | bigint => {
    if (additional < 24) return additional
    if (additional === 24) {
      if (pos >= bytes.length) throw new Error('CBOR: EOF')
      return bytes[pos++]!
    }
    if (additional === 25) {
      if (pos + 1 >= bytes.length) throw new Error('CBOR: EOF')
      const v = (bytes[pos]! << 8) | bytes[pos + 1]!
      pos += 2
      return v
    }
    if (additional === 26) {
      if (pos + 3 >= bytes.length) throw new Error('CBOR: EOF')
      const v =
        ((bytes[pos]! << 24) >>> 0) +
        (bytes[pos + 1]! << 16) +
        (bytes[pos + 2]! << 8) +
        bytes[pos + 3]!
      pos += 4
      return v >>> 0
    }
    if (additional === 27) {
      if (pos + 7 >= bytes.length) throw new Error('CBOR: EOF')
      let v = 0n
      for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(bytes[pos + i]!)
      pos += 8
      return v
    }
    throw new Error(`CBOR: nepodprta dolžina ${additional}`)
  }

  const asNumber = (n: number | bigint): number => (typeof n === 'bigint' ? Number(n) : n)

  if (major === 0) {
    const n = readLen()
    return { value: typeof n === 'bigint' && n > BigInt(Number.MAX_SAFE_INTEGER) ? n : asNumber(n), offset: pos }
  }
  if (major === 1) {
    const n = readLen()
    if (typeof n === 'bigint') return { value: -1n - n, offset: pos }
    return { value: -1 - n, offset: pos }
  }
  if (major === 2) {
    if (additional === 31) throw new Error('CBOR: indefinite bytes')
    const len = asNumber(readLen())
    const slice = bytes.slice(pos, pos + len)
    pos += len
    return { value: slice, offset: pos }
  }
  if (major === 3) {
    if (additional === 31) throw new Error('CBOR: indefinite text')
    const len = asNumber(readLen())
    const slice = bytes.slice(pos, pos + len)
    pos += len
    return { value: new TextDecoder().decode(slice), offset: pos }
  }
  if (major === 4) {
    if (additional === 31) {
      const arr: CborValue[] = []
      while (bytes[pos] !== 0xff) {
        const item = decodeCbor(bytes, pos)
        arr.push(item.value)
        pos = item.offset
      }
      return { value: arr, offset: pos + 1 }
    }
    const len = asNumber(readLen())
    const arr: CborValue[] = []
    for (let i = 0; i < len; i++) {
      const item = decodeCbor(bytes, pos)
      arr.push(item.value)
      pos = item.offset
    }
    return { value: arr, offset: pos }
  }
  if (major === 5) {
    const map = new Map<CborValue, CborValue>()
    if (additional === 31) {
      while (bytes[pos] !== 0xff) {
        const k = decodeCbor(bytes, pos)
        pos = k.offset
        const v = decodeCbor(bytes, pos)
        pos = v.offset
        map.set(k.value, v.value)
      }
      return { value: map, offset: pos + 1 }
    }
    const len = asNumber(readLen())
    for (let i = 0; i < len; i++) {
      const k = decodeCbor(bytes, pos)
      pos = k.offset
      const v = decodeCbor(bytes, pos)
      pos = v.offset
      map.set(k.value, v.value)
    }
    return { value: map, offset: pos }
  }
  if (major === 7) {
    if (additional === 20) return { value: false, offset: pos }
    if (additional === 21) return { value: true, offset: pos }
    if (additional === 22) return { value: null, offset: pos }
    if (additional === 23) return { value: undefined, offset: pos }
    if (additional === 25) {
      const u = (bytes[pos]! << 8) | bytes[pos + 1]!
      pos += 2
      return { value: decodeHalf(u), offset: pos }
    }
    if (additional === 26) {
      const buf = new ArrayBuffer(4)
      const view = new DataView(buf)
      view.setUint8(0, bytes[pos]!)
      view.setUint8(1, bytes[pos + 1]!)
      view.setUint8(2, bytes[pos + 2]!)
      view.setUint8(3, bytes[pos + 3]!)
      pos += 4
      return { value: view.getFloat32(0, false), offset: pos }
    }
    if (additional === 27) {
      const buf = new ArrayBuffer(8)
      const view = new DataView(buf)
      for (let i = 0; i < 8; i++) view.setUint8(i, bytes[pos + i]!)
      pos += 8
      return { value: view.getFloat64(0, false), offset: pos }
    }
  }
  throw new Error(`CBOR: nepodprt major ${major}`)
}

function decodeHalf(u: number): number {
  const exp = (u >> 10) & 0x1f
  const frac = u & 0x3ff
  const sign = u & 0x8000 ? -1 : 1
  if (exp === 0) return sign * (frac / 1024) * 2 ** -14
  if (exp === 31) return frac ? NaN : sign * Infinity
  return sign * (1 + frac / 1024) * 2 ** (exp - 15)
}

export function mapGetNumber(map: Map<CborValue, CborValue>, key: number): number | undefined {
  const v = map.get(key)
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  return undefined
}

export function mapGetString(map: Map<CborValue, CborValue>, key: number): string | undefined {
  const v = map.get(key)
  return typeof v === 'string' ? v : undefined
}

export function mapGetBytes(map: Map<CborValue, CborValue>, key: number): Uint8Array | undefined {
  const v = map.get(key)
  return v instanceof Uint8Array ? v : undefined
}
