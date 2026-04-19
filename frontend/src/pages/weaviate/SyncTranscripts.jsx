import { useEffect, useState, useCallback } from 'react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

function StatTile({ label, value, sub, highlight }) {
  return (
    <Card>
      <CardContent className="px-5 py-4">
        <div className="text-xs text-muted-foreground mb-1">{label}</div>
        <div className={`text-2xl font-bold tabular-nums ${highlight ? 'text-amber-600' : ''}`}>
          {value ?? <Skeleton className="h-7 w-16" />}
        </div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  )
}

export default function SyncTranscripts() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const loadStatus = useCallback(() => {
    setLoading(true)
    api.weaviate.transcriptsStatus()
      .then(d => { setStatus(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])

  async function runSync() {
    setSyncing(true)
    setResult(null)
    setError(null)
    try {
      const r = await api.weaviate.syncTranscripts()
      setResult(r)
      loadStatus()
    } catch (e) {
      setError(e.message)
    } finally {
      setSyncing(false)
    }
  }

  const syncPct = status
    ? status.total_redshift > 0
      ? Math.round((status.synced_weaviate / status.total_redshift) * 100)
      : 100
    : null

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Sync Transcripts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sync transcripts from Redshift to the Weaviate <strong>Transcript</strong> collection
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadStatus} disabled={loading || syncing}>Refresh</Button>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3">{error}</div>
      )}

      {/* Weaviate sync stats */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Weaviate sync status</h2>
        <div className="grid grid-cols-3 gap-4">
          <StatTile
            label="Synced to Weaviate"
            value={status?.synced_weaviate?.toLocaleString()}
            sub={syncPct != null ? `${syncPct}% of total` : undefined}
          />
          <StatTile
            label="Not yet synced"
            value={status?.unsynced?.toLocaleString()}
            highlight={status?.unsynced > 0}
            sub="in Redshift but missing from Weaviate"
          />
          <StatTile
            label="Total in Redshift"
            value={status?.total_redshift?.toLocaleString()}
          />
        </div>
      </div>

      {/* Transcript stats */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Transcript stats</h2>
        <div className="grid grid-cols-3 gap-4">
          <StatTile
            label="Processed"
            value={status?.processed?.toLocaleString()}
            sub="summary extracted by Claude"
          />
          <StatTile
            label="Unprocessed"
            value={status?.unprocessed?.toLocaleString()}
            highlight={status?.unprocessed > 0}
            sub="not yet run through pipeline"
          />
          <StatTile
            label="Last 7 days"
            value={status?.last_7_days?.toLocaleString()}
            sub="recently ingested"
          />
        </div>
      </div>

      {/* Sync action */}
      <Card className="max-w-md">
        <CardContent className="pt-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            Syncing loads all transcripts from Redshift into Weaviate. Existing records are updated. The raw_text field is vectorized for conversation-level semantic search.
          </p>
          <Button onClick={runSync} disabled={syncing || loading} className="w-full">
            {syncing ? (
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Syncing…
              </span>
            ) : 'Sync transcripts to Weaviate'}
          </Button>
          {result && (
            <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
              ✓ Sync complete — {result.synced ?? result.transcripts_synced ?? 0} records synced
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
