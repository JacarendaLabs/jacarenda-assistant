/**
 * Agent platform — admin API routes.
 *
 * All under `/admin/api/jacarenda/*`, gated by the admin session cookie
 * (same auth as the existing Channels routes). Namespaced under
 * `jacarenda` so this whole tree is clearly owned by our fork and
 * separable from upstream admin routes.
 */

import type { RouteDefinition } from "../http/router.js";
import { requireAdminSession } from "../admin/session.js";
import {
  createAgent,
  deleteAgent,
  getAgent,
  listAgents,
  updateAgent,
  type CreateAgentInput,
  type UpdateAgentInput,
} from "./agent-store.js";
import { TEMPLATES, getTemplate } from "./templates.js";
import { TOOLS } from "./tools.js";
import {
  ApprovalAlreadyDecidedError,
  decideApproval,
  getApproval,
  listPendingApprovals,
} from "./approval-store.js";
import { resumeAgent, runAgent, RuntimeError } from "./runtime/orchestrator.js";
import { listEvents, listRunsForAgent, getRun } from "./runtime/run-store.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function unauthorized(): Response {
  return json({ error: "Unauthorized" }, 401);
}

async function parseJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function createJacarendaRoutes(): RouteDefinition[] {
  return [
    // Templates — public-ish read (still gated by admin session)
    {
      path: "/admin/api/jacarenda/templates",
      method: "GET",
      auth: "custom",
      handler: (req) => {
        if (!requireAdminSession(req)) return unauthorized();
        return json({ templates: TEMPLATES });
      },
    },

    // Tool registry
    {
      path: "/admin/api/jacarenda/tools",
      method: "GET",
      auth: "custom",
      handler: (req) => {
        if (!requireAdminSession(req)) return unauthorized();
        return json({ tools: TOOLS });
      },
    },

    // List agents
    {
      path: "/admin/api/jacarenda/agents",
      method: "GET",
      auth: "custom",
      handler: (req) => {
        if (!requireAdminSession(req)) return unauthorized();
        return json({ agents: listAgents() });
      },
    },

    // Create agent
    {
      path: "/admin/api/jacarenda/agents",
      method: "POST",
      auth: "custom",
      handler: async (req) => {
        if (!requireAdminSession(req)) return unauthorized();
        const body = await parseJson(req);
        if (!isPlainObject(body) || typeof body.templateId !== "string") {
          return json({ error: "templateId required" }, 400);
        }
        if (!getTemplate(body.templateId)) {
          return json({ error: "unknown templateId" }, 400);
        }
        try {
          const agent = createAgent(body as unknown as CreateAgentInput);
          return json({ agent }, 201);
        } catch (err) {
          return json({ error: String(err) }, 400);
        }
      },
    },

    // Get agent
    {
      path: /^\/admin\/api\/jacarenda\/agents\/([A-Za-z0-9-]+)$/,
      method: "GET",
      auth: "custom",
      handler: (req, params) => {
        if (!requireAdminSession(req)) return unauthorized();
        const agent = getAgent(params[0]);
        if (!agent) return json({ error: "not found" }, 404);
        return json({ agent });
      },
    },

    // Update agent
    {
      path: /^\/admin\/api\/jacarenda\/agents\/([A-Za-z0-9-]+)$/,
      method: "PATCH",
      auth: "custom",
      handler: async (req, params) => {
        if (!requireAdminSession(req)) return unauthorized();
        const body = await parseJson(req);
        if (!isPlainObject(body)) {
          return json({ error: "invalid body" }, 400);
        }
        const agent = updateAgent(
          params[0],
          body as unknown as UpdateAgentInput,
        );
        if (!agent) return json({ error: "not found" }, 404);
        return json({ agent });
      },
    },

    // Delete agent
    {
      path: /^\/admin\/api\/jacarenda\/agents\/([A-Za-z0-9-]+)$/,
      method: "DELETE",
      auth: "custom",
      handler: (req, params) => {
        if (!requireAdminSession(req)) return unauthorized();
        const ok = deleteAgent(params[0]);
        if (!ok) return json({ error: "not found" }, 404);
        return json({ ok: true });
      },
    },

    // Pending approvals (read-only in phase 1; runtime writes land in phase 2)
    {
      path: "/admin/api/jacarenda/approvals",
      method: "GET",
      auth: "custom",
      handler: (req) => {
        if (!requireAdminSession(req)) return unauthorized();
        return json({ approvals: listPendingApprovals() });
      },
    },

    // Runs — list for an agent
    {
      path: /^\/admin\/api\/jacarenda\/agents\/([A-Za-z0-9-]+)\/runs$/,
      method: "GET",
      auth: "custom",
      handler: (req, params) => {
        if (!requireAdminSession(req)) return unauthorized();
        return json({ runs: listRunsForAgent(params[0]) });
      },
    },

    // Runs — trigger a new one (Phase 2.1a: manual only, no tools)
    {
      path: /^\/admin\/api\/jacarenda\/agents\/([A-Za-z0-9-]+)\/runs$/,
      method: "POST",
      auth: "custom",
      handler: async (req, params) => {
        if (!requireAdminSession(req)) return unauthorized();
        const body = await parseJson(req);
        if (!isPlainObject(body) || typeof body.input !== "string") {
          return json({ error: "body.input (string) is required" }, 400);
        }
        try {
          const outcome = await runAgent({
            agentId: params[0],
            userInput: body.input,
            triggeredBy: "manual",
            triggeredByActor: "admin",
          });
          if (outcome.kind === "needs_approval") {
            return json(
              {
                kind: "needs_approval",
                run: outcome.run,
                approvalId: outcome.approvalId,
                question: outcome.question,
                proposedAction: outcome.proposedAction,
              },
              202,
            );
          }
          return json(
            {
              kind: "done",
              run: outcome.run,
              response: outcome.responseText,
            },
            200,
          );
        } catch (err) {
          if (err instanceof RuntimeError) {
            const status =
              err.code === "agent_not_found"
                ? 404
                : err.code === "input_too_long" ||
                    err.code === "agent_not_runnable"
                  ? 400
                  : 500;
            return json({ error: err.message, code: err.code }, status);
          }
          return json({ error: "internal error" }, 500);
        }
      },
    },

    // Run events (trace)
    {
      path: /^\/admin\/api\/jacarenda\/runs\/([A-Za-z0-9-]+)\/events$/,
      method: "GET",
      auth: "custom",
      handler: (req, params) => {
        if (!requireAdminSession(req)) return unauthorized();
        const run = getRun(params[0]);
        if (!run) return json({ error: "not found" }, 404);
        return json({ run, events: listEvents(params[0]) });
      },
    },

    // Decide on a pending approval — resumes the paused run synchronously.
    // 409 if already decided; 404 if not found; 400 on bad body.
    {
      path: /^\/admin\/api\/jacarenda\/approvals\/([A-Za-z0-9-]+)\/decide$/,
      method: "POST",
      auth: "custom",
      handler: async (req, params) => {
        if (!requireAdminSession(req)) return unauthorized();
        const body = await parseJson(req);
        if (
          !isPlainObject(body) ||
          (body.decision !== "approved" && body.decision !== "rejected")
        ) {
          return json(
            { error: "body.decision must be 'approved' or 'rejected'" },
            400,
          );
        }
        const approval = getApproval(params[0]);
        if (!approval) {
          return json({ error: "approval not found" }, 404);
        }
        const decidedBy =
          (typeof body.decidedBy === "string" && body.decidedBy.slice(0, 80)) ||
          "admin";

        try {
          decideApproval({
            id: approval.id,
            decision: body.decision as "approved" | "rejected",
            decidedBy,
          });
        } catch (err) {
          if (err instanceof ApprovalAlreadyDecidedError) {
            return json({ error: err.message, code: "already_decided" }, 409);
          }
          throw err;
        }

        try {
          const outcome = await resumeAgent(
            approval.runId,
            body.decision as "approved" | "rejected",
            decidedBy,
          );
          if (outcome.kind === "needs_approval") {
            return json(
              {
                kind: "needs_approval",
                run: outcome.run,
                approvalId: outcome.approvalId,
                question: outcome.question,
                proposedAction: outcome.proposedAction,
              },
              202,
            );
          }
          return json(
            {
              kind: "done",
              run: outcome.run,
              response: outcome.responseText,
            },
            200,
          );
        } catch (err) {
          if (err instanceof RuntimeError) {
            return json({ error: err.message, code: err.code }, 500);
          }
          return json({ error: "internal error" }, 500);
        }
      },
    },
  ];
}
