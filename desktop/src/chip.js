/** @section chip */
import {
  Badge,
  Button,
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
  BlockerList,
  HealthBadge,
  MilestoneRail,
  Muted,
  PrList,
  SectionLabel,
  UrlPills,
  ViolationList,
} from './atoms.js'
import { ID, STORAGE_KEYS } from './constants.js'
import { ago, copyText, errMsg, extractStreamName, isPrLine, titleCase } from './format.js'
import { healthMeta, toneOf } from './health.js'
import { usePersisted } from './persist.js'

function chipTitle(streamName, data) {
  return data?.title || titleCase(streamName) || streamName
}

export function WorkstreamChip({ ctx }) {
  const cwd = useValue(host.state.cwd)
  const profile = useValue(host.state.profile)
  const streamFromCwd = extractStreamName(cwd)
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [pinned, setPinned] = usePersisted(ctx, STORAGE_KEYS.pinned, '')
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
  const chips = data?.pulse?.milestone_chips || []
  const title = chipTitle(streamName, data)
  const tipBits = [
    title,
    pinned && pinned !== liveName ? `pinned (cwd: ${liveName || '—'})` : null,
    data?.pulse?.next_action ? `Next: ${data.pulse.next_action}` : data?.focus_label,
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
            'inline-flex h-full max-w-[280px] items-center gap-1.5 rounded-none px-1.5',
            'text-[0.6875rem] tabular-nums transition-colors',
            'hover:bg-(--chrome-action-hover)',
            isFetching && !data && 'opacity-70'
          ),
          style: { color: 'var(--ui-text-secondary, var(--muted-foreground))' },
          children: [
            jsx(StatusDot, { tone: isError ? 'bad' : hm.tone }),
            jsx('span', { className: 'truncate font-medium', children: title }),
            chips.length
              ? jsx('span', {
                  className: 'hidden sm:inline-flex items-center gap-0.5 shrink-0',
                  children: chips.slice(0, 6).map(c =>
                    jsx(Tip, {
                      key: c.id,
                      label: `${c.id}${c.pct != null ? ` ${c.pct}%` : ''}${c.status ? ` — ${c.status}` : ''}`,
                      children: jsx(StatusDot, { tone: toneOf(c.tone) }),
                    })
                  ),
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
        className: 'w-96 max-h-[min(76vh,600px)] overflow-y-auto p-0',
        align: 'end',
        children: jsx(StreamPopover, {
          streamName,
          liveName,
          pinned,
          setPinned,
          switching,
          setSwitching,
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
  streamName,
  liveName,
  pinned,
  setPinned,
  switching,
  setSwitching,
  fleet,
  data,
  isError,
  error,
  isFetching,
  onClose,
  onRefresh,
}) {
  const pulse = data?.pulse
  const check = data?.check
  const hm = healthMeta(data?.health)
  const title = chipTitle(streamName, data)
  const blockers = pulse?.blockers || []
  const prs = (pulse?.prs || []).filter(isPrLine)
  const down = pulse?.down_urls || []
  const viol = check?.violation_count || 0
  const dirty = check?.status === 'dirty' || check?.status === 'no_script' || viol > 0
  const next = pulse?.next_action || data?.focus_label || ''
  const isPinned = pinned === streamName
  const repo = data?.repo || ''

  if (isError && !data) {
    return jsxs('div', {
      className: 'p-3 flex flex-col gap-2',
      children: [
        jsx('div', {
          className: 'text-xs font-semibold',
          style: { color: 'var(--destructive)' },
          children: 'Failed to load stream',
        }),
        jsx('div', {
          className: 'text-xs break-words',
          style: { color: 'var(--ui-text-secondary)' },
          children: errMsg(error),
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
                  data?.profile
                    ? jsx(Badge, { variant: 'muted', size: 'xs', children: `@${data.profile}` })
                    : null,
                  jsx(HealthBadge, { health: data?.health }),
                ],
              }),
            ],
          }),

          next
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
                          const ok = await copyText(next)
                          host.notify({
                            kind: ok ? 'success' : 'error',
                            message: ok ? 'Copied next action' : 'Copy failed',
                          })
                        },
                        children: 'Copy',
                      }),
                    ],
                  }),
                  jsx('div', {
                    className: 'text-xs leading-snug font-medium',
                    style: { color: 'var(--ui-text-secondary, var(--muted-foreground))' },
                    children: next,
                  }),
                ],
              })
            : null,

          jsxs('div', {
            className: 'flex items-center gap-2.5 flex-wrap',
            children: [
              jsx(Count, { n: blockers.length, label: 'blockers', tone: blockers.length ? 'warn' : null }),
              jsx(Count, { n: down.length, label: 'down', tone: down.length ? 'bad' : null }),
              jsx(Count, { n: prs.length, label: 'PRs' }),
              pulse?.updated
                ? jsx(Muted, {
                    children: pulse.stale ? `${pulse.updated} · stale` : pulse.updated,
                  })
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

      pulse?.milestone_chips?.length || pulse?.urls?.length
        ? jsxs('div', {
            className: 'px-3.5 pb-2.5 flex flex-col gap-2',
            children: [
              pulse?.milestone_chips?.length
                ? jsx(MilestoneRail, { chips: pulse.milestone_chips })
                : null,
              pulse?.urls?.length
                ? jsx(UrlPills, { urls: pulse.urls })
                : null,
            ],
          })
        : null,

      blockers.length
        ? jsxs('div', {
            className: 'px-3.5 pb-2.5 flex flex-col gap-1.5',
            children: [
              jsx(SectionLabel, { children: 'Blockers' }),
              jsx(BlockerList, { blockers }),
            ],
          })
        : null,

      prs.length
        ? jsxs('div', {
            className: 'px-3.5 pb-2.5 flex flex-col gap-1.5',
            children: [
              jsx(SectionLabel, { children: 'Open PRs' }),
              jsx(PrList, { prs, compact: true, limit: 5, repo }),
            ],
          })
        : null,

      dirty
        ? jsxs('div', {
            className: 'px-3.5 pb-2.5 flex flex-col gap-1.5',
            children: [
              jsx(SectionLabel, { children: 'Constitution' }),
              jsx(ViolationList, { check }),
            ],
          })
        : null,

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
