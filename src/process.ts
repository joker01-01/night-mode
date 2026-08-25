import { CommandResult } from "./types";
import { ensureDir, now } from "./storage";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

export interface SpawnOptions {
  command: string;
  args?: string[];
  cwd: string;
  outputFile: string;
  idleTimeoutSeconds: number;
  hardTimeoutSeconds: number;
  shell?: boolean;
}

export async function spawnAndWatch(options: SpawnOptions): Promise<CommandResult> {
  ensureDir(path.dirname(options.outputFile));
  const startedAt = now();
  const output = fs.createWriteStream(options.outputFile, { flags: "w" });
  const display = [options.command, ...(options.args ?? [])].join(" ");

  return new Promise<CommandResult>((resolve) => {
    let settled = false;
    let lastActivity = Date.now();
    let timedOut: "idle" | "hard" | undefined;
    let hardTimer: any;
    let idleTimer: any;
    let forceKillTimer: any;
    let child: any;
    let processError: string | undefined;

    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      if (hardTimer) clearTimeout(hardTimer);
      if (idleTimer) clearInterval(idleTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      output.end(() => resolve({ command: display, exitCode, error: processError, timedOut, outputFile: options.outputFile, startedAt, endedAt: now() }));
    };

    const terminate = (reason: "idle" | "hard") => {
      if (timedOut || settled) return;
      timedOut = reason;
      output.write(`\n[workflow] ${reason} timeout reached; stopping process.\n`);
      try { child.kill("SIGTERM"); } catch { /* process may already have ended */ }
      forceKillTimer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* process may already have ended */ }
      }, 5_000);
    };

    try {
      child = childProcess.spawn(options.command, options.args ?? [], {
        cwd: options.cwd,
        shell: options.shell ?? false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      output.write(`${String(error)}\n`);
      finish(-1);
      return;
    }

    const onData = (data: unknown) => {
      lastActivity = Date.now();
      output.write(data);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (error: Error) => {
      processError = error.message;
      output.write(`${error.message}\n`);
      finish(-1);
    });
    child.on("close", (code: number | null) => finish(code ?? -1));

    if (options.hardTimeoutSeconds > 0) {
      hardTimer = setTimeout(() => terminate("hard"), options.hardTimeoutSeconds * 1_000);
    }
    if (options.idleTimeoutSeconds > 0) {
      idleTimer = setInterval(() => {
        if (Date.now() - lastActivity >= options.idleTimeoutSeconds * 1_000) terminate("idle");
      }, 1_000);
    }
  });
}
