import { useEffect, useState, useCallback, useRef } from 'react'
import { api } from '@/api/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Select } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { NatureBadge, IntentBadge, SentimentBadge } from '@/components/ClassificationBadge'
import { formatDate, truncate, parseVerbatim } from '@/lib/utils'
import { ChevronDown, ChevronRight, AlertTriangle, Sparkles, GitMerge, Pencil } from 'lucide-react'
import { Sheet } from '@/components/ui/sheet'

// ── Helpers ────────────────────────────────────────────────────────────────────

function warnIfSyncIssues(result, showToast) {
  if (result?.sync_warnings?.length) {
    showToast(
      `Action completed but Weaviate sync had ${result.sync_warnings.length} issue${result.sync_warnings.length !== 1 ? 's' : ''} — vector index may be out of date`,
      'error'
    )
  }
}

function Toast({ toasts }) {
  if (!toasts.length) return null
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2">
      {toasts.map(t => (
        <div key={t.id} className={`rounded-lg border shadow-lg px-4 py-3 text-sm max-w-sm ${t.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-green-50 border-green-200 text-green-800'}`}>
          {t.message}
        </div>
      ))}
    </div>
  )
}

function ConfirmModal({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
      <div className="bg-background border rounded-lg shadow-xl p-6 w-[420px] space-y-4">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{message}</p>
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button size="sm" variant={danger ? 'destructive' : 'default'} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  )
}

// ── Health banner — per product area ─────────────────────────────────────────

function paStats(pa) {
  const topics = pa.topics || []
  const subtopics = topics.flatMap(t => t.subtopics || [])
  return {
    id: pa.id,
    name: pa.name,
    topics: topics.length,
    subtopics: subtopics.length,
    zero_subtopics: topics.filter(t => (t.subtopics || []).length === 0).length,
    one_subtopic: topics.filter(t => (t.subtopics || []).length === 1).length,
    one_issue:  subtopics.filter(s => s.match_count === 1).length,
    few_issues: subtopics.filter(s => s.match_count > 0 && s.match_count < 3).length,
    no_issues:  subtopics.filter(s => s.match_count === 0).length,
  }
}

function HealthBanner({ tree, selectedPA, onSelectPA, activeFilter, onFilter }) {
  if (!tree) return <Skeleton className="h-40 w-full" />

  const rows = tree.map(paStats)
  const totals = {
    name: 'All areas',
    topics: rows.reduce((s, r) => s + r.topics, 0),
    subtopics: rows.reduce((s, r) => s + r.subtopics, 0),
    zero_subtopics: rows.reduce((s, r) => s + r.zero_subtopics, 0),
    one_subtopic: rows.reduce((s, r) => s + r.one_subtopic, 0),
    one_issue:    rows.reduce((s, r) => s + r.one_issue, 0),
    few_issues: rows.reduce((s, r) => s + r.few_issues, 0),
    no_issues: rows.reduce((s, r) => s + r.no_issues, 0),
  }

  function MetricCell({ value, filterKey, paId }) {
    const warn = value > 0
    const isActive = activeFilter === filterKey && (selectedPA === paId || (!paId && !selectedPA))
    return (
      <button
        onClick={() => {
          if (paId !== undefined) onSelectPA(selectedPA === paId ? null : paId)
          onFilter(isActive ? null : filterKey)
        }}
        className={`w-full text-right tabular-nums text-sm px-3 py-2.5 transition-colors rounded ${
          isActive ? 'bg-amber-100 text-amber-700 font-semibold' :
          warn ? 'text-amber-600 hover:bg-amber-50 cursor-pointer' :
          'text-muted-foreground'
        }`}
        title={warn ? `Filter by this metric` : undefined}
      >
        {warn && <AlertTriangle className="inline h-3 w-3 mr-1 mb-0.5" />}{value}
      </button>
    )
  }

  const cols = 'grid-cols-[200px_1fr_1fr_1fr_1fr_1fr]'

  return (
    <Card>
      <CardContent className="p-0">
        {/* Header row */}
        <div className={`grid ${cols} text-xs font-medium text-muted-foreground border-b`}>
          <div className="px-3 py-2">Product area</div>
          <div className="px-3 py-2 text-right">Topics</div>
          <div className="px-3 py-2 text-right">Subtopics</div>
          <div className="px-3 py-2 text-right">1-subtopic</div>
          <div className="px-3 py-2 text-right">{'< 3 issues'}</div>
          <div className="px-3 py-2 text-right">0 issues</div>
        </div>

        {/* Totals row */}
        <div
          className={`grid ${cols} border-b bg-muted/30 cursor-pointer transition-colors ${!selectedPA ? 'ring-1 ring-inset ring-primary/30 bg-primary/5' : 'hover:bg-muted/50'}`}
          onClick={() => { onSelectPA(null); onFilter(null) }}
        >
          <div className="px-3 py-2.5 text-sm font-semibold">{totals.name}</div>
          <div className="px-3 py-2.5 text-right text-sm tabular-nums text-muted-foreground">{totals.topics}</div>
          <div className="px-3 py-2.5 text-right text-sm tabular-nums text-muted-foreground">{totals.subtopics}</div>
          <MetricCell value={totals.one_subtopic} filterKey="one_subtopic" />
          <MetricCell value={totals.few_issues} filterKey="few_issues" />
          <MetricCell value={totals.no_issues} filterKey="no_issues" />
        </div>

        {/* Per-PA rows */}
        {rows.map(row => {
          const rowKey = row.id ?? '__unassigned__'
          const isSelected = selectedPA === rowKey
          return (
          <div
            key={rowKey}
            className={`grid ${cols} border-b last:border-0 cursor-pointer transition-colors ${
              isSelected ? 'bg-primary/5 ring-1 ring-inset ring-primary/30' : 'hover:bg-muted/30'
            }`}
            onClick={() => { onSelectPA(isSelected ? null : rowKey); onFilter(null) }}
          >
            <div className="px-3 py-2.5 text-sm font-medium">{row.name}</div>
            <div className="px-3 py-2.5 text-right text-sm tabular-nums text-muted-foreground">{row.topics}</div>
            <div className="px-3 py-2.5 text-right text-sm tabular-nums text-muted-foreground">{row.subtopics}</div>
            <MetricCell value={row.one_subtopic} filterKey="one_subtopic" paId={row.id} />
            <MetricCell value={row.few_issues} filterKey="few_issues" paId={row.id} />
            <MetricCell value={row.no_issues} filterKey="no_issues" paId={row.id} />
          </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function TopicOverviewList({ topics, selectedPA, activeFilter, selectedIds, onToggle, onToggleAll, selectedSubtopicIds, onToggleSubtopic, onSelectSubtopics, onDeselectSubtopics, onSelectAllSubtopics, onEditTopic, onEditSubtopic, disabled }) {
  // First filter by product area
  const byPA = selectedPA === '__unassigned__'
    ? topics.filter(t => !t.product_area_id)
    : selectedPA !== null && selectedPA !== undefined && selectedPA !== ''
    ? topics.filter(t => t.product_area_id === selectedPA)
    : topics

  // Then apply health metric filter
  const filtered = activeFilter === 'zero_subtopics'
    ? byPA.filter(t => (t.subtopics || []).length === 0)
    : activeFilter === 'one_subtopic'
    ? byPA.filter(t => (t.subtopics || []).length === 1)
    : activeFilter === 'one_issue'
    ? byPA.filter(t => (t.subtopics || []).some(s => s.match_count === 1))
    : activeFilter === 'few_issues'
    ? byPA.filter(t => (t.subtopics || []).some(s => s.match_count > 0 && s.match_count < 3))
    : activeFilter === 'no_issues'
    ? byPA.filter(t => (t.subtopics || []).some(s => s.match_count === 0))
    : byPA

  if (filtered.length === 0) return <p className="text-sm text-muted-foreground">No topics match this filter.</p>

  const allSelected = filtered.length > 0 && filtered.every(t => selectedIds.has(t.id))
  const someSelected = filtered.some(t => selectedIds.has(t.id))

  const allSubtopicIds = filtered.flatMap(t => (t.subtopics || []).map(st => st.id))
  const anySelected = selectedIds.size > 0 || selectedSubtopicIds.size > 0
  const [showSelectDropdown, setShowSelectDropdown] = useState(false)
  const dropdownRef = useRef(null)

  useEffect(() => {
    if (!showSelectDropdown) return
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setShowSelectDropdown(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showSelectDropdown])

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3 px-1 py-1.5">
        <div className="relative shrink-0" ref={dropdownRef}>
          <input
            type="checkbox"
            checked={allSelected}
            ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
            onChange={() => {}}
            onClick={e => { e.preventDefault(); if (!disabled) setShowSelectDropdown(v => !v) }}
            disabled={disabled}
            className="h-4 w-4 rounded border-input accent-primary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          />
          {showSelectDropdown && (
            <div className="absolute top-full left-0 mt-1 w-56 bg-background border border-border rounded-md shadow-md z-20 py-1">
              {(() => {
                const cappedTopics = filtered.slice(0, TOPIC_REVIEW_LIMIT)
                const cappedSubtopicIds = allSubtopicIds.slice(0, SUBTOPIC_REVIEW_LIMIT)
                const topicLabel = filtered.length > TOPIC_REVIEW_LIMIT
                  ? `Select first ${TOPIC_REVIEW_LIMIT} of ${filtered.length} topics`
                  : `Select all ${filtered.length} topics`
                const subtopicLabel = allSubtopicIds.length > SUBTOPIC_REVIEW_LIMIT
                  ? `Select first ${SUBTOPIC_REVIEW_LIMIT} of ${allSubtopicIds.length} subtopics`
                  : `Select all ${allSubtopicIds.length} subtopics`
                const bothLabel = (filtered.length > TOPIC_REVIEW_LIMIT || allSubtopicIds.length > SUBTOPIC_REVIEW_LIMIT)
                  ? `Select first ${Math.min(filtered.length, TOPIC_REVIEW_LIMIT)}T + ${Math.min(allSubtopicIds.length, SUBTOPIC_REVIEW_LIMIT)}ST`
                  : `Select all (topics + subtopics)`
                return (<>
                  <button onClick={() => { onToggleAll(cappedTopics, false); setShowSelectDropdown(false) }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors">
                    {topicLabel}
                  </button>
                  <button onClick={() => { onToggleAll(filtered, true); onSelectAllSubtopics(cappedSubtopicIds); setShowSelectDropdown(false) }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors">
                    {subtopicLabel}
                  </button>
                  <button onClick={() => { onToggleAll(cappedTopics, false); onSelectAllSubtopics(cappedSubtopicIds); setShowSelectDropdown(false) }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors">
                    {bothLabel}
                  </button>
                </>)
              })()}
              {anySelected && (
                <>
                  <div className="border-t my-1" />
                  <button onClick={() => { onToggleAll(filtered, true); onDeselectSubtopics(allSubtopicIds); setShowSelectDropdown(false) }}
                    className="w-full text-left px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors">
                    Clear all
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{filtered.length} topic{filtered.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="space-y-2">
        {filtered.map(topic => (
          <TopicOverviewItem
            key={topic.id}
            topic={topic}
            activeFilter={activeFilter}
            selected={selectedIds.has(topic.id)}
            onToggle={() => onToggle(topic.id)}
            selectedSubtopicIds={selectedSubtopicIds}
            onToggleSubtopic={onToggleSubtopic}
            onSelectSubtopics={ids => { onSelectSubtopics(topic.id, ids) }}
            onDeselectSubtopics={onDeselectSubtopics}
            onEditTopic={onEditTopic}
            onEditSubtopic={onEditSubtopic}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  )
}

function TopicOverviewItem({ topic, activeFilter, selected, onToggle, selectedSubtopicIds, onToggleSubtopic, onSelectSubtopics, onDeselectSubtopics, onEditTopic, onEditSubtopic, disabled }) {
  const [expanded, setExpanded] = useState(false)
  const subtopics = topic.subtopics || []
  const limited = subtopics.slice(0, SUBTOPIC_SELECT_LIMIT)
  const allLimitedSelected = limited.length > 0 && limited.every(st => selectedSubtopicIds?.has(st.id))

  const highlightSubtopic = (st) => {
    if (activeFilter === 'one_issue')  return st.match_count === 1
    if (activeFilter === 'few_issues') return st.match_count > 0 && st.match_count < 3
    if (activeFilter === 'no_issues')  return st.match_count === 0
    return false
  }

  function handleSelectSubtopics(e) {
    e.stopPropagation()
    onSelectSubtopics(limited.map(st => st.id))
    setExpanded(true)
  }

  const selectLabel = subtopics.length <= SUBTOPIC_SELECT_LIMIT
    ? `Select all ${subtopics.length}`
    : `Select first ${SUBTOPIC_SELECT_LIMIT} of ${subtopics.length}`

  return (
    <div className="rounded-lg border overflow-hidden">
      <div
        className={`group w-full flex items-start gap-3 px-4 py-3 text-left cursor-pointer transition-colors ${expanded ? 'bg-muted/40 border-b border-border' : 'bg-card hover:bg-muted/20'} ${selected ? 'ring-1 ring-primary/30' : ''}`}
        onClick={() => setExpanded(v => !v)}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={e => { e.stopPropagation(); onToggle() }}
          onClick={e => e.stopPropagation()}
          disabled={disabled}
          className="h-4 w-4 rounded border-input accent-primary shrink-0 mt-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
        />
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{topic.name}</span>
            {topic.product_area_name && (
              <span className="text-xs text-muted-foreground border border-border rounded-full px-2 py-0.5">{topic.product_area_name}</span>
            )}
            <button
              onClick={e => { e.stopPropagation(); onEditTopic(topic) }}
              disabled={disabled}
              className="ml-1 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity disabled:pointer-events-none"
              title="Edit topic"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
          {topic.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{topic.description}</p>}
        </div>
        {subtopics.length > 0 && !disabled && (
          <button
            onClick={handleSelectSubtopics}
            className="opacity-0 group-hover:opacity-100 text-xs text-purple-600 hover:text-purple-700 transition-opacity shrink-0 mt-0.5"
            title={selectLabel}
          >
            select subtopics
          </button>
        )}
        <span className="text-xs text-muted-foreground shrink-0 mt-0.5">{subtopics.length} subtopics</span>
      </div>

      {expanded && (
        <div className="bg-card divide-y divide-border/40">
          {subtopics.length === 0 ? (
            <p className="text-xs text-muted-foreground px-8 py-3">No subtopics yet.</p>
          ) : (
            <>
              <div className="px-4 py-2 bg-muted/30">
                <button
                  onClick={() => allLimitedSelected
                    ? onDeselectSubtopics(limited.map(st => st.id))
                    : onSelectSubtopics(limited.map(st => st.id))
                  }
                  className="text-xs text-purple-600 hover:text-purple-700 font-medium"
                >
                  {allLimitedSelected ? 'Deselect all' : selectLabel}
                </button>
              </div>
              {subtopics.map(st => {
                const highlight = highlightSubtopic(st)
                return (
                  <div key={st.id} className={`group/st px-4 py-3 space-y-1 ${highlight ? 'bg-amber-50/60' : 'hover:bg-muted/20'} ${selectedSubtopicIds?.has(st.id) ? 'ring-1 ring-inset ring-primary/30' : ''} transition-colors`}>
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={selectedSubtopicIds?.has(st.id) ?? false}
                        onChange={() => onToggleSubtopic?.(st.id)}
                        onClick={e => e.stopPropagation()}
                        disabled={disabled}
                        className="h-4 w-4 rounded border-input accent-primary shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                      {highlight && <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                      <span className="text-sm font-medium">{st.name}</span>
                      <button
                        onClick={() => onEditSubtopic(st, topic)}
                        disabled={disabled}
                        className="text-muted-foreground hover:text-foreground opacity-0 group-hover/st:opacity-100 transition-opacity disabled:pointer-events-none"
                        title="Edit subtopic"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <span className={`text-xs ml-auto tabular-nums ${highlight ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`}>{st.match_count} issues</span>
                    </div>
                    {st.canonical_description && (
                      <p className="text-xs text-muted-foreground italic">{st.canonical_description}</p>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Topic list (left panel) ───────────────────────────────────────────────────

function TopicListItem({ topic, selectedId, selectedSubtopicId, onSelectTopic, onSelectSubtopic }) {
  const [expanded, setExpanded] = useState(false)
  const isTopicSelected = selectedId === topic.id

  return (
    <div>
      <div
        className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors text-sm rounded ${isTopicSelected ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/50'}`}
        onClick={() => { onSelectTopic(topic); setExpanded(true) }}
      >
        <button onClick={e => { e.stopPropagation(); setExpanded(v => !v) }} className="shrink-0 text-muted-foreground">
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <span className="flex-1 truncate">{topic.name}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{topic.subtopic_count}</span>
      </div>
      {expanded && topic.subtopics?.map(st => (
        <div
          key={st.id}
          className={`flex items-center gap-2 pl-8 pr-3 py-1.5 cursor-pointer text-xs transition-colors rounded ${selectedSubtopicId === st.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/30 text-muted-foreground'}`}
          onClick={() => onSelectSubtopic(st, topic)}
        >
          <span className="flex-1 truncate">{st.name}</span>
          <span className="tabular-nums">{st.match_count}</span>
        </div>
      ))}
    </div>
  )
}

// ── Right panel — topic detail ─────────────────────────────────────────────────

function TopicDetail({ topic, allTopics, onUpdated, showToast }) {
  const [name, setName] = useState(topic.name || '')
  const [description, setDescription] = useState(topic.description || '')
  const [productAreaId, setProductAreaId] = useState(topic.product_area_id || '')
  const [productAreas, setProductAreas] = useState([])
  const [saving, setSaving] = useState(false)
  const [mergeModal, setMergeModal] = useState(false)
  const [mergeTargetId, setMergeTargetId] = useState('')
  const [deleteModal, setDeleteModal] = useState(false)

  useEffect(() => {
    setName(topic.name || ''); setDescription(topic.description || ''); setProductAreaId(topic.product_area_id || '')
  }, [topic.id])

  useEffect(() => {
    api.taxonomy.tree().then(t => setProductAreas((t || []).filter(pa => pa.id))).catch(() => {})
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      const r = await api.taxonomy.updateTopic(topic.id, {
        name: name !== topic.name ? name : undefined,
        description: description !== topic.description ? description : undefined,
        product_area_id: productAreaId !== (topic.product_area_id || '') ? (productAreaId || null) : undefined,
      })
      showToast('Topic updated ✓')
      warnIfSyncIssues(r, showToast)
      onUpdated()
    } catch (e) { showToast(e.message, 'error') } finally { setSaving(false) }
  }

  async function handleMerge() {
    if (!mergeTargetId) return
    try {
      const r = await api.taxonomy.mergeTopic(topic.id, parseInt(mergeTargetId))
      showToast(`Merged — ${r.subtopics_moved} subtopics moved ✓`)
      warnIfSyncIssues(r, showToast)
      onUpdated()
    } catch (e) { showToast(e.message, 'error') }
    setMergeModal(false)
  }

  async function handleDelete() {
    try {
      await api.taxonomy.deleteTopic(topic.id)
      showToast('Topic deleted ✓')
      onUpdated()
    } catch (e) { showToast(e.message, 'error') }
    setDeleteModal(false)
  }

  const otherTopics = allTopics.filter(t => t.id !== topic.id)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Topic</div>
          <h2 className="text-lg font-semibold">{topic.name}</h2>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setMergeModal(true)}>Merge into…</Button>
          <Button size="sm" variant="destructive" disabled={topic.subtopic_count > 0} onClick={() => setDeleteModal(true)}
            title={topic.subtopic_count > 0 ? 'Remove all subtopics first' : ''}>Delete</Button>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Name</label>
          <input className="mt-1 flex h-8 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Description</label>
          <textarea className="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-1 text-sm min-h-16"
            value={description} onChange={e => setDescription(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Product area</label>
          <Select value={productAreaId} onChange={e => setProductAreaId(e.target.value)} className="mt-1 h-8 text-sm">
            <option value="">Unassigned</option>
            {productAreas.map(pa => <option key={pa.id} value={pa.id}>{pa.name}</option>)}
          </Select>
        </div>
        <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
      </div>

      {topic.subtopics?.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Subtopics ({topic.subtopics.length})</div>
          <div className="divide-y border rounded-md">
            {topic.subtopics.map(st => (
              <div key={st.id} className="flex items-center px-3 py-2 text-sm">
                <span className="flex-1">{st.name}</span>
                <span className="text-xs text-muted-foreground">{st.match_count} issues</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {mergeModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-background border rounded-lg shadow-xl p-6 w-[420px] space-y-4">
            <h3 className="text-base font-semibold">Merge "{topic.name}" into…</h3>
            <p className="text-xs text-muted-foreground">All {topic.subtopic_count} subtopics will move to the target topic. This topic will be deleted.</p>
            <Select value={mergeTargetId} onChange={e => setMergeTargetId(e.target.value)} className="w-full">
              <option value="">Select target topic…</option>
              {otherTopics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setMergeModal(false)}>Cancel</Button>
              <Button size="sm" disabled={!mergeTargetId} onClick={handleMerge}>Merge</Button>
            </div>
          </div>
        </div>
      )}
      {deleteModal && <ConfirmModal title="Delete topic" message={`Delete "${topic.name}"? This cannot be undone.`} confirmLabel="Delete" danger onConfirm={handleDelete} onCancel={() => setDeleteModal(false)} />}
    </div>
  )
}

// ── Right panel — subtopic detail ─────────────────────────────────────────────

function SubtopicDetail({ subtopic, parentTopic, allTopics, onUpdated, showToast }) {
  const [name, setName] = useState(subtopic.name || '')
  const [desc, setDesc] = useState(subtopic.canonical_description || '')
  const [saving, setSaving] = useState(false)
  const [moveModal, setMoveModal] = useState(false)
  const [moveTargetId, setMoveTargetId] = useState('')
  const [mergeModal, setMergeModal] = useState(false)
  const [mergeSearch, setMergeSearch] = useState('')
  const [mergeResults, setMergeResults] = useState([])
  const [mergeTargetId, setMergeTargetId] = useState(null)
  const [mergeTargetLabel, setMergeTargetLabel] = useState('')
  const [deleteModal, setDeleteModal] = useState(false)
  const [issues, setIssues] = useState(null)
  const [issueTotal, setIssueTotal] = useState(0)
  const [issuePage, setIssuePage] = useState(1)
  const [selectedIssues, setSelectedIssues] = useState(new Set())
  const [bulkTargetId, setBulkTargetId] = useState('')
  const [bulkResults, setBulkResults] = useState([])

  useEffect(() => {
    setName(subtopic.name || ''); setDesc(subtopic.canonical_description || '')
    setIssues(null); setIssuePage(1); setSelectedIssues(new Set())
  }, [subtopic.id])

  useEffect(() => {
    api.taxonomy.subtopicIssues(subtopic.id, { page: issuePage, limit: 20 })
      .then(d => { setIssues(d.items); setIssueTotal(d.total) }).catch(() => {})
  }, [subtopic.id, issuePage])

  async function handleSave() {
    setSaving(true)
    try {
      const r = await api.taxonomy.updateSubtopic(subtopic.id, { name, canonical_description: desc })
      showToast('Subtopic updated ✓')
      warnIfSyncIssues(r, showToast)
      onUpdated()
    } catch (e) { showToast(e.message, 'error') } finally { setSaving(false) }
  }

  async function handleMove() {
    if (!moveTargetId) return
    try {
      const r = await api.taxonomy.moveSubtopic(subtopic.id, parseInt(moveTargetId))
      showToast('Subtopic moved ✓')
      warnIfSyncIssues(r, showToast)
      onUpdated()
    } catch (e) { showToast(e.message, 'error') }
    setMoveModal(false)
  }

  async function handleMergeSearch(q) {
    setMergeSearch(q); setMergeTargetId(null)
    if (q.length < 1) { setMergeResults([]); return }
    const r = await api.subtopicSearch(q).catch(() => [])
    setMergeResults(r.filter(s => s.id !== subtopic.id))
  }

  async function handleMergeConfirm() {
    if (!mergeTargetId) return
    try {
      const r = await api.taxonomy.mergeSubtopic(subtopic.id, mergeTargetId)
      showToast(`Merged — ${r.issues_reassigned} issues moved ✓`)
      warnIfSyncIssues(r, showToast)
      onUpdated()
    } catch (e) { showToast(e.message, 'error') }
    setMergeModal(false)
  }

  async function handleDelete() {
    try {
      const r = await api.taxonomy.deleteSubtopic(subtopic.id)
      showToast('Subtopic deleted ✓')
      warnIfSyncIssues(r, showToast)
      onUpdated()
    } catch (e) { showToast(e.message, 'error') }
    setDeleteModal(false)
  }

  async function handleReassign(issueId) {
    if (!bulkTargetId) return
    try {
      const r = await api.issues.reassign(issueId, parseInt(bulkTargetId))
      showToast('Issue reassigned ✓')
      warnIfSyncIssues(r, showToast)
      setIssues(prev => prev.filter(i => i.id !== issueId))
      setIssueTotal(t => t - 1)
    } catch (e) { showToast(e.message, 'error') }
  }

  async function handleBulkReassign() {
    if (!bulkTargetId || selectedIssues.size === 0) return
    try {
      const r = await api.issues.bulkReassign([...selectedIssues], parseInt(bulkTargetId))
      showToast(`${r.reassigned} issues reassigned ✓`)
      warnIfSyncIssues(r, showToast)
      setIssues(prev => prev.filter(i => !selectedIssues.has(i.id)))
      setIssueTotal(t => t - r.reassigned)
      setSelectedIssues(new Set())
    } catch (e) { showToast(e.message, 'error') }
  }

  const totalPages = Math.ceil(issueTotal / 20)
  const allSelected = issues?.length > 0 && issues.every(i => selectedIssues.has(i.id))

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Subtopic · {parentTopic?.name}</div>
          <h2 className="text-lg font-semibold">{subtopic.name}</h2>
          <div className="text-xs text-muted-foreground mt-0.5">{subtopic.match_count} issues matched</div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <Button size="sm" variant="outline" onClick={() => setMoveModal(true)}>Move to topic…</Button>
          <Button size="sm" variant="outline" onClick={() => setMergeModal(true)}>Merge into…</Button>
          <Button size="sm" variant="destructive" disabled={subtopic.match_count > 0} onClick={() => setDeleteModal(true)}
            title={subtopic.match_count > 0 ? 'Reassign all issues first' : ''}>Delete</Button>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Name</label>
          <input className="mt-1 flex h-8 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Canonical description</label>
          <textarea className="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-1 text-sm min-h-20"
            value={desc} onChange={e => setDesc(e.target.value)} />
        </div>
        <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
      </div>

      {/* Issues table */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Issues ({issueTotal})</div>
          {selectedIssues.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{selectedIssues.size} selected</span>
              <Select value={bulkTargetId} onChange={e => { setBulkTargetId(e.target.value); api.subtopicSearch('').then(setBulkResults).catch(() => {}) }} className="h-7 text-xs w-52"
                onFocus={() => api.subtopicSearch('').then(r => setBulkResults(r.filter(s => s.id !== subtopic.id))).catch(() => {})}>
                <option value="">Move to subtopic…</option>
                {bulkResults.map(s => <option key={s.id} value={s.id}>{s.topic_name} › {s.name}</option>)}
              </Select>
              <Button size="sm" variant="outline" disabled={!bulkTargetId} onClick={handleBulkReassign}>Move</Button>
            </div>
          )}
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <input type="checkbox" checked={allSelected}
                      onChange={() => {
                        if (allSelected) setSelectedIssues(new Set())
                        else setSelectedIssues(new Set(issues.map(i => i.id)))
                      }} className="h-4 w-4 rounded border-input accent-primary" />
                  </TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Nature</TableHead>
                  <TableHead>Sentiment</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {!issues ? (
                  Array.from({ length: 5 }).map((_, i) => <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-4 w-full" /></TableCell></TableRow>)
                ) : issues.map(issue => (
                  <TableRow key={issue.id}>
                    <TableCell>
                      <input type="checkbox" checked={selectedIssues.has(issue.id)}
                        onChange={() => setSelectedIssues(prev => { const n = new Set(prev); n.has(issue.id) ? n.delete(issue.id) : n.add(issue.id); return n })}
                        className="h-4 w-4 rounded border-input accent-primary" />
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <span className="text-xs text-muted-foreground mr-2">#{issue.id}</span>
                      <span className="text-sm">{truncate(issue.segment_description, 80)}</span>
                    </TableCell>
                    <TableCell><NatureBadge value={issue.nature} /></TableCell>
                    <TableCell><SentimentBadge value={issue.sentiment} /></TableCell>
                    <TableCell>
                      <button onClick={() => {
                        const t = prompt('Target subtopic ID to reassign this issue:')
                        if (t && !isNaN(parseInt(t))) handleReassign(issue.id).then(() => setBulkTargetId(t))
                      }} className="text-xs text-muted-foreground hover:text-foreground" title="Reassign">↗</button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        {totalPages > 1 && (
          <div className="flex justify-between text-sm mt-2">
            <span className="text-muted-foreground">Page {issuePage} of {totalPages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={issuePage === 1} onClick={() => setIssuePage(p => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={issuePage >= totalPages} onClick={() => setIssuePage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

      {/* Move modal */}
      {moveModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-background border rounded-lg shadow-xl p-6 w-[420px] space-y-4">
            <h3 className="text-base font-semibold">Move "{subtopic.name}" to…</h3>
            <Select value={moveTargetId} onChange={e => setMoveTargetId(e.target.value)} className="w-full">
              <option value="">Select topic…</option>
              {allTopics.filter(t => t.id !== parentTopic?.id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setMoveModal(false)}>Cancel</Button>
              <Button size="sm" disabled={!moveTargetId} onClick={handleMove}>Move</Button>
            </div>
          </div>
        </div>
      )}

      {/* Merge modal */}
      {mergeModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-background border rounded-lg shadow-xl p-6 w-[480px] space-y-4">
            <h3 className="text-base font-semibold">Merge "{subtopic.name}" into…</h3>
            <p className="text-xs text-muted-foreground">All {subtopic.match_count} issues will be reassigned to the target. This subtopic will be deleted.</p>
            <input type="text" placeholder="Search subtopics…" value={mergeSearch} onChange={e => handleMergeSearch(e.target.value)}
              className="flex h-8 w-full rounded-md border border-input bg-background px-3 text-sm" autoFocus />
            <div className="max-h-48 overflow-auto border rounded-md divide-y">
              {mergeResults.length === 0 && mergeSearch.length < 1 ? (
                <p className="text-xs text-muted-foreground px-3 py-2">Type to search…</p>
              ) : mergeResults.length === 0 ? (
                <p className="text-xs text-muted-foreground px-3 py-2">No results.</p>
              ) : mergeResults.map(s => (
                <button key={s.id} onClick={() => { setMergeTargetId(s.id); setMergeTargetLabel(s.name) }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${mergeTargetId === s.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/50'}`}>
                  <div>{s.name}</div>
                  <div className="text-xs text-muted-foreground">{s.topic_name} · {s.match_count} issues</div>
                </button>
              ))}
            </div>
            {mergeTargetId && <p className="text-xs text-muted-foreground">Selected: <span className="font-medium text-foreground">{mergeTargetLabel}</span></p>}
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setMergeModal(false)}>Cancel</Button>
              <Button size="sm" disabled={!mergeTargetId} onClick={handleMergeConfirm}>Merge</Button>
            </div>
          </div>
        </div>
      )}

      {deleteModal && <ConfirmModal title="Delete subtopic" message={`Delete "${subtopic.name}"? This cannot be undone.`} confirmLabel="Delete" danger onConfirm={handleDelete} onCancel={() => setDeleteModal(false)} />}
    </div>
  )
}

// ── AI Review Results ─────────────────────────────────────────────────────────

// Matches config.AI_REVIEW_SUBTOPIC_LIMIT — prevents oversized review sessions
const SUBTOPIC_SELECT_LIMIT = 50
// Match config.AI_REVIEW_TOPIC_REQUEST_LIMIT and AI_REVIEW_SUBTOPIC_REQUEST_LIMIT
const TOPIC_REVIEW_LIMIT = 200
const SUBTOPIC_REVIEW_LIMIT = 200

const SUGGESTION_STYLES = {
  merge_subtopics: { border: 'border-purple-200 bg-purple-50/40', badge: 'bg-purple-100 text-purple-700', icon: 'text-purple-600', label: 'Merge subtopics' },
  merge_topics:    { border: 'border-blue-200 bg-blue-50/40',     badge: 'bg-blue-100 text-blue-700',     icon: 'text-blue-600',   label: 'Merge topics' },
  move_subtopic:   { border: 'border-teal-200 bg-teal-50/40',     badge: 'bg-teal-100 text-teal-700',     icon: 'text-teal-600',   label: 'Move subtopic' },
  rename_topic:    { border: 'border-amber-200 bg-amber-50/40',   badge: 'bg-amber-100 text-amber-700',   icon: 'text-amber-600',  label: 'Rename topic' },
  rename_subtopic: { border: 'border-orange-200 bg-orange-50/40', badge: 'bg-orange-100 text-orange-700', icon: 'text-orange-600', label: 'Rename subtopic' },
}

function detectConflicts(suggestions, selectedSet) {
  const conflicts = []
  const mergeStSources = new Map()   // subtopic_id → merge idx (non-survivors)
  const mergeStSurvivors = new Map() // surviving_subtopic_id → merge idx
  const mergeTSources = new Map()    // topic_id → merge idx (non-survivors)
  const moves = new Map()            // subtopic_id → move idx
  const renameSt = new Map()         // subtopic_id → rename idx
  const renameT = new Map()          // topic_id → rename idx
  const seen = new Set()

  for (const i of selectedSet) {
    const s = suggestions[i]
    if (!s) continue
    if (s.type === 'merge_subtopics') {
      mergeStSurvivors.set(s.surviving_subtopic_id, i)
      ;(s.subtopic_ids || []).forEach(id => { if (id !== s.surviving_subtopic_id) mergeStSources.set(id, i) })
    } else if (s.type === 'merge_topics') {
      ;(s.topic_ids || []).forEach(id => { if (id !== s.surviving_topic_id) mergeTSources.set(id, i) })
    } else if (s.type === 'move_subtopic') {
      moves.set(s.subtopic_id, i)
    } else if (s.type === 'rename_subtopic') {
      renameSt.set(s.subtopic_id, i)
    } else if (s.type === 'rename_topic') {
      renameT.set(s.topic_id, i)
    }
  }

  // Merge + move on same subtopic
  for (const [id, moveIdx] of moves) {
    if (!mergeStSources.has(id)) continue
    const key = `mm_${id}`
    if (seen.has(key)) continue
    seen.add(key)
    const mv = suggestions[moveIdx], mg = suggestions[mergeStSources.get(id)]
    const mergeTargetName = mg.proposed_name || (mg.subtopic_names || []).find(n => n !== mv.subtopic_name) || 'survivor'
    const mergeTargetLabel = mg.surviving_subtopic_topic_name
      ? `${mg.surviving_subtopic_topic_name} > ${mergeTargetName}`
      : mergeTargetName
    conflicts.push({
      id: key, type: 'merge_move',
      label: `"${mv.subtopic_name}" — merge vs. move`,
      description: 'This subtopic appears in both a merge and a move suggestion.',
      options: [
        { label: `Merge into "${mergeTargetLabel}"`, idx: mergeStSources.get(id) },
        { label: `Move to topic "${mv.to_topic_name}"`, idx: moveIdx },
      ],
      resolution: null,
    })
  }

  // Merge survivor is another merge's source
  for (const [id, survivorIdx] of mergeStSurvivors) {
    if (!mergeStSources.has(id)) continue
    const key = `ss_${id}`
    if (seen.has(key)) continue
    seen.add(key)
    const sv = suggestions[survivorIdx], sr = suggestions[mergeStSources.get(id)]
    const name = sv.proposed_name || (sv.subtopic_names || []).find(Boolean) || `Subtopic #${id}`
    const nameWithTopic = sv.surviving_subtopic_topic_name ? `${sv.surviving_subtopic_topic_name} > ${name}` : name
    conflicts.push({
      id: key, type: 'survivor_source',
      label: `"${name}" — survives one merge, deleted in another`,
      description: 'This subtopic is the survivor of one merge but is deleted as a source in another.',
      options: [
        { label: `Keep: "${nameWithTopic}" survives (suggestion #${survivorIdx + 1})`, idx: survivorIdx },
        { label: `Keep: "${name}" is removed (suggestion #${mergeStSources.get(id) + 1})`, idx: mergeStSources.get(id) },
      ],
      resolution: null,
    })
  }

  // Move destination topic being merged away
  for (const [, moveIdx] of moves) {
    const destId = suggestions[moveIdx].to_topic_id
    if (!mergeTSources.has(destId)) continue
    const key = `mvdest_${destId}`
    if (seen.has(key)) continue
    seen.add(key)
    const mv = suggestions[moveIdx]
    conflicts.push({
      id: key, type: 'move_dest_merged',
      label: `Topic "${mv.to_topic_name}" — move destination is being merged away`,
      description: 'A subtopic is being moved here, but this topic is also being merged away.',
      options: [
        { label: `Keep: move "${mv.subtopic_name}" to "${mv.to_topic_name}"`, idx: moveIdx },
        { label: `Keep: merge topic "${mv.to_topic_name}"`, idx: mergeTSources.get(destId) },
      ],
      resolution: null,
    })
  }

  // Rename on entity being deleted (informational — auto-skip)
  for (const [id, renameIdx] of renameSt) {
    if (!mergeStSources.has(id)) continue
    const key = `rdst_${id}`
    if (seen.has(key)) continue
    seen.add(key)
    conflicts.push({
      id: key, type: 'rename_deleted', affectedIdx: renameIdx,
      label: `"${suggestions[renameIdx].current_name}" — rename will be skipped`,
      description: 'This subtopic is being renamed but will be removed by a merge. The rename is skipped automatically.',
      options: [], resolution: 'auto_skip',
    })
  }
  for (const [id, renameIdx] of renameT) {
    if (!mergeTSources.has(id)) continue
    const key = `rdt_${id}`
    if (seen.has(key)) continue
    seen.add(key)
    conflicts.push({
      id: key, type: 'rename_deleted', affectedIdx: renameIdx,
      label: `"${suggestions[renameIdx].current_name}" — rename will be skipped`,
      description: 'This topic is being renamed but will be removed by a merge. The rename is skipped automatically.',
      options: [], resolution: 'auto_skip',
    })
  }

  return conflicts
}

function buildExecutionGroups(suggestions, selectedSet, conflicts) {
  const excluded = new Set()
  for (const c of conflicts) {
    if (c.type === 'rename_deleted') { excluded.add(c.affectedIdx); continue }
    if (c.resolution === 'skip_all') c.options.forEach(o => excluded.add(o.idx))
    else if (c.resolution !== null) c.options.forEach(o => { if (o.idx !== c.resolution) excluded.add(o.idx) })
  }
  const renames = [], moves = [], merges = []
  for (const i of selectedSet) {
    if (excluded.has(i)) continue
    const s = suggestions[i]
    if (!s) continue
    if (s.type === 'rename_topic' || s.type === 'rename_subtopic') renames.push(i)
    else if (s.type === 'move_subtopic') moves.push(i)
    else merges.push(i)
  }
  return { renames, moves, merges, excluded }
}

function AIReviewResults({ result, sessionId, showToast, onApplied, onDismiss, onSessionUpdate }) {
  const [applying, setApplying] = useState({})
  const [runCentroid, setRunCentroid] = useState(true)
  const [statusOverrides, setStatusOverrides] = useState({})
  const [selectedSuggestions, setSelectedSuggestions] = useState(new Set())
  const selectAllRef = useRef(null)

  // Bulk flow state machine: null | 'conflict' | 'plan' | 'executing' | 'done'
  const [bulkFlow, setBulkFlow] = useState(null)
  const [bulkConflicts, setBulkConflicts] = useState([])
  const [bulkGroups, setBulkGroups] = useState(null)
  const [execProgress, setExecProgress] = useState([])
  const [execResult, setExecResult] = useState(null)

  const pendingIndices = (result.suggestions || [])
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => (statusOverrides[i] ?? s._status ?? 'pending') === 'pending')
    .map(({ i }) => i)

  const allSelected = pendingIndices.length > 0 && pendingIndices.every(i => selectedSuggestions.has(i))
  const someSelected = selectedSuggestions.size > 0

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected && !allSelected
  }, [someSelected, allSelected])

  function toggleSelectAll() {
    setSelectedSuggestions(allSelected ? new Set() : new Set(pendingIndices))
  }

  function toggleSuggestion(i) {
    setSelectedSuggestions(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  function cancelBulkFlow() {
    setBulkFlow(null); setBulkConflicts([]); setBulkGroups(null)
    setExecProgress([]); setExecResult(null)
  }

  function getPendingSelected() {
    return new Set([...selectedSuggestions].filter(i =>
      (statusOverrides[i] ?? result.suggestions[i]?._status ?? 'pending') === 'pending'
    ))
  }

  function handleBulkSkip() {
    const pendingSelected = [...getPendingSelected()]
    if (!pendingSelected.length) return
    // Mark as skipped immediately and clear selection — API calls run in background
    const overrides = {}
    pendingSelected.forEach(i => { overrides[i] = 'skipped' })
    setStatusOverrides(prev => ({ ...prev, ...overrides }))
    setSelectedSuggestions(new Set())
    // Fire API calls in background without blocking the UI
    if (sessionId) {
      Promise.all(pendingSelected.map(i => {
        const s = result.suggestions[i]
        return api.taxonomy.aiReviewSkip(sessionId, s._idx ?? i).catch(() => {})
      })).then(() => { if (onSessionUpdate) onSessionUpdate() })
    }
  }

  function handleBulkApply() {
    const pendingSelected = getPendingSelected()
    if (!pendingSelected.size) return
    const conflicts = detectConflicts(result.suggestions, pendingSelected)
    const resolved = conflicts.map(c => c.type === 'rename_deleted' ? { ...c, resolution: 'auto_skip' } : c)
    setBulkConflicts(resolved)
    const hardConflicts = resolved.filter(c => c.type !== 'rename_deleted')
    if (hardConflicts.length > 0) {
      setBulkFlow('conflict')
    } else {
      setBulkGroups(buildExecutionGroups(result.suggestions, pendingSelected, resolved))
      setBulkFlow('plan')
    }
  }

  function resolveConflict(id, resolution) {
    setBulkConflicts(prev => prev.map(c => c.id === id ? { ...c, resolution } : c))
  }

  function proceedToPlan() {
    const groups = buildExecutionGroups(result.suggestions, getPendingSelected(), bulkConflicts)
    setBulkGroups(groups)
    setBulkFlow('plan')
  }

  async function executeBulk() {
    if (!bulkGroups) return
    const hasMerges = bulkGroups.merges.length > 0

    setExecProgress([
      { label: 'Renames',   count: bulkGroups.renames.length, done: 0, status: bulkGroups.renames.length ? 'pending' : 'skipped' },
      { label: 'Moves',     count: bulkGroups.moves.length,   done: 0, status: bulkGroups.moves.length   ? 'pending' : 'skipped' },
      { label: 'Merges',    count: bulkGroups.merges.length,  done: 0, status: bulkGroups.merges.length  ? 'pending' : 'skipped' },
      { label: 'Centroids', count: 0, done: 0, status: (hasMerges && runCentroid) ? 'pending' : 'skipped' },
    ])
    setBulkFlow('executing')

    let totalApplied = 0, totalFailed = 0
    const failedIndices = []
    const appliedMergeSessionIndices = [] // suggestion_idx values of merges applied in THIS run

    const applyIdx = async (i, gIdx) => {
      const s = result.suggestions[i]
      try {
        // Always pass run_centroid=false — centroids run once at the end for all merges
        await api.taxonomy.aiReviewApply(sessionId, s._idx ?? i, false)
        setStatusOverrides(prev => ({ ...prev, [i]: 'applied' }))
        setExecProgress(prev => prev.map((g, idx) => idx === gIdx ? { ...g, done: g.done + 1 } : g))
        return { i, success: true }
      } catch (e) { return { i, success: false, error: e.message } }
    }

    for (const [gIdx, ids] of [[0, bulkGroups.renames], [1, bulkGroups.moves], [2, bulkGroups.merges]]) {
      if (!ids.length) continue
      setExecProgress(prev => prev.map((g, idx) => idx === gIdx ? { ...g, status: 'running' } : g))
      const results = await Promise.all(ids.map(i => applyIdx(i, gIdx)))
      results.forEach(r => {
        if (r.success) {
          totalApplied++
          // Track merge session indices for targeted centroid run
          if (gIdx === 2) {
            const s = result.suggestions[r.i]
            appliedMergeSessionIndices.push(s._idx ?? r.i)
          }
        } else {
          totalFailed++; failedIndices.push({ i: r.i, error: r.error })
        }
      })
      setExecProgress(prev => prev.map((g, idx) => idx === gIdx ? { ...g, status: 'done' } : g))
    }

    // Run centroid updates once for all merge survivors in parallel
    // Only run if at least one merge actually succeeded — empty indices would fall back to all session merges
    let centroidsUpdated = 0
    if (hasMerges && runCentroid && sessionId && appliedMergeSessionIndices.length > 0) {
      setExecProgress(prev => prev.map((g, idx) => idx === 3 ? { ...g, status: 'running' } : g))
      try {
        const r = await api.taxonomy.aiReviewRunCentroids(sessionId, appliedMergeSessionIndices)
        centroidsUpdated = r.updated
        // Show total attempted as done/count — subtopics skipped due to insufficient
        // issues still "ran"; the updated count is surfaced in the result summary
        setExecProgress(prev => prev.map((g, idx) => idx === 3 ? { ...g, count: r.total, done: r.total, status: 'done' } : g))
      } catch {
        setExecProgress(prev => prev.map((g, idx) => idx === 3 ? { ...g, status: 'done' } : g))
      }
    } else if (hasMerges && appliedMergeSessionIndices.length === 0) {
      // All merges failed — mark centroids as skipped so UI doesn't show a stuck pending row
      setExecProgress(prev => prev.map((g, idx) => idx === 3 ? { ...g, status: 'skipped' } : g))
    }

    // Skip conflict losers in DB so they don't show as pending in the banner
    if (sessionId && bulkGroups.excluded.size > 0) {
      await Promise.all([...bulkGroups.excluded].map(async i => {
        const s = result.suggestions[i]
        if (!s || (statusOverrides[i] ?? s._status ?? 'pending') !== 'pending') return
        try {
          await api.taxonomy.aiReviewSkip(sessionId, s._idx ?? i)
          setStatusOverrides(prev => ({ ...prev, [i]: 'skipped' }))
        } catch { /* skip failure is non-blocking */ }
      }))
    }

    setExecResult({ applied: totalApplied, failed: totalFailed, skipped: bulkGroups.excluded.size, centroidsUpdated, failedIndices })
    setBulkFlow('done')
    setSelectedSuggestions(new Set())
    onApplied()
    if (onSessionUpdate) onSessionUpdate()
  }

  async function applyOne(s, idx) {
    const key = idx ?? s.title
    setApplying(prev => ({ ...prev, [key]: true }))
    try {
      if (sessionId) {
        await api.taxonomy.aiReviewApply(sessionId, idx ?? s._idx ?? 0, runCentroid)
      } else {
        // Fallback for in-memory results (no session yet)
        if (s.type === 'merge_subtopics') {
          const others = s.subtopic_ids.filter(id => id !== s.surviving_subtopic_id)
          for (const id of others) await api.taxonomy.mergeSubtopic(id, s.surviving_subtopic_id, runCentroid)
          if (s.proposed_name || s.proposed_description)
            await api.taxonomy.updateSubtopic(s.surviving_subtopic_id, { name: s.proposed_name, canonical_description: s.proposed_description })
        } else if (s.type === 'merge_topics') {
          const others = s.topic_ids.filter(id => id !== s.surviving_topic_id)
          for (const id of others) await api.taxonomy.mergeTopic(id, s.surviving_topic_id, runCentroid)
          if (s.proposed_name || s.proposed_description)
            await api.taxonomy.updateTopic(s.surviving_topic_id, { name: s.proposed_name, description: s.proposed_description })
        } else if (s.type === 'move_subtopic') {
          await api.taxonomy.moveSubtopic(s.subtopic_id, s.to_topic_id)
        } else if (s.type === 'rename_topic') {
          await api.taxonomy.updateTopic(s.topic_id, { name: s.proposed_name, description: s.proposed_description })
        } else if (s.type === 'rename_subtopic') {
          await api.taxonomy.updateSubtopic(s.subtopic_id, { name: s.proposed_name, canonical_description: s.proposed_description })
        }
      }
      setStatusOverrides(prev => ({ ...prev, [key]: 'applied' }))
      showToast(`Applied: ${s.title} ✓`)
      onApplied()
      if (onSessionUpdate) onSessionUpdate()
    } catch (e) { showToast(e.message, 'error') }
    setApplying(prev => ({ ...prev, [key]: false }))
  }

  async function skipOne(s, idx) {
    const key = idx ?? s.title
    try {
      if (sessionId) await api.taxonomy.aiReviewSkip(sessionId, idx ?? s._idx ?? 0)
      setStatusOverrides(prev => ({ ...prev, [key]: 'skipped' }))
      if (onSessionUpdate) onSessionUpdate()
    } catch (e) { showToast(e.message, 'error') }
  }

  function SuggestionDetail({ s }) {
    const t = s.type

    // Helper: format a topic as "PA > Name"
    function topicPath(name, pa) {
      return pa && pa !== 'Unassigned' ? `${pa} > ${name}` : name
    }
    // Helper: format a subtopic as "PA > Topic > Name"
    function subtopicPath(name, topicName, pa) {
      const parts = [pa && pa !== 'Unassigned' ? pa : null, topicName, name].filter(Boolean)
      return parts.join(' > ')
    }

    if (t === 'merge_subtopics') {
      const lines = (s.subtopic_ids || []).map((id, i) => {
        const name = (s.subtopic_names || [])[i] || `#${id}`
        const ctx = s.subtopic_contexts?.[String(id)] || {}
        return subtopicPath(name, ctx.topic_name, ctx.pa_name)
      })
      const survivorName = s.proposed_name || (s.subtopic_names || []).find(n => n) || ''
      const survivorPath = subtopicPath(survivorName, s.surviving_subtopic_topic_name, s.surviving_subtopic_pa)
      return (
        <div className="text-xs space-y-1">
          <div className="text-muted-foreground">Merges: <span className="text-foreground">{lines.join(' + ')}</span></div>
          {s.proposed_name && <div className="text-muted-foreground">→ <span className="font-medium text-foreground">{survivorPath}</span>{s.estimated_issues != null && <span className="ml-2">~{s.estimated_issues} issues</span>}</div>}
          {s.proposed_description && <p className="text-muted-foreground italic">{s.proposed_description}</p>}
        </div>
      )
    }

    if (t === 'merge_topics') {
      const lines = (s.topic_ids || []).map((id, i) => {
        const name = (s.topic_names || [])[i] || `#${id}`
        const pa = s.topic_product_areas?.[String(id)]
        return topicPath(name, pa)
      })
      const survivorName = s.proposed_name || ''
      const survivorPath = topicPath(survivorName, s.surviving_topic_pa)
      return (
        <div className="text-xs space-y-1">
          <div className="text-muted-foreground">Merges: <span className="text-foreground">{lines.join(' + ')}</span></div>
          {s.proposed_name && <div className="text-muted-foreground">→ <span className="font-medium text-foreground">{survivorPath}</span></div>}
          {s.proposed_description && <p className="text-muted-foreground italic">{s.proposed_description}</p>}
        </div>
      )
    }

    if (t === 'move_subtopic') return (
      <div className="text-xs text-muted-foreground">
        Move <span className="text-foreground font-medium">{s.subtopic_name}</span>
        {' '}from <span className="text-foreground">{topicPath(s.from_topic_name, s.from_topic_pa)}</span>
        {' '}→ <span className="text-foreground font-medium">{topicPath(s.to_topic_name, s.to_topic_pa)}</span>
      </div>
    )

    if (t === 'rename_topic') return (
      <div className="text-xs space-y-1">
        <div className="text-muted-foreground">
          <span className="line-through">{topicPath(s.current_name, s.topic_pa)}</span>
          {' '}→ <span className="font-medium text-foreground">{s.proposed_name}</span>
        </div>
        {s.proposed_description && <p className="text-muted-foreground italic">{s.proposed_description}</p>}
      </div>
    )

    if (t === 'rename_subtopic') return (
      <div className="text-xs space-y-1">
        <div className="text-muted-foreground">
          <span className="line-through">{subtopicPath(s.current_name, s.subtopic_topic_name, s.subtopic_pa)}</span>
          {' '}→ <span className="font-medium text-foreground">{s.proposed_name}</span>
        </div>
        {s.proposed_description && <p className="text-muted-foreground italic">{s.proposed_description}</p>}
      </div>
    )

    return null
  }

  const pending = result.suggestions?.filter((s, i) => {
    const key = i
    const status = statusOverrides[key] ?? s._status ?? 'pending'
    return status === 'pending'
  }).length ?? 0

  return (
    <Card>
      <CardContent className="pt-5 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-semibold">AI Taxonomy Review</span>
            {sessionId && <span className="text-xs text-muted-foreground font-mono">#{sessionId}</span>}
            {result._meta && (
              <span className="text-xs text-muted-foreground">
                {result._meta.topics_reviewed}T · {result._meta.subtopics_reviewed}ST
                {result._meta.batches > 1 && ` · ${result._meta.batches} batches`}
                {result._meta.cost_usd != null && ` · $${result._meta.cost_usd.toFixed(4)}`}
              </span>
            )}
            {pending > 0 && (
              <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-medium">
                {pending} pending
              </span>
            )}
          </div>
          <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground text-lg leading-none shrink-0">✕</button>
        </div>

        {result.summary && (
          <p className="text-sm text-muted-foreground border-l-2 border-primary/30 pl-3">{result.summary}</p>
        )}

        {/* Centroid checkbox */}
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={runCentroid} onChange={e => setRunCentroid(e.target.checked)}
            className="h-4 w-4 rounded border-input accent-primary" />
          Run centroid update after applying merges
          <span className="text-xs text-muted-foreground">(regenerates descriptions — recommended)</span>
        </label>

        {/* ── Bulk flow panels ────────────────────────────────── */}
        {bulkFlow === 'conflict' && (() => {
          const hard = bulkConflicts.filter(c => c.type !== 'rename_deleted')
          const allResolved = hard.every(c => c.resolution !== null)
          return (
            <div className="border border-amber-200 rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border-b border-amber-200">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <span className="text-sm font-semibold text-amber-900 flex-1">
                  {hard.length} conflict{hard.length !== 1 ? 's' : ''} need your input before applying
                </span>
                <button onClick={cancelBulkFlow} className="text-xs text-amber-700 hover:text-amber-900">Cancel</button>
              </div>
              <div className="divide-y divide-amber-100">
                {bulkConflicts.map(conflict => (
                  <div key={conflict.id} className="px-4 py-4 space-y-3">
                    <div>
                      <div className="text-sm font-medium">{conflict.label}</div>
                      <p className="text-xs text-muted-foreground mt-0.5">{conflict.description}</p>
                    </div>
                    {conflict.type === 'rename_deleted' ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded px-3 py-2">
                        ℹ Rename will be skipped automatically — no action needed.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {conflict.options.map(opt => (
                          <label key={opt.idx} className="flex items-center gap-3 cursor-pointer">
                            <input type="radio" name={conflict.id} checked={conflict.resolution === opt.idx}
                              onChange={() => resolveConflict(conflict.id, opt.idx)}
                              className="accent-primary shrink-0" />
                            <span className="text-xs">{opt.label}</span>
                          </label>
                        ))}
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input type="radio" name={conflict.id} checked={conflict.resolution === 'skip_all'}
                            onChange={() => resolveConflict(conflict.id, 'skip_all')}
                            className="accent-primary shrink-0" />
                          <span className="text-xs text-muted-foreground">Skip both</span>
                        </label>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 px-4 py-3 bg-muted/20 border-t border-amber-100">
                <button onClick={cancelBulkFlow}
                  className="inline-flex items-center rounded-md border border-input bg-background hover:bg-muted px-3 py-1.5 text-xs font-medium transition-colors">
                  Cancel
                </button>
                <button onClick={proceedToPlan} disabled={!allResolved}
                  className="inline-flex items-center gap-1 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50 transition-colors">
                  Continue to plan →
                </button>
              </div>
            </div>
          )
        })()}

        {bulkFlow === 'plan' && bulkGroups && (() => {
          const total = bulkGroups.renames.length + bulkGroups.moves.length + bulkGroups.merges.length
          const groups = [
            { label: 'Renames', count: bulkGroups.renames.length, note: 'parallel' },
            { label: 'Moves',   count: bulkGroups.moves.length,   note: 'parallel, after renames' },
            { label: 'Merges',  count: bulkGroups.merges.length,  note: 'parallel, after moves' },
          ]
          return (
            <div className="border rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-muted/40 border-b">
                <span className="text-sm font-semibold flex-1">Ready to apply {total} suggestion{total !== 1 ? 's' : ''} in 3 parallel groups</span>
                <button onClick={cancelBulkFlow} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
              </div>
              <div className="px-4 py-4 space-y-3">
                {groups.map(g => (
                  <div key={g.label} className={`flex items-center gap-4 text-sm ${g.count === 0 ? 'opacity-40' : ''}`}>
                    <span className="w-16 font-medium text-xs">{g.label}</span>
                    <span className="tabular-nums text-xs w-4 text-right">{g.count}</span>
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      {g.count > 0 && <div className="h-full bg-primary/50 rounded-full w-full" />}
                    </div>
                    <span className="text-xs text-muted-foreground">{g.count > 0 ? g.note : 'nothing to do'}</span>
                  </div>
                ))}
                {bulkGroups.excluded.size > 0 && (
                  <p className="text-xs text-muted-foreground pt-1 border-t">
                    {bulkGroups.excluded.size} suggestion{bulkGroups.excluded.size !== 1 ? 's' : ''} skipped (conflicts resolved above)
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2 px-4 py-3 bg-muted/20 border-t">
                <button onClick={cancelBulkFlow}
                  className="inline-flex items-center rounded-md border border-input bg-background hover:bg-muted px-3 py-1.5 text-xs font-medium transition-colors">
                  Cancel
                </button>
                <button onClick={executeBulk}
                  className="inline-flex items-center rounded-md bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 text-xs font-medium transition-colors">
                  Apply {total} suggestion{total !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          )
        })()}

        {(bulkFlow === 'executing' || bulkFlow === 'done') && (
          <div className="border rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-muted/40 border-b">
              <span className="text-sm font-semibold">
                {bulkFlow === 'executing' ? 'Applying suggestions…' : 'Complete'}
              </span>
            </div>
            <div className="px-4 py-4 space-y-3">
              {execProgress.map((g, idx) => (
                <div key={g.label} className={`flex items-center gap-4 text-sm ${g.status === 'skipped' ? 'opacity-40' : ''}`}>
                  <span className="w-5 text-center text-base leading-none">
                    {g.status === 'done' ? '✓' : g.status === 'running' ? '⟳' : '·'}
                  </span>
                  <span className="w-16 font-medium text-xs">{g.label}</span>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    {g.status === 'running' && g.count === 0
                      ? <div className="h-full w-full bg-primary/50 rounded-full animate-pulse" />
                      : <div
                          className={`h-full rounded-full transition-all duration-300 ${g.status === 'done' ? 'bg-green-500' : 'bg-primary'}`}
                          style={{ width: g.count > 0 ? `${(g.done / g.count) * 100}%` : '0%' }}
                        />
                    }
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
                    {g.status === 'skipped' || g.status === 'pending' ? '—'
                      : g.status === 'running' && g.count === 0 ? '…'
                      : `${g.done}/${g.count}`}
                  </span>
                </div>
              ))}
            </div>
            {bulkFlow === 'done' && execResult && (
              <div className="border-t">
                <div className="flex items-center justify-between px-4 py-3 bg-muted/20">
                  <p className="text-sm">
                    <span className="text-green-600 font-medium">✓ {execResult.applied} applied</span>
                    {execResult.skipped > 0 && <span className="text-muted-foreground ml-3">· {execResult.skipped} skipped</span>}
                    {execResult.failed > 0 && <span className="text-red-600 ml-3">· {execResult.failed} failed</span>}
                    {execResult.centroidsUpdated > 0 && <span className="text-muted-foreground ml-3">· {execResult.centroidsUpdated} centroid{execResult.centroidsUpdated !== 1 ? 's' : ''} updated</span>}
                  </p>
                  <button onClick={cancelBulkFlow} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
                </div>
                {execResult.failedIndices?.length > 0 && (
                  <div className="px-4 py-3 space-y-2 border-t border-red-100 bg-red-50/40">
                    <p className="text-xs font-medium text-red-600 uppercase tracking-wide">Failed — click to retry individually</p>
                    {execResult.failedIndices.map(({ i, error }) => {
                      const s = result.suggestions[i]
                      if (!s) return null
                      const style = SUGGESTION_STYLES[s.type] || SUGGESTION_STYLES.merge_subtopics
                      return (
                        <div key={i} className="bg-background rounded-md border border-red-200 px-3 py-2 space-y-1">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <span className={`text-xs rounded-full px-2 py-0.5 mr-2 ${style.badge}`}>{style.label}</span>
                              <span className="text-xs font-medium">{s.title}</span>
                            </div>
                            <button
                              onClick={() => applyOne(s, i)}
                              disabled={!!applying[i]}
                              className="shrink-0 inline-flex items-center rounded-md bg-green-600 hover:bg-green-700 text-white px-2.5 py-1 text-xs font-medium disabled:opacity-50 transition-colors"
                            >
                              {applying[i] ? 'Retrying…' : 'Retry'}
                            </button>
                          </div>
                          {error && <p className="text-xs text-red-600 break-words">{error}</p>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Suggestions list — hidden while bulk flow is active ── */}
        {!bulkFlow && result.suggestions?.length > 0 && (
          <div className="space-y-2">
            {/* Suggestions header with select-all + bulk action */}
            <div className="flex items-center gap-3">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                disabled={pendingIndices.length === 0}
                className="h-4 w-4 rounded border-input accent-primary shrink-0"
              />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex-1">
                {result.suggestions.length} suggestion{result.suggestions.length !== 1 ? 's' : ''}
                {someSelected && <span className="ml-2 normal-case text-primary">{selectedSuggestions.size} selected</span>}
              </span>
              {someSelected && (
                <>
                  <button
                    onClick={handleBulkSkip}
                    className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background hover:bg-muted px-3 py-1.5 text-xs font-medium transition-colors shrink-0"
                  >
                    Skip {selectedSuggestions.size} selected
                  </button>
                  <button
                    onClick={handleBulkApply}
                    className="inline-flex items-center gap-1.5 rounded-md bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 text-xs font-medium transition-colors shrink-0"
                  >
                    Apply {selectedSuggestions.size} selected
                  </button>
                </>
              )}
            </div>

            {result.suggestions.map((s, i) => {
              const style = SUGGESTION_STYLES[s.type] || SUGGESTION_STYLES.merge_subtopics
              const status = statusOverrides[i] ?? s._status ?? 'pending'
              const isApplied = status === 'applied'
              const isSkipped = status === 'skipped'
              const isDone = isApplied || isSkipped
              const isSelected = selectedSuggestions.has(i)
              return (
                <div key={i} className={`rounded-lg border p-4 space-y-2 ${isDone ? 'opacity-60' : ''} ${isSelected ? 'ring-1 ring-primary/40 ' : ''}${style.border}`}>
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSuggestion(i)}
                      disabled={isDone}
                      onClick={e => e.stopPropagation()}
                      className="h-4 w-4 rounded border-input accent-primary shrink-0 mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <GitMerge className={`h-3.5 w-3.5 shrink-0 ${style.icon}`} />
                            <span className="text-sm font-medium">{s.title}</span>
                            <span className={`text-xs rounded-full px-2 py-0.5 ${style.badge}`}>{style.label}</span>
                            {isApplied && <span className="text-xs text-green-600 font-medium">✓ Applied{s._applied_at ? ` · ${new Date(s._applied_at).toLocaleDateString()}` : ''}</span>}
                            {isSkipped && <span className="text-xs text-muted-foreground">Skipped</span>}
                          </div>
                          <p className="text-xs text-muted-foreground">{s.rationale}</p>
                        </div>
                        {!isDone && (
                          <div className="flex gap-1.5 shrink-0">
                            <button onClick={() => applyOne(s, i)} disabled={!!applying[i]}
                              className="inline-flex items-center gap-1.5 rounded-md bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 text-xs font-medium disabled:opacity-50 transition-colors">
                              {applying[i] ? 'Applying…' : 'Apply'}
                            </button>
                            <button onClick={() => skipOne(s, i)}
                              className="inline-flex items-center rounded-md border border-input bg-background hover:bg-muted px-2.5 py-1.5 text-xs text-muted-foreground transition-colors">
                              Skip
                            </button>
                          </div>
                        )}
                      </div>
                      <SuggestionDetail s={s} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Looks good */}
        {result.looks_good?.length > 0 && (() => {
          // Group items into topic buckets for tree rendering
          // Key: topic_id (number) or topic_name (string) as fallback
          const groups = {}
          const groupOrder = []

          for (const item of result.looks_good) {
            if (!item) continue
            // Legacy plain-string format
            if (typeof item === 'string') {
              const key = `__str_${item}`
              groups[key] = groups[key] || { topicItem: null, subtopics: [], label: item, pa: null }
              groupOrder.includes(key) || groupOrder.push(key)
              continue
            }
            if (item.type === 'topic') {
              const key = item.topic_id ?? item.name
              groups[key] = groups[key] || { topicItem: null, subtopics: [], label: item.name, pa: item.pa_name }
              groups[key].topicItem = item
              groupOrder.includes(key) || groupOrder.push(key)
            } else if (item.type === 'subtopic') {
              const key = item.topic_id ?? item.topic_name ?? '__unknown'
              groups[key] = groups[key] || { topicItem: null, subtopics: [], label: item.topic_name || '—', pa: item.pa_name }
              groups[key].subtopics.push(item)
              groupOrder.includes(key) || groupOrder.push(key)
            } else {
              // {name, rationale} without type
              const key = `__plain_${item.name}`
              groups[key] = groups[key] || { topicItem: item, subtopics: [], label: item.name, pa: null }
              groupOrder.includes(key) || groupOrder.push(key)
            }
          }

          return (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <div className="text-xs font-medium text-green-700 uppercase tracking-wide mb-4">No changes needed</div>
              <div className="space-y-4">
                {groupOrder.map(key => {
                  const g = groups[key]
                  const path = [g.pa && g.pa !== 'Unassigned' ? g.pa : null, g.label].filter(Boolean).join(' › ')
                  return (
                    <div key={key}>
                      {/* Topic row */}
                      <div className="flex items-start gap-2">
                        <span className="text-green-500 shrink-0 mt-0.5 text-sm">✓</span>
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-green-900">{path}</span>
                          {g.topicItem?.rationale && (
                            <p className="text-xs text-green-700/75 mt-0.5">{g.topicItem.rationale}</p>
                          )}
                        </div>
                      </div>
                      {/* Subtopic rows — indented under the topic */}
                      {g.subtopics.map((st, j) => (
                        <div key={j} className="ml-5 mt-1.5 pl-3 border-l-2 border-green-200 flex items-start gap-2">
                          <span className="text-green-400 shrink-0 mt-0.5 text-xs">✓</span>
                          <div className="min-w-0">
                            <span className="text-xs font-medium text-green-800">{st.name}</span>
                            {st.rationale && (
                              <p className="text-xs text-green-600/75 mt-0.5">{st.rationale}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}
      </CardContent>
    </Card>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ReviewTopics() {
  const [tree, setTree] = useState(null)
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editTarget, setEditTarget] = useState(null)
  const [selectedPA, setSelectedPA] = useState(null)
  const [activeFilter, setActiveFilter] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [selectedSubtopicIds, setSelectedSubtopicIds] = useState(new Set())
  const [aiReview, setAiReview] = useState(null)       // null | 'loading' | {result + session_id}
  const [sessionId, setSessionId] = useState(null)
  const [incompleteSessions, setIncompleteSessions] = useState(null) // null = not loaded yet
  const [showHistory, setShowHistory] = useState(false)
  const [historyData, setHistoryData] = useState(null)
  const [reviewScopePrompt, setReviewScopePrompt] = useState(null) // null | { body, paNames }
  const [dismissConfirmOpen, setDismissConfirmOpen] = useState(false)
  const [toasts, setToasts] = useState([])
  // Bulk action modals
  const [bulkModal, setBulkModal] = useState(null) // null | 'merge_topics' | 'merge_subtopics' | 'move_subtopics' | 'delete_confirm'
  const [bulkModalTargetId, setBulkModalTargetId] = useState('')
  const [bulkModalTargetLabel, setBulkModalTargetLabel] = useState('')
  const [bulkModalSearch, setBulkModalSearch] = useState('')
  const [bulkModalResults, setBulkModalResults] = useState([])
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkProgress, setBulkProgress] = useState(null) // null | { done, total, label }

  function showToast(message, type = 'success') {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }

  const loadData = useCallback(() => {
    setLoading(true)
    Promise.all([api.taxonomy.tree(), api.taxonomy.health()])
      .then(([t, h]) => { setTree(Array.isArray(t) ? t : []); setHealth(h); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Check for incomplete sessions on mount
  useEffect(() => {
    api.taxonomy.aiReviewIncomplete()
      .then(setIncompleteSessions)
      .catch(() => setIncompleteSessions([]))
  }, [])

  const handleUpdated = useCallback(() => {
    loadData()
    setEditTarget(null)
  }, [loadData])

  const refreshIncomplete = useCallback(() => {
    api.taxonomy.aiReviewIncomplete().then(setIncompleteSessions).catch(() => {})
  }, [])

  const handleToggleTopic = useCallback(id =>
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }), [])

  const handleToggleAllTopics = useCallback((filtered, allSelected) => {
    setSelectedIds(prev => {
      const n = new Set(prev)
      if (allSelected) filtered.forEach(t => n.delete(t.id))
      else filtered.forEach(t => n.add(t.id))
      return n
    })
  }, [])

  const handleToggleSubtopic = useCallback(id =>
    setSelectedSubtopicIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }), [])

  const handleSelectSubtopics = useCallback((topicId, ids) => {
    setSelectedSubtopicIds(prev => { const n = new Set(prev); ids.forEach(id => n.add(id)); return n })
    setSelectedIds(prev => { const n = new Set(prev); n.delete(topicId); return n })
  }, [])

  const handleDeselectSubtopics = useCallback(ids =>
    setSelectedSubtopicIds(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n }), [])

  const handleSelectAllSubtopics = useCallback(ids =>
    setSelectedSubtopicIds(prev => { const n = new Set(prev); ids.forEach(id => n.add(id)); return n }), [])

  const handleEditTopic = useCallback(t => setEditTarget({ type: 'topic', data: t }), [])

  const handleEditSubtopic = useCallback((st, parent) => setEditTarget({ type: 'subtopic', data: st, parent }), [])

  async function runAiReview(body) {
    setReviewScopePrompt(null)
    setAiReview('loading')
    setSessionId(null)
    try {
      const result = await api.taxonomy.aiReview(body)
      setSessionId(result.session_id || null)
      setAiReview(result)
      refreshIncomplete()
    } catch (e) {
      showToast(e.message, 'error')
      setAiReview(null)
    }
  }

  async function openSession(id) {
    const session = await api.taxonomy.aiReviewSession(id)
    setSessionId(id)
    setAiReview({
      session_id: id,
      summary: `Loaded session #${id} from ${new Date(session.created_at).toLocaleDateString()}`,
      suggestions: session.suggestions || [],
      looks_good: [],
      _meta: { topics_reviewed: '?', subtopics_reviewed: '?', cost_usd: session.cost_usd, batches: session.batches },
    })
    setShowHistory(false)
  }

  const allTopics = (tree || []).flatMap(pa => (pa.topics || []).map(t => ({
    ...t, product_area_name: pa.name,
    subtopics: t.subtopics || [],
  })))

  // When PA or health filter changes, intersect selection with what's now visible
  // so the banner always reflects exactly what will be reviewed
  useEffect(() => {
    if (!allTopics.length) return
    if (selectedIds.size === 0 && selectedSubtopicIds.size === 0) return

    const visibleTopics = allTopics.filter(t => {
      if (selectedPA === '__unassigned__' && t.product_area_id) return false
      if (selectedPA && selectedPA !== '__unassigned__' && t.product_area_id !== selectedPA) return false
      if (activeFilter === 'zero_subtopics' && (t.subtopics || []).length !== 0) return false
      if (activeFilter === 'one_subtopic' && (t.subtopics || []).length !== 1) return false
      if (activeFilter === 'one_issue' && !(t.subtopics || []).some(s => s.match_count === 1)) return false
      if (activeFilter === 'few_issues' && !(t.subtopics || []).some(s => s.match_count > 0 && s.match_count < 3)) return false
      if (activeFilter === 'no_issues' && !(t.subtopics || []).some(s => s.match_count === 0)) return false
      return true
    })
    const visibleTopicIds = new Set(visibleTopics.map(t => t.id))
    const visibleSubtopicIds = new Set(visibleTopics.flatMap(t => (t.subtopics || []).map(st => st.id)))

    setSelectedIds(prev => {
      const next = new Set([...prev].filter(id => visibleTopicIds.has(id)))
      return next.size === prev.size ? prev : next
    })
    setSelectedSubtopicIds(prev => {
      const next = new Set([...prev].filter(id => visibleSubtopicIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [selectedPA, activeFilter, allTopics])

  function closeBulkModal() {
    setBulkModal(null); setBulkModalTargetId(''); setBulkModalTargetLabel(''); setBulkModalSearch(''); setBulkModalResults([])
  }

  async function handleBulkMergeTopics() {
    if (!bulkModalTargetId) return
    const ids = [...selectedIds].filter(id => id !== parseInt(bulkModalTargetId))
    setBulkLoading(true); setBulkProgress({ done: 0, total: ids.length, label: 'Merging topics…' }); closeBulkModal()
    let ok = 0, fail = 0
    for (const id of ids) {
      try { await api.taxonomy.mergeTopic(id, parseInt(bulkModalTargetId)); ok++ } catch { fail++ }
      setBulkProgress(prev => ({ ...prev, done: prev.done + 1 }))
    }
    setBulkLoading(false); setBulkProgress(null); setSelectedIds(new Set())
    showToast(fail === 0 ? `${ok} topic${ok !== 1 ? 's' : ''} merged ✓` : `${ok} merged, ${fail} failed`, fail > 0 ? 'error' : 'success')
    loadData()
  }

  async function handleBulkMergeSubtopics() {
    if (!bulkModalTargetId) return
    const ids = [...selectedSubtopicIds].filter(id => id !== parseInt(bulkModalTargetId))
    setBulkLoading(true); setBulkProgress({ done: 0, total: ids.length, label: 'Merging subtopics…' }); closeBulkModal()
    let ok = 0, fail = 0
    for (const id of ids) {
      try { await api.taxonomy.mergeSubtopic(id, parseInt(bulkModalTargetId)); ok++ } catch { fail++ }
      setBulkProgress(prev => ({ ...prev, done: prev.done + 1 }))
    }
    setBulkLoading(false); setBulkProgress(null); setSelectedSubtopicIds(new Set())
    showToast(fail === 0 ? `${ok} subtopic${ok !== 1 ? 's' : ''} merged ✓` : `${ok} merged, ${fail} failed`, fail > 0 ? 'error' : 'success')
    loadData()
  }

  async function handleBulkMoveSubtopics() {
    if (!bulkModalTargetId) return
    const ids = [...selectedSubtopicIds]
    setBulkLoading(true); setBulkProgress({ done: 0, total: ids.length, label: 'Moving subtopics…' }); closeBulkModal()
    let ok = 0, fail = 0
    for (const id of ids) {
      try { await api.taxonomy.moveSubtopic(id, parseInt(bulkModalTargetId)); ok++ } catch { fail++ }
      setBulkProgress(prev => ({ ...prev, done: prev.done + 1 }))
    }
    setBulkLoading(false); setBulkProgress(null); setSelectedSubtopicIds(new Set())
    showToast(fail === 0 ? `${ok} subtopic${ok !== 1 ? 's' : ''} moved ✓` : `${ok} moved, ${fail} failed`, fail > 0 ? 'error' : 'success')
    loadData()
  }

  async function handleBulkDelete() {
    const topicIds = [...selectedIds]
    const subtopicIds = [...selectedSubtopicIds]
    const total = topicIds.length + subtopicIds.length
    setBulkLoading(true); setBulkProgress({ done: 0, total, label: 'Deleting…' }); closeBulkModal()
    let ok = 0, fail = 0
    for (const id of topicIds) {
      try { await api.taxonomy.deleteTopic(id); ok++ } catch { fail++ }
      setBulkProgress(prev => ({ ...prev, done: prev.done + 1 }))
    }
    for (const id of subtopicIds) {
      try { await api.taxonomy.deleteSubtopic(id); ok++ } catch { fail++ }
      setBulkProgress(prev => ({ ...prev, done: prev.done + 1 }))
    }
    setBulkLoading(false); setBulkProgress(null); setSelectedIds(new Set()); setSelectedSubtopicIds(new Set())
    showToast(fail === 0 ? `${ok} item${ok !== 1 ? 's' : ''} deleted ✓` : `${ok} deleted, ${fail} failed`, fail > 0 ? 'error' : 'success')
    loadData()
  }

  async function handleBulkModalSearch(q) {
    setBulkModalSearch(q)
    if (q.length < 1) { setBulkModalResults([]); return }
    try {
      const res = await api.subtopicSearch(q)
      setBulkModalResults(res || [])
    } catch { setBulkModalResults([]) }
  }

  const sheetTitle = editTarget?.type === 'topic'
    ? `Edit Topic: ${editTarget.data.name}`
    : editTarget?.type === 'subtopic'
    ? `Edit Subtopic: ${editTarget.data.name}`
    : ''

  return (
    <div className="p-8 space-y-6">
      <Toast toasts={toasts} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Review Topics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {selectedPA || activeFilter ? 'Filtered — click a row or metric to change the selection.' : 'Click a product area row to filter. Click an amber metric cell to filter by that health indicator.'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData}>Refresh</Button>
      </div>

      <div className={`relative ${aiReview || bulkLoading ? 'pointer-events-none' : ''}`}>
        {(aiReview || bulkLoading) && <div className="absolute inset-0 bg-background/50 z-10 rounded-md" />}
        <HealthBanner
          tree={tree}
          selectedPA={selectedPA}
          onSelectPA={setSelectedPA}
          activeFilter={activeFilter}
          onFilter={setActiveFilter}
        />
      </div>

      {/* Filter toggles */}
      {allTopics.length > 0 && (() => {
        const visibleTopics = selectedPA === '__unassigned__'
          ? allTopics.filter(t => !t.product_area_id)
          : selectedPA
          ? allTopics.filter(t => t.product_area_id === selectedPA)
          : allTopics
        const visibleSubtopics = visibleTopics.flatMap(t => t.subtopics || [])
        const counts = {
          zero_subtopics: visibleTopics.filter(t => (t.subtopics || []).length === 0).length,
          one_subtopic:   visibleTopics.filter(t => (t.subtopics || []).length === 1).length,
          one_issue:      visibleSubtopics.filter(s => s.match_count === 1).length,
          few_issues:     visibleSubtopics.filter(s => s.match_count > 0 && s.match_count < 3).length,
          no_issues:      visibleSubtopics.filter(s => s.match_count === 0).length,
        }
        const filters = [
          { key: 'zero_subtopics', label: '0 subtopics' },
          { key: 'one_subtopic',   label: '1 subtopic' },
          { key: 'one_issue',      label: '1 issue' },
          { key: 'few_issues',     label: 'Few issues' },
          { key: 'no_issues',      label: 'No issues' },
        ]
        return (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Filter:</span>
            {filters.map(f => {
              const count = counts[f.key]
              const active = activeFilter === f.key
              return (
                <button
                  key={f.key}
                  onClick={() => setActiveFilter(active ? null : f.key)}
                  disabled={count === 0 || !!aiReview || bulkLoading}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors border ${
                    aiReview || bulkLoading
                      ? 'bg-muted/30 text-muted-foreground/40 border-border/40 cursor-not-allowed'
                      : active
                      ? 'bg-amber-100 text-amber-800 border-amber-300'
                      : count === 0
                      ? 'bg-muted/30 text-muted-foreground/40 border-border/40 cursor-not-allowed'
                      : 'bg-background text-muted-foreground border-border hover:bg-muted/50 hover:text-foreground'
                  }`}
                >
                  {f.label}
                  <span className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${active ? 'bg-amber-200 text-amber-800' : 'bg-muted text-muted-foreground'}`}>
                    {count}
                  </span>
                </button>
              )
            })}
            {activeFilter && !aiReview && !bulkLoading && (
              <button onClick={() => setActiveFilter(null)} className="text-xs text-muted-foreground hover:text-foreground ml-1">
                Clear
              </button>
            )}
          </div>
        )
      })()}

      {/* Bulk action bar */}
      {/* Incomplete session banner */}
      {incompleteSessions?.length > 0 && !aiReview && (
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-md">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="text-sm text-amber-800 flex-1">
            {incompleteSessions.length === 1
              ? `You have an incomplete AI review from ${new Date(incompleteSessions[0].created_at).toLocaleDateString()} — ${incompleteSessions[0].pending_count} suggestion${incompleteSessions[0].pending_count !== 1 ? 's' : ''} still pending.`
              : `You have ${incompleteSessions.length} incomplete AI reviews with pending suggestions.`}
          </span>
          <button
            onClick={() => openSession(incompleteSessions[0].id)}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 text-xs font-medium transition-colors"
          >
            Continue
          </button>
          <button
            onClick={() => setDismissConfirmOpen(true)}
            className="shrink-0 text-xs text-amber-700 hover:text-amber-900"
          >
            Dismiss
          </button>
        </div>
      )}

      {(selectedIds.size > 0 || selectedSubtopicIds.size > 0) && !aiReview && (() => {
        const topicsOnly = selectedIds.size > 0 && selectedSubtopicIds.size === 0
        const subtopicsOnly = selectedSubtopicIds.size > 0 && selectedIds.size === 0
        const mixed = selectedIds.size > 0 && selectedSubtopicIds.size > 0
        const totalSelected = selectedIds.size + selectedSubtopicIds.size
        return (
          <div className="sticky top-5 z-10 flex items-center gap-2 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-md shadow-sm flex-wrap">
            {bulkLoading && bulkProgress ? (
              // ── Progress display ──
              <>
                <span className="text-sm font-medium shrink-0">{bulkProgress.label}</span>
                <div className="flex-1 min-w-32 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-200"
                    style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {bulkProgress.done}/{bulkProgress.total}
                </span>
              </>
            ) : (
              // ── Normal action bar ──
              <>
            <span className="text-sm font-medium shrink-0">
              {mixed
                ? `${selectedIds.size} topic${selectedIds.size !== 1 ? 's' : ''} + ${selectedSubtopicIds.size} subtopic${selectedSubtopicIds.size !== 1 ? 's' : ''} selected`
                : topicsOnly
                ? `${selectedIds.size} topic${selectedIds.size !== 1 ? 's' : ''} selected`
                : `${selectedSubtopicIds.size} subtopic${selectedSubtopicIds.size !== 1 ? 's' : ''} selected`}
            </span>

            <div className="flex items-center gap-2 ml-auto flex-wrap">
              {/* Merge into — topics only or subtopics only */}
              {(topicsOnly || subtopicsOnly) && (
                <button
                  onClick={() => setBulkModal(topicsOnly ? 'merge_topics' : 'merge_subtopics')}
                  className="inline-flex items-center rounded-md border border-input bg-background hover:bg-muted px-3 py-1.5 text-xs font-medium transition-colors"
                >
                  Merge into…
                </button>
              )}

              {/* Move to topic — subtopics only */}
              {subtopicsOnly && (
                <button
                  onClick={() => setBulkModal('move_subtopics')}
                  className="inline-flex items-center rounded-md border border-input bg-background hover:bg-muted px-3 py-1.5 text-xs font-medium transition-colors"
                >
                  Move to topic…
                </button>
              )}

              {/* Delete */}
              <button
                onClick={() => setBulkModal('delete_confirm')}
                className="inline-flex items-center rounded-md border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 px-3 py-1.5 text-xs font-medium transition-colors"
              >
                Delete {totalSelected}
              </button>

              {/* Review with AI — always */}
              <button
                onClick={() => {
                  const body = selectedSubtopicIds.size > 0
                    ? { subtopic_ids: [...selectedSubtopicIds], topic_ids: [...selectedIds] }
                    : { topic_ids: [...selectedIds] }
                  // Derive product area(s) involved in the selection
                  const selectedTopics = allTopics.filter(t => selectedIds.has(t.id))
                  const subtopicParentTopics = allTopics.filter(t =>
                    (t.subtopics || []).some(st => selectedSubtopicIds.has(st.id))
                  )
                  const paNames = [...new Set(
                    [...selectedTopics, ...subtopicParentTopics]
                      .map(t => t.product_area_name)
                      .filter(Boolean)
                  )]
                  // Only ask if all selected items belong to exactly one product area
                  if (paNames.length === 1) {
                    setReviewScopePrompt({ body, paNames })
                  } else {
                    runAiReview({ ...body, restrict_to_pa: false })
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 text-xs font-medium transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5" /> Review with AI
              </button>

              <button onClick={() => { setSelectedIds(new Set()); setSelectedSubtopicIds(new Set()) }} className="text-xs text-muted-foreground hover:text-foreground">
                Clear
              </button>
            </div>
              </>
            )}
          </div>
        )
      })()}

      {/* Dismiss incomplete AI review confirmation */}
      {dismissConfirmOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-background border rounded-lg shadow-xl p-6 w-[420px] space-y-4">
            <h3 className="text-base font-semibold">Dismiss AI review?</h3>
            <p className="text-sm text-muted-foreground">
              {incompleteSessions?.length === 1
                ? `This will mark all ${incompleteSessions[0].pending_count} pending suggestion${incompleteSessions[0].pending_count !== 1 ? 's' : ''} as skipped. This cannot be undone.`
                : `This will mark all pending suggestions across ${incompleteSessions?.length} incomplete reviews as skipped. This cannot be undone.`}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDismissConfirmOpen(false)}
                className="inline-flex items-center rounded-md border border-input bg-background hover:bg-muted px-3 py-1.5 text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const toDissmiss = [...incompleteSessions]
                  setIncompleteSessions([])
                  setDismissConfirmOpen(false)
                  Promise.all(toDissmiss.map(s => api.taxonomy.aiReviewDismiss(s.id).catch(() => {}))).then(() => {
                    showToast('AI review dismissed ✓')
                  })
                }}
                className="inline-flex items-center rounded-md bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 text-xs font-medium transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Product Area scope confirmation for Review with AI */}
      {reviewScopePrompt && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-background border rounded-lg shadow-xl p-6 w-[460px] space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-600 shrink-0" />
              <h3 className="text-base font-semibold">Review with AI — scope</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              All selected items belong to <span className="font-medium text-foreground">{reviewScopePrompt.paNames[0]}</span>.
              Should the review check for merge and move opportunities within this Product Area only,
              or consider the entire taxonomy?
            </p>
            <div className="space-y-2">
              <label className="flex items-start gap-3 cursor-pointer rounded-md border border-input p-3 hover:bg-muted/40 transition-colors">
                <input
                  type="radio"
                  name="review_scope"
                  className="mt-0.5 accent-purple-600"
                  onChange={() => setReviewScopePrompt(prev => ({ ...prev, selected: 'same_pa' }))}
                  checked={reviewScopePrompt.selected === 'same_pa'}
                />
                <div>
                  <div className="text-sm font-medium">Within {reviewScopePrompt.paNames[0]} only</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Merge and move suggestions will only reference topics and subtopics in the same Product Area — no cross-area suggestions.</div>
                </div>
              </label>
              <label className="flex items-start gap-3 cursor-pointer rounded-md border border-input p-3 hover:bg-muted/40 transition-colors">
                <input
                  type="radio"
                  name="review_scope"
                  className="mt-0.5 accent-purple-600"
                  onChange={() => setReviewScopePrompt(prev => ({ ...prev, selected: 'all_pas' }))}
                  checked={reviewScopePrompt.selected === 'all_pas' || !reviewScopePrompt.selected}
                />
                <div>
                  <div className="text-sm font-medium">All product areas</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Suggestions may reference any topic or subtopic across the full taxonomy, including other Product Areas.</div>
                </div>
              </label>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setReviewScopePrompt(null)}
                className="inline-flex items-center rounded-md border border-input bg-background hover:bg-muted px-3 py-1.5 text-xs font-medium transition-colors">
                Cancel
              </button>
              <button
                onClick={() => runAiReview({
                  ...reviewScopePrompt.body,
                  restrict_to_pa: reviewScopePrompt.selected === 'same_pa',
                })}
                className="inline-flex items-center gap-1.5 rounded-md bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 text-xs font-medium transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5" /> Start Review
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk action modals */}
      {(bulkModal === 'merge_topics' || bulkModal === 'move_subtopics') && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-background border rounded-lg shadow-xl p-6 w-[440px] space-y-4">
            <h3 className="text-base font-semibold">
              {bulkModal === 'merge_topics'
                ? `Merge ${selectedIds.size} topic${selectedIds.size !== 1 ? 's' : ''} into…`
                : `Move ${selectedSubtopicIds.size} subtopic${selectedSubtopicIds.size !== 1 ? 's' : ''} to topic…`}
            </h3>
            <p className="text-xs text-muted-foreground">
              {bulkModal === 'merge_topics'
                ? 'All subtopics will be moved to the target topic. Selected topics will be soft-deleted.'
                : 'All selected subtopics will be moved to the chosen topic.'}
            </p>
            <div className="max-h-52 overflow-auto border rounded-md divide-y">
              {allTopics
                .filter(t => !selectedIds.has(t.id))
                .map(t => (
                  <button key={t.id} onClick={() => { setBulkModalTargetId(t.id); setBulkModalTargetLabel(t.name) }}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${bulkModalTargetId === t.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/50'}`}>
                    <div>{t.name}</div>
                    {t.product_area_name && <div className="text-xs text-muted-foreground">{t.product_area_name}</div>}
                  </button>
                ))}
            </div>
            {bulkModalTargetId && <p className="text-xs text-muted-foreground">Target: <span className="font-medium text-foreground">{bulkModalTargetLabel}</span></p>}
            <div className="flex gap-2 justify-end">
              <button onClick={closeBulkModal} className="inline-flex items-center rounded-md border border-input bg-background hover:bg-muted px-3 py-1.5 text-xs font-medium transition-colors">Cancel</button>
              <button onClick={bulkModal === 'merge_topics' ? handleBulkMergeTopics : handleBulkMoveSubtopics}
                disabled={!bulkModalTargetId || bulkLoading}
                className="inline-flex items-center rounded-md bg-primary hover:bg-primary/90 text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50 transition-colors">
                {bulkLoading ? 'Running…' : bulkModal === 'merge_topics' ? 'Merge' : 'Move'}
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkModal === 'merge_subtopics' && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-background border rounded-lg shadow-xl p-6 w-[440px] space-y-4">
            <h3 className="text-base font-semibold">Merge {selectedSubtopicIds.size} subtopic{selectedSubtopicIds.size !== 1 ? 's' : ''} into…</h3>
            <p className="text-xs text-muted-foreground">All selected subtopics will be merged into the target. They will be soft-deleted and their issues reassigned.</p>
            <input type="text" placeholder="Search subtopics…" value={bulkModalSearch}
              onChange={e => handleBulkModalSearch(e.target.value)}
              className="flex h-8 w-full rounded-md border border-input bg-background px-3 text-sm" autoFocus />
            <div className="max-h-48 overflow-auto border rounded-md divide-y">
              {bulkModalResults.length === 0 && bulkModalSearch.length < 1
                ? <p className="text-xs text-muted-foreground px-3 py-2">Type to search…</p>
                : bulkModalResults.length === 0
                ? <p className="text-xs text-muted-foreground px-3 py-2">No results.</p>
                : bulkModalResults
                    .filter(s => !selectedSubtopicIds.has(s.id))
                    .map(s => (
                      <button key={s.id} onClick={() => { setBulkModalTargetId(s.id); setBulkModalTargetLabel(s.name) }}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors ${bulkModalTargetId === s.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/50'}`}>
                        <div>{s.name}</div>
                        <div className="text-xs text-muted-foreground">{s.topic_name} · {s.match_count} issues</div>
                      </button>
                    ))}
            </div>
            {bulkModalTargetId && <p className="text-xs text-muted-foreground">Target: <span className="font-medium text-foreground">{bulkModalTargetLabel}</span></p>}
            <div className="flex gap-2 justify-end">
              <button onClick={closeBulkModal} className="inline-flex items-center rounded-md border border-input bg-background hover:bg-muted px-3 py-1.5 text-xs font-medium transition-colors">Cancel</button>
              <button onClick={handleBulkMergeSubtopics} disabled={!bulkModalTargetId || bulkLoading}
                className="inline-flex items-center rounded-md bg-primary hover:bg-primary/90 text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50 transition-colors">
                {bulkLoading ? 'Merging…' : 'Merge'}
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkModal === 'delete_confirm' && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-background border rounded-lg shadow-xl p-6 w-[420px] space-y-4">
            <h3 className="text-base font-semibold text-red-600">Delete {selectedIds.size + selectedSubtopicIds.size} item{selectedIds.size + selectedSubtopicIds.size !== 1 ? 's' : ''}?</h3>
            <div className="text-sm text-muted-foreground space-y-1">
              {selectedIds.size > 0 && <p>· {selectedIds.size} topic{selectedIds.size !== 1 ? 's' : ''} — only those with 0 subtopics will succeed</p>}
              {selectedSubtopicIds.size > 0 && <p>· {selectedSubtopicIds.size} subtopic{selectedSubtopicIds.size !== 1 ? 's' : ''} — only those with 0 matched issues will succeed</p>}
              <p className="text-red-600 font-medium pt-1">This cannot be undone.</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={closeBulkModal} className="inline-flex items-center rounded-md border border-input bg-background hover:bg-muted px-3 py-1.5 text-xs font-medium transition-colors">Cancel</button>
              <button onClick={handleBulkDelete} disabled={bulkLoading}
                className="inline-flex items-center rounded-md bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 text-xs font-medium disabled:opacity-50 transition-colors">
                {bulkLoading ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review history panel */}
      {showHistory && historyData && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Past AI Reviews</div>
            {historyData.length === 0 ? (
              <p className="text-sm text-muted-foreground">No past reviews found.</p>
            ) : historyData.map(s => (
              <button key={s.id} onClick={() => openSession(s.id)}
                className="w-full flex items-center gap-4 px-3 py-2.5 rounded-md text-left hover:bg-muted/50 transition-colors border border-border">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{new Date(s.created_at).toLocaleDateString()} · Session #{s.id}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {s.total_suggestions} suggestions ·{' '}
                    <span className="text-green-600">{s.applied_count} applied</span> ·{' '}
                    {s.pending_count > 0 && <span className="text-amber-600">{s.pending_count} pending · </span>}
                    {s.skipped_count} skipped
                  </div>
                </div>
                {s.cost_usd != null && <span className="text-xs text-muted-foreground">${s.cost_usd.toFixed(4)}</span>}
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* AI review result */}
      {aiReview === 'loading' && (
        <Card>
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="h-4 w-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin shrink-0" />
              Claude is reviewing your taxonomy…
            </div>
          </CardContent>
        </Card>
      )}
      {aiReview && aiReview !== 'loading' && (
        <AIReviewResults
          result={aiReview}
          sessionId={sessionId}
          showToast={showToast}
          onApplied={handleUpdated}
          onDismiss={() => { setAiReview(null); setSessionId(null) }}
          onSessionUpdate={refreshIncomplete}
        />
      )}

      {/* Topic list */}
      <TopicOverviewList
        topics={allTopics}
        selectedPA={selectedPA}
        activeFilter={activeFilter}
        selectedIds={selectedIds}
        onToggle={handleToggleTopic}
        onToggleAll={handleToggleAllTopics}
        selectedSubtopicIds={selectedSubtopicIds}
        onToggleSubtopic={handleToggleSubtopic}
        onSelectSubtopics={handleSelectSubtopics}
        onDeselectSubtopics={handleDeselectSubtopics}
        onSelectAllSubtopics={handleSelectAllSubtopics}
        onEditTopic={handleEditTopic}
        onEditSubtopic={handleEditSubtopic}
        disabled={bulkLoading || !!aiReview}
      />

      {/* Right-side edit sheet */}
      <Sheet open={!!editTarget} onClose={() => setEditTarget(null)} title={sheetTitle} width="w-[680px]">
        {editTarget?.type === 'topic' && (
          <div className="p-6 overflow-y-auto h-full">
            <TopicDetail
              key={editTarget.data.id}
              topic={editTarget.data}
              allTopics={allTopics}
              onUpdated={handleUpdated}
              showToast={showToast}
            />
          </div>
        )}
        {editTarget?.type === 'subtopic' && (
          <div className="p-6 overflow-y-auto h-full">
            <SubtopicDetail
              key={editTarget.data.id}
              subtopic={editTarget.data}
              parentTopic={editTarget.parent}
              allTopics={allTopics}
              onUpdated={handleUpdated}
              showToast={showToast}
            />
          </div>
        )}
      </Sheet>
    </div>
  )
}
