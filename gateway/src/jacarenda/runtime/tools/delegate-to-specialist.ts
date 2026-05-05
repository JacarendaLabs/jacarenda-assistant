/**
 * delegate.to_specialist — Personal Assistant hands a sub-task to a
 * specialist agent (e.g. "ask the marketing agent to draft a tweet about
 * the 2.3c launch").
 *
 * Phase 2.3c2.5 — async + Slack post-back. The PA fires-and-forgets the
 * specialist run and immediately gets a "queued" tool result so its
 * own turn finishes within seconds. When the specialist eventually
 * completes (or pauses on its own approval gate, or fails), a separate
 * reply lands in the originating Slack thread.
 *
 *   ┌───────────┐  delegate  ┌────────────┐
 *   │   PA      │───────────▶│ Specialist │── (background) ─▶ Slack
 *   │ (run A)   │            │  (run B,   │     thread reply
 *   │ replies   │            │  parent=A) │
 *   │ instantly │            └────────────┘
 *   └───────────┘
 *
 * Why async: long specialist work (>30s) used to block the PA's reply
 * to the user. Now the PA can say "I've handed this to <specialist>;
 * they'll reply when ready" and the user sees the answer as a follow-up
 * thread bump — same Slack thread, no context loss.
 *
 * Lineage: child runs are written with `parent_run_id = ctx.runId` so
 * the admin UI can render the PA → specialist tree.
 *
 * Recursion guard: a delegated run cannot itself delegate. If a
 * specialist agent's allowlist accidentally contains this tool, we
 * short-circuit at execute() with `delegation_not_permitted`.
 *
 * Tool isMutating: false. The tool itself doesn't side-effect — but the
 * specialist may call mutating tools, which gate at their own approval
 * boundary against the child run's threadTs (so approvals still surface
 * in the originating Slack thread).
 */

import { z } from "zod";

import { getLogger } from "../../../logger.js";
import { getAgent, listAgents, type Agent } from "../../agent-store.js";
import { runAgent } from "../orchestrator.js";
import { getRun } from "../run-store.js";
import { getSlackBotToken } from "../slack-credentials.js";
import type { ToolImpl, ToolContext } from "../tool-context.js";
import { ToolExecutionError } from "../tool-context.js";

const log = getLogger("jacarenda-delegate-to-specialist");

const SLACK_POST_TIMEOUT_MS = 10_000;

const inputSchema = z
  .object({
    specialistAgentId: z
      .string()
      .uuid()
      .describe(
        "ID of the specialist agent that should handle the sub-task. Use list_agents (or memory.recall) first if unsure.",
      ),
    task: z
      .string()
      .trim()
      .min(8)
      .max(2000)
      .describe(
        "What you want the specialist to do, in their voice — they will see this as the user prompt. Be specific; the specialist does not see this conversation's history.",
      ),
  })
  .strict();

type DelegateInput = z.infer<typeof inputSchema>;

export const delegateToSpecialistTool: ToolImpl<DelegateInput> = {
  id: "delegate.to_specialist",
  isMutating: false,
  inputSchema,
  description:
    "Hand a sub-task to a specialist agent (marketing, sales, etc.) and return their answer. The specialist runs as a child of your conversation — their tools, their guardrails, their trust mode — and surfaces their final response so you can use it in your reply to the user.",
  anthropicInputSchema: {
    type: "object",
    required: ["specialistAgentId", "task"],
    properties: {
      specialistAgentId: {
        type: "string",
        format: "uuid",
        description:
          "ID of the specialist agent to delegate to. Must be a different agent in the same tenant.",
      },
      task: {
        type: "string",
        minLength: 8,
        maxLength: 2000,
        description:
          "What you want the specialist to do, in their voice. They will see this as the user prompt and will not see this conversation's history.",
      },
    },
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<unknown> {
    // Recursion guard. If a specialist's allowlist accidentally permits
    // delegate.to_specialist, refuse — chains of delegations are not
    // supported until we add proper depth tracking + cycle detection.
    const callerRun = getRun(ctx.runId, ctx.tenantId);
    if (callerRun?.parentRunId) {
      throw new ToolExecutionError(
        "delegate.to_specialist cannot be called from a delegated run (no nested delegation in 2.3c2).",
        "upstream_failure",
      );
    }

    // Self-delegation is a footgun — the LLM might try to "delegate to
    // myself" to escape its own context. Refuse.
    if (input.specialistAgentId === ctx.agent.id) {
      throw new ToolExecutionError(
        "Cannot delegate to yourself.",
        "input_validation",
      );
    }

    const specialist = getAgent(input.specialistAgentId, ctx.tenantId);
    if (!specialist) {
      throw new ToolExecutionError(
        `Specialist agent ${input.specialistAgentId} not found in tenant.`,
        "input_validation",
      );
    }

    if (specialist.status !== "active") {
      throw new ToolExecutionError(
        `Specialist ${specialist.name} is currently ${specialist.status} — pick another or resume them first.`,
        "upstream_failure",
      );
    }

    // Phase 2.3c2.5 — fire-and-forget. The PA gets back a `kind:
    // "specialist_queued"` result immediately so it can finalise its own
    // turn ("I've handed this to <specialist>; they'll reply when ready")
    // and the user is not left staring at a thinking indicator while a
    // 30-90s specialist call grinds.
    //
    // The actual specialist run starts here (synchronously, so we know
    // it's been admitted by the orchestrator) but we do NOT await its
    // completion. Process lifetime: this works on Fly because the
    // gateway is a long-lived process. It would NOT work on a serverless
    // platform that recycles after the request — every async deployment
    // target needs its own re-design before adopting this pattern.
    const slackThreadTs = callerRun?.slackThreadTs ?? undefined;
    const promise = runAgent({
      agentId: specialist.id,
      tenantId: ctx.tenantId,
      userInput: input.task,
      triggeredBy: "delegated",
      triggeredByActor: ctx.agent.name,
      slackThreadTs,
      parentRunId: ctx.runId,
    });

    // Schedule the post-back. We deliberately don't pass `slackThreadTs`
    // through if it's empty — admin-UI-originated delegations finish
    // silently in that case (the result is visible in the run timeline).
    promise
      .then((outcome) => {
        if (!slackThreadTs) {
          log.info(
            { specialistRunId: outcome.run.id, kind: outcome.kind },
            "specialist completed; no slack thread to post back to",
          );
          return;
        }
        if (outcome.kind === "needs_approval") {
          // The specialist's own approval dispatcher already posted an
          // approval card in this thread — no extra reply needed (avoids
          // double-bumping the thread).
          log.info(
            {
              specialistRunId: outcome.run.id,
              approvalId: outcome.approvalId,
            },
            "specialist paused on approval; dispatcher handles thread post",
          );
          return;
        }
        // outcome.kind === "done"
        return postReplyToThread(
          slackThreadTs,
          formatSpecialistResponse(specialist.name, outcome.responseText),
        );
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        log.error(
          { specialistId: specialist.id, message },
          "specialist run failed in async delegation",
        );
        if (slackThreadTs) {
          void postReplyToThread(
            slackThreadTs,
            `${specialist.name} couldn't finish that task: ${truncate(message, 280)}`,
          );
        }
      });

    return {
      kind: "specialist_queued",
      specialistName: specialist.name,
      message:
        `Handed off to ${specialist.name}. They'll post their answer in this thread when they're done. ` +
        "If they need approval first, you'll see an approval card here.",
    };
  },
};

/**
 * Format the specialist's final response as a Slack thread reply. Keeps
 * the prefix short so the actual answer is the first thing the user
 * scans for.
 */
function formatSpecialistResponse(
  specialistName: string,
  body: string,
): string {
  const trimmed = (body ?? "").trim();
  if (!trimmed) {
    return `${specialistName}: (no reply)`;
  }
  return `${specialistName}:\n${trimmed}`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Post a threaded reply to Slack. `slackThreadTs` follows the
 * `<channelId>:<threadTs>` convention used everywhere else in the
 * jacarenda runtime — same shape parseThreadRef in the approval
 * dispatcher consumes. Failures are logged but never throw — a Slack
 * outage must not corrupt the specialist's run status.
 */
async function postReplyToThread(
  slackThreadTs: string,
  text: string,
): Promise<void> {
  const idx = slackThreadTs.indexOf(":");
  if (idx <= 0 || idx >= slackThreadTs.length - 1) {
    log.warn({ slackThreadTs }, "malformed slackThreadTs — skipping reply");
    return;
  }
  const channelId = slackThreadTs.slice(0, idx);
  const threadTs = slackThreadTs.slice(idx + 1);

  const token = await getSlackBotToken();
  if (!token) {
    log.warn(
      { channelId, threadTs },
      "Slack bot token unavailable — skipping specialist reply",
    );
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SLACK_POST_TIMEOUT_MS);
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: channelId,
        thread_ts: threadTs,
        text,
        unfurl_links: false,
        unfurl_media: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      log.warn(
        { status: res.status, channelId, threadTs },
        "specialist post-back returned non-2xx",
      );
      return;
    }
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
    } | null;
    if (!body?.ok) {
      log.warn(
        { channelId, threadTs, error: body?.error },
        "specialist post-back: slack returned ok=false",
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ channelId, threadTs, message }, "specialist post-back failed");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Helper used by orchestrator + admin UI to surface the list of agents a
 * caller can delegate to. Excludes the caller, agents in non-active status,
 * and the caller's own children (which can't accept further delegation).
 */
export function listDelegationTargets(
  caller: Agent,
  tenantId: string = caller.tenantId,
): Agent[] {
  return listAgents(tenantId).filter(
    (a) => a.id !== caller.id && a.status === "active",
  );
}
