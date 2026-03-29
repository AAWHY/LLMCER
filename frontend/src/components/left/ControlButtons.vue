<script setup>
import { useSimulationStore } from '../../stores/simulation.js'
import { useSimulation } from '../../composables/useSimulation.js'

const simStore = useSimulationStore()
const { runSimulation, resetAll } = useSimulation()

function handleStart() {
  if (simStore.isRunning) return
  runSimulation()
}

function handleReset() {
  resetAll()
}
</script>

<template>
  <div class="config-section">
    <div class="section-title">Controls</div>
    <div class="control-buttons">
      <el-button
        type="primary"
        size="small"
        :disabled="simStore.isRunning"
        @click="handleStart"
      >
        <template v-if="simStore.isRunning">&#9679; Running...</template>
        <template v-else>&#9654; Start Demo</template>
      </el-button>
      <el-button size="small" @click="handleReset">
        &#8634; Reset
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.config-section {
  background: white;
  border-radius: 6px;
  padding: 4px 7px;
}
.section-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
  margin-bottom: 3px;
}
.control-buttons {
  display: flex;
  gap: 4px;
}
.control-buttons .el-button {
  width: 100%;
  margin-left: 0;
}
</style>
