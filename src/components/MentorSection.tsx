import type { Mentor } from '../types'
import Avatar from './Avatar'

type MentorSectionProps = {
  generation: string
  mentors: Mentor[]
  isUnlocked: (id: string) => boolean
  onSelect: (mentor: Mentor) => void
}

export default function MentorSection({ generation, mentors, isUnlocked, onSelect }: MentorSectionProps) {
  return (
    <section className="generation-section" aria-labelledby={`generation-${generation}`}>
      <h2 id={`generation-${generation}`}><span>★</span>{generation}</h2>
      <div className="mentor-grid">
        {mentors.map((mentor) => (
          <Avatar
            key={mentor.id}
            mentor={mentor}
            unlocked={isUnlocked(mentor.id)}
            onClick={() => onSelect(mentor)}
          />
        ))}
      </div>
    </section>
  )
}
