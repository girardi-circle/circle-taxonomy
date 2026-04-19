import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { NatureBadge, IntentBadge, SentimentBadge, StatusBadge } from '@/components/ClassificationBadge'
import { formatDate, truncate } from '@/lib/utils'

function StatCard({ title, value, sub }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value ?? <Skeleton className="h-8 w-16" />}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  )
}

function DistBar({ label, count, total, colorClass }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 text-sm text-muted-foreground capitalize">{label}</span>
      <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
        <div className={`h-2 rounded-full ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-sm tabular-nums">{count}</span>
    </div>
  )
}

const NATURE_COLORS = {
  bug: 'bg-red-400',
  question: 'bg-blue-400',
  feature_request: 'bg-purple-400',
  complaint: 'bg-orange-400',
  feedback: 'bg-teal-400',
  exploration: 'bg-gray-400',
}

const INTENT_COLORS = {
  support: 'bg-blue-400',
  action: 'bg-green-400',
  insights: 'bg-purple-400',
  strategy: 'bg-amber-400',
  sales: 'bg-teal-400',
}

const SENTIMENT_COLORS = {
  positive: 'bg-green-400',
  negative: 'bg-red-400',
  neutral: 'bg-gray-400',
  frustrated: 'bg-orange-400',
}

export default function Dashboard() {
  const [overview, setOverview] = useState(null)
  const [recent, setRecent] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([api.status.overview(), api.issues.list({ limit: 20 })])
      .then(([ov, iss]) => {
        setOverview(ov)
        setRecent(iss.items)
      })
      .catch((e) => setError(e.message))
  }, [])

  const natureTotals = overview
    ? Object.values(overview.issues_by_nature).reduce((a, b) => a + b, 0)
    : 0
  const intentTotals = overview
    ? Object.values(overview.issues_by_intent).reduce((a, b) => a + b, 0)
    : 0
  const sentimentTotals = overview
    ? Object.values(overview.issues_by_sentiment || {}).reduce((a, b) => a + b, 0)
    : 0

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Extraction overview and recent activity</p>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3">
          {error}
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        <StatCard title="Total Transcripts" value={overview?.transcripts_total} />
        <StatCard
          title="Processed"
          value={overview?.transcripts_processed}
          sub={
            overview
              ? `${Math.round((overview.transcripts_processed / (overview.transcripts_total || 1)) * 100)}% of total`
              : null
          }
        />
        <StatCard title="Unprocessed" value={overview?.transcripts_unprocessed} />
        <StatCard title="Total Issues" value={overview?.issues_total} />
      </div>

      <div className="grid grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Issues by Nature</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {overview
              ? Object.entries(overview.issues_by_nature).map(([k, v]) => (
                  <DistBar key={k} label={k} count={v} total={natureTotals} colorClass={NATURE_COLORS[k] || 'bg-gray-400'} />
                ))
              : Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Issues by Intent</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {overview
              ? Object.entries(overview.issues_by_intent).map(([k, v]) => (
                  <DistBar key={k} label={k} count={v} total={intentTotals} colorClass={INTENT_COLORS[k] || 'bg-gray-400'} />
                ))
              : Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Issues by Sentiment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {overview
              ? Object.entries(overview.issues_by_sentiment || {}).map(([k, v]) => (
                  <DistBar key={k} label={k} count={v} total={sentimentTotals} colorClass={SENTIMENT_COLORS[k] || 'bg-gray-400'} />
                ))
              : Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent Issues</CardTitle>
        </CardHeader>
        <CardContent>
          {!recent ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No issues extracted yet.</p>
          ) : (
            <div className="divide-y">
              {recent.map((issue) => (
                <div key={issue.id} className="py-3 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{truncate(issue.segment_description)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{issue.transcript_title}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <NatureBadge value={issue.nature} />
                    <SentimentBadge value={issue.sentiment} />
                    <span className="text-xs text-muted-foreground">{formatDate(issue.classified_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
