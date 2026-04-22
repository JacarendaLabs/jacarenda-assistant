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
  ];
}
