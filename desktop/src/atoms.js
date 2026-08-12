/** @section atoms */
import {
  Badge,
  Button,
  StatusDot,
  Tip,
  cn,
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { badgeVariantForTone, healthMeta, toneOf } from './health.js'

export function Muted({ children, className }) {
  return jsx('span', {
    className: cn('text-[10px] leading-tight', className),
    style: { color: 'var(--ui-text-quaternary)' },
    children,
  })
}

export function SectionLabel({ children }) {
  return jsx('div', {
    className: 'text-[10px] uppercase tracking-wide font-medium',
    style: { color: 'var(--ui-text-quaternary)' },
    children,
  })
}

export function ProgressBar({ pct, tone }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0))
  const t = toneOf(tone)
  const color =
    t === 'good' ? 'var(--ui-green, var(--primary))'
      : t === 'bad' ? 'var(--destructive)'
        : t === 'warn' ? 'rgb(245 158 11)'
          : 'var(--muted-foreground)'
  return jsx('div', {
    className: 'h-1 w-full rounded-full overflow-hidden',
    style: { background: 'var(--ui-stroke-secondary, var(--muted))' },
    role: 'progressbar',
    'aria-valuenow': p,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    children: jsx('div', {
      className: 'h-full rounded-full transition-[width] duration-200 ease-out',
      style: { width: `${p}%`, background: color },
    }),
  })
}

export function MilestoneRail({ chips }) {
  if (!chips?.length) return null
  return jsx('div', {
    className: 'flex gap-1 flex-wrap',
    children: chips.map(c =>
      jsx(Tip, {
        key: c.id,
        label: `${c.id}${c.label ? ` · ${c.label}` : ''}${c.status ? ` — ${c.status}` : ''}`,
        children: jsxs('div', {
          className: 'flex items-center gap-1 px-1.5 py-0.5 rounded-[3px] text-[10px] tabular-nums',
          style: {
            background: 'var(--ui-stroke-secondary, var(--muted))',
            color: 'var(--ui-text-secondary, var(--muted-foreground))',
          },
          children: [
            jsx(StatusDot, { tone: toneOf(c.tone) }),
            jsx('span', { className: 'font-medium', children: c.id }),
            c.pct != null
              ? jsx('span', {
                  style: { color: 'var(--ui-text-quaternary)' },
                  children: `${c.pct}%`,
                })
              : null,
          ],
        }),
      })
    ),
  })
}

export function UrlPills({ urls }) {
  if (!urls?.length) return null
  return jsx('div', {
    className: 'flex gap-1 flex-wrap',
    children: urls.map(u =>
      jsx(Tip, {
        key: u.name,
        label: String(u.status || u.name),
        children: jsxs('div', {
          className: 'flex items-center gap-1 px-1.5 py-0.5 rounded-[3px] text-[10px]',
          style: {
            background: 'var(--ui-stroke-secondary, var(--muted))',
            color: toneOf(u.tone) === 'bad'
              ? 'var(--destructive)'
              : 'var(--ui-text-secondary, var(--muted-foreground))',
          },
          children: [
            jsx(StatusDot, { tone: toneOf(u.tone) }),
            u.name,
          ],
        }),
      })
    ),
  })
}

export function CoreChecklist({ core }) {
  if (!core) return null
  const missing = [...(core.missing || [])]
  if (!core.has_checker) missing.push('scripts/check-workstream.sh')
  if (!core.has_status) missing.push('scope/STATUS-LIVE.md')

  if (!missing.length) {
    return jsxs('div', {
      className: 'flex items-center gap-2 text-xs',
      style: { color: 'var(--ui-green, var(--primary))' },
      children: [
        jsx(StatusDot, { tone: 'good' }),
        `Core complete · ${core.pct}%`,
      ],
    })
  }

  return jsxs('div', {
    className: 'flex flex-col gap-1',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between text-xs',
        children: [
          jsx('span', {
            style: { color: 'var(--ui-text-secondary)' },
            children: 'Constitution',
          }),
          jsx(Muted, { children: `${core.score}/${core.total}` }),
        ],
      }),
      jsx(ProgressBar, {
        pct: core.pct,
        tone: core.pct === 100 ? 'good' : 'warn',
      }),
      jsx('div', {
        className: 'flex flex-col gap-0.5 mt-0.5',
        children: missing.slice(0, 5).map(f =>
          jsxs('div', {
            key: f,
            className: 'flex items-center gap-1.5 text-[10px]',
            style: { color: 'var(--ui-text-quaternary)' },
            children: [
              jsx('span', { children: '○' }),
              f,
            ],
          })
        ),
      }),
    ],
  })
}

export function BlockerList({ blockers }) {
  if (!blockers?.length) {
    return jsxs('div', {
      className: 'flex items-center gap-2 text-xs',
      style: { color: 'var(--ui-green, var(--primary))' },
      children: [jsx(StatusDot, { tone: 'good' }), 'No blockers listed'],
    })
  }
  return jsx('div', {
    className: 'flex flex-col gap-1',
    children: blockers.slice(0, 6).map((b, i) =>
      jsxs('div', {
        key: i,
        className: 'flex gap-2 text-xs leading-snug',
        children: [
          jsx('span', {
            className: 'shrink-0 mt-0.5',
            style: { color: 'var(--destructive)' },
            children: '▸',
          }),
          jsx('span', {
            style: { color: 'var(--ui-text-secondary, var(--muted-foreground))' },
            children: b,
          }),
        ],
      })
    ),
  })
}

export function ViolationList({ check }) {
  if (!check) return null
  if (check.status === 'no_script') {
    return jsx('div', {
      className: 'text-xs',
      style: { color: 'rgb(245 158 11)' },
      children: 'No check-workstream.sh — adopt or add scripts/',
    })
  }
  if (check.status === 'clean') {
    return jsxs('div', {
      className: 'flex items-center gap-2 text-xs',
      style: { color: 'var(--ui-green, var(--primary))' },
      children: [
        jsx(StatusDot, { tone: 'good' }),
        check.summary_line || 'Clean — no violations',
      ],
    })
  }
  const items = [
    ...(check.violations || []).map(v => ({ ...v, kind: 'v' })),
    ...(check.warnings || []).map(v => ({ ...v, kind: 'w' })),
  ]
  if (!items.length) {
    return jsx('div', {
      className: 'text-xs',
      style: { color: 'rgb(245 158 11)' },
      children: check.summary_line || check.status,
    })
  }
  return jsx('div', {
    className: 'flex flex-col gap-1',
    children: items.slice(0, 8).map((it, i) =>
      jsxs('div', {
        key: i,
        className: 'flex gap-2 text-xs',
        children: [
          jsx('span', {
            className: 'font-mono text-[10px] shrink-0',
            style: {
              color: it.kind === 'v' ? 'var(--destructive)' : 'rgb(245 158 11)',
            },
            children: it.rule || (it.kind === 'v' ? 'R?' : 'W'),
          }),
          jsx('span', {
            style: { color: 'var(--ui-text-secondary, var(--muted-foreground))' },
            children: it.message,
          }),
        ],
      })
    ),
  })
}

export function StatChip({ label, value, tone }) {
  return jsxs('div', {
    className: 'flex items-center gap-1 px-1.5 py-0.5 rounded-[3px] text-[10px] tabular-nums',
    style: {
      background: 'var(--ui-stroke-secondary, var(--muted))',
      color: 'var(--ui-text-secondary, var(--muted-foreground))',
    },
    children: [
      tone ? jsx(StatusDot, { tone: toneOf(tone) }) : null,
      jsx('span', { className: 'font-semibold', children: value }),
      jsx('span', {
        style: { color: 'var(--ui-text-quaternary)' },
        children: label,
      }),
    ],
  })
}

export function HealthBadge({ health }) {
  const hm = healthMeta(health)
  return jsx(Badge, {
    variant: hm.badge,
    size: 'xs',
    children: hm.label,
  })
}

export function RecheckButton({ onClick, busy, size = 'sm' }) {
  return jsx(Button, {
    size,
    variant: 'secondary',
    disabled: busy,
    onClick,
    children: busy ? '…' : 'Recheck',
  })
}
