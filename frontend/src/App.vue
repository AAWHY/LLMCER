<script setup>
import { onMounted, watch } from 'vue'
import { usePanelsStore } from './stores/panels.js'
import { useConfigStore } from './stores/config.js'
import AppHeader from './components/layout/AppHeader.vue'
import LeftPanel from './components/layout/LeftPanel.vue'
import CenterPanel from './components/layout/CenterPanel.vue'
import RightPanel from './components/layout/RightPanel.vue'

const panelsStore = usePanelsStore()
const configStore = useConfigStore()

onMounted(() => {
  panelsStore.addPanel(configStore.paramSs)
})

// Sync left panel S_s with the initial (non-snapshot) panel in real-time
watch(() => configStore.paramSs, (newSs) => {
  const initialPanel = panelsStore.panels.find(p => !p.isSnapshot && !p.paramSs && !p.status)
  if (initialPanel) {
    panelsStore.updatePanelSetSize(initialPanel.id, newSs)
  }
})
</script>

<template>
  <div class="main-container">
    <AppHeader />
    <div class="main-grid">
      <LeftPanel />
      <CenterPanel />
      <RightPanel />
    </div>
  </div>
</template>

<style scoped>
.main-container {
  background: var(--bg-page);
  border-radius: 10px;
  padding: 4px;
  width: 1200px;
  margin: 0 auto;
  height: calc(100vh - 8px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.main-grid {
  display: grid;
  grid-template-columns: var(--left-width) 1fr var(--right-width);
  gap: var(--gap);
  flex: 1;
  min-height: 0;
}
</style>
