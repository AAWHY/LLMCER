<script setup>
import { onMounted, ref } from 'vue'
import { useConfigStore } from '../../stores/config.js'
import { uploadDataset } from '../../api/index.js'

const config = useConfigStore()

onMounted(() => {
  config.loadDatasets()
})

// Upload dialog state
const showUpload = ref(false)
const uploadName = ref('')
const dataFile = ref(null)
const gtFile = ref(null)
const uploading = ref(false)
const uploadError = ref('')

const sampleCsv = `id,name,phone,email
0,John Smith,138-0001-1000,john.smith@mail.com
1,J. Smith,138-0001-1000,jsmith@mail.com
2,Alice Wang,139-0002-2000,alice.wang@mail.com
3,Wang Alice,139-0002-2000,alicew@mail.com
4,Bob Chen,137-0003-3000,bob.chen@mail.com
5,B. Chen,137-0003-3000,bobchen@mail.com`

const sampleGt = `0 1
2 3
4 5`

function downloadSample(content, filename) {
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function onDataFileChange(e) {
  dataFile.value = e.target.files[0] || null
  if (dataFile.value && !uploadName.value) {
    uploadName.value = dataFile.value.name.replace(/\.csv$/i, '')
  }
}
function onGtFileChange(e) {
  gtFile.value = e.target.files[0] || null
}

function resetUpload() {
  showUpload.value = false
  uploadName.value = ''
  dataFile.value = null
  gtFile.value = null
  uploading.value = false
  uploadError.value = ''
}

async function doUpload() {
  if (!dataFile.value || !uploadName.value.trim()) return
  uploading.value = true
  uploadError.value = ''
  try {
    await uploadDataset(uploadName.value.trim(), dataFile.value, gtFile.value)
    await config.loadDatasets()
    await config.setDataset(uploadName.value.trim())
    resetUpload()
  } catch (e) {
    uploadError.value = e.message || 'Upload failed'
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <div class="config-section">
    <div class="section-title">Select Dataset</div>
    <div class="dataset-grid">
      <button
        v-for="(ds, idx) in config.datasets"
        :key="ds.name"
        class="dataset-btn"
        :class="{
          active: config.activeDataset === ds.name,
          'span-2': config.datasets.length % 2 === 1 && idx === config.datasets.length - 1
        }"
        @click="config.setDataset(ds.name)"
      >
        <span>{{ ds.name }}</span>
      </button>
      <button class="dataset-btn add-btn" @click="showUpload = true">+</button>
    </div>

    <!-- Upload dialog -->
    <teleport to="body">
      <div v-if="showUpload" class="upload-overlay" @click.self="resetUpload">
        <div class="upload-dialog">
          <div class="upload-header">
            <span>Upload Dataset</span>
            <button class="close-btn" @click="resetUpload">&times;</button>
          </div>
          <div class="upload-body">
            <div class="field">
              <label>Dataset Name</label>
              <input v-model="uploadName" placeholder="e.g. my_dataset" class="field-input" />
            </div>
            <div class="field">
              <label>Data File (CSV) <span class="required">*</span></label>
              <div class="file-row">
                <button class="file-pick-btn" @click="$refs.dataInput.click()">Choose File</button>
                <span class="file-name">{{ dataFile ? dataFile.name : 'No file selected' }}</span>
              </div>
              <input ref="dataInput" type="file" accept=".csv" @change="onDataFileChange" style="display:none" />
              <div class="example-block">
                <div class="example-header">
                  <span class="example-title">Example CSV format:</span>
                  <button class="sample-dl-btn" @click="downloadSample(sampleCsv, 'sample_data.csv')">&#8681; Download</button>
                </div>
                <table class="example-table">
                  <thead><tr><th>id</th><th>name</th><th>phone</th><th>email</th></tr></thead>
                  <tbody>
                    <tr><td>0</td><td>John Smith</td><td>138-0001</td><td>john@mail.com</td></tr>
                    <tr><td>1</td><td>J. Smith</td><td>138-0001</td><td>jsmith@mail.com</td></tr>
                    <tr><td>2</td><td>Alice Wang</td><td>139-0002</td><td>alice@mail.com</td></tr>
                  </tbody>
                </table>
                <div class="field-hint">First column must be a unique ID. Remaining columns are attributes.</div>
              </div>
            </div>
            <div class="field">
              <label>Ground Truth File (optional)</label>
              <div class="file-row">
                <button class="file-pick-btn" @click="$refs.gtInput.click()">Choose File</button>
                <span class="file-name">{{ gtFile ? gtFile.name : 'No file selected' }}</span>
              </div>
              <input ref="gtInput" type="file" accept=".csv,.txt" @change="onGtFileChange" style="display:none" />
              <div class="example-block">
                <div class="example-header">
                  <span class="example-title">Example GT format:</span>
                  <button class="sample-dl-btn" @click="downloadSample(sampleGt, 'sample_gt.txt')">&#8681; Download</button>
                </div>
                <pre class="example-pre">0 1
2 3
4 5</pre>
                <div class="field-hint">Each line lists record IDs belonging to the same entity (space or comma separated).</div>
                <div class="field-hint gt-hint-metric">Providing ground truth enables evaluation metrics (ACC, NMI, ARI, F-measure).</div>
              </div>
            </div>
            <div v-if="uploadError" class="upload-error">{{ uploadError }}</div>
          </div>
          <div class="upload-footer">
            <button class="btn-cancel" @click="resetUpload">Cancel</button>
            <button
              class="btn-upload"
              :disabled="!dataFile || !uploadName.trim() || uploading"
              @click="doUpload"
            >
              {{ uploading ? 'Uploading...' : 'Upload' }}
            </button>
          </div>
        </div>
      </div>
    </teleport>
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
.dataset-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 3px;
}
.dataset-btn {
  padding: 6px 4px;
  background: white;
  border: 1.5px solid var(--primary);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--primary);
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
}
.dataset-btn:hover { background: var(--primary-bg); }
.dataset-btn.active { background: var(--primary); color: white; }
.dataset-btn.span-2 {
  grid-column: span 2;
}
.dataset-btn.add-btn {
  background: transparent;
  border-style: dashed;
  font-size: 14px;
  grid-column: span 2;
  justify-content: center;
}

/* Upload dialog */
.upload-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.upload-dialog {
  background: white;
  border-radius: 8px;
  width: 360px;
  box-shadow: 0 8px 30px rgba(0,0,0,0.2);
  overflow: hidden;
}
.upload-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: var(--primary);
  color: white;
  font-size: 13px;
  font-weight: 700;
}
.close-btn {
  background: none;
  border: none;
  color: white;
  font-size: 18px;
  cursor: pointer;
  line-height: 1;
}
.upload-body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.field label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: #334155;
  margin-bottom: 3px;
}
.required { color: #dc2626; }
.field-input {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 12px;
  outline: none;
  box-sizing: border-box;
}
.field-input:focus { border-color: var(--primary); }
.field-file {
  font-size: 11px;
  color: #475569;
}
.field-hint {
  font-size: 9px;
  color: #94a3b8;
  margin-top: 2px;
}
.upload-error {
  font-size: 11px;
  color: #dc2626;
  background: #fef2f2;
  padding: 5px 8px;
  border-radius: 4px;
}
.upload-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid #e5e7eb;
}
.btn-cancel {
  padding: 5px 12px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: white;
  font-size: 11px;
  cursor: pointer;
  color: #475569;
}
.btn-upload {
  padding: 5px 12px;
  border: none;
  border-radius: 4px;
  background: var(--primary);
  color: white;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.btn-upload:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.file-pick-btn {
  padding: 4px 10px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #f8fafc;
  font-size: 11px;
  cursor: pointer;
  color: #334155;
  white-space: nowrap;
}
.file-pick-btn:hover {
  background: #e2e8f0;
}
.file-name {
  font-size: 11px;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.example-block {
  margin-top: 4px;
  padding: 5px 6px;
  background: #f8fafc;
  border: 1px dashed #d1d5db;
  border-radius: 4px;
}
.example-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 3px;
}
.example-title {
  font-size: 9px;
  font-weight: 600;
  color: #64748b;
}
.sample-dl-btn {
  padding: 1px 6px;
  border: 1px solid #d1d5db;
  border-radius: 3px;
  background: white;
  font-size: 8px;
  color: #2563eb;
  cursor: pointer;
  font-weight: 600;
}
.sample-dl-btn:hover {
  background: #eff6ff;
  border-color: #2563eb;
}
.example-pre {
  font-family: monospace;
  font-size: 9px;
  color: #475569;
  margin: 0;
  line-height: 1.4;
}
.example-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 9px;
  font-family: monospace;
}
.example-table th {
  text-align: left;
  padding: 1px 4px;
  color: #334155;
  font-weight: 700;
  border-bottom: 1px solid #e2e8f0;
}
.example-table td {
  padding: 1px 4px;
  color: #475569;
}
.example-note {
  color: #94a3b8;
  font-family: sans-serif;
  font-style: italic;
}
.gt-hint-metric {
  color: #2563eb;
  font-weight: 600;
}
</style>
