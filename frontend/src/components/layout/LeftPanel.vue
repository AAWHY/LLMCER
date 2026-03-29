<script setup>
import DatasetSelector from '../left/DatasetSelector.vue'
import RawDataViewer from '../left/RawDataViewer.vue'
import ParameterSettings from '../left/ParameterSettings.vue'
import ControlButtons from '../left/ControlButtons.vue'
</script>

<template>
  <div class="left-panel">
    <DatasetSelector />
    <RawDataViewer />
    <ParameterSettings />
    <ControlButtons />
  </div>
</template>

<style scoped>
.left-panel {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-height: 0;
  overflow: hidden;
}
</style>
