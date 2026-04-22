import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

// Shared stat tile used by Logs, ClassificationLogs, and WeaviateSetup.
// Accepts either `value` or `main` as the display value (both supported for backwards compat).
export function StatTile({ label, value, main, sub, highlight }) {
  const display = value ?? main
  return (
    <Card>
      <CardContent className="px-5 py-4">
        <div className="text-xs text-muted-foreground mb-1">{label}</div>
        <div className={`text-2xl font-bold tabular-nums ${highlight ? 'text-amber-600' : ''}`}>
          {display ?? <Skeleton className="h-7 w-16" />}
        </div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  )
}
