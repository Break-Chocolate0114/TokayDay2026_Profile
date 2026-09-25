import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './firebase'

const EVENT_ACCESS_PARAMETER = 'eventAccess'

function requireDatabase() {
  if (!db) throw new Error('Firebase の環境変数が設定されていません。')
  return db
}

async function hashAccessCode(accessCode: string) {
  const bytes = new TextEncoder().encode(accessCode)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 会場QRのURLフラグメントからのみ入場コードを取得する。フラグメントはサーバーへ送信されない。 */
export function readEventAccessCodeFromUrl() {
  return new URLSearchParams(window.location.hash.slice(1)).get(EVENT_ACCESS_PARAMETER)
}

export function removeEventAccessCodeFromUrl() {
  const url = new URL(window.location.href)
  const parameters = new URLSearchParams(url.hash.slice(1))
  parameters.delete(EVENT_ACCESS_PARAMETER)
  url.hash = parameters.toString()
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

/** 匿名UIDへ入場済みの印を付ける。判定・書込み許可はFirestoreルール側でも行う。 */
export async function grantEventAccess(uid: string, accessCode: string) {
  const database = requireDatabase()
  const codeHash = await hashAccessCode(accessCode)
  const code = await getDoc(doc(database, 'eventAccessCodes', codeHash))
  if (!code.exists() || code.data().active !== true) return false

  const grantReference = doc(database, 'eventAccessGrants', uid)
  const currentGrant = await getDoc(grantReference)
  if (currentGrant.exists()) {
    // 同じ端末が入場QRをもう一度開いた場合は、書込みをせず通常画面へ進める。
    // ルール上、入場権の差し替え・延長は管理者の再発行と全リセットでのみ行う。
    if (currentGrant.data().codeHash === codeHash) removeEventAccessCodeFromUrl()
    return currentGrant.data().codeHash === codeHash
  }

  await setDoc(grantReference, {
    codeHash,
    grantedAt: serverTimestamp(),
  })
  removeEventAccessCodeFromUrl()
  return true
}

/** 既に入場済みかを、許可証と元コードの有効状態の両方で確認する。 */
export async function hasActiveEventAccess(uid: string) {
  const database = requireDatabase()
  const grant = await getDoc(doc(database, 'eventAccessGrants', uid))
  const codeHash = grant.data()?.codeHash
  if (!grant.exists() || typeof codeHash !== 'string') return false

  const code = await getDoc(doc(database, 'eventAccessCodes', codeHash))
  return code.exists() && code.data().active === true
}
