<script setup>
import { ref } from 'vue'
import { useConfigStore } from '../../stores/config.js'

const config = useConfigStore()
const advancedOpen = ref('')
</script>

<template>
  <div class="config-section">
    <div class="section-title">Algorithm Parameters</div>

    <div class="param-group">
      <div class="param-label">API Key</div>
      <el-input
        v-model="config.apiKey"
        type="password"
        show-password
        size="small"
        placeholder="sk-..."
      />
    </div>

    <div class="param-group">
      <div class="param-label">Blocking Strategy</div>
      <el-select v-model="config.blockingStrategy" size="small" style="width:100%">
        <el-option label="Filtering-based Block Creation" value="filtering" />
        <el-option label="LSH-based Blocking" value="lsh" />
        <el-option label="Canopy Blocking" value="canopy" />
      </el-select>
    </div>

    <el-collapse v-model="advancedOpen" class="advanced-collapse">
      <el-collapse-item title="Advanced Settings" name="advanced">
        <div class="param-group">
          <div class="param-row">
            <span class="param-label">S_s</span>
            <el-input-number v-model="config.paramSs" :min="2" :max="20" size="small" controls-position="right" />
          </div>
        </div>
        <div class="param-group">
          <div class="param-row">
            <span class="param-label">S_d</span>
            <el-input-number v-model="config.paramSd" :min="1" :max="10" size="small" controls-position="right" />
          </div>
        </div>
        <div class="param-group">
          <div class="param-row">
            <span class="param-label">S_v</span>
            <el-input-number v-model="config.paramSv" :min="1" :max="10" size="small" controls-position="right" />
          </div>
        </div>
        <div class="param-group">
          <div class="param-row">
            <span class="param-label">MDG Retry Times</span>
            <el-input-number v-model="config.mdgRetryTimes" :min="1" :max="10" size="small" controls-position="right" />
          </div>
        </div>
        <div class="param-group">
          <div class="param-row">
            <span class="param-label">MDG Mode</span>
            <el-switch
              v-model="config.mdgEnabled"
              size="small"
              style="--el-switch-on-color: #1a365d; --el-switch-off-color: #f59e0b;"
            />
          </div>
          <div v-if="!config.mdgEnabled" class="mdg-hint">
            You will manually review each NRS clustering result
          </div>
        </div>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<style scoped>
.config-section {
  background: white;
  border-radius: 6px;
  padding: 5px 7px;
}
.section-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
  margin-bottom: 3px;
}
.param-group {
  margin-bottom: 2px;
}
.param-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-secondary);
  margin-bottom: 1px;
}
.param-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.param-value {
  font-size: 10px;
  font-weight: 600;
  color: var(--primary);
}
.advanced-collapse {
  border: none;
}
.advanced-collapse :deep(.el-collapse-item__header) {
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
  height: 24px;
  border-top: 1px solid var(--border-light);
  border-bottom: none;
  background: transparent;
}
.advanced-collapse :deep(.el-collapse-item__wrap) {
  border-bottom: none;
}
.advanced-collapse :deep(.el-collapse-item__content) {
  padding-bottom: 0;
}
.config-section :deep(.el-slider) {
  --el-slider-height: 4px;
  --el-slider-button-size: 10px;
  margin: 0;
  padding: 0 4px;
}
.config-section :deep(.el-input-number--small) {
  width: 80px;
}
.mdg-hint {
  font-size: 8px;
  color: #f59e0b;
  margin-top: 2px;
  font-weight: 600;
}
</style>
