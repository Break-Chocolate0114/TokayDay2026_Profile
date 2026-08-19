import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser'
import { useCallback, useEffect, useRef, useState } from 'react'

type UseQrScannerOptions = {
  onRead: (rawValue: string) => void
  onError: (message: string) => void
}

/** iPhone Safari を含む、カメラの getUserMedia に対応したブラウザ用QRスキャナーです。 */
export function useQrScanner({ onRead, onError }: UseQrScannerOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const handledRef = useRef(false)
  const [isScanning, setIsScanning] = useState(false)

  const stop = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
    setIsScanning(false)
  }, [])

  const start = useCallback(async () => {
    const video = videoRef.current
    if (!video || !navigator.mediaDevices?.getUserMedia) {
      onError('このブラウザではカメラを利用できません。Safari または Chrome を最新にしてください。')
      return
    }

    try {
      stop()
      handledRef.current = false
      const reader = new BrowserQRCodeReader()
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } },
        video,
        (result) => {
          if (!result || handledRef.current) return
          handledRef.current = true
          controlsRef.current?.stop()
          controlsRef.current = null
          setIsScanning(false)
          onRead(result.getText())
        },
      )
      controlsRef.current = controls
      setIsScanning(true)
    } catch {
      setIsScanning(false)
      onError('カメラを開始できませんでした。HTTPSで開き、カメラの利用を許可してください。')
    }
  }, [onError, onRead, stop])

  useEffect(() => stop, [stop])

  return { videoRef, isScanning, start, stop }
}
