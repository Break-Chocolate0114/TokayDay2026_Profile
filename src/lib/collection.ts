const STORAGE_KEY = 'tokai-profile-book:collected-ids:v2'

export function loadCollectedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((id): id is string => typeof id === 'string'))
  } catch {
    return new Set()
  }
}

export function saveCollectedIds(ids: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
}

export function addCollectedId(id: string): Set<string> {
  const ids = loadCollectedIds()
  ids.add(id)
  saveCollectedIds(ids)
  return ids
}
