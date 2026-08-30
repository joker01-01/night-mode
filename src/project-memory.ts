import {
  ProjectMemoryCandidate,
  ProjectMemoryCitation,
  ProjectMemoryEntry,
  ProjectMemoryKind,
  ProjectMemoryStore,
  TaskDefinition,
  WorkflowPaths
} from "./types";
import { appendEvent, fileExists, now, readJson, sha256Text, writeJsonAtomic, writeTextAtomic } from "./storage";

const fs = require("node:fs");
const path = require("node:path");
const BufferClass = require("node:buffer").Buffer;

const DEFAULT_RETENTION_DAYS = 28;
const MAX_STATEMENT_CHARS = 1_000;
const MAX_TAGS = 12;
const MAX_TAG_CHARS = 64;
const MAX_CITATIONS = 5;
const MAX_CITATION_LINES = 50;
const MAX_CITATION_BYTES = 16 * 1024;
const MAX_SOURCE_FILE_BYTES = 5 * 1024 * 1024;
const MAX_SELECTED_MEMORIES = 8;

interface MemoryOrigin {
  source: "reviewer" | "human";
  runId?: string;
  taskId?: string;
  retentionDays?: number;
}

function emptyStore(): ProjectMemoryStore {
  return { schemaVersion: 1, entries: [] };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateStore(value: unknown): ProjectMemoryStore {
  if (typeof value !== "object" || value === null) throw new Error("Project-memory store must be an object.");
  const store = value as Record<string, unknown>;
  if (store.schemaVersion !== 1 || !Array.isArray(store.entries)) throw new Error("Project-memory store requires schemaVersion 1 and an entries array.");
  for (const raw of store.entries) {
    if (typeof raw !== "object" || raw === null) throw new Error("Project-memory entry must be an object.");
    const entry = raw as Record<string, unknown>;
    if (!nonEmpty(entry.id) || !["decision", "learning", "constraint"].includes(String(entry.kind)) || !nonEmpty(entry.statement) || String(entry.statement).length > MAX_STATEMENT_CHARS) throw new Error("Project-memory entry has an invalid identity, kind, or statement.");
    if (!Array.isArray(entry.tags) || entry.tags.length === 0 || entry.tags.length > MAX_TAGS || !entry.tags.every((tag) => nonEmpty(tag) && tag.length <= MAX_TAG_CHARS)) throw new Error(`Project-memory entry ${String(entry.id)} requires bounded non-empty tags.`);
    if (!Array.isArray(entry.citations) || entry.citations.length === 0 || entry.citations.length > MAX_CITATIONS) throw new Error(`Project-memory entry ${String(entry.id)} requires bounded citations.`);
    if (!["active", "stale", "missing", "expired", "archived"].includes(String(entry.status))) throw new Error(`Project-memory entry ${String(entry.id)} has an invalid status.`);
    if (!nonEmpty(entry.createdAt) || !nonEmpty(entry.lastValidatedAt) || !Number.isSafeInteger(entry.retentionDays) || Number(entry.retentionDays) < 0) throw new Error(`Project-memory entry ${String(entry.id)} has invalid retention metadata.`);
    if (!["reviewer", "human"].includes(String(entry.source))) throw new Error(`Project-memory entry ${String(entry.id)} has an invalid source.`);
    for (const rawCitation of entry.citations) {
      if (typeof rawCitation !== "object" || rawCitation === null) throw new Error(`Project-memory entry ${String(entry.id)} has an invalid citation.`);
      const citation = rawCitation as Record<string, unknown>;
      if (!nonEmpty(citation.path) || !Number.isSafeInteger(citation.startLine) || !Number.isSafeInteger(citation.endLine) || Number(citation.startLine) < 1 || Number(citation.endLine) < Number(citation.startLine) || !nonEmpty(citation.text) || !/^[a-f0-9]{64}$/i.test(String(citation.textSha256)) || sha256Text(String(citation.text)) !== citation.textSha256) {
        throw new Error(`Project-memory entry ${String(entry.id)} has malformed citation evidence.`);
      }
    }
  }
  return store as unknown as ProjectMemoryStore;
}

export function readProjectMemory(paths: WorkflowPaths): ProjectMemoryStore {
  if (!fileExists(paths.projectMemoryFile)) return emptyStore();
  try {
    return validateStore(readJson<unknown>(paths.projectMemoryFile));
  } catch (error) {
    throw new Error(`Project-memory state is invalid at ${paths.projectMemoryFile}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizedLines(content: string): string[] {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function secretLike(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  const basename = path.posix.basename(lower);
  return basename === ".env"
    || basename.startsWith(".env.")
    || /\.(pem|key|p12|pfx)$/.test(basename)
    || /(^|[/_.-])(secret|secrets|credential|credentials)([/_.-]|$)/.test(lower);
}

function resolveCitationFile(paths: WorkflowPaths, candidatePath: string): { absolute: string; relative: string } {
  if (!nonEmpty(candidatePath) || path.isAbsolute(candidatePath)) throw new Error("Memory citation paths must be repository-relative.");
  const absolute = path.resolve(paths.cwd, candidatePath);
  const relative = path.relative(paths.cwd, absolute).split(path.sep).join("/");
  if (!relative || relative === "." || relative.startsWith("../") || path.isAbsolute(relative)) throw new Error(`Memory citation escapes the repository: ${candidatePath}`);
  const stateRelative = path.relative(paths.stateDir, absolute);
  if (stateRelative === "" || (!stateRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(stateRelative))) throw new Error(`Memory citations cannot use controller-managed state: ${relative}`);
  if (relative === ".git" || relative.startsWith(".git/")) throw new Error(`Memory citations cannot use Git internals: ${relative}`);
  if (secretLike(relative)) throw new Error(`Memory citations cannot use secret-like paths: ${relative}`);
  if (!fileExists(absolute)) throw new Error(`Memory citation file does not exist: ${relative}`);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Memory citation must be a regular non-symlink file: ${relative}`);
  if (stat.size > MAX_SOURCE_FILE_BYTES) throw new Error(`Memory citation source exceeds ${MAX_SOURCE_FILE_BYTES} bytes: ${relative}`);
  const real = fs.realpathSync(absolute);
  const realRelative = path.relative(fs.realpathSync(paths.cwd), real);
  if (realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) throw new Error(`Memory citation resolves outside the repository: ${relative}`);
  return { absolute, relative };
}

function captureCitation(paths: WorkflowPaths, citation: ProjectMemoryCandidate["citations"][number]): ProjectMemoryCitation {
  if (!Number.isSafeInteger(citation.startLine) || !Number.isSafeInteger(citation.endLine) || citation.startLine < 1 || citation.endLine < citation.startLine) throw new Error("Memory citation line range must be positive and ordered.");
  if (citation.endLine - citation.startLine + 1 > MAX_CITATION_LINES) throw new Error(`Memory citations are limited to ${MAX_CITATION_LINES} lines.`);
  const resolved = resolveCitationFile(paths, citation.path);
  const lines = normalizedLines(fs.readFileSync(resolved.absolute, "utf8"));
  if (citation.endLine > lines.length) throw new Error(`Memory citation exceeds ${resolved.relative} (${lines.length} lines).`);
  const text = lines.slice(citation.startLine - 1, citation.endLine).join("\n");
  if (!text.trim()) throw new Error(`Memory citation is empty: ${resolved.relative}:${citation.startLine}-${citation.endLine}`);
  if (BufferClass.byteLength(text, "utf8") > MAX_CITATION_BYTES) throw new Error(`Memory citations are limited to ${MAX_CITATION_BYTES} bytes.`);
  return { path: resolved.relative, startLine: citation.startLine, endLine: citation.endLine, text, textSha256: sha256Text(text) };
}

function candidateKey(kind: ProjectMemoryKind, statement: string, citations: ProjectMemoryCitation[]): string {
  return sha256Text(JSON.stringify({ kind, statement: statement.trim(), citations: citations.map((citation) => [citation.path, citation.textSha256]) }));
}

function addCandidate(paths: WorkflowPaths, store: ProjectMemoryStore, candidate: ProjectMemoryCandidate, origin: MemoryOrigin): { entry?: ProjectMemoryEntry; duplicate?: ProjectMemoryEntry } {
  const statement = candidate.statement.trim();
  const tags = [...new Set(candidate.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  if (!statement || tags.length === 0) throw new Error("Project memory requires a statement and at least one tag.");
  if (statement.length > MAX_STATEMENT_CHARS) throw new Error(`Project-memory statements are limited to ${MAX_STATEMENT_CHARS} characters.`);
  if (tags.length > MAX_TAGS || tags.some((tag) => tag.length > MAX_TAG_CHARS)) throw new Error(`Project memory supports at most ${MAX_TAGS} tags of ${MAX_TAG_CHARS} characters each.`);
  if (!Array.isArray(candidate.citations) || candidate.citations.length === 0 || candidate.citations.length > MAX_CITATIONS) throw new Error(`Project memory requires 1-${MAX_CITATIONS} citations.`);
  if (!["decision", "learning", "constraint"].includes(candidate.kind)) throw new Error(`Unsupported project-memory kind: ${candidate.kind}`);
  const citations = candidate.citations.map((citation) => captureCitation(paths, citation));
  const key = candidateKey(candidate.kind, statement, citations);
  const duplicate = store.entries.find((entry) => entry.status !== "archived" && candidateKey(entry.kind, entry.statement, entry.citations) === key);
  if (duplicate) return { duplicate };
  const createdAt = now();
  const entry: ProjectMemoryEntry = {
    id: `memory-${key.slice(0, 12)}`,
    kind: candidate.kind,
    statement,
    tags,
    citations,
    status: "active",
    createdAt,
    lastValidatedAt: createdAt,
    retentionDays: origin.retentionDays ?? DEFAULT_RETENTION_DAYS,
    source: origin.source,
    sourceRunId: origin.runId,
    sourceTaskId: origin.taskId
  };
  if (!Number.isSafeInteger(entry.retentionDays) || entry.retentionDays < 0) throw new Error("Memory retention days must be a non-negative integer.");
  store.entries.push(entry);
  return { entry };
}

function findRelocation(lines: string[], citedText: string): { startLine: number; endLine: number } | undefined {
  const target = normalizedLines(citedText);
  const matches: number[] = [];
  for (let index = 0; index <= lines.length - target.length; index += 1) {
    if (target.every((line, offset) => lines[index + offset] === line)) matches.push(index);
  }
  return matches.length === 1 ? { startLine: matches[0] + 1, endLine: matches[0] + target.length } : undefined;
}

function revalidateCitation(paths: WorkflowPaths, citation: ProjectMemoryCitation): { citation: ProjectMemoryCitation; status: "active" | "stale" | "missing"; reason?: string } {
  let resolved: { absolute: string; relative: string };
  try {
    resolved = resolveCitationFile(paths, citation.path);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { citation, status: reason.includes("does not exist") ? "missing" : "stale", reason };
  }
  const lines = normalizedLines(fs.readFileSync(resolved.absolute, "utf8"));
  const current = citation.endLine <= lines.length ? lines.slice(citation.startLine - 1, citation.endLine).join("\n") : undefined;
  if (current === citation.text && sha256Text(current) === citation.textSha256) return { citation: { ...citation, path: resolved.relative }, status: "active" };
  const relocation = findRelocation(lines, citation.text);
  if (!relocation) return { citation, status: "stale", reason: `Cited text changed or is no longer uniquely locatable in ${resolved.relative}.` };
  return { citation: { ...citation, path: resolved.relative, ...relocation }, status: "active" };
}

function expired(entry: ProjectMemoryEntry, at: string): boolean {
  if (entry.retentionDays === 0) return false;
  const anchor = Date.parse(entry.lastUsedAt ?? entry.createdAt);
  const current = Date.parse(at);
  return Number.isFinite(anchor) && Number.isFinite(current) && current - anchor >= entry.retentionDays * 86_400_000;
}

export function revalidateProjectMemory(paths: WorkflowPaths, at = now()): ProjectMemoryStore {
  const store = readProjectMemory(paths);
  for (const entry of store.entries) {
    if (entry.status === "archived") continue;
    const results = entry.citations.map((citation) => revalidateCitation(paths, citation));
    entry.citations = results.map((result) => result.citation);
    entry.lastValidatedAt = at;
    const invalid = results.find((result) => result.status !== "active");
    if (invalid) {
      entry.status = invalid.status;
      entry.staleReason = invalid.reason;
    } else if (expired(entry, at)) {
      entry.status = "expired";
      entry.staleReason = `Retention window of ${entry.retentionDays} days elapsed without use.`;
    } else {
      entry.status = "active";
      entry.staleReason = undefined;
    }
  }
  persistProjectMemory(paths, store);
  appendEvent(paths.eventsFile, "project_memory_revalidated", memoryCounts(store));
  return store;
}

function memoryCounts(store: ProjectMemoryStore): Record<string, number> {
  const result: Record<string, number> = { total: store.entries.length, active: 0, stale: 0, missing: 0, expired: 0, archived: 0 };
  for (const entry of store.entries) result[entry.status] += 1;
  return result;
}

function report(store: ProjectMemoryStore): string {
  const counts = memoryCounts(store);
  const lines = [
    "# Project Memory",
    "",
    `- Total: ${counts.total}`,
    `- Active: ${counts.active}`,
    `- Stale: ${counts.stale}`,
    `- Missing: ${counts.missing}`,
    `- Expired: ${counts.expired}`,
    `- Archived: ${counts.archived}`,
    "",
    "Only active, task-relevant entries are injected into worker context. Invalid and archived entries are retained for audit.",
    ""
  ];
  for (const entry of store.entries) {
    lines.push(`## ${entry.id} [${entry.status}]`, "", `- Kind: ${entry.kind}`, `- Statement: ${entry.statement}`, `- Tags: ${entry.tags.join(", ")}`, `- Source: ${entry.source}${entry.sourceTaskId ? `; task ${entry.sourceTaskId}` : ""}${entry.sourceRunId ? `; run ${entry.sourceRunId}` : ""}`, `- Created: ${entry.createdAt}`, `- Last validated: ${entry.lastValidatedAt}`, `- Last used: ${entry.lastUsedAt ?? "never"}`, `- Retention: ${entry.retentionDays === 0 ? "unlimited" : `${entry.retentionDays} days`}`);
    if (entry.staleReason) lines.push(`- Inactive reason: ${entry.staleReason}`);
    if (entry.archiveReason) lines.push(`- Archive reason: ${entry.archiveReason}`);
    for (const citation of entry.citations) lines.push(`- Citation: \`${citation.path}:${citation.startLine}-${citation.endLine}\`; SHA-256 \`${citation.textSha256}\``);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function persistProjectMemory(paths: WorkflowPaths, store: ProjectMemoryStore): void {
  writeJsonAtomic(paths.projectMemoryFile, store);
  writeTextAtomic(paths.projectMemoryReportFile, report(store));
}

export function addProjectMemory(paths: WorkflowPaths, candidate: ProjectMemoryCandidate, retentionDays = DEFAULT_RETENTION_DAYS): ProjectMemoryEntry {
  const store = readProjectMemory(paths);
  const result = addCandidate(paths, store, candidate, { source: "human", retentionDays });
  persistProjectMemory(paths, store);
  const entry = result.entry ?? result.duplicate!;
  appendEvent(paths.eventsFile, result.entry ? "project_memory_added" : "project_memory_duplicate", { memoryId: entry.id, source: "human" });
  return entry;
}

export function promoteProjectMemoryCandidates(paths: WorkflowPaths, candidates: ProjectMemoryCandidate[], runId: string, taskId: string): ProjectMemoryEntry[] {
  const store = readProjectMemory(paths);
  const added: ProjectMemoryEntry[] = [];
  for (const candidate of candidates) {
    try {
      const result = addCandidate(paths, store, candidate, { source: "reviewer", runId, taskId });
      if (result.entry) {
        added.push(result.entry);
        appendEvent(paths.eventsFile, "project_memory_promoted", { memoryId: result.entry.id, taskId, runId });
      } else {
        appendEvent(paths.eventsFile, "project_memory_duplicate", { memoryId: result.duplicate!.id, taskId, runId });
      }
    } catch (error) {
      appendEvent(paths.eventsFile, "project_memory_candidate_rejected", { taskId, runId, statement: candidate.statement, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  persistProjectMemory(paths, store);
  return added;
}

function tokens(value: string): Set<string> {
  const normalized = value.toLowerCase();
  const result = new Set<string>(normalized.match(/[\p{L}\p{N}]+/gu) ?? []);
  for (const run of normalized.match(/[\p{Script=Han}]+/gu) ?? []) {
    for (const character of run) result.add(character);
    for (let index = 0; index < run.length - 1; index += 1) result.add(run.slice(index, index + 2));
  }
  return result;
}

function relevance(entry: ProjectMemoryEntry, query: string, queryTokens: Set<string>): number {
  let score = entry.kind === "constraint" ? 1 : 0;
  const lowerQuery = query.toLowerCase();
  for (const tag of entry.tags) if (lowerQuery.includes(tag.toLowerCase())) score += 4;
  for (const token of tokens(`${entry.statement} ${entry.tags.join(" ")}`)) if (queryTokens.has(token)) score += token.length > 1 ? 2 : 1;
  return score;
}

export function selectRelevantProjectMemories(paths: WorkflowPaths, task: TaskDefinition, limit = MAX_SELECTED_MEMORIES, at = now()): ProjectMemoryEntry[] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Project-memory selection limit must be positive.");
  const store = revalidateProjectMemory(paths, at);
  const query = [task.title, task.objective, ...task.acceptanceCriteria].join(" ");
  const queryTokens = tokens(query);
  const selected = store.entries
    .filter((entry) => entry.status === "active")
    .map((entry) => ({ entry, score: relevance(entry, query, queryTokens) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.entry.createdAt.localeCompare(right.entry.createdAt))
    .slice(0, limit)
    .map((item) => item.entry);
  if (selected.length) {
    const ids = new Set(selected.map((entry) => entry.id));
    for (const entry of store.entries) if (ids.has(entry.id)) entry.lastUsedAt = at;
    persistProjectMemory(paths, store);
    appendEvent(paths.eventsFile, "project_memory_selected", { taskId: task.id, memoryIds: selected.map((entry) => entry.id) });
  }
  return selected;
}

export function formatProjectMemoryContext(entries: ProjectMemoryEntry[]): string {
  if (!entries.length) return "No validated project memories are relevant to this task.";
  return entries.map((entry) => {
    const citations = entry.citations.map((citation) => `${citation.path}:${citation.startLine}-${citation.endLine}#sha256=${citation.textSha256}`).join(", ");
    return `- [${entry.kind}/${entry.id}] ${entry.statement}\n  Evidence: ${citations}`;
  }).join("\n");
}

export function archiveProjectMemory(paths: WorkflowPaths, id: string, reason: string): ProjectMemoryEntry {
  if (!nonEmpty(reason)) throw new Error("Archiving project memory requires a reason.");
  const store = readProjectMemory(paths);
  const entry = store.entries.find((item) => item.id === id);
  if (!entry) throw new Error(`Project memory not found: ${id}`);
  if (entry.status !== "archived") {
    entry.status = "archived";
    entry.archivedAt = now();
    entry.archiveReason = reason.trim();
    entry.staleReason = undefined;
    persistProjectMemory(paths, store);
    appendEvent(paths.eventsFile, "project_memory_archived", { memoryId: id, reason: entry.archiveReason });
  }
  return entry;
}

export function parseMemorySource(value: string): ProjectMemoryCandidate["citations"][number] {
  const match = /^(.*):(\d+)-(\d+)$/.exec(value);
  if (!match || !match[1]) throw new Error("--source must use <relative-path>:<start>-<end>.");
  return { path: match[1], startLine: Number(match[2]), endLine: Number(match[3]) };
}

export function projectMemoryCounts(paths: WorkflowPaths): Record<string, number> {
  return memoryCounts(readProjectMemory(paths));
}
