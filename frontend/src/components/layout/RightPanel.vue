<script setup>
import LlmSection from '../right/LlmSection.vue'
import ErResultSection from '../right/ErResultSection.vue'
import PerformanceMetrics from '../right/PerformanceMetrics.vue'
</script>

<template>
  <div class="right-panel">
    <LlmSection />
    <ErResultSection />
    <PerformanceMetrics />
  </div>
</template>

<style scoped>
.right-panel {
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow-y: auto;
  min-height: 0;
}
</style>
