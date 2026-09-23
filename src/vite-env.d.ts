/// <reference types="vite/client" />

interface NDEFReadingEvent extends Event {
  message: NDEFMessage
  serialNumber: string
}

interface NDEFMessage {
  records: NDEFRecord[]
}

interface NDEFRecord {
  recordType: string
  mediaType?: string
  data?: DataView
  encoding?: string
  lang?: string
}

interface NDEFReader {
  scan: (options?: { signal?: AbortSignal }) => Promise<void>
  write: (
    message: string | { records: Array<{ recordType: string; data: string }> },
  ) => Promise<void>
  addEventListener: (
    type: 'reading' | 'readingerror',
    listener: (ev: NDEFReadingEvent | Event) => void,
  ) => void
  removeEventListener: (
    type: 'reading' | 'readingerror',
    listener: (ev: NDEFReadingEvent | Event) => void,
  ) => void
}

interface Window {
  NDEFReader?: new () => NDEFReader
}
