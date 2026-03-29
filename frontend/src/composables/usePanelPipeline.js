import { usePanelsStore } from '../stores/panels.js'
import { useConfigStore } from '../stores/config.js'
import {
  fetchSnapshotBySs,
  runPipeline,
  subscribePipelineEvents
} from '../api/index.js'
import { setSnapshotRecords } from '../utils/entityHelpers.js'
import { sleep } from '../utils/sleep.js'

/**
 * Composable for running a pipeline on a single comparison panel.
 * Each panel is independent — it gets its own SSE stream and updates
 * only its own panel data.
 */
export function usePanelPipeline() {
  const panelsStore = usePanelsStore()
  const configStore = useConfigStore()

  /**
   * Run (or load cached) pipeline for a specific panel.
   */
  async function runForPanel(panelId, paramSs, paramModel = null) {
    const panel = panelsStore.getPanelById(panelId)
    if (!panel) return

    const dataset = configStore.activeDataset
    if (!dataset) {
      panelsStore.updatePanelStatus(panelId, 'error', { loadingMessage: 'No dataset selected' })
      return
    }

    // 1. Try cached snapshot first
    try {
      const snapshot = await fetchSnapshotBySs(dataset, paramSs)
      if (snapshot) {
        setSnapshotRecords(snapshot.records)
        const replaced = panelsStore.replacePanelWithSnapshot(panelId, snapshot, paramSs)
        if (replaced) await animateLevel1And2(replaced)
        return
      }
    } catch (e) { /* no cache, continue */ }

    // 2. No cache — run real pipeline
    panelsStore.updatePanelStatus(panelId, 'running', { loadingMessage: 'Starting pipeline...' })

    try {
      const reqBody = configStore.buildPipelineRequest()
      reqBody.dataset_name = dataset
      reqBody.chunk_size = paramSs  // backend param name for S_s
      if (paramModel) reqBody.model = paramModel

      const { task_id } = await runPipeline(reqBody)
      panelsStore.updatePanelStatus(panelId, 'running', {
        loadingMessage: `Task ${task_id} started...`
      })

      let completedBlocks = 0
      let totalBlocks = 0

      // Subscribe to SSE — Level 0 animates in real-time
      await new Promise((resolve, reject) => {
        const es = subscribePipelineEvents(task_id, (ev) => {
          // If panel was deleted while running, close stream
          if (!panelsStore.getPanelById(panelId)) {
            es.close()
            resolve()
            return
          }

          const livePanel = panelsStore.getPanelById(panelId)
          const stage = ev.stage || ''
          const msg = ev.message || ''
          const data = ev.data || {}

          if (ev.type === 'progress') {
            panelsStore.updatePanelStatus(panelId, 'running', {
              loadingMessage: `${stage}: ${msg}`
            })

          } else if (ev.type === 'pipeline_blocks') {
            const blocksData = data.blocks || []
            totalBlocks = blocksData.length

            const blocks = blocksData.map(b => ({
              block_id: b.block_id,
              record_ids: b.record_ids,
              clusters: [b.record_ids],
              num_records: b.num_records,
              num_clusters: 1
            }))

            // Update panel hierarchy in-place
            if (livePanel) {
              const sets = blocks.map(b => ({
                id: `Block ${b.block_id}`,
                records: b.record_ids
              }))
              const results = blocks.map(b => ({ clusters: b.clusters }))
              livePanel.hierarchyData = {
                0: { sets, results },
                1: { sets: [], description: '' },
                2: { sets: [], description: '' }
              }
              // Show all blocks
              livePanel.inputSetsVisible = []
              for (let i = 0; i < blocks.length; i++) {
                livePanel.inputSetsVisible.push(i)
              }
            }

            panelsStore.updatePanelStatus(panelId, 'running', {
              loadingMessage: `Blocking: ${blocks.length} blocks`
            })

          } else if (ev.type === 'separate_result' && stage === 'separation') {
            const ctx = data.context || ''
            const match = ctx.match(/block_(\d+)/)
            if (match && livePanel) {
              const blockIdx = parseInt(match[1])
              const rawClusters = data.clusters || []

              if (rawClusters.length > 0) {
                const clusters = rawClusters.map(c => c.map(id => `r${id}`))
                const results = livePanel.hierarchyData[0].results
                if (blockIdx < results.length) {
                  results[blockIdx] = { clusters }
                }
              }

              if (!livePanel.inputSetsColored.includes(blockIdx)) {
                livePanel.inputSetsColored.push(blockIdx)
              }
              if (!livePanel.resultSetsVisible.includes(blockIdx)) {
                livePanel.resultSetsVisible.push(blockIdx)
              }

              completedBlocks++
              panelsStore.updatePanelStatus(panelId, 'running', {
                loadingMessage: `Separation: ${completedBlocks}/${totalBlocks} blocks`
              })
            }

          } else if (ev.type === 'result') {
            es.close()
            resolve()

          } else if (ev.type === 'error') {
            panelsStore.updatePanelStatus(panelId, 'error', {
              loadingMessage: msg || 'Pipeline failed'
            })
            es.close()
            reject(new Error(msg))
          }
        })
      })

      // 3. Pipeline SSE done — load snapshot for Level 1/2 animation
      panelsStore.updatePanelStatus(panelId, 'running', {
        loadingMessage: 'Loading results...'
      })

      try {
        const snapshot = await fetchSnapshotBySs(dataset, paramSs)
        if (snapshot) {
          setSnapshotRecords(snapshot.records)
          const replaced = panelsStore.replacePanelWithSnapshot(panelId, snapshot, paramSs)
          if (replaced) {
            // Mark Level 0 as instantly complete (already animated via SSE)
            const numBlocks = replaced.hierarchyData[0].sets.length
            for (let i = 0; i < numBlocks; i++) {
              replaced.inputSetsVisible.push(i)
              replaced.inputSetsColored.push(i)
              replaced.resultSetsVisible.push(i)
            }
            replaced.processingSetIdx = -1
            replaced.level0Processing = false
            replaced.status = 'running'
            replaced.loadingMessage = 'Level 1: Merging clusters...'

            // Animate Level 1 & 2
            await animateLevel1And2(replaced)
          }
          return
        }
      } catch (e) { /* fall through */ }

      // If no snapshot saved with matching S_s, mark as loaded (best effort)
      panelsStore.updatePanelStatus(panelId, 'loaded', { loadingMessage: '' })

    } catch (e) {
      // Only set error if panel still exists
      if (panelsStore.getPanelById(panelId)) {
        panelsStore.updatePanelStatus(panelId, 'error', {
          loadingMessage: e.message || 'Pipeline failed'
        })
      }
    }
  }

  /**
   * Animate Level 1 (CMR merge) and Level 2 (final entities) progressively,
   * matching the same flow as useSimulation.js.
   */
  async function animateLevel1And2(panel) {
    if (!panel) return

    // Ensure Level 0 is complete
    const numBlocks = panel.hierarchyData?.[0]?.sets?.length || 0
    for (let i = 0; i < numBlocks; i++) {
      if (!panel.inputSetsVisible.includes(i)) panel.inputSetsVisible.push(i)
      if (!panel.inputSetsColored.includes(i)) panel.inputSetsColored.push(i)
      if (!panel.resultSetsVisible.includes(i)) panel.resultSetsVisible.push(i)
    }
    panel.processingSetIdx = -1
    panel.level0Processing = false
    await sleep(200)

    // --- Level 1: CMR Merge ---
    panel.level1Processing = true
    panel.level1ClustersVisible = true
    panel.status = 'running'

    if (panel.cmrSkipped) {
      panel.loadingMessage = 'CMR Merge: Skipped'
      await sleep(400)
    } else {
      const mergeGroups = panel.snapshotMergeGroups || []
      panel.loadingMessage = 'Level 1: Selecting similar clusters...'
      await sleep(200)

      for (let gIdx = 0; gIdx < mergeGroups.length; gIdx++) {
        // Check panel still exists
        if (!panelsStore.getPanelById(panel.id)) return
        const group = mergeGroups[gIdx]

        panel.processingSetIdx = gIdx
        const cids = group.clusterIds || []
        panel.loadingMessage = group.isMerge
          ? `Level 1: Merging ${cids.join(' + ')}`
          : `Level 1: ${cids[0] || 'Merge ' + (gIdx+1)}`
        await sleep(group.isMerge ? 150 : 60)

        for (const cIdx of group.clusterIndices) {
          if (!panel.level1ClustersColored.includes(cIdx)) {
            panel.level1ClustersColored.push(cIdx)
          }
          await sleep(40)
        }

        // Show merged entity for this group immediately
        panel.level1MergeResultsVisible.push(gIdx)

        panel.processingSetIdx = -1
        await sleep(group.isMerge ? 100 : 40)
      }
      await sleep(150)

      panel.loadingMessage = `CMR: ${panel.preMergeClusters} clusters → ${panel.snapshotEntities?.length || 0} entities`
      await sleep(400)
    }

    panel.level1Processing = false
    await sleep(150)

    // --- Level 2: Final Entity Resolution ---
    panel.level2Processing = true
    panel.loadingMessage = 'Final Entity Resolution...'
    await sleep(250)

    panel.level2ResultsVisible = true
    panel.level2Processing = false

    // Done — extract metrics
    const stats = (panel.panelMetrics) || {}
    panel.loadingMessage = ''
    panel.status = 'loaded'
  }

  /**
   * Instantly mark all levels as complete (no animation).
   */
  function instantCompletePanel(panel) {
    if (!panel) return
    const numBlocks = panel.hierarchyData?.[0]?.sets?.length || 0
    for (let i = 0; i < numBlocks; i++) {
      if (!panel.inputSetsVisible.includes(i)) panel.inputSetsVisible.push(i)
      if (!panel.inputSetsColored.includes(i)) panel.inputSetsColored.push(i)
      if (!panel.resultSetsVisible.includes(i)) panel.resultSetsVisible.push(i)
    }
    panel.processingSetIdx = -1
    panel.level0Processing = false
    panel.level1Processing = false
    panel.level1ClustersVisible = true
    const groups = panel.snapshotMergeGroups || []
    for (const group of groups) {
      for (const cIdx of group.clusterIndices) {
        if (!panel.level1ClustersColored.includes(cIdx)) {
          panel.level1ClustersColored.push(cIdx)
        }
      }
    }
    panel.level1MergeResultsVisible = groups.map((_, i) => i)
    panel.level2Processing = false
    panel.level2ResultsVisible = true
    panel.status = 'loaded'
  }

  return { runForPanel, instantCompletePanel }
}
