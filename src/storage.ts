import { WorkflowPaths } from "./types";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

export function now(): string {
  return new Date().toISOString();
}

export function workflowPaths(cwd: string, stateDir?: string): WorkflowPaths {
  const resolvedStateDir = path.resolve(cwd, stateDir ?? ".codex/workflow");
  return {
    cwd: path.resolve(cwd),
    stateDir: resolvedStateDir,
    stateFile: path.join(resolvedStateDir, "run-state.json"),
    failureFile: path.join(resolvedStateDir, "failure-memory.json"),
    eventsFile: path.join(resolvedStateDir, "events.jsonl"),
    lockDir: path.join(resolvedStateDir, ".lock"),
    lockFile: path.join(resolvedStateDir, ".lock", "metadata.json"),
    pauseFile: path.join(resolvedStateDir, "PAUSE"),
    stopFile: path.join(resolvedStateDir, "STOP"),
    workSchemaFile: path.join(resolvedStateDir, "work-schema.json"),
    reviewSchemaFile: path.join(resolvedStateDir, "review-schema.json"),
    handoffFile: path.join(resolvedStateDir, "HANDOFF.md"),
    validationDir: path.join(resolvedStateDir, "validation"),
    phaseDir: path.join(resolvedStateDir, "phases"),
    projectStateFile: path.join(path.resolve(cwd), "PROJECT_STATE.md")
  };
}

export function ensureDir(directory: string): void {
  fs.mkdirSync(directory, { recursive: true });
}

export function fileExists(file: string): boolean {
  return fs.existsSync(file);
}

export function readText(file: string): string {
  return fs.readFileSync(file, "utf8");
}

export function writeText(file: string, content: string): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content, "utf8");
}

export function writeTextAtomic(file: string, content: string): void {
  ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, content, "utf8");
  fs.renameSync(temporary, file);
}

export function readJson<T>(file: string): T {
  const content = readText(file);
  return JSON.parse(content.startsWith("\uFEFF") ? content.slice(1) : content) as T;
}

export function writeJsonAtomic(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

export function appendEvent(file: string, event: string, detail: Record<string, unknown> = {}): void {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify({ at: now(), event, ...detail })}\n`, "utf8");
}

export function sha256Text(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function sha256File(file: string): string {
  return sha256Text(readText(file));
}

export function relativeToCwd(cwd: string, target: string): string {
  const relative = path.relative(cwd, target);
  return relative || ".";
}
