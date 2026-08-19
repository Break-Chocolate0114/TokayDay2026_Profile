const STORAGE_KEY = 'tokai-profile-book:collection-state:v3'

type StoredCollection = {
  epoch: number
  ids: string[]
}

function readStoredCollection(): StoredCollection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const { epoch, ids } = parsed as Record<string, unknown>
    if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 1 || !Array.isArray(ids)) return null
    return { epoch, ids: ids.filter((id): id is string => typeof id === 'string') }
  } catch {
    return null
  }
}

export function loadCollectedIds(epoch: number): Set<string> {
  const stored = readStoredCollection()
  return stored?.epoch === epoch ? new Set(stored.ids) : new Set()
}

export function saveCollectedIds(ids: Set<string>, epoch: number) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ epoch, ids: [...ids] }))
}

export function addCollectedId(id: string, epoch: number): Set<string> {
  const ids = loadCollectedIds(epoch)
  ids.add(id)
  saveCollectedIds(ids, epoch)
  return ids
}
