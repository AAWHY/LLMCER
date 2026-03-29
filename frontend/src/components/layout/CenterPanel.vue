<script setup>
import { ref, computed } from 'vue'
import { usePanelsStore } from '../../stores/panels.js'
import { useConfigStore } from '../../stores/config.js'
import { useSimulationStore } from '../../stores/simulation.js'
import { fetchDatasetSnapshots } from '../../api/index.js'
import ComparisonPanel from '../center/ComparisonPanel.vue'

const panelsStore = usePanelsStore()
const configStore = useConfigStore()
const simStore = useSimulationStore()

// Dialog state
const dialogVisible = ref(false)
const snapshotList = ref([])
const loadingSnapshots = ref(false)

// Comparison params — default from config
const cmpSs = ref(9)
const cmpSd = ref(4)
const cmpSv = ref(2)
const cmpMdgRetry = ref(3)
const cmpModel = ref('')

const ssOptions = [4, 5, 8, 9, 10, 15, 20]

async function openDialog() {
  dialogVisible.value = true
  // Init from current config
  cmpSs.value = configStore.paramSs
  cmpSd.value = configStore.paramSd
  cmpSv.value = configStore.paramSv
  cmpMdgRetry.value = configStore.mdgRetryTimes
  cmpModel.value = configStore.selectedModel
  snapshotList.value = []
  loadingSnapshots.value = true
  try {
    const dataset = configStore.activeDataset
    if (dataset) {
      snapshotList.value = await fetchDatasetSnapshots(dataset)
    }
    if (!configStore.models.length) await configStore.loadModels()
  } catch (e) {
    console.warn('Failed to fetch snapshots:', e)
  } finally {
    loadingSnapshots.value = false
  }
}

// Build a short label showing what's different from current config
const diffLabel = computed(() => {
  const parts = []
  if (cmpSs.value !== configStore.paramSs) parts.push(`S_s=${cmpSs.value}`)
  if (cmpSd.value !== configStore.paramSd) parts.push(`S_d=${cmpSd.value}`)
  if (cmpSv.value !== configStore.paramSv) parts.push(`S_v=${cmpSv.value}`)
  if (cmpMdgRetry.value !== configStore.mdgRetryTimes) parts.push(`MDG=${cmpMdgRetry.value}`)
  if (cmpModel.value !== configStore.selectedModel) parts.push(cmpModel.value)
  return parts.join(', ')
})

function confirmAdd() {
  dialogVisible.value = false
  panelsStore.addEmptyPanel(cmpSs.value, cmpModel.value !== configStore.selectedModel ? cmpModel.value : null, {
    paramSd: cmpSd.value,
    paramSv: cmpSv.value,
    mdgRetryTimes: cmpMdgRetry.value,
  })
}
</script>

<template>
  <div class="process-panel">
    <div class="process-panel-header">
      <span class="process-panel-title">In-context Clustering Process</span>
      <el-button type="primary" size="small" :disabled="simStore.isRunning" @click="openDialog">
        + Add Comparison
      </el-button>
    </div>

    <div class="comparisons-container">
      <ComparisonPanel
        v-for="panel in panelsStore.panels"
        :key="panel.id"
        :panel="panel"
        :class="{ single: panelsStore.isSingle }"
      />
    </div>

    <div class="step-info-row">
      <div class="step-info" v-html="simStore.stepInfoHtml" />
      <div v-if="simStore.isRunning" class="progress-bar-wrapper">
        <div class="progress-bar-fill" :style="{ width: simStore.progressPercent + '%' }" />
        <span class="progress-text">{{ simStore.progressPercent }}%</span>
      </div>
    </div>

    <!-- Comparison dialog -->
    <el-dialog
      v-model="dialogVisible"
      title="Add Comparison"
      width="500px"
      :close-on-click-modal="true"
    >
      <div class="dialog-body">
        <p class="dialog-hint">Adjust parameters to compare. Changed values are highlighted.</p>

        <div class="param-grid">
          <div class="param-item">
            <span class="param-name">S_s</span>
            <el-input-number v-model="cmpSs" :min="2" :max="100" size="small" style="width:100px" />
          </div>

          <div class="param-item">
            <span class="param-name">S_d</span>
            <el-input-number v-model="cmpSd" :min="1" :max="10" size="small" style="width:100px" />
          </div>

          <div class="param-item">
            <span class="param-name">S_v</span>
            <el-input-number v-model="cmpSv" :min="1" :max="10" size="small" style="width:100px" />
          </div>

          <div class="param-item">
            <span class="param-name">MDG Retry</span>
            <el-input-number v-model="cmpMdgRetry" :min="1" :max="10" size="small" style="width:100px" />
          </div>

          <div class="param-item">
            <span class="param-name">LLM Model</span>
            <el-select v-model="cmpModel" size="small" style="width:160px">
              <el-option
                v-for="m in configStore.models"
                :key="m.value"
                :label="m.label"
                :value="m.value"
              />
            </el-select>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="dialogVisible = false">Cancel</el-button>
        <el-button type="primary" @click="confirmAdd">
          Add Panel
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.process-panel {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.process-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 3px 6px;
  background: white;
  border-radius: 6px;
  flex-shrink: 0;
}
.process-panel-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--primary);
}
.comparisons-container {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding-bottom: 2px;
  flex: 1;
  min-height: 0;
  align-items: stretch;
}
.step-info-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.step-info {
  background: var(--primary-bg);
  border-radius: 5px;
  padding: 3px 6px;
  font-size: 10px;
  color: var(--primary);
  flex: 1;
}
.step-info :deep(strong) {
  color: var(--primary);
}
.progress-bar-wrapper {
  position: relative;
  width: 80px;
  height: 16px;
  background: #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
}
.progress-bar-fill {
  height: 100%;
  background: var(--primary, #1a365d);
  border-radius: 8px;
  transition: width 0.3s ease;
}
.progress-text {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 9px;
  font-weight: 700;
  color: white;
  line-height: 16px;
  mix-blend-mode: difference;
}
/* Dialog */
.dialog-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.dialog-hint {
  font-size: 13px;
  color: #666;
  margin: 0;
}
.param-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.param-item {
  display: flex;
  align-items: center;
  gap: 10px;
}
.param-name {
  font-size: 13px;
  font-weight: 700;
  color: #333;
  min-width: 80px;
}
.param-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.chip {
  padding: 4px 12px;
  border: 2px solid #e0e0e0;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}
.chip:hover {
  border-color: var(--primary, #1a365d);
  background: #f0f5ff;
}
.chip.selected {
  border-color: var(--primary, #1a365d);
  background: var(--primary-bg, #e8f0fe);
  color: var(--primary, #1a365d);
}
.chip.changed {
  border-color: #f59e0b;
  background: #fffbeb;
}
.diff-hint {
  font-size: 11px;
  color: #999;
  margin-right: auto;
}
</style>
