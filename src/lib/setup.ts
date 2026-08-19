import { doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import { fetchMentor } from './mentors'
import type { DeviceSetup, Mentor } from '../types'

function requireDatabase() {
  if (!db) throw new Error('Firebase の環境変数が設定されていません。')
  return db
}

function setupFromData(data: Record<string, unknown>): DeviceSetup | null {
  const ownerType = data.ownerType
  if (ownerType === 'other') return { ownerType }
  if (ownerType === 'mentor' && typeof data.mentorId === 'string' && typeof data.qrId === 'string') {
    return { ownerType, mentorId: data.mentorId, qrId: data.qrId }
  }
  return null
}

export async function fetchDeviceSetup(uid: string): Promise<DeviceSetup | null> {
  const database = requireDatabase()
  const snapshot = await getDoc(doc(database, 'deviceSetups', uid))
  return snapshot.exists() ? setupFromData(snapshot.data()) : null
}

/** 「その他」を選んだ端末は、コレクション閲覧だけを行う端末として一度だけ記録します。 */
export async function registerOtherDevice(uid: string): Promise<DeviceSetup> {
  const database = requireDatabase()
  const reference = doc(database, 'deviceSetups', uid)
  const current = await getDoc(reference)
  if (current.exists()) throw new Error('この端末はすでに初期設定済みです。')

  const batch = writeBatch(database)
  batch.set(reference, { ownerType: 'other', createdAt: serverTimestamp() })
  await batch.commit()
  return { ownerType: 'other' }
}

/**
 * メンター本人が自分のQRを登録する唯一のクライアント書き込みです。
 * Firestore ルールは、この3ドキュメントが同じバッチで作られることを検証します。
 */
export async function registerMentorQr(uid: string, mentorId: string, qrId: string): Promise<DeviceSetup> {
  const database = requireDatabase()
  const deviceReference = doc(database, 'deviceSetups', uid)
  const current = await getDoc(deviceReference)
  if (current.exists()) throw new Error('この端末はすでに初期設定済みです。')

  const batch = writeBatch(database)
  batch.set(deviceReference, {
    ownerType: 'mentor',
    mentorId,
    qrId,
    createdAt: serverTimestamp(),
  })
  batch.set(doc(database, 'qrCodes', qrId), {
    mentorId,
    registeredByUid: uid,
    registeredAt: serverTimestamp(),
  })
  batch.set(doc(database, 'mentorQrBindings', mentorId), {
    qrId,
    registeredByUid: uid,
    registeredAt: serverTimestamp(),
  })
  await batch.commit()
  return { ownerType: 'mentor', mentorId, qrId }
}

/** QR IDから紐付いたメンターを1件だけ取得します。 */
export async function fetchMentorFromQr(qrId: string): Promise<Mentor | null> {
  const database = requireDatabase()
  const mapping = await getDoc(doc(database, 'qrCodes', qrId))
  const mentorId = mapping.data()?.mentorId
  if (!mapping.exists() || typeof mentorId !== 'string') return null
  return fetchMentor(mentorId)
}
