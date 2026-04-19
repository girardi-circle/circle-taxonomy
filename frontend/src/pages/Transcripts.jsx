import { useEffect, useState, useCallback } from 'react'
import { api } from '@/api/client'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { NatureBadge, IntentBadge, SentimentBadge, StatusBadge } from '@/components/ClassificationBadge'
import { formatDate, truncate, parseVerbatim } from '@/lib/utils'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'

function ExpandedTranscript({ id }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.transcripts.get(id).then(setData).catch((e) => setError(e.message))
  }, [id])

  if (error) return <div className="p-4 text-sm text-red-600">{error}</div>
  if (!data) return <div className="p-4"><Skeleton className="h-4 w-full" /></div>

  return (
    <div className="px-6 py-4 bg-muted/30 space-y-4">
      {data.summary && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Summary</div>
          <p className="text-sm">{data.summary}</p>
        </div>
      )}
      {data.raw_text && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Raw Text</div>
          <pre className="text-xs bg-muted rounded-md p-3 whitespace-pre-wrap overflow-auto max-h-64">{data.raw_text}</pre>
        </div>
      )}
      {data.issues?.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Issues ({data.issues.length})
          </div>
          <div className="space-y-2">
            {data.issues.map((issue) => (
              <div key={issue.id} className="bg-background rounded-md border p-3 text-sm space-y-1.5">
                <p>{issue.segment_description}</p>
                <div className="flex items-center gap-2">
                  <NatureBadge value={issue.nature} />
                  <IntentBadge value={issue.intent} />
                  <SentimentBadge value={issue.sentiment} />
                  <StatusBadge value={issue.classification_status} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Transcripts() {
  const [items, setItems] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [sourceType, setSourceType] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [error, setError] = useState(null)
  const limit = 20

  const load = useCallback(() => {
    setError(null)
    api.transcripts
      .list({ page, limit, status: status || undefined, source_type: sourceType || undefined })
      .then((data) => {
        setItems(data.items)
        setTotal(data.total)
      })
      .catch((e) => setError(e.message))
  }, [page, status, sourceType])

  useEffect(() => { load() }, [load])

  function applyFilter() {
    setPage(1)
    setExpanded(null)
    load()
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Transcripts</h1>
        <p className="text-sm text-muted-foreground mt-1">{total} transcripts</p>
      </div>

      <div className="flex items-center gap-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
          <option value="">All statuses</option>
          <option value="processed">Processed</option>
          <option value="unprocessed">Unprocessed</option>
        </Select>
        <Select value={sourceType} onChange={(e) => setSourceType(e.target.value)} className="w-40">
          <option value="">All sources</option>
          <option value="zendesk">Zendesk</option>
          <option value="fathom">Fathom</option>
        </Select>
        <Button variant="outline" size="sm" onClick={applyFilter}>Filter</Button>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3">{error}</div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Title</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead className="text-right">Issues</TableHead>
                <TableHead>Ingested</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {!items
                ? Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={7}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                : items.map((t) => (
                    <>
                      <TableRow
                        key={t.id}
                        className="cursor-pointer"
                        onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                      >
                        <TableCell className="pr-0">
                          {expanded === t.id ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium max-w-[200px]">
                          <span className="truncate block">{t.title || '—'}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs capitalize">{t.source_type}</span>
                        </TableCell>
                        <TableCell className="max-w-[300px] text-muted-foreground">
                          {truncate(t.summary, 100) || <span className="italic text-xs">Not processed</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{t.issue_count}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(t.ingested_at)}
                        </TableCell>
                        <TableCell>
                          {t.source_url && (
                            <a
                              href={t.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded === t.id && (
                        <tr key={`${t.id}-expanded`}>
                          <td colSpan={7} className="p-0">
                            <ExpandedTranscript id={t.id} />
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page === totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
