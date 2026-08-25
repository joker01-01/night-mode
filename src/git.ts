import { GitBaseline, Mode } from "./types";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const path = require("node:path");

export interface GitSnapshot extends GitBaseline {
  available: boolean;
  clean: boolean;
  changedPaths: string[];
  error?: string;
}

export interface GitPreflight {
  baseline: GitBaseline;
  clean: boolean;
  warnings: string[];
  checkpointAllowed: boolean;
}

function invoke(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const result = childProcess.spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
    return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? result.error?.message ?? "" };
  } catch (error) {
    return { status: -1, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
}

function normalizePrefix(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function ignoredPrefixes(cwd: string, stateDir?: string): string[] {
  const target = path.resolve(cwd, stateDir ?? ".codex/workflow");
  const relative = normalizePrefix(path.relative(path.resolve(cwd), target));
  return relative && relative !== "." && !relative.startsWith("..") ? [`${relative}/`] : [];
}

function changedPath(line: string): string {
  const value = line.slice(3).replaceAll("\\", "/");
  const renameSeparator = value.lastIndexOf(" -> ");
  return renameSeparator >= 0 ? value.slice(renameSeparator + 4) : value;
}

function relevantLines(status: string, ignored: string[]): string[] {
  return status.split(/\r?\n/).filter(Boolean).filter((line) => {
    const file = changedPath(line);
    return !ignored.some((prefix) => file.startsWith(prefix));
  });
}

function representationHash(initialCommit: string | null, status: string[], changedPaths: string[]): string {
  return crypto.createHash("sha256").update(JSON.stringify({ initialCommit, status, changedPaths })).digest("hex");
}

function emptySnapshot(error?: string): GitSnapshot {
  return {
    available: false,
    clean: false,
    changedPaths: [],
    initialCommit: null,
    initialStatus: [],
    initialChangedPaths: [],
    representationHash: representationHash(null, [], []),
    error
  };
}

export function gitSnapshot(cwd: string, stateDir?: string): GitSnapshot {
  const repository = invoke(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (repository.status !== 0 || repository.stdout.trim() !== "true") {
    return emptySnapshot(repository.stderr.trim() || "Target is not a Git working tree.");
  }
  const status = invoke(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.status !== 0) return emptySnapshot(status.stderr.trim() || "Unable to read Git status.");
  const initialStatus = relevantLines(status.stdout, ignoredPrefixes(cwd, stateDir));
  const initialChangedPaths = initialStatus.map(changedPath);
  const commitResult = invoke(cwd, ["rev-parse", "--verify", "HEAD"]);
  const initialCommit = commitResult.status === 0 ? commitResult.stdout.trim() || null : null;
  return {
    available: true,
    clean: initialChangedPaths.length === 0,
    changedPaths: initialChangedPaths,
    initialCommit,
    initialStatus,
    initialChangedPaths,
    representationHash: representationHash(initialCommit, initialStatus, initialChangedPaths)
  };
}

export function preflightGit(cwd: string, mode: Mode, allowDirty: boolean, stateDir?: string): GitPreflight {
  const snapshot = gitSnapshot(cwd, stateDir);
  if (!snapshot.available) {
    throw new Error(`Git preflight failed for ${path.resolve(cwd)}: ${snapshot.error ?? "target is not a Git working tree"}. Initialize Git or choose a Git worktree.`);
  }
  if (mode === "night" && !snapshot.clean && !allowDirty) {
    throw new Error(`Git preflight failed for Night Shift: the worktree is dirty (${snapshot.changedPaths.length} changed path(s)). Use --allow-dirty to run with baseline separation; checkpoints will be disabled.`);
  }
  const warnings: string[] = [];
  if (!snapshot.clean) {
    warnings.push(mode === "night"
      ? "Night Shift is running with --allow-dirty; the starting Git baseline is recorded and checkpoints are disabled."
      : "Interactive mode is starting on a dirty Git worktree; the starting baseline is recorded and checkpoints are disabled.");
  }
  return {
    baseline: {
      initialCommit: snapshot.initialCommit,
      initialStatus: snapshot.initialStatus,
      initialChangedPaths: snapshot.initialChangedPaths,
      representationHash: snapshot.representationHash
    },
    clean: snapshot.clean,
    warnings,
    checkpointAllowed: snapshot.clean
  };
}

export function createCheckpoint(cwd: string, message: string, stateDir?: string, pathsToStage?: string[]): string | undefined {
  const repository = gitSnapshot(cwd, stateDir);
  if (!repository.available) throw new Error("Git checkpoint requested, but cwd is not a Git repository.");
  const statePrefixes = ignoredPrefixes(cwd, stateDir);
  const candidates = (pathsToStage ?? repository.changedPaths).map((item) => normalizePrefix(item)).filter((item) => {
    if (!item || item === "PROJECT_STATE.md" || item === "MORNING_REPORT.md") return false;
    return !statePrefixes.some((prefix) => item.startsWith(prefix));
  });
  if (candidates.length === 0) return undefined;
  const add = invoke(cwd, ["add", "--all", "--", ...candidates]);
  if (add.status !== 0) throw new Error(`Git add failed: ${add.stderr.trim()}`);
  const staged = invoke(cwd, ["diff", "--cached", "--quiet"]);
  if (staged.status === 0) return undefined;
  const commit = invoke(cwd, ["commit", "-m", message]);
  if (commit.status !== 0) throw new Error(`Git checkpoint failed: ${commit.stderr.trim()}`);
  const hash = invoke(cwd, ["rev-parse", "HEAD"]);
  return hash.status === 0 ? hash.stdout.trim() : undefined;
}
