/** @section persist */
import { useEffect, useState } from 'react'

export function usePersisted(ctx, key, fallback) {
  const [value, setValue] = useState(fallback)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const v = await ctx.storage.get(key)
        if (!cancelled && v != null && v !== '') setValue(v)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ctx, key])

  const set = (next) => {
    setValue(next)
    try {
      void ctx.storage.set(key, next)
    } catch {
      /* ignore */
    }
  }

  return [value, set]
}
