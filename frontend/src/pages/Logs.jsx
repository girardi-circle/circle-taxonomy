import { useEffect, useState, useCallback } from 'react'
import { api } from '@/api/client'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { StatTile } from '@/components/StatTile'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { formatDate } from '@/lib/utils'
import { ChevronDown, ChevronRight } from 'lucide-react'

const EMPTY = {
  status: '', model: '', triggered_by: '',
  executed_from: '', executed_to: '',
  min_input_tokens: '', max_input_tokens: '',
  min_output_tokens: '', max_output_tokens: '',
  min_cost: '', max_cost: '',
  min_issues: '', max_issues: '',
}

function TriggeredByBadge({ value }) {
  if (!value || value === 'ui') return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 border-gray-200">ui</span>
  )
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 border-indigo-200">{value}</span>
  )
}

function StatusPill({ value }) {
  const colors = value === 'success'
    ? 'bg-green-100 text-green-700 border-green-200'
    : 'bg-red-100 text-red-700 border-red-200'
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${colors}`}>
      {value}
    </span>
  )
}


function RangeInputs({ label, minKey, maxKey, filters, setFilter, placeholder = '0' }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="flex items-center gap-1.5">
        <Input
          type="number" min={0} placeholder={`min`}
          value={filters[minKey]}
          onChange={(e) => setFilter(minKey, e.target.value)}
          className="h-8 text-xs"
        />
        <span className="text-muted-foreground text-xs">–</span>
        <Input
          type="number" min={0} placeholder={`max`}
          value={filters[maxKey]}
          onChange={(e) => setFilter(maxKey, e.target.value)}
          className="h-8 text-xs"
        />
      </div>
    </div>
  )
}

function ExpandedLog({ id }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.logs.get(id).then(setData).catch((e) => setError(e.message))
  }, [id])

  if (error) return <div className="p-4 text-sm text-red-600">{error}</div>
  if (!data) return <div className="p-4"><Skeleton className="h-4 w-full" /></div>

  return (
    <div className="px-6 py-4 bg-muted/30 space-y-4 text-sm">
      <div className="grid grid-cols-3 gap-4 text-xs text-muted-foreground">
        <div><span className="font-medium text-foreground">Model:</span> {data.model}</div>
        <div><span className="font-medium text-foreground">Executed:</span> {formatDate(data.executed_at)}</div>
        <div><span className="font-medium text-foreground">Issues created:</span> {data.issues_created ?? '—'}</div>
        <div><span className="font-medium text-foreground">Input tokens:</span> {data.input_tokens?.toLocaleString() ?? '—'}</div>
        <div><span className="font-medium text-foreground">Output tokens:</span> {data.output_tokens?.toLocaleString() ?? '—'}</div>
        <div>
          <span className="font-medium text-foreground">Cost:</span>{' '}
          {data.cost_usd != null ? `$${data.cost_usd.toFixed(4)}` : '—'}
        </div>
      </div>

      {data.error_message && (
        <div>
          <div className="text-xs font-medium text-red-600 uppercase tracking-wide mb-1">Error</div>
          <pre className="text-xs bg-red-50 border border-red-200 rounded-md p-3 whitespace-pre-wrap text-red-700">
            {data.error_message}
          </pre>
        </div>
      )}

      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">System Prompt</div>
        <pre className="text-xs bg-muted rounded-md p-3 whitespace-pre-wrap">{data.prompt_system}</pre>
      </div>

      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">User Prompt</div>
        <pre className="text-xs bg-muted rounded-md p-3 whitespace-pre-wrap">{data.prompt_user}</pre>
      </div>

      {data.response_raw && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Claude Response
          </div>
          <pre className="text-xs bg-muted rounded-md p-3 whitespace-pre-wrap overflow-auto max-h-96">
            {(() => {
              try { return JSON.stringify(JSON.parse(data.response_raw), null, 2) }
              catch { return data.response_raw }
            })()}
          </pre>
        </div>
      )}
    </div>
  )
}

function fmt(n, decimals = 0) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: decimals })
}

function fmtCost(n) {
  if (n == null) return '—'
  return `$${Number(n).toFixed(4)}`
}

export default function Logs() {
  const [items, setItems] = useState(null)
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState(null)
  const [models, setModels] = useState([])
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState(EMPTY)
  const [applied, setApplied] = useState(EMPTY)
  const [expanded, setExpanded] = useState(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [error, setError] = useState(null)
  const [limit, setLimit] = useState(10)

  useEffect(() => {
    api.logs.models().then(setModels).catch(() => {})
  }, [])

  const load = useCallback(() => {
    setError(null)
    const params = { page, limit }
    Object.entries(applied).forEach(([k, v]) => { if (v !== '') params[k] = v })
    api.logs.list(params)
      .then((data) => { setItems(data.items); setTotal(data.total); setStats(data.stats) })
      .catch((e) => setError(e.message))
  }, [page, limit, applied])

  useEffect(() => { load() }, [load])

  function setFilter(key, value) {
    setFilters((f) => ({ ...f, [key]: value }))
  }

  function applyFilters() {
    setPage(1)
    setExpanded(null)
    setApplied({ ...filters })
  }

  function resetFilters() {
    setFilters(EMPTY)
    setApplied(EMPTY)
    setPage(1)
    setExpanded(null)
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit Log</h1>
        <p className="text-sm text-muted-foreground mt-1">Prompt, response, tokens, and cost per extraction run</p>
      </div>

      {/* Filters */}
      <Card>
        <button
          onClick={() => setFiltersOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium hover:bg-muted/50 transition-colors rounded-lg"
        >
          <span>Filters</span>
          {filtersOpen
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </button>
        {filtersOpen && <CardContent className="pt-0 pb-5 space-y-4">
          {/* Row 1: dropdowns + dates */}
          <div className="grid grid-cols-5 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className="h-8 text-xs">
                <option value="">All</option>
                <option value="success">Success</option>
                <option value="error">Error</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Model</label>
              <Select value={filters.model} onChange={(e) => setFilter('model', e.target.value)} className="h-8 text-xs">
                <option value="">All</option>
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Triggered by</label>
              <Select value={filters.triggered_by} onChange={(e) => setFilter('triggered_by', e.target.value)} className="h-8 text-xs">
                <option value="">All</option>
                <option value="ui">UI</option>
                <option value="dagster">Dagster</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <Input
                type="datetime-local"
                value={filters.executed_from}
                onChange={(e) => setFilter('executed_from', e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <Input
                type="datetime-local"
                value={filters.executed_to}
                onChange={(e) => setFilter('executed_to', e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* Row 2: numeric ranges */}
          <div className="grid grid-cols-4 gap-4">
            <RangeInputs label="Input tokens" minKey="min_input_tokens" maxKey="max_input_tokens" filters={filters} setFilter={setFilter} />
            <RangeInputs label="Output tokens" minKey="min_output_tokens" maxKey="max_output_tokens" filters={filters} setFilter={setFilter} />
            <RangeInputs label="Cost (USD)" minKey="min_cost" maxKey="max_cost" filters={filters} setFilter={setFilter} />
            <RangeInputs label="Issues created" minKey="min_issues" maxKey="max_issues" filters={filters} setFilter={setFilter} />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" onClick={applyFilters}>Apply</Button>
            <Button size="sm" variant="outline" onClick={resetFilters}>Reset</Button>
          </div>
        </CardContent>}
      </Card>

      {/* Stats tiles */}
      <div className="grid grid-cols-5 gap-4">
        <StatTile
          label="Total runs"
          main={stats ? fmt(stats.total_runs) : null}
        />
        <StatTile
          label="Total cost"
          main={stats ? fmtCost(stats.total_cost) : null}
          sub={stats?.avg_cost != null ? `avg ${fmtCost(stats.avg_cost)} / run` : undefined}
        />
        <StatTile
          label="Total issues"
          main={stats ? fmt(stats.total_issues) : null}
          sub={stats?.avg_issues != null ? `avg ${fmt(stats.avg_issues, 1)} / run` : undefined}
        />
        <StatTile
          label="Total tokens in"
          main={stats ? fmt(stats.total_input_tokens) : null}
          sub={stats?.avg_input_tokens != null ? `avg ${fmt(stats.avg_input_tokens, 0)} / run` : undefined}
        />
        <StatTile
          label="Total tokens out"
          main={stats ? fmt(stats.total_output_tokens) : null}
          sub={stats?.avg_output_tokens != null ? `avg ${fmt(stats.avg_output_tokens, 0)} / run` : undefined}
        />
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3">{error}</div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Executed at</TableHead>
                <TableHead>Transcript</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Tokens in</TableHead>
                <TableHead className="text-right">Tokens out</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Issues</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!items
                ? Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={10}><Skeleton className="h-5 w-full" /></TableCell>
                    </TableRow>
                  ))
                : items.map((log) => (
                    <>
                      <TableRow
                        key={log.id}
                        className="cursor-pointer"
                        onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                      >
                        <TableCell className="pr-0">
                          {expanded === log.id
                            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{formatDate(log.executed_at)}</TableCell>
                        <TableCell className="text-sm max-w-[200px]">
                          <span className="truncate block">{log.transcript_title || '—'}</span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{log.model}</TableCell>
                        <TableCell><StatusPill value={log.status} /></TableCell>
                        <TableCell><TriggeredByBadge value={log.triggered_by} /></TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                          {log.input_tokens?.toLocaleString() ?? '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                          {log.output_tokens?.toLocaleString() ?? '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {log.cost_usd != null ? `$${log.cost_usd.toFixed(4)}` : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {log.status === 'success' ? log.issues_created : '—'}
                        </TableCell>
                      </TableRow>
                      {expanded === log.id && (
                        <tr key={`${log.id}-exp`}>
                          <td colSpan={10} className="p-0">
                            <ExpandedLog id={log.id} />
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
            {[5, 10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
          <span>{total > 0 ? `${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total}` : '0 results'}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </div>
    </div>
  )
}
