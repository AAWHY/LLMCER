<script setup>
import { computed, ref, reactive, provide } from 'vue'
import { usePanelsStore } from '../../stores/panels.js'
import RecordNode from './RecordNode.vue'
import ClusterGroup from './ClusterGroup.vue'
import LevelDetailModal from './LevelDetailModal.vue'

const props = defineProps({
  panel: { type: Object, required: true }
})

const panelsStore = usePanelsStore()

provide('recordsMap', computed(() => props.panel.recordsMap || {}))

const MAX_DISPLAY = 5
const showModal = ref(false)

// Per-entity expand
const expandedEntities = reactive(new Set())
function toggleEntityExpand(idx, ev) {
  ev.stopPropagation()
  expandedEntities.has(idx) ? expandedEntities.delete(idx) : expandedEntities.add(idx)
}
function entityRecordLimit(idx) { return expandedEntities.has(idx) ? Infinity : 4 }

// Modal per-entity expand (separate state)
const expandedModalEntities = reactive(new Set())
function toggleModalEntityExpand(idx, ev) {
  ev.stopPropagation()
  expandedModalEntities.has(idx) ? expandedModalEntities.delete(idx) : expandedModalEntities.add(idx)
}
function modalEntityRecordLimit(idx) { return expandedModalEntities.has(idx) ? Infinity : 4 }

const finalEntities = computed(() => {
  if (!props.panel.level2ResultsVisible) return []

  if (props.panel.snapshotEntities?.length) {
    return props.panel.snapshotEntities
  }

  const mergeResults = panelsStore.getMergeResults(props.panel)
  const level0Results = panelsStore.buildLevel0ClusteringResults(props.panel)

  return mergeResults.map((group, idx) => {
    const clusterIds = group.clusters
    let records = []
    Object.values(level0Results).forEach(setClusters => {
      setClusters.forEach(cluster => {
        if (clusterIds.includes(cluster.id)) {
          records = records.concat(cluster.records)
        }
      })
    })
    return {
      idx,
      clusters: group.clusters,
      records,
      count: records.length,
      colorIdx: (idx % 8) + 1
    }
  })
})

// === Set tracking ===
const isTracking = computed(() => props.panel.trackedSetIdx != null)
const trackedRecords = computed(() => {
  if (props.panel.trackedSetIdx == null) return null
  const set = props.panel.hierarchyData[0].sets[props.panel.trackedSetIdx]
  return set ? new Set(set.records) : null
})
function isEntityTracked(entity) {
  if (!trackedRecords.value) return false
  return entity.records.some(r => trackedRecords.value.has(r))
}
function isEntityDimmed(entity) {
  return isTracking.value && !isEntityTracked(entity)
}
function onEntityClick(entity) {
  const setCounts = {}
  const allSets = props.panel.hierarchyData[0].sets
  for (const rid of entity.records) {
    for (let si = 0; si < allSets.length; si++) {
      if (allSets[si].records.includes(rid)) {
        setCounts[si] = (setCounts[si] || 0) + 1
        break
      }
    }
  }
  const bestSet = Object.entries(setCounts).sort((a, b) => b[1] - a[1])[0]
  if (bestSet) panelsStore.toggleTrackedSet(props.panel.id, parseInt(bestSet[0]))
}

const displayedEntities = computed(() => {
  return finalEntities.value.length <= MAX_DISPLAY ? finalEntities.value : finalEntities.value.slice(0, MAX_DISPLAY)
})
const overflowCount = computed(() => Math.max(0, finalEntities.value.length - MAX_DISPLAY))
</script>

<template>
  <div class="flow-container">
    <div v-if="panel.level2ResultsVisible && finalEntities.length" class="final-entities">
      <div class="entity-summary">
        {{ finalEntities.length }} entities resolved from {{ panel.snapshotEntities ? panel.hierarchyData[0].sets.length + ' sets' : 'merge results' }}
      </div>
      <div class="entity-grid">
        <div
          v-for="entity in displayedEntities"
          :key="entity.idx"
          class="record-set"
          :class="{ tracked: isEntityTracked(entity), dimmed: isEntityDimmed(entity) }"
          @click="onEntityClick(entity)"
          style="cursor:pointer;"
        >
          <div class="entity-name">Entity {{ entity.idx + 1 }}</div>
          <ClusterGroup
            :entityClass="`entity-${entity.colorIdx}`"
            style="flex-wrap:wrap;justify-content:center;padding:2px;"
          >
            <RecordNode
              v-for="r in entity.records.slice(0, entityRecordLimit(entity.idx))"
              :key="r"
              :label="String(r).replace('r', '')"
              :title="String(r)"
              :entityClass="`entity-${entity.colorIdx}`"
              size="tiny"
            />
            <span
              v-if="entity.records.length > entityRecordLimit(entity.idx)"
              class="expand-hint"
              @click="toggleEntityExpand(entity.idx, $event)"
            >+{{ entity.records.length - entityRecordLimit(entity.idx) }}</span>
            <span
              v-else-if="expandedEntities.has(entity.idx)"
              class="expand-hint"
              @click="toggleEntityExpand(entity.idx, $event)"
            >−</span>
          </ClusterGroup>
          <div class="record-count">{{ entity.count || entity.records.length }} records</div>
        </div>
        <div v-if="overflowCount > 0" class="overflow-card" @click="showModal = true">
          <span class="overflow-number">+{{ overflowCount }}</span>
          <span class="overflow-text">more entities</span>
        </div>
      </div>
    </div>
    <div v-else class="waiting-msg">
      Waiting for results...
    </div>

    <!-- Detail modal (with tracking) -->
    <LevelDetailModal
      v-if="showModal"
      :title="`Level 2: Final — ${finalEntities.length} Entities`"
      @close="showModal = false"
    >
      <div class="entity-grid">
        <div
          v-for="entity in finalEntities"
          :key="entity.idx"
          class="record-set"
          :class="{ tracked: isEntityTracked(entity), dimmed: isEntityDimmed(entity) }"
          @click="onEntityClick(entity)"
          style="cursor:pointer;"
        >
          <div class="entity-name">Entity {{ entity.idx + 1 }}</div>
          <ClusterGroup
            :entityClass="`entity-${entity.colorIdx}`"
            style="flex-wrap:wrap;justify-content:center;padding:2px;"
          >
            <RecordNode
              v-for="r in entity.records.slice(0, modalEntityRecordLimit(entity.idx))"
              :key="r"
              :label="String(r).replace('r', '')"
              :title="String(r)"
              :entityClass="`entity-${entity.colorIdx}`"
              size="tiny"
            />
            <span
              v-if="entity.records.length > modalEntityRecordLimit(entity.idx)"
              class="expand-hint"
              @click="toggleModalEntityExpand(entity.idx, $event)"
            >+{{ entity.records.length - modalEntityRecordLimit(entity.idx) }}</span>
            <span
              v-else-if="expandedModalEntities.has(entity.idx)"
              class="expand-hint"
              @click="toggleModalEntityExpand(entity.idx, $event)"
            >−</span>
          </ClusterGroup>
          <div class="record-count">{{ entity.count || entity.records.length }} records</div>
        </div>
      </div>
    </LevelDetailModal>
  </div>
</template>

<style scoped>
.flow-container {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  background: white;
  border-radius: 6px;
}
.entity-summary {
  font-size: 10px;
  font-weight: 600;
  color: #16a34a;
  padding: 3px 6px;
  background: #f0fdf4;
  border-radius: 4px;
  text-align: center;
}
.entity-grid {
  display: flex;
  justify-content: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 4px;
}
.record-set {
  background: white;
  border: 2px solid var(--border-light);
  border-radius: 8px;
  padding: 3px;
  min-width: 55px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: center;
}
.record-set.tracked {
  border-color: #f59e0b;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.25);
}
.record-set.dimmed {
  opacity: 0.2;
}
.entity-name {
  font-size: 9px;
  font-weight: 700;
  color: var(--primary);
}
.record-count {
  font-size: 8px;
  color: var(--text-secondary);
  margin-top: 1px;
}
.overflow-hint {
  font-size: 7px;
  color: var(--text-secondary);
}
.expand-hint {
  font-size: 7px;
  color: var(--primary);
  cursor: pointer;
  font-weight: 700;
}
.expand-hint:hover {
  text-decoration: underline;
}
.overflow-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 50px;
  padding: 4px 6px;
  background: #f8fafc;
  border: 2px dashed var(--border-light);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}
.overflow-card:hover {
  border-color: var(--primary);
  background: #f1f5f9;
}
.overflow-number {
  font-size: 16px;
  font-weight: 700;
  color: var(--primary);
}
.overflow-text {
  font-size: 8px;
  color: var(--text-muted);
}
.waiting-msg {
  font-size: 10px;
  color: var(--text-muted);
  text-align: center;
  padding: 6px;
  opacity: 0.5;
}
</style>
