<script setup>
defineProps({
  title: { type: String, default: '' }
})
defineEmits(['close'])
</script>

<template>
  <Teleport to="body">
    <div class="level-modal-overlay" @click.self="$emit('close')">
      <div class="level-modal">
        <div class="level-modal-header">
          <span class="level-modal-title">{{ title }}</span>
          <button class="level-modal-close" @click="$emit('close')">&times;</button>
        </div>
        <div class="level-modal-body">
          <slot />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.level-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}
.level-modal {
  background: white;
  border-radius: 12px;
  max-width: 90vw;
  max-height: 85vh;
  min-width: 400px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}
.level-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.level-modal-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--primary, #1a365d);
}
.level-modal-close {
  background: none;
  border: none;
  font-size: 20px;
  color: #94a3b8;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.level-modal-close:hover {
  color: #334155;
}
.level-modal-body {
  overflow-y: auto;
  padding: 16px;
  flex: 1;
}
</style>
