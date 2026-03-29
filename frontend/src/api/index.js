const BASE = '/api'

export async function fetchDatasets() {
  const res = await fetch(`${BASE}/datasets`)
  if (!res.ok) throw new Error(`Failed to fetch datasets: ${res.status}`)
  return res.json()
}

export async function fetchDatasetDetail(name, previewRows = 10) {
  const res = await fetch(`${BASE}/datasets/${encodeURIComponent(name)}?preview_rows=${previewRows}`)
  if (!res.ok) throw new Error(`Failed to fetch dataset detail: ${res.status}`)
  return res.json()
}

export async function fetchDatasetRecords(name, offset = 0, limit = 50) {
  const res = await fetch(
    `${BASE}/datasets/${encodeURIComponent(name)}/records?offset=${offset}&limit=${limit}`
  )
  if (!res.ok) throw new Error(`Failed to fetch records: ${res.status}`)
  return res.json()
}

export async function fetchGtEntityMap(name) {
  const res = await fetch(`${BASE}/datasets/${encodeURIComponent(name)}/gt-clusters`)
  if (!res.ok) return null  // 404 = no GT, not an error
  return res.json()
}

export async function fetchModels() {
  const res = await fetch(`${BASE}/models`)
  if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`)
  return res.json()
}

export async function fetchLogRuns() {
  const res = await fetch(`${BASE}/logs/runs`)
  if (!res.ok) throw new Error(`Failed to fetch log runs: ${res.status}`)
  return res.json()
}

export async function fetchReplayEvents(runName) {
  const res = await fetch(`${BASE}/logs/runs/${encodeURIComponent(runName)}/events`)
  if (!res.ok) throw new Error(`Failed to fetch replay events: ${res.status}`)
  return res.json()
}

export async function fetchSnapshot(runName) {
  const res = await fetch(`${BASE}/logs/runs/${encodeURIComponent(runName)}/snapshot`)
  if (!res.ok) throw new Error(`Failed to fetch snapshot: ${res.status}`)
  return res.json()
}

export async function fetchDatasetSnapshot(datasetName) {
  const res = await fetch(`${BASE}/logs/snapshot/${encodeURIComponent(datasetName)}`)
  if (!res.ok) return null  // 404 = no snapshot, not an error
  return res.json()
}

export async function fetchDatasetSnapshots(datasetName) {
  const res = await fetch(`${BASE}/logs/snapshots/${encodeURIComponent(datasetName)}`)
  if (!res.ok) throw new Error(`Failed to fetch snapshots: ${res.status}`)
  return res.json()
}

export async function fetchSnapshotBySs(datasetName, paramSs) {
  const res = await fetch(`${BASE}/logs/snapshot/${encodeURIComponent(datasetName)}/ss/${paramSs}`)
  if (!res.ok) return null  // 404 = no snapshot for this S_s
  return res.json()
}

export async function uploadDataset(name, dataFile, gtFile) {
  const form = new FormData()
  form.append('file', dataFile)
  if (gtFile) form.append('gt_file', gtFile)
  const res = await fetch(`${BASE}/datasets/upload?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    body: form
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Upload failed: ${res.status}`)
  }
  return res.json()
}

export async function runPipeline(params) {
  const res = await fetch(`${BASE}/pipeline/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })
  if (!res.ok) throw new Error(`Failed to start pipeline: ${res.status}`)
  return res.json()
}

export function subscribePipelineEvents(taskId, onEvent) {
  const es = new EventSource(`${BASE}/pipeline/${taskId}/events`)
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      onEvent(data)
    } catch { /* ignore parse errors */ }
  }
  es.onerror = () => es.close()
  return es
}

export async function submitMdgResponse(taskId, accepted) {
  const res = await fetch(`${BASE}/pipeline/${taskId}/mdg-response`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accepted })
  })
  if (!res.ok) throw new Error(`Failed to submit MDG response: ${res.status}`)
  return res.json()
}

export async function fetchPipelineResults(taskId) {
  const res = await fetch(`${BASE}/pipeline/${taskId}/results`)
  if (!res.ok) throw new Error(`Failed to fetch results: ${res.status}`)
  return res.json()
}
