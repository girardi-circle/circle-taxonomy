import { useEffect, useState, useCallback } from 'react'
import { api } from '@/api/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ChevronDown, ChevronRight, RotateCcw, Save } from 'lucide-react'

function ModelBadge({ model }) {
  const isOpus = model?.includes('opus')
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
      isOpus ? 'bg-purple-100 text-purple-700 border-purple-200' : 'bg-blue-100 text-blue-700 border-blue-200'
    }`}>
      {model || '—'}
    </span>
  )
}

function PromptEditor({ prompt, onSaved, onReset }) {
  const [system, setSystem] = useState(prompt.system)
  const [userTemplate, setUserTemplate] = useState(prompt.user_template)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setSystem(prompt.system)
    setUserTemplate(prompt.user_template)
    setDirty(false)
  }, [prompt.id])

  async function handleSave() {
    setSaving(true)
    try {
      await api.config.updatePrompt(prompt.id, system, userTemplate)
      setDirty(false)
      onSaved()
    } catch (e) {
      alert(e.message)
    } finally { setSaving(false) }
  }

  async function handleReset() {
    if (!confirm('Reset to default? Any custom changes will be lost.')) return
    setResetting(true)
    try {
      await api.config.resetPrompt(prompt.id)
      onReset()
    } catch (e) {
      alert(e.message)
    } finally { setResetting(false) }
  }

  return (
    <div className="space-y-4 pt-2">
      {/* Meta */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
        <ModelBadge model={prompt.model} />
        {prompt.temperature !== null && <span>temp: {prompt.temperature}</span>}
        <span>max_tokens: {prompt.max_tokens}</span>
        {prompt.variables?.length > 0 && (
          <span>
            variables:{' '}
            {prompt.variables.map(v => (
              <code key={v} className="bg-muted rounded px-1 mx-0.5">{'{' + v + '}'}</code>
            ))}
          </span>
        )}
        {prompt.is_overridden && (
          <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 font-medium">
            Custom override active
          </span>
        )}
      </div>

      {/* System prompt */}
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">
          System prompt
        </label>
        <textarea
          value={system}
          onChange={e => { setSystem(e.target.value); setDirty(true) }}
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y"
        />
      </div>

      {/* User template */}
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">
          User prompt template
          <span className="ml-2 normal-case font-normal">
            — variables in <code className="bg-muted px-1 rounded">{'{curly braces}'}</code> are substituted at runtime
          </span>
        </label>
        <textarea
          value={userTemplate}
          onChange={e => { setUserTemplate(e.target.value); setDirty(true) }}
          rows={20}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? (
            <span className="flex items-center gap-1.5">
              <span className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Saving…
            </span>
          ) : (
            <span className="flex items-center gap-1.5"><Save className="h-3.5 w-3.5" /> Save changes</span>
          )}
        </Button>
        {prompt.is_overridden && (
          <Button size="sm" variant="outline" onClick={handleReset} disabled={resetting}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reset to default
          </Button>
        )}
        {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
      </div>
    </div>
  )
}

function PromptRow({ prompt, onUpdated }) {
  const [expanded, setExpanded] = useState(false)
  const [fresh, setFresh] = useState(prompt)

  async function handleSaved() {
    const updated = await api.config.prompt(prompt.id)
    setFresh(updated)
    onUpdated()
  }

  async function handleReset() {
    const updated = await api.config.prompt(prompt.id)
    setFresh(updated)
    onUpdated()
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <button
        className={`w-full flex items-center gap-4 px-5 py-4 text-left transition-colors ${expanded ? 'bg-muted/40 border-b border-border' : 'bg-card hover:bg-muted/20'}`}
        onClick={() => setExpanded(v => !v)}
      >
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-semibold">{fresh.name}</span>
            {fresh.is_overridden && (
              <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs font-medium">
                Custom
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{fresh.description}</p>
        </div>
        <ModelBadge model={fresh.model} />
      </button>

      {expanded && (
        <div className="px-5 pb-5">
          <PromptEditor prompt={fresh} onSaved={handleSaved} onReset={handleReset} />
        </div>
      )}
    </div>
  )
}

export default function Prompts() {
  const [prompts, setPrompts] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    api.config.prompts()
      .then(d => { setPrompts(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  useEffect(() => { load() }, [load])

  const customCount = prompts?.filter(p => p.is_overridden).length ?? 0

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Prompts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            View and edit the Claude prompts used across the pipeline. Changes take effect immediately on restart.
            {customCount > 0 && <span className="ml-1 text-amber-600">{customCount} custom override{customCount !== 1 ? 's' : ''} active.</span>}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>Refresh</Button>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3">{error}</div>}

      <div className="space-y-3">
        {loading
          ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
          : prompts?.map(p => <PromptRow key={p.id} prompt={p} onUpdated={load} />)
        }
      </div>

      <p className="text-xs text-muted-foreground">
        Overrides are saved to <code className="bg-muted px-1 rounded">shared/prompts/overrides.json</code>.
        This file is gitignored — add it to your repo if you want to version-control prompt customizations.
      </p>
    </div>
  )
}
