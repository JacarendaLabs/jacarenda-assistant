/**
 * Tool registry — maps tool id → implementation.
 *
 * The orchestrator never iterates tools freely. It resolves by id
 * through `getToolImpl()`, and the lookup validates against an agent's
 * allowlist elsewhere (see `orchestrator.selectToolsForAgent`).
 */

import type { ToolImpl } from "./tool-context.js";
import { fiberyCreateTool } from "./tools/fibery-create.js";
import { fiberyQueryTool } from "./tools/fibery-query.js";
import { slackDmTool } from "./tools/slack-dm.js";
import { slackPostToChannelTool } from "./tools/slack-post-to-channel.js";

const TOOL_IMPLS: ToolImpl[] = [
  fiberyQueryTool,
  fiberyCreateTool,
  slackPostToChannelTool,
  slackDmTool,
];

const BY_ID: Map<string, ToolImpl> = new Map(TOOL_IMPLS.map((t) => [t.id, t]));

export function getToolImpl(id: string): ToolImpl | undefined {
  return BY_ID.get(id);
}

export function allToolImpls(): readonly ToolImpl[] {
  return TOOL_IMPLS;
}
