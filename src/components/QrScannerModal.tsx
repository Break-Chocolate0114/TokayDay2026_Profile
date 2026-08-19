import { useCallback, useEffect, useState } from 'react'
import { useQrScanner } from '../hooks/useQrScanner'

type QrScannerModalProps = {
  title: string
  description: string
  onClose: () => void
  onRead: (rawValue: string) => Promise<{ ok: boolean; message: string }>
}

export default function QrScannerModal({ title, description, onClose, onRead }: QrScannerModalProps) {
  const [message, setMessage] = useState('カメラを準備しています…')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleRead = useCallback(async (rawValue: string) => {
    setIsSubmitting(true)
    const result = await onRead(rawValue)
    setMessage(result.message)
    setIsSubmitting(false)
    if (result.ok) window.setTimeout(onClose, 700)
  }, [onClose, onRead])

  const { videoRef, isScanning, start, stop } = useQrScanner({
    onRead: handleRead,
    onError: setMessage,
  })

  useEffect(() => { void start() }, [start])

  const close = () => {
    stop()
    onClose()
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={close}>
      <section className="qr-scanner-modal" role="dialog" aria-modal="true" aria-labelledby="qr-scanner-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" type="button" onClick={close} aria-label="QR読み取りを閉じる">×</button>
        <p className="modal-kicker">CAMERA SCAN</p>
        <h2 id="qr-scanner-title">{title}</h2>
        <p className="qr-description">{description}</p>
        <div className="camera-view">
          <video ref={videoRef} autoPlay playsInline muted aria-label="QRコード読み取り用カメラ" />
          <span className="camera-corners" aria-hidden="true" />
        </div>
        <p className={`qr-scan-message ${isSubmitting ? 'is-working' : ''}`} role="status">
          {isSubmitting ? '確認しています…' : isScanning ? 'QRコードを枠に合わせてね' : message}
        </p>
        {!isScanning && !isSubmitting && <button className="secondary-button" type="button" onClick={() => void start()}>もう一度カメラを開く</button>}
      </section>
    </div>
  )
}
