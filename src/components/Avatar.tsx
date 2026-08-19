import { useState } from 'react'
import type { Mentor } from '../types'

type AvatarProps = {
  mentor: Mentor
  unlocked: boolean
  onClick?: () => void
}

export default function Avatar({ mentor, unlocked, onClick }: AvatarProps) {
  const [imageFailed, setImageFailed] = useState(false)
  const clickable = unlocked && Boolean(onClick)

  return (
    <button
      className={`mentor-card ${unlocked ? 'is-unlocked' : 'is-locked'}`}
      type="button"
      disabled={!clickable}
      onClick={onClick}
      aria-label={unlocked ? `${mentor.name}のプロフィールを開く` : `${mentor.name}は未獲得`}
    >
      <span className="avatar-frame" aria-hidden="true">
        {!imageFailed ? (
          <img src={mentor.iconUrl} alt="" onError={() => setImageFailed(true)} />
        ) : (
          <span className="avatar-fallback">?</span>
        )}
        {!unlocked && <span className="lock-mark">?</span>}
      </span>
      <span className="mentor-name">{mentor.name}</span>
      <span className="mentor-status">{unlocked ? 'GET!' : 'まだヒミツ'}</span>
    </button>
  )
}
