import { usePanelsStore } from '../stores/panels.js'
import { useSimulationStore } from '../stores/simulation.js'
import { useLlmLogStore } from '../stores/llmLog.js'
import { useResultsStore } from '../stores/results.js'
import { useConfigStore } from '../stores/config.js'
import { rawRecords } from '../data/records.js'
import { metricsData } from '../data/metrics.js'
import { fetchDatasetSnapshot, fetchSnapshotBySs, runPipeline, subscribePipelineEvents, fetchPipelineResults } from '../api/index.js'
import { setSnapshotRecords, clearSnapshotRecords } from '../utils/entityHelpers.js'
import { sleep } from '../utils/sleep.js'

export function useSimulation() {
  const panelsStore = usePanelsStore()
  const simStore = useSimulationStore()
  const logStore = useLlmLogStore()
  const resultsStore = useResultsStore()
  const configStore = useConfigStore()

  const CMR_PRE_PROMPT = "Do the records in the following clusters refer to the same entity? i.e., given that the records in each cluster refer to the same entity, can these clusters or parts of these clusters be merged? If they all point to one entity, answer 'Yes' And returns a two-dimensional array, each dimension of the array is the cluster id, indicating which clusters can be clustered together, otherwise just answer 'No' with no reason.You only need to tell me yes or no!!!\n"

  /**
   * Build a realistic CMR prompt from a merge group's cluster data.
   * Picks one representative record per cluster (like pick_elements in the backend).
   */
  function buildCmrPrompt(group, panel) {
    const recordsMap = panel.recordsMap || {}
    const l0 = panel.hierarchyData?.[0]
    if (!l0) return ''
    const clusterLabels = l0.clusterLabels || []

    // Find records for each cluster ID in this group
    const repRecords = []
    for (const cid of (group.clusterIds || [])) {
      // Find which set/cluster this ID belongs to
      for (let si = 0; si < clusterLabels.length; si++) {
        const cidx = clusterLabels[si].indexOf(cid)
        if (cidx >= 0 && l0.results[si]?.clusters[cidx]?.length) {
          // Pick first record as representative
          const rid = l0.results[si].clusters[cidx][0]
          repRecords.push(rid)
          break
        }
      }
    }

    if (!repRecords.length) return ''

    // Build record lines
    const lines = repRecords.map(rid => {
      const rec = recordsMap[rid] || recordsMap[`r${rid}`]
      if (!rec) return `Record ${String(rid).replace('r','')}: (no data)`
      const parts = Object.entries(rec)
        .filter(([k]) => !['id','entity','combined_text','display'].includes(k))
        .map(([,v]) => v != null ? String(v) : 'nan')
      return `Record ${String(rid).replace('r','')}: ${parts.join(',')}`
    })

    return CMR_PRE_PROMPT + lines.join('\n')
  }

  // === LLM log helpers (mock demo) ===
  async function logLevel0Set(set, setIdx, result, panel) {
    const needsRetry = (setIdx === 1 || setIdx === 3)
    let attempt = 1
    const maxAttempts = needsRetry ? 2 : 1

    while (attempt <= maxAttempts) {
      const attemptLabel = maxAttempts > 1 ? ` (Attempt ${attempt})` : ''
      const clusters = result.clusters.map(c => c.map(r => parseInt(r.replace('r', ''))))
      const clusterText = `Result: ${JSON.stringify(clusters)}\n→ ${result.clusters.length} groups`
      const tokens = Math.floor(2000 + Math.random() * 400)

      logStore.createEntry(
        'nrs',
        `${set.id} Clustering${attemptLabel}`,
        `NRS: Creating record set (S_s=${set.records.length}, S_d=4)`,
        clusterText,
        tokens
      )
      logStore.addStats(tokens, logStore.totalCalls + 1, 0.0004)
      await sleep(250)

      // MDG Check
      const mdgTokens = Math.floor(800 + Math.random() * 200)
      if (needsRetry && attempt === 1) {
        const eid = logStore.createEntry(
          'mdg',
          `${set.id} MDG Check${attemptLabel}`,
          `Sampling record pairs for verification`,
          '✓ Transitivity: OK\n✗ Anti-transitivity: Violation detected!\n→ r15, r18 misclustered',
          mdgTokens
        )
        logStore.setMdgPassed(eid, false)
        logStore.addStats(mdgTokens, logStore.totalCalls + 1, 0.0002)
        await sleep(200)
        attempt++
      } else {
        const eid = logStore.createEntry(
          'mdg',
          `${set.id} MDG Check${attemptLabel}`,
          `Sampling record pairs for verification`,
          '✓ Transitivity: OK\n✓ Anti-transitivity: OK',
          mdgTokens
        )
        logStore.setMdgPassed(eid, true)
        logStore.addStats(mdgTokens, logStore.totalCalls + 1, 0.0002)
        break
      }
    }
  }

  async function logLevel1MergeSet(setIdx, panel) {
    const mergeSetsData = panelsStore.getLevel1MergeSetsData(panel)
    const mset = mergeSetsData[setIdx]
    if (!mset) return

    const clusterIds = mset.clusters.map(c => c.id).join(', ')
    const sourceInfo = mset.sources.join(', ')

    const entityGroups = {}
    mset.clusters.forEach(c => {
      if (!entityGroups[c.entity]) entityGroups[c.entity] = []
      entityGroups[c.entity].push(c.id)
    })
    const groupStrs = Object.values(entityGroups).map(g => `[${g.join(',')}]`).join(', ')
    const numEntities = Object.keys(entityGroups).length
    const tokens = 2500 + Math.floor(Math.random() * 500)

    logStore.createEntry(
      'cmr',
      `Merge Set ${setIdx + 1}`,
      `Input: [${clusterIds}]\nSources: ${sourceInfo}`,
      `LLM Output: ${groupStrs}\n(${numEntities} ${numEntities === 1 ? 'entity' : 'entities'} identified)`,
      tokens
    )
    logStore.addStats(tokens, logStore.totalCalls + 1, 0.0005)
  }

  // logLevel2Final removed — no longer creating completion log entries

  // === Snapshot-based simulation (real data) ===
  async function runSnapshotSimulation(snapshot, targetPanelId, targetSs) {
    setSnapshotRecords(snapshot.records)

    // Replace the target empty panel with snapshot data (keep other panels intact)
    const panel = panelsStore.replacePanelWithSnapshot(targetPanelId, snapshot, targetSs)
    if (!panel) {
      simStore.setRunning(false)
      return
    }
    panel.status = 'running'

    const events = snapshot.events || []
    const sets = panel.hierarchyData[0].sets
    const numSets = sets.length
    const costPerToken = 0.00000015

    // Build record → NRS set index mapping
    const recordToSetIdx = {}
    for (let i = 0; i < sets.length; i++) {
      for (const rid of sets[i].records) {
        recordToSetIdx[rid] = i
      }
    }
    // Build block name → affected NRS set indices mapping
    const blockToNrsSets = {}
    for (const block of snapshot.blocks) {
      const key = `block_${String(block.block_id).padStart(3, '0')}`
      const affected = new Set()
      for (const rid of block.record_ids) {
        if (recordToSetIdx[rid] !== undefined) affected.add(recordToSetIdx[rid])
      }
      blockToNrsSets[key] = [...affected].sort((a, b) => a - b)
    }

    // Adaptive speed — target ~30s total replay for event loop
    const totalEvents = events.length
    const targetReplayMs = 30000
    const baseDelay = totalEvents > 0 ? Math.max(1, Math.min(80, Math.floor(targetReplayMs / totalEvents))) : 80
    const eventDelay = baseDelay
    const mdgDelay = Math.max(1, Math.floor(baseDelay * 1.3))

    // Input sets are NOT pre-shown — they appear one by one when separation completes
    panel.level0Processing = true
    simStore.stepInfoHtml = `<strong>NRS:</strong> ${numSets} sets, ${snapshot.total_records} records`
    await sleep(300)

    // --- Replay events — drive center panel + right LLM log ---
    let currentBlock = ''
    let totalTokens = 0
    let totalCalls = 0

    for (let idx = 0; idx < events.length; idx++) {
      if (!simStore.isRunning) break
      simStore.progressPercent = Math.round((idx / events.length) * 60)
      const ev = events[idx]

      if (ev.action === 'info') {
        const isSepDone = ev.phase === 'separation' && ev.title.includes('separation done')
        const isBlocking = ev.title.includes('blocking done')

        if (isSepDone) {
          const blockKey = ev.block || currentBlock
          const affectedSets = blockToNrsSets[blockKey] || []

          for (const sIdx of affectedSets) {
            // Show input set
            if (!panel.inputSetsVisible.includes(sIdx)) panel.inputSetsVisible.push(sIdx)
            panel.processingSetIdx = sIdx
            await sleep(eventDelay)

            // Show result
            if (!panel.inputSetsColored.includes(sIdx)) panel.inputSetsColored.push(sIdx)
            if (!panel.resultSetsVisible.includes(sIdx)) panel.resultSetsVisible.push(sIdx)

            // Human MDG: pause for user review if MDG is OFF
            if (!configStore.mdgEnabled) {
              const l0 = panel.hierarchyData[0]
              const resultData = l0.results[sIdx]
              const clusters = resultData ? resultData.clusters : []
              const sliceIds = l0.sets[sIdx] ? l0.sets[sIdx].records : []
              simStore.stepInfoHtml = `<strong>MDG Manual Review:</strong> Set ${sIdx + 1} — Accept or Reject?`
              let accepted = false
              while (!accepted) {
                const setName = l0.sets[sIdx]?.id || `Set ${sIdx + 1}`
                accepted = await simStore.requestMdgReview(-2, { sliceIds, clusters, setIdx: sIdx, setName })
                if (!accepted) {
                  panel.resultSetsVisible = panel.resultSetsVisible.filter(i => i !== sIdx)
                  panel.inputSetsColored = panel.inputSetsColored.filter(i => i !== sIdx)
                  await sleep(300)
                  panel.inputSetsColored.push(sIdx)
                  panel.resultSetsVisible.push(sIdx)
                  await sleep(200)
                  simStore.stepInfoHtml = `<strong>MDG Manual Review:</strong> Set ${sIdx + 1} — Re-clustered. Accept or Reject?`
                }
              }
              if (configStore.mdgEnabled) continue  // Switched to Auto mid-way
            }
          }

          panel.processingSetIdx = -1
        }
        // No log entry for info events

      } else if (ev.action === 'block_start') {
        currentBlock = ev.block || ''
        simStore.stepInfoHtml = `<strong>Separation:</strong> ${ev.title} (${idx + 1}/${events.length})`

      } else if (ev.action === 'llm_call') {
        totalCalls++
        const tokens = ev.tokens || 0
        totalTokens += tokens

        const isMerge = ev.type === 'merge'
        const entryType = isMerge ? 'cmr' : 'nrs'
        const promptFull = ev.promptShort || ev.prompt || ''
        const promptSummary = ev.title || ''
        const resp = ev.response || ''

        logStore.createEntry(entryType, ev.title, promptFull, resp, tokens, promptSummary)
        logStore.addStats(tokens, totalCalls, tokens * costPerToken)
        await sleep(eventDelay)

      } else if (ev.action === 'mdg') {
        const passed = ev.passed !== false
        const detail = ev.detail || ''
        const outputText = passed
          ? `✓ Transitivity: OK\n✓ Anti-transitivity: OK\nClusters: ${detail}`
          : `✗ MDG violation detected\n${detail}`

        const eid = logStore.createEntry('mdg', ev.title, `MDG verification: ${detail}`, outputText, 0)
        logStore.setMdgPassed(eid, passed)
        await sleep(mdgDelay)

      } else if (ev.action === 'phase_start') {
        // Only update center panel step info, no log entry
        simStore.stepInfoHtml = `<strong>CMR Merge:</strong> ${ev.title}`
        await sleep(eventDelay)

      } else if (ev.action === 'merge_round') {
        const accepted = ev.accepted !== false
        const outputText = `Threshold: ${ev.threshold}\nYes: ${ev.yesCount}/${ev.total}\n→ ${accepted ? 'Accepted' : 'Rejected'}`
        logStore.createEntry('cmr', ev.title, ev.title, outputText, 0)
        await sleep(eventDelay)
      }
    }

    // --- Ensure all NRS sets visible (Level 0 complete) ---
    for (let i = 0; i < numSets; i++) {
      if (!panel.inputSetsColored.includes(i)) panel.inputSetsColored.push(i)
      if (!panel.resultSetsVisible.includes(i)) panel.resultSetsVisible.push(i)
    }
    panel.processingSetIdx = -1
    panel.level0Processing = false
    await sleep(200)

    // --- Level 1: CMR Merge phase ---
    const stats = snapshot.stats || {}
    panel.level1Processing = true
    panel.level1ClustersVisible = true

    // CMR merge animation — always shown (even when pipeline skipped CMR)
    const mergeGroups = panel.snapshotMergeGroups || []
    const numClusters = panel.preMergeClusters || 0
    simStore.stepInfoHtml = `<strong>Level 1 (CMR):</strong> Selecting similar clusters`
    await sleep(300)

    // Step 1: Process each merge group — highlight box → color clusters inside → unhighlight
    for (let gIdx = 0; gIdx < mergeGroups.length; gIdx++) {
      if (!simStore.isRunning) break
      simStore.progressPercent = 60 + Math.round((gIdx / mergeGroups.length) * 30)
      const group = mergeGroups[gIdx]

      // Highlight this group box
      panel.processingSetIdx = gIdx
      const cids = group.clusterIds || []
      simStore.stepInfoHtml = `<strong>Level 1 (CMR):</strong> ${group.isMerge ? 'LLM evaluating ' + cids.join(' + ') : cids[0] || 'Merge ' + (gIdx+1)}`
      await sleep(group.isMerge ? 200 : 80)

      // Create a CMR log entry with reconstructed prompt
      {
        const clusterList = cids.join(', ')
        const cmrPrompt = buildCmrPrompt(group, panel)
        if (group.isMerge) {
          logStore.createEntry(
            'cmr',
            `CMR eval: ${cids.join(' + ')}`,
            cmrPrompt,
            `Answer: yes → ${cids.length} clusters merged into Entity ${gIdx + 1}`,
            0,
            `Comparing clusters [${clusterList}]`
          )
        } else {
          logStore.createEntry(
            'cmr',
            `CMR eval: ${cids[0] || 'single'}`,
            cmrPrompt,
            `No merge needed → kept as Entity ${gIdx + 1}`,
            0,
            `Single cluster [${clusterList}]`
          )
        }
      }

      // Show merged entity, then color clusters
      panel.level1MergeResultsVisible.push(gIdx)
      for (const cIdx of group.clusterIndices) {
        if (!panel.level1ClustersColored.includes(cIdx)) panel.level1ClustersColored.push(cIdx)
      }

      // Unhighlight
      panel.processingSetIdx = -1
      await sleep(group.isMerge ? 150 : 60)
    }
    await sleep(200)

    simStore.stepInfoHtml = `<strong>CMR Merge:</strong> ${numClusters} clusters → ${panel.snapshotEntities?.length || 0} entities`
    await sleep(500)

    panel.level1Processing = false
    await sleep(200)

    // --- Level 2: Final Entity Resolution ---
    panel.level2Processing = true
    simStore.progressPercent = 95
    simStore.stepInfoHtml = '<strong>Final Entity Resolution</strong>'
    await sleep(300)

    panel.level2ResultsVisible = true
    panel.level2Processing = false
    simStore.progressPercent = 100

    const numEntities = panel.snapshotEntities?.length || 0

    // No completion log entry — just update center panel status

    // --- Build ER results for right panel list ---
    const entities = (panel.snapshotEntities || []).map((e, idx) => {
      // Build display text from snapshot records
      const sampleDisplays = e.records.slice(0, 3).map(rid => {
        const rec = snapshot.records[rid]
        return rec?.display || rid
      })
      const sampleText = sampleDisplays.join(' | ') + (e.records.length > 3 ? ` (+${e.records.length - 3})` : '')

      // Include full record details for dialog (dynamic fields per dataset)
      const recordDetails = e.records.map(rid => {
        const rec = snapshot.records[rid]
        if (!rec) return { id: rid }
        const { entity, display, ...fields } = rec
        return fields  // includes id + all data fields (author/title/... or name/phone/...)
      })

      return {
        name: `Entity ${idx + 1}`,
        count: e.count || e.records.length,
        samples: sampleText,
        records: recordDetails,
        colorIdx: e.colorIdx
      }
    })

    resultsStore.setErResults(entities, snapshot.total_records)
    resultsStore.highlightResults = true

    // --- Update metrics (use real evaluation data from snapshot stats) ---
    const tokensDisplay = totalTokens > 1000000
      ? `${(totalTokens / 1000000).toFixed(2)}M`
      : `${(totalTokens / 1000).toFixed(0)}K`
    resultsStore.setMetrics({
      acc: stats.acc != null ? Number(stats.acc).toFixed(2) : '--',
      nmi: stats.nmi != null ? Number(stats.nmi).toFixed(2) : '--',
      ari: stats.ari != null ? Number(stats.ari).toFixed(2) : '--',
      fp: stats.f1 != null ? Number(stats.f1).toFixed(2) : '--',
      time: stats.time_seconds != null ? stats.time_seconds : '--',
      calls: stats.total_llm_calls || totalCalls,
      cost: stats.cost_estimate ? `$${stats.cost_estimate}` : `$${(totalTokens * costPerToken).toFixed(4)}`,
      tokens: tokensDisplay
    })

    // Also set per-panel metrics for comparison view
    panel.panelMetrics = {
      acc: stats.acc,
      ari: stats.ari,
      f1: stats.f1,
      time: stats.time_seconds,
      tokens: stats.total_tokens || totalTokens,
      calls: stats.total_llm_calls || totalCalls,
      pred_entities: stats.pred_entities,
    }

    simStore.stepInfoHtml = `<strong>Done:</strong> ${snapshot.total_records} records → ${numEntities} entities | ${totalCalls} LLM calls, ${totalTokens} tokens`

    panel.status = 'loaded'
    await sleep(300)
    simStore.setRunning(false)
    clearSnapshotRecords()
  }

  // === Real pipeline execution via SSE ===
  async function runRealPipeline(datasetName, targetPanelId, targetSs, targetModel = null, extraParams = {}) {
    simStore.stepInfoHtml = '<strong>Pipeline:</strong> Starting real LLMCER pipeline...'

    const costPerToken = 0.00000015
    let livePanel = panelsStore.getPanelById(targetPanelId)
    let totalTokens = 0
    let totalCalls = 0
    let completedBlocks = 0
    let lastPrompt = ''  // capture prompt from llm_request for next llm_response
    let totalBlocks = 0
    let liveBlockToNrsSets = {}   // block_id → [NRS set indices]

    try {
      // Build request from config store, override chunk_size with target S_s
      const reqBody = configStore.buildPipelineRequest()
      if (datasetName) reqBody.dataset_name = datasetName
      reqBody.chunk_size = targetSs
      if (targetModel) reqBody.model = targetModel
      if (extraParams.paramSd) reqBody.param_sd = extraParams.paramSd
      if (extraParams.paramSv) reqBody.param_sv = extraParams.paramSv
      if (extraParams.mdgRetryTimes) reqBody.mdg_retry_times = extraParams.mdgRetryTimes

      // Start pipeline
      const { task_id } = await runPipeline(reqBody)
      simStore.stepInfoHtml = `<strong>Pipeline:</strong> Task ${task_id} started`

      // Subscribe to SSE events
      await new Promise((resolve, reject) => {
        const es = subscribePipelineEvents(task_id, (ev) => {
          if (!simStore.isRunning) { es.close(); resolve(); return }

          const stage = ev.stage || ''
          const msg = ev.message || ''
          const data = ev.data || {}

          // ── Progress milestones — no log entry, just update center panel ──
          if (ev.type === 'progress') {
            simStore.stepInfoHtml = `<strong>${stage}:</strong> ${msg}`
            // Update progress from backend progress field (0.0-1.0)
            if (data.progress != null) {
              simStore.progressPercent = Math.round(data.progress * 100)
            }

          // ── Capture prompt from llm_request for next llm_response ──
          } else if (ev.type === 'llm_request') {
            lastPrompt = data.prompt || ''

          // ── Center panel: build NRS sets from blocks ─────────
          } else if (ev.type === 'pipeline_blocks') {
            const blocksData = data.blocks || []
            totalBlocks = blocksData.length
            const ss = targetSs || 9

            // Partition each block's records into NRS sets of size ss (per-block)
            const nrsSets = []
            const nrsResults = []
            const recordToSetIdx = {}
            liveBlockToNrsSets = {}

            for (const b of blocksData) {
              const rids = b.record_ids
              const startSetIdx = nrsSets.length
              const numChunks = Math.ceil(rids.length / ss)
              const affectedIndices = []
              for (let c = 0; c < numChunks; c++) {
                const setRecords = rids.slice(c * ss, c * ss + ss)
                const setIdx = nrsSets.length
                nrsSets.push({ id: null, records: setRecords })
                nrsResults.push({ clusters: [setRecords] })  // initial: whole set = 1 cluster
                setRecords.forEach(rid => { recordToSetIdx[rid] = setIdx })
                affectedIndices.push(setIdx)
              }
              liveBlockToNrsSets[b.block_id] = affectedIndices
            }

            // Assign labels based on total count
            const numNrsSets = nrsSets.length
            for (let i = 0; i < numNrsSets; i++) {
              nrsSets[i].id = numNrsSets <= 26
                ? `Set ${String.fromCharCode(65 + i)}`
                : `Set ${i + 1}`
            }

            // Update target panel's hierarchy data in-place
            livePanel = panelsStore.getPanelById(targetPanelId)
            if (livePanel) {
              livePanel.hierarchyData = {
                0: { sets: nrsSets, results: nrsResults },
                1: { sets: [], description: '' },
                2: { sets: [], description: '' }
              }
              livePanel.paramSs = targetSs
              livePanel.status = 'running'

              // Show all NRS sets appearing at once
              for (let i = 0; i < numNrsSets; i++) {
                livePanel.inputSetsVisible.push(i)
              }
            }

            simStore.stepInfoHtml = `<strong>NRS:</strong> ${numNrsSets} sets, ${data.total_records} records`

          // ── Center panel: block separation done → color affected NRS sets
          } else if (ev.type === 'separate_result' && stage === 'separation') {
            const ctx = data.context || ''
            const match = ctx.match(/block_(\d+)/)
            if (match && livePanel) {
              const blockId = parseInt(match[1])
              const affectedSets = liveBlockToNrsSets[blockId] || []

              // Color all NRS sets that overlap with this block
              for (const sIdx of affectedSets) {
                if (!livePanel.inputSetsColored.includes(sIdx)) {
                  livePanel.inputSetsColored.push(sIdx)
                }
                if (!livePanel.resultSetsVisible.includes(sIdx)) {
                  livePanel.resultSetsVisible.push(sIdx)
                }
              }

              completedBlocks++
              simStore.stepInfoHtml = `<strong>Separation:</strong> ${completedBlocks}/${totalBlocks} blocks done`
            }

          // ── Right panel: LLM response log ─────────────────────
          } else if (ev.type === 'llm_response') {
            const tokens = data.tokens || 0
            totalTokens += tokens
            totalCalls++

            if (tokens) {
              logStore.addStats(tokens, totalCalls, tokens * costPerToken)
            }

            const isMerge = stage === 'cmr_merge'
            const entryType = isMerge ? 'cmr' : 'nrs'
            const title = msg || `LLM ${stage}`
            const resp = data.parsed_result || data.raw_response || ''
            const prompt = data.prompt || data.prompt_short || lastPrompt || ''
            lastPrompt = ''  // consumed
            logStore.createEntry(entryType, title, prompt, String(resp).slice(0, 300), tokens, title)

          // ── Human MDG review request — show ✓/✗ UI ──────────
          } else if (ev.type === 'mdg_review_request') {
            const sliceIds = data.slice_ids || []
            const clusters = data.clusters || []
            console.log('[MDG] Review request received:', sliceIds.length, 'records,', clusters.length, 'clusters')
            if (configStore.mdgEnabled) {
              // User switched MDG back to Auto mid-run — auto-accept
              import('../api/index.js').then(m => m.submitMdgResponse(task_id, true))
            } else {
              const ctx = data.context || ''
              const blockMatch = ctx.match(/block_(\d+)/)
              const blockIdx = blockMatch ? parseInt(blockMatch[1]) : null
              const setName = blockIdx != null ? `Block ${blockIdx}` : 'NRS'
              simStore.stepInfoHtml = `<strong>MDG Manual Review:</strong> ${setName} — ${sliceIds.length} records, ${clusters.length} clusters — Accept or Reject?`
              simStore.liveTaskId = task_id
              // Set state directly (SSE callback is sync, can't await Promise)
              simStore.mdgPendingSetIdx = -2
              simStore.mdgReviewData = { sliceIds, clusters, setName }
              simStore.mdgReviewCounter++
            }

          // ── Right panel: MDG check ────────────────────────────
          } else if (ev.type === 'mdg_check') {
            const passed = data.acceptable !== false
            const outputText = passed
              ? '✓ Transitivity: OK\n✓ Anti-transitivity: OK'
              : '✗ MDG violation detected'
            const eid = logStore.createEntry('mdg', `MDG: ${passed ? 'pass' : 'fail'}`, msg || 'MDG check', outputText, 0)
            logStore.setMdgPassed(eid, passed)

          // ── Right panel: merge round ──────────────────────────
          } else if (ev.type === 'merge_round') {
            const threshold = data.threshold || 0
            const accepted = data.accepted !== false
            const outputText = `Threshold: ${threshold}\nYes: ${data.yes_count}/${data.total}\n→ ${accepted ? 'Accepted' : 'Rejected'}`
            logStore.createEntry('cmr', msg || `Merge threshold=${threshold}`, msg, outputText, 0)

          // ── Pipeline completed — no log entry ──────────────────
          } else if (ev.type === 'result') {
            simStore.stepInfoHtml = `<strong>Done:</strong> ${msg}`
            es.close()
            resolve()

          // ── Error ─────────────────────────────────────────────
          } else if (ev.type === 'error') {
            simStore.stepInfoHtml = `<strong>Error:</strong> ${msg}`
            es.close()
            reject(new Error(msg))
          }
          // 'log' type — no log entry created
        })
      })

      // ── Pipeline done: Load snapshot for Level 1/2 animation + results ──
      let snapshot = null
      try {
        // Try matching target S_s first, then fallback to any snapshot
        snapshot = await fetchSnapshotBySs(datasetName, targetSs)
        if (!snapshot) snapshot = await fetchDatasetSnapshot(datasetName)
      } catch (e) {
        console.warn('Snapshot not available for Level 1/2:', e)
      }

      if (snapshot && simStore.isRunning) {
        // Replace target panel with proper snapshot data (has entity/merge data)
        setSnapshotRecords(snapshot.records)
        const panel = panelsStore.replacePanelWithSnapshot(targetPanelId, snapshot, targetSs)
        if (!panel) { simStore.setRunning(false); return }
        panel.status = 'running'

        // Mark Level 0 as instantly complete
        const numSetsPost = panel.hierarchyData[0].sets.length
        for (let i = 0; i < numSetsPost; i++) {
          panel.inputSetsVisible.push(i)
          panel.inputSetsColored.push(i)
          panel.resultSetsVisible.push(i)
        }
        panel.processingSetIdx = -1
        panel.level0Processing = false
        await sleep(300)

        // ── Level 1: CMR Merge animation ──
        const stats = snapshot.stats || {}
        panel.level1Processing = true
        panel.level1ClustersVisible = true

        // CMR merge animation — always shown
        const mergeGroups = panel.snapshotMergeGroups || []
        simStore.stepInfoHtml = '<strong>Level 1 (CMR):</strong> Selecting similar clusters'
        await sleep(300)

        for (let gIdx = 0; gIdx < mergeGroups.length; gIdx++) {
          if (!simStore.isRunning) break
          simStore.progressPercent = 60 + Math.round((gIdx / mergeGroups.length) * 30)
          const group = mergeGroups[gIdx]
          panel.processingSetIdx = gIdx
          const cids2 = group.clusterIds || []
          simStore.stepInfoHtml = `<strong>Level 1 (CMR):</strong> ${group.isMerge ? 'LLM evaluating ' + cids2.join(' + ') : cids2[0] || 'Merge ' + (gIdx+1)}`
          await sleep(group.isMerge ? 200 : 80)

          {
            const clusterList = cids2.join(', ')
            const cmrPrompt2 = buildCmrPrompt(group, panel)
            if (group.isMerge) {
              logStore.createEntry(
                'cmr',
                `CMR eval: ${cids2.join(' + ')}`,
                cmrPrompt2,
                `Answer: yes → ${cids2.length} clusters merged into Entity ${gIdx + 1}`,
                0,
                `Comparing clusters [${clusterList}]`
              )
            } else {
              logStore.createEntry(
                'cmr',
                `CMR eval: ${cids2[0] || 'single'}`,
                cmrPrompt2,
                `No merge needed → kept as Entity ${gIdx + 1}`,
                0,
                `Single cluster [${clusterList}]`
              )
            }
          }

          // Show merged entity, then color clusters
          panel.level1MergeResultsVisible.push(gIdx)
          for (const cIdx of group.clusterIndices) {
            if (!panel.level1ClustersColored.includes(cIdx)) panel.level1ClustersColored.push(cIdx)
          }

          panel.processingSetIdx = -1
          await sleep(group.isMerge ? 150 : 60)
        }
        await sleep(200)

        simStore.stepInfoHtml = `<strong>CMR Merge:</strong> ${panel.preMergeClusters} clusters → ${panel.snapshotEntities?.length || 0} entities`
        await sleep(500)

        panel.level1Processing = false
        await sleep(200)

        // ── Level 2: Final Entity Resolution ──
        panel.level2Processing = true
        simStore.progressPercent = 95
        simStore.stepInfoHtml = '<strong>Final Entity Resolution</strong>'
        await sleep(300)

        panel.level2ResultsVisible = true
        panel.level2Processing = false
        simStore.progressPercent = 100

        const numEntities = panel.snapshotEntities?.length || 0

        // No completion log entry

        // Build ER results from snapshot entities
        const entities = (panel.snapshotEntities || []).map((e, idx) => {
          const sampleDisplays = e.records.slice(0, 3).map(rid => {
            const rec = snapshot.records[rid]
            return rec?.display || rid
          })
          const sampleText = sampleDisplays.join(' | ') + (e.records.length > 3 ? ` (+${e.records.length - 3})` : '')
          const recordDetails = e.records.map(rid => {
            const rec = snapshot.records[rid]
            if (!rec) return { id: rid }
            const { entity, display, ...fields } = rec
            return fields
          })
          return {
            name: `Entity ${idx + 1}`,
            count: e.count || e.records.length,
            samples: sampleText,
            records: recordDetails,
            colorIdx: e.colorIdx
          }
        })
        resultsStore.setErResults(entities, snapshot.total_records)
        resultsStore.highlightResults = true

        // Set metrics from snapshot stats
        const tokensDisplay = totalTokens > 1000000
          ? `${(totalTokens / 1000000).toFixed(2)}M`
          : `${(totalTokens / 1000).toFixed(0)}K`
        resultsStore.setMetrics({
          acc: stats.acc != null ? Number(stats.acc).toFixed(2) : '--',
          nmi: stats.nmi != null ? Number(stats.nmi).toFixed(2) : '--',
          ari: stats.ari != null ? Number(stats.ari).toFixed(2) : '--',
          fp: stats.f1 != null ? Number(stats.f1).toFixed(2) : '--',
          time: stats.time_seconds != null ? stats.time_seconds : '--',
          calls: stats.total_llm_calls || totalCalls,
          cost: `$${(totalTokens * costPerToken).toFixed(4)}`,
          tokens: tokensDisplay
        })

        // Also set per-panel metrics for comparison view
        panel.panelMetrics = {
          acc: stats.acc,
          ari: stats.ari,
          f1: stats.f1,
          time: stats.time_seconds,
          tokens: stats.total_tokens || totalTokens,
          calls: stats.total_llm_calls || totalCalls,
          pred_entities: stats.pred_entities,
        }

        simStore.stepInfoHtml = `<strong>Done:</strong> ${snapshot.total_records} records → ${numEntities} entities`
        panel.status = 'loaded'

      } else {
        // Fallback: no snapshot available — just show results without Level 1/2
        if (livePanel) {
          const numSets = livePanel.hierarchyData[0].sets.length
          for (let i = 0; i < numSets; i++) {
            if (!livePanel.inputSetsColored.includes(i)) livePanel.inputSetsColored.push(i)
            if (!livePanel.resultSetsVisible.includes(i)) livePanel.resultSetsVisible.push(i)
          }
          livePanel.processingSetIdx = -1
          livePanel.status = 'loaded'
        }

        try {
          const result = await fetchPipelineResults(task_id)
          const entities = (result.clusters || []).map((c, idx) => ({
            name: `Entity ${idx + 1}`,
            count: c.record_ids.length,
            samples: c.record_ids.slice(0, 4).join(', ') + (c.record_ids.length > 4 ? '...' : ''),
            colorIdx: (idx % 8) + 1
          }))
          const totalRecords = result.clusters.reduce((sum, c) => sum + c.record_ids.length, 0)
          resultsStore.setErResults(entities, totalRecords)
          resultsStore.highlightResults = true

          const s = result.stats || {}
          const m = result.metrics || {}
          const tTokens = s.total_tokens || 0
          const tokensDisplay = tTokens > 1000000
            ? `${(tTokens / 1000000).toFixed(2)}M`
            : `${(tTokens / 1000).toFixed(0)}K`
          resultsStore.setMetrics({
            acc: m.pairwise_accuracy != null ? Number(m.pairwise_accuracy).toFixed(2) : '--',
            nmi: m.nmi != null ? Number(m.nmi).toFixed(2) : '--',
            ari: m.ari != null ? Number(m.ari).toFixed(2) : '--',
            fp: m.f_measure != null ? Number(m.f_measure).toFixed(2) : '--',
            time: s.total_time != null ? s.total_time : '--',
            calls: s.total_api_calls || 0,
            cost: `$${(tTokens * costPerToken).toFixed(4)}`,
            tokens: tokensDisplay
          })
        } catch (e) {
          console.warn('Failed to fetch pipeline results:', e)
        }
      }

    } catch (e) {
      console.error('Pipeline execution failed:', e)
      simStore.stepInfoHtml = `<strong>Error:</strong> ${e.message}`
      // Mark target panel as error
      panelsStore.updatePanelStatus(targetPanelId, 'error', {
        loadingMessage: e.message || 'Pipeline failed'
      })
    }

    simStore.setRunning(false)
    clearSnapshotRecords()
  }

  // === Main entry ===
  async function runSimulation() {
    simStore.setRunning(true)
    logStore.reset()
    resultsStore.reset()

    const datasetName = configStore.activeDataset

    // Target the latest (last) panel; create one if none exist
    let targetPanel = panelsStore.panels.length > 0
      ? panelsStore.panels[panelsStore.panels.length - 1]
      : panelsStore.addEmptyPanel(configStore.paramSs)
    const targetPanelId = targetPanel.id
    const targetSs = targetPanel.paramSs || configStore.paramSs
    const targetModel = targetPanel.paramModel || null
    const targetExtra = {
      paramSd: targetPanel.paramSd,
      paramSv: targetPanel.paramSv,
      mdgRetryTimes: targetPanel.mdgRetryTimes,
    }

    if (datasetName) {
      // Try snapshot matching target S_s exactly
      try {
        const snapshot = await fetchSnapshotBySs(datasetName, targetSs)
        if (snapshot) {
          await runSnapshotSimulation(snapshot, targetPanelId, targetSs)
          return
        }
      } catch (e) { console.error('[Snapshot] Failed:', e) }
    }

    // No exact S_s match — run real LLMCER pipeline
    await runRealPipeline(datasetName, targetPanelId, targetSs, targetModel, targetExtra)
  }

  function resetAll() {
    simStore.reset()
    logStore.reset()
    resultsStore.reset()
    panelsStore.resetAllPanels()
    clearSnapshotRecords()
  }

  return { runSimulation, resetAll }
}
