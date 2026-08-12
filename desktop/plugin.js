/**
 * workstreamer — Desktop UI
 *
 * Status chip = current stream truth (health · focus · next action)
 * Popover     = milestones + live URLs + blockers + constitution + actions
 * Map pane    = fleet overview with adopt progress + per-stream pulse
 */
import {
  Badge,
  Button,
  PALETTE_AREA,
  ROUTES_AREA,
  Separator,
  StatusDot,
  Popover,
  PopoverTrigger,
  PopoverContent,
  ScrollArea,
  Skeleton,
  cn,
  haptic,
  host,
  useQuery,
  useQueryClient,
  useValue
} from '@hermes/plugin-sdk'
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useMemo, useState } from 'react'

const ID = 'workstreamer'

/* ─── helpers ─────────────────────────────────────────────────────────── */

function extractStreamName(cwd) {
  if (!cwd) return null
  const m = String(cwd).match(/workstreams\/([^/]+)/)
  return m ? m[1] : null
}

function toneColor(tone) {
  if (tone === 'good' || tone === 'clean' || tone === 'adopted') return 'green'
  if (tone === 'active' || tone === 'partial' || tone === 'warn') return 'amber'
  if (tone === 'bad' || tone === 'dirty' || tone === 'degraded' || tone === 'error') return 'red'
  if (tone === 'bare' || tone === 'idle' || tone === 'no_script' || tone === 'no_status') return 'gray'
  return 'blue'
}

function healthMeta(health) {
  const map = {
    clean: { color: 'green', label: 'clean', short: 'clean' },
    adopted: { color: 'green', label: 'adopted', short: 'ok' },
    active: { color: 'amber', label: 'in motion', short: 'active' },
    degraded: { color: 'red', label: 'degraded', short: 'down' },
    dirty: { color: 'red', label: 'dirty', short: 'dirty' },
    partial: { color: 'amber', label: 'partial', short: 'partial' },
    bare: { color: 'gray', label: 'bare', short: 'bare' },
  }
  return map[health] || { color: 'blue', label: health || '…', short: health || '…' }
}

function ago(ts) {
  if (!ts) return ''
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

function titleCase(name) {
  if (!name) return ''
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function errMsg(e) {
  if (!e) return 'unknown error'
  if (typeof e === 'string') return e
  return e.message || e.detail || e.error || JSON.stringify(e)
}

/* ─── tiny presentational atoms ──────────────────────────────────────── */

function Row({ children, className, onClick, active }) {
  return jsx('div', {
    className: cn(
      'flex items-center gap-2 px-3 py-1.5 text-xs',
      onClick && 'cursor-pointer hover:bg-accent/10',
      active && 'bg-accent/10',
      className
    ),
    onClick,
    children
  })
}

function Muted({ children, className }) {
  return jsx('span', {
    className: cn('text-[10px]', className),
    style: { color: 'var(--ui-text-quaternary)' },
    children
  })
}

function SectionLabel({ children }) {
  return jsx('div', {
    className: 'px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide',
    style: { color: 'var(--ui-text-quaternary)' },
    children
  })
}

function MilestoneRail({ chips }) {
  if (!chips || !chips.length) return null
  return jsx('div', {
    className: 'flex gap-1 flex-wrap',
    children: chips.map(c =>
      jsxs('div', {
        key: c.id,
        className: 'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]',
        style: {
          background: 'var(--ui-stroke-secondary)',
          color: 'var(--ui-text-secondary)',
        },
        children: [
          jsx(StatusDot, { color: toneColor(c.tone) }),
          jsx('span', { children: c.id }),
          c.pct != null
            ? jsx('span', {
                style: { color: 'var(--ui-text-quaternary)' },
                children: `${c.pct}%`
              })
            : null
        ]
      })
    )
  })
}

function UrlPills({ urls }) {
  if (!urls || !urls.length) return null
  return jsx('div', {
    className: 'flex gap-1 flex-wrap',
    children: urls.map(u =>
      jsxs('div', {
        key: u.name,
        className: 'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]',
        style: {
          background: 'var(--ui-stroke-secondary)',
          color: u.tone === 'bad' ? 'var(--ui-red)' : 'var(--ui-text-secondary)',
        },
        children: [
          jsx(StatusDot, { color: toneColor(u.tone) }),
          u.name
        ]
      })
    )
  })
}

function ProgressBar({ pct, tone }) {
  const p = Math.max(0, Math.min(100, pct || 0))
  const color =
    tone === 'good' || tone === 'clean' ? 'var(--ui-green)'
      : tone === 'bad' || tone === 'dirty' || tone === 'degraded' ? 'var(--ui-red)'
        : tone === 'active' || tone === 'partial' ? 'var(--ui-amber)'
          : 'var(--ui-text-quaternary)'
  return jsx('div', {
    className: 'h-1 w-full rounded overflow-hidden',
    style: { background: 'var(--ui-stroke-secondary)' },
    children: jsx('div', {
      style: { width: `${p}%`, height: '100%', background: color, transition: 'width 200ms ease' }
    })
  })
}

function CoreChecklist({ core }) {
  if (!core) return null
  const missing = core.missing || []
  const extras = []
  if (!core.has_checker) extras.push('scripts/check-workstream.sh')
  if (!core.has_status) extras.push('scope/STATUS-LIVE.md')
  const allMissing = [...missing, ...extras]
  if (!allMissing.length) {
    return jsxs('div', {
      className: 'flex items-center gap-2 text-xs',
      style: { color: 'var(--ui-green)' },
      children: [
        jsx(StatusDot, { color: 'green' }),
        `Core complete · ${core.pct}%`
      ]
    })
  }
  return jsxs('div', {
    className: 'flex flex-col gap-1',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between text-xs',
        children: [
          jsx('span', { style: { color: 'var(--ui-text-secondary)' }, children: 'Constitution' }),
          jsx(Muted, { children: `${core.score}/${core.total}` })
        ]
      }),
      jsx(ProgressBar, { pct: core.pct, tone: core.pct === 100 ? 'good' : 'partial' }),
      jsx('div', {
        className: 'flex flex-col gap-0.5 mt-1',
        children: allMissing.slice(0, 4).map(f =>
          jsxs('div', {
            key: f,
            className: 'flex items-center gap-1.5 text-[10px]',
            style: { color: 'var(--ui-amber)' },
            children: [
              jsx('span', { children: '○' }),
              f
            ]
          })
        )
      })
    ]
  })
}

function BlockerList({ blockers }) {
  if (!blockers || !blockers.length) {
    return jsx('div', {
      className: 'text-xs py-1',
      style: { color: 'var(--ui-green)' },
      children: '✓ No blockers listed'
    })
  }
  return jsx('div', {
    className: 'flex flex-col gap-1',
    children: blockers.slice(0, 5).map((b, i) =>
      jsxs('div', {
        key: i,
        className: 'flex gap-2 text-xs leading-snug',
        children: [
          jsx('span', {
            style: { color: 'var(--ui-red)', flexShrink: 0 },
            children: '▸'
          }),
          jsx('span', {
            style: { color: 'var(--ui-text-secondary)' },
            children: b
          })
        ]
      })
    )
  })
}

function ViolationList({ check }) {
  if (!check) return null
  if (check.status === 'no_script') {
    return jsx('div', {
      className: 'text-xs',
      style: { color: 'var(--ui-amber)' },
      children: 'No check-workstream.sh yet — run /ws adopt or add scripts/'
    })
  }
  if (check.status === 'clean') {
    return jsxs('div', {
      className: 'flex items-center gap-2 text-xs',
      style: { color: 'var(--ui-green)' },
      children: [
        jsx(StatusDot, { color: 'green' }),
        check.summary_line || 'Clean — no violations'
      ]
    })
  }
  const items = [
    ...(check.violations || []).map(v => ({ ...v, kind: 'v' })),
    ...(check.warnings || []).map(v => ({ ...v, kind: 'w' })),
  ]
  if (!items.length) {
    return jsx('div', {
      className: 'text-xs',
      style: { color: 'var(--ui-amber)' },
      children: check.summary_line || check.status
    })
  }
  return jsx('div', {
    className: 'flex flex-col gap-1',
    children: items.slice(0, 6).map((it, i) =>
      jsxs('div', {
        key: i,
        className: 'flex gap-2 text-xs',
        children: [
          jsx('span', {
            className: 'font-mono text-[10px] shrink-0',
            style: { color: it.kind === 'v' ? 'var(--ui-red)' : 'var(--ui-amber)' },
            children: it.rule || (it.kind === 'v' ? 'R?' : 'W')
          }),
          jsx('span', {
            style: { color: 'var(--ui-text-secondary)' },
            children: it.message
          })
        ]
      })
    )
  })
}

/* ─── Status chip ─────────────────────────────────────────────────────── */

function WorkstreamChip({ ctx }) {
  const cwd = useValue(host.state.cwd)
  const profile = useValue(host.state.profile)
  const streamName = extractStreamName(cwd)
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()

  const { data, isFetching, refetch } = useQuery({
    queryKey: [ID, 'stream', streamName || 'none'],
    queryFn: async () => {
      if (!streamName) return null
      return ctx.rest(`/stream?stream=${encodeURIComponent(streamName)}&check=true`)
    },
    enabled: Boolean(streamName),
    refetchInterval: 45_000,
    retry: 1,
  })

  if (!streamName) {
    return jsxs('span', {
      className: 'flex items-center gap-1 text-xs cursor-pointer',
      style: { color: 'var(--ui-text-quaternary)' },
      onClick: () => { haptic('tap'); host.navigate('/workstream-map') },
      title: 'No workstream in cwd — open map',
      children: [
        jsx(StatusDot, { color: 'gray' }),
        'no stream'
      ]
    })
  }

  const health = data?.health || (isFetching ? '…' : '…')
  const hm = healthMeta(health)
  const focus = data?.focus_label || ''
  const down = data?.down_url_count || 0
  const blockers = data?.blocker_count || 0
  const checkStatus = data?.check?.status

  // Chip label: stream · health · optional focus crumb
  let label = `${streamName} · ${hm.short}`
  if (checkStatus === 'dirty' && data?.check?.violation_count) {
    label = `${streamName} · ${data.check.violation_count} viol`
  } else if (down > 0) {
    label = `${streamName} · ${down} down`
  } else if (focus && hm.short !== 'bare') {
    // keep chip short — focus only if room conceptually; use focus for dirty/degraded
    if (health === 'degraded' || health === 'active' || health === 'dirty') {
      label = `${streamName} · ${focus}`
    }
  }

  return jsx(Popover, {
    open,
    onOpenChange: setOpen,
    children: [
      jsx(PopoverTrigger, {
        key: 'trigger',
        children: jsxs('span', {
          className: 'flex items-center gap-1.5 cursor-pointer text-xs max-w-[220px]',
          style: { color: 'var(--ui-text-secondary)' },
          title: data?.pulse?.next_action || focus || streamName,
          children: [
            jsx(StatusDot, { color: hm.color }),
            jsx('span', {
              className: 'truncate',
              children: label
            }),
            isFetching
              ? jsx('span', {
                  className: 'text-[9px]',
                  style: { color: 'var(--ui-text-quaternary)' },
                  children: '…'
                })
              : null
          ]
        })
      }),
      jsx(PopoverContent, {
        key: 'content',
        className: 'w-80 p-0',
        children: jsx(StreamPopover, {
          streamName,
          data,
          profile,
          onClose: () => setOpen(false),
          onRefresh: async () => {
            haptic('tap')
            await refetch()
            qc.invalidateQueries({ queryKey: [ID, 'list'] })
          },
          isFetching
        })
      })
    ]
  })
}

function StreamPopover({ streamName, data, profile, onClose, onRefresh, isFetching }) {
  const pulse = data?.pulse
  const check = data?.check
  const core = data?.core
  const hm = healthMeta(data?.health)

  return jsxs('div', {
    className: 'flex flex-col',
    children: [
      // Header
      jsxs('div', {
        className: 'px-3 pt-3 pb-2 flex flex-col gap-1',
        children: [
          jsxs('div', {
            className: 'flex items-center justify-between gap-2',
            children: [
              jsxs('div', {
                className: 'flex items-center gap-2 min-w-0',
                children: [
                  jsx(StatusDot, { color: hm.color }),
                  jsx('span', {
                    className: 'font-semibold text-sm truncate',
                    children: titleCase(streamName)
                  })
                ]
              }),
              jsxs('div', {
                className: 'flex items-center gap-1 shrink-0',
                children: [
                  data?.profile
                    ? jsx(Badge, {
                        variant: 'secondary',
                        className: 'text-[10px]',
                        children: `@${data.profile}`
                      })
                    : null,
                  jsx(Badge, {
                    variant: 'secondary',
                    className: 'text-[10px]',
                    children: hm.label
                  })
                ]
              })
            ]
          }),
          pulse?.next_action
            ? jsxs('div', {
                className: 'text-xs leading-snug',
                style: { color: 'var(--ui-text-secondary)' },
                children: [
                  jsx('span', {
                    style: { color: 'var(--ui-text-quaternary)' },
                    children: 'Next · '
                  }),
                  pulse.next_action
                ]
              })
            : data?.focus_label
              ? jsx(Muted, { children: `Focus · ${data.focus_label}` })
              : null,
          pulse?.updated
            ? jsx(Muted, { children: `STATUS-LIVE · ${pulse.updated}` })
            : check?.checked_at
              ? jsx(Muted, { children: `Checked ${ago(check.checked_at)}` })
              : null
        ]
      }),

      jsx(Separator, {}),

      // Milestones
      pulse?.milestone_chips?.length
        ? jsxs('div', {
            className: 'px-3 py-2 flex flex-col gap-1.5',
            children: [
              jsx(Muted, { children: 'MILESTONES' }),
              jsx(MilestoneRail, { chips: pulse.milestone_chips })
            ]
          })
        : null,

      // Live URLs
      pulse?.urls?.length
        ? jsxs('div', {
            className: 'px-3 py-2 flex flex-col gap-1.5',
            children: [
              jsx(Muted, { children: 'LIVE URLS' }),
              jsx(UrlPills, { urls: pulse.urls })
            ]
          })
        : null,

      // Blockers
      jsxs('div', {
        className: 'px-3 py-2 flex flex-col gap-1.5',
        children: [
          jsx(Muted, { children: 'BLOCKERS' }),
          jsx(BlockerList, { blockers: pulse?.blockers })
        ]
      }),

      // Open PRs (compact)
      pulse?.prs?.length
        ? jsxs('div', {
            className: 'px-3 py-2 flex flex-col gap-1',
            children: [
              jsx(Muted, { children: 'OPEN PRS' }),
              jsx('div', {
                className: 'flex flex-col gap-0.5',
                children: pulse.prs.slice(0, 4).map((pr, i) =>
                  jsx('div', {
                    key: i,
                    className: 'text-xs truncate',
                    style: { color: 'var(--ui-text-secondary)' },
                    children: pr
                  })
                )
              })
            ]
          })
        : null,

      jsx(Separator, {}),

      // Constitution + check
      jsxs('div', {
        className: 'px-3 py-2 flex flex-col gap-2',
        children: [
          jsx(Muted, { children: 'CONSTITUTION' }),
          jsx(CoreChecklist, { core }),
          jsx(ViolationList, { check })
        ]
      }),

      jsx(Separator, {}),

      // Actions
      jsxs('div', {
        className: 'flex gap-1.5 p-2',
        children: [
          jsx(Button, {
            size: 'sm',
            variant: 'secondary',
            className: 'flex-1',
            onClick: onRefresh,
            children: isFetching ? '…' : 'Recheck'
          }),
          jsx(Button, {
            size: 'sm',
            variant: 'secondary',
            className: 'flex-1',
            onClick: () => {
              haptic('tap')
              onClose()
              host.navigate('/workstream-map')
            },
            children: 'Map'
          }),
          jsx(Button, {
            size: 'sm',
            variant: 'ghost',
            onClick: () => {
              haptic('tap')
              onClose()
            },
            children: '✕'
          })
        ]
      })
    ]
  })
}

/* ─── Workstream Map ──────────────────────────────────────────────────── */

function WorkstreamMap({ ctx }) {
  const cwd = useValue(host.state.cwd)
  const activeStream = extractStreamName(cwd)
  const [selected, setSelected] = useState(null)
  const [filter, setFilter] = useState('all') // all | adopted | bare | issues
  const qc = useQueryClient()

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: [ID, 'list'],
    queryFn: () => ctx.rest('/list?pulse=true&check=false'),
    refetchInterval: 60_000,
    retry: 1,
  })

  const selectedName = selected || activeStream
  const { data: detail, isFetching: detailFetching, refetch: refetchDetail } = useQuery({
    queryKey: [ID, 'stream', selectedName || 'none'],
    queryFn: async () => {
      if (!selectedName) return null
      return ctx.rest(`/stream?stream=${encodeURIComponent(selectedName)}&check=true`)
    },
    enabled: Boolean(selectedName),
    refetchInterval: 60_000,
    retry: 1,
  })

  const streams = useMemo(() => {
    const all = Array.isArray(data?.streams) ? data.streams : []
    if (filter === 'adopted') return all.filter(s => s.adopted)
    if (filter === 'bare') return all.filter(s => s.health === 'bare')
    if (filter === 'issues') {
      return all.filter(s =>
        ['dirty', 'degraded', 'partial'].includes(s.health) || (s.down_url_count || 0) > 0 || (s.blocker_count || 0) > 0
      )
    }
    return all
  }, [data, filter])

  const stats = data?.stats || {}

  if (isLoading) {
    return jsxs('div', {
      className: 'p-4 flex flex-col gap-2',
      children: [
        jsx(Skeleton, { className: 'h-4 w-1/2' }),
        jsx(Skeleton, { className: 'h-8 w-full' }),
        jsx(Skeleton, { className: 'h-8 w-full' }),
        jsx(Skeleton, { className: 'h-8 w-full' })
      ]
    })
  }

  if (isError) {
    return jsxs('div', {
      className: 'p-4 flex flex-col gap-2 h-full',
      children: [
        jsx('div', {
          className: 'text-xs font-semibold',
          style: { color: 'var(--ui-red)' },
          children: 'Map API failed'
        }),
        jsx('div', {
          className: 'text-xs break-words',
          style: { color: 'var(--ui-text-secondary)' },
          children: errMsg(error)
        }),
        jsx(Button, {
          size: 'sm',
          variant: 'secondary',
          onClick: () => { haptic('tap'); refetch() },
          children: isFetching ? 'Retrying…' : 'Retry'
        })
      ]
    })
  }

  return jsxs('div', {
    className: 'flex flex-col h-full min-h-0',
    children: [
      // Fleet header
      jsxs('div', {
        className: 'px-3 py-2 flex flex-col gap-2 border-b',
        style: { borderColor: 'var(--ui-stroke-secondary)' },
        children: [
          jsxs('div', {
            className: 'flex items-center justify-between',
            children: [
              jsx('span', {
                className: 'text-xs font-semibold',
                children: 'Workstreams'
              }),
              jsx(Button, {
                size: 'xs',
                variant: 'ghost',
                onClick: () => {
                  haptic('tap')
                  refetch()
                  if (selectedName) refetchDetail()
                  qc.invalidateQueries({ queryKey: [ID] })
                },
                children: isFetching ? '…' : '↻'
              })
            ]
          }),
          // Stats strip
          jsxs('div', {
            className: 'flex gap-2 flex-wrap',
            children: [
              jsx(StatChip, { label: 'total', value: data?.count || 0 }),
              jsx(StatChip, { label: 'adopted', value: stats.adopted || 0, tone: 'good' }),
              jsx(StatChip, { label: 'bare', value: stats.bare || 0, tone: 'idle' }),
              (stats.degraded || stats.dirty)
                ? jsx(StatChip, {
                    label: 'issues',
                    value: (stats.degraded || 0) + (stats.dirty || 0),
                    tone: 'bad'
                  })
                : null
            ]
          }),
          // Filter
          jsxs('div', {
            className: 'flex gap-1',
            children: ['all', 'issues', 'adopted', 'bare'].map(f =>
              jsx(Button, {
                key: f,
                size: 'xs',
                variant: filter === f ? 'secondary' : 'ghost',
                onClick: () => { haptic('tap'); setFilter(f) },
                children: f
              })
            )
          })
        ]
      }),

      // List
      jsx('div', {
        className: 'flex-1 overflow-auto min-h-0',
        children: streams.length === 0
          ? jsx('div', {
              className: 'p-4 text-xs',
              style: { color: 'var(--ui-text-quaternary)' },
              children: filter === 'all' ? 'No workstreams found' : `No streams match “${filter}”`
            })
          : streams.map(s => {
              const isActive = s.name === activeStream
              const isSel = s.name === selectedName
              const hm = healthMeta(s.health)
              return jsxs('div', {
                key: s.name,
                className: cn(
                  'px-3 py-2 cursor-pointer border-b',
                  isSel && 'bg-accent/10'
                ),
                style: { borderColor: 'var(--ui-stroke-secondary)' },
                onClick: () => { haptic('tap'); setSelected(s.name) },
                children: [
                  jsxs('div', {
                    className: 'flex items-center gap-2 text-xs',
                    children: [
                      jsx(StatusDot, { color: isActive ? 'blue' : hm.color }),
                      jsx('span', {
                        className: cn('flex-1 truncate font-medium', isActive && 'underline'),
                        children: s.name
                      }),
                      s.profile
                        ? jsx(Muted, { children: `@${s.profile}` })
                        : null,
                      jsx(Muted, { children: hm.short })
                    ]
                  }),
                  s.focus_label
                    ? jsx('div', {
                        className: 'mt-0.5 pl-4 text-[10px] truncate',
                        style: { color: 'var(--ui-text-quaternary)' },
                        children: s.focus_label
                      })
                    : s.health === 'bare'
                      ? jsx('div', {
                          className: 'mt-0.5 pl-4 text-[10px]',
                          style: { color: 'var(--ui-text-quaternary)' },
                          children: 'no AGENTS.md — not adopted'
                        })
                      : null,
                  (s.blocker_count || s.down_url_count)
                    ? jsxs('div', {
                        className: 'mt-0.5 pl-4 flex gap-2 text-[10px]',
                        children: [
                          s.down_url_count
                            ? jsx('span', {
                                style: { color: 'var(--ui-red)' },
                                children: `${s.down_url_count} down`
                              })
                            : null,
                          s.blocker_count
                            ? jsx('span', {
                                style: { color: 'var(--ui-amber)' },
                                children: `${s.blocker_count} blocker${s.blocker_count === 1 ? '' : 's'}`
                              })
                            : null
                        ]
                      })
                    : null,
                  s.core
                    ? jsx('div', {
                        className: 'mt-1 pl-4',
                        children: jsx(ProgressBar, {
                          pct: s.core.pct,
                          tone: s.health === 'bare' ? 'idle' : s.core.pct === 100 ? 'good' : 'partial'
                        })
                      })
                    : null
                ]
              })
            })
      }),

      // Detail drawer for selection
      selectedName
        ? jsxs('div', {
            className: 'border-t flex flex-col max-h-[45%] min-h-[140px]',
            style: { borderColor: 'var(--ui-stroke-secondary)' },
            children: [
              jsxs('div', {
                className: 'px-3 py-2 flex items-center justify-between',
                children: [
                  jsxs('div', {
                    className: 'flex items-center gap-2 text-xs font-semibold',
                    children: [
                      jsx(StatusDot, { color: healthMeta(detail?.health || 'bare').color }),
                      titleCase(selectedName)
                    ]
                  }),
                  jsxs('div', {
                    className: 'flex gap-1',
                    children: [
                      jsx(Button, {
                        size: 'xs',
                        variant: 'ghost',
                        onClick: () => { haptic('tap'); refetchDetail() },
                        children: detailFetching ? '…' : 'check'
                      }),
                      jsx(Button, {
                        size: 'xs',
                        variant: 'ghost',
                        onClick: () => setSelected(null),
                        children: '✕'
                      })
                    ]
                  })
                ]
              }),
              jsx('div', {
                className: 'px-3 pb-3 overflow-auto flex flex-col gap-2',
                children: !detail
                  ? jsx(Muted, { children: detailFetching ? 'Loading detail…' : 'No detail' })
                  : jsxs(Fragment, {
                      children: [
                        detail.pulse?.next_action
                          ? jsxs('div', {
                              className: 'text-xs leading-snug',
                              style: { color: 'var(--ui-text-secondary)' },
                              children: [
                                jsx(Muted, { children: 'NEXT' }),
                                jsx('div', { children: detail.pulse.next_action })
                              ]
                            })
                          : null,
                        detail.pulse?.milestone_chips?.length
                          ? jsx(MilestoneRail, { chips: detail.pulse.milestone_chips })
                          : null,
                        detail.pulse?.urls?.length
                          ? jsx(UrlPills, { urls: detail.pulse.urls })
                          : null,
                        detail.pulse?.blockers?.length
                          ? jsx(BlockerList, { blockers: detail.pulse.blockers })
                          : null,
                        jsx(CoreChecklist, { core: detail.core }),
                        jsx(ViolationList, { check: detail.check })
                      ]
                    })
              })
            ]
          })
        : jsxs('div', {
            className: 'border-t px-3 py-2',
            style: { borderColor: 'var(--ui-stroke-secondary)' },
            children: [
              jsx(Muted, { children: 'Select a stream for pulse + check detail' })
            ]
          })
    ]
  })
}

function StatChip({ label, value, tone }) {
  return jsxs('div', {
    className: 'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]',
    style: { background: 'var(--ui-stroke-secondary)', color: 'var(--ui-text-secondary)' },
    children: [
      tone ? jsx(StatusDot, { color: toneColor(tone) }) : null,
      jsx('span', {
        className: 'font-semibold',
        children: value
      }),
      jsx('span', {
        style: { color: 'var(--ui-text-quaternary)' },
        children: label
      })
    ]
  })
}

/* ─── register ────────────────────────────────────────────────────────── */

export default {
  id: ID,
  name: 'Workstreamer',
  defaultEnabled: true,

  register(ctx) {
    ctx.register({
      id: 'ws-status',
      area: 'statusBar.right',
      order: 90,
      render: () => jsx(WorkstreamChip, { ctx }),
    })

    ctx.register({
      id: 'ws-check',
      area: PALETTE_AREA,
      data: {
        id: 'workstreamer.check',
        label: 'Workstreamer: Recheck current stream',
        keywords: ['workstream', 'check', 'constitution', 'violations'],
        codicon: 'check',
        run: async () => {
          haptic('tap')
          const cwd = host.state.cwd?.get?.() || host.state.cwd
          const name = extractStreamName(typeof cwd === 'string' ? cwd : null)
          if (!name) {
            host.notify({ kind: 'info', message: 'Not inside a workstream — open the map' })
            host.navigate('/workstream-map')
            return
          }
          try {
            const r = await ctx.rest(`/check?stream=${encodeURIComponent(name)}`)
            const n = r.violation_count || 0
            host.notify({
              kind: n ? 'error' : 'success',
              message: n
                ? `${name}: ${n} violation${n === 1 ? '' : 's'}`
                : `${name}: ${r.summary_line || 'clean'}`
            })
          } catch (e) {
            host.notify({ kind: 'error', message: errMsg(e) })
          }
        }
      },
    })

    ctx.register({
      id: 'ws-pulse',
      area: PALETTE_AREA,
      data: {
        id: 'workstreamer.pulse',
        label: 'Workstreamer: Pulse current stream',
        keywords: ['workstream', 'pulse', 'status', 'milestones'],
        codicon: 'pulse',
        run: async () => {
          haptic('tap')
          const cwd = host.state.cwd?.get?.() || host.state.cwd
          const name = extractStreamName(typeof cwd === 'string' ? cwd : null)
          if (!name) {
            host.navigate('/workstream-map')
            return
          }
          try {
            const r = await ctx.rest(`/pulse?stream=${encodeURIComponent(name)}`)
            const p = r.pulse
            if (!p) {
              host.notify({ kind: 'info', message: `${name}: no STATUS-LIVE.md` })
              return
            }
            const next = p.next_action || p.focus?.id || 'no next action'
            const down = (p.down_urls || []).map(u => u.name).join(', ')
            host.notify({
              kind: down ? 'error' : 'info',
              message: down
                ? `${name}: next=${next} · down=${down}`
                : `${name}: next=${next}`
            })
          } catch (e) {
            host.notify({ kind: 'error', message: errMsg(e) })
          }
        }
      },
    })

    ctx.register({
      id: 'ws-map',
      area: PALETTE_AREA,
      data: {
        id: 'workstreamer.map',
        label: 'Workstreamer: Show Map',
        keywords: ['workstream', 'map', 'fleet'],
        codicon: 'project',
        run: () => {
          haptic('tap')
          host.navigate('/workstream-map')
        }
      },
    })

    ctx.register({
      id: 'workstream-map',
      area: 'panes',
      title: 'Workstream Map',
      data: {
        placement: 'right',
        width: '340px',
      },
      render: () => jsx(WorkstreamMap, { ctx }),
    })

    ctx.register({
      id: 'workstream-map-page',
      area: ROUTES_AREA,
      data: { path: '/workstream-map' },
      render: () => jsx(WorkstreamMap, { ctx }),
    })
  },
}
