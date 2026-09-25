import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import DeviceSetupModal from './components/DeviceSetupModal'
import EventAccessGate from './components/EventAccessGate'
import MentorSection from './components/MentorSection'
import ProfileModal from './components/ProfileModal'
import { ensureAnonymousUser } from './lib/auth'
import { addCollectedId, loadCollectedIds } from './lib/collection'
import { grantEventAccess, hasActiveEventAccess, readEventAccessCodeFromUrl, removeEventAccessCodeFromUrl } from './lib/eventAccess'
import { fetchAppConfig, fetchMentors } from './lib/mentors'
import { parseQrId } from './lib/qr'
import { fetchDeviceSetup, fetchMentorFromQr, registerMentorQr, registerOtherDevice } from './lib/setup'
import type { DeviceSetup, Mentor } from './types'

const QrScannerModal = lazy(() => import('./components/QrScannerModal'))

const CURRENT_GENERATIONS = ['13期', '14期', '15期', '16期', '17期', '18期']
const GENERATION_ORDER = [...CURRENT_GENERATIONS, 'OB・OG']

function generationRank(generation: string) {
  const index = GENERATION_ORDER.indexOf(generation)
  return index === -1 ? GENERATION_ORDER.length : index
}

function displayGeneration(generation: string) {
  return CURRENT_GENERATIONS.includes(generation) ? generation : 'OB・OG'
}

type ScannerMode = 'collect' | 'register' | null

export default function App() {
  const [mentors, setMentors] = useState<Mentor[]>([])
  const [collectedIds, setCollectedIds] = useState<Set<string>>(() => new Set())
  const [collectionEpoch, setCollectionEpoch] = useState(1)
  const [isAllOpen, setIsAllOpen] = useState(false)
  const [selectedMentor, setSelectedMentor] = useState<Mentor | null>(null)
  const [deviceSetup, setDeviceSetup] = useState<DeviceSetup | null>(null)
  const [uid, setUid] = useState<string | null>(null)
  const [pendingMentorId, setPendingMentorId] = useState<string | null>(null)
  const [scannerMode, setScannerMode] = useState<ScannerMode>(null)
  const [notice, setNotice] = useState('「QRを読み取る」を押して、メンターさんのQRをカメラに映してね！')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [requiresEventAccess, setRequiresEventAccess] = useState(false)
  const [eventAccessError, setEventAccessError] = useState<string | null>(null)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSettingUp, setIsSettingUp] = useState(false)

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const user = await ensureAnonymousUser()
        const accessCode = readEventAccessCodeFromUrl()
        let hasEventAccess = await hasActiveEventAccess(user.uid)

        if (hasEventAccess && accessCode) removeEventAccessCodeFromUrl()
        if (!hasEventAccess && accessCode) {
          const granted = await grantEventAccess(user.uid, accessCode)
          if (!granted) {
            if (active) {
              setRequiresEventAccess(true)
              setEventAccessError('この入場QRは無効になっています。会場の最新の入場QRを読み取ってください。')
            }
            return
          }
          hasEventAccess = true
        }

        if (!hasEventAccess) {
          if (active) setRequiresEventAccess(true)
          return
        }

        const [loadedMentors, config, savedSetup] = await Promise.all([
          fetchMentors(),
          fetchAppConfig(),
          fetchDeviceSetup(user.uid),
        ])
        if (!active) return
        setRequiresEventAccess(false)
        setEventAccessError(null)
        setUid(user.uid)
        setMentors(loadedMentors.sort((a, b) => generationRank(displayGeneration(a.generation)) - generationRank(displayGeneration(b.generation)) || a.name.localeCompare(b.name, 'ja')))
        setIsAllOpen(config.isAllOpen)
        setCollectionEpoch(config.collectionEpoch)
        setCollectedIds(loadCollectedIds(config.collectionEpoch))
        setDeviceSetup(savedSetup)
        if (savedSetup?.ownerType === 'mentor' && typeof savedSetup.mentorId === 'string') {
          setCollectedIds(addCollectedId(savedSetup.mentorId, config.collectionEpoch))
        }
      } catch {
        if (active) setLoadError('プロフィール帳を読み込めませんでした。Firebase設定・匿名認証・通信状況を確認してください。')
      } finally {
        if (active) setIsLoading(false)
      }
    }

    void load()
    return () => { active = false }
  }, [])

  const groupedMentors = useMemo(() => {
    const groups = new Map<string, Mentor[]>()
    mentors.forEach((mentor) => {
      const groupName = displayGeneration(mentor.generation)
      groups.set(groupName, [...(groups.get(groupName) ?? []), mentor])
    })
    return [...groups.entries()].sort(([a], [b]) => generationRank(a) - generationRank(b))
  }, [mentors])

  const initiallyOpenMentorIds = useMemo(
    () => new Set(mentors.filter((mentor) => mentor.isOpenFromStart).map((mentor) => mentor.id)),
    [mentors],
  )
  const isUnlocked = (id: string) => isAllOpen || initiallyOpenMentorIds.has(id) || collectedIds.has(id)
  const unlockedCount = mentors.filter((mentor) => isUnlocked(mentor.id)).length

  const handleOtherSetup = useCallback(async () => {
    if (!uid) return
    setIsSettingUp(true)
    setSetupError(null)
    try {
      const setup = await registerOtherDevice(uid)
      setDeviceSetup(setup)
      setNotice('準備OK！ メンターさんのQRを読み取って集めよう。')
    } catch {
      setSetupError('初期設定を保存できませんでした。通信状況を確認してもう一度お試しください。')
    } finally {
      setIsSettingUp(false)
    }
  }, [uid])

  const handleMentorSelection = useCallback((mentorId: string) => {
    setSetupError(null)
    setPendingMentorId(mentorId)
    setScannerMode('register')
  }, [])

  const readQrForRegistration = useCallback(async (rawValue: string) => {
    const qrId = parseQrId(rawValue)
    const mentor = mentors.find((item) => item.id === pendingMentorId)
    if (!qrId) return { ok: false, message: 'イベント用QRではありません。手元のイベント用QRを読み取ってください。' }
    if (!uid || !mentor || !pendingMentorId) return { ok: false, message: '登録する名前を確認できませんでした。最初からやり直してください。' }

    try {
      const setup = await registerMentorQr(uid, pendingMentorId, qrId)
      setDeviceSetup(setup)
      setCollectedIds(addCollectedId(pendingMentorId, collectionEpoch))
      setNotice(`「${mentor.name}」のQRを登録したよ！ ほかのメンターのQRも集めよう。`)
      return { ok: true, message: 'QRを登録しました！' }
    } catch {
      return { ok: false, message: '登録できませんでした。QRが使用済み・名前が登録済み、または通信エラーの可能性があります。運営へ確認してください。' }
    }
  }, [collectionEpoch, mentors, pendingMentorId, uid])

  const readQrForCollection = useCallback(async (rawValue: string) => {
    const qrId = parseQrId(rawValue)
    if (!qrId) return { ok: false, message: 'イベント用QRではありません。QRラベルを読み取ってください。' }

    try {
      const mentor = await fetchMentorFromQr(qrId)
      if (!mentor) return { ok: false, message: 'このQRはまだメンターに登録されていません。' }

      const nextIds = addCollectedId(mentor.id, collectionEpoch)
      setCollectedIds(nextIds)
      setSelectedMentor(mentor)
      setNotice(`「${mentor.name}」をGETしたよ！`)
      return { ok: true, message: `${mentor.name} をGET！` }
    } catch {
      return { ok: false, message: 'プロフィールを取得できませんでした。通信状況を確認してもう一度お試しください。' }
    }
  }, [collectionEpoch])

  const scannerProps = scannerMode === 'register'
    ? {
        title: 'QRを初回登録',
        description: '手元のイベント用QRを枠に合わせてね。どの配布番号でも使えます。',
        onRead: readQrForRegistration,
      }
    : scannerMode === 'collect'
      ? {
          title: 'QRを読み取る',
          description: 'メンターさんのイベント用QRを枠に合わせてね。',
          onRead: readQrForCollection,
        }
      : null

  if (!isLoading && requiresEventAccess) return <EventAccessGate message={eventAccessError ?? undefined} />

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="event-label">TOKAI NO HI 2026 ♡ MENTOR BOOK</p>
        <h1>東海の日<br /><span>プロフィール帳</span></h1>
        <p className="hero-copy">メンターさんのQRを集めよう！</p>
        <div className="progress-card" aria-label={`収集進捗 ${unlockedCount} / ${mentors.length} 人`}>
          <span>あつめた人数</span>
          <strong>{unlockedCount}<small> / {mentors.length} 人</small></strong>
          <div className="progress-track" aria-hidden="true">
            <span style={{ width: `${mentors.length ? (unlockedCount / mentors.length) * 100 : 0}%` }} />
          </div>
        </div>
      </header>

      <section className="scanner-panel" aria-label="QRコード読み取り">
        <div className="scanner-copy">
          <span className="heart">♥</span>
          <p>{notice}</p>
        </div>
        <button className="scan-button" type="button" onClick={() => setScannerMode('collect')} disabled={isLoading || !deviceSetup || Boolean(loadError)}>
          <span aria-hidden="true">⌘</span>
          QRを読み取る
        </button>
        <p className="support-note">※ iPhone / Android の Safari・Chromeで、カメラを許可して使えます。</p>
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
      {!isLoading && !loadError && !deviceSetup && !scannerMode && (
        <DeviceSetupModal
          mentors={mentors}
          isWorking={isSettingUp}
          message={setupError}
          onRegisterMentor={handleMentorSelection}
          onRegisterOther={() => { void handleOtherSetup() }}
        />
      )}
      {scannerProps && (
        <Suspense fallback={<div className="qr-camera-loading" role="status">カメラを準備中…</div>}>
          <QrScannerModal {...scannerProps} onClose={() => setScannerMode(null)} />
        </Suspense>
      )}
    </main>
  )
}
