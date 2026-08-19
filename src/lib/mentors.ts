import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { db, isFirebaseConfigured } from './firebase'
import type { AppConfig, Mentor } from '../types'

const mentorFromData = (id: string, data: Record<string, unknown>): Mentor | null => {
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  const generation = typeof data.generation === 'string' ? data.generation.trim() : ''
  const imageUrl = typeof data.imageUrl === 'string' ? data.imageUrl.trim() : ''

  if (!id || !name || !generation || !imageUrl) return null
  return { id, name, generation, imageUrl }
}

/** Firestore の mentors コレクションをすべて取得します。ドキュメントIDを mentor ID として使用します。 */
export async function fetchMentors(): Promise<Mentor[]> {
  if (!isFirebaseConfigured || !db) {
    throw new Error('Firebase の環境変数が設定されていません。')
  }

  const snapshot = await getDocs(collection(db, 'mentors'))
  return snapshot.docs
    .map((item) => mentorFromData(item.id, item.data()))
    .filter((mentor): mentor is Mentor => mentor !== null)
}

/** QRを読んだ直後に最新のプロフィールを取得するための 1 件問い合わせです。 */
export async function fetchMentor(id: string): Promise<Mentor | null> {
  if (!isFirebaseConfigured || !db) return null

  const snapshot = await getDoc(doc(db, 'mentors', id))
  return snapshot.exists() ? mentorFromData(snapshot.id, snapshot.data()) : null
}

/** appConfig/settings の isAllOpen を読みます。未作成時は安全側で false です。 */
export async function fetchAppConfig(): Promise<AppConfig> {
  if (!isFirebaseConfigured || !db) return { isAllOpen: false }

  const snapshot = await getDoc(doc(db, 'appConfig', 'settings'))
  const value = snapshot.data()?.isAllOpen
  return { isAllOpen: value === true }
}
