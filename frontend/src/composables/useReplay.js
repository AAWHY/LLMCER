import { ref } from 'vue'
import { useSimulationStore } from '../stores/simulation.js'
import { useLlmLogStore } from '../stores/llmLog.js'
import { useResultsStore } from '../stores/results.js'
import { usePanelsStore } from '../stores/panels.js'
import { fetchLogRuns, fetchReplayEvents, fetchSnapshot } from '../api/index.js'
import { setSnapshotRecords, clearSnapshotRecords } from '../utils/entityHelpers.js'
import { sleep } from '../utils/sleep.js'

export function useReplay() {
  const simStore = useSimulationStore()
  const logStore = useLlmLogStore()
  const resultsStore = useResultsStore()
  const panelsStore = usePanelsStore()

  const runs = ref([])
  const selectedRun = ref('')
  const replayProgress = ref('')
  const isLoading = ref(false)
  const replaySpeed = ref(50) // ms between events

  async function loadRuns() {
    try {
      runs.value = await fetchLogRuns()
      if (runs.value.length > 0 && !selectedRun.value) {
        selectedRun.value = runs.value[0].name
      }
    } catch (e) {
      console.error('Failed to load log runs:', e)
    }
  }

  async function runReplay() {
    if (!selectedRun.value || simStore.isRunning) return

    isLoading.value = true
    let data
    let snapshot
    try {
      ;[data, snapshot] = await Promise.all([
        fetchReplayEvents(selectedRun.value),
        fetchSnapshot(selectedRun.value).catch(() => null)
      ])
    } catch (e) {
      console.error('Failed to fetch replay events:', e)
      isLoading.value = false
      return
    }
    isLoading.value = false

    const events = data.events
    if (!events || events.length === 0) return

    simStore.setRunning(true)
    logStore.reset()
    resultsStore.reset()

    // --- Center panel setup from snapshot ---
    let snapshotPanel = null
    if (snapshot) {
      setSnapshotRecords(snapshot.records)
      // Remove existing panels and create snapshot panel
      panelsStore.panels.splice(0, panelsStore.panels.length)
      snapshotPanel = panelsStore.addSnapshotPanel(snapshot)
    }

    replayProgress.value = `0 / ${events.length}`

    // --- Phase 1: Quick block appearance (center panel) ---
    if (snapshotPanel) {
      const numBlocks = snapshotPanel.hierarchyData[0].sets.length
      const blockDelay = numBlocks > 20 ? 10 : 80
      for (let i = 0; i < numBlocks; i++) {
        if (!simStore.isRunning) break
        snapshotPanel.inputSetsVisible.push(i)
        await sleep(blockDelay)
      }
    }

    // --- Phase 2: Replay events + per-block coloring/results ---
    let currentBlock = ''
    let totalTokens = 0
    let totalCalls = 0
    const costPerToken = 0.00000015 // gpt-4o-mini approx

    // Build block name -> snapshot index mapping
    const blockNameToIdx = {}
    if (snapshotPanel) {
      const sets = snapshotPanel.hierarchyData[0].sets
      for (let i = 0; i < sets.length; i++) {
        // sets[i].id is "Block 0", "Block 3", etc.
        blockNameToIdx[sets[i].id] = i
        // Also map "block_000" style names
        const num = sets[i].id.replace('Block ', '')
        const padded = num.padStart(3, '0')
        blockNameToIdx[`block_${padded}`] = i
      }
    }

    // Adaptive speed — target ~30s total replay
    const totalEvents = events.length
    const adaptiveDelay = totalEvents > 0 ? Math.max(1, Math.min(50, Math.floor(30000 / totalEvents))) : 50
    replaySpeed.value = adaptiveDelay
    const numBlocks = snapshot ? snapshot.total_blocks : 0
    const blockEventDelay = Math.max(1, Math.floor(adaptiveDelay * 1.5))

    for (let idx = 0; idx < events.length; idx++) {
      if (!simStore.isRunning) break

      const ev = events[idx]
      replayProgress.value = `${idx + 1} / ${events.length}`

      if (ev.action === 'info') {
        // No log entry for info events — only drive center panel
        await sleep(replaySpeed.value / 2)

      } else if (ev.action === 'block_start') {
        currentBlock = ev.block || ''
        simStore.stepInfoHtml =
          `<strong>Separation:</strong> ${ev.title} (${idx + 1}/${events.length})`

        // Highlight current block in center panel
        if (snapshotPanel) {
          const sIdx = blockNameToIdx[currentBlock]
          if (sIdx !== undefined) {
            snapshotPanel.processingSetIdx = sIdx
          }
        }
        await sleep(replaySpeed.value / 4)

      } else if (ev.action === 'phase_start') {
        // Only update center panel, no log entry
        simStore.stepInfoHtml =
          `<strong>CMR Merge:</strong> ${ev.title}`
        await sleep(replaySpeed.value)

      } else if (ev.action === 'llm_call') {
        totalCalls++
        const tokens = ev.tokens || 0
        totalTokens += tokens

        const isMerge = ev.type === 'merge'
        const entryType = isMerge ? 'cmr' : 'nrs'
        const promptPreview = ev.promptShort || (ev.prompt || '').slice(0, 200)
        const resp = ev.response || ''

        logStore.createEntry(entryType, ev.title, promptPreview, resp, tokens)
        logStore.addStats(tokens, totalCalls, tokens * costPerToken)
        await sleep(replaySpeed.value)

      } else if (ev.action === 'mdg') {
        const passed = ev.passed !== false
        const outputText = passed
          ? '✓ Transitivity: OK\n✓ Anti-transitivity: OK'
          : '✗ MDG violation detected'

        const eid = logStore.createEntry('mdg', ev.title, 'MDG verification', outputText, 0)
        logStore.setMdgPassed(eid, passed)
        await sleep(replaySpeed.value / 2)

      } else if (ev.action === 'merge_round') {
        const accepted = ev.accepted !== false
        const outputText = `Threshold: ${ev.threshold}\nYes: ${ev.yesCount}/${ev.total}\n→ ${accepted ? 'Accepted' : 'Rejected'}`
        logStore.createEntry('cmr', ev.title, ev.title, outputText, 0)
        await sleep(replaySpeed.value)
      }

      // When a block's separation is done, color it + show results in center panel
      if (ev.action === 'info' && ev.phase === 'separation' && ev.title.includes('separation done') && snapshotPanel) {
        const blockKey = ev.block || currentBlock
        const sIdx = blockNameToIdx[blockKey]
        if (sIdx !== undefined) {
          snapshotPanel.inputSetsColored.push(sIdx)
          snapshotPanel.resultSetsVisible.push(sIdx)
          snapshotPanel.processingSetIdx = -1
        }
        await sleep(blockEventDelay)
      }
    }

    // Final summary
    replayProgress.value = `Done (${events.length} events)`
    simStore.stepInfoHtml = `<strong>Replay complete:</strong> ${totalCalls} LLM calls, ${totalTokens} tokens`

    // Ensure all blocks are colored/shown at the end
    if (snapshotPanel) {
      const total = snapshotPanel.hierarchyData[0].sets.length
      for (let i = 0; i < total; i++) {
        if (!snapshotPanel.inputSetsColored.includes(i)) {
          snapshotPanel.inputSetsColored.push(i)
        }
        if (!snapshotPanel.resultSetsVisible.includes(i)) {
          snapshotPanel.resultSetsVisible.push(i)
        }
      }
      snapshotPanel.processingSetIdx = -1
    }

    await sleep(300)
    simStore.setRunning(false)
    clearSnapshotRecords()
  }

  function resetReplay() {
    simStore.reset()
    logStore.reset()
    resultsStore.reset()
    replayProgress.value = ''
    clearSnapshotRecords()
  }

  return {
    runs,
    selectedRun,
    replayProgress,
    isLoading,
    replaySpeed,
    loadRuns,
    runReplay,
    resetReplay,
  }
}
