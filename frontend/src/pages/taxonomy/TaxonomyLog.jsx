import { useEffect, useState, useCallback } from 'react'
import { api } from '@/api/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { formatDate } from '@/lib/utils'
import { ArrowRight } from 'lucide-react'

const ACTION_STYLES = {
  merge_topic:         { label: 'Merge Topic',      color: 'bg-blue-100 text-blue-700 border-blue-200' },
  merge_subtopic:      { label: 'Merge Subtopic',   color: 'bg-purple-100 text-purple-700 border-purple-200' },
  move_subtopic:       { label: 'Move Subtopic',    color: 'bg-teal-100 text-teal-700 border-teal-200' },
  rename_topic:        { label: 'Rename Topic',     color: 'bg-amber-100 text-amber-700 border-amber-200' },
  rename_subtopic:     { label: 'Rename Subtopic',  color: 'bg-orange-100 text-orange-700 border-orange-200' },
  deactivate_topic:    { label: 'Deactivate Topic', color: 'bg-red-100 text-red-700 border-red-200' },
  deactivate_subtopic: { label: 'Deactivate ST',   color: 'bg-red-100 text-red-700 border-red-200' },
}

function ActionBadge({ type }) {
  const style = ACTION_STYLES[type] || { label: type, color: 'bg-gray-100 text-gray-600 border-gray-200' }
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${style.color}`}>
      {style.label}
    </span>
  )
}

const ACTION_TYPES = Object.keys(ACTION_STYLES)

export default function TaxonomyLog() {
  const [items, setItems] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [actionType, setActionType] = useState('')
  const [entityType, setEntityType] = useState('')
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    setError(null)
    const params = { page, limit }
    if (actionType) params.action_type = actionType
    if (entityType) params.entity_type = entityType
    api.taxonomyLog.list(params)
      .then(d => { setItems(d.items); setTotal(d.total) })
      .catch(e => setError(e.message))
  }, [page, limit, actionType, entityType])

  useEffect(() => { load() }, [load])

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Taxonomy Log</h1>
          <p className="text-sm text-muted-foreground mt-1">
            History of all structural changes — merges, moves, renames, and deactivations.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>Refresh</Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={actionType} onChange={e => { setActionType(e.target.value); setPage(1) }} className="w-52">
          <option value="">All action types</option>
          {ACTION_TYPES.map(t => (
            <option key={t} value={t}>{ACTION_STYLES[t].label}</option>
          ))}
        </Select>
        <Select value={entityType} onChange={e => { setEntityType(e.target.value); setPage(1) }} className="w-36">
          <option value="">All entities</option>
          <option value="topic">Topic</option>
          <option value="subtopic">Subtopic</option>
        </Select>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3">{error}</div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="w-8" />
                <TableHead>Target</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!items
                ? Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-5 w-full" /></TableCell></TableRow>
                  ))
                : items.length === 0
                ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                      No taxonomy changes recorded yet.
                    </TableCell></TableRow>
                  )
                : items.map(row => (
                    <TableRow key={row.id}>
                      <TableCell><ActionBadge type={row.action_type} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground capitalize">{row.entity_type}</TableCell>
                      <TableCell className="text-sm max-w-[160px]">
                        <span className="truncate block">{row.source_name || `#${row.source_id}`}</span>
                      </TableCell>
                      <TableCell className="px-0">
                        {row.target_id && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
                      </TableCell>
                      <TableCell className="text-sm max-w-[160px]">
                        <span className="truncate block text-muted-foreground">{row.target_name || (row.target_id ? `#${row.target_id}` : '—')}</span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px]">
                        <span className="truncate block">{row.notes || '—'}</span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(row.performed_at)}
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>Rows per page:</span>
          <Select value={limit} onChange={e => { setLimit(Number(e.target.value)); setPage(1) }} className="h-8 w-20 text-xs">
            {[20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
          </Select>
          <span>{total > 0 ? `${(page-1)*limit+1}–${Math.min(page*limit, total)} of ${total}` : '0 results'}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      </div>
    </div>
  )
}
