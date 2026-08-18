// Web NFC の TypeScript 定義は標準 lib.dom に未収録のため、必要な範囲だけ定義しています。
declare class NDEFReader {
  scan(options?: { signal?: AbortSignal }): Promise<void>
  addEventListener(type: 'reading', listener: (event: NDEFReadingEvent) => void): void
}

declare interface NDEFReadingEvent extends Event {
  serialNumber: string
  message: NDEFMessage
}

declare interface NDEFMessage {
  records: NDEFRecord[]
}

declare interface NDEFRecord {
  recordType: string
  mediaType?: string
  id?: string
  data?: DataView | ArrayBuffer | null
}
