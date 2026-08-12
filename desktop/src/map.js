/** @section page */
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
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
  BlockerList,
  CoreChecklist,
  DetailCard,
  HealthBadge,
  MilestoneRail,
  Muted,
  ProgressBar,
  PrList,
  StatChip,
  UrlPills,
  ViolationList,
} from './atoms.js'
import { FILTERS, ID, STORAGE_KEYS } from './constants.js'
import { ago, errMsg, extractStreamName, titleCase } from './format.js'
import { healthMeta } from './health.js'
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
          (s.blocker_count || 0) > 0
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
          className: 'w-64 shrink-0 border-r p-3 flex flex-col gap-2',
          style: { borderColor: 'var(--ui-stroke-secondary, var(--border))' },
          children: [
            jsx(Skeleton, { className: 'h-4 w-1/2' }),
            jsx(Skeleton, { className: 'h-8 w-full' }),
            jsx(Skeleton, { className: 'h-10 w-full' }),
            jsx(Skeleton, { className: 'h-10 w-full' }),
          ],
        }),
        jsxs('div', {
          className: 'flex-1 p-6 flex flex-col gap-3',
          children: [
            jsx(Skeleton, { className: 'h-8 w-1/3' }),
            jsx(Skeleton, { className: 'h-32 w-full' }),
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
    className: 'flex h-full min-h-0 w-64 shrink-0 flex-col border-r',
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
              jsx(StatChip, {
                label: 'adopted',
                value: stats.adopted || 0,
                tone: 'good',
              }),
              jsx(StatChip, {
                label: 'bare',
                value: stats.bare || 0,
                tone: 'muted',
              }),
              (stats.issues || 0) > 0
                ? jsx(StatChip, {
                    label: 'issues',
                    value: stats.issues,
                    tone: 'bad',
                  })
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
            ? jsx(EmptyState, {
                className: 'min-h-32',
                title: emptyTitle,
                description: emptyDesc,
              })
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
                  style: {
                    borderColor: 'var(--ui-stroke-secondary, var(--border))',
                  },
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
                          className: cn(
                            'flex-1 truncate font-medium',
                            isActive && 'underline decoration-dotted'
                          ),
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
                      : s.health === 'bare'
                        ? jsx('div', {
                            className: 'mt-0.5 pl-4 text-[10px]',
                            style: { color: 'var(--ui-text-quaternary)' },
                            children: 'not adopted',
                          })
                        : null,
                    s.blocker_count || s.down_url_count
                      ? jsxs('div', {
                          className: 'mt-0.5 pl-4 flex gap-2 text-[10px]',
                          children: [
                            s.down_url_count
                              ? jsx('span', {
                                  style: { color: 'var(--destructive)' },
                                  children: `${s.down_url_count} down`,
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
  if (!selectedName) {
    return jsx('div', {
      className: 'flex-1 min-w-0 min-h-0 flex items-center justify-center p-8',
      children: jsx(EmptyState, {
        title: 'Select a workstream',
        description: 'Pick one on the left to see pulse, milestones, and constitution.',
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
          onClick: () => {
            haptic('tap')
            refetchDetail()
          },
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
        jsx(Skeleton, { className: 'h-24 w-full' }),
      ],
    })
  }

  const pulse = detail.pulse
  const hm = healthMeta(detail.health)
  const title = detail.title || titleCase(selectedName)
  const milestones = pulse?.milestones || []
  const urls = pulse?.urls || []

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
                      jsx('h1', {
                        className: 'text-base font-semibold truncate',
                        children: title,
                      }),
                      jsx(HealthBadge, { health: detail.health }),
                      detail.profile
                        ? jsx(Badge, {
                            variant: 'muted',
                            size: 'xs',
                            children: `@${detail.profile}`,
                          })
                        : null,
                    ],
                  }),
                  pulse?.next_action
                    ? jsxs('div', {
                        className: 'text-xs leading-snug',
                        style: { color: 'var(--ui-text-secondary, var(--muted-foreground))' },
                        children: [
                          jsx('span', {
                            style: { color: 'var(--ui-text-quaternary)' },
                            children: 'Next · ',
                          }),
                          pulse.next_action,
                        ],
                      })
                    : detail.focus_label
                      ? jsx(Muted, { children: `Focus · ${detail.focus_label}` })
                      : null,
                  jsxs('div', {
                    className: 'flex items-center gap-3 flex-wrap',
                    children: [
                      pulse?.updated
                        ? jsx(Muted, {
                            children: `STATUS-LIVE · ${pulse.updated}${pulse.stale ? ' · STALE' : ''}`,
                          })
                        : jsx(Muted, { children: 'No STATUS-LIVE.md' }),
                      detail.check?.checked_at
                        ? jsx(Muted, { children: `Checked ${ago(detail.check.checked_at)}` })
                        : null,
                      detail.overall_pct != null
                        ? jsx(Muted, { children: `${detail.overall_pct}% overall` })
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
                        await ctx.rest(
                          `/stream?stream=${encodeURIComponent(selectedName)}&check=true&force=true`
                        )
                      } catch {
                        /* ignore */
                      }
                      await refetchDetail()
                    },
                    children: detailFetching ? '…' : 'Recheck',
                  }),
                  jsx(Button, {
                    size: 'sm',
                    variant: 'ghost',
                    onClick: onClear,
                    children: 'Clear',
                  }),
                ],
              }),
            ],
          }),
          pulse?.overall_pct != null || detail.core
            ? jsx(ProgressBar, {
                pct: pulse?.overall_pct ?? detail.core?.pct ?? 0,
                tone:
                  detail.health === 'degraded' || detail.health === 'dirty'
                    ? 'bad'
                    : (pulse?.overall_pct ?? detail.core?.pct) === 100
                      ? 'good'
                      : 'warn',
              })
            : null,
        ],
      }),

      jsx('div', {
        className: 'min-h-0 flex-1 overflow-y-auto p-6',
        children: jsxs('div', {
          className: 'grid grid-cols-1 xl:grid-cols-2 gap-3 items-start',
          children: [
            jsx(DetailCard, {
              title: 'Milestones',
              children: milestones.length
                ? jsxs('div', {
                    className: 'flex flex-col gap-2',
                    children: [
                      jsx(MilestoneRail, { chips: pulse.milestone_chips }),
                      jsx('div', {
                        className: 'flex flex-col',
                        children: milestones.map((m, i) =>
                          jsxs('div', {
                            key: m.id || i,
                            className: cn(
                              'flex items-center gap-2 py-1.5 text-xs',
                              i > 0 && 'border-t'
                            ),
                            style: i > 0
                              ? { borderColor: 'var(--ui-stroke-secondary, var(--border))' }
                              : undefined,
                            children: [
                              jsx(StatusDot, {
                                tone: healthMeta(
                                  m.tone === 'good' ? 'clean'
                                    : m.tone === 'bad' ? 'dirty'
                                      : m.tone === 'active' ? 'active'
                                        : 'bare'
                                ).tone,
                              }),
                              jsx('span', {
                                className: 'font-medium shrink-0 tabular-nums',
                                children: m.short_id || m.id,
                              }),
                              jsx('span', {
                                className: 'truncate flex-1',
                                style: { color: 'var(--ui-text-secondary, var(--muted-foreground))' },
                                children: m.label || m.status,
                              }),
                              m.pct != null
                                ? jsx(Muted, { className: 'shrink-0', children: `${m.pct}%` })
                                : null,
                              m.paid
                                ? jsx(Badge, { variant: 'muted', size: 'xs', children: m.paid })
                                : null,
                            ],
                          })
                        ),
                      }),
                    ],
                  })
                : jsx(Muted, { children: 'No milestone table in STATUS-LIVE' }),
            }),

            jsx(DetailCard, {
              title: 'Live URLs',
              children: urls.length
                ? jsxs('div', {
                    className: 'flex flex-col',
                    children: [
                      jsx(UrlPills, { urls }),
                      jsx('div', {
                        className: 'mt-2 flex flex-col',
                        children: urls.map((u, i) =>
                          jsxs('div', {
                            key: u.name,
                            className: cn(
                              'flex items-center justify-between gap-2 py-1.5 text-xs',
                              i > 0 && 'border-t'
                            ),
                            style: i > 0
                              ? { borderColor: 'var(--ui-stroke-secondary, var(--border))' }
                              : undefined,
                            children: [
                              jsxs('div', {
                                className: 'flex items-center gap-2 min-w-0',
                                children: [
                                  jsx(StatusDot, {
                                    tone: u.tone === 'bad' ? 'bad' : u.tone === 'good' ? 'good' : 'muted',
                                  }),
                                  jsx('span', { className: 'font-medium truncate', children: u.name }),
                                ],
                              }),
                              jsx(Muted, { children: u.status }),
                            ],
                          })
                        ),
                      }),
                    ],
                  })
                : jsx(Muted, { children: 'No live URL table' }),
            }),

            jsx(DetailCard, {
              title: 'Blockers',
              children: jsx(BlockerList, { blockers: pulse?.blockers }),
            }),

            jsx(DetailCard, {
              title: 'Open PRs',
              children: pulse?.prs?.length
                ? jsx(PrList, { prs: pulse.prs, limit: 12, repo: detail.repo })
                : jsx(Muted, { children: 'None listed' }),
            }),

            jsx(DetailCard, {
              title: 'Constitution',
              children: jsxs('div', {
                className: 'flex flex-col gap-2',
                children: [
                  jsx(CoreChecklist, { core: detail.core }),
                  jsx(ViolationList, { check: detail.check }),
                ],
              }),
            }),

            jsx(DetailCard, {
              title: 'Pulse',
              children: jsxs('div', {
                className: 'flex flex-col gap-1.5 text-xs',
                style: { color: 'var(--ui-text-secondary, var(--muted-foreground))' },
                children: [
                  jsxs('div', {
                    className: 'flex justify-between gap-2',
                    children: [
                      jsx(Muted, { children: 'Milestones done' }),
                      jsx('span', {
                        children: `${pulse?.done_count ?? 0} / ${pulse?.milestone_count ?? 0}`,
                      }),
                    ],
                  }),
                  jsxs('div', {
                    className: 'flex justify-between gap-2',
                    children: [
                      jsx(Muted, { children: 'Down URLs' }),
                      jsx('span', {
                        style: (pulse?.down_urls || []).length
                          ? { color: 'var(--destructive)' }
                          : undefined,
                        children: (pulse?.down_urls || []).length,
                      }),
                    ],
                  }),
                  jsxs('div', {
                    className: 'flex justify-between gap-2',
                    children: [
                      jsx(Muted, { children: 'Open PRs' }),
                      jsx('span', { children: (pulse?.prs || []).length }),
                    ],
                  }),
                  jsxs('div', {
                    className: 'flex justify-between gap-2',
                    children: [
                      jsx(Muted, { children: 'Blockers' }),
                      jsx('span', { children: (pulse?.blockers || []).length }),
                    ],
                  }),
                ],
              }),
            }),
          ],
        }),
      }),
    ],
  })
}

export const WorkstreamMap = WorkstreamPage
