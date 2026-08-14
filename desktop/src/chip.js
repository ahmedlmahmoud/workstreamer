/** @section chip */
import {
  Badge,
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  StatusDot,
  Tip,
  cn,
  haptic,
  host,
  useQuery,
  useQueryClient,
  useValue,
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useState } from 'react'
import {
  HealthBadge,
  Muted,
  SectionLabel,
  ViolationList,
} from './atoms.js'
import { ID, STORAGE_KEYS } from './constants.js'
import { ago, copyText, errMsg, extractStreamName, titleCase } from './format.js'
import { healthMeta } from './health.js'
import {
  blockerById,
  hasLists,
  isOverdue,
  listsEmpty,
  listsInvalid,
  nextMission,
  openMissions,
  patchLists,
  pulseOf,
  recommendToday,
  resourceById,
  statusTone,
  todayISO,
  waitingOn,
} from './lists.js'
import { usePersisted } from './persist.js'

function chipTitle(streamName, data) {
  return data?.title || titleCase(streamName) || streamName
}

const FLIP_CYCLE = ['todo', 'doing', 'later', 'done']

export function WorkstreamChip({ ctx }) {
  const cwd = useValue(host.state.cwd)
  const profile = useValue(host.state.profile)
  const streamFromCwd = extractStreamName(cwd)
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [pinned, setPinned] = usePersisted(ctx, STORAGE_KEYS.pinned, '')
  const [view, setView] = usePersisted(ctx, STORAGE_KEYS.view, 'glance')
  const [morningDate, setMorningDate] = usePersisted(ctx, STORAGE_KEYS.morningDate, '')
  const qc = useQueryClient()

  const { data: resolved } = useQuery({
    queryKey: [ID, 'resolve', streamFromCwd || '', profile || ''],
    queryFn: async () => {
      if (streamFromCwd) return { stream: streamFromCwd, source: 'cwd' }
      const q = new URLSearchParams()
      if (profile) q.set('profile', String(profile))
      if (cwd) q.set('cwd', String(cwd))
      return ctx.rest(`/resolve?${q}`)
    },
    refetchInterval: 30_000,
    retry: 1,
  })

  const liveName = resolved?.stream || streamFromCwd || ''
  const streamName = pinned || liveName

  const { data: fleet } = useQuery({
    queryKey: [ID, 'list'],
    queryFn: () => ctx.rest('/list?pulse=true&check=false'),
    refetchInterval: 60_000,
    retry: 1,
    enabled: open,
  })

  const { data, isFetching, isError, error, refetch } = useQuery({
    queryKey: [ID, 'stream', streamName || 'none'],
    queryFn: async () => {
      if (!streamName) return null
      return ctx.rest(
        `/stream?stream=${encodeURIComponent(streamName)}&check=true`
      )
    },
    enabled: Boolean(streamName),
    refetchInterval: 45_000,
    retry: 1,
  })

  if (!streamName) {
    return jsx(Tip, {
      label: 'No workstream — open page',
      children: jsxs('button', {
        type: 'button',
        className:
          'inline-flex h-full items-center gap-1 rounded-none px-1.5 text-[0.6875rem] transition-colors hover:bg-(--chrome-action-hover)',
        style: { color: 'var(--ui-text-quaternary)' },
        onClick: () => {
          haptic('tap')
          host.navigate('/workstream-map')
        },
        children: [
          jsx(StatusDot, { tone: 'muted' }),
          'no stream',
        ],
      }),
    })
  }

  const hm = healthMeta(data?.health)
  const pulse = pulseOf(data)
  const nxt = nextMission(data)
  const waitN = pulse ? waitingOn(pulse).length : (data?.waiting_on_count || 0)
  const title = chipTitle(streamName, data)
  const tipBits = [
    title,
    pinned && pinned !== liveName ? `pinned (cwd: ${liveName || '—'})` : null,
    nxt ? `Next: ${nxt.title}` : data?.focus_label,
    waitN ? `${waitN} waiting-on` : null,
    isError ? `Error: ${errMsg(error)}` : null,
  ].filter(Boolean)

  return jsx(Popover, {
    open,
    onOpenChange: (v) => {
      setOpen(v)
      if (!v) setSwitching(false)
    },
    children: [
      jsx(PopoverTrigger, {
        key: 'trigger',
        children: jsxs('button', {
          type: 'button',
          title: tipBits.join(' · ') || streamName,
          className: cn(
            'inline-flex h-full max-w-[300px] items-center gap-1.5 rounded-none px-1.5',
            'text-[0.6875rem] tabular-nums transition-colors',
            'hover:bg-(--chrome-action-hover)',
            isFetching && !data && 'opacity-70'
          ),
          style: { color: 'var(--ui-text-secondary, var(--muted-foreground))' },
          children: [
            jsx(StatusDot, { tone: isError ? 'bad' : hm.tone }),
            jsx('span', { className: 'truncate font-medium', children: title }),
            nxt
              ? jsx('span', {
                  className: 'hidden sm:inline truncate max-w-[120px]',
                  style: { color: 'var(--ui-text-quaternary)' },
                  children: nxt.title,
                })
              : null,
            waitN
              ? jsx('span', {
                  className: 'hidden sm:inline tabular-nums shrink-0',
                  style: { color: 'var(--destructive)' },
                  children: waitN,
                })
              : null,
            pinned
              ? jsx('span', {
                  className: 'text-[9px] opacity-50 shrink-0',
                  children: '●',
                })
              : null,
          ],
        }),
      }),
      jsx(PopoverContent, {
        key: 'content',
        className: 'w-[26rem] max-h-[min(80vh,640px)] overflow-y-auto p-0',
        align: 'end',
        children: jsx(StreamPopover, {
          ctx,
          streamName,
          liveName,
          pinned,
          setPinned,
          switching,
          setSwitching,
          view,
          setView,
          morningDate,
          setMorningDate,
          fleet: fleet?.streams || [],
          data,
          isError,
          error,
          isFetching,
          onClose: () => {
            setOpen(false)
            setSwitching(false)
          },
          onRefresh: async () => {
            haptic('tap')
            try {
              await ctx.rest(
                `/stream?stream=${encodeURIComponent(streamName)}&check=true&force=true`
              )
            } catch {
              /* refetch below surfaces error */
            }
            await refetch()
            qc.invalidateQueries({ queryKey: [ID, 'list'] })
            qc.invalidateQueries({ queryKey: [ID, 'stream'] })
          },
          onMutated: async () => {
            await refetch()
            qc.invalidateQueries({ queryKey: [ID, 'list'] })
            qc.invalidateQueries({ queryKey: [ID, 'stream'] })
          },
        }),
      }),
    ],
  })
}

function Count({ n, label, tone }) {
  if (!n) return null
  return jsxs('span', {
    className: 'inline-flex items-center gap-1 text-[10px] tabular-nums',
    style: {
      color:
        tone === 'bad'
          ? 'var(--destructive)'
          : tone === 'warn'
            ? 'rgb(245 158 11)'
            : 'var(--ui-text-quaternary)',
    },
    children: [
      jsx('span', { className: 'font-semibold', children: n }),
      label,
    ],
  })
}

function StreamSwitcher({ fleet, streamName, liveName, onPick }) {
  if (!fleet.length) {
    return jsx(Muted, { className: 'px-3.5 py-2', children: 'Loading fleet…' })
  }
  return jsx('div', {
    className: 'max-h-44 overflow-y-auto border-b',
    style: { borderColor: 'var(--ui-stroke-secondary, var(--border))' },
    children: fleet.map(s => {
      const isCur = s.name === streamName
      const isLive = s.name === liveName
      const hm = healthMeta(s.health)
      return jsxs('button', {
        key: s.name,
        type: 'button',
        className: cn(
          'w-full text-left px-3.5 py-1.5 flex items-center gap-2 text-xs',
          'hover:bg-accent/10',
          isCur && 'bg-accent/10'
        ),
        onClick: () => {
          haptic('tap')
          onPick(s.name)
        },
        children: [
          jsx(StatusDot, { tone: hm.tone }),
          jsx('span', { className: 'flex-1 truncate font-medium', children: s.title || s.name }),
          isLive ? jsx(Muted, { children: 'cwd' }) : null,
          isCur ? jsx(Muted, { children: 'now' }) : null,
        ],
      })
    }),
  })
}

function StreamPopover({
  ctx,
  streamName,
  liveName,
  pinned,
  setPinned,
  switching,
  setSwitching,
  view,
  setView,
  morningDate,
  setMorningDate,
  fleet,
  data,
  isError,
  error,
  isFetching,
  onClose,
  onRefresh,
  onMutated,
}) {
  const pulse = pulseOf(data)
  const check = data?.check
  const hm = healthMeta(data?.health)
  const title = chipTitle(streamName, data)
  const nxt = nextMission(data)
  const waitN = pulse ? waitingOn(pulse).length : 0
  const viol = check?.violation_count || 0
  const dirty = check?.status === 'dirty' || check?.status === 'no_script' || viol > 0 || listsInvalid(data)
  const isPinned = pinned === streamName
  const tz = pulse?.timezone || 'Africa/Cairo'
  const today = todayISO(tz)
  const showMorning = Boolean(openMissions(pulse).length) && morningDate !== today && hasLists(data)

  if (isError && !data) {
    const msg = errMsg(error)
    const auth = /unauthenticated|Unauthorized|no_cookie|not logged in/i.test(msg)
    const missing = /not mounted|No such API|404/i.test(msg)
    return jsxs('div', {
      className: 'p-3 flex flex-col gap-2',
      children: [
        jsx('div', {
          className: 'text-xs font-semibold',
          style: { color: 'var(--destructive)' },
          children: auth
            ? 'Dashboard auth required'
            : missing
              ? 'Plugin API missing on this dashboard'
              : 'Failed to load stream',
        }),
        jsx('div', {
          className: 'text-xs break-words',
          style: { color: 'var(--ui-text-secondary)' },
          children: msg,
        }),
        jsxs('div', {
          className: 'flex gap-1.5',
          children: [
            jsx(Button, {
              size: 'sm',
              variant: 'secondary',
              onClick: onRefresh,
              children: 'Retry',
            }),
            jsx(Button, {
              size: 'sm',
              variant: 'ghost',
              onClick: onClose,
              children: 'Close',
            }),
          ],
        }),
      ],
    })
  }

  const tab = view === 'jobs' ? 'jobs' : 'glance'

  return jsxs('div', {
    className: 'flex flex-col',
    children: [
      jsxs('div', {
        className: 'px-3.5 pt-3 pb-2 flex flex-col gap-2',
        children: [
          jsxs('div', {
            className: 'flex items-center justify-between gap-2',
            children: [
              jsxs('button', {
                type: 'button',
                className: 'flex items-center gap-2 min-w-0 text-left hover:opacity-80',
                onClick: () => {
                  haptic('tap')
                  setSwitching(!switching)
                },
                children: [
                  jsx(StatusDot, { tone: hm.tone }),
                  jsx('span', {
                    className: 'font-semibold text-sm truncate',
                    children: title,
                  }),
                  jsx(Muted, { children: switching ? '▲' : '▼' }),
                ],
              }),
              jsxs('div', {
                className: 'flex items-center gap-1 shrink-0',
                children: [
                  pulse?.mode
                    ? jsx(Badge, { variant: 'muted', size: 'xs', children: pulse.mode })
                    : null,
                  data?.profile
                    ? jsx(Badge, { variant: 'muted', size: 'xs', children: `@${data.profile}` })
                    : null,
                  jsx(HealthBadge, { health: data?.health }),
                ],
              }),
            ],
          }),

          jsxs('div', {
            className: 'flex items-center gap-1',
            children: [
              jsx(Button, {
                size: 'xs',
                variant: tab === 'glance' ? 'secondary' : 'ghost',
                onClick: () => {
                  haptic('tap')
                  setView('glance')
                },
                children: 'Glance',
              }),
              jsx(Button, {
                size: 'xs',
                variant: tab === 'jobs' ? 'secondary' : 'ghost',
                disabled: listsInvalid(data),
                onClick: () => {
                  haptic('tap')
                  setView('jobs')
                },
                children: 'Jobs',
              }),
            ],
          }),

          jsxs('div', {
            className: 'flex items-center gap-2.5 flex-wrap',
            children: [
              jsx(Count, { n: waitN, label: 'waiting-on', tone: waitN ? 'bad' : null }),
              jsx(Count, {
                n: data?.blocker_count,
                label: 'blockers',
                tone: data?.blocker_count ? 'warn' : null,
              }),
              pulse?.updated_at
                ? jsx(Muted, { children: pulse.updated_at.slice(0, 10) })
                : data?.pulse?.updated
                  ? jsx(Muted, { children: data.pulse.updated })
                  : check?.checked_at
                    ? jsx(Muted, { children: ago(check.checked_at) })
                    : null,
            ],
          }),
        ],
      }),

      switching
        ? jsx(StreamSwitcher, {
            fleet,
            streamName,
            liveName,
            onPick: (name) => {
              setPinned(name)
              setSwitching(false)
            },
          })
        : null,

      listsInvalid(data)
        ? jsx(FailClosedBanner, { error: data?.lists?.error })
        : null,

      showMorning && tab === 'glance'
        ? jsx(MorningRec, {
            ctx,
            streamName,
            pulse,
            today,
            onDone: (d) => setMorningDate(d || today),
            onMutated,
          })
        : null,

      tab === 'jobs'
        ? jsx(JobsPane, {
            ctx,
            streamName,
            data,
            pulse,
            today,
            onMutated,
          })
        : jsx(GlancePane, {
            data,
            pulse,
            nxt,
            dirty,
            check,
          }),

      jsx(Separator, {}),

      jsxs('div', {
        className: 'flex gap-1.5 p-2',
        children: [
          jsx(Button, {
            size: 'sm',
            variant: 'secondary',
            disabled: isFetching,
            onClick: onRefresh,
            children: isFetching ? 'Checking…' : 'Recheck',
          }),
          jsx(Button, {
            size: 'sm',
            variant: isPinned ? 'secondary' : 'ghost',
            onClick: () => {
              haptic('tap')
              setPinned(isPinned ? '' : streamName)
            },
            children: isPinned ? 'Unpin' : 'Pin',
          }),
          jsx(Button, {
            size: 'sm',
            className: 'flex-1',
            onClick: () => {
              haptic('tap')
              onClose()
              host.navigate('/workstream-map')
            },
            children: 'Open page',
          }),
        ],
      }),
    ],
  })
}

function FailClosedBanner({ error }) {
  return jsxs('div', {
    className: 'mx-3.5 mb-2 rounded-[4px] px-2.5 py-2 flex flex-col gap-0.5',
    style: { background: 'color-mix(in oklab, var(--destructive) 12%, transparent)' },
    children: [
      jsx('div', {
        className: 'text-[11px] font-semibold',
        style: { color: 'var(--destructive)' },
        children: 'pulse.json invalid — not overwritten',
      }),
      jsx(Muted, { children: error || 'Fix the file by hand. Jobs disabled.' }),
    ],
  })
}

function GlancePane({ data, pulse, nxt, dirty, check }) {
  const nextTitle = nxt?.title || data?.pulse?.next_action || data?.focus_label || ''
  return jsxs('div', {
    className: 'px-3.5 pb-2.5 flex flex-col gap-2',
    children: [
      nextTitle
        ? jsxs('div', {
            className: 'rounded-[4px] px-2.5 py-2 flex flex-col gap-1',
            style: { background: 'var(--ui-stroke-secondary, var(--muted))' },
            children: [
              jsxs('div', {
                className: 'flex items-center justify-between gap-2',
                children: [
                  jsx(SectionLabel, { children: 'Next' }),
                  jsx('button', {
                    type: 'button',
                    className: 'text-[10px]',
                    style: { color: 'var(--ui-text-quaternary)' },
                    onClick: async () => {
                      haptic('tap')
                      const ok = await copyText(nextTitle)
                      host.notify({
                        kind: ok ? 'success' : 'error',
                        message: ok ? 'Copied next mission' : 'Copy failed',
                      })
                    },
                    children: 'Copy',
                  }),
                ],
              }),
              jsx('div', {
                className: 'text-xs leading-snug font-medium',
                style: { color: 'var(--ui-text-secondary, var(--muted-foreground))' },
                children: nextTitle,
              }),
              nxt?.status
                ? jsx(Muted, { children: nxt.status })
                : null,
            ],
          })
        : jsx(Muted, { children: hasLists(data) ? 'Pile is empty.' : 'No pulse yet — Jobs after first write.' }),
      dirty
        ? jsxs('div', {
            className: 'flex flex-col gap-1',
            children: [
              jsx(SectionLabel, { children: 'Checks' }),
              listsInvalid(data)
                ? jsx(Muted, { children: 'pulse.json invalid' })
                : jsx(ViolationList, { check }),
            ],
          })
        : null,
      !pulse && data?.pulse?.urls?.length
        ? jsx(Muted, { children: 'Glance from STATUS-LIVE — lists not mounted yet.' })
        : null,
    ],
  })
}

function MorningRec({ ctx, streamName, pulse, today, onDone, onMutated }) {
  const rec = recommendToday(pulse, pulse?.timezone)
  const [busy, setBusy] = useState(false)
  if (!rec.length) return null

  const pinToday = async (id, { swap } = {}) => {
    setBusy(true)
    haptic('tap')
    try {
      if (swap) {
        const open = (pulse?.missions || []).filter(m => m.status !== 'done' && m.status !== 'cancelled')
        const ids = [id, ...open.map(m => m.id).filter(x => x !== id)]
        await patchLists(ctx, streamName, { op: 'reorder', collection: 'missions', ids })
      }
      await patchLists(ctx, streamName, {
        op: 'patch_meta',
        meta: { today: { date: today, pinned_mission_ids: [id], accepted: true } },
      })
      onDone(today)
      await onMutated()
    } catch (e) {
      host.notify({ kind: 'error', message: errMsg(e) })
    } finally {
      setBusy(false)
    }
  }

  return jsxs('div', {
    className: 'mx-3.5 mb-2 rounded-[4px] border px-2.5 py-2 flex flex-col gap-1.5',
    style: { borderColor: 'var(--ui-stroke-secondary, var(--border))' },
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between',
        children: [
          jsx(SectionLabel, { children: 'Today?' }),
          jsx('button', {
            type: 'button',
            className: 'text-[10px]',
            style: { color: 'var(--ui-text-quaternary)' },
            disabled: busy,
            onClick: () => {
              haptic('tap')
              onDone(today)
            },
            children: 'Skip',
          }),
        ],
      }),
      rec.map(m =>
        jsxs('div', {
          key: m.id,
          className: 'flex items-center gap-2 text-xs',
          children: [
            jsx(StatusDot, { tone: statusTone(m.status) }),
            jsx('span', { className: 'flex-1 truncate', children: m.title }),
            m.due ? jsx(Muted, { children: m.due }) : null,
            jsx(Button, {
              size: 'xs',
              variant: 'ghost',
              disabled: busy,
              onClick: () => pinToday(m.id),
              children: 'Accept',
            }),
            jsx(Button, {
              size: 'xs',
              variant: 'ghost',
              disabled: busy,
              onClick: () => pinToday(m.id, { swap: true }),
              children: 'Swap',
            }),
          ],
        })
      ),
    ],
  })
}

function JobsPane({ ctx, streamName, data, pulse, today, onMutated }) {
  const [draft, setDraft] = useState('')
  const [noteLine, setNoteLine] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragId, setDragId] = useState('')

  if (listsInvalid(data)) {
    return jsx('div', {
      className: 'px-3.5 pb-2',
      children: jsx(Muted, { children: 'Jobs disabled until pulse.json is valid.' }),
    })
  }
  if (!hasLists(data) && !listsEmpty(data)) {
    return jsx('div', {
      className: 'px-3.5 pb-2',
      children: jsx(Muted, { children: 'no pulse yet — first add creates it' }),
    })
  }

  const items = openMissions(pulse)
  const revision = pulse?.revision

  const flip = async (m) => {
    const i = FLIP_CYCLE.indexOf(m.status)
    const next = FLIP_CYCLE[(i + 1) % FLIP_CYCLE.length]
    haptic('tap')
    setBusy(true)
    try {
      await patchLists(ctx, streamName, {
        op: 'upsert',
        collection: 'missions',
        id: m.id,
        record: { status: next },
        base_revision: revision,
      })
      await onMutated()
    } catch (e) {
      host.notify({ kind: 'error', message: errMsg(e) })
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    const title = draft.trim()
    if (!title) return
    haptic('tap')
    setBusy(true)
    try {
      await patchLists(ctx, streamName, {
        op: 'upsert',
        collection: 'missions',
        record: { title, status: 'todo' },
        base_revision: revision,
      })
      setDraft('')
      await onMutated()
    } catch (e) {
      host.notify({ kind: 'error', message: errMsg(e) })
    } finally {
      setBusy(false)
    }
  }

  const reorder = async (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return
    const ids = items.map(m => m.id)
    const from = ids.indexOf(fromId)
    const to = ids.indexOf(toId)
    if (from < 0 || to < 0) return
    ids.splice(from, 1)
    ids.splice(to, 0, fromId)
    haptic('tap')
    try {
      await patchLists(ctx, streamName, {
        op: 'reorder',
        collection: 'missions',
        ids,
        base_revision: revision,
      })
      await onMutated()
    } catch (e) {
      host.notify({ kind: 'error', message: errMsg(e) })
    }
  }

  return jsxs('div', {
    className: 'px-3.5 pb-2 flex flex-col gap-1.5',
    children: [
      items.length
        ? items.map(m => {
            const blk = m.status === 'blocked' ? blockerById(pulse, m.blocker_id) : null
            const rel = (m.related || []).map(id => resourceById(pulse, id)).filter(Boolean)
            return jsxs('div', {
              key: m.id,
              className: cn(
                'flex flex-col gap-0.5 rounded-[4px] px-2 py-1.5',
                dragId === m.id && 'opacity-60'
              ),
              style: { background: 'var(--ui-stroke-secondary, var(--muted))' },
              draggable: true,
              onDragStart: () => setDragId(m.id),
              onDragOver: (e) => {
                e.preventDefault()
              },
              onDrop: (e) => {
                e.preventDefault()
                const from = dragId
                setDragId('')
                void reorder(from, m.id)
              },
              onDragEnd: () => setDragId(''),
              children: [
                jsxs('div', {
                  className: 'flex items-center gap-1.5 text-xs min-w-0',
                  children: [
                    jsx('span', {
                      className: 'cursor-grab shrink-0 text-[10px]',
                      style: { color: 'var(--ui-text-quaternary)' },
                      children: '⋮⋮',
                    }),
                    jsx(StatusDot, { tone: statusTone(m.status) }),
                    jsx('span', { className: 'flex-1 truncate font-medium', children: m.title }),
                    isOverdue(m, today) || m.due
                      ? jsx(Muted, { children: m.due })
                      : null,
                    jsx('button', {
                      type: 'button',
                      className: 'text-[10px] shrink-0 uppercase tracking-wide',
                      style: { color: 'var(--ui-text-quaternary)' },
                      disabled: busy,
                      onClick: () => flip(m),
                      children: m.status,
                    }),
                  ],
                }),
                blk
                  ? jsx('div', {
                      className: 'pl-5 text-[10px]',
                      style: { color: 'var(--destructive)' },
                      children: `stuck · ${blk.title}`,
                    })
                  : null,
                rel.length
                  ? jsx('div', {
                      className: 'pl-5 flex gap-1.5 flex-wrap',
                      children: rel.slice(0, 3).map(r =>
                        jsx('button', {
                          key: r.id,
                          type: 'button',
                          className: 'text-[10px] underline-offset-2 hover:underline',
                          style: { color: 'var(--ui-text-quaternary)' },
                          onClick: (e) => {
                            e.stopPropagation()
                            haptic('tap')
                            const href = String(r.url || '')
                            if (/^https?:\/\//i.test(href)) {
                              try {
                                if (typeof host.open === 'function') host.open(href)
                                else window.open(href, '_blank', 'noopener')
                              } catch { /* ignore */ }
                            }
                          },
                          children: r.title,
                        })
                      ),
                    })
                  : null,
              ],
            })
          })
        : jsx(Muted, { children: 'No open missions. Add one.' }),
      jsxs('form', {
        className: 'flex gap-1.5 mt-1',
        onSubmit: (e) => {
          e.preventDefault()
          void add()
        },
        children: [
          jsx(Input, {
            value: draft,
            onChange: (e) => setDraft(e.target.value),
            placeholder: 'Add a mission…',
            className: 'h-7 text-xs',
            disabled: busy,
          }),
          jsx(Button, {
            size: 'xs',
            type: 'submit',
            disabled: busy || !draft.trim(),
            children: 'Add',
          }),
        ],
      }),
      jsxs('form', {
        className: 'flex gap-1.5',
        onSubmit: async (e) => {
          e.preventDefault()
          const text = noteLine.trim()
          if (!text) return
          haptic('tap')
          setBusy(true)
          try {
            await patchLists(ctx, streamName, { op: 'add_note', text, base_revision: revision })
            setNoteLine('')
            await onMutated()
          } catch (err) {
            host.notify({ kind: 'error', message: errMsg(err) })
          } finally {
            setBusy(false)
          }
        },
        children: [
          jsx(Input, {
            value: noteLine,
            onChange: (e) => setNoteLine(e.target.value),
            placeholder: 'Drop a note…',
            className: 'h-7 text-xs',
            disabled: busy,
          }),
          jsx(Button, {
            size: 'xs',
            type: 'submit',
            disabled: busy || !noteLine.trim(),
            children: 'Note',
          }),
        ],
      }),
    ],
  })
}
