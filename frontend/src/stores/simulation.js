import { defineStore } from 'pinia'
import { ref, nextTick } from 'vue'

export const useSimulationStore = defineStore('simulation', () => {
  const isRunning = ref(false)
  const currentLevel = ref(-1)
  const currentStep = ref(0)
  const stepInfoHtml = ref('Click <strong>Start</strong> to begin the in-context clustering process')
  const progressPercent = ref(0)  // 0-100

  function setRunning(val) {
    isRunning.value = val
  }

  function updateStepInfo(level, step) {
    const messages = {
      0: {
        0: '<strong>Level 0:</strong> Creating record sets with S_s=9, S_d=4 from blocked records',
        1: '<strong>Level 0:</strong> LLM performing in-context clustering on each record set',
        2: '<strong>Level 0:</strong> Clustering complete. Each set partitioned into entity groups'
      },
      1: {
        0: '<strong>Level 1 (CMR):</strong> Selecting similar clusters from different Level 0 sets',
        1: '<strong>Level 1 (CMR):</strong> LLM clustering to determine which clusters belong to the same entity'
      },
      2: {
        0: '<strong>Level 2:</strong> Final entity resolution complete!'
      }
    }
    currentLevel.value = level
    currentStep.value = step
    stepInfoHtml.value = messages[level]?.[step] || messages[level]?.[0] || 'Processing...'
  }

  // MDG human review state
  const mdgPendingSetIdx = ref(-1)   // which set is waiting for review (-1 = none, -2 = live pipeline)
  const mdgReviewData = ref(null)     // { sliceIds: [], clusters: [] } for display
  const mdgReviewCounter = ref(0)     // increments each review to force re-render
  let _mdgResolve = null              // Promise resolve for the pending review (snapshot mode)
  const liveTaskId = ref(null)        // task ID for live pipeline MDG responses

  function requestMdgReview(setIdx, reviewData = null) {
    mdgPendingSetIdx.value = setIdx
    mdgReviewData.value = reviewData
    mdgReviewCounter.value++
    return new Promise(resolve => { _mdgResolve = resolve })
  }

  async function respondMdgReview(accepted) {
    // Clear review data first so UI hides immediately
    mdgReviewData.value = null
    mdgPendingSetIdx.value = -1
    if (liveTaskId.value) {
      // Live pipeline: call backend API
      await nextTick()
      const { submitMdgResponse } = await import('../api/index.js')
      await submitMdgResponse(liveTaskId.value, accepted)
    }
    if (_mdgResolve) {
      // Snapshot mode: resolve the promise
      _mdgResolve(accepted)
      _mdgResolve = null
    }
  }

  function reset() {
    isRunning.value = false
    currentLevel.value = -1
    currentStep.value = 0
    stepInfoHtml.value = 'Click <strong>Start</strong> to begin the in-context clustering process'
    progressPercent.value = 0
    mdgPendingSetIdx.value = -1
    _mdgResolve = null
    liveTaskId.value = null
  }

  return {
    isRunning, currentLevel, currentStep, stepInfoHtml, progressPercent,
    mdgPendingSetIdx, mdgReviewData, mdgReviewCounter, liveTaskId,
    setRunning, updateStepInfo, reset,
    requestMdgReview, respondMdgReview
  }
})
