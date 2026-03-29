<script setup>
import { ref, computed } from 'vue'
import { useResultsStore } from '../../stores/results.js'
import { useDownload } from '../../composables/useDownload.js'

const resultsStore = useResultsStore()
const { downloadResults } = useDownload()

const dialogVisible = ref(false)
const expandedRows = ref([])

// Detect record columns dynamically from the first entity's records
const recordColumns = computed(() => {
  const entities = resultsStore.erEntities
  if (!entities.length || !entities[0].records?.length) return []
  const sample = entities[0].records[0]
  return Object.keys(sample).filter(k => k !== 'id')
})

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

function openFullView() {
  expandedRows.value = []
  dialogVisible.value = true
}

function toggleExpand(idx) {
  const pos = expandedRows.value.indexOf(idx)
  if (pos >= 0) {
    expandedRows.value.splice(pos, 1)
  } else {
    expandedRows.value.push(idx)
  }
}

function isExpanded(idx) {
  return expandedRows.value.includes(idx)
}
</script>

<template>
  <div
    class="er-result-section"
    :style="resultsStore.highlightResults ? 'box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.3)' : ''"
  >
    <div class="er-result-header">
      <span class="er-result-title">Entity Resolution Result</span>
      <el-button size="small" type="primary" @click="downloadResults">
        ↓ Download
      </el-button>
    </div>

    <div class="er-result-container">
      <template v-if="resultsStore.showResults">
        <div
          v-for="(entity, idx) in resultsStore.erEntities.slice(0, 10)"
          :key="idx"
          class="er-entity-card"
          :class="`entity-${entity.colorIdx}`"
        >
          <div class="er-entity-name">{{ entity.name }}</div>
          <div class="er-entity-count">{{ entity.count }} records</div>
          <div class="er-entity-samples">{{ entity.samples }}</div>
        </div>
        <div
          v-if="resultsStore.erEntities.length > 10"
          class="view-all-btn"
          @click="openFullView"
        >
          View all {{ resultsStore.erEntities.length }} entities...
        </div>
      </template>
      <div v-else class="placeholder">
        <div style="margin-bottom:8px;">&#9203;</div>
        Click <strong>Start</strong> to run Entity Resolution
      </div>
    </div>

    <div class="er-summary">
      <span class="er-summary-label">Total:</span>
      <span class="er-summary-value">
        <template v-if="resultsStore.showResults">
          {{ resultsStore.totalRecords }} records → {{ resultsStore.erEntities.length }} entities
        </template>
        <template v-else>-- records → -- entities</template>
      </span>
    </div>
  </div>

  <el-dialog
    v-model="dialogVisible"
    :title="`Entity Resolution Result (${resultsStore.erEntities.length} entities)`"
    width="80%"
    top="3vh"
  >
    <div class="dialog-entities" style="max-height:80vh;overflow-y:auto;">
      <div
        v-for="(entity, idx) in resultsStore.erEntities"
        :key="idx"
        class="dialog-entity"
      >
        <div class="dialog-entity-header" @click="toggleExpand(idx)">
          <span class="expand-icon">{{ isExpanded(idx) ? '▼' : '▶' }}</span>
          <span class="dialog-entity-name" :class="`color-${entity.colorIdx}`">{{ entity.name }}</span>
          <span class="dialog-entity-count">{{ entity.count }} records</span>
          <span class="dialog-entity-preview">{{ entity.samples }}</span>
        </div>
        <div v-if="isExpanded(idx) && entity.records?.length" class="dialog-records">
          <el-table
            :data="entity.records"
            stripe
            border
            size="small"
            style="width:100%"
            max-height="300"
          >
            <el-table-column prop="id" label="ID" width="70" />
            <el-table-column
              v-for="col in recordColumns"
              :key="col"
              :prop="col"
              :label="capitalize(col)"
              min-width="150"
              show-overflow-tooltip
            />
          </el-table>
        </div>
        <div v-else-if="isExpanded(idx) && !entity.records?.length" class="dialog-no-records">
          No record details available (mock data)
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.er-result-section {
  background: white;
  border-radius: 6px;
  padding: 8px 10px;
  transition: box-shadow 0.3s;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.er-result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.er-result-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--primary);
}
.er-result-container {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.er-entity-card {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 5px;
  border-left: 3px solid;
}
.er-entity-name {
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
  min-width: 65px;
}
.er-entity-count {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-secondary);
  background: white;
  padding: 1px 6px;
  border-radius: 6px;
  white-space: nowrap;
}
.er-entity-samples {
  font-size: 9px;
  color: var(--text-muted);
  flex: 1;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.er-summary {
  margin-top: 3px;
  padding-top: 3px;
  border-top: 1px solid var(--border-light);
  text-align: center;
  flex-shrink: 0;
}
.er-summary-label {
  font-size: 10px;
  color: var(--text-secondary);
}
.er-summary-value {
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
  margin-left: 4px;
}
.placeholder {
  text-align: center;
  padding: 12px;
  color: var(--text-muted);
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-size: 11px;
}
.view-all-btn {
  text-align: center;
  padding: 8px;
  font-size: 10px;
  font-weight: 600;
  color: var(--primary);
  cursor: pointer;
  transition: color 0.2s;
}
.view-all-btn:hover {
  color: var(--primary-light);
  text-decoration: underline;
}

/* Dialog styles */
.dialog-entity {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  margin-bottom: 6px;
  overflow: hidden;
}
.dialog-entity-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  background: #f8fafc;
  transition: background 0.2s;
}
.dialog-entity-header:hover {
  background: #f1f5f9;
}
.expand-icon {
  font-size: 10px;
  color: #94a3b8;
  width: 14px;
}
.dialog-entity-name {
  font-size: 13px;
  font-weight: 700;
  min-width: 90px;
}
.color-1 { color: #e74c3c; }
.color-2 { color: #3498db; }
.color-3 { color: #2ecc71; }
.color-4 { color: #f39c12; }
.color-5 { color: #9b59b6; }
.color-6 { color: #1abc9c; }
.color-7 { color: #e67e22; }
.color-8 { color: #34495e; }
.dialog-entity-count {
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  background: white;
  padding: 2px 8px;
  border-radius: 10px;
  white-space: nowrap;
}
.dialog-entity-preview {
  font-size: 11px;
  color: #94a3b8;
  flex: 1;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dialog-records {
  padding: 8px 14px 14px;
  background: white;
}
.dialog-no-records {
  padding: 12px 14px;
  font-size: 11px;
  color: #94a3b8;
  text-align: center;
}
</style>
