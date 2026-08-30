import { ReviewResult, WorkResult, WorkflowPaths } from "./types";
import { appendEvent, ensureDir, readJson, writeJsonAtomic } from "./storage";
import { spawnAndWatch } from "./process";
import { assertProjectStateProposal, assertProjectStateReview } from "./state";

const path = require("node:path");
const fs = require("node:fs");

const memoryCandidateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "statement", "tags", "citations"],
  properties: {
    kind: { enum: ["decision", "learning", "constraint"] },
    statement: { type: "string", minLength: 1, maxLength: 1000 },
    tags: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", minLength: 1, maxLength: 64 } },
    citations: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "startLine", "endLine"],
        properties: {
          path: { type: "string", minLength: 1 },
          startLine: { type: "integer", minimum: 1 },
          endLine: { type: "integer", minimum: 1 }
        }
      }
    }
  }
};

const projectStateProposalSchema = {
  type: "object",
  additionalProperties: false,
  required: ["outcomeSummary", "importantDecisions", "knownProblems", "verificationEvidence", "nextActions", "humanAcceptanceActions", "memoryCandidates"],
  properties: {
    outcomeSummary: { type: "string", minLength: 1 },
    importantDecisions: { type: "array", items: { type: "string", minLength: 1 } },
    knownProblems: { type: "array", items: { type: "string", minLength: 1 } },
    verificationEvidence: { type: "array", items: { type: "string", minLength: 1 } },
    nextActions: { type: "array", items: { type: "string", minLength: 1 } },
    humanAcceptanceActions: { type: "array", items: { type: "string", minLength: 1 } },
    memoryCandidates: { type: "array", items: memoryCandidateSchema }
  }
};

const workSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "assessment", "evidence", "nextStep", "blockerReason", "projectStateProposal"],
  properties: {
    status: { enum: ["IN_PROGRESS", "COMPLETE", "BLOCKED"] },
    assessment: { type: "string", minLength: 1 },
    evidence: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    nextStep: { type: "string", minLength: 1 },
    blockerReason: { type: "string" },
    projectStateProposal: projectStateProposalSchema
  }
};

const reviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "assessment", "feedback", "evidence", "projectStateReview"],
  properties: {
    decision: { enum: ["SHIP", "REVISE", "BLOCKED"] },
    assessment: { type: "string", minLength: 1 },
    feedback: { type: "string", minLength: 1 },
    evidence: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    projectStateReview: {
      type: "object",
      additionalProperties: false,
      required: ["decision", "proposal", "feedback"],
      properties: {
        decision: { enum: ["APPROVE", "CORRECT"] },
        proposal: projectStateProposalSchema,
        feedback: { type: "string", minLength: 1 }
      }
    }
  }
};

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmpty);
}

export function resolveCodexInvocation(input: {
  codexBin: string;
  args: string[];
  platform?: string;
  pathValue?: string;
  nodeExecutable?: string;
  exists?: (file: string) => boolean;
}): { command: string; args: string[] } {
  const platform = input.platform ?? process.platform;
  const exists = input.exists ?? ((file: string) => fs.existsSync(file));
  if (input.codexBin.toLowerCase().endsWith(".js") && exists(input.codexBin)) {
    return { command: input.nodeExecutable ?? process.execPath, args: [input.codexBin, ...input.args] };
  }
  if (platform !== "win32" || input.codexBin.toLowerCase() !== "codex") {
    return { command: input.codexBin, args: input.args };
  }

  const pathValue = input.pathValue ?? process.env.PATH ?? "";
  const joinPath = platform === "win32" ? path.win32.join : path.join;
  for (const directory of pathValue.split(";").map((entry: string) => entry.trim().replace(/^"|"$/g, "")).filter(Boolean)) {
    const cliScript = joinPath(directory, "node_modules", "@openai", "codex", "bin", "codex.js");
    if (exists(cliScript)) {
      return { command: input.nodeExecutable ?? process.execPath, args: [cliScript, ...input.args] };
    }
  }
  return { command: input.codexBin, args: input.args };
}

export function writeSchemas(paths: WorkflowPaths): void {
  writeJsonAtomic(paths.workSchemaFile, workSchema);
  writeJsonAtomic(paths.reviewSchemaFile, reviewSchema);
}

export function parseWorkResult(file: string): WorkResult {
  const data = readJson<Record<string, unknown>>(file);
  if (!["IN_PROGRESS", "COMPLETE", "BLOCKED"].includes(String(data.status)) || !nonEmpty(data.assessment) || !stringArray(data.evidence) || !nonEmpty(data.nextStep)) {
    throw new Error("Worker final message does not match the work contract.");
  }
  if (data.status === "BLOCKED" && !nonEmpty(data.blockerReason)) {
    throw new Error("Worker reported BLOCKED without blockerReason.");
  }
  if (data.projectStateProposal === undefined) throw new Error("Worker final message requires projectStateProposal.");
  const proposal = data.projectStateProposal as Record<string, unknown>;
  proposal.memoryCandidates ??= [];
  assertProjectStateProposal(data.projectStateProposal);
  return {
    status: data.status as WorkResult["status"],
    assessment: data.assessment,
    evidence: data.evidence,
    nextStep: data.nextStep,
    blockerReason: nonEmpty(data.blockerReason) ? data.blockerReason : undefined,
    projectStateProposal: data.projectStateProposal as WorkResult["projectStateProposal"] | undefined
  };
}

export function parseReviewResult(file: string): ReviewResult {
  const data = readJson<Record<string, unknown>>(file);
  if (!["SHIP", "REVISE", "BLOCKED"].includes(String(data.decision)) || !nonEmpty(data.assessment) || !nonEmpty(data.feedback) || !stringArray(data.evidence)) {
    throw new Error("Reviewer final message does not match the review contract.");
  }
  if (data.projectStateReview === undefined) throw new Error("Reviewer final message requires projectStateReview.");
  const stateReview = data.projectStateReview as Record<string, unknown>;
  if (typeof stateReview.proposal === "object" && stateReview.proposal !== null) (stateReview.proposal as Record<string, unknown>).memoryCandidates ??= [];
  assertProjectStateReview(data.projectStateReview);
  return {
    decision: data.decision as ReviewResult["decision"],
    assessment: data.assessment,
    feedback: data.feedback,
    evidence: data.evidence,
    projectStateReview: data.projectStateReview as ReviewResult["projectStateReview"] | undefined
  };
}

export async function runCodexPhase(input: {
  paths: WorkflowPaths;
  codexBin: string;
  phase: "work" | "review";
  taskId: string;
  attempt: number;
  prompt: string;
  idleTimeoutSeconds: number;
  hardTimeoutSeconds: number;
}): Promise<{ resultFile: string; commandExit: number; timedOut?: "idle" | "hard"; logFile: string; error?: string }> {
  ensureDir(input.paths.phaseDir);
  const basename = `${input.taskId}-attempt-${input.attempt}-${input.phase}`;
  const resultFile = path.join(input.paths.phaseDir, `${basename}.json`);
  const logFile = path.join(input.paths.phaseDir, `${basename}.jsonl`);
  const schemaFile = input.phase === "work" ? input.paths.workSchemaFile : input.paths.reviewSchemaFile;
  const sandbox = input.phase === "work" ? "workspace-write" : "read-only";
  appendEvent(input.paths.eventsFile, "phase_started", { phase: input.phase, taskId: input.taskId, attempt: input.attempt, sandbox });
  const invocation = resolveCodexInvocation({
    codexBin: input.codexBin,
    args: ["exec", "-C", input.paths.cwd, "--sandbox", sandbox, "--output-last-message", resultFile, "--output-schema", schemaFile, "--json", input.prompt]
  });
  const command = await spawnAndWatch({
    command: invocation.command,
    args: invocation.args,
    cwd: input.paths.cwd,
    outputFile: logFile,
    idleTimeoutSeconds: input.idleTimeoutSeconds,
    hardTimeoutSeconds: input.hardTimeoutSeconds
  });
  appendEvent(input.paths.eventsFile, "phase_finished", { phase: input.phase, taskId: input.taskId, attempt: input.attempt, exitCode: command.exitCode, timedOut: command.timedOut ?? null, logFile });
  return { resultFile, commandExit: command.exitCode, timedOut: command.timedOut, logFile, error: command.error };
}
