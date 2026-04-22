import { useEffect, useState, useCallback } from 'react'
import { api } from '@/api/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatTile } from '@/components/StatTile'

// ── Collection status ─────────────────────────────────────────────────────────

const COLLECTION_META = {
  ClassifiedIssue: {
    label: 'Classified Issues',
    vectorized: 'segment_description',
    purpose: 'RAG chat — semantic search over issues',
  },
  Transcript: {
    label: 'Transcripts',
    vectorized: 'raw_text',
    purpose: 'RAG chat — conversation-level search',
  },
  SubTopic: {
    label: 'SubTopics',
    vectorized: 'canonical_description',
    purpose: 'Classification pipeline — subtopic matching',
  },
}

function CollectionCard({ name, data, loading }) {
  const meta = COLLECTION_META[name] || {}
  const inSync = data && data.unsynced === 0
  const pct = data && data.redshift > 0
    ? Math.round((data.weaviate / data.redshift) * 100)
    : data?.weaviate > 0 ? 100 : 0

  return (
    <Card className={`overflow-hidden ${!loading && data?.weaviate === 0 ? 'border-amber-200' : ''}`}>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold text-sm">{meta.label || name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{meta.purpose}</div>
          </div>
          {!loading && (
            <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              inSync ? 'bg-green-100 text-green-700' :
              data?.weaviate === 0 ? 'bg-amber-100 text-amber-700' :
              'bg-yellow-100 text-yellow-700'
            }`}>
              {inSync ? '✓ in sync' : data?.weaviate === 0 ? 'empty' : `${pct}% synced`}
            </span>
          )}
        </div>
        {loading ? (
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map(i => <Skeleton key={i} className="h-14" />)}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-muted/40 rounded-md p-3">
              <div className="text-xs text-muted-foreground">Redshift</div>
              <div className="text-xl font-bold tabular-nums mt-0.5">{data?.redshift?.toLocaleString() ?? '—'}</div>
            </div>
            <div className="bg-muted/40 rounded-md p-3">
              <div className="text-xs text-muted-foreground">Weaviate</div>
              <div className="text-xl font-bold tabular-nums mt-0.5">{data?.weaviate?.toLocaleString() ?? '—'}</div>
            </div>
            <div className={`rounded-md p-3 ${data?.unsynced > 0 ? 'bg-amber-50' : 'bg-muted/40'}`}>
              <div className="text-xs text-muted-foreground">Unsynced</div>
              <div className={`text-xl font-bold tabular-nums mt-0.5 ${data?.unsynced > 0 ? 'text-amber-600' : ''}`}>
                {data?.unsynced?.toLocaleString() ?? '—'}
              </div>
            </div>
          </div>
        )}
        {!loading && data && (
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Sync coverage</span><span>{pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className={`h-1.5 rounded-full transition-all ${inSync ? 'bg-green-500' : 'bg-amber-400'}`}
                style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
        {meta.vectorized && (
          <div className="text-xs text-muted-foreground">
            Vectorized field: <code className="bg-muted px-1 rounded">{meta.vectorized}</code>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function WeaviateSetup() {
  const [collections, setCollections] = useState(null)
  const [issuesStatus, setIssuesStatus] = useState(null)
  const [transcriptsStatus, setTranscriptsStatus] = useState(null)
  const [loading, setLoading] = useState(true)

  const [setting, setSetting] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [syncingIssues, setSyncingIssues] = useState(false)
  const [syncingTranscripts, setSyncingTranscripts] = useState(false)

  const [setupMsg, setSetupMsg] = useState(null)
  const [migrateMsg, setMigrateMsg] = useState(null)
  const [issuesSyncResult, setIssuesSyncResult] = useState(null)
  const [transcriptsSyncResult, setTranscriptsSyncResult] = useState(null)
  const [error, setError] = useState(null)

  const loadAll = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      api.weaviate.collectionsStatus(),
      api.weaviate.issuesStatus(),
      api.weaviate.transcriptsStatus(),
    ])
      .then(([cols, issues, transcripts]) => {
        setCollections(cols)
        setIssuesStatus(issues)
        setTranscriptsStatus(transcripts)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  async function runSetup() {
    setSetting(true); setSetupMsg(null); setError(null)
    try {
      const r = await api.weaviate.setup()
      setSetupMsg(r.message)
      loadAll()
    } catch (e) { setError(e.message) }
    finally { setSetting(false) }
  }

  async function runMigrate() {
    setMigrating(true); setMigrateMsg(null); setError(null)
    try {
      const r = await api.weaviate.migrateSubtopicStatus()
      setMigrateMsg(`Migration done — ${r.migrated} of ${r.total} objects backfilled with status=approved`)
      loadAll()
    } catch (e) { setError(e.message) }
    finally { setMigrating(false) }
  }

  async function runSyncIssues() {
    setSyncingIssues(true); setIssuesSyncResult(null); setError(null)
    try {
      const r = await api.weaviate.syncIssues()
      setIssuesSyncResult(r)
      loadAll()
    } catch (e) { setError(e.message) }
    finally { setSyncingIssues(false) }
  }

  async function runSyncTranscripts() {
    setSyncingTranscripts(true); setTranscriptsSyncResult(null); setError(null)
    try {
      const r = await api.weaviate.syncTranscripts()
      setTranscriptsSyncResult(r)
      loadAll()
    } catch (e) { setError(e.message) }
    finally { setSyncingTranscripts(false) }
  }

  const issuesSyncPct = issuesStatus
    ? issuesStatus.total_redshift > 0
      ? Math.round((issuesStatus.synced_weaviate / issuesStatus.total_redshift) * 100)
      : 100
    : null

  const transcriptsSyncPct = transcriptsStatus
    ? transcriptsStatus.total_redshift > 0
      ? Math.round((transcriptsStatus.synced_weaviate / transcriptsStatus.total_redshift) * 100)
      : 100
    : null

  return (
    <div className="p-8 space-y-10">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Weaviate Setup</h1>
          <p className="text-sm text-muted-foreground mt-1">Collection status, initialization, and data sync</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadAll} disabled={loading}>Refresh</Button>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3">{error}</div>
      )}

      {/* ── Section 1: Collections ─────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Collections</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Initialize once before syncing or running classification. Safe to run multiple times.</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={runSetup} disabled={setting || loading}>
              {setting ? (
                <span className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Initializing…
                </span>
              ) : 'Initialize collections'}
            </Button>
            <Button variant="outline" size="sm" onClick={runMigrate} disabled={migrating || loading}>
              {migrating ? 'Migrating…' : 'Migrate SubTopic schema'}
            </Button>
          </div>
        </div>

        {setupMsg && (
          <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-4 py-3">✓ {setupMsg}</div>
        )}
        {migrateMsg && (
          <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-4 py-3">✓ {migrateMsg}</div>
        )}

        <div className="grid grid-cols-3 gap-5">
          {Object.keys(COLLECTION_META).map(name => (
            <CollectionCard key={name} name={name} data={collections?.[name]} loading={loading} />
          ))}
        </div>
      </div>

      <div className="border-t" />

      {/* ── Section 2: Sync Issues ─────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Sync Issues</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Sync classified issues from Redshift to the <strong>ClassifiedIssue</strong> collection. Run after bulk extraction.</p>
          </div>
          <Button onClick={runSyncIssues} disabled={syncingIssues || loading}>
            {syncingIssues ? (
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Syncing…
              </span>
            ) : 'Sync issues'}
          </Button>
        </div>

        {issuesSyncResult && (
          <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-4 py-3">
            ✓ Sync complete — {issuesSyncResult.synced ?? issuesSyncResult.classified_issues_synced ?? 0} records synced
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <StatTile label="Synced to Weaviate" value={issuesStatus?.synced_weaviate?.toLocaleString()}
            sub={issuesSyncPct != null ? `${issuesSyncPct}% of total` : undefined} />
          <StatTile label="Not yet synced" value={issuesStatus?.unsynced?.toLocaleString()}
            highlight={issuesStatus?.unsynced > 0} sub="in Redshift but missing from Weaviate" />
          <StatTile label="Total in Redshift" value={issuesStatus?.total_redshift?.toLocaleString()} />
        </div>

        <div className="grid grid-cols-4 gap-4">
          <StatTile label="Classified" value={issuesStatus?.classified?.toLocaleString()} sub="with a matched subtopic" />
          <StatTile label="Pending classification" value={issuesStatus?.pending_classification?.toLocaleString()}
            highlight={issuesStatus?.pending_classification > 0} sub="no subtopic yet" />
          <StatTile label="Frustrated sentiment" value={issuesStatus?.frustrated?.toLocaleString()} />
          <StatTile label="Last 7 days" value={issuesStatus?.last_7_days?.toLocaleString()} sub="recently extracted" />
        </div>
      </div>

      <div className="border-t" />

      {/* ── Section 3: Sync Transcripts ────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Sync Transcripts</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Sync transcripts from Redshift to the <strong>Transcript</strong> collection. The <code className="bg-muted px-1 rounded text-xs">raw_text</code> field is vectorized for conversation-level search.</p>
          </div>
          <Button onClick={runSyncTranscripts} disabled={syncingTranscripts || loading}>
            {syncingTranscripts ? (
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Syncing…
              </span>
            ) : 'Sync transcripts'}
          </Button>
        </div>

        {transcriptsSyncResult && (
          <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-4 py-3">
            ✓ Sync complete — {transcriptsSyncResult.synced ?? transcriptsSyncResult.transcripts_synced ?? 0} records synced
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <StatTile label="Synced to Weaviate" value={transcriptsStatus?.synced_weaviate?.toLocaleString()}
            sub={transcriptsSyncPct != null ? `${transcriptsSyncPct}% of total` : undefined} />
          <StatTile label="Not yet synced" value={transcriptsStatus?.unsynced?.toLocaleString()}
            highlight={transcriptsStatus?.unsynced > 0} sub="in Redshift but missing from Weaviate" />
          <StatTile label="Total in Redshift" value={transcriptsStatus?.total_redshift?.toLocaleString()} />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <StatTile label="Processed" value={transcriptsStatus?.processed?.toLocaleString()} sub="summary extracted by Claude" />
          <StatTile label="Unprocessed" value={transcriptsStatus?.unprocessed?.toLocaleString()}
            highlight={transcriptsStatus?.unprocessed > 0} sub="not yet run through pipeline" />
          <StatTile label="Last 7 days" value={transcriptsStatus?.last_7_days?.toLocaleString()} sub="recently ingested" />
        </div>
      </div>
    </div>
  )
}
