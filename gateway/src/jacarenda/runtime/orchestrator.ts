/**
 * Agent orchestrator — one-turn runs (Phase 2.1a).
 *
 * Tools, approvals, scheduler, and spend-cap enforcement land in 2.2+.
 * This module stays the single integration point, so those additions slot in
 * without fanning out.
 *
 * Security posture (enforced here):
 * - tenantId must match the agent's tenant_id — never run cross-tenant
 * - user input capped at MAX_INPUT_CHARS
 * - personality + rules build the system prompt; no tenant-free prompt path
 * - LLM call has a hard timeout (60s)
 * - spend-cap *advisory* in 2.1a (we log cost but don't enforce); 2.5 adds enforcement
 * - every run writes structured events; all writes flow through run-store which
 *   redacts secret-shaped strings before persisting
 * - errors are caught and logged; the caller gets a sanitised error message,
 *   not a stack trace
 */

import { getAgent, type Agent } from "../agent-store.js";
import { DEFAULT_TENANT_ID } from "../schema.js";
import { estimateCostCents, llmComplete } from "./llm-client.js";
import {
  appendEvent,
  finishRun,
  startRun,
  type RunRow,
  type TriggeredBy,
} from "./run-store.js";

const MAX_INPUT_CHARS = 4000;
const LLM_TIMEOUT_MS = 60_000;

export interface RunAgentInput {
  agentId: string;
  tenantId?: string;
  userInput: string;
  triggeredBy: TriggeredBy;
  triggeredByActor?: string;
}

export interface RunAgentResult {
  run: RunRow;
  responseText: string;
}

export class RuntimeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "agent_not_found"
      | "input_too_long"
      | "agent_not_runnable"
      | "llm_failed"
      | "internal",
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}

export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;

  if (input.userInput.length > MAX_INPUT_CHARS) {
    throw new RuntimeError(
      `Input exceeds ${MAX_INPUT_CHARS} characters.`,
      "input_too_long",
    );
  }

  const agent = getAgent(input.agentId, tenantId);
  if (!agent) {
    throw new RuntimeError("Agent not found.", "agent_not_found");
  }
  if (agent.status === "archived") {
    throw new RuntimeError(
      "Agent is archived and cannot be run.",
      "agent_not_runnable",
    );
  }

  const run = startRun({
    agentId: agent.id,
    tenantId,
    triggeredBy: input.triggeredBy,
    triggeredByActor: input.triggeredByActor,
  });

  appendEvent(run.id, "run_started", {
    triggeredBy: input.triggeredBy,
    triggeredByActor: input.triggeredByActor ?? null,
    userInputChars: input.userInput.length,
  });

  const systemPrompt = buildSystemPrompt(agent);

  try {
    appendEvent(run.id, "llm_call", {
      model: "claude-sonnet-4-6",
      systemChars: systemPrompt.length,
      userInputChars: input.userInput.length,
    });

    const result = await withTimeout(
      llmComplete({
        system: systemPrompt,
        userMessage: input.userInput,
        maxTokens: 1024,
      }),
      LLM_TIMEOUT_MS,
      "LLM call timed out after 60s.",
    );

    const costCents = estimateCostCents(result.usage);

    appendEvent(run.id, "llm_response", {
      stopReason: result.stopReason,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costCents,
      responseChars: result.text.length,
    });

    const summary = truncate(result.text, 500);
    appendEvent(run.id, "run_completed", {
      totalCostCents: costCents,
      summary,
    });
    const finished = finishRun({
      runId: run.id,
      status: "succeeded",
      totalCostCents: costCents,
      summary,
    });
    return {
      run: finished ?? { ...run, status: "succeeded", summary },
      responseText: result.text,
    };
  } catch (err) {
    const message =
      err instanceof RuntimeError ? err.message : sanitiseError(err);
    appendEvent(run.id, "error", { message });
    finishRun({
      runId: run.id,
      status: "failed",
      totalCostCents: 0,
      summary: message,
    });
    if (err instanceof RuntimeError) throw err;
    throw new RuntimeError(message, "llm_failed");
  }
}

function buildSystemPrompt(agent: Agent): string {
  const rules = agent.rules.trim();
  const parts = [
    agent.personality.trim(),
    rules ? `# Rules (hard guardrails — never cross these)\n${rules}` : "",
    `# Operating context`,
    `You are ${agent.name}, operating on behalf of the Jacarenda Labs account.`,
    agent.trustMode === "draft"
      ? "You are in DRAFT mode — your output is a draft for human review, nothing ships without approval."
      : agent.trustMode === "ask"
        ? "You are in ASK mode — propose concrete actions, but always ask before anything leaves the building."
        : "You are in AUTOPILOT mode — act decisively on behalf of the account, but stay inside your rules.",
  ].filter(Boolean);
  return parts.join("\n\n");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let to: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        to = setTimeout(
          () => reject(new RuntimeError(message, "llm_failed")),
          ms,
        );
      }),
    ]);
  } finally {
    if (to) clearTimeout(to);
  }
}

function sanitiseError(err: unknown): string {
  // Never surface raw stack traces / SDK internals to the UI. Keep it short.
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Unknown error";
  // Strip anything that looks like a credential fragment just in case.
  return raw.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]").slice(0, 300);
}
