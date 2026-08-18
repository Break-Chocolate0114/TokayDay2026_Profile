import { useCallback, useEffect, useRef, useState } from 'react'
import { readTextFromNdefRecord } from '../lib/nfc'

type UseNfcScannerOptions = {
  onText: (text: string) => void
  onError: (message: string) => void
}

export function useNfcScanner({ onText, onError }: UseNfcScannerOptions) {
  const [isSupported] = useState(() => 'NDEFReader' in window)
  const [isScanning, setIsScanning] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const stop = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsScanning(false)
  }, [])

  const start = useCallback(async () => {
    if (!isSupported) {
      onError('この端末・ブラウザは Web NFC に対応していません。Android 版 Chrome でお試しください。')
      return
    }

    try {
      stop()
      const controller = new AbortController()
      abortControllerRef.current = controller
      const reader = new NDEFReader()
      reader.addEventListener('reading', (event) => {
        const text = event.message.records
          .map(readTextFromNdefRecord)
          .find((value): value is string => Boolean(value))
        if (!text) {
          onError('カードから URL を読み取れませんでした。NDEF の URL レコードを確認してください。')
          return
        }
        onText(text)
      })
      await reader.scan({ signal: controller.signal })
      setIsScanning(true)
    } catch (error) {
      // stop() による AbortError はユーザーへエラー表示しません。
      if (error instanceof DOMException && error.name === 'AbortError') return
      setIsScanning(false)
      onError('NFC の読み取りを開始できませんでした。HTTPS で開き、NFC の利用を許可してください。')
    }
  }, [isSupported, onError, onText, stop])

  useEffect(() => stop, [stop])

  return { isSupported, isScanning, start, stop }
}
