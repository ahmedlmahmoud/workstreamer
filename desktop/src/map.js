/** @section page */
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  SearchField,
  SegmentedControl,
  Skeleton,
  StatusDot,
  cn,
  haptic,
  host,
  useQuery,
  useQueryClient,
  useValue,
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useMemo, useState } from 'react'
import {
  CoreChecklist,
  DetailCard,
  HealthBadge,
  Muted,
  SectionLabel,
  StatChip,
  ViolationList,
} from './atoms.js'
import { FILTERS, ID, STORAGE_KEYS } from './constants.js'
import { ago, errMsg, extractStreamName, titleCase } from './format.js'
import { healthMeta } from './health.js'
import {
  blockerById,
  listsInvalid,
  nextMission,
  openMissions,
  patchLists,
  pulseOf,
  resourceById,
  sortedMissions,
  statusTone,
  stuckOn,
  todayISO,
  waitingOn,
} from './lists.js'
import { usePersisted } from './persist.js'

export function WorkstreamPage({ ctx }) {
  const cwd = useValue(host.state.cwd)
  const activeStream = extractStreamName(cwd)
  const [filter, setFilter] = usePersisted(ctx, STORAGE_KEYS.filter, 'all')
  const [selected, setSelected] = usePersisted(ctx, STORAGE_KEYS.selected, '')
  const [query, setQuery] = useState('')
  const qc = useQueryClient()

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: [ID, 'list'],
    queryFn: () => ctx.rest('/list?pulse=true&check=false'),
    refetchInterval: 60_000,
    retry: 1,
  })

  const selectedName = selected || activeStream || ''

  const {
    data: detail,
    isFetching: detailFetching,
    isError: detailError,
    error: detailErr,
    refetch: refetchDetail,
  } = useQuery({
    queryKey: [ID, 'stream', selectedName || 'none'],
    queryFn: async () => {
      if (!selectedName) return null
      return ctx.rest(
        `/stream?stream=${encodeURIComponent(selectedName)}&check=true`
      )
    },
    enabled: Boolean(selectedName),
    refetchInterval: 60_000,
    retry: 1,
  })

  useEffect(() => {
    if (activeStream && !selected) setSelected(activeStream)
  }, [activeStream]) // eslint-disable-line react-hooks/exhaustive-deps

  const streams = useMemo(() => {
    const all = Array.isArray(data?.streams) ? data.streams : []
    const q = query.trim().toLowerCase()
    let list = all
    if (filter === 'adopted') list = list.filter(s => s.adopted)
    else if (filter === 'bare') list = list.filter(s => s.health === 'bare')
    else if (filter === 'issues') {
      list = list.filter(
        s =>
          ['dirty', 'degraded', 'partial', 'stale'].includes(s.health) ||
          (s.down_url_count || 0) > 0 ||
          (s.blocker_count || 0) > 0 ||
          s.lists_ok === false
      )
    }
    if (q) {
      list = list.filter(s => {
        const hay = `${s.name} ${s.title || ''} ${s.profile || ''} ${s.focus_label || ''}`.toLowerCase()
        return hay.includes(q)
      })
    }
    return list
  }, [data, filter, query])

  const stats = data?.stats || {}

  const refreshAll = async () => {
    haptic('tap')
    await refetch()
    if (selectedName) {
      try {
        await ctx.rest(
          `/stream?stream=${encodeURIComponent(selectedName)}&check=true&force=true`
        )
      } catch {
        /* ignore */
      }
      await refetchDetail()
    }
    qc.invalidateQueries({ queryKey: [ID] })
  }

  if (isLoading) {
    return jsxs('div', {
      className: 'flex h-full min-h-0 w-full',
      children: [
        jsxs('div', {
          className: 'w-72 shrink-0 border-r p-3 flex flex-col gap-2',
          style: { borderColor: 'var(--ui-stroke-secondary, var(--border))' },
          children: [
            jsx(Skeleton, { className: 'h-4 w-1/2' }),
            jsx(Skeleton, { className: 'h-8 w-full' }),
            jsx(Skeleton, { className: 'h-10 w-full' }),
          ],
        }),
        jsxs('div', {
          className: 'flex-1 p-6 flex flex-col gap-3',
          children: [
            jsx(Skeleton, { className: 'h-8 w-1/3' }),
            jsx(Skeleton, { className: 'h-32 w-full' }),
          ],
        }),
      ],
    })
  }

  if (isError) {
    return jsx('div', {
      className: 'p-8 h-full flex items-center justify-center',
      children: jsx(ErrorState, {
        title: /No such API|not mounted/i.test(errMsg(error))
          ? 'Backend not installed on this dashboard'
          : /unauthenticated|Unauthorized|no_cookie/i.test(errMsg(error))
            ? 'Dashboard auth required'
            : 'Workstreams failed to load',
        description: errMsg(error),
        children: jsx(Button, {
          size: 'sm',
          variant: 'secondary',
          onClick: () => {
            haptic('tap')
            refetch()
          },
          children: isFetching ? 'Retrying…' : 'Retry',
        }),
      }),
    })
  }

  return jsxs('div', {
    className: 'flex h-full min-h-0 w-full min-w-0',
    children: [
      jsx(StreamSidebar, {
        streams,
        stats,
        count: data?.count || 0,
        filter,
        setFilter,
        query,
        setQuery,
        selectedName,
        setSelected,
        activeStream,
        isFetching,
        onRefresh: refreshAll,
        emptyTitle: filter === 'all' && !query ? 'No workstreams' : 'No matches',
        emptyDesc:
          filter === 'all' && !query
            ? data?.root || 'workstreams/ is empty'
            : `Nothing matches “${query || filter}”`,
      }),
      jsx(StreamDetail, {
        selectedName,
        detail,
        detailFetching,
        detailError,
        detailErr,
        refetchDetail,
        ctx,
        onClear: () => setSelected(''),
      }),
    ],
  })
}

function StreamSidebar({
  streams,
  stats,
  count,
  filter,
  setFilter,
  query,
  setQuery,
  selectedName,
  setSelected,
  activeStream,
  isFetching,
  onRefresh,
  emptyTitle,
  emptyDesc,
}) {
  return jsxs('aside', {
    className: 'flex h-full min-h-0 w-72 shrink-0 flex-col border-r',
    style: { borderColor: 'var(--ui-stroke-secondary, var(--border))' },
    children: [
      jsxs('div', {
        className: 'shrink-0 px-3 py-2.5 flex flex-col gap-2 border-b',
        style: { borderColor: 'var(--ui-stroke-secondary, var(--border))' },
        children: [
          jsxs('div', {
            className: 'flex items-center justify-between gap-2',
            children: [
              jsx('span', {
                className: 'text-xs font-semibold tracking-tight',
                children: 'Workstreams',
              }),
              jsx(Button, {
                size: 'xs',
                variant: 'ghost',
                onClick: onRefresh,
                children: isFetching ? '…' : '↻',
              }),
            ],
          }),
          jsxs('div', {
            className: 'flex gap-1 flex-wrap',
            children: [
              jsx(StatChip, { label: 'total', value: count }),
              jsx(StatChip, { label: 'adopted', value: stats.adopted || 0, tone: 'good' }),
              (stats.issues || 0) > 0
                ? jsx(StatChip, { label: 'issues', value: stats.issues, tone: 'bad' })
                : null,
            ],
          }),
          jsx(SegmentedControl, {
            value: filter,
            onChange: id => {
              haptic('tap')
              setFilter(id)
            },
            options: FILTERS,
            className: 'w-full',
          }),
          jsx(SearchField, {
            value: query,
            onChange: setQuery,
            placeholder: 'Filter…',
            containerClassName: 'w-full',
          }),
        ],
      }),
      jsx('div', {
        className: 'min-h-0 flex-1 overflow-y-auto overflow-x-hidden',
        children:
          streams.length === 0
            ? jsx(EmptyState, { className: 'min-h-32', title: emptyTitle, description: emptyDesc })
            : streams.map(s => {
                const isActive = s.name === activeStream
                const isSel = s.name === selectedName
                const hm = healthMeta(s.health)
                return jsxs('button', {
                  key: s.name,
                  type: 'button',
                  className: cn(
                    'w-full text-left px-3 py-2 border-b transition-colors',
                    'hover:bg-accent/10',
                    isSel && 'bg-accent/10'
                  ),
                  style: { borderColor: 'var(--ui-stroke-secondary, var(--border))' },
                  onClick: () => {
                    haptic('tap')
                    setSelected(s.name)
                  },
                  children: [
                    jsxs('div', {
                      className: 'flex items-center gap-2 text-xs min-w-0',
                      children: [
                        jsx(StatusDot, { tone: isActive ? 'good' : hm.tone }),
                        jsx('span', {
                          className: cn('flex-1 truncate font-medium', isActive && 'underline decoration-dotted'),
                          children: s.title || s.name,
                        }),
                        jsx(Muted, { className: 'shrink-0', children: hm.short }),
                      ],
                    }),
                    s.focus_label
                      ? jsx('div', {
                          className: 'mt-0.5 pl-4 text-[10px] truncate',
                          style: { color: 'var(--ui-text-quaternary)' },
                          children: s.focus_label,
                        })
                      : null,
                    s.blocker_count || s.waiting_on_count
                      ? jsxs('div', {
                          className: 'mt-0.5 pl-4 flex gap-2 text-[10px]',
                          children: [
                            s.waiting_on_count
                              ? jsx('span', {
                                  style: { color: 'var(--destructive)' },
                                  children: `${s.waiting_on_count} waiting`,
                                })
                              : null,
                            s.blocker_count
                              ? jsx('span', {
                                  style: { color: 'rgb(245 158 11)' },
                                  children: `${s.blocker_count} blocker${s.blocker_count === 1 ? '' : 's'}`,
                                })
                              : null,
                          ],
                        })
                      : null,
                  ],
                })
              }),
      }),
    ],
  })
}

function StreamDetail({
  selectedName,
  detail,
  detailFetching,
  detailError,
  detailErr,
  refetchDetail,
  ctx,
  onClear,
}) {
  const [tab, setTab] = usePersisted(ctx, STORAGE_KEYS.pageTab, 'missions')
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  const [openId, setOpenId] = useState('')

  if (!selectedName) {
    return jsx('div', {
      className: 'flex-1 min-w-0 min-h-0 flex items-center justify-center p-8',
      children: jsx(EmptyState, {
        title: 'Select a workstream',
        description: 'Pick one on the left to see the picture.',
      }),
    })
  }

  if (detailError && !detail) {
    return jsx('div', {
      className: 'flex-1 min-w-0 p-8 flex items-center justify-center',
      children: jsx(ErrorState, {
        title: 'Could not load stream',
        description: errMsg(detailErr),
        children: jsx(Button, {
          size: 'sm',
          variant: 'secondary',
          onClick: () => { haptic('tap'); refetchDetail() },
          children: 'Retry',
        }),
      }),
    })
  }

  if (!detail) {
    return jsxs('div', {
      className: 'flex-1 min-w-0 p-6 flex flex-col gap-3',
      children: [
        jsx(Skeleton, { className: 'h-8 w-48' }),
        jsx(Skeleton, { className: 'h-24 w-full' }),
      ],
    })
  }

  const pulse = pulseOf(detail)
  const hm = healthMeta(detail.health)
  const title = detail.title || titleCase(selectedName)
  const nxt = nextMission(detail)
  const invalid = listsInvalid(detail)
  const wait = waitingOn(pulse)
  const stuck = stuckOn(pulse)
  const resources = pulse?.resources || []
  const notes = pulse?.notes || []
  const timeline = (pulse?.timeline || []).slice().reverse()
  const locks = pulse?.locks || []
  const pipe = pulse?.pipeline || []
  const today = todayISO(pulse?.timezone)

  const mutate = async (op) => {
    setBusy(true)
    haptic('tap')
    try {
      await patchLists(ctx, selectedName, { ...op, base_revision: pulse?.revision })
      await refetchDetail()
    } catch (e) {
      host.notify({ kind: 'error', message: errMsg(e) })
    } finally {
      setBusy(false)
    }
  }

  const LABELS = {
    missions: 'Missions',
    blockers: 'Blockers',
    resources: 'Resources',
    health: 'Health',
    ship: 'Ship',
    pipeline: 'Pipeline',
    milestones: 'Milestones',
    'waiting-on': 'Waiting-on',
    checks: 'Checks',
    locks: 'Locks',
    notes: 'Notes',
    timeline: 'Timeline',
  }
  const earned = Array.isArray(detail.widgets) && detail.widgets.length
    ? detail.widgets
    : ['missions', 'blockers', 'resources', 'notes', 'timeline']
  const tabs = earned.map(id => ({ id, label: LABELS[id] || id }))

  const activeTab = tabs.some(t => t.id === tab) ? tab : 'missions'

  return jsxs('div', {
    className: 'flex-1 min-w-0 min-h-0 flex flex-col',
    children: [
      jsxs('header', {
        className: 'shrink-0 px-6 py-4 flex flex-col gap-3 border-b',
        style: { borderColor: 'var(--ui-stroke-secondary, var(--border))' },
        children: [
          jsxs('div', {
            className: 'flex items-start justify-between gap-4',
            children: [
              jsxs('div', {
                className: 'min-w-0 flex flex-col gap-1.5',
                children: [
                  jsxs('div', {
                    className: 'flex items-center gap-2.5 min-w-0',
                    children: [
                      jsx(StatusDot, { tone: hm.tone }),
                      jsx('h1', { className: 'text-base font-semibold truncate', children: title }),
                      jsx(HealthBadge, { health: detail.health }),
                      pulse?.mode
                        ? jsx(Badge, { variant: 'muted', size: 'xs', children: pulse.mode })
                        : null,
                      detail.profile
                        ? jsx(Badge, { variant: 'muted', size: 'xs', children: `@${detail.profile}` })
                        : null,
                    ],
                  }),
                  nxt
                    ? jsxs('div', {
                        className: 'text-xs leading-snug',
                        style: { color: 'var(--ui-text-secondary, var(--muted-foreground))' },
                        children: [
                          jsx('span', { style: { color: 'var(--ui-text-quaternary)' }, children: 'Next · ' }),
                          nxt.title,
                        ],
                      })
                    : detail.focus_label
                      ? jsx(Muted, { children: `Focus · ${detail.focus_label}` })
                      : null,
                  jsxs('div', {
                    className: 'flex items-center gap-3 flex-wrap',
                    children: [
                      detail.repo
                        ? jsx(Muted, { children: detail.repo.replace(/^https:\/\/github.com\//, '') })
                        : null,
                      pulse?.updated_at
                        ? jsx(Muted, { children: `lists · r${pulse.revision}` })
                        : jsx(Muted, { children: 'No pulse.json' }),
                      detail.check?.checked_at
                        ? jsx(Muted, { children: `Checked ${ago(detail.check.checked_at)}` })
                        : null,
                    ],
                  }),
                ],
              }),
              jsxs('div', {
                className: 'flex gap-1.5 shrink-0',
                children: [
                  jsx(Button, {
                    size: 'sm',
                    variant: 'secondary',
                    disabled: detailFetching,
                    onClick: async () => {
                      haptic('tap')
                      try {
                        await ctx.rest(`/stream?stream=${encodeURIComponent(selectedName)}&check=true&force=true`)
                      } catch { /* */ }
                      await refetchDetail()
                    },
                    children: detailFetching ? '…' : 'Recheck',
                  }),
                  jsx(Button, { size: 'sm', variant: 'ghost', onClick: onClear, children: 'Clear' }),
                ],
              }),
            ],
          }),
          invalid
            ? jsx('div', {
                className: 'text-xs',
                style: { color: 'var(--destructive)' },
                children: `pulse.json invalid — ${detail.lists?.error || 'not overwritten'}`,
              })
            : null,
          jsx('div', {
            className: 'flex gap-1 flex-wrap',
            children: tabs.map(t =>
              jsx(Button, {
                key: t.id,
                size: 'xs',
                variant: activeTab === t.id ? 'secondary' : 'ghost',
                onClick: () => { haptic('tap'); setTab(t.id) },
                children: t.label,
              })
            ),
          }),
        ],
      }),

      jsx('div', {
        className: 'min-h-0 flex-1 overflow-y-auto p-6',
        children:
          activeTab === 'missions'
            ? jsx(MissionsPicture, {
                pulse, today, busy, draft, setDraft, openId, setOpenId, mutate, invalid,
              })
            : activeTab === 'blockers' || activeTab === 'waiting-on'
              ? jsx(BlockersPicture, { wait, stuck, mutate, busy })
              : activeTab === 'resources'
                ? jsx(ResourcesPicture, { resources })
                : activeTab === 'health'
                  ? jsx(HealthPicture, { resources })
                  : activeTab === 'ship'
                    ? jsx(ShipPicture, { resources, repo: detail.repo })
                    : activeTab === 'milestones'
                      ? jsx(MilestonesPicture, { milestones: detail.pulse?.milestones || [] })
                      : activeTab === 'pipeline'
                        ? jsx(PipelinePicture, { pipe, pulse })
                        : activeTab === 'locks'
                          ? jsx(LocksPicture, { locks })
                          : activeTab === 'checks'
                            ? jsxs('div', {
                                className: 'grid grid-cols-1 xl:grid-cols-2 gap-3',
                                children: [
                                  jsx(DetailCard, { title: 'Constitution', children: jsx(CoreChecklist, { core: detail.core }) }),
                                  jsx(DetailCard, { title: 'Checks', children: jsx(ViolationList, { check: detail.check }) }),
                                ],
                              })
                            : jsx(NotesPicture, {
                                notes, timeline, noteDraft, setNoteDraft, mutate, busy,
                              }),
      }),
    ],
  })
}

function MissionsPicture({ pulse, today, busy, draft, setDraft, openId, setOpenId, mutate, invalid }) {
  if (invalid) return jsx(Muted, { children: 'Jobs disabled — pulse.json is invalid.' })
  const items = sortedMissions(pulse)
  const open = openMissions(pulse)
  return jsxs('div', {
    className: 'flex flex-col gap-3 max-w-3xl',
    children: [
      jsxs('form', {
        className: 'flex gap-2',
        onSubmit: (e) => {
          e.preventDefault()
          const title = draft.trim()
          if (!title) return
          void mutate({ op: 'upsert', collection: 'missions', record: { title, status: 'todo' } })
          setDraft('')
        },
        children: [
          jsx(Input, {
            value: draft,
            onChange: (e) => setDraft(e.target.value),
            placeholder: 'Add a mission…',
            className: 'h-8 text-xs',
            disabled: busy,
          }),
          jsx(Button, { size: 'sm', type: 'submit', disabled: busy || !draft.trim(), children: 'Add' }),
        ],
      }),
      open.length
        ? open.map(m => jsx(MissionRow, {
            key: m.id,
            m,
            pulse,
            today,
            open: openId === m.id,
            onToggle: () => setOpenId(openId === m.id ? '' : m.id),
            mutate,
            busy,
          }))
        : jsx(Muted, { children: 'No open missions.' }),
      items.some(m => m.status === 'done' || m.status === 'cancelled')
        ? jsxs('div', {
            className: 'flex flex-col gap-1 pt-2',
            children: [
              jsx(SectionLabel, { children: 'Closed' }),
              items.filter(m => m.status === 'done' || m.status === 'cancelled').map(m =>
                jsxs('div', {
                  key: m.id,
                  className: 'flex items-center gap-2 text-xs py-1',
                  children: [
                    jsx(StatusDot, { tone: statusTone(m.status) }),
                    jsx('span', { className: 'flex-1 truncate', style: { color: 'var(--ui-text-quaternary)' }, children: m.title }),
                    jsx(Button, {
                      size: 'xs',
                      variant: 'ghost',
                      disabled: busy,
                      onClick: () => mutate({ op: 'upsert', collection: 'missions', id: m.id, record: { status: 'todo' } }),
                      children: 'reopen',
                    }),
                  ],
                })
              ),
            ],
          })
        : null,
    ],
  })
}

function MissionRow({ m, pulse, today, open, onToggle, mutate, busy }) {
  const blk = m.status === 'blocked' ? blockerById(pulse, m.blocker_id) : null
  const rel = (m.related || []).map(id => resourceById(pulse, id)).filter(Boolean)
  const [why, setWhy] = useState(m.note || '')
  useEffect(() => { setWhy(m.note || '') }, [m.note, m.id])

  return jsxs('div', {
    className: 'rounded-md border px-3 py-2 flex flex-col gap-1.5',
    style: { borderColor: 'var(--ui-stroke-secondary, var(--border))' },
    children: [
      jsxs('div', {
        className: 'flex items-center gap-2 text-xs min-w-0',
        children: [
          jsx(StatusDot, { tone: statusTone(m.status) }),
          jsx('button', {
            type: 'button',
            className: 'flex-1 text-left font-medium truncate hover:opacity-80',
            onClick: onToggle,
            children: m.title,
          }),
          m.due
            ? jsx(Muted, { children: String(m.due) < today ? `overdue ${m.due}` : m.due })
            : null,
          jsx(Badge, { variant: 'muted', size: 'xs', children: m.status }),
        ],
      }),
      blk
        ? jsx('div', {
            className: 'text-[10px]',
            style: { color: 'var(--destructive)' },
            children: `stuck-on · ${blk.title}`,
          })
        : null,
      open
        ? jsxs('div', {
            className: 'flex flex-col gap-2 pt-1',
            children: [
              m.goals?.length
                ? jsx('div', {
                    className: 'flex flex-col gap-0.5',
                    children: m.goals.map((g, i) =>
                      jsx('div', {
                        key: i,
                        className: 'text-[11px]',
                        style: { color: 'var(--ui-text-secondary)' },
                        children: `· ${g}`,
                      })
                    ),
                  })
                : null,
              rel.length
                ? jsx('div', {
                    className: 'flex gap-1.5 flex-wrap',
                    children: rel.map(r =>
                      jsx(Button, {
                        key: r.id,
                        size: 'xs',
                        variant: 'ghost',
                        onClick: () => {
                          const href = String(r.url || '')
                          if (/^https?:\/\//i.test(href)) {
                            try {
                              if (typeof host.open === 'function') host.open(href)
                              else window.open(href, '_blank', 'noopener')
                            } catch { /* */ }
                          }
                        },
                        children: r.title,
                      })
                    ),
                  })
                : null,
              jsxs('div', {
                className: 'flex gap-1.5',
                children: [
                  jsx(Input, {
                    value: why,
                    onChange: (e) => setWhy(e.target.value),
                    placeholder: 'Why / note…',
                    className: 'h-7 text-xs',
                  }),
                  jsx(Button, {
                    size: 'xs',
                    variant: 'secondary',
                    disabled: busy,
                    onClick: () => mutate({
                      op: 'upsert',
                      collection: 'missions',
                      id: m.id,
                      record: { note: why },
                    }),
                    children: 'Save',
                  }),
                ],
              }),
              jsxs('div', {
                className: 'flex gap-1 flex-wrap',
                children: ['todo', 'doing', 'later', 'done', 'cancelled'].map(st =>
                  jsx(Button, {
                    key: st,
                    size: 'xs',
                    variant: m.status === st ? 'secondary' : 'ghost',
                    disabled: busy,
                    onClick: () => mutate({
                      op: 'upsert',
                      collection: 'missions',
                      id: m.id,
                      record: { status: st },
                    }),
                    children: st,
                  })
                ),
              }),
            ],
          })
        : null,
    ],
  })
}

function BlockersPicture({ wait, stuck, mutate, busy }) {
  const groups = [
    { id: 'waiting-on', label: 'Waiting-on', items: wait },
    { id: 'stuck-on', label: 'Stuck-on', items: stuck },
  ]
  return jsx('div', {
    className: 'grid grid-cols-1 xl:grid-cols-2 gap-3 items-start',
    children: groups.map(g =>
      jsx(DetailCard, {
        key: g.id,
        title: g.label,
        children: g.items.length
          ? g.items.map(b =>
              jsxs('div', {
                key: b.id,
                className: 'flex flex-col gap-1 py-1.5 border-b last:border-0 text-xs',
                style: { borderColor: 'var(--ui-stroke-secondary, var(--border))' },
                children: [
                  jsxs('div', {
                    className: 'flex items-center gap-2',
                    children: [
                      jsx(StatusDot, { tone: g.id === 'waiting-on' ? 'warn' : 'bad' }),
                      jsx('span', { className: 'flex-1 font-medium', children: b.title }),
                      jsx(Button, {
                        size: 'xs',
                        variant: 'ghost',
                        disabled: busy,
                        onClick: () => mutate({
                          op: 'upsert',
                          collection: 'blockers',
                          id: b.id,
                          record: { status: 'resolved' },
                        }),
                        children: 'resolve',
                      }),
                    ],
                  }),
                  b.waiting_on ? jsx(Muted, { children: b.waiting_on }) : null,
                  b.note ? jsx('div', { style: { color: 'var(--ui-text-secondary)' }, children: b.note }) : null,
                ],
              })
            )
          : jsx(Muted, { children: `No ${g.label.toLowerCase()}.` }),
      })
    ),
  })
}

function ResourcesPicture({ resources }) {
  if (!resources.length) {
    return jsx(Muted, { children: 'No resources on this stream.' })
  }
  return jsx('div', {
    className: 'flex flex-col gap-1 max-w-2xl',
    children: resources.map(r =>
      jsxs('div', {
        key: r.id,
        className: 'flex items-center gap-2 py-1.5 text-xs border-b',
        style: { borderColor: 'var(--ui-stroke-secondary, var(--border))' },
        children: [
          jsx(StatusDot, {
            tone: r.status === 'down' ? 'bad' : r.status === 'up' || r.status === 'merged' ? 'good' : 'muted',
          }),
          jsx('span', { className: 'font-medium truncate flex-1', children: r.title }),
          jsx(Muted, { children: r.kind }),
          /^https?:\/\//i.test(r.url || '')
            ? jsx(Button, {
                size: 'xs',
                variant: 'ghost',
                onClick: () => {
                  haptic('tap')
                  try {
                    if (typeof host.open === 'function') host.open(r.url)
                    else window.open(r.url, '_blank', 'noopener')
                  } catch { /* */ }
                },
                children: 'Open',
              })
            : jsx(Muted, { children: r.url || '' }),
        ],
      })
    ),
  })
}

function PipelinePicture({ pipe, pulse }) {
  const missions = sortedMissions(pulse)
  return jsxs('div', {
    className: 'flex flex-col gap-3',
    children: [
      jsx('div', {
        className: 'flex gap-1.5 flex-wrap',
        children: pipe.map((stage, i) =>
          jsxs('div', {
            key: stage,
            className: 'px-2 py-1 rounded-[4px] text-[11px]',
            style: { background: 'var(--ui-stroke-secondary, var(--muted))' },
            children: [
              jsx('span', { style: { color: 'var(--ui-text-quaternary)' }, children: `${i + 1} ` }),
              stage,
            ],
          })
        ),
      }),
      jsx(Muted, { children: `${missions.filter(m => m.status === 'doing').length} doing · ${missions.filter(m => m.status === 'done').length} done` }),
    ],
  })
}

function LocksPicture({ locks }) {
  return jsx('div', {
    className: 'flex flex-col gap-2 max-w-2xl',
    children: locks.map(k =>
      jsxs('div', {
        key: k.id,
        className: 'text-xs flex flex-col gap-0.5 py-1.5 border-b',
        style: { borderColor: 'var(--ui-stroke-secondary, var(--border))' },
        children: [
          jsx('span', { className: 'font-medium', children: k.title }),
          k.decided ? jsx(Muted, { children: `decided ${k.decided}` }) : null,
        ],
      })
    ),
  })
}

function NotesPicture({ notes, timeline, noteDraft, setNoteDraft, mutate, busy }) {
  return jsxs('div', {
    className: 'grid grid-cols-1 xl:grid-cols-2 gap-3 items-start',
    children: [
      jsx(DetailCard, {
        title: 'Notes',
        children: jsxs('div', {
          className: 'flex flex-col gap-2',
          children: [
            jsxs('form', {
              className: 'flex gap-1.5',
              onSubmit: (e) => {
                e.preventDefault()
                const text = noteDraft.trim()
                if (!text) return
                void mutate({ op: 'add_note', text })
                setNoteDraft('')
              },
              children: [
                jsx(Input, {
                  value: noteDraft,
                  onChange: (e) => setNoteDraft(e.target.value),
                  placeholder: 'Add a note…',
                  className: 'h-7 text-xs',
                }),
                jsx(Button, { size: 'xs', type: 'submit', disabled: busy || !noteDraft.trim(), children: 'Add' }),
              ],
            }),
            notes.slice().reverse().map(n =>
              jsxs('div', {
                key: n.id,
                className: 'text-xs flex flex-col gap-0.5',
                children: [
                  jsx(Muted, { children: String(n.at || '').slice(0, 16) }),
                  jsx('span', { style: { color: 'var(--ui-text-secondary)' }, children: n.text }),
                ],
              })
            ),
          ],
        }),
      }),
      jsx(DetailCard, {
        title: 'Timeline',
        children: timeline.length
          ? timeline.slice(0, 24).map(e =>
              jsxs('div', {
                key: e.id,
                className: 'flex items-center gap-2 text-[11px] py-0.5',
                children: [
                  jsx(Muted, { className: 'shrink-0', children: String(e.at || '').slice(5, 16) }),
                  jsx('span', { children: e.kind }),
                  e.detail ? jsx(Muted, { children: e.detail }) : null,
                ],
              })
            )
          : jsx(Muted, { children: 'No events yet.' }),
      }),
    ],
  })
}


function HealthPicture({ resources }) {
  const urls = (resources || []).filter(r => r.kind === 'url')
  if (!urls.length) return jsx(Muted, { children: 'No URL resources.' })
  return jsx('div', {
    className: 'flex flex-col gap-1 max-w-2xl',
    children: urls.map(r =>
      jsxs('div', {
        key: r.id,
        className: 'flex items-center gap-2 py-1.5 text-xs border-b',
        style: { borderColor: 'var(--ui-stroke-secondary, var(--border))' },
        children: [
          jsx(StatusDot, { tone: r.status === 'down' ? 'bad' : r.status === 'up' ? 'good' : 'muted' }),
          jsx('span', { className: 'flex-1 font-medium truncate', children: r.title }),
          jsx(Muted, { children: r.status || 'unknown' }),
          /^https?:\/\//i.test(r.url || '')
            ? jsx(Button, {
                size: 'xs',
                variant: 'ghost',
                onClick: () => {
                  haptic('tap')
                  try {
                    if (typeof host.open === 'function') host.open(r.url)
                    else window.open(r.url, '_blank', 'noopener')
                  } catch { /* */ }
                },
                children: 'Open',
              })
            : null,
        ],
      })
    ),
  })
}

function ShipPicture({ resources, repo }) {
  const prs = (resources || []).filter(r => r.kind === 'pr')
  return jsxs('div', {
    className: 'flex flex-col gap-2 max-w-2xl',
    children: [
      repo ? jsx(Muted, { children: String(repo).replace(/^https:\/\/github.com\//, '') }) : null,
      prs.length
        ? prs.map(r =>
            jsxs('div', {
              key: r.id,
              className: 'flex items-center gap-2 py-1.5 text-xs border-b',
              style: { borderColor: 'var(--ui-stroke-secondary, var(--border))' },
              children: [
                jsx(StatusDot, { tone: r.status === 'merged' ? 'good' : r.status === 'closed' ? 'muted' : 'warn' }),
                jsx('span', { className: 'flex-1 font-medium truncate', children: r.title }),
                jsx(Muted, { children: r.status || 'open' }),
                /^https?:\/\//i.test(r.url || '')
                  ? jsx(Button, {
                      size: 'xs',
                      variant: 'ghost',
                      onClick: () => {
                        haptic('tap')
                        try {
                          if (typeof host.open === 'function') host.open(r.url)
                          else window.open(r.url, '_blank', 'noopener')
                        } catch { /* */ }
                      },
                      children: 'Open',
                    })
                  : null,
              ],
            })
          )
        : jsx(Muted, { children: 'No PR resources — repo is the door.' }),
    ],
  })
}

function MilestonesPicture({ milestones }) {
  if (!milestones?.length) return jsx(Muted, { children: 'No milestone table.' })
  return jsx('div', {
    className: 'flex flex-col max-w-2xl',
    children: milestones.map((m, i) =>
      jsxs('div', {
        key: m.id || i,
        className: 'flex items-center gap-2 py-1.5 text-xs border-b',
        style: { borderColor: 'var(--ui-stroke-secondary, var(--border))' },
        children: [
          jsx(StatusDot, { tone: m.tone === 'good' ? 'good' : m.tone === 'bad' ? 'bad' : 'muted' }),
          jsx('span', { className: 'font-medium shrink-0', children: m.short_id || m.id }),
          jsx('span', { className: 'truncate flex-1', children: m.label || m.status || '' }),
          m.pct != null ? jsx(Muted, { children: `${m.pct}%` }) : null,
        ],
      })
    ),
  })
}

export const WorkstreamMap = WorkstreamPage
