<script setup>
import { computed, inject, ref } from 'vue'
import { getRecordById } from '../../utils/entityHelpers.js'

const props = defineProps({
  label: { type: String, required: true },
  entityClass: { type: String, default: 'neutral' },
  size: { type: String, default: 'normal' },
  title: { type: String, default: '' },
  recordId: { type: String, default: '' },
  highlighted: { type: Boolean, default: false }
})

const emit = defineEmits(['track'])

function resolveRid() {
  return props.recordId || props.title || `r${props.label}`
}
function onClick() {
  emit('track', resolveRid())
}

const injectedRecordsMap = inject('recordsMap', ref({}))

const record = computed(() => {
  const rid = props.recordId || props.title || props.label
  const map = injectedRecordsMap.value || {}
  // Keys are "r0","r1",... — try both "r0" and "0" forms
  return map[rid] || map[`r${rid}`] || map[`r${props.label}`]
      || getRecordById(rid) || getRecordById(`r${props.label}`)
})

const attrs = computed(() => {
  if (!record.value) return []
  return Object.entries(record.value)
    .filter(([k]) => k !== 'entity' && k !== 'combined_text')
    .map(([k, v]) => ({ key: k, val: v == null ? '' : String(v) }))
})
</script>

<template>
  <el-popover
    trigger="click"
    placement="top"
    :width="240"
    :show-arrow="true"
    popper-class="record-popover"
  >
    <template #reference>
      <div
        class="node"
        :class="[entityClass, size, { 'node-highlighted': highlighted }]"
        @click.stop="onClick"
      >
        {{ label }}
      </div>
    </template>
    <div class="record-detail">
      <div v-if="attrs.length" class="attr-list">
        <div v-for="a in attrs" :key="a.key" class="attr-row">
          <span class="attr-key">{{ a.key }}</span>
          <span class="attr-val">{{ a.val || '—' }}</span>
        </div>
      </div>
      <div v-else class="no-data">No record data</div>
    </div>
  </el-popover>
</template>

<style scoped>
.node {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  font-weight: 700;
  border: 2px solid;
  cursor: pointer;
  transition: all 0.3s;
}
.node:hover {
  transform: scale(1.2);
  z-index: 10;
}
.node.node-highlighted {
  box-shadow: 0 0 0 3px #f59e0b;
  transform: scale(1.3);
  z-index: 20;
}
.node.small {
  width: 16px;
  height: 16px;
  font-size: 7px;
}
.node.tiny {
  width: 14px;
  height: 14px;
  font-size: 6px;
}
.node.cluster {
  width: 24px;
  height: 22px;
  font-size: 7px;
  border-radius: 50%;
  position: relative;
}
.node.medium {
  width: 16px;
  height: 16px;
  font-size: 7px;
}
.record-detail {
  max-height: 200px;
  overflow-y: auto;
}
.attr-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.attr-row {
  display: flex;
  gap: 6px;
  font-size: 11px;
  line-height: 1.3;
}
.attr-key {
  font-weight: 700;
  color: #475569;
  white-space: nowrap;
  min-width: 50px;
}
.attr-val {
  color: #1e293b;
  word-break: break-all;
}
.no-data {
  font-size: 11px;
  color: #94a3b8;
  text-align: center;
  padding: 4px;
}
</style>
