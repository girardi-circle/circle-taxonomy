import { useEffect, useState, useRef, useCallback } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Select } from '@/components/ui/select'
import { NatureBadge, IntentBadge, SentimentBadge } from '@/components/ClassificationBadge'
import { formatDate, parseVerbatim } from '@/lib/utils'
import { ChevronDown, ChevronRight, CheckCircle, XCircle, Edit2 } from 'lucide-react'

// ── Classification log rendering ──────────────────────────────────────────────

function ts(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-US', { hour12: false })
}

function ClassifyLogLine({ event }) {
  switch (event.type) {
    case 'classify_start':
      return (
        <div className="text-xs text-muted-foreground">
          <span className="font-mono text-muted-foreground/60 mr-2">{ts(event.ts)}</span>
          Starting classification — {event.total} issue{event.total !== 1 ? 's' : ''} queued
          {event.workers && <span className="ml-1 text-muted-foreground/60">({event.workers} workers)</span>}
        </div>
      )
    case 'issue_matched':
      return (
        <div className="ml-4 text-xs text-green-600">
          <span className="font-mono text-muted-foreground/60 mr-2">{ts(event.ts)}</span>
          ✓ #{event.issue_id} → <span className="font-medium">{event.subtopic_name}</span>
          <span className="text-muted-foreground ml-1">
            Band {event.band} · {event.confidence != null ? `${Math.round(event.confidence * 100)}%` : ''}
          </span>
        </div>
      )
    case 'issue_created':
      return (
        <div className="ml-4 text-xs text-blue-600">
          <span className="font-mono text-muted-foreground/60 mr-2">{ts(event.ts)}</span>
          ✦ #{event.issue_id} → new subtopic <span className="font-medium">{event.subtopic_name}</span>
          {event.new_topic && <span className="text-muted-foreground ml-1">(+ new topic)</span>}
        </div>
      )
    case 'issue_unmatched':
      return (
        <div className="ml-4 text-xs text-amber-600">
          <span className="font-mono text-muted-foreground/60 mr-2">{ts(event.ts)}</span>
          ~ #{event.issue_id} unmatched — queued for review
        </div>
      )
    case 'candidate_created':
      return (
        <div className="ml-4 text-xs text-muted-foreground">
          <span className="font-mono text-muted-foreground/60 mr-2">{ts(event.ts)}</span>
          Candidate created: <span className="font-medium">{event.subtopic_name}</span>
          <span className="ml-1">({event.cluster_size} issue{event.cluster_size !== 1 ? 's' : ''})</span>
        </div>
      )
    case 'classify_done':
      return (
        <div className="mt-3 pt-3 border-t text-sm font-medium">
          <span className="font-mono text-xs text-muted-foreground/60 mr-2">{ts(event.ts)}</span>
          Done · {event.matched} matched · {event.auto_created || 0} auto-created · {event.pending_review || 0} pending review · {event.errors || 0} errors
        </div>
      )
    case 'classify_error':
      return (
        <div className="text-xs text-red-600">
          <span className="font-mono text-muted-foreground/60 mr-2">{ts(event.ts)}</span>
          ✗ {event.message}
        </div>
      )
    default:
      return null
  }
}

// ── Product area colours (mirrors ViewTopics) ─────────────────────────────────

const PA_BADGE = {
  'CMS':         'bg-blue-100 text-blue-700 border-blue-200',
  'Live':        'bg-green-100 text-green-700 border-green-200',
  'Paywalls':    'bg-purple-100 text-purple-700 border-purple-200',
  'Growth':      'bg-orange-100 text-orange-700 border-orange-200',
  'CRM':         'bg-teal-100 text-teal-700 border-teal-200',
  'Email Hub':   'bg-rose-100 text-rose-700 border-rose-200',
  'Apps':        'bg-indigo-100 text-indigo-700 border-indigo-200',
  'Circle Plus': 'bg-amber-100 text-amber-700 border-amber-200',
}

function PATag({ name }) {
  if (!name) return null
  const cls = PA_BADGE[name] || 'bg-gray-100 text-gray-600 border-gray-200'
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {name}
    </span>
  )
}

// ── Review queue ──────────────────────────────────────────────────────────────

function IssueRow({ issue }) {
  const [expanded, setExpanded] = useState(false)
  const quotes = parseVerbatim(issue.verbatim_excerpt)
  return (
    <>
      <div
        className={`flex items-center gap-3 pl-6 pr-4 py-2 cursor-pointer transition-colors ${expanded ? 'bg-muted/40' : 'hover:bg-muted/20'}`}
        onClick={() => setExpanded(v => !v)}
      >
        <div className="shrink-0 text-muted-foreground/50">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </div>
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">#{issue.id}</span>
        <span className="text-sm flex-1 min-w-0 truncate">{issue.segment_description}</span>
        <div className="flex items-center gap-2 shrink-0">
          <NatureBadge value={issue.nature} />
          <SentimentBadge value={issue.sentiment} />
        </div>
      </div>
      {expanded && (
        <div className="pl-10 pr-4 pb-3 bg-muted/20 space-y-2">
          <p className="text-sm pt-2">{issue.segment_description}</p>
          {quotes.length > 0 && (
            <div className="space-y-1">
              {quotes.map((q, i) => (
                <blockquote key={i} className="text-xs text-muted-foreground border-l-2 border-border pl-3 italic">{q}</blockquote>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}

function SubtopicCandidate({ candidate, onApprove, onReject, onMerge, onDoneId, onRefreshCandidate, showToast, refreshKey = 0, topicIsLocked = false, allCandidates = [] }) {
  const [expanded, setExpanded] = useState(false)
  const [everExpanded, setEverExpanded] = useState(false)
  const [detail, setDetail] = useState(null)
  const [editing, setEditing] = useState(false)
  const [editTopic, setEditTopic] = useState('')
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [rejectModal, setRejectModal] = useState(false)
  const [mergeModal, setMergeModal] = useState(false)
  const [mergeType, setMergeType] = useState('candidate') // 'candidate' | 'subtopic'
  const [mergeSearch, setMergeSearch] = useState('')
  const [mergeSubtopicResults, setMergeSubtopicResults] = useState([])
  const [mergeTargetId, setMergeTargetId] = useState(null)
  const [mergeTargetLabel, setMergeTargetLabel] = useState('')
  const [syncStatus, setSyncStatus] = useState('idle') // 'idle' | 'syncing' | 'done' | 'rejected'

  function handleExpand() {
    if (syncStatus !== 'idle') return
    setExpanded(v => !v)
    if (!everExpanded) {
      setEverExpanded(true)
      api.candidates.get(candidate.id).then(setDetail).catch(() => {})
    }
  }

  // Re-fetch detail when a merge into this candidate completed
  useEffect(() => {
    if (refreshKey > 0 && everExpanded) {
      api.candidates.get(candidate.id).then(setDetail).catch(() => {})
    }
  }, [refreshKey]) // eslint-disable-line

  function handleApprove(withEdits) {
    const body = withEdits ? { topic_name: editTopic, subtopic_name: editName, canonical_description: editDesc } : {}
    setEditing(false)
    setSyncStatus('done')
    setTimeout(() => onDoneId(candidate.id), 300)
    onApprove(candidate.id, body)
      .then(() => showToast(`"${candidate.suggested_subtopic_name}" approved and synced ✓`))
      .catch(() => showToast('Approved but Weaviate sync may have failed', 'warning'))
  }

  function handleReject() {
    setRejectModal(false)
    setSyncStatus('done')
    setTimeout(() => onDoneId(candidate.id), 300)
    onReject(candidate.id)
      .then(() => showToast('Issues returned to classification queue ✓'))
      .catch(() => showToast('Rejected but cleanup may have failed', 'warning'))
  }

  function openMergeModal() {
    setMergeType('candidate')
    setMergeSearch('')
    setMergeTargetId(null)
    setMergeTargetLabel('')
    setMergeSubtopicResults([])
    setMergeModal(true)
  }

  async function handleMergeSearchChange(q) {
    setMergeSearch(q)
    setMergeTargetId(null)
    if (mergeType === 'subtopic') {
      if (q.length < 1) { setMergeSubtopicResults([]); return }
      const results = await api.subtopicSearch(q).catch(() => [])
      setMergeSubtopicResults(results)
    }
  }

  function handleMergeConfirm() {
    if (!mergeTargetId) return
    const targetId = mergeTargetId
    const targetLabel = mergeTargetLabel
    const type = mergeType

    // Close modal and remove source item immediately — no waiting
    setMergeModal(false)
    setSyncStatus('done')
    setTimeout(() => onDoneId(candidate.id), 300)

    // Run in background
    onMerge(candidate.id, type, targetId)
      .then(() => {
        showToast(`Merged into "${targetLabel}" — Weaviate entry deleted ✓`, 'success')
        if (type === 'candidate') onRefreshCandidate(targetId)
      })
      .catch(() => showToast('Merge completed but Weaviate cleanup may have failed', 'warning'))
  }

  if (syncStatus === 'syncing') {
    return (
      <div className="flex items-center gap-3 pl-10 pr-4 py-2.5 bg-muted/20 text-muted-foreground">
        <span className="h-3 w-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin shrink-0" />
        <span className="text-sm">{candidate.suggested_subtopic_name}</span>
        <span className="text-xs ml-1">Syncing with Weaviate…</span>
      </div>
    )
  }

  if (syncStatus === 'done' || syncStatus === 'rejected') {
    return (
      <div className="flex items-center gap-3 pl-10 pr-4 py-2.5 bg-green-50 text-green-700 transition-opacity">
        <span className="text-sm">✓</span>
        <span className="text-sm">{candidate.suggested_subtopic_name}</span>
        <span className="text-xs ml-1">{syncStatus === 'done' ? 'Approved' : 'Rejected'}</span>
      </div>
    )
  }

  return (
    <>
      <div
        className={`flex items-center gap-3 pl-10 pr-4 py-2 cursor-pointer transition-colors ${expanded ? 'bg-muted/40' : 'hover:bg-muted/20'}`}
        onClick={handleExpand}
      >
        <div className="shrink-0 text-muted-foreground/50">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </div>
        <div className="flex-1 min-w-0 flex items-baseline gap-0">
          <span className="text-sm text-foreground shrink-0 mr-3">{candidate.suggested_subtopic_name}</span>
          <span className="text-xs text-muted-foreground truncate hidden sm:block min-w-0">{candidate.canonical_description}</span>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">{candidate.issue_count} issues</span>
      </div>

      {everExpanded && (
        <div className={`ml-10 mr-4 mb-1 rounded-md border border-border bg-muted/10 overflow-hidden ${expanded ? '' : 'hidden'}`}>
          {/* Issues list */}
          <div className="border-b">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-4 py-2">Linked issues</div>
            {!detail ? (
              <div className="px-4 pb-3"><Skeleton className="h-4 w-full" /></div>
            ) : detail.issues?.length === 0 ? (
              <p className="text-xs text-muted-foreground px-4 pb-3">No linked issues found.</p>
            ) : (
              <div className="divide-y divide-border/40">
                {detail.issues.map(issue => <IssueRow key={issue.id} issue={issue} />)}
              </div>
            )}
          </div>

          {/* Edit fields */}
          {editing && (
            <div className="px-4 py-3 space-y-2 border-b">
              <div>
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                  Topic name
                  {topicIsLocked && (
                    <span className="inline-flex items-center rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-xs font-medium">
                      Locked — Topic has existing Subtopics
                    </span>
                  )}
                </label>
                <input
                  className={`mt-1 flex h-8 w-full rounded-md border px-3 py-1 text-sm ${topicIsLocked ? 'border-input bg-muted text-muted-foreground cursor-not-allowed' : 'border-input bg-background'}`}
                  value={editTopic}
                  onChange={e => !topicIsLocked && setEditTopic(e.target.value)}
                  readOnly={topicIsLocked}
                  title={topicIsLocked ? 'Topic name cannot be changed because this Topic already has approved Subtopics.' : undefined}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Subtopic name</label>
                <input className="mt-1 flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                  value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Canonical description</label>
                <textarea className="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-1 text-sm min-h-16"
                  value={editDesc} onChange={e => setEditDesc(e.target.value)} />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 px-4 py-3 bg-muted/20 flex-wrap">
            {!editing ? (
              <>
                <button onClick={() => handleApprove(false)} disabled={syncStatus === 'syncing'}
                  className="inline-flex items-center gap-1.5 rounded-md bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 text-xs font-medium disabled:opacity-50 transition-colors">
                  <CheckCircle className="h-3.5 w-3.5" /> Approve
                </button>
                <button
                  onClick={() => { setEditTopic(candidate.suggested_topic_name || ''); setEditName(candidate.suggested_subtopic_name || ''); setEditDesc(candidate.canonical_description || ''); setEditing(true) }}
                  disabled={syncStatus === 'syncing'}
                  className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background hover:bg-muted px-3 py-1.5 text-xs font-medium disabled:opacity-50 transition-colors">
                  <Edit2 className="h-3.5 w-3.5" /> Approve with edits
                </button>
                <button onClick={openMergeModal} disabled={syncStatus === 'syncing'}
                  className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-1.5 text-xs font-medium disabled:opacity-50 transition-colors">
                  Merge
                </button>
                <button onClick={() => setRejectModal(true)} disabled={syncStatus === 'syncing'}
                  className="inline-flex items-center gap-1.5 rounded-md bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-1.5 text-xs font-medium disabled:opacity-50 transition-colors">
                  <XCircle className="h-3.5 w-3.5" /> Reject
                </button>
              </>
            ) : (
              <>
                <button onClick={() => handleApprove(true)} disabled={syncStatus === 'syncing'}
                  className="inline-flex items-center gap-1.5 rounded-md bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 text-xs font-medium disabled:opacity-50 transition-colors">
                  <CheckCircle className="h-3.5 w-3.5" /> Save &amp; Approve
                </button>
                <button onClick={() => setEditing(false)}
                  className="inline-flex items-center rounded-md border border-input bg-background hover:bg-muted px-3 py-1.5 text-xs font-medium transition-colors">
                  Cancel
                </button>
              </>
            )}
          </div>

          {/* Reject warning modal */}
          {rejectModal && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
              <div className="bg-background border rounded-lg shadow-xl p-6 w-[420px] space-y-4">
                <h3 className="text-base font-semibold text-red-600">Reject candidate</h3>
                <p className="text-sm text-muted-foreground">
                  Rejecting <strong>"{candidate.suggested_subtopic_name}"</strong> will send all{' '}
                  <strong>{candidate.issue_count} linked issue{candidate.issue_count !== 1 ? 's' : ''}</strong> back to
                  the classification queue with no topic or subtopic. They will need to be re-classified.
                </p>
                <p className="text-xs text-muted-foreground">
                  This action will be recorded in the Classification Log. If you want to keep the issues categorised,
                  use <strong>Merge</strong> instead.
                </p>
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="outline" onClick={() => setRejectModal(false)}>Cancel</Button>
                  <Button size="sm" variant="destructive" onClick={handleReject}>
                    Reject &amp; return to queue
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Merge modal */}
          {mergeModal && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
              <div className="bg-background border rounded-lg shadow-xl p-6 w-[480px] space-y-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">
                    {candidate.suggested_topic_name} › {candidate.suggested_subtopic_name}
                  </div>
                  <h3 className="text-base font-semibold">Merge into…</h3>
                </div>

                {/* Type toggle */}
                <div className="flex rounded-md border border-input overflow-hidden text-xs font-medium">
                  {['candidate', 'subtopic'].map(t => (
                    <button key={t} onClick={() => { setMergeType(t); setMergeSearch(''); setMergeTargetId(null); setMergeTargetLabel(''); setMergeSubtopicResults([]) }}
                      className={`flex-1 px-3 py-2 transition-colors ${mergeType === t ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted text-muted-foreground'}`}>
                      {t === 'candidate' ? 'Another candidate' : 'Approved subtopic'}
                    </button>
                  ))}
                </div>

                {/* Search */}
                <input
                  type="text"
                  placeholder={mergeType === 'candidate' ? 'Search candidates by name…' : 'Search approved subtopics…'}
                  value={mergeSearch}
                  onChange={e => handleMergeSearchChange(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                  autoFocus
                />

                {/* Results list */}
                <div className="max-h-52 overflow-auto border border-border rounded-md divide-y divide-border/50">
                  {mergeType === 'candidate' ? (
                    allCandidates
                      .filter(c => c.id !== candidate.id && (!mergeSearch || c.suggested_subtopic_name?.toLowerCase().includes(mergeSearch.toLowerCase())))
                      .map(c => (
                        <button key={c.id} onClick={() => { setMergeTargetId(c.id); setMergeTargetLabel(c.suggested_subtopic_name) }}
                          className={`w-full text-left px-3 py-2 text-sm transition-colors ${mergeTargetId === c.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/50'}`}>
                          <div>{c.suggested_subtopic_name}</div>
                          <div className="text-xs text-muted-foreground">{c.suggested_topic_name} · {c.issue_count} issues</div>
                        </button>
                      ))
                  ) : (
                    mergeSubtopicResults.length === 0 && mergeSearch.length < 1 ? (
                      <p className="text-xs text-muted-foreground px-3 py-2">Type to search approved subtopics…</p>
                    ) : mergeSubtopicResults.length === 0 ? (
                      <p className="text-xs text-muted-foreground px-3 py-2">No results found.</p>
                    ) : (
                      mergeSubtopicResults.map(s => (
                        <button key={s.id} onClick={() => { setMergeTargetId(s.id); setMergeTargetLabel(s.name) }}
                          className={`w-full text-left px-3 py-2 text-sm transition-colors ${mergeTargetId === s.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/50'}`}>
                          <div>{s.name}</div>
                          <div className="text-xs text-muted-foreground">{s.topic_name} · {s.match_count} issues</div>
                        </button>
                      ))
                    )
                  )}
                </div>

                {mergeTargetId && (
                  <p className="text-xs text-muted-foreground">
                    Selected: <span className="font-medium text-foreground">{mergeTargetLabel}</span>
                  </p>
                )}

                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="outline" onClick={() => setMergeModal(false)}>Cancel</Button>
                  <Button size="sm" onClick={handleMergeConfirm} disabled={!mergeTargetId}>
                    Merge
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}

function ExistingSubtopicRow({ subtopic }) {
  const [expanded, setExpanded] = useState(false)
  const [everExpanded, setEverExpanded] = useState(false)
  const [detail, setDetail] = useState(null)

  function handleExpand() {
    setExpanded(v => !v)
    if (!everExpanded) {
      setEverExpanded(true)
      api.taxonomy.subtopic(subtopic.id).then(setDetail).catch(() => {})
    }
  }

  return (
    <>
      <div
        className={`flex items-center gap-3 pl-10 pr-4 py-2 cursor-pointer transition-colors ${expanded ? 'bg-blue-50/60' : 'hover:bg-blue-50/40'}`}
        onClick={handleExpand}
      >
        <div className="shrink-0 text-blue-400">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </div>
        <div className="flex-1 min-w-0 flex items-baseline gap-0">
          <span className="text-sm text-foreground shrink-0 mr-3">{subtopic.name}</span>
          <span className="text-xs text-muted-foreground truncate min-w-0">{subtopic.canonical_description}</span>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">{subtopic.match_count} issues</span>
      </div>

      {everExpanded && (
        <div className={`ml-10 mr-4 mb-1 rounded-md border border-blue-100 bg-blue-50/20 overflow-hidden ${expanded ? '' : 'hidden'}`}>
          {!detail ? (
            <div className="p-3"><Skeleton className="h-4 w-full" /></div>
          ) : (
            <div className="p-4 space-y-3 text-sm">
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Canonical description</div>
                <p className="text-muted-foreground italic">{detail.canonical_description}</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {detail.nature_breakdown && Object.keys(detail.nature_breakdown).length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">By nature</div>
                    <div className="space-y-0.5">
                      {Object.entries(detail.nature_breakdown).map(([k, v]) => (
                        <div key={k} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{k}</span>
                          <span className="font-medium">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {detail.sentiment_breakdown && Object.keys(detail.sentiment_breakdown).length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">By sentiment</div>
                    <div className="space-y-0.5">
                      {Object.entries(detail.sentiment_breakdown).map(([k, v]) => (
                        <div key={k} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{k}</span>
                          <span className="font-medium">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {detail.intent_breakdown && Object.keys(detail.intent_breakdown).length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">By intent</div>
                    <div className="space-y-0.5">
                      {Object.entries(detail.intent_breakdown).map(([k, v]) => (
                        <div key={k} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{k}</span>
                          <span className="font-medium">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}

function TopicGroup({ topicName, candidates, productAreaName, topicInfo, onApprove, onReject, onMerge, onDoneId, onRefreshCandidate, showToast, refreshKeys, allCandidates }) {
  const [expanded, setExpanded] = useState(false)
  const [everExpanded, setEverExpanded] = useState(false)

  function handleExpand() {
    setExpanded(v => !v)
    if (!everExpanded) setEverExpanded(true)
  }

  const existingSubtopics = topicInfo?.subtopics || []
  const topicIsLocked = existingSubtopics.length > 0

  return (
    <div className="rounded-lg border mb-2 overflow-hidden">
      <button
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${expanded ? 'bg-muted/50 border-b border-border' : 'bg-card hover:bg-muted/30'}`}
        onClick={handleExpand}
      >
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <span className="text-sm font-semibold flex-1">{topicName}</span>
        <div className="flex items-center gap-3">
          <PATag name={productAreaName || topicInfo?.topic?.product_area_name} />
          {topicIsLocked && (
            <span className="inline-flex items-center rounded-full bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 text-xs font-medium">
              {existingSubtopics.length} existing
            </span>
          )}
          <span className="text-xs text-muted-foreground">{candidates.length} pending</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">{candidates.reduce((s, c) => s + (c.issue_count || 0), 0)} issues</span>
        </div>
      </button>

      {everExpanded && (
        <div className={`bg-card ${expanded ? '' : 'hidden'}`}>
          {/* Pending candidates */}
          <div className="divide-y divide-border/40">
            {candidates.map(c => (
              <SubtopicCandidate
                key={c.id}
                candidate={c}
                onApprove={onApprove}
                onReject={onReject}
                onMerge={onMerge}
                onDoneId={onDoneId}
                onRefreshCandidate={onRefreshCandidate}
                showToast={showToast}
                refreshKey={refreshKeys?.[c.id] || 0}
                topicIsLocked={topicIsLocked}
                allCandidates={allCandidates}
              />
            ))}
          </div>

          {/* Existing approved subtopics — context section after candidates */}
          {existingSubtopics.length > 0 && (
            <div className="border-t border-border bg-blue-50/30">
              <div className="pl-10 pr-4 py-2 text-xs font-medium text-blue-700 uppercase tracking-wide">
                Existing subtopics in this topic ({existingSubtopics.length})
              </div>
              <div className="divide-y divide-border/30">
                {existingSubtopics.map(s => (
                  <ExistingSubtopicRow key={s.id} subtopic={s} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Toast({ toasts }) {
  if (!toasts.length) return null
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 items-end">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-start gap-3 rounded-lg border shadow-lg px-4 py-3 text-sm max-w-sm animate-in slide-in-from-right-2 fade-in ${
          t.type === 'warning'
            ? 'bg-amber-50 border-amber-200 text-amber-800'
            : 'bg-green-50 border-green-200 text-green-800'
        }`}>
          <span>{t.type === 'warning' ? '⚠️' : '✓'}</span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  )
}

function ReviewQueue({ onDone }) {
  const [candidates, setCandidates] = useState([])
  const [total, setTotal] = useState(0)
  const [doneIds, setDoneIds] = useState(new Set())
  const [topicInfoMap, setTopicInfoMap] = useState({})
  const [refreshKeys, setRefreshKeys] = useState({}) // {candidateId: counter}
  const [toasts, setToasts] = useState([])
  const [page, setPage] = useState(1)
  const [productAreaId, setProductAreaId] = useState('')
  const [productAreas, setProductAreas] = useState([])
  const [loading, setLoading] = useState(false)
  const limit = 50

  useEffect(() => {
    api.taxonomy.tree().then(tree => {
      const pas = (tree || []).filter(pa => pa.id !== null)
      setProductAreas(pas)
    }).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setDoneIds(new Set())
    try {
      const params = { status: 'pending', page, limit }
      if (productAreaId) params.product_area_id = productAreaId
      const d = await api.candidates.list(params)
      const items = d.items || []

      // Fetch all topic info in parallel before rendering anything
      const uniqueTopics = [...new Set(items.map(c => c.suggested_topic_name).filter(Boolean))]
      const results = await Promise.all(
        uniqueTopics.map(name =>
          api.taxonomy.lookupTopic(name)
            .then(info => ({ name, info }))
            .catch(() => ({ name, info: { topic: null, subtopics: [] } }))
        )
      )
      const map = {}
      results.forEach(({ name, info }) => { map[name] = info })

      // Set everything at once — single render, badges present from the start
      setCandidates(items)
      setTotal(d.total || 0)
      setTopicInfoMap(map)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [page, productAreaId])

  useEffect(() => { load() }, [load])

  function handleDoneId(id) {
    setDoneIds(prev => new Set([...prev, id]))
    setTotal(t => Math.max(0, t - 1))
    onDone()
  }

  function showToast(message, type = 'success') {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }

  function refreshCandidate(candidateId) {
    setRefreshKeys(prev => ({ ...prev, [candidateId]: (prev[candidateId] || 0) + 1 }))
  }

  async function handleApprove(id, body) { return api.candidates.approve(id, body) }
  async function handleReject(id) { return api.candidates.reject(id) }
  async function handleMerge(id, type, target_id) { return api.candidates.merge(id, type, target_id) }

  // Group by topic, filtering out locally-done items
  const groups = {}
  candidates.filter(c => !doneIds.has(c.id)).forEach(c => {
    const key = c.suggested_topic_name || 'Unassigned'
    if (!groups[key]) groups[key] = []
    groups[key].push(c)
  })
  const sortedGroups = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-4">
      <Toast toasts={toasts} />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">Review queue</h2>
          {total > 0 && (
            <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-medium">
              {total} pending
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={productAreaId} onChange={e => { setProductAreaId(e.target.value); setPage(1) }} className="h-8 w-44 text-xs">
            <option value="">All product areas</option>
            {productAreas.map(pa => <option key={pa.id} value={pa.id}>{pa.name}</option>)}
          </Select>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>Refresh</Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pending candidates.</p>
      ) : (
        <>
          {sortedGroups.map(([topicName, topicCandidates]) => (
            <TopicGroup
              key={topicName}
              topicName={topicName}
              candidates={topicCandidates}
              productAreaName={topicCandidates[0]?.suggested_product_area_name}
              topicInfo={topicInfoMap[topicName] || null}
              onApprove={handleApprove}
              onReject={handleReject}
              onMerge={handleMerge}
              onDoneId={handleDoneId}
              onRefreshCandidate={refreshCandidate}
              showToast={showToast}
              refreshKeys={refreshKeys}
              allCandidates={candidates}
            />
          ))}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm pt-1">
              <span className="text-muted-foreground">Page {page} of {totalPages} · {total} total</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const NATURE_OPTS = ['Bug','Feedback','Question','Complaint','Feature Request','Exploration','Cancellation']
const INTENT_OPTS = ['Support','Action','Insights','Strategy','Sales']
const SENTIMENT_OPTS = ['positive','negative','neutral','frustrated']

export default function ProcessTopics() {
  const [uncategorized, setUncategorized] = useState(null)
  const [autoCreate, setAutoCreate] = useState(false)
  const [limit, setLimit] = useState(100)
  const [natures, setNatures] = useState([])    // selected nature names
  const [intents, setIntents] = useState([])
  const [sentiments, setSentiments] = useState([])
  const [sourceType, setSourceType] = useState('')
  const [running, setRunning] = useState(false)
  const [events, setEvents] = useState([])
  const [recentlyClassified, setRecentlyClassified] = useState([])
  const [queueKey, setQueueKey] = useState(0) // bump to force ReviewQueue reload
  const logRef = useRef(null)
  const esRef = useRef(null)
  const stopRef = useRef(false)

  const [processAll, setProcessAll] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const buildFilterParams = useCallback(() => {
    const p = {}
    if (natures.length) p.nature_names = natures.join(',')
    if (intents.length) p.intent_names = intents.join(',')
    if (sentiments.length) p.sentiments = sentiments.join(',')
    if (sourceType) p.source_types = sourceType
    return p
  }, [natures, intents, sentiments, sourceType])

  const loadUncategorized = useCallback(() => {
    api.taxonomy.uncategorized(buildFilterParams())
      .then(d => setUncategorized(d.count))
      .catch(() => {})
  }, [buildFilterParams])

  useEffect(() => { loadUncategorized() }, [loadUncategorized])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [events])

  function toggleBadge(list, setList, value) {
    setList(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value])
  }

  function buildStreamUrl() {
    const params = new URLSearchParams()
    params.set('auto_create', autoCreate)
    const effectiveLimit = processAll ? (uncategorized ?? 9999) : limit
    params.set('limit', effectiveLimit)
    Object.entries(buildFilterParams()).forEach(([k, v]) => params.set(k, v))
    return `/api/pipeline/classify/stream?${params}`
  }

  function runClassification() {
    if (esRef.current) esRef.current.close()
    stopRef.current = false
    setRunning(true)
    setEvents([])
    setRecentlyClassified([])

    const es = new EventSource(buildStreamUrl())
    esRef.current = es

    es.onmessage = (e) => {
      const event = JSON.parse(e.data)
      setEvents(prev => [...prev, event])

      if (event.type === 'issue_matched' || event.type === 'issue_created') {
        setRecentlyClassified(prev => [event, ...prev].slice(0, 20))
      }

      if (event.type === 'classify_done' || event.type === 'classify_error') {
        es.close()
        setRunning(false)
        loadUncategorized()
        setQueueKey(k => k + 1)
      }
    }

    es.onerror = () => {
      setEvents(prev => [...prev, { type: 'classify_error', message: 'Connection lost', ts: new Date().toISOString() }])
      es.close()
      setRunning(false)
    }
  }

  function stopClassification() {
    if (esRef.current) esRef.current.close()
    setRunning(false)
    setEvents(prev => [...prev, { type: 'classify_error', message: 'Stopped by user', ts: new Date().toISOString() }])
  }

  function BadgePicker({ label, opts, selected, setSelected }) {
    return (
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1.5">{label}</div>
        <div className="flex flex-wrap gap-1.5">
          {opts.map(o => (
            <button
              key={o}
              onClick={() => toggleBadge(selected, setSelected, o)}
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                selected.includes(o)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground hover:bg-muted'
              }`}
            >
              {o}
            </button>
          ))}
        </div>
      </div>
    )
  }

  const isDone = events.some(e => e.type === 'classify_done' || e.type === 'classify_error')

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Process Topics</h1>
        <p className="text-sm text-muted-foreground mt-1">Classify unmatched issues into topics and subtopics</p>
      </div>

      <Card>
        <CardContent className="pt-5 space-y-5">
          {/* Filter toggle */}
          <button
            onClick={() => setFiltersOpen(o => !o)}
            className="flex items-center justify-between w-full text-sm font-medium hover:text-foreground transition-colors"
            disabled={running}
          >
            <span className="flex items-center gap-2">
              {filtersOpen
                ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              Filters
              {(natures.length + intents.length + sentiments.length + (sourceType ? 1 : 0)) > 0 && (
                <span className="inline-flex items-center rounded-full bg-primary text-primary-foreground px-2 py-0.5 text-xs font-medium">
                  {natures.length + intents.length + sentiments.length + (sourceType ? 1 : 0)} active
                </span>
              )}
            </span>
          </button>

          {filtersOpen && (
            <div className="space-y-5 pt-1">
              <BadgePicker label="Nature" opts={NATURE_OPTS} selected={natures} setSelected={setNatures} />
              <BadgePicker label="Intent" opts={INTENT_OPTS} selected={intents} setSelected={setIntents} />
              <BadgePicker label="Sentiment" opts={SENTIMENT_OPTS} selected={sentiments} setSelected={setSentiments} />
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-muted-foreground">Source</span>
                <Select value={sourceType} onChange={e => setSourceType(e.target.value)} className="h-8 w-36 text-xs">
                  <option value="">All</option>
                  <option value="zendesk">Zendesk</option>
                  <option value="fathom">Fathom</option>
                </Select>
              </div>
            </div>
          )}

          {/* Filtered count */}
          <div className="flex items-center gap-2 py-2 border-y border-border">
            <span className="text-2xl font-bold tabular-nums">{uncategorized ?? '…'}</span>
            <span className="text-sm text-muted-foreground">
              pending issue{uncategorized !== 1 ? 's' : ''} match your filters
            </span>
          </div>

          {/* Execution options */}
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">Limit</label>
              <input
                type="number" min={1} max={9999} value={limit}
                onChange={e => setLimit(Number(e.target.value))}
                className="h-8 w-24 rounded-md border border-input bg-background px-3 text-sm"
                disabled={running || processAll}
              />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox" checked={processAll} onChange={e => setProcessAll(e.target.checked)}
                disabled={running} className="h-4 w-4 rounded border-input accent-primary"
              />
              Process all{uncategorized != null ? ` (${uncategorized})` : ''}
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox" checked={autoCreate} onChange={e => setAutoCreate(e.target.checked)}
                disabled={running} className="h-4 w-4 rounded border-input accent-primary"
              />
              Auto-create topics
              <span className="text-xs text-muted-foreground">(skip review queue)</span>
            </label>
          </div>

          {/* Buttons */}
          <div className="flex gap-2">
            <Button onClick={runClassification} disabled={running || uncategorized === 0}>
              {running ? (
                <span className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Classifying…
                </span>
              ) : 'Classify'}
            </Button>
            <Button variant="outline" onClick={stopClassification} disabled={!running}>Stop</Button>
          </div>
        </CardContent>
      </Card>

      {/* Live log */}
      {events.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Classification log</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div ref={logRef} className="font-mono text-sm px-5 py-4 overflow-auto max-h-80 space-y-0.5">
              {events.map((event, i) => <ClassifyLogLine key={i} event={event} />)}
              {running && (
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="h-3 w-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
                  Processing…
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Review queue — reloads only when a new classification run completes (queueKey bump) */}
      <ReviewQueue key={queueKey} onDone={loadUncategorized} />

      {/* Recently classified */}
      {recentlyClassified.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Recently classified</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {recentlyClassified.map((event, i) => (
                <div key={i} className="px-5 py-3 flex items-center justify-between gap-4 text-sm">
                  <span className="text-muted-foreground text-xs font-mono">{ts(event.ts)}</span>
                  <span className="flex-1 text-muted-foreground">#{event.issue_id}</span>
                  <span className="font-medium">{event.subtopic_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {event.confidence != null ? `${Math.round(event.confidence * 100)}%` : '—'}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    event.band === 'A' ? 'bg-green-100 text-green-700' :
                    event.band === 'B' ? 'bg-blue-100 text-blue-700' :
                    'bg-purple-100 text-purple-700'
                  }`}>
                    {event.type === 'issue_created' ? 'new' : `Band ${event.band}`}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
