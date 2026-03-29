<script setup>
import { ref, watch, nextTick, onMounted } from 'vue'
import { useLlmLogStore } from '../../stores/llmLog.js'
import { useConfigStore } from '../../stores/config.js'
import LogEntry from './LogEntry.vue'

const logStore = useLlmLogStore()
const config = useConfigStore()
const logContainer = ref(null)

onMounted(() => {
  config.loadModels()
})

// Auto scroll to bottom when new entries appear
watch(() => logStore.entries.length, async () => {
  await nextTick()
  if (logContainer.value) {
    logContainer.value.scrollTop = logContainer.value.scrollHeight
  }
})
</script>

<template>
  <div class="llm-section">
    <div class="llm-header">
      <span class="llm-title">LLM API Call</span>
      <el-select
        v-model="config.selectedModel"
        size="small"
        class="model-select"
        style="width:120px"
      >
        <el-option
          v-for="m in config.models"
          :key="m.value"
          :label="m.label"
          :value="m.value"
        />
      </el-select>
    </div>

    <!-- Stats bar -->
    <div class="compact-stats">
      <span class="stat-item">
        <span class="stat-label">Tokens:</span>
        <span class="stat-value">{{ logStore.totalTokens }}</span>
      </span>
      <span class="stat-item">
        <span class="stat-label">Calls:</span>
        <span class="stat-value">#{{ logStore.totalCalls }}</span>
      </span>
      <span class="stat-item">
        <span class="stat-label">Cost:</span>
        <span class="stat-value">${{ logStore.totalCost.toFixed(3) }}</span>
      </span>
    </div>

    <!-- Live log -->
    <div ref="logContainer" class="live-log">
      <div v-if="logStore.entries.length === 0" class="log-empty">
        Click Start to begin...
      </div>
      <LogEntry
        v-for="entry in logStore.entries"
        :key="entry.id"
        :entry="entry"
      />
    </div>
  </div>
</template>

<style scoped>
.llm-section {
  background: var(--dark-bg);
  border-radius: 6px;
  padding: 4px 5px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.llm-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 3px;
  padding-bottom: 2px;
  border-bottom: 1px solid var(--dark-border);
}
.llm-title {
  font-size: 10px;
  font-weight: 700;
  color: var(--dark-text-subtle);
}
.model-select :deep(.el-input__wrapper) {
  background: var(--dark-card);
  border: 1px solid var(--dark-border);
  box-shadow: none;
}
.model-select :deep(.el-input__inner) {
  color: var(--dark-text);
  font-size: 10px;
  font-weight: 600;
}

.compact-stats {
  display: flex;
  justify-content: space-between;
  padding: 3px 6px;
  background: var(--dark-deep);
  border-radius: 3px;
  margin-bottom: 3px;
  font-size: 11px;
}
.stat-item { color: var(--dark-text-muted); }
.stat-label { margin-right: 2px; }
.stat-value {
  color: var(--dark-text);
  font-weight: 600;
  font-family: 'Monaco', monospace;
}

.live-log {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px;
}
.log-empty {
  color: var(--dark-border);
  font-size: 10px;
  text-align: center;
  padding: 20px;
}
</style>
