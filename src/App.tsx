import { useCallback, useEffect, useMemo, useState } from 'react'
import MentorSection from './components/MentorSection'
import ProfileModal from './components/ProfileModal'
import { addCollectedId, loadCollectedIds } from './lib/collection'
import { fetchAppConfig, fetchMentor, fetchMentors } from './lib/mentors'
import { extractMentorId } from './lib/nfc'
import { useNfcScanner } from './hooks/useNfcScanner'
import type { Mentor } from './types'

const GENERATION_ORDER = ['OB・OG', 'OB', 'OG', '13期', '14期', '15期', '16期', '17期', '18期']

function generationRank(generation: string) {
  const index = GENERATION_ORDER.indexOf(generation)
  return index === -1 ? GENERATION_ORDER.length : index
}

// 古いデータで "OB" / "OG" と分かれていても、一覧上では同じ OB・OG ブロックにします。
function displayGeneration(generation: string) {
  return generation === 'OB' || generation === 'OG' ? 'OB・OG' : generation
}

export default function App() {
  const [mentors, setMentors] = useState<Mentor[]>([])
  const [collectedIds, setCollectedIds] = useState<Set<string>>(() => loadCollectedIds())
  const [isAllOpen, setIsAllOpen] = useState(false)
  const [selectedMentor, setSelectedMentor] = useState<Mentor | null>(null)
  const [notice, setNotice] = useState('「NFCを読み取る」を押して、カードをスマホにかざしてね！')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    Promise.all([fetchMentors(), fetchAppConfig()])
      .then(([loadedMentors, config]) => {
        if (!active) return
        setMentors(loadedMentors.sort((a, b) => generationRank(a.generation) - generationRank(b.generation) || a.name.localeCompare(b.name, 'ja')))
        setIsAllOpen(config.isAllOpen)
      })
      .catch(() => {
        if (active) setLoadError('プロフィール帳を読み込めませんでした。通信状況と Firebase の設定を確認してください。')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => { active = false }
  }, [])

  const showNoticeError = useCallback((message: string) => setNotice(message), [])

  const onNfcText = useCallback(async (text: string) => {
    const id = extractMentorId(text)
    if (!id) {
      setNotice('このカードの URL からメンターIDを見つけられませんでした。')
      return
    }

    try {
      // 直後に 1 件取得することで、読み取り時は Firestore の最新データを表示します。
      const latestMentor = await fetchMentor(id)
      const mentor = latestMentor ?? mentors.find((item) => item.id === id)
      if (!mentor) {
        setNotice('このカードは今回のプロフィール帳には登録されていません。')
        return
      }

      const nextIds = addCollectedId(mentor.id)
      setCollectedIds(nextIds)
      setSelectedMentor(mentor)
      setNotice(`「${mentor.name}」をGETしたよ！`)
    } catch {
      setNotice('カードは読めましたが、プロフィールの取得に失敗しました。もう一度お試しください。')
    }
  }, [mentors])

  const { isSupported, isScanning, start, stop } = useNfcScanner({
    onText: onNfcText,
    onError: showNoticeError,
  })

  const groupedMentors = useMemo(() => {
    const groups = new Map<string, Mentor[]>()
    mentors.forEach((mentor) => {
      const groupName = displayGeneration(mentor.generation)
      groups.set(groupName, [...(groups.get(groupName) ?? []), mentor])
    })
    return [...groups.entries()].sort(([a], [b]) => generationRank(a) - generationRank(b))
  }, [mentors])

  const unlockedCount = mentors.filter((mentor) => isAllOpen || collectedIds.has(mentor.id)).length
  const isUnlocked = (id: string) => isAllOpen || collectedIds.has(id)

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="event-label">TOKAI NO HI 2026 ♡ MENTOR BOOK</p>
        <h1>東海の日<br /><span>プロフィール帳</span></h1>
        <p className="hero-copy">メンターのカードを集めよう！</p>
        <div className="progress-card" aria-label={`収集進捗 ${unlockedCount} / ${mentors.length} 人`}>
          <span>あつめた人数</span>
          <strong>{unlockedCount}<small> / {mentors.length} 人</small></strong>
          <div className="progress-track" aria-hidden="true">
            <span style={{ width: `${mentors.length ? (unlockedCount / mentors.length) * 100 : 0}%` }} />
          </div>
        </div>
      </header>

      <section className="scanner-panel" aria-label="NFCカード読み取り">
        <div className="scanner-copy">
          <span className="heart">♥</span>
          <p>{isScanning ? '読み取り中… カードを近づけてね！' : notice}</p>
        </div>
        <button className="scan-button" type="button" onClick={isScanning ? stop : start} disabled={isLoading}>
          <span aria-hidden="true">⌁</span>
          {isScanning ? '読み取りをやめる' : 'NFCを読み取る'}
        </button>
        {!isSupported && <p className="support-note">※ NFC読み取りは Android 版 Chrome（HTTPS）に対応しています。</p>}
      </section>

      <section className="book-section" aria-labelledby="mentor-list-title">
        <div className="section-heading">
          <span>✦</span>
          <h2 id="mentor-list-title">MENTOR LIST</h2>
          <span>✦</span>
        </div>
        {isAllOpen && <p className="all-open-banner">イベント終了後スペシャル♡ 全プロフィールを公開中！</p>}
        {isLoading && <p className="status-message">プロフィール帳を準備中…</p>}
        {loadError && <p className="error-message" role="alert">{loadError}</p>}
        {!isLoading && !loadError && groupedMentors.map(([generation, members]) => (
          <MentorSection key={generation} generation={generation} mentors={members} isUnlocked={isUnlocked} onSelect={setSelectedMentor} />
        ))}
      </section>

      <footer>Made with ♡ for 東海の日</footer>
      <ProfileModal mentor={selectedMentor} onClose={() => setSelectedMentor(null)} />
    </main>
  )
}
