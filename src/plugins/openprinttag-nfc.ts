import { Capacitor, registerPlugin } from '@capacitor/core'

export interface OpenPrintTagNfcScanResult {
  uidHex: string
  /** Base64 of OpenPrintTag NDEF payload (CBOR meta+main+aux regions) */
  payloadBase64: string
  mimeType: string
  tech: string
}

export interface OpenPrintTagNfcPlugin {
  isAvailable(): Promise<{ available: boolean; nfcEnabled: boolean }>
  /** Scan until timeoutMs; resolves with first OPT payload or rejects */
  scan(options?: { timeoutMs?: number }): Promise<OpenPrintTagNfcScanResult>
  cancel(): Promise<void>
}

const OpenPrintTagNfc = registerPlugin<OpenPrintTagNfcPlugin>('OpenPrintTagNfc', {
  web: () => ({
    async isAvailable() {
      return { available: false, nfcEnabled: false }
    },
    async scan() {
      throw new Error('OpenPrintTag NFC-V je na voljo samo v Android aplikaciji.')
    },
    async cancel() {},
  }),
})

export function isNativeCapacitor(): boolean {
  return Capacitor.isNativePlatform()
}

export function isAndroidNative(): boolean {
  return Capacitor.getPlatform() === 'android'
}

export default OpenPrintTagNfc
