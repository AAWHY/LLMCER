import { defineStore } from 'pinia'
import { ref } from 'vue'

let logIdCounter = 0

export const useLlmLogStore = defineStore('llmLog', () => {
  const entries = ref([])
  const totalTokens = ref(0)
  const totalCalls = ref(0)
  const totalCost = ref(0)

  function createEntry(type, title, input, output, tokens, inputSummary = '') {
    const now = new Date()
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`

    let stepLabel = 'NRS'
    if (type === 'cmr' || type === 'merge') stepLabel = 'CMR'
    else if (type === 'mdg') stepLabel = 'MDG'

    const entry = {
      id: logIdCounter++,
      type,
      stepLabel,
      title,
      time: timeStr,
      input: input || '',
      inputSummary: inputSummary || '',
      output: output || '',
      tokens: tokens || 0,
      mdgPassed: false,
    }
    entries.value.push(entry)
    return entry.id
  }

  function setMdgPassed(entryId, passed) {
    const entry = entries.value.find(e => e.id === entryId)
    if (entry) entry.mdgPassed = passed
  }

  function addStats(tokens, calls, cost) {
    totalTokens.value += tokens
    totalCalls.value = calls
    totalCost.value += cost
  }

  function reset() {
    entries.value = []
    totalTokens.value = 0
    totalCalls.value = 0
    totalCost.value = 0
    logIdCounter = 0
  }

  return {
    entries, totalTokens, totalCalls, totalCost,
    createEntry, setMdgPassed, addStats, reset
  }
})
