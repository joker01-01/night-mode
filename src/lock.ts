import { WorkflowPaths } from "./types";
import { ensureDir, fileExists, now, readJson, writeJsonAtomic } from "./storage";

const fs = require("node:fs");

interface LockMetadata {
  pid: number;
  acquiredAt: string;
  cwd: string;
  runId: string;
  target: string;
  commandContext: string;
}

export interface LockContext {
  runId: string;
  target: string;
  commandContext: string;
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireLock(paths: WorkflowPaths, reclaimStaleLock: boolean, context?: LockContext): void {
  ensureDir(paths.stateDir);
  try {
    fs.mkdirSync(paths.lockDir);
  } catch (error) {
    if ((error as { code?: string }).code !== "EEXIST") throw error;
    let metadata: LockMetadata | undefined;
    try {
      metadata = readJson<LockMetadata>(paths.lockFile);
    } catch {
      if (!reclaimStaleLock) {
        throw new Error(`Workflow lock has invalid metadata at ${paths.lockFile}. Use --reclaim-stale-lock only after inspection.`);
      }
    }
    if (metadata && processIsAlive(metadata.pid)) {
      throw new Error(`Another workflow run is active (pid ${metadata.pid}, run ${metadata.runId}, target ${metadata.target}, acquired ${metadata.acquiredAt}).`);
    }
    if (!reclaimStaleLock) {
      throw new Error(`Workflow lock is stale or invalid at ${paths.lockDir}. Inspect it, then use --reclaim-stale-lock explicitly.`);
    }
    fs.rmSync(paths.lockDir, { recursive: true, force: true });
    fs.mkdirSync(paths.lockDir);
  }
  writeJsonAtomic(paths.lockFile, {
    pid: process.pid,
    acquiredAt: now(),
    cwd: paths.cwd,
    runId: context?.runId ?? "unknown",
    target: context?.target ?? paths.cwd,
    commandContext: context?.commandContext ?? "unknown"
  });
}

export function releaseLock(paths: WorkflowPaths): void {
  if (!fileExists(paths.lockDir)) return;
  let metadata: Partial<LockMetadata>;
  try {
    metadata = readJson<Partial<LockMetadata>>(paths.lockFile);
  } catch {
    return;
  }
  if (metadata.pid !== process.pid) return;
  fs.rmSync(paths.lockDir, { recursive: true, force: true });
}
