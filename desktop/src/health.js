/** @section health */
/** Map domain health → Hermes StatusDot tone (good|muted|warn|bad). */
export function healthMeta(health) {
  const map = {
    clean: { tone: 'good', label: 'clean', short: 'clean', badge: 'default' },
    adopted: { tone: 'good', label: 'adopted', short: 'ok', badge: 'default' },
    active: { tone: 'warn', label: 'in motion', short: 'active', badge: 'warn' },
    degraded: { tone: 'bad', label: 'degraded', short: 'down', badge: 'destructive' },
    dirty: { tone: 'bad', label: 'dirty', short: 'dirty', badge: 'destructive' },
    stale: { tone: 'warn', label: 'stale status', short: 'stale', badge: 'warn' },
    partial: { tone: 'warn', label: 'partial', short: 'partial', badge: 'warn' },
    bare: { tone: 'muted', label: 'bare', short: 'bare', badge: 'muted' },
  }
  return map[health] || { tone: 'muted', label: health || '…', short: health || '…', badge: 'muted' }
}

export function toneOf(t) {
  if (t === 'good' || t === 'clean' || t === 'adopted') return 'good'
  if (t === 'active' || t === 'partial' || t === 'warn' || t === 'stale') return 'warn'
  if (t === 'bad' || t === 'dirty' || t === 'degraded' || t === 'error') return 'bad'
  return 'muted'
}

export function badgeVariantForTone(t) {
  const x = toneOf(t)
  if (x === 'good') return 'default'
  if (x === 'warn') return 'warn'
  if (x === 'bad') return 'destructive'
  return 'muted'
}
