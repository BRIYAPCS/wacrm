"use client"

import { useCallback, useEffect, useState } from 'react'
import {
  MessageSquare,
  MessagesSquare,
  Send,
  Timer,
  UserPlus,
  Users,
} from 'lucide-react'

import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard, Skeleton } from '@/components/dashboard/skeleton'
import { EmptyState } from '@/components/dashboard/empty-state'
import { cn } from '@/lib/utils'

type RangeDays = 7 | 30 | 90

interface ReportSummary {
  conversations_started: number
  new_contacts: number
  messages_in: number
  messages_out: number
  avg_first_response_seconds: number
}
interface DailyPoint {
  day: string
  inbound: number
  outbound: number
}
interface AgentRow {
  user_id: string
  name: string | null
  messages_sent: number
  conversations: number
}
interface Report {
  summary: ReportSummary
  daily: DailyPoint[]
  agents: AgentRow[]
}

export default function ReportsPage() {
  const [range, setRange] = useState<RangeDays>(30)
  // Cache per range so switching tabs doesn't re-fetch what we already have.
  const [cache, setCache] = useState<Record<RangeDays, Report | null>>({
    7: null,
    30: null,
    90: null,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRange = useCallback(
    (r: RangeDays) => {
      if (cache[r]) return
      setLoading(true)
      setError(null)
      fetch(`/api/reports?days=${r}`)
        .then(async (res) => {
          if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Failed to load report')
          return res.json() as Promise<Report>
        })
        .then((data) => setCache((prev) => ({ ...prev, [r]: data })))
        .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load report'))
        .finally(() => setLoading(false))
    },
    [cache],
  )

  useEffect(() => {
    fetchRange(30)
    // Only on mount — subsequent ranges load via the tab handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRange = useCallback(
    (r: RangeDays) => {
      setRange(r)
      fetchRange(r)
    },
    [fetchRange],
  )

  const report = cache[range]
  const showSkeleton = loading && !report

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Message volume, response times, and team performance over time.
          </p>
        </div>
        <div className="flex items-center gap-1 self-start rounded-lg bg-muted/60 p-1">
          {[7, 30, 90].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => handleRange(r as RangeDays)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                range === r
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {r} days
            </button>
          ))}
        </div>
      </div>

      {error && !report ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-sm text-red-400">
          {error}
        </div>
      ) : null}

      {/* Summary tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {showSkeleton ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
        ) : report ? (
          <>
            <MetricCard
              title="Conversations Started"
              value={report.summary.conversations_started.toLocaleString()}
              icon={MessagesSquare}
            />
            <MetricCard
              title="New Contacts"
              value={report.summary.new_contacts.toLocaleString()}
              icon={UserPlus}
            />
            <MetricCard
              title="Messages Received"
              value={report.summary.messages_in.toLocaleString()}
              icon={MessageSquare}
            />
            <MetricCard
              title="Messages Sent"
              value={report.summary.messages_out.toLocaleString()}
              icon={Send}
            />
            <MetricCard
              title="Avg. First Response"
              value={formatDuration(report.summary.avg_first_response_seconds)}
              icon={Timer}
              subtitle="Customer → first reply"
            />
          </>
        ) : null}
      </div>

      {/* Daily volume */}
      <section className="rounded-xl border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Message Volume</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Inbound vs outbound per day</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <LegendDot color="#3b82f6" label="Inbound" />
            <LegendDot color="#7c3aed" label="Outbound" />
          </div>
        </header>
        <div className="p-5">
          {showSkeleton ? (
            <Skeleton className="h-[240px] w-full" />
          ) : report && report.daily.some((d) => d.inbound > 0 || d.outbound > 0) ? (
            <VolumeBars data={report.daily} />
          ) : (
            <EmptyState
              icon={MessageSquare}
              title="No message activity in this range"
              hint="Send or receive messages to populate this chart."
            />
          )}
        </div>
      </section>

      {/* Agent leaderboard */}
      <section className="rounded-xl border border-border bg-card">
        <header className="flex items-center gap-2 border-b border-border px-5 py-4">
          <Users className="h-4 w-4 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">Team Performance</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Agent activity in the selected range</p>
          </div>
        </header>
        {showSkeleton ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : report && report.agents.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium">Agent</th>
                  <th className="px-5 py-2.5 text-right font-medium">Messages Sent</th>
                  <th className="px-5 py-2.5 text-right font-medium">Conversations</th>
                </tr>
              </thead>
              <tbody>
                {report.agents.map((a) => (
                  <tr key={a.user_id} className="border-b border-border/50 last:border-0">
                    <td className="px-5 py-3 font-medium text-foreground">{a.name || 'Unnamed'}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-foreground">
                      {a.messages_sent.toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                      {a.conversations.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5">
            <EmptyState icon={Users} title="No agent activity" hint="Agent replies will appear here." />
          </div>
        )}
      </section>
    </div>
  )
}

// ------------------------------------------------------------
// Grouped bar chart (inline SVG, same viewBox-scaling approach as the
// dashboard's line chart). Two bars per day: inbound + outbound.
// ------------------------------------------------------------

const VB_W = 760
const VB_H = 240
const PAD = { top: 16, right: 12, bottom: 28, left: 36 }

function VolumeBars({ data }: { data: DailyPoint[] }) {
  const max = data.reduce((m, d) => Math.max(m, d.inbound, d.outbound), 0)
  const ceil = niceCeil(max)
  const ticks = Array.from(new Set([0, ceil / 4, ceil / 2, (3 * ceil) / 4, ceil].map((v) => Math.round(v))))

  const chartW = VB_W - PAD.left - PAD.right
  const chartH = VB_H - PAD.top - PAD.bottom
  const slot = chartW / data.length
  // Two bars per slot with a little gap; keep bars slim on 90-day views.
  const barW = Math.max(1, Math.min(10, (slot - 4) / 2))
  const yFor = (v: number) => (ceil === 0 ? PAD.top + chartH : PAD.top + chartH - (v / ceil) * chartH)
  const labelStride = Math.max(1, Math.ceil(data.length / 6))

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-[240px] w-full" role="img" aria-label="Message volume per day">
      {ticks.map((t) => {
        const y = yFor(t)
        return (
          <g key={t}>
            <line x1={PAD.left} x2={VB_W - PAD.right} y1={y} y2={y} stroke="var(--border)" strokeDasharray="3 3" />
            <text x={PAD.left - 6} y={y} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[10px]">
              {t}
            </text>
          </g>
        )
      })}

      {data.map((d, i) => {
        const cx = PAD.left + i * slot + slot / 2
        const inX = cx - barW - 1
        const outX = cx + 1
        return (
          <g key={d.day}>
            <rect x={inX} y={yFor(d.inbound)} width={barW} height={PAD.top + chartH - yFor(d.inbound)} fill="#3b82f6" rx={1}>
              <title>{`${d.day}: ${d.inbound} inbound`}</title>
            </rect>
            <rect x={outX} y={yFor(d.outbound)} width={barW} height={PAD.top + chartH - yFor(d.outbound)} fill="#7c3aed" rx={1}>
              <title>{`${d.day}: ${d.outbound} outbound`}</title>
            </rect>
            {i % labelStride === 0 ? (
              <text x={cx} y={VB_H - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                {shortDayLabel(d.day)}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}

function shortDayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Round up to a "nice" axis max (1/2/5/10 × 10ⁿ). */
function niceCeil(max: number): number {
  if (max <= 0) return 4
  const pow = Math.pow(10, Math.floor(Math.log10(max)))
  const n = max / pow
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return nice * pow
}

/** Seconds → compact human duration ("—", "45s", "12m", "1h 5m"). */
function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '—'
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}
