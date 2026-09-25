import { useEffect } from 'react'
import type { Mentor } from '../types'

type ProfileModalProps = {
  mentor: Mentor | null
  onClose: () => void
}

export default function ProfileModal({ mentor, onClose }: ProfileModalProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  if (!mentor) return null

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="profile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close" type="button" onClick={onClose} aria-label="プロフィールを閉じる">×</button>
        <p className="modal-kicker">PROFILE GET!</p>
        <h2 id="profile-modal-title">{mentor.name}</h2>
        <p className="modal-generation">{mentor.generation}</p>
        {mentor.imageUrl ? (
          <img className="profile-image" src={mentor.imageUrl} alt={`${mentor.name}のプロフィール`} />
        ) : (
          <p className="missing-profile-image">プロフィール画像は準備中です♡</p>
        )}
        <button className="close-button" type="button" onClick={onClose}>とじる</button>
      </section>
    </div>
  )
}
