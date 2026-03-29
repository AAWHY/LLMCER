import { useResultsStore } from '../stores/results.js'

export function useDownload() {
  function downloadResults() {
    const resultsStore = useResultsStore()
    const entities = resultsStore.erEntities

    if (!entities.length) return

    // Check if entities have detailed record data (snapshot mode)
    const hasDetails = entities[0]?.records?.length > 0

    let csv
    if (hasDetails) {
      // Detect columns dynamically from first record
      const sample = entities[0].records[0]
      const cols = Object.keys(sample).filter(k => k !== 'id')
      const header = ['Entity', 'Record ID', ...cols.map(c => c.charAt(0).toUpperCase() + c.slice(1))].join(',')
      csv = header + '\n'

      entities.forEach(entity => {
        entity.records.forEach(r => {
          const values = [
            `"${entity.name}"`,
            `"${r.id}"`,
            ...cols.map(c => `"${String(r[c] || '').replace(/"/g, '""')}"`)
          ]
          csv += values.join(',') + '\n'
        })
      })
    } else {
      // Fallback: basic format
      csv = 'Entity,Record Count,Sample Records\n'
      entities.forEach(entity => {
        const samples = (entity.samples || '').replace(/"/g, '""')
        csv += `"${entity.name}",${entity.count},"${samples}"\n`
      })
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'entity_resolution_result.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return { downloadResults }
}
