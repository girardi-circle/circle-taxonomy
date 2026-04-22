import { useEffect, useState, useCallback } from 'react'
import { api } from '@/api/client'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { StatTile } from '@/components/StatTile'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { formatDate, truncate } from '@/lib/utils'
import { ChevronDown, ChevronRight } from 'lucide-react'

const BAND_COLORS = {
  A: 'bg-green-100 text-green-700 border-green-200',
  B: 'bg-blue-100 text-blue-700 border-blue-200',
  C: 'bg-purple-100 text-purple-700 border-purple-200',
  '?': 'bg-gray-100 text-gray-600 border-gray-200',
}

const DECISION_COLORS = {
  matched: 'bg-green-100 text-green-700',
  auto_created: 'bg-blue-100 text-blue-700',
  unmatched: 'bg-amber-100 text-amber-700',
  rejected_to_C: 'bg-orange-100 text-orange-700',
  error: 'bg-red-100 text-red-700',
}

function BandBadge({ value }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold ${BAND_COLORS[value] || BAND_COLORS['?']}`}>
      Band {value}
    </span>
  )
}

function DecisionBadge({ value }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${DECISION_COLORS[value] || 'bg-gray-100 text-gray-600'}`}>
      {value?.replace('_', ' ')}
    </span>
  )
}


function ExpandedLog({ id }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.classificationLogs.get(id).then(setData).catch(e => setError(e.message))
  }, [id])

  if (error) return <div className="p-4 text-sm text-red-600">{error}</div>
  if (!data) return <div className="p-4"><Skeleton className="h-4 w-full" /></div>

  let candidates = []
  try { candidates = JSON.parse(data.weaviate_candidates || '[]') } catch {}

  return (
    <div className="px-6 py-4 bg-muted/30 space-y-4 text-sm">
      {/* Meta */}
      <div className="grid grid-cols-3 gap-4 text-xs text-muted-foreground">
        <div><span className="font-medium text-foreground">Issue ID:</span> {data.issue_id}</div>
        <div><span className="font-medium text-foreground">Model:</span> {data.model_used || '—'}</div>
        <div><span className="font-medium text-foreground">Classified:</span> {formatDate(data.classified_at)}</div>
        <div><span className="font-medium text-foreground">Input tokens:</span> {data.input_tokens?.toLocaleString() ?? '—'}</div>
        <div><span className="font-medium text-foreground">Output tokens:</span> {data.output_tokens?.toLocaleString() ?? '—'}</div>
        <div><span className="font-medium text-foreground">Cost:</span> {data.cost_usd != null ? `$${data.cost_usd.toFixed(4)}` : '—'}</div>
      </div>

      {/* Segment description */}
      {data.segment_description && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Issue description</div>
          <p>{data.segment_description}</p>
        </div>
      )}

      {/* Weaviate candidates */}
      {candidates.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Weaviate candidates ({candidates.length})
          </div>
          <div className="space-y-1.5">
            {candidates.map((c, i) => (
              <div key={i} className="bg-muted rounded-md px-3 py-2 text-xs flex items-start gap-3">
                <span className={`shrink-0 font-bold ${c.distance < 0.15 ? 'text-green-600' : c.distance < 0.35 ? 'text-blue-600' : 'text-muted-foreground'}`}>
                  {(1 - c.distance).toFixed(2)}
                </span>
                <div className="min-w-0">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-muted-foreground truncate">{c.canonical_description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Prompt */}
      {data.prompt_used && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Prompt sent to Claude</div>
          <pre className="text-xs bg-muted rounded-md p-3 whitespace-pre-wrap overflow-auto max-h-64">{data.prompt_used}</pre>
        </div>
      )}

      {/* Claude response */}
      {data.claude_response && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Claude response</div>
          <pre className="text-xs bg-muted rounded-md p-3 whitespace-pre-wrap overflow-auto max-h-48">
            {(() => { try { return JSON.stringify(JSON.parse(data.claude_response), null, 2) } catch { return data.claude_response } })()}
          </pre>
        </div>
      )}

      {/* Error */}
      {data.error_message && (
        <div>
          <div className="text-xs font-medium text-red-600 uppercase tracking-wide mb-1">Error</div>
          <pre className="text-xs bg-red-50 border border-red-200 rounded-md p-3 text-red-700 whitespace-pre-wrap">{data.error_message}</pre>
        </div>
      )}
    </div>
  )
}

function TriggeredByBadge({ value }) {
  if (!value || value === 'ui') return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 border-gray-200">ui</span>
  )
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 border-indigo-200">{value}</span>
  )
}

function fmt(n, d = 0) { return n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d }) }
function fmtCost(n) { return n == null ? '—' : `$${Number(n).toFixed(4)}` }

export default function ClassificationLogs() {
  const [items, setItems] = useState(null)
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState(null)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [band, setBand] = useState('')
  const [decision, setDecision] = useState('')
  const [triggeredBy, setTriggeredBy] = useState('')
  const [issueId, setIssueId] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    setError(null)
    const params = { page, limit }
    if (issueId) params.issue_id = parseInt(issueId)
    if (band) params.band = band
    if (decision) params.decision = decision
    if (triggeredBy) params.triggered_by = triggeredBy
    api.classificationLogs.list(params)
      .then(d => { setItems(d.items); setTotal(d.total); setStats(d.stats) })
      .catch(e => setError(e.message))
  }, [page, limit, issueId, band, decision, triggeredBy])

  useEffect(() => { load() }, [load])

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Classification Log</h1>
        <p className="text-sm text-muted-foreground mt-1">One row per issue — band routing, Weaviate candidates, Claude prompts &amp; responses</p>
      </div>

      {/* Stats tiles */}
      <div className="grid grid-cols-6 gap-4">
        <StatTile label="Total" main={stats ? fmt(stats.total_runs) : null} />
        <StatTile label="Band A" main={stats ? fmt(stats.band_a) : null} sub="vector_direct" />
        <StatTile label="Band B" main={stats ? fmt(stats.band_b) : null} sub="llm_confirmed" />
        <StatTile label="Band C" main={stats ? fmt(stats.band_c) : null} sub="new / unmatched" />
        <StatTile label="Total cost" main={stats ? fmtCost(stats.total_cost) : null} sub={stats?.avg_cost != null ? `avg ${fmtCost(stats.avg_cost)}` : undefined} />
        <StatTile label="Tokens in / out" main={stats ? `${fmt(stats.total_input_tokens)}` : null} sub={stats ? `${fmt(stats.total_output_tokens)} out` : undefined} />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Input
          type="number"
          placeholder="Issue ID"
          value={issueId}
          onChange={e => { setIssueId(e.target.value); setPage(1) }}
          className="h-9 w-28 text-sm"
          min={1}
        />
        <Select value={band} onChange={e => { setBand(e.target.value); setPage(1) }} className="w-36">
          <option value="">All bands</option>
          <option value="A">Band A</option>
          <option value="B">Band B</option>
          <option value="C">Band C</option>
        </Select>
        <Select value={decision} onChange={e => { setDecision(e.target.value); setPage(1) }} className="w-44">
          <option value="">All decisions</option>
          <option value="matched">Matched</option>
          <option value="auto_created">Auto created</option>
          <option value="unmatched">Unmatched</option>
          <option value="rejected_to_C">Rejected to C</option>
          <option value="error">Error</option>
        </Select>
        <Select value={triggeredBy} onChange={e => { setTriggeredBy(e.target.value); setPage(1) }} className="w-36">
          <option value="">All sources</option>
          <option value="ui">UI</option>
          <option value="dagster">Dagster</option>
        </Select>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3">{error}</div>}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Issue</TableHead>
                <TableHead>Band</TableHead>
                <TableHead>Decision</TableHead>
                <TableHead>Matched subtopic</TableHead>
                <TableHead className="text-right">Confidence</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!items
                ? Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={10}><Skeleton className="h-5 w-full" /></TableCell></TableRow>
                  ))
                : items.map(log => (
                    <>
                      <TableRow key={log.id} className="cursor-pointer" onClick={() => setExpanded(expanded === log.id ? null : log.id)}>
                        <TableCell className="pr-0">
                          {expanded === log.id ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          <span className="text-xs text-muted-foreground mr-2">#{log.issue_id}</span>
                          <span className="text-sm">{truncate(log.segment_description, 70)}</span>
                        </TableCell>
                        <TableCell><BandBadge value={log.band} /></TableCell>
                        <TableCell><DecisionBadge value={log.decision} /></TableCell>
                        <TableCell className="text-sm max-w-[160px]">
                          <span className="truncate block">{log.matched_subtopic_name || '—'}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {log.confidence_score != null ? `${Math.round(log.confidence_score * 100)}%` : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{log.model_used || '—'}</TableCell>
                        <TableCell><TriggeredByBadge value={log.triggered_by} /></TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {log.cost_usd != null ? `$${log.cost_usd.toFixed(4)}` : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(log.classified_at)}</TableCell>
                      </TableRow>
                      {expanded === log.id && (
                        <tr key={`${log.id}-exp`}><td colSpan={10} className="p-0"><ExpandedLog id={log.id} /></td></tr>
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
          <Select value={limit} onChange={e => { setLimit(Number(e.target.value)); setPage(1) }} className="h-8 w-20 text-xs">
            {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
          </Select>
          <span>{total > 0 ? `${(page-1)*limit+1}–${Math.min(page*limit, total)} of ${total}` : '0 results'}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page-1)}>Previous</Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page+1)}>Next</Button>
        </div>
      </div>
    </div>
  )
}
