<script setup>
import { ref } from 'vue'

const props = defineProps({
  entry: { type: Object, required: true }
})

const inputExpanded = ref(false)
</script>

<template>
  <div class="log-entry" :class="entry.type">
    <!-- Header -->
    <div class="log-header">
      <span class="log-step">{{ entry.stepLabel }}</span>
      <span class="log-title">{{ entry.title }}</span>
      <span class="log-tokens" v-if="entry.tokens">{{ entry.tokens }} tok</span>
      <span class="log-time">{{ entry.time }}</span>
    </div>

    <!-- Input (collapsible) -->
    <div v-if="entry.input" class="log-input" :class="{ expanded: inputExpanded }" @click="inputExpanded = !inputExpanded">
      <span class="section-label">Input:</span>
      <span class="section-text">{{ inputExpanded ? entry.input : (entry.inputSummary || entry.input) }}</span>
    </div>

    <!-- Output -->
    <div v-if="entry.output" class="log-output">
      <span class="section-label">Output:</span>
      <span class="section-text">{{ entry.output }}</span>
    </div>

    <!-- MDG Badge -->
    <div v-if="entry.type === 'mdg'" class="log-mdg">
      <span class="mdg-badge" :class="entry.mdgPassed ? 'pass' : 'fail'">
        {{ entry.mdgPassed ? '✓ PASS' : '✗ FAIL' }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.log-entry {
  background: var(--dark-card);
  border-radius: 6px;
  padding: 6px 8px;
  border-left: 3px solid var(--info);
  animation: fadeIn 0.3s ease;
}
.log-entry.cmr,
.log-entry.merge { border-left-color: var(--warning); }
.log-entry.mdg { border-left-color: var(--cyan); }

.log-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.log-step {
  font-size: 8px;
  font-weight: 700;
  color: var(--dark-deep);
  background: var(--info);
  padding: 1px 5px;
  border-radius: 3px;
  flex-shrink: 0;
}
.log-entry.cmr .log-step,
.log-entry.merge .log-step { background: var(--warning); }
.log-entry.mdg .log-step { background: var(--cyan); }

.log-title {
  font-size: 9px;
  font-weight: 600;
  color: var(--dark-text);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.log-tokens {
  font-size: 8px;
  color: var(--dark-text-muted);
  font-family: 'Monaco', monospace;
  flex-shrink: 0;
}
.log-time {
  font-size: 8px;
  color: var(--dark-text-muted);
  flex-shrink: 0;
}

/* Input (collapsible) */
.log-input {
  font-size: 8px;
  color: #94a3b8;
  background: var(--dark-bg);
  padding: 3px 6px;
  border-radius: 3px;
  margin-bottom: 3px;
  cursor: pointer;
  max-height: 20px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  transition: max-height 0.2s ease;
}
.log-input.expanded {
  max-height: 400px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-y: auto;
}

/* Output */
.log-output {
  font-family: 'Monaco', monospace;
  font-size: 8px;
  color: #cbd5e1;
  background: var(--dark-bg);
  padding: 4px 6px;
  border-radius: 3px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 120px;
  overflow-y: auto;
}

.section-label {
  font-weight: 600;
  color: var(--dark-text-muted);
  margin-right: 4px;
}

/* MDG */
.log-mdg {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 8px;
  margin-top: 3px;
}
.mdg-badge {
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 600;
}
.mdg-badge.pass {
  background: rgba(34, 197, 94, 0.2);
  color: var(--success);
}
.mdg-badge.fail {
  background: rgba(239, 68, 68, 0.2);
  color: var(--error);
}
</style>
