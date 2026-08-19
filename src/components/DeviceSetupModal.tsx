import { useState } from 'react'
import type { Mentor } from '../types'

type DeviceSetupModalProps = {
  mentors: Mentor[]
  isWorking: boolean
  message: string | null
  onRegisterMentor: (mentorId: string) => void
  onRegisterOther: () => void
}

export default function DeviceSetupModal({ mentors, isWorking, message, onRegisterMentor, onRegisterOther }: DeviceSetupModalProps) {
  const [selection, setSelection] = useState('')
  const isOther = selection === '__other__'

  const proceed = () => {
    if (!selection || isWorking) return
    if (isOther) onRegisterOther()
    else onRegisterMentor(selection)
  }

  return (
    <div className="modal-backdrop setup-backdrop" role="presentation">
      <section className="setup-modal" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <p className="modal-kicker">FIRST SETUP</p>
        <h2 id="setup-title">このスマホを使う人は？</h2>
        <p>メンター本人は名前を選んでから、手元のイベント用QRを1回だけ登録してね。</p>
        <label className="select-label" htmlFor="owner-select">名前</label>
        <select id="owner-select" value={selection} onChange={(event) => setSelection(event.target.value)} disabled={isWorking}>
          <option value="">選んでね</option>
          {mentors.map((mentor) => <option key={mentor.id} value={mentor.id}>{mentor.name}（{mentor.generation}）</option>)}
          <option value="__other__">その他（コレクションだけ使う）</option>
        </select>
        {message && <p className="setup-message" role="alert">{message}</p>}
        <button className="scan-button" type="button" disabled={!selection || isWorking} onClick={proceed}>
          {isWorking ? '登録しています…' : isOther ? 'この端末で始める' : 'QRを初回登録する'}
        </button>
        {!isOther && selection && <p className="support-note">※ 次の画面で、手元の任意のイベント用QRを読み取ります。</p>}
      </section>
    </div>
  )
}
