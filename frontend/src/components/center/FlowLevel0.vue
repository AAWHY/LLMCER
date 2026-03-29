<script setup>
import { computed, ref, reactive, provide } from 'vue'
import { usePanelsStore } from '../../stores/panels.js'
import { useSimulationStore } from '../../stores/simulation.js'
import RecordNode from './RecordNode.vue'
import ClusterGroup from './ClusterGroup.vue'
import LevelDetailModal from './LevelDetailModal.vue'

const props = defineProps({
  panel: { type: Object, required: true }
})

const panelsStore = usePanelsStore()
const simStore = useSimulationStore()

const isMdgActive = computed(() => simStore.mdgPendingSetIdx !== -1)
function isMdgPending(idx) {
  // Snapshot mode only: matches specific set idx (>= 0)
  // Live pipeline uses the mdg-result-card panel instead
  return simStore.mdgPendingSetIdx >= 0 && simStore.mdgPendingSetIdx === idx
}
function onMdgAccept() { simStore.respondMdgReview(true) }
function onMdgReject() { simStore.respondMdgReview(false) }

provide('recordsMap', computed(() => props.panel.recordsMap || {}))

// --- Set tracking ---
const isTracking = computed(() => props.panel.trackedSetIdx != null)
function isTrackedSet(idx) { return props.panel.trackedSetIdx === idx }
function onSetClick(idx) {
  panelsStore.toggleTrackedSet(props.panel.id, idx)
}

// Partner sets: only from merge groups whose results are already visible (colored)
const partnerSetIndices = computed(() => {
  if (props.panel.trackedSetIdx == null) return new Set()
  const groups = props.panel.snapshotMergeGroups || []
  const colored = props.panel.level1ClustersColored || []
  const partners = new Set()
  for (const g of groups) {
    // Only consider this merge group if its clusters have been colored (result shown)
    const groupDone = g.clusterIndices.some(ci => colored.includes(ci))
    if (groupDone && g.clusterIndices.includes(props.panel.trackedSetIdx)) {
      g.clusterIndices.forEach(ci => {
        if (ci !== props.panel.trackedSetIdx) partners.add(ci)
      })
    }
  }
  return partners
})
function isPartnerSet(idx) { return partnerSetIndices.value.has(idx) }
function isDimmed(idx) {
  if (!isTracking.value) return false
  if (isTrackedSet(idx)) return false
  if (isPartnerSet(idx)) return false
  // During Level 0, only dim non-tracked sets (no partner info yet)
  return true
}
function setHighlightClass(idx) {
  if (isTrackedSet(idx)) return 'tracked'
  if (isPartnerSet(idx)) return 'partner'
  return ''
}

// --- Level overflow (Modal) ---
const MAX_DISPLAY = 5
const showModal = ref(false)

const level0Data = computed(() => props.panel.hierarchyData[0])

const displayedSets = computed(() => {
  const sets = level0Data.value.sets
  return sets.length <= MAX_DISPLAY ? sets : sets.slice(0, MAX_DISPLAY)
})
const displayedResults = computed(() => {
  const results = level0Data.value.results
  return results.length <= MAX_DISPLAY ? results : results.slice(0, MAX_DISPLAY)
})
const setsOverflow = computed(() => Math.max(0, level0Data.value.sets.length - MAX_DISPLAY))

// --- Per-set expand (records inside a single set card) ---
const expandedInputSets = reactive(new Set())
const expandedResultSets = reactive(new Set())

function toggleInputExpand(idx, ev) {
  ev.stopPropagation()
  expandedInputSets.has(idx) ? expandedInputSets.delete(idx) : expandedInputSets.add(idx)
}
function toggleResultExpand(idx, ev) {
  ev.stopPropagation()
  expandedResultSets.has(idx) ? expandedResultSets.delete(idx) : expandedResultSets.add(idx)
}

function inputRecordLimit(idx) { return expandedInputSets.has(idx) ? Infinity : 9 }
function resultRecordLimit(idx) { return expandedResultSets.has(idx) ? Infinity : 4 }
function resultClusterLimit(idx) { return expandedResultSets.has(idx) ? Infinity : 4 }

// Modal per-set expand (separate state from main view)
const expandedModalInputSets = reactive(new Set())
const expandedModalResultSets = reactive(new Set())
function toggleModalInputExpand(idx, ev) {
  ev.stopPropagation()
  expandedModalInputSets.has(idx) ? expandedModalInputSets.delete(idx) : expandedModalInputSets.add(idx)
}
function toggleModalResultExpand(idx, ev) {
  ev.stopPropagation()
  expandedModalResultSets.has(idx) ? expandedModalResultSets.delete(idx) : expandedModalResultSets.add(idx)
}
function modalInputRecordLimit(idx) { return expandedModalInputSets.has(idx) ? Infinity : 9 }
function modalResultRecordLimit(idx) { return expandedModalResultSets.has(idx) ? Infinity : 4 }
function modalResultClusterLimit(idx) { return expandedModalResultSets.has(idx) ? Infinity : 4 }

// --- Color maps ---
const blockColorMaps = computed(() => {
  const maps = []
  const results = level0Data.value.results
  for (let i = 0; i < results.length; i++) {
    const colorMap = {}
    const clusters = results[i].clusters || []
    const isSingle = clusters.length <= 1
    clusters.forEach((cluster, cIdx) => {
      const color = isSingle ? (i % 8) + 1 : (cIdx % 8) + 1
      cluster.forEach(rid => { colorMap[rid] = color })
    })
    maps.push({ map: colorMap, isSingle, numClusters: clusters.length })
  }
  return maps
})

function getRecordColor(blockIdx, recordId) {
  return blockColorMaps.value[blockIdx]?.map[recordId] || 1
}
function getClusterColor(blockIdx, clusterIdx) {
  const info = blockColorMaps.value[blockIdx]
  if (info?.isSingle) return (blockIdx % 8) + 1
  return (clusterIdx % 8) + 1
}

// --- Visibility ---
function isSetVisible(idx) { return props.panel.inputSetsVisible.includes(idx) }
function isSetColored(idx) { return props.panel.inputSetsColored.includes(idx) }
function isResultVisible(idx) { return props.panel.resultSetsVisible.includes(idx) }
function hasAnyResult() { return props.panel.resultSetsVisible.length > 0 }
function isProcessing(idx) { return props.panel.processingSetIdx === idx }

const showClusterLabels = computed(() => !props.panel.level0Processing)

const totalClusters = computed(() => {
  return level0Data.value.results.reduce((sum, r) => sum + (r.clusters?.length || 0), 0)
})
const displayedClusters = computed(() => {
  return displayedResults.value.reduce((sum, r) => sum + (r.clusters?.length || 0), 0)
})
const overflowClusters = computed(() => totalClusters.value - displayedClusters.value)

function getClusterLabel(setIdx, cIdx) {
  if (!showClusterLabels.value) return ''
  const labels = level0Data.value.clusterLabels
  return labels && labels[setIdx] ? labels[setIdx][cIdx] || '' : ''
}

function getSortedRecords(idx) {
  const set = level0Data.value.sets[idx]
  if (!set) return []
  if (!isSetColored(idx)) return set.records
  const colorMap = blockColorMaps.value[idx]?.map || {}
  return [...set.records].sort((a, b) => (colorMap[a] || 0) - (colorMap[b] || 0))
}
</script>

<template>
  <div class="flow-container">
    <!-- Input row -->
    <div class="hierarchy-level">
      <div class="level-label">Input</div>
      <div class="record-set-container">
        <div
          v-for="(set, idx) in displayedSets"
          :key="idx"
          v-show="isSetVisible(idx)"
          class="record-set"
          :class="[{ processing: isProcessing(idx), dimmed: isDimmed(idx) }, setHighlightClass(idx)]"
          @click="onSetClick(idx)"
          style="cursor:pointer;"
        >
          <div class="record-set-header">{{ set.id }}</div>
          <div class="record-set-nodes">
            <RecordNode
              v-for="r in getSortedRecords(idx).slice(0, inputRecordLimit(idx))"
              :key="r"
              :label="r.replace('r', '')"
              :title="r"
              :entityClass="isSetColored(idx) ? `entity-${getRecordColor(idx, r)}` : 'neutral'"
            />
            <span
              v-if="set.records.length > inputRecordLimit(idx)"
              class="expand-hint"
              @click="toggleInputExpand(idx, $event)"
            >+{{ set.records.length - inputRecordLimit(idx) }}</span>
            <span
              v-else-if="expandedInputSets.has(idx)"
              class="expand-hint"
              @click="toggleInputExpand(idx, $event)"
            >−</span>
          </div>
        </div>
        <div v-if="setsOverflow > 0 && panel.inputSetsVisible.length > 0" class="overflow-card" @click="showModal = true">
          <span class="overflow-number">+{{ setsOverflow }}</span>
          <span class="overflow-text">more sets</span>
        </div>
      </div>
    </div>

    <!-- Arrow -->
    <div class="arrow-row">
      <span class="arrow">↓</span>
      <span class="arrow-label">LLM Clustering</span>
    </div>

    <!-- Result row -->
    <div class="hierarchy-level">
      <div class="level-label">Result</div>
      <div class="record-set-container">
        <template v-if="hasAnyResult()">
          <div
            v-for="(result, idx) in displayedResults"
            :key="idx"
            v-show="isResultVisible(idx)"
            class="record-set result-set"
            :class="[{ dimmed: isDimmed(idx) }, setHighlightClass(idx)]"
            @click="onSetClick(idx)"
            style="cursor:pointer;"
          >
            <div class="record-set-header small">{{ level0Data.sets[idx].id }}</div>
            <div class="cluster-result">
              <ClusterGroup
                v-for="(cluster, cIdx) in result.clusters.slice(0, resultClusterLimit(idx))"
                :key="cIdx"
                :entityClass="`entity-${getClusterColor(idx, cIdx)}`"
                compact
              >
                <div class="cluster-label">{{ getClusterLabel(idx, cIdx) }}</div>
                <RecordNode
                  v-for="r in cluster.slice(0, resultRecordLimit(idx))"
                  :key="r"
                  :label="r.replace('r', '')"
                  :title="r"
                  :entityClass="`entity-${getClusterColor(idx, cIdx)}`"
                  size="small"
                />
                <span
                  v-if="cluster.length > resultRecordLimit(idx)"
                  class="expand-hint-sm"
                  @click="toggleResultExpand(idx, $event)"
                >+{{ cluster.length - resultRecordLimit(idx) }}</span>
              </ClusterGroup>
              <div
                v-if="result.clusters.length > resultClusterLimit(idx)"
                class="more-clusters expand-hint-sm"
                @click="toggleResultExpand(idx, $event)"
              >+{{ result.clusters.length - resultClusterLimit(idx) }} more</div>
              <span
                v-else-if="expandedResultSets.has(idx)"
                class="expand-hint-sm"
                @click="toggleResultExpand(idx, $event)"
              >−</span>
            </div>
            <!-- MDG Human Review buttons -->
            <div v-if="isMdgPending(idx)" class="mdg-review-bar">
              <button class="mdg-btn accept" @click.stop="onMdgAccept">✓ Accept</button>
              <button class="mdg-btn reject" @click.stop="onMdgReject">✗ Reject</button>
            </div>
          </div>
          <div v-if="setsOverflow > 0" class="overflow-card" @click="showModal = true">
            <span class="overflow-number">+{{ overflowClusters }}</span>
            <span class="overflow-text">more clusters</span>
          </div>
        </template>
        <!-- Live pipeline MDG: result card with review buttons (outside template so it shows even with no results yet) -->
        <div
          v-if="simStore.mdgReviewData && simStore.mdgPendingSetIdx === -2"
          :key="'mdg-' + simStore.mdgReviewCounter"
          class="record-set result-set"
        >
          <div class="record-set-header small">{{ simStore.mdgReviewData?.setName || 'NRS Result' }} — Review</div>
          <div class="cluster-result">
            <ClusterGroup
              v-for="(c, i) in simStore.mdgReviewData.clusters"
              :key="i"
              :entityClass="`entity-${(i % 8) + 1}`"
              compact
            >
              <RecordNode
                v-for="rid in c.slice(0, 6)"
                :key="rid"
                :label="String(rid)"
                :entityClass="`entity-${(i % 8) + 1}`"
                size="small"
              />
              <span v-if="c.length > 6" class="expand-hint-sm">+{{ c.length - 6 }}</span>
            </ClusterGroup>
          </div>
          <div class="mdg-review-bar">
            <button class="mdg-btn accept" @click.stop="onMdgAccept">✓ Accept</button>
            <button class="mdg-btn reject" @click.stop="onMdgReject">✗ Reject</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Detail modal (all sets, with tracking) -->
    <LevelDetailModal
      v-if="showModal"
      :title="`Level 0: NRS — ${level0Data.sets.length} Input Sets → ${totalClusters} Result Clusters`"
      @close="showModal = false"
    >
      <div class="modal-flow">
        <div class="hierarchy-level">
          <div class="level-label">Input</div>
          <div class="record-set-container">
            <div
              v-for="(set, idx) in level0Data.sets"
              :key="idx"
              class="record-set"
              :class="[{ dimmed: isDimmed(idx), 'mdg-source': simStore.mdgReviewData?.setIdx === idx }, setHighlightClass(idx)]"
              :style="{ opacity: isDimmed(idx) ? 0.2 : isSetVisible(idx) ? 1 : 0.3 }"
              @click="onSetClick(idx)"
              style="cursor:pointer;"
            >
              <div class="record-set-header">{{ set.id }}</div>
              <div class="record-set-nodes">
                <RecordNode
                  v-for="r in getSortedRecords(idx).slice(0, modalInputRecordLimit(idx))"
                  :key="r"
                  :label="r.replace('r', '')"
                  :title="r"
                  :entityClass="isSetColored(idx) ? `entity-${getRecordColor(idx, r)}` : 'neutral'"
                />
                <span
                  v-if="set.records.length > modalInputRecordLimit(idx)"
                  class="expand-hint"
                  @click="toggleModalInputExpand(idx, $event)"
                >+{{ set.records.length - modalInputRecordLimit(idx) }}</span>
                <span
                  v-else-if="expandedModalInputSets.has(idx)"
                  class="expand-hint"
                  @click="toggleModalInputExpand(idx, $event)"
                >−</span>
              </div>
            </div>
          </div>
        </div>

        <div class="arrow-row">
          <span class="arrow">↓</span>
          <span class="arrow-label">LLM Clustering</span>
        </div>

        <div class="hierarchy-level">
          <div class="level-label">Result</div>
          <div class="record-set-container">
            <div
              v-for="(result, idx) in level0Data.results"
              :key="idx"
              v-show="isResultVisible(idx)"
              class="record-set result-set"
              :class="[{ dimmed: isDimmed(idx) }, setHighlightClass(idx)]"
            >
              <div class="record-set-header small">{{ level0Data.sets[idx].id }}</div>
              <div class="cluster-result">
                <ClusterGroup
                  v-for="(cluster, cIdx) in result.clusters.slice(0, modalResultClusterLimit(idx))"
                  :key="cIdx"
                  :entityClass="`entity-${getClusterColor(idx, cIdx)}`"
                  compact
                >
                  <div class="cluster-label">{{ getClusterLabel(idx, cIdx) }}</div>
                  <RecordNode
                    v-for="r in cluster.slice(0, modalResultRecordLimit(idx))"
                    :key="r"
                    :label="r.replace('r', '')"
                    :title="r"
                    :entityClass="`entity-${getClusterColor(idx, cIdx)}`"
                    size="small"
                  />
                  <span
                    v-if="cluster.length > modalResultRecordLimit(idx)"
                    class="expand-hint-sm"
                    @click="toggleModalResultExpand(idx, $event)"
                  >+{{ cluster.length - modalResultRecordLimit(idx) }}</span>
                </ClusterGroup>
                <div
                  v-if="result.clusters.length > modalResultClusterLimit(idx)"
                  class="more-clusters expand-hint-sm"
                  @click="toggleModalResultExpand(idx, $event)"
                >+{{ result.clusters.length - modalResultClusterLimit(idx) }} more</div>
                <span
                  v-else-if="expandedModalResultSets.has(idx)"
                  class="expand-hint-sm"
                  @click="toggleModalResultExpand(idx, $event)"
                >−</span>
              </div>
              <!-- MDG Human Review buttons (modal) -->
              <div v-if="isMdgPending(idx)" class="mdg-review-bar">
                <button class="mdg-btn accept" @click.stop="onMdgAccept">✓ Accept</button>
                <button class="mdg-btn reject" @click.stop="onMdgReject">✗ Reject</button>
              </div>
            </div>
            <!-- MDG review card in modal -->
            <div
              v-if="simStore.mdgReviewData && simStore.mdgPendingSetIdx === -2"
              :key="'mdg-modal-' + simStore.mdgReviewCounter"
              class="record-set result-set"
            >
              <div class="record-set-header small">{{ simStore.mdgReviewData?.setName || 'NRS Result' }} — Review</div>
              <div class="cluster-result">
                <ClusterGroup
                  v-for="(c, i) in simStore.mdgReviewData.clusters"
                  :key="i"
                  :entityClass="`entity-${(i % 8) + 1}`"
                  compact
                >
                  <RecordNode
                    v-for="rid in c.slice(0, 6)"
                    :key="rid"
                    :label="String(rid).replace('r', '')"
                    :title="String(rid)"
                    :entityClass="`entity-${(i % 8) + 1}`"
                    size="small"
                  />
                  <span v-if="c.length > 6" class="expand-hint-sm">+{{ c.length - 6 }}</span>
                </ClusterGroup>
              </div>
              <div class="mdg-review-bar">
                <button class="mdg-btn accept" @click.stop="onMdgAccept">✓ Accept</button>
                <button class="mdg-btn reject" @click.stop="onMdgReject">✗ Reject</button>
              </div>
            </div>
          </div>
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
  min-width: 70px;
  transition: all 0.3s;
}
.record-set.processing {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(26, 54, 93, 0.2);
}
.record-set.mdg-source {
  border-color: #f59e0b;
  box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.3);
  opacity: 1 !important;
}
.record-set.tracked {
  border-color: #f59e0b;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.25);
}
.record-set.partner {
  border-color: #06b6d4;
  box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.25);
}
.record-set.dimmed {
  opacity: 0.2;
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
.result-set {
  padding: 4px;
}
.cluster-result {
  display: flex;
  flex-direction: column;
  gap: 3px;
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
.cluster-label {
  font-size: 7px;
  font-weight: 700;
  color: var(--text-muted);
  text-align: center;
  margin-bottom: 1px;
}
.expand-hint {
  font-size: 8px;
  color: var(--primary);
  cursor: pointer;
  font-weight: 700;
}
.expand-hint:hover {
  text-decoration: underline;
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
.overflow-hint {
  font-size: 8px;
  color: var(--text-muted);
}
.overflow-hint-sm {
  font-size: 7px;
  color: var(--text-secondary);
}
.more-clusters {
  font-size: 8px;
  color: var(--text-muted);
  text-align: center;
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
.modal-flow {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mdg-review-bar {
  display: flex;
  gap: 4px;
  justify-content: center;
  margin-top: 4px;
}
.mdg-btn {
  font-size: 9px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
}
.mdg-btn.accept {
  background: #16a34a;
  color: white;
}
.mdg-btn.accept:hover {
  background: #15803d;
}
.mdg-btn.reject {
  background: #dc2626;
  color: white;
}
.mdg-btn.reject:hover {
  background: #b91c1c;
}
</style>
