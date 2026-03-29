<script setup>
import { useResultsStore } from '../../stores/results.js'

const resultsStore = useResultsStore()

const row1 = [
  { key: 'acc', label: 'ACC' },
  { key: 'nmi', label: 'NMI' },
  { key: 'ari', label: 'ARI' },
  { key: 'fp', label: 'FP' }
]

const row2 = [
  { key: 'time', label: 'Time' },
  { key: 'calls', label: 'Calls' },
  { key: 'cost', label: 'Cost' },
  { key: 'tokens', label: 'Tokens' }
]
</script>

<template>
  <div class="performance-section">
    <div class="performance-title">Performance</div>
    <div class="gt-wrap">
      <div class="metrics-grid">
        <div v-for="m in row1" :key="m.key" class="metric-box gt">
          <div class="metric-label">{{ m.label }}</div>
          <div class="metric-value">{{ resultsStore.metrics[m.key] }}</div>
        </div>
      </div>
      <div class="gt-hint">* requires ground truth</div>
    </div>
    <div class="metrics-grid" style="margin-top:4px;">
      <div v-for="m in row2" :key="m.key" class="metric-box">
        <div class="metric-label">{{ m.label }}</div>
        <div class="metric-value">{{ resultsStore.metrics[m.key] }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.performance-section {
  background: white;
  border-radius: 6px;
  padding: 8px 10px;
}
.performance-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--primary);
  margin-bottom: 4px;
}
.gt-wrap {
  border: 1.5px dashed #8aba7e;
  border-radius: 5px;
  padding: 5px;
  background: rgba(106, 191, 94, 0.05);
}
.gt-hint {
  font-size: 9px;
  color: #6abf5e;
  text-align: center;
  margin-top: 3px;
  font-weight: 700;
  font-style: italic;
}
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}
.metric-box {
  background: var(--primary);
  border-radius: 4px;
  padding: 5px 4px;
  text-align: center;
  border: 1px solid transparent;
  min-width: 0;
}
.metric-box.gt {
  background: #4a6741;
  border: 1px dashed #8aba7e;
}
.metric-label {
  font-size: 10px;
  color: rgba(255,255,255,0.9);
  font-weight: 600;
  white-space: nowrap;
}
.metric-value {
  font-size: 10px;
  color: white;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
