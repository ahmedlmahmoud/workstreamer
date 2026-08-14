/** @section lists — pulse.json helpers (chip + page share these) */

export const MISSION_STATUSES = ['todo', 'doing', 'blocked', 'later', 'done', 'cancelled']

export function listsOf(data) {
  return data?.lists || null
}

export function hasLists(data) {
  const lists = listsOf(data)
  return Boolean(lists?.ok && lists?.pulse && Array.isArray(lists.pulse.missions))
}

export function listsInvalid(data) {
  const lists = listsOf(data)
  return Boolean(lists && lists.ok === false && lists.source === 'invalid')
}

export function listsEmpty(data) {
  const lists = listsOf(data)
  return Boolean(lists?.ok && lists.source === 'empty')
}

export function pulseOf(data) {
  return hasLists(data) ? data.lists.pulse : null
}

export function viewOf(data) {
  return hasLists(data) ? data.lists.view || {} : {}
}

export function sortedMissions(pulse) {
  const items = Array.isArray(pulse?.missions) ? pulse.missions.slice() : []
  return items.sort((a, b) => {
    const ao = Number(a.order)
    const bo = Number(b.order)
    const an = Number.isFinite(ao) ? ao : 0
    const bn = Number.isFinite(bo) ? bo : 0
    if (an !== bn) return an - bn
    return String(a.id || '').localeCompare(String(b.id || ''))
  })
}

export function openMissions(pulse) {
  return sortedMissions(pulse).filter(m => m.status !== 'done' && m.status !== 'cancelled')
}

export function nextMission(data) {
  const v = viewOf(data)
  if (v.next_mission) return v.next_mission
  const pulse = pulseOf(data)
  return openMissions(pulse)[0] || null
}

export function openBlockers(pulse) {
  return (pulse?.blockers || []).filter(b => b.status !== 'resolved')
}

export function waitingOn(pulse) {
  return openBlockers(pulse).filter(b => b.kind === 'waiting-on')
}

export function stuckOn(pulse) {
  return openBlockers(pulse).filter(b => b.kind === 'stuck-on')
}

export function blockerById(pulse, id) {
  if (!id) return null
  return (pulse?.blockers || []).find(b => b.id === id) || null
}

export function resourceById(pulse, id) {
  if (!id) return null
  return (pulse?.resources || []).find(r => r.id === id) || null
}

export function todayISO(tz) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    return fmt.format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

/** Overdue first, then pins, then pile. Cap 3. */
export function recommendToday(pulse, tz) {
  const date = todayISO(tz || pulse?.timezone)
  const open = openMissions(pulse)
  const pins = pulse?.today?.pinned_mission_ids || []
  const byId = Object.fromEntries(open.map(m => [m.id, m]))
  const rank = (m) => {
    const overdue = m.due && String(m.due) <= date ? 0 : 1
    const order = Number.isFinite(Number(m.order)) ? Number(m.order) : 0
    return [overdue, order, String(m.id || '')]
  }
  const ranked = open.slice().sort((a, b) => {
    const aa = rank(a)
    const bb = rank(b)
    for (let i = 0; i < aa.length; i++) {
      if (aa[i] < bb[i]) return -1
      if (aa[i] > bb[i]) return 1
    }
    return 0
  })
  const out = []
  const seen = new Set()
  // 1. overdue first
  for (const m of ranked) {
    if (m.due && String(m.due) <= date && m.id && !seen.has(m.id)) {
      seen.add(m.id)
      out.push(m)
    }
    if (out.length >= 3) return out.slice(0, 3)
  }
  // 2. last night's pins
  for (const id of pins) {
    if (byId[id] && !seen.has(id)) {
      seen.add(id)
      out.push(byId[id])
    }
    if (out.length >= 3) return out.slice(0, 3)
  }
  // 3. rest of the pile
  for (const m of ranked) {
    if (m.id && !seen.has(m.id)) {
      seen.add(m.id)
      out.push(m)
    }
    if (out.length >= 3) break
  }
  return out.slice(0, 3)
}

export function isOverdue(m, date) {
  return Boolean(m?.due && date && String(m.due) < date)
}

export function statusTone(status) {
  if (status === 'doing') return 'warn'
  if (status === 'blocked') return 'bad'
  if (status === 'done') return 'good'
  if (status === 'cancelled' || status === 'later') return 'muted'
  return 'muted'
}

export function modeLabel(mode) {
  if (mode === 'quiet') return 'quiet'
  if (mode === 'hunt') return 'hunt'
  return 'steer'
}

export async function patchLists(ctx, stream, op) {
  const q = `?stream=${encodeURIComponent(stream)}`
  return ctx.rest(`/stream${q}`, { method: 'PATCH', body: op })
}
