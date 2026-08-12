/** @section format */
export function extractStreamName(cwd) {
  if (!cwd) return null
  const m = String(cwd).match(/workstreams\/([^/]+)/)
  return m ? m[1] : null
}

export function titleCase(name) {
  if (!name) return ''
  return String(name)
    .split(/[-_]/)
    .map(p => (p ? p.charAt(0).toUpperCase() + p.slice(1) : ''))
    .join(' ')
}

export function errMsg(e) {
  if (!e) return 'unknown error'
  if (typeof e === 'string') return e
  if (e.detail && typeof e.detail === 'object') {
    return e.detail.error || e.detail.message || JSON.stringify(e.detail)
  }
  return e.message || e.detail || e.error || String(e)
}

export function ago(ts) {
  if (!ts) return ''
  const s = Math.max(0, Math.floor(Date.now() / 1000 - Number(ts)))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function hostCwd() {
  try {
    const a = host.state.cwd
    return typeof a?.get === 'function' ? a.get() : a
  } catch {
    return ''
  }
}

export function hostProfile() {
  try {
    const a = host.state.profile
    return typeof a?.get === 'function' ? a.get() : a
  } catch {
    return ''
  }
}
