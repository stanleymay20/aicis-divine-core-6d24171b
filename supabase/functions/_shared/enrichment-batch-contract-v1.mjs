// Pure validation for bounded parallel enrichment. Every provider batch is
// identified by local indices and must be complete before any classified write.
export function enrichmentChunks(signals, size = 4) {
  if (!Array.isArray(signals) || !Number.isInteger(size) || size < 1 || size > 8) {
    throw new Error("Invalid enrichment batch contract");
  }
  const chunks = [];
  for (let start = 0; start < signals.length; start += size) {
    chunks.push({ offset: start, signals: signals.slice(start, start + size) });
  }
  return chunks;
}

export function verifyEnrichmentClassifications(classifications, expectedCount) {
  if (!Array.isArray(classifications) || classifications.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} classifications, received ${Array.isArray(classifications) ? classifications.length : "invalid"}`);
  }
  const found = new Set();
  for (const row of classifications) {
    if (!row || !Number.isInteger(row.index) || row.index < 0 ||
      row.index >= expectedCount || found.has(row.index)) {
      throw new Error("Missing, duplicate or out-of-range classification index");
    }
    found.add(row.index);
  }
  return classifications;
}
