async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    try {
      const json = JSON.parse(text)
      throw new Error(json.detail || JSON.stringify(json) || res.statusText)
    } catch (parseErr) {
      if (parseErr instanceof SyntaxError) throw new Error(text || res.statusText)
      throw parseErr
    }
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
    reassign: (id, target_subtopic_id) => request(`/issues/${id}/reassign`, { method: 'POST', body: JSON.stringify({ target_subtopic_id }) }),
    bulkReassign: (issue_ids, target_subtopic_id) => request('/issues/bulk-reassign', { method: 'POST', body: JSON.stringify({ issue_ids, target_subtopic_id }) }),
  },
  logs: {
    list: (params) => request(`/logs${qs(params)}`),
    get: (id) => request(`/logs/${id}`),
    models: () => request('/logs/models'),
  },
  taxonomyLog: {
    list: (params) => request(`/taxonomy-log${qs(params)}`),
    get: (id) => request(`/taxonomy-log/${id}`),
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
    health: () => request('/taxonomy/health'),
    aiReview: (body) => request('/taxonomy/ai-review', { method: 'POST', body: JSON.stringify(body) }),
    aiReviews: (params) => request(`/taxonomy/ai-reviews${qs(params)}`),
    aiReviewIncomplete: () => request('/taxonomy/ai-reviews/incomplete'),
    aiReviewSession: (id) => request(`/taxonomy/ai-reviews/${id}`),
    aiReviewApply: (session_id, idx, run_centroid = true) =>
      request(`/taxonomy/ai-reviews/${session_id}/suggestions/${idx}/apply?run_centroid=${run_centroid}`, { method: 'POST' }),
    aiReviewSkip: (session_id, idx) =>
      request(`/taxonomy/ai-reviews/${session_id}/suggestions/${idx}/skip`, { method: 'POST' }),
    aiReviewDismiss: (session_id) =>
      request(`/taxonomy/ai-reviews/${session_id}/dismiss`, { method: 'POST' }),
    aiReviewRunCentroids: (session_id, suggestion_indices) =>
      request(`/taxonomy/ai-reviews/${session_id}/run-centroids`, {
        method: 'POST',
        body: JSON.stringify({ suggestion_indices: suggestion_indices || null }),
      }),
    lookupTopic: (name) => request(`/taxonomy/topics/lookup${qs({ name })}`),
    updateTopic: (id, body) => request(`/taxonomy/topics/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    mergeTopic: (id, target_topic_id) => request(`/taxonomy/topics/${id}/merge`, { method: 'POST', body: JSON.stringify({ target_topic_id }) }),
    deleteTopic: (id) => request(`/taxonomy/topics/${id}`, { method: 'DELETE' }),
    moveSubtopic: (id, target_topic_id) => request(`/taxonomy/subtopics/${id}/move`, { method: 'POST', body: JSON.stringify({ target_topic_id }) }),
    mergeSubtopic: (id, target_subtopic_id) => request(`/taxonomy/subtopics/${id}/merge`, { method: 'POST', body: JSON.stringify({ target_subtopic_id }) }),
    deleteSubtopic: (id) => request(`/taxonomy/subtopics/${id}`, { method: 'DELETE' }),
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
  config: {
    prompts: () => request('/config/prompts'),
    prompt: (id) => request(`/config/prompts/${id}`),
    updatePrompt: (id, system, user_template) =>
      request(`/config/prompts/${id}`, { method: 'PUT', body: JSON.stringify({ system, user_template }) }),
    resetPrompt: (id) => request(`/config/prompts/${id}/reset`, { method: 'DELETE' }),
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
