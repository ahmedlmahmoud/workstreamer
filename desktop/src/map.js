/** @section map */
import {
  Button,
  EmptyState,
  ErrorState,
  SearchField,
  SegmentedControl,
  Separator,
  Skeleton,
  StatusDot,
  cn,
  haptic,
  host,
  useQuery,
  useQueryClient,
  useValue,
} from '@hermes/plugin-sdk'
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useMemo, useState } from 'react'
import {
  BlockerList,
  CoreChecklist,
  HealthBadge,
  MilestoneRail,
  Muted,
  ProgressBar,
  SectionLabel,
  StatChip,
  UrlPills,
  ViolationList,
} from './atoms.js'
import { FILTERS, ID, STORAGE_KEYS } from './constants.js'
import { errMsg, extractStreamName, titleCase } from './format.js'
import { healthMeta } from './health.js'

function usePersisted(ctx, key, fallback) {
  const [value, setValue] = useState(fallback)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const v = await ctx.storage.get(key)
        if (!cancelled && v != null && v !== '') setValue(v)
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setReady(true)
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

  return [value, set, ready]
}

export function WorkstreamMap({ ctx }) {
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

  // Keep selection valid when active stream changes
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
      className: 'p-3 flex flex-col gap-2 h-full',
      children: [
        jsx(Skeleton, { className: 'h-4 w-1/3' }),
        jsx(Skeleton, { className: 'h-8 w-full' }),
        jsx(Skeleton, { className: 'h-10 w-full' }),
        jsx(Skeleton, { className: 'h-10 w-full' }),
        jsx(Skeleton, { className: 'h-10 w-full' }),
      ],
    })
  }

  if (isError) {
    return jsx('div', {
      className: 'p-4 h-full',
      children: jsx(ErrorState, {
        title: 'Map failed to load',
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
    // min-h-0 + overflow chain is critical for sash resize (no layout thrash)
    className: 'flex h-full min-h-0 w-full min-w-0 flex-col',
    children: [
      // Header
      jsxs('div', {
        className: 'shrink-0 px-3 py-2 flex flex-col gap-2 border-b',
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
                onClick: refreshAll,
                children: isFetching ? '…' : '↻',
              }),
            ],
          }),
          jsxs('div', {
            className: 'flex gap-1.5 flex-wrap',
            children: [
              jsx(StatChip, { label: 'total', value: data?.count || 0 }),
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
            placeholder: 'Filter streams…',
            containerClassName: 'w-full',
          }),
        ],
      }),

      // List
      jsx('div', {
        className: 'min-h-0 flex-1 overflow-y-auto overflow-x-hidden',
        children:
          streams.length === 0
            ? jsx(EmptyState, {
                className: 'min-h-32',
                title: filter === 'all' && !query ? 'No workstreams' : 'No matches',
                description:
                  filter === 'all' && !query
                    ? data?.root || 'workstreams/ is empty'
                    : `Nothing matches “${query || filter}”`,
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
                        jsx(StatusDot, {
                          tone: isActive ? 'good' : hm.tone,
                        }),
                        jsx('span', {
                          className: cn(
                            'flex-1 truncate font-medium',
                            isActive && 'underline decoration-dotted'
                          ),
                          children: s.title || s.name,
                        }),
                        s.profile
                          ? jsx(Muted, { children: `@${s.profile}` })
                          : null,
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
                            children: 'no AGENTS.md — not adopted',
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
                    s.core
                      ? jsx('div', {
                          className: 'mt-1.5 pl-4',
                          children: jsx(ProgressBar, {
                            pct: s.overall_pct ?? s.core.pct,
                            tone:
                              s.health === 'bare'
                                ? 'muted'
                                : s.health === 'degraded' || s.health === 'dirty'
                                  ? 'bad'
                                  : s.core.pct === 100
                                    ? 'good'
                                    : 'warn',
                          }),
                        })
                      : null,
                  ],
                })
              }),
      }),

      // Detail drawer
      selectedName
        ? jsxs('div', {
            className:
              'shrink-0 border-t flex flex-col max-h-[46%] min-h-[132px] min-w-0',
            style: { borderColor: 'var(--ui-stroke-secondary, var(--border))' },
            children: [
              jsxs('div', {
                className: 'px-3 py-2 flex items-center justify-between gap-2',
                children: [
                  jsxs('div', {
                    className: 'flex items-center gap-2 text-xs font-semibold min-w-0',
                    children: [
                      jsx(StatusDot, {
                        tone: healthMeta(detail?.health || 'bare').tone,
                      }),
                      jsx('span', {
                        className: 'truncate',
                        children: detail?.title || titleCase(selectedName),
                      }),
                    ],
                  }),
                  jsxs('div', {
                    className: 'flex gap-1 shrink-0',
                    children: [
                      jsx(Button, {
                        size: 'xs',
                        variant: 'ghost',
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
                        children: detailFetching ? '…' : 'check',
                      }),
                      jsx(Button, {
                        size: 'xs',
                        variant: 'ghost',
                        onClick: () => setSelected(''),
                        children: '✕',
                      }),
                    ],
                  }),
                ],
              }),
              jsx('div', {
                className: 'px-3 pb-3 overflow-y-auto min-h-0 flex flex-col gap-2',
                children: detailError && !detail
                  ? jsx('div', {
                      className: 'text-xs',
                      style: { color: 'var(--destructive)' },
                      children: errMsg(detailErr),
                    })
                  : !detail
                    ? jsx(Muted, {
                        children: detailFetching ? 'Loading detail…' : 'No detail',
                      })
                    : jsxs(Fragment, {
                        children: [
                          jsx(HealthBadge, { health: detail.health }),
                          detail.pulse?.next_action
                            ? jsxs('div', {
                                className: 'text-xs leading-snug',
                                style: {
                                  color:
                                    'var(--ui-text-secondary, var(--muted-foreground))',
                                },
                                children: [
                                  jsx(SectionLabel, { children: 'Next' }),
                                  jsx('div', {
                                    children: detail.pulse.next_action,
                                  }),
                                ],
                              })
                            : null,
                          detail.pulse?.milestone_chips?.length
                            ? jsx(MilestoneRail, {
                                chips: detail.pulse.milestone_chips,
                              })
                            : null,
                          detail.pulse?.urls?.length
                            ? jsx(UrlPills, { urls: detail.pulse.urls })
                            : null,
                          detail.pulse?.blockers?.length
                            ? jsx(BlockerList, {
                                blockers: detail.pulse.blockers,
                              })
                            : null,
                          jsx(CoreChecklist, { core: detail.core }),
                          jsx(ViolationList, { check: detail.check }),
                        ],
                      }),
              }),
            ],
          })
        : jsx('div', {
            className: 'shrink-0 border-t px-3 py-2',
            style: { borderColor: 'var(--ui-stroke-secondary, var(--border))' },
            children: jsx(Muted, {
              children: 'Select a stream for pulse + check detail',
            }),
          }),
    ],
  })
}
