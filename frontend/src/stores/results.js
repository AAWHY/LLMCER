import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useResultsStore = defineStore('results', () => {
  const erEntities = ref([])
  const totalRecords = ref(0)
  const showResults = ref(false)
  const highlightResults = ref(false)

  const metrics = ref({
    acc: '--', nmi: '--', ari: '--', fp: '--',
    time: '--', calls: '--', cost: '--', tokens: '--'
  })

  function setErResults(entities, total) {
    erEntities.value = entities
    totalRecords.value = total
    showResults.value = true
  }

  function setMetrics(data) {
    metrics.value = { ...data }
  }

  function reset() {
    erEntities.value = []
    totalRecords.value = 0
    showResults.value = false
    highlightResults.value = false
    metrics.value = {
      acc: '--', nmi: '--', ari: '--', fp: '--',
      time: '--', calls: '--', cost: '--', tokens: '--'
    }
  }

  return {
    erEntities, totalRecords, showResults, highlightResults,
    metrics,
    setErResults, setMetrics, reset
  }
})
