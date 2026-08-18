/**
 * カード内 URL の /mentor/{ID} を優先し、無い場合は最後のパス要素を ID として返します。
 * 読み取り元のドメインは限定しないので、古いカードでもページ遷移なしに扱えます。
 */
export function extractMentorId(value: string): string | null {
  try {
    const url = new URL(value.trim())
    const queryId = url.searchParams.get('id')
    const segments = url.pathname.split('/').filter(Boolean)
    const mentorIndex = segments.findIndex((segment) => segment.toLowerCase() === 'mentor')
    const candidate = queryId ?? (mentorIndex >= 0 ? segments[mentorIndex + 1] : segments.at(-1))
    const id = candidate ? decodeURIComponent(candidate).trim() : ''
    return /^[a-zA-Z0-9_-]+$/.test(id) ? id : null
  } catch {
    return null
  }
}

export function readTextFromNdefRecord(record: NDEFRecord): string | null {
  if (!record.data) return null
  const data = record.data instanceof DataView
    ? new Uint8Array(record.data.buffer, record.data.byteOffset, record.data.byteLength)
    : new Uint8Array(record.data)
  return new TextDecoder().decode(data).replace(/^\uFEFF/, '').trim() || null
}
