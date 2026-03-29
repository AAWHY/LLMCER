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

// Per-entity expand for records inside a card
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

// === Mock demo data ===
const mergeSetsData = computed(() => panelsStore.getLevel1MergeSetsData(props.panel))
const mergeResults = computed(() => panelsStore.getMergeResults(props.panel))
const clusterColorMap = computed(() => panelsStore.getClusterColorMap(props.panel))

// Snapshot truncation
const snapshotMergeGroupsDisplay = computed(() => {
  const groups = props.panel.snapshotMergeGroups || []
  return groups.length <= MAX_DISPLAY ? groups : groups.slice(0, MAX_DISPLAY)
})
const snapshotMergeOverflow = computed(() => Math.max(0, (props.panel.snapshotMergeGroups || []).length - MAX_DISPLAY))

const snapshotEntitiesDisplay = computed(() => {
  const entities = props.panel.snapshotEntities || []
  return entities.length <= MAX_DISPLAY ? entities : entities.slice(0, MAX_DISPLAY)
})
const snapshotEntitiesOverflow = computed(() => Math.max(0, (props.panel.snapshotEntities || []).length - MAX_DISPLAY))

// Mock truncation
const mockMergeSetsDisplay = computed(() => {
  return mergeSetsData.value.length <= MAX_DISPLAY ? mergeSetsData.value : mergeSetsData.value.slice(0, MAX_DISPLAY)
})
const mockMergeOverflow = computed(() => Math.max(0, mergeSetsData.value.length - MAX_DISPLAY))

const mockResultsDisplay = computed(() => {
  return mergeResults.value.length <= MAX_DISPLAY ? mergeResults.value : mergeResults.value.slice(0, MAX_DISPLAY)
})
const mockResultsOverflow = computed(() => Math.max(0, mergeResults.value.length - MAX_DISPLAY))

function isClusterColored(idx) {
  return props.panel.level1ClustersColored.includes(idx)
}

function getNodeClass(clusterId, setIdx) {
  if (props.panel.level1ClustersColored.includes(setIdx)) {
    return `entity-${clusterColorMap.value[clusterId] || 1}`
  }
  return 'neutral'
}

function isGroupProcessing(groupIdx) {
  return props.panel.level1Processing && props.panel.processingSetIdx === groupIdx
}

// level1MergeResultsVisible is now an array — check per entity
function isEntityVisible(idx) {
  const vis = props.panel.level1MergeResultsVisible
  // backward compat: if boolean true, show all
  if (vis === true) return true
  if (Array.isArray(vis)) return vis.includes(idx)
  return false
}

function hasAnyMergeResult() {
  const vis = props.panel.level1MergeResultsVisible
  if (vis === true) return true
  if (Array.isArray(vis)) return vis.length > 0
  return false
}

// === Set tracking ===
const isTracking = computed(() => props.panel.trackedSetIdx != null)

function onClusterNodeClick(ck) {
  const setIdx = clusterIdToSetIdx.value[ck]
  if (setIdx != null) panelsStore.toggleTrackedSet(props.panel.id, setIdx)
}

function onEntityClick(entity) {
  // Find the set that contributes the most records to this entity
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

const trackedRecords = computed(() => {
  if (props.panel.trackedSetIdx == null) return null
  const set = props.panel.hierarchyData[0].sets[props.panel.trackedSetIdx]
  return set ? new Set(set.records) : null
})

// Map cluster ID (C1, C2...) → set index using clusterLabels
const clusterIdToSetIdx = computed(() => {
  const map = {}
  const labels = props.panel.hierarchyData[0].clusterLabels || []
  for (let si = 0; si < labels.length; si++) {
    for (const cid of labels[si]) {
      map[cid] = si
    }
  }
  return map
})

// Per-node highlight inside a merge group
function clusterNodeHighlightByKey(group, ck) {
  if (!isTracking.value) return ''
  if (!isMergeGroupTracked(group)) return ''
  const setIdx = clusterIdToSetIdx.value[ck]
  if (setIdx === props.panel.trackedSetIdx) return 'ring-tracked'
  return 'ring-partner'
}

// Snapshot: merge group contains the tracked set?
function isMergeGroupTracked(group) {
  if (props.panel.trackedSetIdx == null) return false
  return group.clusterIndices.includes(props.panel.trackedSetIdx)
}
function isMergeGroupDimmed(group) {
  return isTracking.value && !isMergeGroupTracked(group)
}

// Snapshot entity: overlaps with tracked set's records?
function isEntityTracked(entity) {
  if (!trackedRecords.value) return false
  return entity.records.some(r => trackedRecords.value.has(r))
}
function isEntityDimmed(entity) {
  return isTracking.value && !isEntityTracked(entity)
}

// Mock variants
function isMockMergeTracked(mset) {
  if (props.panel.trackedSetIdx == null) return false
  const trackedSetName = props.panel.hierarchyData[0].sets[props.panel.trackedSetIdx]?.id
  return mset.sources.includes(trackedSetName)
}
function isMockMergeDimmed(mset) {
  return isTracking.value && !isMockMergeTracked(mset)
}
function isMockEntityDimmed(entity) {
  return isTracking.value && !isMockEntityTracked(entity)
}
function isMockEntityTracked(entity) {
  if (!trackedRecords.value) return false
  const level0Results = panelsStore.buildLevel0ClusteringResults(props.panel)
  for (const setClusters of Object.values(level0Results)) {
    for (const cluster of setClusters) {
      if (entity.clusters.includes(cluster.id) && cluster.records.some(r => trackedRecords.value.has(r))) return true
    }
  }
  return false
}


</script>

<template>
  <div class="flow-container">
    <!-- ============ Snapshot: CMR merge flow (always shown) ============ -->
    <template v-if="panel.isSnapshot">

      <!-- Merge Groups row -->
      <div class="hierarchy-level">
        <div class="level-label">Merge Sets</div>
        <div class="record-set-container">
          <template v-if="panel.level1ClustersVisible">
            <div
              v-for="group in snapshotMergeGroupsDisplay"
              :key="group.idx"
              class="record-set"
              :class="{ processing: isGroupProcessing(group.idx), tracked: isMergeGroupTracked(group), dimmed: isMergeGroupDimmed(group) }"
              style="padding:4px;"
            >
              <div class="record-set-header small">
                Merge {{ group.idx + 1 }}
              </div>
              <div class="record-set-nodes" style="gap:4px;">
                <div
                  v-for="ck in group.clusterIds"
                  :key="ck"
                  class="cluster-node-ring"
                  :class="clusterNodeHighlightByKey(group, ck)"
                  @click="onClusterNodeClick(ck)"
                  style="cursor:pointer;"
                >
                  <RecordNode
                    :label="ck"
                    :title="ck"
                    :entityClass="`entity-${group.colorIdx}`"
                    size="cluster"
                  />
                </div>
              </div>
            </div>
            <div v-if="snapshotMergeOverflow > 0" class="overflow-card" @click="showModal = true">
              <span class="overflow-number">+{{ snapshotMergeOverflow }}</span>
              <span class="overflow-text">more groups</span>
            </div>
          </template>
          <div v-else class="waiting-msg">Waiting for Level 0 results...</div>
        </div>
      </div>

      <!-- Arrow -->
      <div class="arrow-row">
        <span class="arrow">↓</span>
        <span class="arrow-label">LLM Cluster Merge</span>
      </div>

      <!-- Merged entities row — now progressive -->
      <div class="hierarchy-level">
        <div class="level-label">Merged</div>
        <div class="record-set-container">
          <template v-if="hasAnyMergeResult()">
            <div
              v-for="(entity, idx) in snapshotEntitiesDisplay"
              :key="idx"
              v-show="isEntityVisible(idx)"
              class="record-set"
              :class="{ tracked: isEntityTracked(entity), dimmed: isEntityDimmed(entity) }"
              :style="{
                opacity: isEntityDimmed(entity) ? 0.2 : isEntityVisible(idx) ? 1 : 0,
                transform: isEntityVisible(idx) ? 'scale(1)' : 'scale(0.95)',
                transition: 'all 0.3s ease'
              }"
              style="padding:8px;min-width:70px;cursor:pointer;"
              @click="onEntityClick(entity)"
            >
              <div class="record-set-header small">Entity {{ idx + 1 }}</div>
              <ClusterGroup :entityClass="`entity-${entity.colorIdx}`" style="padding:4px 6px;margin-top:4px;">
                <RecordNode
                  v-for="r in entity.records.slice(0, entityRecordLimit(idx))"
                  :key="r"
                  :label="String(r).replace('r', '')"
                  :title="String(r)"
                  :entityClass="`entity-${entity.colorIdx}`"
                  size="small"
                />
                <span
                  v-if="entity.records.length > entityRecordLimit(idx)"
                  class="expand-hint-sm"
                  @click="toggleEntityExpand(idx, $event)"
                >+{{ entity.records.length - entityRecordLimit(idx) }}</span>
                <span
                  v-else-if="expandedEntities.has(idx)"
                  class="expand-hint-sm"
                  @click="toggleEntityExpand(idx, $event)"
                >−</span>
              </ClusterGroup>
            </div>
            <div v-if="snapshotEntitiesOverflow > 0" class="overflow-card" @click="showModal = true">
              <span class="overflow-number">+{{ snapshotEntitiesOverflow }}</span>
              <span class="overflow-text">more entities</span>
            </div>
          </template>
          <div v-else class="waiting-msg">Waiting for LLM...</div>
        </div>
      </div>

      <!-- Snapshot detail modal (with tracking) -->
      <LevelDetailModal
        v-if="showModal"
        :title="`Level 1: CMR — ${(panel.snapshotMergeGroups || []).length} Merge Groups → ${(panel.snapshotEntities || []).length} Entities`"
        @close="showModal = false"
      >
        <div class="modal-flow">
          <div class="hierarchy-level">
            <div class="level-label">Merge Sets</div>
            <div class="record-set-container">
              <div
                v-for="group in (panel.snapshotMergeGroups || [])"
                :key="group.idx"
                class="record-set"
                :class="{ tracked: isMergeGroupTracked(group), dimmed: isMergeGroupDimmed(group) }"
                style="padding:4px;"
              >
                <div class="record-set-header small">
                  Merge {{ group.idx + 1 }}
                </div>
                <div class="record-set-nodes" style="gap:4px;">
                  <div
                    v-for="ck in group.clusterIds"
                    :key="ck"
                    class="cluster-node-ring"
                    :class="clusterNodeHighlightByKey(group, ck)"
                  >
                    <RecordNode
                      :label="ck"
                      :title="ck"
                      :entityClass="`entity-${group.colorIdx}`"
                      size="cluster"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="arrow-row">
            <span class="arrow">↓</span>
            <span class="arrow-label">LLM Cluster Merge</span>
          </div>
          <div class="hierarchy-level">
            <div class="level-label">Merged</div>
            <div class="record-set-container">
              <div
                v-for="(entity, idx) in (panel.snapshotEntities || [])"
                :key="idx"
                v-show="isEntityVisible(idx)"
                class="record-set"
                :class="{ tracked: isEntityTracked(entity), dimmed: isEntityDimmed(entity) }"
                style="padding:8px;min-width:70px;cursor:pointer;"
                @click="onEntityClick(entity)"
              >
                <div class="record-set-header small">Entity {{ idx + 1 }}</div>
                <ClusterGroup :entityClass="`entity-${entity.colorIdx}`" style="padding:4px 6px;margin-top:4px;">
                  <RecordNode
                    v-for="r in entity.records.slice(0, modalEntityRecordLimit(idx))"
                    :key="r"
                    :label="String(r).replace('r', '')"
                    :title="String(r)"
                    :entityClass="`entity-${entity.colorIdx}`"
                    size="small"
                  />
                  <span
                    v-if="entity.records.length > modalEntityRecordLimit(idx)"
                    class="expand-hint-sm"
                    @click="toggleModalEntityExpand(idx, $event)"
                  >+{{ entity.records.length - modalEntityRecordLimit(idx) }}</span>
                  <span
                    v-else-if="expandedModalEntities.has(idx)"
                    class="expand-hint-sm"
                    @click="toggleModalEntityExpand(idx, $event)"
                  >−</span>
                </ClusterGroup>
              </div>
            </div>
          </div>
        </div>
      </LevelDetailModal>
    </template>

    <!-- ============ Normal mock CMR flow ============ -->
    <template v-else>

      <!-- Merge sets row -->
      <div class="hierarchy-level">
        <div class="level-label">Merge Sets</div>
        <div class="record-set-container">
          <template v-if="panel.level1ClustersVisible">
            <div
              v-for="(mset, setIdx) in mockMergeSetsDisplay"
              :key="setIdx"
              class="record-set"
              :class="{ processing: panel.processingSetIdx === setIdx && panel.level1Processing, tracked: isMockMergeTracked(mset), dimmed: isMockMergeDimmed(mset) }"
              style="padding:4px;"
            >
              <div class="record-set-header small">{{ mset.id }}</div>
              <div class="source-info">From: {{ mset.sources.join(', ') }}</div>
              <div class="record-set-nodes" style="gap:4px;">
                <div
                  v-for="(c, cIdx) in mset.clusters"
                  :key="cIdx"
                  class="cluster-node-wrapper"
                >
                  <RecordNode
                    :label="c.id"
                    :title="`${c.id} from ${c.sourceSet}`"
                    :entityClass="getNodeClass(c.id, setIdx)"
                    size="cluster"
                  />
                  <span class="source-badge">{{ c.sourceSet.replace('Set ', '') }}</span>
                </div>
              </div>
            </div>
            <div v-if="mockMergeOverflow > 0" class="overflow-card" @click="showModal = true">
              <span class="overflow-number">+{{ mockMergeOverflow }}</span>
              <span class="overflow-text">more sets</span>
            </div>
          </template>
          <div v-else class="waiting-msg">Waiting for Level 0 results...</div>
        </div>
      </div>

      <!-- Arrow -->
      <div class="arrow-row">
        <span class="arrow">↓</span>
        <span class="arrow-label">LLM Cluster Merge</span>
      </div>

      <!-- Merged results row — progressive -->
      <div class="hierarchy-level">
        <div class="level-label">Merged</div>
        <div class="record-set-container">
          <template v-if="hasAnyMergeResult()">
            <div
              v-for="(e, idx) in mockResultsDisplay"
              :key="idx"
              v-show="isEntityVisible(idx)"
              class="record-set"
              :class="{ tracked: isMockEntityTracked(e), dimmed: isMockEntityDimmed(e) }"
              :style="{
                opacity: isMockEntityDimmed(e) ? 0.2 : isEntityVisible(idx) ? 1 : 0,
                transform: isEntityVisible(idx) ? 'scale(1)' : 'scale(0.95)',
                transition: 'all 0.3s ease'
              }"
              style="padding:4px;min-width:55px;"
            >
              <div class="record-set-header small">Entity {{ idx + 1 }}</div>
              <ClusterGroup :entityClass="`entity-${(idx % 8) + 1}`" style="padding:2px 4px;margin-top:2px;">
                <RecordNode
                  v-for="c in e.clusters"
                  :key="c"
                  :label="c"
                  :entityClass="`entity-${(idx % 8) + 1}`"
                  size="medium"
                />
              </ClusterGroup>
            </div>
            <div v-if="mockResultsOverflow > 0" class="overflow-card" @click="showModal = true">
              <span class="overflow-number">+{{ mockResultsOverflow }}</span>
              <span class="overflow-text">more entities</span>
            </div>
          </template>
          <div v-else class="waiting-msg">Waiting for LLM...</div>
        </div>
      </div>
    </template>
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
.cmr-desc {
  font-size: 9px;
  color: var(--text-secondary);
  padding: 4px 8px;
  background: #f1f5f9;
  border-radius: 4px;
}
.cmr-desc strong {
  color: var(--primary);
}
.hierarchy-level {
  display: flex;
  align-items: center;
  gap: 8px;
}
.level-label {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-secondary);
  min-width: 40px;
  text-align: right;
}
.record-set-container {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  flex: 1;
}
.record-set {
  background: white;
  border: 2px solid var(--border-light);
  border-radius: 8px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 55px;
  transition: all 0.3s;
}
.record-set.processing {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(26, 54, 93, 0.2);
}
.record-set-header {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-secondary);
  text-align: center;
}
.record-set-header.small {
  font-size: 9px;
}
.record-set-nodes {
  display: flex;
  gap: 2px;
  flex-wrap: wrap;
  justify-content: center;
}
.source-info {
  font-size: 7px;
  color: var(--text-muted);
  margin-bottom: 2px;
  text-align: center;
}
.cluster-node-wrapper {
  position: relative;
}
.source-badge {
  position: absolute;
  bottom: -2px;
  right: -2px;
  font-size: 6px;
  background: var(--primary);
  color: white;
  padding: 1px 2px;
  border-radius: 2px;
}
.same-entity-label {
  font-size: 7px;
  color: #16a34a;
  margin-top: 2px;
  text-align: center;
}
.overflow-hint-sm {
  font-size: 7px;
  color: var(--text-secondary);
}
.arrow-row {
  text-align: center;
  padding: 2px 0;
}
.arrow {
  font-size: 16px;
  color: var(--text-muted);
}
.arrow-label {
  font-size: 10px;
  color: var(--text-secondary);
  margin-left: 4px;
  font-weight: 700;
}
.waiting-msg {
  font-size: 9px;
  color: var(--text-muted);
  text-align: center;
  padding: 6px;
  opacity: 0.5;
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
.expand-hint-sm {
  font-size: 7px;
  color: var(--primary);
  cursor: pointer;
  font-weight: 700;
  text-align: center;
}
.expand-hint-sm:hover {
  text-decoration: underline;
}
.modal-flow {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cluster-node-ring {
  border-radius: 50%;
  padding: 2px;
  transition: all 0.3s;
}
.cluster-node-ring.ring-tracked {
  box-shadow: 0 0 0 3px #f59e0b;
}
.cluster-node-ring.ring-partner {
  box-shadow: 0 0 0 3px #06b6d4;
}
.record-set.tracked {
  border-color: #f59e0b;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.25);
}
.record-set.dimmed {
  opacity: 0.2;
}
</style>
