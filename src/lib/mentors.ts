import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db, isFirebaseConfigured } from './firebase'
import type { AppConfig, Mentor } from '../types'

const mentorFromData = (id: string, data: Record<string, unknown>): Mentor | null => {
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  const generation = typeof data.generation === 'string' ? data.generation.trim() : ''
  const imageUrl = typeof data.imageUrl === 'string' ? data.imageUrl.trim() : ''
  const iconUrl = typeof data.iconUrl === 'string' && data.iconUrl.trim() ? data.iconUrl.trim() : imageUrl
  const isOpenFromStart = data.isOpenFromStart === true

  // Excel の Mentors タブで反映した現行メンターだけを表示する。
  // 以前のイベントで作成されたドキュメントを削除せずに一覧から除外できる。
  if (!id || !name || !generation || data.active !== true) return null
  return { id, name, generation, iconUrl, imageUrl, isOpenFromStart }
}

/** Firestore の mentors コレクションをすべて取得します。ドキュメントIDを mentor ID として使用します。 */
export async function fetchMentors(): Promise<Mentor[]> {
  if (!isFirebaseConfigured || !db) {
    throw new Error('Firebase の環境変数が設定されていません。')
  }

  const snapshot = await getDocs(query(collection(db, 'mentors'), where('active', '==', true)))
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

/** appConfig/settings の公開状態と獲得履歴の世代番号を読みます。 */
export async function fetchAppConfig(): Promise<AppConfig> {
  if (!isFirebaseConfigured || !db) return { isAllOpen: false, collectionEpoch: 1 }

  const snapshot = await getDoc(doc(db, 'appConfig', 'settings'))
  const data = snapshot.data()
  const collectionEpoch = data?.collectionEpoch
  return {
    isAllOpen: data?.isAllOpen === true,
    collectionEpoch: typeof collectionEpoch === 'number' && Number.isSafeInteger(collectionEpoch) && collectionEpoch > 0
      ? collectionEpoch
      : 1,
  }
}
