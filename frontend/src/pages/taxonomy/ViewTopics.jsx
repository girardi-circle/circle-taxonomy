import { useEffect, useState, useCallback } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { NatureBadge, IntentBadge, SentimentBadge } from '@/components/ClassificationBadge'
import { formatDate, truncate, parseVerbatim } from '@/lib/utils'
import { ChevronDown, ChevronRight, Edit2, ExternalLink, Check, X } from 'lucide-react'

// ── Product area colour palette ───────────────────────────────────────────────

const PA_COLORS = {
  'CMS':          { bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-700',   badge: 'bg-blue-100 text-blue-700 border-blue-200',   dot: 'bg-blue-400'   },
  'Live':         { bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-700',  badge: 'bg-green-100 text-green-700 border-green-200',  dot: 'bg-green-400'  },
  'Paywalls':     { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', badge: 'bg-purple-100 text-purple-700 border-purple-200', dot: 'bg-purple-400' },
  'Growth':       { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', badge: 'bg-orange-100 text-orange-700 border-orange-200', dot: 'bg-orange-400' },
  'CRM':          { bg: 'bg-teal-50',   border: 'border-teal-200',   text: 'text-teal-700',   badge: 'bg-teal-100 text-teal-700 border-teal-200',   dot: 'bg-teal-400'   },
  'Email Hub':    { bg: 'bg-rose-50',   border: 'border-rose-200',   text: 'text-rose-700',   badge: 'bg-rose-100 text-rose-700 border-rose-200',   dot: 'bg-rose-400'   },
  'Apps':         { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', badge: 'bg-indigo-100 text-indigo-700 border-indigo-200', dot: 'bg-indigo-400' },
  'Circle Plus':  { bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-700',  badge: 'bg-amber-100 text-amber-700 border-amber-200',  dot: 'bg-amber-400'  },
  'Unassigned':   { bg: 'bg-gray-50',   border: 'border-gray-200',   text: 'text-gray-600',   badge: 'bg-gray-100 text-gray-600 border-gray-200',   dot: 'bg-gray-400'   },
}

function getPAColors(name) {
  return PA_COLORS[name] || PA_COLORS['Unassigned']
}

// ── Product area card ─────────────────────────────────────────────────────────

function ProductAreaCard({ area, selected, onClick }) {
  const c = getPAColors(area.name)
  // Compute stats from the topics array if pre-computed counts are missing
  const topicCount    = area.topics?.length ?? area.topic_count ?? 0
  const subtopicCount = area.topics?.reduce((s, t) => s + (t.subtopics?.length ?? 0), 0) ?? area.subtopic_count ?? 0
  const issueCount    = area.topics?.reduce((s, t) => s + (t.issue_count ?? 0), 0) ?? area.issue_count ?? 0

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border p-4 transition-all ${
        selected
          ? `${c.bg} ${c.border} ring-2 ring-offset-1 ring-current ${c.text}`
          : `bg-card hover:${c.bg} hover:${c.border} border-border`
      }`}
    >
      <div className={`flex items-center gap-2 mb-3`}>
        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${c.dot}`} />
        <span className={`text-sm font-semibold ${selected ? c.text : 'text-foreground'}`}>{area.name}</span>
      </div>
      <div className="grid grid-cols-3 gap-1 text-center">
        <div>
          <div className={`text-lg font-bold tabular-nums ${selected ? c.text : 'text-foreground'}`}>{topicCount}</div>
          <div className="text-xs text-muted-foreground">topics</div>
        </div>
        <div>
          <div className={`text-lg font-bold tabular-nums ${selected ? c.text : 'text-foreground'}`}>{subtopicCount}</div>
          <div className="text-xs text-muted-foreground">subtopics</div>
        </div>
        <div>
          <div className={`text-lg font-bold tabular-nums ${selected ? c.text : 'text-foreground'}`}>{issueCount}</div>
          <div className="text-xs text-muted-foreground">issues</div>
        </div>
      </div>
    </button>
  )
}

// ── Subtopic detail panel ────────────────────────────────────────────────────

function SubtopicDetail({ subtopicId, onClose }) {
  const [data, setData] = useState(null)
  const [issues, setIssues] = useState(null)
  const [issueTotal, setIssueTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [expandedIssue, setExpandedIssue] = useState(null)
  const limit = 20

  useEffect(() => {
    let cancelled = false
    api.taxonomy.subtopic(subtopicId)
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [subtopicId])

  const loadIssues = useCallback(() => {
    let cancelled = false
    api.taxonomy.subtopicIssues(subtopicId, { page, limit })
      .then(d => { if (!cancelled) { setIssues(d.items); setIssueTotal(d.total) } })
      .catch(() => {})
    return () => { cancelled = true }
  }, [subtopicId, page])

  useEffect(() => loadIssues(), [loadIssues])

  if (!data) return <div className="p-6"><Skeleton className="h-8 w-64 mb-4" /><Skeleton className="h-4 w-full" /></div>

  const totalPages = Math.ceil(issueTotal / limit)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        {/* Subtopic header — clearly labelled as the category definition */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subtopic</span>
          </div>
          <h3 className="text-lg font-semibold">{data.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{data.topic_name} · {data.product_area_name || 'Unassigned'}</p>
          <div className="mt-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Canonical description</span>
            <p className="text-sm mt-1 text-muted-foreground italic">{data.canonical_description}</p>
          </div>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg shrink-0">✕</button>
      </div>

      {/* Stats — aggregated from issues, not from the subtopic itself */}
      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Issues breakdown</div>
        <div className="grid grid-cols-4 gap-4">
          <Card><CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Total issues</div>
            <div className="text-2xl font-bold">{data.match_count}</div>
          </CardContent></Card>
          {data.nature_breakdown && (
            <Card><CardContent className="pt-4 pb-3">
              <div className="text-xs text-muted-foreground mb-2">By nature</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {Object.entries(data.nature_breakdown).map(([k, v]) => (
                  <span key={k} className="text-xs text-muted-foreground">{k}: <span className="font-medium text-foreground">{v}</span></span>
                ))}
              </div>
            </CardContent></Card>
          )}
          {data.sentiment_breakdown && (
            <Card><CardContent className="pt-4 pb-3">
              <div className="text-xs text-muted-foreground mb-2">By sentiment</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {Object.entries(data.sentiment_breakdown).map(([k, v]) => (
                  <span key={k} className="text-xs text-muted-foreground">{k}: <span className="font-medium text-foreground">{v}</span></span>
                ))}
              </div>
            </CardContent></Card>
          )}
          {data.intent_breakdown && (
            <Card><CardContent className="pt-4 pb-3">
              <div className="text-xs text-muted-foreground mb-2">By intent</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {Object.entries(data.intent_breakdown).map(([k, v]) => (
                  <span key={k} className="text-xs text-muted-foreground">{k}: <span className="font-medium text-foreground">{v}</span></span>
                ))}
              </div>
            </CardContent></Card>
          )}
        </div>
      </div>

      {/* Issues table — each row is a classified issue, not the subtopic */}
      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Issues</div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead className="w-14">ID</TableHead>
                  <TableHead>Issue description</TableHead>
                  <TableHead>Nature</TableHead>
                  <TableHead>Sentiment</TableHead>
                  <TableHead className="text-right">Confidence</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {!issues ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={9}><Skeleton className="h-4 w-full" /></TableCell></TableRow>
                  ))
                ) : issues.map(issue => (
                  <>
                    <TableRow key={issue.id} className="cursor-pointer" onClick={() => setExpandedIssue(expandedIssue === issue.id ? null : issue.id)}>
                      <TableCell className="pr-0">
                        {expandedIssue === issue.id ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular-nums">#{issue.id}</TableCell>
                      <TableCell className="max-w-[280px]"><span className="text-sm">{truncate(issue.segment_description, 90)}</span></TableCell>
                      <TableCell><NatureBadge value={issue.nature} /></TableCell>
                      <TableCell><SentimentBadge value={issue.sentiment} /></TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {issue.confidence_score != null ? `${Math.round(issue.confidence_score * 100)}%` : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{issue.match_method || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(issue.classified_at)}</TableCell>
                      <TableCell>
                        {issue.source_url && (
                          <a href={issue.source_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-muted-foreground hover:text-foreground">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </TableCell>
                    </TableRow>
                    {expandedIssue === issue.id && (
                      <tr key={`${issue.id}-exp`}><td colSpan={9} className="p-0">
                        <div className="px-6 py-4 bg-muted/30 space-y-4 border-b">
                          <div>
                            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Full description</div>
                            <p className="text-sm">{issue.segment_description}</p>
                          </div>
                          {parseVerbatim(issue.verbatim_excerpt).length > 0 && (
                            <div>
                              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                                Verbatim excerpt{parseVerbatim(issue.verbatim_excerpt).length > 1 ? 's' : ''}
                              </div>
                              <div className="space-y-1.5">
                                {parseVerbatim(issue.verbatim_excerpt).map((q, qi) => (
                                  <blockquote key={qi} className="text-xs text-muted-foreground border-l-2 border-border pl-3 italic">{q}</blockquote>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="flex items-center gap-4 text-xs text-muted-foreground border-t border-border pt-3">
                            <span className="font-medium text-foreground">Classification details</span>
                            {issue.confidence_score != null && (
                              <span>Confidence: <span className="text-foreground font-medium">{Math.round(issue.confidence_score * 100)}%</span></span>
                            )}
                            {issue.match_method && (
                              <span>Method: <span className="text-foreground font-medium">{issue.match_method}</span></span>
                            )}
                          </div>
                        </div>
                      </td></tr>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{(page-1)*limit+1}–{Math.min(page*limit, issueTotal)} of {issueTotal}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page-1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page+1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Subtopic row ──────────────────────────────────────────────────────────────

function SubtopicRow({ subtopic, onEdit }) {
  const [expanded, setExpanded] = useState(false)
  const [everExpanded, setEverExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [saving, setSaving] = useState(false)

  function startEdit(e) {
    e.stopPropagation()
    setEditName(subtopic.name)
    setEditDesc(subtopic.canonical_description || '')
    setEditing(true)
  }

  async function saveEdit(e) {
    e.stopPropagation()
    setSaving(true)
    try {
      await api.taxonomy.updateSubtopic(subtopic.id, { name: editName, canonical_description: editDesc })
      onEdit()
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {/* Subtopic — indented child row with a connecting line on the left */}
      <div
        className={`flex items-center gap-3 pl-10 pr-4 py-2 cursor-pointer transition-colors ${
          expanded ? 'bg-muted/40' : 'hover:bg-muted/20'
        }`}
        onClick={() => { setExpanded(v => !v); setEverExpanded(true) }}
      >
        <div className="shrink-0 text-muted-foreground/50">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </div>
        {editing ? (
          <div className="flex-1 flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <input
              className="flex-1 h-7 rounded border border-input bg-background px-2 text-sm"
              value={editName} onChange={e => setEditName(e.target.value)}
            />
            <input
              className="flex-1 h-7 rounded border border-input bg-background px-2 text-xs text-muted-foreground"
              value={editDesc} onChange={e => setEditDesc(e.target.value)}
            />
            <button onClick={saveEdit} disabled={saving} className="text-green-600 hover:text-green-700"><Check className="h-4 w-4" /></button>
            <button onClick={e => { e.stopPropagation(); setEditing(false) }} className="text-red-500 hover:text-red-600"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <>
            <div className="flex-1 min-w-0 flex items-baseline gap-0">
              <span className="text-sm text-foreground shrink-0 mr-3">{subtopic.name}</span>
              <span className="text-xs text-muted-foreground truncate hidden sm:block min-w-0">{subtopic.canonical_description}</span>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">{subtopic.match_count} issues</span>
            <button onClick={startEdit} className="ml-2 text-muted-foreground hover:text-foreground shrink-0">
              <Edit2 className="h-3 w-3" />
            </button>
          </>
        )}
      </div>
      {everExpanded && !editing && (
        <div className={`mx-4 mb-2 rounded-md border border-border bg-muted/20 overflow-hidden ${expanded ? '' : 'hidden'}`}>
          <SubtopicDetail subtopicId={subtopic.id} onClose={() => setExpanded(false)} />
        </div>
      )}
    </>
  )
}

// ── Topic row ─────────────────────────────────────────────────────────────────

function TopicRow({ topic, onEdit, product_area_name }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`rounded-lg border mb-2 overflow-hidden transition-shadow ${expanded ? 'shadow-sm' : ''}`}>
      {/* Topic header */}
      <button
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
          expanded ? 'bg-muted/50 border-b border-border' : 'bg-card hover:bg-muted/30'
        }`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className={`shrink-0 transition-colors ${expanded ? 'text-foreground' : 'text-muted-foreground'}`}>
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
        <span className="text-sm font-semibold flex-1 text-left">{topic.name}</span>
        <div className="flex items-center gap-3">
          {(product_area_name || topic.product_area_name) && (() => {
            const paName = product_area_name || topic.product_area_name
            const c = getPAColors(paName)
            return (
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${c.badge}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
                {paName}
              </span>
            )
          })()}
          <span className="text-xs text-muted-foreground">{topic.subtopic_count} subtopics</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">{topic.issue_count} issues</span>
        </div>
      </button>

      {/* Subtopics — visually separated from the topic header */}
      {expanded && topic.subtopics && (
        <div className="bg-card">
          {topic.subtopics.length === 0 ? (
            <p className="text-xs text-muted-foreground px-10 py-3">No subtopics yet.</p>
          ) : (
            <div className="divide-y divide-border/40">
              {topic.subtopics.map(s => <SubtopicRow key={s.id} subtopic={s} onEdit={onEdit} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ViewTopics() {
  const [tree, setTree] = useState(null)
  const [selectedPA, setSelectedPA] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadTree = useCallback(() => {
    setLoading(true)
    api.taxonomy.tree()
      .then(d => { setTree(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  useEffect(() => { loadTree() }, [loadTree])

  const filteredTopics = tree
    ? (selectedPA
        ? (tree.find(pa => pa.id === selectedPA)?.topics || []).map(t => ({
            ...t, product_area_name: tree.find(pa => pa.id === selectedPA)?.name,
          }))
        : tree.flatMap(pa => (pa.topics || []).map(t => ({ ...t, product_area_name: pa.name }))))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    : []

  const productAreas = tree || []

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">View Topics</h1>
          <p className="text-sm text-muted-foreground mt-1">Browse the full taxonomy tree</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadTree}>Refresh</Button>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3">{error}</div>}

      {/* Product area grid */}
      {loading ? (
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-3">
          {productAreas.map(pa => (
            <ProductAreaCard
              key={pa.id}
              area={pa}
              selected={selectedPA === pa.id}
              onClick={() => setSelectedPA(selectedPA === pa.id ? null : pa.id)}
            />
          ))}
        </div>
      )}

      {/* Topics list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">
            Topics
            {selectedPA && tree && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                — {tree.find(pa => pa.id === selectedPA)?.name}
              </span>
            )}
          </h2>
          {selectedPA && (
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelectedPA(null)}>
              Show all
            </button>
          )}
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : filteredTopics.length === 0 ? (
          <p className="text-sm text-muted-foreground">No topics found. Run the classification pipeline to create topics.</p>
        ) : (
          filteredTopics.map(topic => (
            <TopicRow key={topic.id} topic={topic} onEdit={loadTree} product_area_name={topic.product_area_name} />
          ))
        )}
      </div>
    </div>
  )
}
