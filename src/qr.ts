import jsQR from 'jsqr'
import QRCode from 'qrcode'

export async function decodeQrFromFile(file: File): Promise<string | null> {
  const bmp = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  const max = 1280
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  canvas.width = Math.max(1, Math.round(bmp.width * scale))
  canvas.height = Math.max(1, Math.round(bmp.height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth',
  })
  return code?.data ?? null
}

export function decodeQrFromVideo(video: HTMLVideoElement): string | null {
  if (!video.videoWidth || !video.videoHeight) return null
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(video, 0, 0)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth',
  })
  return code?.data ?? null
}

export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  })
  video.srcObject = stream
  await video.play()
  return stream
}

export function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop())
}

export async function renderQrToCanvas(
  canvas: HTMLCanvasElement,
  text: string,
  size = 220,
): Promise<void> {
  await QRCode.toCanvas(canvas, text, {
    width: size,
    margin: 2,
    color: { dark: '#1b2430', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  })
}

/** Parse spool id from URL hash, absolute URL, or plain text. */
export function parseSpoolPayload(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null

  const spoolColon = text.match(/^spool:([A-Za-z0-9._-]+)$/i)
  if (spoolColon?.[1]) return spoolColon[1]

  try {
    const url = new URL(text, location.origin)
    const hash = url.hash.replace(/^#/, '')
    const m = hash.match(/^spool\/([A-Za-z0-9._-]+)/i)
    if (m?.[1]) return m[1]
  } catch {
    /* ignore */
  }

  const hashOnly = text.match(/#spool\/([A-Za-z0-9._-]+)/i)
  if (hashOnly?.[1]) return hashOnly[1]

  const pathOnly = text.match(/^spool\/([A-Za-z0-9._-]+)$/i)
  if (pathOnly?.[1]) return pathOnly[1]

  return null
}

export function spoolDeepLink(spoolId: string): string {
  const base = location.origin + location.pathname.replace(/\/?$/, '/')
  return `${base}#spool/${spoolId}`
}

export function spoolAbsoluteLink(spoolId: string, pagesBase: string): string {
  const base = pagesBase.replace(/\/?$/, '/')
  return `${base}#spool/${spoolId}`
}
