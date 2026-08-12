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

export function isApiMissing(e) {
  const s = errMsg(e)
  return /No such API endpoint/i.test(s) || (/\/api\/plugins\/workstreamer\//i.test(s) && /404/.test(s))
}

export function errMsg(e) {
  if (!e) return 'unknown error'
  let raw = ''
  if (typeof e === 'string') raw = e
  else if (e.detail && typeof e.detail === 'object') {
    raw = e.detail.error || e.detail.message || JSON.stringify(e.detail)
  } else {
    raw = e.message || e.detail || e.error || String(e)
  }

  if (/No such API endpoint/i.test(raw) || (/404/.test(raw) && /workstreamer/.test(raw))) {
    return 'API not mounted on this dashboard. Copy the Python plugin to the SAME Hermes host Desktop is connected to (dashboard/manifest.json + plugins.enabled + restart). plugin.js alone is only the UI.'
  }
  if (/unauthenticated|Unauthorized|no_cookie/i.test(raw)) {
    return 'Dashboard rejected the request (not logged in). Reconnect / log in to this dashboard.'
  }
  return raw
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

export function stripMd(s) {
  return String(s || '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/^\s*[-*•]+\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Turn a STATUS-LIVE PR bullet into { number, title, extra, url }.
 *  `repo` comes from the snapshot (git remote / AGENTS.md) — never a plugin table. */
export function parsePr(raw, repo) {
  const source = String(raw || '')
  const urlMatch = source.match(/\((https?:\/\/[^)\s]+)\)/)
  const text = stripMd(source)
  const numMatch = text.match(/#(\d+)/)
  let rest = text.replace(/#\d+\b\s*/, '').trim()
  let extra = ''
  const paren = rest.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
  if (paren) {
    rest = paren[1].trim()
    extra = paren[2].trim()
  }
  const number = numMatch ? numMatch[1] : ''
  const base = String(repo || '').replace(/\/+$/, '')
  return {
    number,
    title: rest || text || 'PR',
    extra,
    url: urlMatch ? urlMatch[1] : number && base ? `${base}/pull/${number}` : '',
    raw: text,
  }
}

/** Expand a STATUS-LIVE host cell. Pattern, not a registry:
 *  already-https stays; `fe.sq` / `bk.sq.dabbo.net` → https://… */
export function hrefForUrl(name) {
  const n = String(name || '').trim()
  if (!n) return ''
  if (/^https?:\/\//i.test(n)) return n
  if (/^[a-z0-9-]+\.[a-z0-9-]+$/i.test(n) && !n.includes('/')) {
    return `https://${n}.dabbo.net`
  }
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(n)) return `https://${n}`
  return ''
}

export async function copyText(text) {
  const t = String(text || '')
  if (!t) return false
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(t)
      return true
    }
  } catch {
    /* fall through */
  }
  try {
    if (typeof host.copy === 'function') {
      await host.copy(t)
      return true
    }
  } catch {
    /* ignore */
  }
  return false
}

export function openHref(href) {
  if (!href) return
  try {
    if (typeof host.open === 'function') {
      host.open(href)
      return
    }
    if (typeof host.openExternal === 'function') {
      host.openExternal(href)
      return
    }
  } catch {
    /* fall through */
  }
  try {
    window.open(href, '_blank', 'noopener,noreferrer')
  } catch {
    /* ignore */
  }
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
