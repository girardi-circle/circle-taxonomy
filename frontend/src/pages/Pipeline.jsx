import { useState, useRef, useEffect, useCallback } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'

function ts(isoString) {
  if (!isoString) return ''
  return new Date(isoString).toLocaleTimeString('en-US', { hour12: false })
}

function LogLine({ event }) {
  switch (event.type) {
    case 'batch_start':
      return (
        <div className="text-xs text-muted-foreground">
          <span className="text-muted-foreground/60 mr-2">{ts(event.ts)}</span>
          Starting batch — {event.total} transcript{event.total !== 1 ? 's' : ''} queued
        </div>
      )

    case 'transcript_start':
      return (
        <div className="mt-4 pt-3 border-t border-border">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground/60">{ts(event.ts)}</span>
            <span className="text-xs text-muted-foreground">{event.index}/{event.total}</span>
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs bg-muted text-muted-foreground capitalize">
              {event.source_type}
            </span>
            <span className="text-sm font-medium truncate">{event.title}</span>
          </div>
          <div className="mt-0.5 ml-6 flex items-center gap-3 text-xs text-muted-foreground">
            <span>ID: {event.transcript_id}</span>
            <span>source_id: {event.source_id}</span>
            {event.source_url && (
              <a
                href={event.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" /> source
              </a>
            )}
          </div>
        </div>
      )

    case 'step':
      return (
        <div className="ml-6 mt-0.5 text-xs text-muted-foreground">
          <span className="font-mono text-muted-foreground/60 mr-2">{ts(event.ts)}</span>
          → {event.message}
        </div>
      )

    case 'transcript_done':
      return (
        <div className="ml-6 mt-1 text-xs font-medium text-green-600 dark:text-green-400">
          <span className="font-mono text-muted-foreground/60 mr-2">{ts(event.ts)}</span>
          ✓ {event.issues_created} issue{event.issues_created !== 1 ? 's' : ''}
          {event.input_tokens != null && (
            <span className="font-normal text-muted-foreground ml-2">
              · {event.input_tokens.toLocaleString()}↑ {event.output_tokens?.toLocaleString()}↓ tokens
              {event.cost_usd != null && <> · ${event.cost_usd.toFixed(4)}</>}
            </span>
          )}
          {event.log_id && (
            <span className="font-normal text-muted-foreground ml-2">· log #{event.log_id}</span>
          )}
        </div>
      )

    case 'transcript_error':
      return (
        <div className="ml-6 mt-1 text-xs text-red-600">
          <span className="font-mono text-muted-foreground/60 mr-2">{ts(event.ts)}</span>
          ✗ {event.message}
        </div>
      )

    case 'batch_done':
      return (
        <div className="mt-4 pt-3 border-t border-border">
          <div className="text-xs font-mono text-muted-foreground/60 mb-1">{ts(event.ts)}</div>
          <div className="flex items-center gap-4 text-sm">
            <span className="font-semibold">Batch complete</span>
            <span className="text-muted-foreground">
              {event.transcripts_processed} processed · {event.issues_created} issues
              {event.errors > 0 && (
                <span className="text-red-600 ml-1">· {event.errors} errors</span>
              )}
            </span>
          </div>
        </div>
      )

    case 'stop_requested':
      return (
        <div className="mt-2 text-xs text-amber-600 font-medium">
          <span className="font-mono text-muted-foreground/60 mr-2">{ts(event.ts)}</span>
          ⏹ {event.message}
        </div>
      )

    case 'stopped':
      return (
        <div className="mt-2 text-xs text-amber-600">
          <span className="font-mono text-muted-foreground/60 mr-2">{ts(event.ts)}</span>
          Execution stopped after current transcript.
        </div>
      )

    case 'batch_error':
      return (
        <div className="mt-4 pt-3 border-t border-red-200 text-sm text-red-600">
          ✗ {event.message}
        </div>
      )

    default:
      return null
  }
}

function groupIntoBatches(events) {
  const batches = []
  let current = null
  for (const event of events) {
    if (event.type === 'batch_start') {
      current = { events: [event], summary: null }
      batches.push(current)
    } else if (current) {
      current.events.push(event)
      if (event.type === 'batch_done' || event.type === 'batch_error') {
        current.summary = event
        current = null
      }
    }
  }
  return batches.reverse()
}

function PastExecutions() {
  const [batches, setBatches] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api.pipeline.log()
      .then((data) => {
        if (!data.file_exists) { setBatches([]); return }
        if (data.error) { setError(data.error); setBatches([]); return }
        setBatches(groupIntoBatches(data.events))
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Past executions</CardTitle>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </CardHeader>

      <CardContent className="pt-0">
        {loading && !batches && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
        {batches && batches.length === 0 && (
          <p className="text-sm text-muted-foreground">No executions found in log file.</p>
        )}
        {batches && batches.length > 0 && (
          <div className="divide-y">
            {batches.map((batch, i) => {
              const start = batch.events[0]
              const summary = batch.summary
              const isOpen = expanded === i
              return (
                <div key={i}>
                  <button
                    className="w-full flex items-center gap-4 py-3 text-sm text-left hover:bg-muted/40 px-1 rounded transition-colors"
                    onClick={() => setExpanded(isOpen ? null : i)}
                  >
                    <span className="font-mono text-xs text-muted-foreground w-20 shrink-0">
                      {ts(start.ts)}
                    </span>
                    {summary ? (
                      <>
                        <span><span className="font-medium">{summary.transcripts_processed}</span> <span className="text-muted-foreground">transcripts</span></span>
                        <span><span className="font-medium">{summary.issues_created}</span> <span className="text-muted-foreground">issues</span></span>
                        {summary.errors > 0 && <span className="text-red-600">{summary.errors} errors</span>}
                      </>
                    ) : (
                      <span className="text-muted-foreground italic">incomplete</span>
                    )}
                    {isOpen
                      ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground ml-auto shrink-0" />
                      : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto shrink-0" />}
                  </button>
                  {isOpen && (
                    <div className="font-mono text-sm px-4 py-3 bg-muted/20 rounded-md mb-2 space-y-0.5 overflow-auto max-h-[480px]">
                      {batch.events.map((event, j) => (
                        <LogLine key={j} event={event} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const EMPTY_FILTERS = { source_id_min: '', source_id_max: '', community_id: '', source_type: '' }

export default function Pipeline() {
  const [limit, setLimit] = useState(10)
  const [runAll, setRunAll] = useState(false)
  const [unprocessed, setUnprocessed] = useState(null)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [events, setEvents] = useState([])
  const logRef = useRef(null)
  const esRef = useRef(null)
  const stopRequestedRef = useRef(false)

  const fetchCount = useCallback((f = filters) => {
    const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''))
    api.pipeline.unprocessedCount(params)
      .then((d) => setUnprocessed(d.count))
      .catch(() => {})
  }, [filters])

  useEffect(() => { fetchCount(EMPTY_FILTERS) }, []) // eslint-disable-line

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [events])

  function setFilter(key, value) {
    setFilters((f) => ({ ...f, [key]: value }))
  }

  function applyFilters() {
    fetchCount(filters)
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS)
    fetchCount(EMPTY_FILTERS)
  }

  function activeFilterParams() {
    return Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''))
  }

  function runExtraction() {
    if (esRef.current) esRef.current.close()
    stopRequestedRef.current = false
    setRunning(true)
    setEvents([])

    const effectiveLimit = runAll ? (unprocessed ?? 9999) : limit
    const params = new URLSearchParams({ limit: effectiveLimit, ...activeFilterParams() })
    const es = new EventSource(`/api/pipeline/extract/stream?${params}`)
    esRef.current = es

    es.onmessage = (e) => {
      const event = JSON.parse(e.data)
      setEvents((prev) => [...prev, event])

      // After current transcript finishes, honour a pending stop request
      if (stopRequestedRef.current && (event.type === 'transcript_done' || event.type === 'transcript_error')) {
        setEvents((prev) => [...prev, { type: 'stopped', ts: new Date().toISOString() }])
        es.close()
        setRunning(false)
        return
      }

      if (event.type === 'batch_done' || event.type === 'batch_error') {
        es.close()
        setRunning(false)
      }
    }

    es.onerror = () => {
      if (!stopRequestedRef.current) {
        setEvents((prev) => [...prev, { type: 'batch_error', message: 'Connection lost', ts: new Date().toISOString() }])
      }
      es.close()
      setRunning(false)
    }
  }

  function requestStop() {
    stopRequestedRef.current = true
    setEvents((prev) => [
      ...prev,
      { type: 'stop_requested', message: 'Stop requested — finishing current transcript...', ts: new Date().toISOString() },
    ])
  }

  const isDone = events.some((e) => e.type === 'batch_done' || e.type === 'batch_error' || e.type === 'stopped')

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pipeline</h1>
        <p className="text-sm text-muted-foreground mt-1">Extract and classify customer issues from transcripts</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Run Extraction</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Filters */}
          <div className="border rounded-md">
            <button
              onClick={() => setFiltersOpen((o) => !o)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors rounded-md"
              disabled={running}
            >
              <span className="font-medium">Filters</span>
              <span className="text-muted-foreground text-xs">{filtersOpen ? '▲' : '▼'}</span>
            </button>

            {filtersOpen && (
              <div className="px-4 pb-4 pt-1 space-y-3 border-t">
                <div className="grid grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Source</label>
                    <Select
                      value={filters.source_type}
                      onChange={(e) => setFilter('source_type', e.target.value)}
                      className="h-8 text-xs"
                    >
                      <option value="">All</option>
                      <option value="zendesk">Zendesk</option>
                      <option value="fathom">Fathom</option>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Community ID</label>
                    <Input
                      type="number" min={0}
                      value={filters.community_id}
                      onChange={(e) => setFilter('community_id', e.target.value)}
                      placeholder="any"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Source ID min</label>
                    <Input
                      value={filters.source_id_min}
                      onChange={(e) => setFilter('source_id_min', e.target.value)}
                      placeholder="e.g. 280000"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Source ID max</label>
                    <Input
                      value={filters.source_id_max}
                      onChange={(e) => setFilter('source_id_max', e.target.value)}
                      placeholder="e.g. 290000"
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={applyFilters} disabled={running}>Apply</Button>
                  <Button size="sm" variant="ghost" onClick={resetFilters} disabled={running}>Reset</Button>
                </div>
              </div>
            )}
          </div>

          {/* Transcript count */}
          <div className="flex items-center gap-2 text-sm py-1 border-y border-border">
            <span className="text-muted-foreground">
              {Object.values(filters).some(Boolean) ? 'Matching transcripts:' : 'Unprocessed transcripts:'}
            </span>
            <span className="font-semibold">{unprocessed === null ? '…' : unprocessed}</span>
          </div>

          {/* Controls */}
          <div className="flex items-end gap-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Batch limit</label>
              <Input
                type="number" min={1} max={9999}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="w-28"
                disabled={running || runAll}
              />
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer pb-1">
              <input
                type="checkbox"
                checked={runAll}
                onChange={(e) => setRunAll(e.target.checked)}
                disabled={running}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Run all
              <span className="text-muted-foreground">
                ({unprocessed === null ? '…' : unprocessed} unprocessed)
              </span>
            </label>

            <div className="flex gap-2 pb-1 ml-auto">
              <Button onClick={runExtraction} disabled={running || unprocessed === 0}>
                {running ? (
                  <span className="flex items-center gap-2">
                    <span className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Running…
                  </span>
                ) : 'Run extraction'}
              </Button>
              <Button
                variant="outline"
                onClick={requestStop}
                disabled={!running || stopRequestedRef.current}
              >
                Stop
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {events.length > 0 && (
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Execution log</CardTitle>
            {isDone && (
              <span className="text-xs text-muted-foreground">
                Execution logs saved to <code className="bg-muted px-1 rounded">logs/pipeline.log</code>
              </span>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <div
              ref={logRef}
              className="font-mono text-sm px-5 py-4 overflow-auto max-h-[520px] space-y-0.5"
            >
              {events.map((event, i) => (
                <LogLine key={i} event={event} />
              ))}
              {running && (
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="h-3 w-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
                  Processing…
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <PastExecutions />
    </div>
  )
}
