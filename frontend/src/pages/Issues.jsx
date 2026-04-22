import { useEffect, useState, useCallback } from 'react'
import { api } from '@/api/client'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Sheet } from '@/components/ui/sheet'
import { NatureBadge, IntentBadge, SentimentBadge, StatusBadge } from '@/components/ClassificationBadge'
import { formatDate, truncate, parseVerbatim } from '@/lib/utils'
import { ChevronDown, ChevronRight, ExternalLink, History } from 'lucide-react'

function ReprocessHistory() {
  const [items, setItems] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState(null)
  const limit = 20

  const load = useCallback(() => {
    api.issues.reprocessLogs({ page, limit })
      .then((d) => { setItems(d.items); setTotal(d.total) })
      .catch(() => {})
  }, [page])

  useEffect(() => { load() }, [load])

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="p-6 space-y-4">
      <p className="text-sm text-muted-foreground">{total} reprocess operations</p>

      {!items ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reprocess history yet.</p>
      ) : (
        <div className="divide-y border rounded-md">
          {items.map((log) => (
            <div key={log.id}>
              <button
                className="w-full flex items-start gap-4 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mb-1">
                    <span className="font-mono">{formatDate(log.reprocessed_at)}</span>
                    <span>Issue #{log.issue_id}</span>
                    <span>{log.model}</span>
                    {log.cost_usd != null && <span>${log.cost_usd.toFixed(4)}</span>}
                    {log.input_tokens != null && (
                      <span>{log.input_tokens.toLocaleString()}↑ {log.output_tokens?.toLocaleString()}↓</span>
                    )}
                  </div>
                  <p className="text-sm truncate text-muted-foreground italic">
                    {truncate(log.old_segment_description, 80)}
                  </p>
                  <p className="text-sm truncate">
                    → {truncate(log.new_segment_description, 80)}
                  </p>
                </div>
                <span className="text-muted-foreground text-xs mt-1 shrink-0">
                  {expandedId === log.id ? '▲' : '▼'}
                </span>
              </button>

              {expandedId === log.id && (
                <div className="px-4 pb-4 space-y-3 bg-muted/20 text-sm">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Before</div>
                    <p className="text-muted-foreground">{log.old_segment_description}</p>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">After</div>
                    <p>{log.new_segment_description}</p>
                  </div>
                  {parseVerbatim(log.verbatim_excerpt).length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                        Verbatim Excerpts ({parseVerbatim(log.verbatim_excerpt).length})
                      </div>
                      <div className="space-y-1.5">
                        {parseVerbatim(log.verbatim_excerpt).map((quote, i) => (
                          <blockquote key={i} className="text-xs text-muted-foreground border-l-2 border-border pl-3 italic">
                            {quote}
                          </blockquote>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Issues() {
  const [items, setItems] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [nature, setNature] = useState('')
  const [intent, setIntent] = useState('')
  const [sentiment, setSentiment] = useState('')
  const [status, setStatus] = useState('')
  const [issueId, setIssueId] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [reprocessing, setReprocessing] = useState(false)
  const [reprocessResult, setReprocessResult] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    setError(null)
    api.issues
      .list({
        page, limit,
        issue_id: issueId ? parseInt(issueId) : undefined,
        nature: nature || undefined,
        intent: intent || undefined,
        sentiment: sentiment || undefined,
        status: status || undefined,
      })
      .then((data) => { setItems(data.items); setTotal(data.total) })
      .catch((e) => setError(e.message))
  }, [page, limit, issueId, nature, intent, sentiment, status])

  useEffect(() => { load() }, [load])

  function applyFilter() { setPage(1); setExpanded(null); setSelected(new Set()); load() }

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const pageIds = items?.map((i) => i.id) ?? []
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const somePageSelected = pageIds.some((id) => selected.has(id))

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allPageSelected) {
        pageIds.forEach((id) => next.delete(id))
      } else {
        pageIds.forEach((id) => next.add(id))
      }
      return next
    })
  }

  async function runReprocess() {
    setReprocessing(true)
    setReprocessResult(null)
    try {
      const result = await api.issues.reprocess([...selected])
      setReprocessResult(result)
      setSelected(new Set())
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setReprocessing(false)
    }
  }

  const totalPages = Math.ceil(total / limit)
  const COL_COUNT = 10 // chevron + checkbox + id + description + nature + intent + sentiment + status + transcript + date

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Issues</h1>
          <p className="text-sm text-muted-foreground mt-1">{total} issues extracted</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
          <History className="h-4 w-4 mr-2" />
          Reprocess history
        </Button>
      </div>

      <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} title="Reprocess History">
        <ReprocessHistory />
      </Sheet>

      <div className="flex items-center gap-3 flex-wrap">
        <Input
          type="number"
          placeholder="Issue ID"
          value={issueId}
          onChange={e => { setIssueId(e.target.value); setPage(1) }}
          onKeyDown={e => e.key === 'Enter' && applyFilter()}
          className="h-9 w-28 text-sm"
          min={1}
        />
        <Select value={nature} onChange={(e) => setNature(e.target.value)} className="w-40">
          <option value="">All natures</option>
          <option value="bug">Bug</option>
          <option value="feedback">Feedback</option>
          <option value="question">Question</option>
          <option value="complaint">Complaint</option>
          <option value="feature_request">Feature Request</option>
          <option value="exploration">Exploration</option>
          <option value="cancellation">Cancellation</option>
        </Select>
        <Select value={intent} onChange={(e) => setIntent(e.target.value)} className="w-40">
          <option value="">All intents</option>
          <option value="support">Support</option>
          <option value="action">Action</option>
          <option value="insights">Insights</option>
          <option value="strategy">Strategy</option>
          <option value="sales">Sales</option>
        </Select>
        <Select value={sentiment} onChange={(e) => setSentiment(e.target.value)} className="w-40">
          <option value="">All sentiments</option>
          <option value="positive">Positive</option>
          <option value="negative">Negative</option>
          <option value="neutral">Neutral</option>
          <option value="frustrated">Frustrated</option>
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="matched">Matched</option>
          <option value="unmatched">Unmatched</option>
          <option value="under_review">Under Review</option>
        </Select>
        <Button variant="outline" size="sm" onClick={applyFilter}>Filter</Button>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3">{error}</div>
      )}

      {reprocessResult && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-4 py-3">
          Reprocess complete — {reprocessResult.updated} updated
          {reprocessResult.errors > 0 && `, ${reprocessResult.errors} errors`}
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-4 px-4 py-2.5 bg-primary/5 border border-primary/20 rounded-md text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <Button
            size="sm"
            onClick={runReprocess}
            disabled={reprocessing}
          >
            {reprocessing ? (
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Reprocessing…
              </span>
            ) : 'Reprocess segment description'}
          </Button>
          <button
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="w-8">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    ref={(el) => { if (el) el.indeterminate = somePageSelected && !allPageSelected }}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                </TableHead>
                <TableHead className="w-16">ID</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Nature</TableHead>
                <TableHead>Intent</TableHead>
                <TableHead>Sentiment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Transcript</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!items
                ? Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={COL_COUNT}><Skeleton className="h-5 w-full" /></TableCell>
                    </TableRow>
                  ))
                : items.map((issue) => (
                    <>
                      <TableRow
                        key={issue.id}
                        className={`cursor-pointer ${selected.has(issue.id) ? 'bg-primary/5' : ''}`}
                        onClick={() => setExpanded(expanded === issue.id ? null : issue.id)}
                      >
                        <TableCell className="pr-0" onClick={(e) => e.stopPropagation()}>
                          {expanded === issue.id
                            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected.has(issue.id)}
                            onChange={() => toggleSelect(issue.id)}
                            className="h-4 w-4 rounded border-input accent-primary"
                          />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground tabular-nums">
                          {issue.id}
                        </TableCell>
                        <TableCell className="max-w-[260px]">
                          <span className="text-sm">{truncate(issue.segment_description, 90)}</span>
                        </TableCell>
                        <TableCell><NatureBadge value={issue.nature} /></TableCell>
                        <TableCell><IntentBadge value={issue.intent} /></TableCell>
                        <TableCell><SentimentBadge value={issue.sentiment} /></TableCell>
                        <TableCell><StatusBadge value={issue.classification_status} /></TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[160px]">
                          <span className="truncate block">{issue.transcript_title}</span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(issue.classified_at)}
                        </TableCell>
                      </TableRow>
                      {expanded === issue.id && (
                        <tr key={`${issue.id}-expanded`}>
                          <td colSpan={COL_COUNT} className="p-0">
                            <div className="px-6 py-4 bg-muted/30 space-y-4">
                              <div>
                                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Full Description</div>
                                <p className="text-sm">{issue.segment_description}</p>
                              </div>
                              {parseVerbatim(issue.verbatim_excerpt).length > 0 && (
                                <div>
                                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                                    Verbatim Excerpts ({parseVerbatim(issue.verbatim_excerpt).length})
                                  </div>
                                  <div className="space-y-2">
                                    {parseVerbatim(issue.verbatim_excerpt).map((quote, i) => (
                                      <blockquote key={i} className="text-sm text-muted-foreground border-l-2 border-border pl-3 italic">
                                        {quote}
                                      </blockquote>
                                    ))}
                                  </div>
                                </div>
                              )}
                              <div className="flex items-center gap-3">
                                {issue.transcript_url && (
                                  <a
                                    href={issue.transcript_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    View source
                                  </a>
                                )}
                                <span className="text-xs text-muted-foreground">
                                  Transcript: {issue.transcript_title}
                                </span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>Rows per page:</span>
          <Select
            value={limit}
            onChange={(e) => { setLimit(Number(e.target.value)); setPage(1) }}
            className="h-8 w-20 text-xs"
          >
            {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
          <span>
            {total > 0
              ? `${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total}`
              : '0 results'}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </div>
    </div>
  )
}
