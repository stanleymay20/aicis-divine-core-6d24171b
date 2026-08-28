from pathlib import Path


def replace_exact(path: str, old: str, new: str, count: int = 1) -> None:
    file = Path(path)
    text = file.read_text()
    actual = text.count(old)
    if actual != count:
        raise SystemExit(
            f"{path}: expected {count} occurrence(s), found {actual}: {old[:100]!r}"
        )
    file.write_text(text.replace(old, new, count))


# React hook: stabilize the fallback array identity.
replace_exact(
    "src/pages/Simulation.tsx",
    "  const rows = list.data?.rows ?? [];",
    "  const rows = useMemo(() => list.data?.rows ?? [], [list.data?.rows]);",
)

# Shared export schema: replace explicit-any escape hatches with narrow,
# null-preserving dynamic-row/query helpers.
path = Path("supabase/functions/_shared/export-schema.ts")
text = path.read_text()
marker = "export interface ExportProfile {\n"
helper = """type ExportSourceRow = Record<string, unknown>;

function queryCall<T>(query: T, method: string, ...args: unknown[]): T {
  const callable = query as unknown as Record<string, (...methodArgs: unknown[]) => T>;
  const fn = callable[method];
  if (typeof fn !== "function") throw new TypeError(`Query builder does not support ${method}`);
  return fn(...args);
}

"""
if helper in text:
    raise SystemExit("export-schema.ts: query helper already present")
idx = text.find(marker)
if idx < 0:
    raise SystemExit("export-schema.ts: ExportProfile marker missing")
text = text[:idx] + helper + text[idx:]

replacements = [
    (
        "function sourceUrls(row: any): string[] {",
        "function sourceUrls(row: ExportSourceRow): string[] {",
    ),
    (
        '      const url = reference && typeof reference === "object" ? reference.url : null;',
        '      const url = reference && typeof reference === "object" && "url" in reference\n'
        '        ? (reference as Record<string, unknown>).url\n'
        '        : null;',
    ),
    ("  row: any,", "  row: ExportSourceRow,"),
    (
        "  const domain = row.category ?? null;",
        '  const domain = typeof row.category === "string" ? row.category : null;',
    ),
    (
        "    trend_direction: row.trend_direction ?? null,",
        '    trend_direction: typeof row.trend_direction === "string" ? row.trend_direction : null,',
    ),
    (
        "    affected_sectors: Array.isArray(row.affected_sectors) ? row.affected_sectors : [],",
        '    affected_sectors: Array.isArray(row.affected_sectors)\n'
        '      ? row.affected_sectors.filter((value): value is string => typeof value === "string")\n'
        '      : [],',
    ),
    (
        "    affected_entities: Array.isArray(row.affected_entities) ? row.affected_entities : [],",
        '    affected_entities: Array.isArray(row.affected_entities)\n'
        '      ? row.affected_entities.filter((value): value is string => typeof value === "string")\n'
        '      : [],',
    ),
    (
        "      ? (row.why_it_matters ?? row.summary ?? null)",
        '      ? (typeof row.why_it_matters === "string"\n'
        '        ? row.why_it_matters\n'
        '        : typeof row.summary === "string" ? row.summary : null)',
    ),
    (
        "  if (!opts.prefer_clusters) return { signals: unique, clusters: [] as any[] };",
        "  if (!opts.prefer_clusters) return { signals: unique, clusters: [] as Array<Record<string, unknown>> };",
    ),
    (
        "  const clusters: any[] = [];",
        "  const clusters: Array<Record<string, unknown>> = [];",
    ),
    (
        "export function rowsToCsv(cols: string[], rows: any[]): string {",
        "export function rowsToCsv(cols: string[], rows: Array<Record<string, unknown>>): string {",
    ),
    (
        '    return /[\\",\\n\\r]/.test(text) ? `"${text.replace(/"/g, \'""\')}"` : text;',
        '    return /[",\\n\\r]/.test(text) ? `"${text.replace(/"/g, \'""\')}"` : text;',
    ),
    (
        'function requireUsableSemantics(q: any, column: string) {\n'
        '  q = q.not(column, "is", null);\n'
        '  for (const token of UNUSABLE_SEMANTIC_TOKENS) {\n'
        '    q = q.not(column, "ilike", `%${token}%`);\n'
        '  }\n'
        '  return q;\n'
        '}\n\n'
        'export function applyProfileFilters<T>(q: any, profile: ExportProfile) {\n'
        '  if (profile.domains.length) q = q.in("category", profile.domains);\n'
        '  if (profile.countries.length) q = q.overlaps("affected_countries", profile.countries);\n'
        '  if (profile.regions.length) q = q.overlaps("affected_regions", profile.regions);\n\n'
        '  if (profile.min_relevance_score > 0) {\n'
        '    q = q.gte("source_rank_score", profile.min_relevance_score);',
        'function requireUsableSemantics<T>(q: T, column: string): T {\n'
        '  q = queryCall(q, "not", column, "is", null);\n'
        '  for (const token of UNUSABLE_SEMANTIC_TOKENS) {\n'
        '    q = queryCall(q, "not", column, "ilike", `%${token}%`);\n'
        '  }\n'
        '  return q;\n'
        '}\n\n'
        'export function applyProfileFilters<T>(q: T, profile: ExportProfile): T {\n'
        '  if (profile.domains.length) q = queryCall(q, "in", "category", profile.domains);\n'
        '  if (profile.countries.length) q = queryCall(q, "overlaps", "affected_countries", profile.countries);\n'
        '  if (profile.regions.length) q = queryCall(q, "overlaps", "affected_regions", profile.regions);\n\n'
        '  if (profile.min_relevance_score > 0) {\n'
        '    q = queryCall(q, "gte", "source_rank_score", profile.min_relevance_score);',
    ),
    (
        '    q = q.gte("confidence_score", profile.min_confidence_score);',
        '    q = queryCall(q, "gte", "confidence_score", profile.min_confidence_score);',
    ),
    (
        '    q = q.gte("urgency_score", profile.min_urgency_score);',
        '    q = queryCall(q, "gte", "urgency_score", profile.min_urgency_score);',
    ),
]
for old, new in replacements:
    actual = text.count(old)
    if actual != 1:
        raise SystemExit(
            f"export-schema.ts replacement mismatch count={actual}: {old[:120]!r}"
        )
    text = text.replace(old, new, 1)
path.write_text(text)

# Governed raw exporter: generic query-call bridge instead of explicit any.
path = Path("supabase/functions/export-aicis-dataset/index.ts")
text = path.read_text()
query_helper = """function queryCall<T>(query: T, method: string, ...args: unknown[]): T {
  const callable = query as unknown as Record<string, (...methodArgs: unknown[]) => T>;
  const fn = callable[method];
  if (typeof fn !== "function") throw new TypeError(`Query builder does not support ${method}`);
  return fn(...args);
}

"""
anchor = "function requireUsableSemantics(query: any, column: string) {\n"
if text.count(anchor) != 1:
    raise SystemExit("export-aicis-dataset: requireUsableSemantics marker mismatch")
text = text.replace(
    anchor,
    query_helper + "function requireUsableSemantics<T>(query: T, column: string): T {\n",
    1,
)
replace_pairs = [
    (
        '  query = query.not(column, "is", null);',
        '  query = queryCall(query, "not", column, "is", null);',
    ),
    (
        '  for (const token of UNUSABLE_SEMANTIC_TOKENS) query = query.not(column, "ilike", `%${token}%`);',
        '  for (const token of UNUSABLE_SEMANTIC_TOKENS) query = queryCall(query, "not", column, "ilike", `%${token}%`);',
    ),
    (
        "function applyFilters(query: any, spec: DatasetSpec, filters: z.infer<typeof FilterSchema>) {",
        "function applyFilters<T>(query: T, spec: DatasetSpec, filters: z.infer<typeof FilterSchema>): T {",
    ),
    (
        "if (filters.date_from && spec.dateCol) query = query.gte(spec.dateCol, filters.date_from);",
        'if (filters.date_from && spec.dateCol) query = queryCall(query, "gte", spec.dateCol, filters.date_from);',
    ),
    (
        "if (filters.date_to && spec.dateCol) query = query.lte(spec.dateCol, filters.date_to);",
        'if (filters.date_to && spec.dateCol) query = queryCall(query, "lte", spec.dateCol, filters.date_to);',
    ),
    (
        "if (filters.iso3 && spec.iso3Col) query = query.eq(spec.iso3Col, filters.iso3.toUpperCase());",
        'if (filters.iso3 && spec.iso3Col) query = queryCall(query, "eq", spec.iso3Col, filters.iso3.toUpperCase());',
    ),
    (
        "if (filters.event_type && spec.typeCol) query = query.eq(spec.typeCol, filters.event_type);",
        'if (filters.event_type && spec.typeCol) query = queryCall(query, "eq", spec.typeCol, filters.event_type);',
    ),
    (
        "if (filters.warning_kind && spec.warningKindCol) query = query.eq(spec.warningKindCol, filters.warning_kind);",
        'if (filters.warning_kind && spec.warningKindCol) query = queryCall(query, "eq", spec.warningKindCol, filters.warning_kind);',
    ),
    (
        "    query = query.gte(spec.confidenceCol, value);",
        '    query = queryCall(query, "gte", spec.confidenceCol, value);',
    ),
    (
        "    query = query.gte(spec.severityCol, value);",
        '    query = queryCall(query, "gte", spec.severityCol, value);',
    ),
]
for old, new in replace_pairs:
    actual = text.count(old)
    if actual != 1:
        raise SystemExit(
            f"export-aicis-dataset replacement mismatch count={actual}: {old[:120]!r}"
        )
    text = text.replace(old, new, 1)
path.write_text(text)

# Public API: use actual Supabase client type; rely on contextual row inference
# rather than explicit-any callback annotations.
path = Path("supabase/functions/public-api/index.ts")
text = path.read_text()
type_anchor = 'const EPISTEMIC_CONTRACT = "null_preserving_semantically_typed_v2";\n'
if text.count(type_anchor) != 1:
    raise SystemExit("public-api: EPISTEMIC_CONTRACT marker mismatch")
text = text.replace(
    type_anchor,
    type_anchor + "type SupabaseClientLike = ReturnType<typeof createClient>;\n",
    1,
)
old_helper = """function requireUsableSemantics(query: any, column: string) {
  query = query.not(column, "is", null);
  for (const token of UNUSABLE_SEMANTIC_TOKENS) {
    query = query.not(column, "ilike", `%${token}%`);
  }
  return query;
}
"""
new_helper = """function queryCall<T>(query: T, method: string, ...args: unknown[]): T {
  const callable = query as unknown as Record<string, (...methodArgs: unknown[]) => T>;
  const fn = callable[method];
  if (typeof fn !== "function") throw new TypeError(`Query builder does not support ${method}`);
  return fn(...args);
}

function requireUsableSemantics<T>(query: T, column: string): T {
  query = queryCall(query, "not", column, "is", null);
  for (const token of UNUSABLE_SEMANTIC_TOKENS) {
    query = queryCall(query, "not", column, "ilike", `%${token}%`);
  }
  return query;
}
"""
if text.count(old_helper) != 1:
    raise SystemExit("public-api: semantic helper mismatch")
text = text.replace(old_helper, new_helper, 1)
if text.count("sb: any") != 9:
    raise SystemExit(f"public-api: expected 9 sb:any occurrences, found {text.count('sb: any')}")
text = text.replace("sb: any", "sb: SupabaseClientLike")
expected_callbacks = {
    "(signal: any)": 2,
    "(outcome: any)": 1,
    "(log: any)": 1,
    "(row: any)": 3,
}
for old, count in expected_callbacks.items():
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f"public-api: {old} expected {count}, found {actual}")
    text = text.replace(old, old.replace(": any", ""))
path.write_text(text)

print("Applied exact strict-lint source repairs.")
