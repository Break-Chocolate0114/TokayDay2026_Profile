export const QR_PREFIX = 'TOKAI2026:1:'

/** QRに埋め込むランダムIDは、URLではなくこのイベント専用の文字列として扱います。 */
export function parseQrId(rawValue: string): string | null {
  const match = rawValue.trim().match(/^TOKAI2026:1:([A-Za-z0-9_-]{16,80})$/)
  return match?.[1] ?? null
}
