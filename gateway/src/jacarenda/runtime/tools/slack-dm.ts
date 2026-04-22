/**
 * slack.dm — send a direct message to a Slack user.
 *
 * Credential source: Slack `slack_channel/bot_token` via
 * `getSlackBotToken()` (CES-first, encrypted-file fallback).
 *
 * Slack's chat.postMessage accepts a user id (U...) as the channel
 * argument and opens / reuses the IM channel server-side. No
 * conversations.open round-trip needed.
 *
 * Mutating → `isMutating: true`. Same trust-mode gate as
 * slack.post-to-channel — blocked in draft/ask until Phase 2.3.
 */

import { z } from "zod";

import type { ToolImpl, ToolContext } from "../tool-context.js";
import { ToolExecutionError } from "../tool-context.js";
import { getSlackBotToken } from "../slack-credentials.js";
import { __slackPostInternal } from "./slack-post-to-channel.js";

const MAX_TEXT_CHARS = 3500;

/** Slack user id: `U...` or `W...` (Enterprise Grid), 9-11 alnum. */
const USER_ID = /^[UW][A-Z0-9]{8,10}$/;

const inputSchema = z
  .object({
    userId: z
      .string()
      .regex(
        USER_ID,
        "Must be a Slack user id like 'U0123ABCDEF' (starts with U or W). Display names / emails are not accepted.",
      ),
    text: z.string().min(1).max(MAX_TEXT_CHARS),
  })
  .strict();

type SlackDmInput = z.infer<typeof inputSchema>;

export const slackDmTool: ToolImpl<SlackDmInput> = {
  id: "slack.dm",
  isMutating: true,
  inputSchema,
  description:
    "Send a direct message to a Slack user. Use a user id (starts with U or W), not a display name. Agent-origin audit tag appended to every DM.",
  anthropicInputSchema: {
    type: "object",
    properties: {
      userId: {
        type: "string",
        pattern: "^[UW][A-Z0-9]{8,10}$",
        description: "Slack user id (starts with U or W).",
      },
      text: {
        type: "string",
        minLength: 1,
        maxLength: MAX_TEXT_CHARS,
      },
    },
    required: ["userId", "text"],
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

    const tag = `\n\n_from ${ctx.agent.name} · agent:${ctx.agent.id.slice(0, 8)} run:${ctx.runId.slice(0, 8)}_`;
    const text = (input.text + tag).slice(0, MAX_TEXT_CHARS + tag.length);

    return __slackPostInternal(
      "chat.postMessage",
      { channel: input.userId, text },
      token,
    );
  },
};
