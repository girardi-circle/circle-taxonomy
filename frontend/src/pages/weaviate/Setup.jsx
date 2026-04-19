import { useEffect, useState, useCallback } from 'react'
import { api } from '@/api/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

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
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold text-sm">{meta.label || name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{data?.description || meta.purpose}</div>
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

        {/* Stats grid */}
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

        {/* Progress bar */}
        {!loading && data && (
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Sync coverage</span>
              <span>{pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-1.5 rounded-full transition-all ${inSync ? 'bg-green-500' : 'bg-amber-400'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Vectorized field */}
        {meta.vectorized && (
          <div className="text-xs text-muted-foreground">
            Vectorized field: <code className="bg-muted px-1 rounded">{meta.vectorized}</code>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function WeaviateSetup() {
  const [collections, setCollections] = useState(null)
  const [loading, setLoading] = useState(true)
  const [setting, setSetting] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [setupMsg, setSetupMsg] = useState(null)
  const [migrateMsg, setMigrateMsg] = useState(null)
  const [error, setError] = useState(null)

  const loadStatus = useCallback(() => {
    setLoading(true)
    api.weaviate.collectionsStatus()
      .then(d => { setCollections(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])

  async function runSetup() {
    setSetting(true)
    setSetupMsg(null)
    setError(null)
    try {
      const r = await api.weaviate.setup()
      setSetupMsg(r.message)
      loadStatus()
    } catch (e) {
      setError(e.message)
    } finally {
      setSetting(false)
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Weaviate Setup</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Collection status and initialization
          </p>
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
          <Button variant="outline" size="sm" onClick={async () => {
            setMigrating(true); setMigrateMsg(null); setError(null)
            try {
              const r = await api.weaviate.migrateSubtopicStatus()
              setMigrateMsg(`Migration done — ${r.migrated} of ${r.total} objects backfilled with status=approved`)
              loadStatus()
            } catch (e) { setError(e.message) }
            finally { setMigrating(false) }
          }} disabled={migrating || loading}>
            {migrating ? 'Migrating…' : 'Migrate SubTopic schema'}
          </Button>
          <Button variant="outline" size="sm" onClick={loadStatus} disabled={loading || setting}>
            Refresh
          </Button>
        </div>
      </div>

      {migrateMsg && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-4 py-3">✓ {migrateMsg}</div>
      )}
      {setupMsg && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-4 py-3">
          ✓ {setupMsg}
        </div>
      )}
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3">{error}</div>
      )}

      <div className="grid grid-cols-3 gap-5">
        {Object.keys(COLLECTION_META).map(name => (
          <CollectionCard
            key={name}
            name={name}
            data={collections?.[name]}
            loading={loading}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Run <strong>Initialize collections</strong> once before syncing or running classification.
        Collections that already exist are skipped — no data is deleted, and it is safe to run multiple times.
      </p>
    </div>
  )
}
