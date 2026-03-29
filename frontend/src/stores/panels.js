import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { rawRecords } from '../data/records.js'
import { getEntityFromRecord } from '../utils/entityHelpers.js'

let panelIdCounter = 0

/**
 * Build NRS sets from snapshot blocks.
 * Uses real NRS sets (block.nrs_sets) captured from the pipeline event log
 * when available; falls back to sequential chunking by paramSs otherwise.
 * Labels: "Set A"–"Set Z" if total ≤26 sets, else "Set 1", "Set 2", ...
 */
function buildNrsSets(blocks, paramSs, records) {
  const ss = paramSs || 9
  const sets = []
  const results = []
  for (const block of blocks) {
    // Build record → NRS-stage cluster index from block.clusters
    // (separation result, independent of CMR)
    const ridToCluster = {}
    const blockClusters = block.clusters || []
    blockClusters.forEach((cluster, cIdx) => {
      cluster.forEach(rid => { ridToCluster[rid] = cIdx })
    })

    // Prefer real NRS sets from pipeline; fall back to sequential chunking.
    // NRS sets may be incomplete (only first round recorded) — append remaining
    // records as extra chunks so every record appears in at least one set.
    const hasRealSets = block.nrs_sets && block.nrs_sets.length > 0
    let chunks
    if (hasRealSets) {
      const covered = new Set(block.nrs_sets.flat())
      const remaining = block.record_ids.filter(rid => !covered.has(rid))
      chunks = [...block.nrs_sets, ...chunkArray(remaining, ss)]
    } else {
      chunks = chunkArray(block.record_ids, ss)
    }
    for (const setRecords of chunks) {
      sets.push({ id: null, records: setRecords })
      // Group by NRS separation cluster (not final entity, so CMR doesn't affect Level 0)
      const clusterGroups = {}
      setRecords.forEach(rid => {
        const cIdx = ridToCluster[rid]
        if (cIdx == null) return
        if (!clusterGroups[cIdx]) clusterGroups[cIdx] = []
        clusterGroups[cIdx].push(rid)
      })
      results.push({ clusters: Object.values(clusterGroups) })
    }
  }
  // Assign labels based on total count
  const n = sets.length
  for (let i = 0; i < n; i++) {
    sets[i].id = n <= 26
      ? `Set ${String.fromCharCode(65 + i)}`
      : `Set ${i + 1}`
  }

  // Assign global cluster IDs (C1, C2, C3...) and build rid → clusterId map
  let globalCid = 1
  const ridToGlobalCluster = {}
  const clusterLabels = []  // clusterLabels[setIdx] = ['C1', 'C3', ...]
  for (let si = 0; si < results.length; si++) {
    const labels = []
    for (let ci = 0; ci < results[si].clusters.length; ci++) {
      const label = `C${globalCid}`
      labels.push(label)
      results[si].clusters[ci].forEach(rid => { ridToGlobalCluster[rid] = label })
      globalCid++
    }
    clusterLabels.push(labels)
  }

  return { sets, results, clusterLabels, ridToGlobalCluster }
}

/** Split an array into chunks of at most `size` elements. */
function chunkArray(arr, size) {
  const chunks = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

export const usePanelsStore = defineStore('panels', () => {
  const panels = ref([])

  const isSingle = computed(() => panels.value.length === 1)

  function generateHierarchyData(setSize) {
    const allRecordIds = rawRecords.map(r => r.id)
    const sets = []
    const results = []
    const numSets = Math.ceil(allRecordIds.length / setSize)

    for (let i = 0; i < numSets; i++) {
      const startIdx = i * setSize
      const endIdx = Math.min(startIdx + setSize, allRecordIds.length)
      const setRecords = allRecordIds.slice(startIdx, endIdx)

      sets.push({
        id: `Set ${String.fromCharCode(65 + i)}`,
        records: setRecords
      })

      const clusters = {}
      setRecords.forEach(rId => {
        const record = rawRecords.find(r => r.id === rId)
        if (record) {
          if (!clusters[record.entity]) clusters[record.entity] = []
          clusters[record.entity].push(rId)
        }
      })

      results.push({ clusters: Object.values(clusters) })
    }

    const mergeSets = []
    const maxClusters = Math.min(5, Math.ceil(numSets * 1.5))

    for (let clusterIdx = 0; clusterIdx < maxClusters; clusterIdx++) {
      const records = []
      for (let setIdx = 0; setIdx < Math.min(numSets, 4); setIdx++) {
        records.push(`${String.fromCharCode(65 + setIdx)}${clusterIdx + 1}`)
      }
      mergeSets.push({
        id: `Merge Set ${clusterIdx + 1}`,
        records,
        sources: records.map(r => `Set ${r[0]}`)
      })
    }

    return {
      0: { sets, results },
      1: {
        sets: mergeSets,
        description: 'Hierarchical merging of Level 0 clusters'
      },
      2: {
        sets: [{ id: 'Final', records: ['Entity 1', 'Entity 2', 'Entity 3'] }],
        description: 'Final ER Result - 3 Resolved Entities'
      }
    }
  }

  function addPanel(setSize = 9) {
    const id = panelIdCounter++
    const panel = {
      id,
      setSize,
      hierarchyData: generateHierarchyData(setSize),
      // Animation state per panel
      inputSetsVisible: [],      // which input sets are visible
      inputSetsColored: [],      // which input sets have entity colors
      resultSetsVisible: [],     // which level0 result sets are visible
      level0Processing: false,
      level1Processing: false,
      level2Processing: false,
      processingSetIdx: -1,      // current set being processed
      level1ClustersVisible: false,
      level1ClustersColored: [],
      level1MergeResultsVisible: [],
      level2ResultsVisible: false,
      trackedSetIdx: null
    }
    panels.value.push(panel)
    return panels.value[panels.value.length - 1]
  }

  function addSnapshotPanel(snapshot) {
    const id = panelIdCounter++
    const allBlocks = snapshot.blocks
    const stats = snapshot.stats || {}
    const ss = stats.param_ss || stats.chunk_size || 9
    const { sets, results, clusterLabels, ridToGlobalCluster } = buildNrsSets(allBlocks, ss, snapshot.records)

    // Build final entities from snapshot clusters
    const entityMap = {}
    for (const block of allBlocks) {
      block.clusters.forEach(cluster => {
        const rec = snapshot.records[cluster[0]]
        const eid = rec ? rec.entity : null
        if (eid == null) return
        if (!entityMap[eid]) entityMap[eid] = { entity: eid, records: [] }
        entityMap[eid].records.push(...cluster)
      })
    }
    const snapshotEntities = Object.values(entityMap).map((e, idx) => ({
      idx,
      entity: e.entity,
      records: e.records,
      count: e.records.length,
      colorIdx: (idx % 8) + 1
    }))

    // Extract merge operations from snapshot events
    const snapshotMergeOps = (snapshot.events || [])
      .filter(ev => ev.action === 'llm_call' && ev.type === 'merge')
      .map(ev => ({
        title: ev.title,
        response: ev.response || ''
      }))

    // Count pre-merge clusters
    const preMergeClusters = allBlocks.reduce((sum, b) => sum + b.clusters.length, 0)

    // Build merge groups using global cluster IDs (C1, C2, ...) from buildNrsSets
    // Each record maps to exactly one global cluster, so no duplicates across groups
    const snapshotMergeGroups = snapshotEntities.map((entity, gIdx) => {
      const cids = new Set()
      const setIdxSet = new Set()
      entity.records.forEach(rid => {
        const cid = ridToGlobalCluster[rid]
        if (cid) cids.add(cid)
      })
      // Find which sets these clusters belong to
      for (let si = 0; si < clusterLabels.length; si++) {
        for (const label of clusterLabels[si]) {
          if (cids.has(label)) { setIdxSet.add(si); break }
        }
      }
      const sortedCids = [...cids].sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)))
      return {
        idx: gIdx,
        clusterIds: sortedCids,
        clusterIndices: [...setIdxSet].sort((a, b) => a - b),
        colorIdx: entity.colorIdx,
        isMerge: sortedCids.length > 1
      }
    })

    const panel = {
      id,
      setSize: 0,
      isSnapshot: true,
      paramSs: stats.param_ss || stats.chunk_size || null,
      paramModel: stats.model || null,
      status: 'loaded',
      panelMetrics: {
        acc: stats.acc,
        ari: stats.ari,
        f1: stats.f1,
        time: stats.time_seconds,
        tokens: stats.total_tokens,
        calls: stats.total_llm_calls,
        pred_entities: stats.pred_entities,
      },
      cmrSkipped: !!stats.cmr_skipped,
      cmrReason: stats.cmr_reason || '',
      recordsMap: snapshot.records || {},
      snapshotEntities,
      snapshotMergeOps,
      snapshotMergeGroups,
      preMergeClusters,
      hierarchyData: {
        0: { sets, results, clusterLabels },
        1: { sets: [], description: stats.cmr_skipped ? 'CMR Skipped' : 'Merge' },
        2: { sets: [], description: 'Final Entity Resolution' }
      },
      inputSetsVisible: [],
      inputSetsColored: [],
      resultSetsVisible: [],
      level0Processing: false,
      level1Processing: false,
      level2Processing: false,
      processingSetIdx: -1,
      level1ClustersVisible: false,
      level1ClustersColored: [],
      level1MergeResultsVisible: [],
      level2ResultsVisible: false,
      trackedSetIdx: null
    }
    panels.value.push(panel)
    // Return the reactive proxy, not the plain object
    return panels.value[panels.value.length - 1]
  }

  function addEmptyPanel(paramSs, paramModel = null, extraParams = {}) {
    const id = panelIdCounter++
    const panel = {
      id,
      setSize: 0,
      isSnapshot: true,
      paramSs,
      paramModel,
      paramSd: extraParams.paramSd || null,
      paramSv: extraParams.paramSv || null,
      mdgRetryTimes: extraParams.mdgRetryTimes || null,
      status: 'empty',
      panelMetrics: null,
      loadingMessage: '',
      cmrSkipped: false,
      cmrReason: '',
      snapshotEntities: [],
      snapshotMergeOps: [],
      snapshotMergeGroups: [],
      preMergeClusters: 0,
      hierarchyData: {
        0: { sets: [], results: [] },
        1: { sets: [], description: '' },
        2: { sets: [], description: '' }
      },
      inputSetsVisible: [],
      inputSetsColored: [],
      resultSetsVisible: [],
      level0Processing: false,
      level1Processing: false,
      level2Processing: false,
      processingSetIdx: -1,
      level1ClustersVisible: false,
      level1ClustersColored: [],
      level1MergeResultsVisible: [],
      level2ResultsVisible: false,
      trackedSetIdx: null
    }
    panels.value.push(panel)
    return panels.value[panels.value.length - 1]
  }

  function replacePanelWithSnapshot(panelId, snapshot, paramSs) {
    const idx = panels.value.findIndex(p => p.id === panelId)
    if (idx === -1) return null

    // Build the same data as addSnapshotPanel but keep the same id & array position
    const allBlocks = snapshot.blocks
    const statsR = snapshot.stats || {}
    const ss = paramSs ?? statsR.param_ss ?? statsR.chunk_size ?? 9
    const { sets, results, clusterLabels, ridToGlobalCluster } = buildNrsSets(allBlocks, ss, snapshot.records)

    const entityMap = {}
    for (const block of allBlocks) {
      block.clusters.forEach(cluster => {
        const rec = snapshot.records[cluster[0]]
        const eid = rec ? rec.entity : null
        if (eid == null) return
        if (!entityMap[eid]) entityMap[eid] = { entity: eid, records: [] }
        entityMap[eid].records.push(...cluster)
      })
    }
    const snapshotEntities = Object.values(entityMap).map((e, i) => ({
      idx: i,
      entity: e.entity,
      records: e.records,
      count: e.records.length,
      colorIdx: (i % 8) + 1
    }))

    const snapshotMergeOps = (snapshot.events || [])
      .filter(ev => ev.action === 'llm_call' && ev.type === 'merge')
      .map(ev => ({ title: ev.title, response: ev.response || '' }))

    const preMergeClusters = allBlocks.reduce((sum, b) => sum + b.clusters.length, 0)

    const snapshotMergeGroups = snapshotEntities.map((entity, gIdx) => {
      const cids = new Set()
      const setIdxSet = new Set()
      entity.records.forEach(rid => {
        const cid = ridToGlobalCluster[rid]
        if (cid) cids.add(cid)
      })
      for (let si = 0; si < clusterLabels.length; si++) {
        for (const label of clusterLabels[si]) {
          if (cids.has(label)) { setIdxSet.add(si); break }
        }
      }
      const sortedCids = [...cids].sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)))
      return {
        idx: gIdx,
        clusterIds: sortedCids,
        clusterIndices: [...setIdxSet].sort((a, b) => a - b),
        colorIdx: entity.colorIdx,
        isMerge: sortedCids.length > 1
      }
    })

    const replacement = {
      id: panelId,
      setSize: 0,
      isSnapshot: true,
      paramSs: paramSs ?? statsR.param_ss ?? statsR.chunk_size ?? null,
      paramModel: statsR.model || null,
      status: 'loaded',
      panelMetrics: {
        acc: statsR.acc,
        ari: statsR.ari,
        f1: statsR.f1,
        time: statsR.time_seconds,
        tokens: statsR.total_tokens,
        calls: statsR.total_llm_calls,
        pred_entities: statsR.pred_entities,
      },
      cmrSkipped: !!statsR.cmr_skipped,
      cmrReason: statsR.cmr_reason || '',
      recordsMap: snapshot.records || {},
      snapshotEntities,
      snapshotMergeOps,
      snapshotMergeGroups,
      preMergeClusters,
      hierarchyData: {
        0: { sets, results, clusterLabels },
        1: { sets: [], description: statsR.cmr_skipped ? 'CMR Skipped' : 'Merge' },
        2: { sets: [], description: 'Final Entity Resolution' }
      },
      inputSetsVisible: [],
      inputSetsColored: [],
      resultSetsVisible: [],
      level0Processing: false,
      level1Processing: false,
      level2Processing: false,
      processingSetIdx: -1,
      level1ClustersVisible: false,
      level1ClustersColored: [],
      level1MergeResultsVisible: [],
      level2ResultsVisible: false,
      trackedSetIdx: null
    }
    panels.value.splice(idx, 1, replacement)
    return panels.value[idx]
  }

  function updatePanelStatus(panelId, status, extra) {
    const panel = panels.value.find(p => p.id === panelId)
    if (!panel) return
    panel.status = status
    if (extra) {
      Object.keys(extra).forEach(k => { panel[k] = extra[k] })
    }
  }

  function removePanel(panelId) {
    panels.value = panels.value.filter(p => p.id !== panelId)
  }

  function updatePanelSetSize(panelId, newSetSize) {
    const panel = panels.value.find(p => p.id === panelId)
    if (panel) {
      panel.setSize = newSetSize
      panel.hierarchyData = generateHierarchyData(newSetSize)
      resetPanelAnimState(panel)
    }
  }

  function resetPanelAnimState(panel) {
    panel.inputSetsVisible = []
    panel.inputSetsColored = []
    panel.resultSetsVisible = []
    panel.level0Processing = false
    panel.level1Processing = false
    panel.level2Processing = false
    panel.processingSetIdx = -1
    panel.level1ClustersVisible = false
    panel.level1ClustersColored = []
    panel.level1MergeResultsVisible = []
    panel.level2ResultsVisible = false
    panel.trackedSetIdx = null
  }

  function resetAllPanels() {
    panels.value.forEach(p => resetPanelAnimState(p))
  }

  function getPanelById(id) {
    return panels.value.find(p => p.id === id)
  }

  // Build Level 0 clustering results from panel's hierarchy data
  function buildLevel0ClusteringResults(panel) {
    const level0Data = panel.hierarchyData[0]
    const results = {}

    level0Data.sets.forEach((set, setIdx) => {
      const setName = set.id
      const clusterData = level0Data.results[setIdx]

      results[setName] = clusterData.clusters.map((clusterRecords, clusterIdx) => {
        const firstRecord = rawRecords.find(r => r.id === clusterRecords[0])
        const entity = firstRecord ? firstRecord.entity : 1

        return {
          id: `${String.fromCharCode(65 + setIdx)}${clusterIdx + 1}`,
          entity,
          records: clusterRecords
        }
      })
    })

    return results
  }

  // Generate Level 1 merge sets according to CMR algorithm
  function getLevel1MergeSetsData(panel, sd = 4) {
    const level0ClusteringResults = buildLevel0ClusteringResults(panel)
    const setNames = Object.keys(level0ClusteringResults)
    const maxClustersPerSet = Math.max(...setNames.map(s => level0ClusteringResults[s].length))
    const mergeSets = []

    for (let clusterIdx = 0; clusterIdx < maxClustersPerSet; clusterIdx++) {
      const clusters = []
      const sources = []

      for (let setIdx = 0; setIdx < setNames.length; setIdx++) {
        const setName = setNames[setIdx]
        const setClusters = level0ClusteringResults[setName]
        if (clusterIdx < setClusters.length) {
          clusters.push({ ...setClusters[clusterIdx], sourceSet: setName })
          sources.push(setName)
        }
      }

      if (clusters.length > 0) {
        mergeSets.push({
          id: `Merge Set ${clusterIdx + 1}`,
          clusters,
          sources
        })
      }
    }

    return mergeSets
  }

  // Get merge results: group clusters by entity within each merge set
  function getMergeResults(panel) {
    const mergeSets = getLevel1MergeSetsData(panel)
    const results = []

    mergeSets.forEach((mset, msetIdx) => {
      const entityGroups = {}
      mset.clusters.forEach(cluster => {
        const entity = cluster.entity
        if (!entityGroups[entity]) {
          entityGroups[entity] = {
            entity,
            name: `Entity ${entity}`,
            clusters: [],
            mergeSetId: msetIdx + 1
          }
        }
        entityGroups[entity].clusters.push(cluster.id)
      })
      Object.values(entityGroups).forEach(group => results.push(group))
    })

    return results.sort((a, b) => a.entity - b.entity)
  }

  function toggleTrackedSet(panelId, setIdx) {
    const panel = panels.value.find(p => p.id === panelId)
    if (!panel) return
    panel.trackedSetIdx = panel.trackedSetIdx === setIdx ? null : setIdx
  }

  // Build cluster ID → color mapping
  function getClusterColorMap(panel) {
    const mergeResults = getMergeResults(panel)
    const map = {}
    mergeResults.forEach((e, idx) => {
      const color = (idx % 8) + 1
      e.clusters.forEach(clusterId => { map[clusterId] = color })
    })
    return map
  }

  return {
    panels, isSingle,
    addPanel, addSnapshotPanel, addEmptyPanel,
    replacePanelWithSnapshot, updatePanelStatus,
    removePanel, updatePanelSetSize,
    resetPanelAnimState, resetAllPanels, getPanelById,
    generateHierarchyData, buildLevel0ClusteringResults,
    getLevel1MergeSetsData, getMergeResults, getClusterColorMap,
    toggleTrackedSet
  }
})
