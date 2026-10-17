/** Accept only this account's public-bucket object, never a remote tracking URL. */
export function ownedFilePath(value: string | undefined, bucket: string, owner: string | null, backendUrl: string | undefined): string | undefined {
  if (!value || !owner || !backendUrl) return undefined
  try {
    const base = new URL(backendUrl)
    const url = new URL(value, base)
    const prefix = `${base.pathname.replace(/\/$/, '')}/storage/v1/object/public/${bucket}/`
    if (url.origin !== base.origin || !url.pathname.startsWith(prefix) || url.search || url.hash) return undefined
    const path = decodeURIComponent(url.pathname.slice(prefix.length))
    if (!path.startsWith(`${owner}/`) || path.length > 500 || path.includes('..') || !/^[a-zA-Z0-9/_.-]+$/.test(path)) return undefined
    return path
  } catch { return undefined }
}
