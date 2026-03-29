<script setup>
import { computed } from 'vue'
import { usePanelsStore } from '../../stores/panels.js'
import { useConfigStore } from '../../stores/config.js'
import FlowLevel0 from './FlowLevel0.vue'
import FlowLevel1 from './FlowLevel1.vue'
import FlowLevel2 from './FlowLevel2.vue'

const props = defineProps({
  panel: { type: Object, required: true }
})

const panelsStore = usePanelsStore()
const configStore = useConfigStore()

const setSizeOptions = [
  { value: 4, label: '4' },
  { value: 6, label: '6' },
  { value: 9, label: '9' },
  { value: 12, label: '12' },
  { value: 15, label: '15' }
]

function onSetSizeChange(val) {
  panelsStore.updatePanelSetSize(props.panel.id, val)
}

function onDelete() {
  panelsStore.removePanel(props.panel.id)
}

// Check if any panel is doing a model comparison
const hasModelComparison = computed(() =>
  panelsStore.panels.some(p => p.paramModel)
)

const headerText = computed(() => {
  const p = props.panel
  const parts = []
  if (p.paramModel) parts.push(p.paramModel)
  else if (hasModelComparison.value) parts.push(configStore.selectedModel || 'default')
  if (p.paramSs != null) parts.push(`S_s=${p.paramSs}`)
  else if (!p.isSnapshot) parts.push(`S_s=${p.setSize}`)
  if (p.paramSd != null) parts.push(`S_d=${p.paramSd}`)
  if (p.paramSv != null) parts.push(`S_v=${p.paramSv}`)
  let text = parts.join(' · ')
  if (p.status === 'loaded' && p.isSnapshot) {
    const nBlocks = p.hierarchyData?.[0]?.sets?.length || 0
    const nEntities = p.snapshotEntities?.length || 0
    if (nBlocks > 0) text += ` · ${nBlocks} blocks · ${nEntities} entities`
  }
  return text || 'Panel'
})

const metrics = computed(() => props.panel.panelMetrics)

function fmtTokens(t) {
  if (t == null) return '--'
  if (t > 1000000) return `${(t / 1000000).toFixed(1)}M`
  if (t > 1000) return `${(t / 1000).toFixed(1)}K`
  return String(t)
}

const showContent = computed(() => {
  const s = props.panel.status
  // Show Level 0/1/2 during running (so blocks animate in real-time)
  return !s || s === 'loaded' || s === 'running'
})
</script>

<template>
  <div class="process-section">
    <div v-if="!panelsStore.isSingle" class="process-header">
      <span class="process-title">{{ headerText }}</span>
      <div class="process-controls">
        <div v-if="!panel.isSnapshot && !panel.paramSs" class="ss-selector">
          <span class="ss-label">S_s:</span>
          <el-select
            :model-value="panel.setSize"
            @change="onSetSizeChange"
            size="small"
            style="width:70px"
          >
            <el-option
              v-for="opt in setSizeOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </div>
        <button
          class="delete-panel-btn"
          :disabled="panel.status === 'running'"
          @click="onDelete"
          title="Remove this panel"
        >
          ×
        </button>
      </div>
    </div>

    <!-- Status overlay for empty / running / error -->
    <div v-if="panel.status === 'empty'" class="status-overlay">
      <div class="status-content">
        <div class="status-icon">📋</div>
        <div class="status-text">{{ headerText }} — ready</div>
        <div class="status-hint">Click <strong>Start Demo</strong> on the left panel to run</div>
      </div>
    </div>

    <!-- Running: show progress bar (Level 0/1/2 visible below) -->
    <div v-if="panel.status === 'running'" class="running-bar">
      <span class="running-dot" />
      <span class="running-text">{{ panel.loadingMessage || 'Running pipeline...' }}</span>
    </div>

    <div v-else-if="panel.status === 'error'" class="status-overlay error">
      <div class="status-content">
        <div class="status-icon">⚠</div>
        <div class="status-text">{{ panel.loadingMessage || 'Pipeline failed' }}</div>
        <div class="status-hint">Click <strong>Start Demo</strong> to retry</div>
      </div>
    </div>

    <!-- Normal Level 0/1/2 content -->
    <div v-if="showContent" class="all-levels-container">
      <!-- Level 0 -->
      <div class="level-section" :class="{ processing: panel.level0Processing }">
        <div class="level-header">
          <span class="level-badge">Level 0</span>
          <span class="level-title">Initial In-context Clustering</span>
        </div>
        <FlowLevel0 :panel="panel" />
      </div>

      <!-- Connector -->
      <div class="level-connector">
        <div class="connector-arrow">▼</div>
        <span class="connector-label">Cluster Results</span>
      </div>

      <!-- Level 1 -->
      <div class="level-section" :class="{ processing: panel.level1Processing }">
        <div class="level-header">
          <span class="level-badge">Level 1</span>
          <span class="level-title">Hierarchical Cluster Merging</span>
        </div>
        <FlowLevel1 :panel="panel" />
      </div>

      <!-- Connector -->
      <div class="level-connector">
        <div class="connector-arrow">▼</div>
        <span class="connector-label">Merge Results</span>
      </div>

      <!-- Level 2 -->
      <div class="level-section" :class="{ processing: panel.level2Processing }">
        <div class="level-header">
          <span class="level-badge level-final">Level 2</span>
          <span class="level-title">Final Entity Resolution</span>
        </div>
        <FlowLevel2 :panel="panel" />
      </div>
    </div>

    <!-- Metrics bar at bottom (multi-panel only) -->
    <div v-if="!panelsStore.isSingle && metrics && panel.status === 'loaded'" class="metrics-bar">
      <span v-if="metrics.acc != null" class="metric-item">ACC: {{ Number(metrics.acc).toFixed(2) }}</span>
      <span v-if="metrics.ari != null" class="metric-item">ARI: {{ Number(metrics.ari).toFixed(2) }}</span>
      <span v-if="metrics.f1 != null" class="metric-item">F1: {{ Number(metrics.f1).toFixed(2) }}</span>
      <span v-if="metrics.time != null" class="metric-item">{{ metrics.time }}s</span>
      <span v-if="metrics.calls != null" class="metric-item">{{ metrics.calls }} calls</span>
      <span class="metric-item">{{ fmtTokens(metrics.tokens) }} tokens</span>
    </div>
  </div>
</template>

<style scoped>
.process-section {
  background: white;
  border-radius: 6px;
  padding: 4px 5px;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}
.process-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2px;
  gap: 6px;
  flex-shrink: 0;
}
.process-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--primary);
}
.process-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ss-selector {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ss-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}
.delete-panel-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: #fee2e2;
  color: #dc2626;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}
.delete-panel-btn:hover { background: #fecaca; }
.delete-panel-btn:disabled { opacity: 0.3; cursor: not-allowed; }

/* Running bar (non-blocking, sits above Level content) */
.running-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  margin-bottom: 4px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  font-size: 12px;
  color: var(--primary, #1a365d);
}
.running-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary, #1a365d);
  animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.running-text {
  font-weight: 500;
}

/* Status overlays */
.status-overlay {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 120px;
}
.status-overlay.error .status-text {
  color: #dc2626;
}
.status-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
}
.status-icon {
  font-size: 36px;
}
.status-spinner {
  font-size: 28px;
  color: var(--primary);
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.status-text {
  font-size: 14px;
  color: #666;
  font-weight: 500;
}
.status-hint {
  font-size: 12px;
  color: #999;
}

/* Metrics bar */
.metrics-bar {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  margin-top: 4px;
  background: var(--primary-bg, #e8f0fe);
  border-radius: 6px;
  font-size: 11px;
  color: var(--primary, #1a365d);
  font-weight: 600;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.metric-item {
  white-space: nowrap;
}
.metric-item + .metric-item::before {
  content: '|';
  margin-right: 6px;
  opacity: 0.4;
}

.all-levels-container {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.level-section {
  background: var(--bg-subtle);
  border-radius: 5px;
  padding: 3px 4px;
  border: 2px solid transparent;
  transition: all 0.3s;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.level-section.processing {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(26, 54, 93, 0.15);
}
.level-header {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 2px;
}
.level-badge {
  background: var(--primary);
  color: white;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 8.5px;
  font-weight: 700;
}
.level-badge.level-final {
  background: #16a34a;
}
.level-title {
  font-size: 10px;
  font-weight: 700;
  color: #334155;
}
.level-connector {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0;
  line-height: 1;
  flex-shrink: 0;
}
.connector-arrow {
  font-size: 12px;
  color: var(--primary);
  line-height: 1;
}
.connector-label {
  font-size: 9px;
  color: var(--text-secondary);
  font-weight: 700;
}
</style>
