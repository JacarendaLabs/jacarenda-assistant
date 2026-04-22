/**
 * slack.post-to-channel — post a message to a Slack channel.
 *
 * Credential source: Slack `slack_channel/bot_token` via
 * `getSlackBotToken()` — CES when CES_CREDENTIAL_URL is set
 * (Docker mode), encrypted-file fallback otherwise. Per
 * RUNTIME_SECURITY.md §1 this is the *only* allowed path.
 *
 * Mutating → `isMutating: true`. Trust-mode gate in the orchestrator
 * hard-rejects in draft/ask (Phase 2.3 adds the approval dispatch that
 * turns the rejection into a proper ask-in-Slack flow).
 */

import { z } from "zod";

import type { ToolImpl, ToolContext } from "../tool-context.js";
import { ToolExecutionError } from "../tool-context.js";
import { getSlackBotToken } from "../slack-credentials.js";

const MAX_TEXT_CHARS = 3500;
const SLACK_TIMEOUT_MS = 15_000;

/** Slack channel id: `C...` (public), `G...` (private) — 9-11 alnum chars.
 *  We deliberately reject channel *names* (`#marketing`) — names are mutable,
 *  ids are stable and removing name-resolution shrinks the attack surface. */
const CHANNEL_ID = /^[CG][A-Z0-9]{8,10}$/;

const inputSchema = z
  .object({
    channelId: z
      .string()
      .regex(
        CHANNEL_ID,
        "Must be a Slack channel id like 'C0123ABCDEF' (starts with C or G). Channel names are not accepted.",
      ),
    text: z
      .string()
      .min(1)
      .max(MAX_TEXT_CHARS)
      .describe(
        "Message body. Slack's markdown-ish formatting is supported (bold with *, italic with _, code with `).",
      ),
  })
  .strict();

type SlackPostInput = z.infer<typeof inputSchema>;

export const slackPostToChannelTool: ToolImpl<SlackPostInput> = {
  id: "slack.post-to-channel",
  isMutating: true,
  inputSchema,
  description:
    "Post a message to a Slack channel. Use a channel id (starts with C or G), not a #name. Posts 3500 characters max. Every message carries an agent audit tag so human readers know it's agent-generated.",
  anthropicInputSchema: {
    type: "object",
    properties: {
      channelId: {
        type: "string",
        pattern: "^[CG][A-Z0-9]{8,10}$",
        description:
          "Slack channel id (starts with C or G). Names like '#marketing' are rejected.",
      },
      text: {
        type: "string",
        minLength: 1,
        maxLength: MAX_TEXT_CHARS,
      },
    },
    required: ["channelId", "text"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<unknown> {
    const token = await getSlackBotToken();
    if (!token) {
      throw new ToolExecutionError(
        "Slack is not connected for this workspace.",
        "credential_missing",
      );
    }

    // Audit tag so human Slack readers can spot agent posts. The
    // short ids keep the message tidy but still trace back to the run.
    const tag = `\n\n_from ${ctx.agent.name} · agent:${ctx.agent.id.slice(0, 8)} run:${ctx.runId.slice(0, 8)}_`;
    const text = (input.text + tag).slice(0, MAX_TEXT_CHARS + tag.length);

    return postToSlack(
      "chat.postMessage",
      { channel: input.channelId, text },
      token,
    );
  },
};

async function postToSlack(
  method: string,
  body: Record<string, unknown>,
  token: string,
): Promise<unknown> {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Defence-in-depth — even though the err shouldn't contain the token,
    // strip any bearer-looking fragment.
    const safe = msg.replace(/xox[abps]-[A-Za-z0-9-]{10,}/g, "[redacted]");
    throw new ToolExecutionError(
      `Slack request failed: ${safe.slice(0, 200)}`,
      "upstream_failure",
    );
  } finally {
    clearTimeout(to);
  }

  if (!res.ok) {
    throw new ToolExecutionError(
      `Slack returned HTTP ${res.status}.`,
      "upstream_failure",
    );
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    throw new ToolExecutionError(
      "Slack returned a non-JSON response.",
      "upstream_failure",
    );
  }

  const envelope = parsed as {
    ok?: boolean;
    error?: string;
    ts?: string;
    channel?: string;
  };
  if (!envelope.ok) {
    throw new ToolExecutionError(
      `Slack API error: ${envelope.error ?? "unknown"}`,
      "upstream_failure",
    );
  }

  return {
    ok: true,
    ts: envelope.ts ?? "",
    channel: envelope.channel ?? "",
  };
}

// Exported for reuse by slack.dm — keeps the Slack HTTP path in one place
// so any future change (retry policy, rate-limit handling) lands once.
export const __slackPostInternal = postToSlack;
