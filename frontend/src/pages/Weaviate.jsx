import { useEffect, useState, useCallback } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

function CollectionStat({ label, redshift, weaviate }) {
  const diff = redshift != null && weaviate != null ? redshift - weaviate : null
  const inSync = diff === 0
  return (
    <div className="flex items-center justify-between text-sm py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-4 tabular-nums">
        <span><span className="text-xs text-muted-foreground mr-1">Redshift</span>{redshift ?? '—'}</span>
        <span><span className="text-xs text-muted-foreground mr-1">Weaviate</span>{weaviate ?? '—'}</span>
        {diff != null && (
          <span className={`text-xs font-medium ${inSync ? 'text-green-600' : 'text-amber-600'}`}>
            {inSync ? '✓ in sync' : `${diff > 0 ? '+' : ''}${diff} drift`}
          </span>
        )}
      </div>
    </div>
  )
}

function SyncCard({ title, description, collection, onSync, status }) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  async function run() {
    setRunning(true)
    setResult(null)
    setError(null)
    try {
      const r = await onSync()
      setResult(r)
    } catch (e) {
      setError(e.message)
    } finally {
      setRunning(false)
    }
  }

  const col = status?.[collection]

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!status ? (
          <Skeleton className="h-6 w-full" />
        ) : (
          <div className="bg-muted/40 rounded-md px-3 py-2 space-y-1">
            <CollectionStat
              label={collection}
              redshift={col?.redshift}
              weaviate={col?.weaviate}
            />
          </div>
        )}

        <Button onClick={run} disabled={running} className="w-full">
          {running ? (
            <span className="flex items-center gap-2">
              <span className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Syncing…
            </span>
          ) : 'Sync now'}
        </Button>

        {result && (
          <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
            Done — {result.synced ?? result.classified_issues_synced ?? result.transcripts_synced ?? JSON.stringify(result)} records synced
          </div>
        )}
        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function WeaviatePage() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadStatus = useCallback(() => {
    setLoading(true)
    api.weaviate.status()
      .then(d => { setStatus(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Weaviate</h1>
          <p className="text-sm text-muted-foreground mt-1">Sync Redshift data to Weaviate vector collections</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadStatus} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh status'}
        </Button>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3">{error}</div>
      )}

      {/* Status overview */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Collection status</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
            </div>
          ) : status ? (
            <div className="divide-y">
              {Object.entries(status).map(([col, counts]) => (
                <CollectionStat
                  key={col}
                  label={col}
                  redshift={counts.redshift}
                  weaviate={counts.weaviate}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Could not load status.</p>
          )}
        </CardContent>
      </Card>

      {/* Sync cards */}
      <div className="grid grid-cols-2 gap-6">
        <SyncCard
          title="Sync Issues"
          description="Loads all classified issues from Redshift into the ClassifiedIssue collection. Used by the RAG chat to retrieve relevant issues."
          collection="ClassifiedIssue"
          onSync={() => api.weaviate.syncIssues().then(() => loadStatus())}
          status={status}
        />
        <SyncCard
          title="Sync Transcripts"
          description="Loads all transcripts from Redshift into the Transcript collection. Used by the RAG chat for conversation-level intelligence."
          collection="Transcript"
          onSync={() => api.weaviate.syncTranscripts().then(() => loadStatus())}
          status={status}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        The <strong>SubTopic</strong> collection is managed automatically — subtopics are added as you approve candidates in Process Topics.
      </p>
    </div>
  )
}
