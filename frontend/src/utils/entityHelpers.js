import { rawRecords } from '../data/records.js'

let _snapshotRecords = null

export function setSnapshotRecords(map) {
  _snapshotRecords = map
}

export function clearSnapshotRecords() {
  _snapshotRecords = null
}

export function getEntityFromRecord(recordId) {
  if (_snapshotRecords?.[recordId]) return _snapshotRecords[recordId].entity
  const record = rawRecords.find(r => r.id === recordId)
  return record ? record.entity : 1
}

export function getRecordById(recordId) {
  if (_snapshotRecords?.[recordId]) return _snapshotRecords[recordId]
  return rawRecords.find(r => r.id === recordId)
}
