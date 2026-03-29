import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetchDatasets, fetchDatasetDetail, fetchDatasetRecords, fetchModels, fetchGtEntityMap } from '../api/index.js'

export const useConfigStore = defineStore('config', () => {
  const datasets = ref([])
  const activeDataset = ref('')
  const activeDatasetInfo = ref(null)
  const activeDatasetRecords = ref([])

  const gtEntityMap = ref(null)

  const models = ref([])

  const blockingStrategy = ref('lsh')
  const blockingThreshold = ref(0.5)

  const paramSs = ref(9)
  const paramSd = ref(4)
  const paramSv = ref(2)
  const mergeThreshold = ref(0.7)
  const separationThreshold = ref(0.3)
  const mdgRetryTimes = ref(3)
  const mdgEnabled = ref(true)  // true = auto MDG, false = human MDG
  // Hidden defaults (not shown in UI)
  const maxWorkers = ref(5)
  const chunkSize = ref(10)
  const retryAttempts = ref(2)
  const lshHashSize = ref(15)
  const lshNumHashtables = ref(8)
  const maxK = ref(5)

  const apiKey = ref('')
  const openaiBaseUrl = ref('')
  const selectedModel = ref('gpt-4o-mini')

  async function loadDatasets() {
    try {
      datasets.value = await fetchDatasets()
      if (datasets.value.length && !activeDataset.value) {
        await setDataset(datasets.value[0].name)
      }
    } catch (e) {
      console.error('loadDatasets failed:', e)
    }
  }

  async function setDataset(name) {
    activeDataset.value = name
    try {
      const detail = await fetchDatasetDetail(name, 20)
      activeDatasetInfo.value = detail
      activeDatasetRecords.value = detail.preview || []

      // Load GT entity map if ground truth is available
      if (detail.has_ground_truth) {
        gtEntityMap.value = await fetchGtEntityMap(name)
      } else {
        gtEntityMap.value = null
      }
    } catch (e) {
      console.error('setDataset failed:', e)
      activeDatasetInfo.value = null
      activeDatasetRecords.value = []
      gtEntityMap.value = null
    }
  }

  async function loadModels() {
    try {
      models.value = await fetchModels()
    } catch (e) {
      console.error('loadModels failed:', e)
    }
  }

  function resetParams() {
    blockingStrategy.value = 'lsh'
    blockingThreshold.value = 0.5
    paramSs.value = 9
    paramSd.value = 4
    paramSv.value = 2
    mergeThreshold.value = 0.7
    separationThreshold.value = 0.3
    mdgRetryTimes.value = 3
    mdgEnabled.value = true
    maxWorkers.value = 5
    chunkSize.value = 10
    retryAttempts.value = 2
    lshHashSize.value = 15
    lshNumHashtables.value = 8
    maxK.value = 5
  }

  function buildPipelineRequest() {
    return {
      dataset_name: activeDataset.value,
      openai_api_key: apiKey.value,
      openai_base_url: openaiBaseUrl.value || undefined,
      model: selectedModel.value,
      blocking_strategy: blockingStrategy.value,
      block_threshold: null,   // always auto-calculate from similarity matrix
      merge_threshold: null,   // always auto-calculate from similarity matrix
      mdg_retry_times: mdgRetryTimes.value,
      mdg_mode: mdgEnabled.value ? 'auto' : 'manual',
      max_workers: maxWorkers.value,
      chunk_size: chunkSize.value,
      retry_attempts: retryAttempts.value,
      lsh_hash_size: lshHashSize.value,
      lsh_num_hashtables: lshNumHashtables.value,
      max_k: maxK.value
    }
  }

  return {
    datasets, activeDataset, activeDatasetInfo, activeDatasetRecords, gtEntityMap,
    models,
    blockingStrategy, blockingThreshold,
    paramSs, paramSd, paramSv,
    mergeThreshold, separationThreshold, mdgRetryTimes, mdgEnabled,
    chunkSize,
    apiKey, openaiBaseUrl,
    selectedModel,
    setDataset, resetParams, loadDatasets, loadModels,
    buildPipelineRequest
  }
})
