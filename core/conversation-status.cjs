// A missing native index entry is evidence of a disk-only log, not proof of deletion.
function historyStatus(row) {
  if (!row.nativePresent) return row.snapshot || row.retained ? 'retained' : 'missing';
  if (row.archived) return 'archived';
  if (row.harness === 'codex' && row.nativeIndexState === 'missing') return 'residual';
  if (row.harness === 'codex' && row.nativeIndexState === 'other-file') return 'duplicate';
  return 'active';
}
function inScope(row, scope = 'active') {
  return scope === 'all' || (scope === 'inactive' ? historyStatus(row) !== 'active' : historyStatus(row) === 'active');
}
module.exports = { historyStatus, inScope };
