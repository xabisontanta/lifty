import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: Error | null
  retry: () => void
}

/** Loading / error / retry wrapper for any service call. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [nonce, setNonce] = useState(0)
  const alive = useRef(0)

  useEffect(() => {
    const id = ++alive.current
    setLoading(true)
    setError(null)
    fn()
      .then((d) => {
        if (id === alive.current) {
          setData(d)
          setLoading(false)
        }
      })
      .catch((e: unknown) => {
        if (id === alive.current) {
          setError(e instanceof Error ? e : new Error('Something went wrong'))
          setLoading(false)
        }
      })
    return () => {
      alive.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const retry = useCallback(() => setNonce((n) => n + 1), [])
  return { data, loading, error, retry }
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}
