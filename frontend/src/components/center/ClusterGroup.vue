<script setup>
defineProps({
  entityClass: { type: String, default: '' },
  compact: { type: Boolean, default: false }
})
</script>

<template>
  <div class="cluster-group" :class="entityClass" :style="compact ? 'padding:3px 6px' : ''">
    <slot />
  </div>
</template>

<style scoped>
.cluster-group {
  display: flex;
  gap: 2px;
  padding: 3px 6px;
  background: rgba(0,0,0,0.03);
  border-radius: 16px;
  border: 2px dashed #ccc;
  flex-wrap: wrap;
  align-items: center;
}
</style>
