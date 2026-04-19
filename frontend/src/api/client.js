async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  return res.json()
}

function qs(params) {
  const p = Object.fromEntries(
    Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
  )
  const s = new URLSearchParams(p).toString()
  return s ? `?${s}` : ''
}

export const api = {
  status: {
    overview: () => request('/status/overview'),
  },
  pipeline: {
    extract: (limit) =>
      request('/pipeline/extract', {
        method: 'POST',
        body: JSON.stringify({ limit }),
      }),
    unprocessedCount: (params) => request(`/pipeline/unprocessed-count${qs(params)}`),
    log: (lines) => request(`/pipeline/log${qs({ lines })}`),
  },
  transcripts: {
    list: (params) => request(`/transcripts${qs(params)}`),
    get: (id) => request(`/transcripts/${id}`),
  },
  issues: {
    list: (params) => request(`/issues${qs(params)}`),
    get: (id) => request(`/issues/${id}`),
    reprocess: (issue_ids) =>
      request('/issues/reprocess', {
        method: 'POST',
        body: JSON.stringify({ issue_ids }),
      }),
    reprocessLogs: (params) => request(`/issues/reprocess-logs${qs(params)}`),
  },
  logs: {
    list: (params) => request(`/logs${qs(params)}`),
    get: (id) => request(`/logs/${id}`),
    models: () => request('/logs/models'),
  },
  classificationLogs: {
    list: (params) => request(`/classification-logs${qs(params)}`),
    get: (id) => request(`/classification-logs/${id}`),
  },
  taxonomy: {
    tree: () => request('/taxonomy/tree'),
    topics: (params) => request(`/taxonomy/topics${qs(params)}`),
    topic: (id) => request(`/taxonomy/topics/${id}`),
    subtopic: (id) => request(`/taxonomy/subtopics/${id}`),
    subtopicIssues: (id, params) => request(`/taxonomy/subtopics/${id}/issues${qs(params)}`),
    updateSubtopic: (id, body) => request(`/taxonomy/subtopics/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    lookupTopic: (name) => request(`/taxonomy/topics/lookup${qs({ name })}`),
    uncategorized: (params) => request(`/taxonomy/uncategorized${qs(params)}`),
  },
  candidates: {
    list: (params) => request(`/candidates${qs(params)}`),
    get: (id) => request(`/candidates/${id}`),
    approve: (id, body) => request(`/candidates/${id}/approve`, { method: 'POST', body: JSON.stringify(body || {}) }),
    reject: (id) => request(`/candidates/${id}/reject`, { method: 'POST' }),
    merge: (id, type, target_id) => request(`/candidates/${id}/merge`, { method: 'POST', body: JSON.stringify({ type, target_id }) }),
  },
  subtopicSearch: (q) => request(`/taxonomy/subtopics/search${qs({ q })}`),
  maintenance: {
    centroids: (body) => request('/maintenance/centroids', { method: 'POST', body: JSON.stringify(body || {}) }),
    duplicates: () => request('/maintenance/duplicates', { method: 'POST' }),
  },
  weaviate: {
    migrateSubtopicStatus: () => request('/weaviate/migrate/subtopic-status', { method: 'POST' }),
    setup: () => request('/weaviate/setup', { method: 'POST' }),
    collectionsStatus: () => request('/weaviate/collections/status'),
    issuesStatus: () => request('/weaviate/issues/status'),
    transcriptsStatus: () => request('/weaviate/transcripts/status'),
    syncIssues: () => request('/weaviate/sync/issues', { method: 'POST' }),
    syncTranscripts: () => request('/weaviate/sync/transcripts', { method: 'POST' }),
  },
}
