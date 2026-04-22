/**
 * Slack inbound interactivity — block_actions → decideApproval + resumeAgent.
 *
 * Phase 2.3b2. Socket Mode delivers block_actions payloads authenticated
 * at the WebSocket layer (app-level token, long-lived WS handshake), so
 * no webhook signing-secret verification is required.
 *
 * Contract:
 *  - We own two action_ids: `APPROVAL_ACTION_APPROVE` / `..._REJECT`
 *    (defined in slack-approval-dispatcher.ts). If the incoming action
 *    is neither, `handleApprovalBlockAction` returns `"passthrough"`
 *    and the caller falls through to the normal inbound pipeline.
 *  - `action.value` carries the approval id — load-bearing link back to
 *    `agent_approvals`. Never parse it as anything else.
 *  - We always update the original Slack message to show the terminal
 *    state (approved/rejected by user + time) so the buttons can't be
 *    re-clicked ambiguously. If the update fails we log + continue
 *    (the run still advances; user can confirm via admin UI).
 *  - Already-decided clicks are idempotent — we update the message to
 *    say "Already decided by <actor>" instead of resuming the run.
 *  - All errors are swallowed into log lines + a Slack message update.
 *    Socket Mode envelopes are ACK'd upstream by the socket-mode client
 *    regardless; there is no HTTP response to fail.
 */

import { getLogger } from "../../logger.js";
import type { SlackBlockActionsPayload as NormalizeSlackBlockActionsPayload } from "../../slack/normalize.js";
import {
  ApprovalAlreadyDecidedError,
  decideApproval,
  getApproval,
  type DecisionKind,
} from "../approval-store.js";
import { resumeAgent, RuntimeError } from "./orchestrator.js";
import { getSlackBotToken } from "./slack-credentials.js";
import {
  APPROVAL_ACTION_APPROVE,
  APPROVAL_ACTION_REJECT,
} from "./slack-approval-dispatcher.js";

const log = getLogger("jacarenda-slack-interactivity");

const SLACK_UPDATE_TIMEOUT_MS = 10_000;

/**
 * Re-export the upstream Slack payload type — we keep a single source of
 * truth for the shape in `gateway/src/slack/normalize.ts` so any future
 * Slack API drift has exactly one spot to update.
 */
export type SlackBlockActionsPayload = NormalizeSlackBlockActionsPayload;

export type HandleResult = "handled" | "passthrough";

function isApprovalActionId(id: string): boolean {
  return id === APPROVAL_ACTION_APPROVE || id === APPROVAL_ACTION_REJECT;
}

function decisionForActionId(id: string): DecisionKind | null {
  if (id === APPROVAL_ACTION_APPROVE) return "approved";
  if (id === APPROVAL_ACTION_REJECT) return "rejected";
  return null;
}

function displayActor(user: SlackBlockActionsPayload["user"]): string {
  const name = user?.name ?? user?.username;
  if (name) return `@${name}`;
  if (user?.id) return user.id;
  return "unknown user";
}

/**
 * Route a Slack block_actions payload to the approvals pipeline.
 *
 * Returns `"handled"` when the action_id is one of ours (whether the
 * decide succeeded or not — the caller should not treat it as a user
 * message either way). Returns `"passthrough"` if this payload is for
 * some other Block Kit button we didn't originate.
 */
export async function handleApprovalBlockAction(
  payload: SlackBlockActionsPayload,
): Promise<HandleResult> {
  const action = payload.actions?.[0];
  if (!action || !isApprovalActionId(action.action_id)) {
    return "passthrough";
  }

  const decision = decisionForActionId(action.action_id);
  if (!decision) {
    // Defensive — isApprovalActionId already gated this.
    return "handled";
  }

  const approvalId = action.value;
  if (typeof approvalId !== "string" || approvalId.length === 0) {
    log.warn(
      { actionId: action.action_id },
      "Approval button missing approvalId in action.value",
    );
    await tryUpdateSlackMessage(payload, {
      mrkdwn:
        "This approval button is malformed — please resolve it from the admin UI.",
    });
    return "handled";
  }

  const approval = getApproval(approvalId);
  if (!approval) {
    log.warn({ approvalId }, "Approval not found for Slack button click");
    await tryUpdateSlackMessage(payload, {
      mrkdwn: `This approval (\`${shortId(approvalId)}\`) no longer exists.`,
    });
    return "handled";
  }

  const decidedBy = decidedByString(payload);

  try {
    decideApproval({ id: approval.id, decision, decidedBy });
  } catch (err) {
    if (err instanceof ApprovalAlreadyDecidedError) {
      log.info(
        { approvalId, currentDecision: err.currentDecision },
        "Slack button click on already-decided approval",
      );
      await tryUpdateSlackMessage(payload, {
        mrkdwn: `Already ${err.currentDecision} — no action taken.`,
      });
      return "handled";
    }
    log.error({ err, approvalId }, "decideApproval failed from Slack button");
    await tryUpdateSlackMessage(payload, {
      mrkdwn:
        "Could not record that decision — please retry from the admin UI.",
    });
    return "handled";
  }

  // Decision recorded — tell the user immediately so they see the
  // button has cleared even if the resume takes several seconds.
  await tryUpdateSlackMessage(payload, {
    mrkdwn: renderTerminalMessage(approval.question, decision, decidedBy),
  });

  // Resume the run. Fire-and-forget from Slack's perspective — we don't
  // delay the Socket Mode ACK on this. Errors are logged; the admin UI
  // will show the run's state regardless.
  resumeAgent(approval.runId, decision, decidedBy)
    .then((outcome) => {
      log.info(
        { approvalId, runId: approval.runId, outcomeKind: outcome.kind },
        "resumeAgent completed after Slack approval click",
      );
    })
    .catch((err) => {
      if (err instanceof RuntimeError) {
        log.warn(
          { approvalId, runId: approval.runId, code: err.code },
          "resumeAgent returned RuntimeError after Slack approval click",
        );
      } else {
        log.error(
          { err, approvalId, runId: approval.runId },
          "resumeAgent threw after Slack approval click",
        );
      }
    });

  return "handled";
}

function decidedByString(payload: SlackBlockActionsPayload): string {
  const actor = displayActor(payload.user);
  return `slack:${actor}`.slice(0, 80);
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function renderTerminalMessage(
  question: string,
  decision: DecisionKind,
  decidedBy: string,
): string {
  const verb = decision === "approved" ? "Approved" : "Rejected";
  const when = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const displayName = decidedBy.replace(/^slack:/, "");
  return [
    `*${verb}* by ${escapeMrkdwn(displayName)} · ${when}`,
    "",
    escapeMrkdwn(truncate(question, 400)),
  ].join("\n");
}

interface SlackUpdateBody {
  mrkdwn: string;
}

async function tryUpdateSlackMessage(
  payload: SlackBlockActionsPayload,
  body: SlackUpdateBody,
): Promise<void> {
  const channelId = payload.channel?.id;
  const messageTs = payload.message?.ts;
  if (!channelId || !messageTs) {
    log.debug(
      { hasChannel: !!channelId, hasTs: !!messageTs },
      "Cannot update Slack message — missing channel or ts",
    );
    return;
  }

  const token = await getSlackBotToken();
  if (!token) {
    log.warn("Slack bot token unavailable — skipping message update");
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SLACK_UPDATE_TIMEOUT_MS);

  try {
    const res = await fetch("https://slack.com/api/chat.update", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: channelId,
        ts: messageTs,
        text: stripMrkdwn(body.mrkdwn),
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: body.mrkdwn },
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      log.warn(
        { status: res.status, channelId, messageTs },
        "chat.update returned non-2xx status",
      );
      return;
    }
    const parsed = (await res.json()) as { ok?: boolean; error?: string };
    if (!parsed.ok) {
      log.warn(
        { slackError: parsed.error, channelId, messageTs },
        "chat.update returned ok=false",
      );
    }
  } catch (err) {
    log.warn({ err, channelId, messageTs }, "chat.update fetch failed");
  } finally {
    clearTimeout(timer);
  }
}

function escapeMrkdwn(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function stripMrkdwn(s: string): string {
  return s.replace(/\*(.*?)\*/g, "$1").replace(/`/g, "");
}
