<script setup>
import { ref, computed } from 'vue'
import { useConfigStore } from '../../stores/config.js'
import { fetchDatasetRecords } from '../../api/index.js'

const config = useConfigStore()

const records = computed(() => config.activeDatasetRecords)
const columns = computed(() => config.activeDatasetInfo?.columns || [])
const totalCount = computed(() => config.activeDatasetInfo?.record_count || 0)
const hasGt = computed(() => !!config.gtEntityMap)

function entityClass(row) {
  if (!config.gtEntityMap) return ''
  const id = String(recordId(row))
  const idx = config.gtEntityMap[id]
  return idx ? `entity-${idx}` : ''
}

function tableRowClass({ row }) {
  if (!config.gtEntityMap) return ''
  const idCol = columns.value[0]
  const id = idCol ? String(row[idCol]) : ''
  const idx = config.gtEntityMap[id]
  return idx ? `gt-entity-${idx}` : ''
}
const displayRecords = computed(() => records.value.slice(0, 12))
const remaining = computed(() => totalCount.value - displayRecords.value.length)

const dialogVisible = ref(false)
const fullRecords = ref([])
const fullLoading = ref(false)
const fullPage = ref(1)
const fullPageSize = 50

async function openFullView() {
  dialogVisible.value = true
  fullPage.value = 1
  await loadPage(1)
}

async function loadPage(page) {
  if (!config.activeDataset) return
  fullLoading.value = true
  try {
    const offset = (page - 1) * fullPageSize
    const data = await fetchDatasetRecords(config.activeDataset, offset, fullPageSize)
    fullRecords.value = data.records || []
  } catch (e) {
    console.error('Failed to load records:', e)
  }
  fullLoading.value = false
}

function handlePageChange(page) {
  fullPage.value = page
  loadPage(page)
}

function recordLabel(row) {
  const vals = columns.value.slice(1).map(c => row[c]).filter(v => v != null && v !== '')
  return vals.join(', ')
}

function recordId(row) {
  const idCol = columns.value[0]
  return idCol ? row[idCol] : ''
}
</script>

<template>
  <div class="raw-data-section">
    <div class="raw-data-header">
      <span class="raw-data-title">Raw Input Data</span>
      <span class="record-count">{{ totalCount }} Records</span>
    </div>
    <div v-if="records.length === 0" class="loading-hint">
      Select a dataset to view records...
    </div>
    <div v-else class="raw-records-list">
      <div
        v-for="(r, idx) in displayRecords"
        :key="idx"
        :class="['raw-record-item', entityClass(r)]"
      >
        <span class="record-id">{{ recordId(r) }}</span>
        <span class="record-attrs">{{ recordLabel(r) }}</span>
      </div>
      <div v-if="remaining > 0" class="more-hint view-all-btn" @click="openFullView">
        View all {{ totalCount }} records...
      </div>
    </div>
  </div>

  <el-dialog
    v-model="dialogVisible"
    :title="`${config.activeDataset} — Raw Data (${totalCount} records)`"
    width="80%"
    top="5vh"
  >
    <el-table
      v-loading="fullLoading"
      :data="fullRecords"
      :row-class-name="tableRowClass"
      stripe
      border
      size="small"
      max-height="60vh"
      style="width: 100%"
    >
      <el-table-column
        v-for="col in columns"
        :key="col"
        :prop="col"
        :label="col"
        :min-width="col === columns[0] ? 60 : 150"
        show-overflow-tooltip
      />
    </el-table>
    <div class="dialog-pagination">
      <el-pagination
        :current-page="fullPage"
        :page-size="fullPageSize"
        :total="totalCount"
        layout="prev, pager, next, total"
        @current-change="handlePageChange"
      />
    </div>
  </el-dialog>
</template>

<style scoped>
.raw-data-section {
  background: white;
  border-radius: 6px;
  padding: 5px 7px;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.raw-data-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 3px;
}
.raw-data-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
}
.record-count {
  background: var(--primary);
  color: white;
  padding: 1px 5px;
  border-radius: 6px;
  font-size: 8px;
  font-weight: 600;
}
.raw-records-list {
  display: flex;
  flex-direction: column;
  gap: 1.5px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.raw-record-item {
  background: #f8fafc;
  border-radius: 3px;
  padding: 3px 5px;
  font-size: 9px;
  border-left: 2px solid var(--primary);
  display: flex;
  flex-direction: column;
  gap: 1px;
  line-height: 1.2;
}
.record-id {
  font-weight: 700;
  color: var(--primary);
}
.record-attrs {
  color: var(--text-secondary);
  font-size: 8px;
}
.more-hint, .loading-hint {
  text-align: center;
  padding: 4px;
  color: var(--text-muted);
  font-size: 9px;
}
.view-all-btn {
  cursor: pointer;
  color: var(--primary);
  font-weight: 600;
  transition: color 0.2s;
}
.view-all-btn:hover {
  color: var(--primary-light);
  text-decoration: underline;
}
.loading-hint {
  padding: 20px;
}
.dialog-pagination {
  display: flex;
  justify-content: center;
  margin-top: 12px;
}
</style>
