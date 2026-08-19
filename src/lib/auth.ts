import type { User } from 'firebase/auth'
import { signInAnonymously } from 'firebase/auth'
import { auth } from './firebase'

let pendingSignIn: Promise<User> | null = null

/** 参加者にログイン操作を求めず、端末ごとの Firebase UID を得ます。 */
export async function ensureAnonymousUser(): Promise<User> {
  if (!auth) throw new Error('Firebase の環境変数が設定されていません。')
  if (auth.currentUser) return auth.currentUser

  pendingSignIn ??= signInAnonymously(auth).then(({ user }) => user).finally(() => {
    pendingSignIn = null
  })
  return pendingSignIn
}
