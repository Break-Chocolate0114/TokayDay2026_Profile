type EventAccessGateProps = {
  message?: string
}

export default function EventAccessGate({ message }: EventAccessGateProps) {
  return (
    <main className="app-shell event-access-shell">
      <section className="event-access-card" role="dialog" aria-modal="true" aria-labelledby="event-access-title">
        <p className="modal-kicker">TOKAI NO HI 2026</p>
        <h1 id="event-access-title">プロフィール帳へ<br /><span>ようこそ！</span></h1>
        <p>会場にある<span>入場QR</span>を、スマホ標準カメラで読み取って開いてね。</p>
        <p className="event-access-note">QRを開くと、このスマホだけにイベント参加用の入場権が登録されます。</p>
        {message && <p className="setup-message" role="alert">{message}</p>}
      </section>
    </main>
  )
}
