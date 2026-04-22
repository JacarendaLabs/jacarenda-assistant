import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Calendar,
  CircleCheck,
  CircleDot,
  CircleDashed,
  Cog,
  Coins,
  Play,
  Shield,
  Sparkles,
} from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useStageAnimations } from "@/hooks/useStageAnimations";
import { TestDriveSection } from "@/components/agents/TestDriveSection";
import type { Agent } from "@/components/agents/types";

interface ToolSpec {
  id: string;
  label: string;
  description: string;
  plainEnglish: string;
  category: "data" | "messaging" | "llm" | "automation";
  riskTier: 1 | 2 | 3;
}

interface AgentDetailViewProps {
  agentId: string;
  onSignOut: () => void;
  onUnauthorized: () => void;
  onBack: () => void;
  onNavigateChannels: () => void;
  onNavigateApprovals: () => void;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; agent: Agent; tools: ToolSpec[] }
  | { kind: "error"; message: string };

const TRUST_COPY: Record<
  Agent["trustMode"],
  { label: string; sub: string; icon: typeof CircleDot }
> = {
  draft: {
    label: "Draft only",
    sub: "Writes drafts, never sends. Every run surfaces in your approval queue.",
    icon: CircleDashed,
  },
  ask: {
    label: "Ask first",
    sub: "Takes action when you confirm in Slack/WhatsApp. You stay in the loop.",
    icon: CircleDot,
  },
  autopilot: {
    label: "Autopilot",
    sub: "Runs independently. You see a report after each run.",
    icon: CircleCheck,
  },
};

const STATUS_COPY: Record<Agent["status"], string> = {
  active: "Active",
  paused: "Paused",
  archived: "Archived",
};

export function AgentDetailView({
  agentId,
  onSignOut,
  onUnauthorized,
  onBack,
  onNavigateChannels,
  onNavigateApprovals,
}: AgentDetailViewProps) {
  useStageAnimations();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const handleTestDrive = () => {
    const el = document.getElementById("test-drive-section");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      const ta = el.querySelector<HTMLTextAreaElement>("#testdrive-input");
      if (ta) setTimeout(() => ta.focus(), 400);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [agentRes, toolsRes] = await Promise.all([
        api<{ agent: Agent }>("GET", `/admin/api/jacarenda/agents/${agentId}`),
        api<{ tools: ToolSpec[] }>("GET", "/admin/api/jacarenda/tools"),
      ]);
      if (cancelled) return;
      if (agentRes.status === 401 || toolsRes.status === 401) {
        onUnauthorized();
        return;
      }
      if (agentRes.status !== 200 || !agentRes.data?.agent) {
        setState({
          kind: "error",
          message:
            agentRes.status === 404
              ? "That agent doesn't exist or has been deleted."
              : `Couldn't load the agent (HTTP ${agentRes.status}).`,
        });
        return;
      }
      setState({
        kind: "ready",
        agent: agentRes.data.agent,
        tools: toolsRes.data?.tools ?? [],
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, onUnauthorized]);

  return (
    <div className="min-h-screen bg-white">
      <TopBar
        onSignOut={onSignOut}
        activeTab="agents"
        onNavigateChannels={onNavigateChannels}
        onNavigateAgents={onBack}
        onNavigateApprovals={onNavigateApprovals}
      />

      <main>
        <section className="pt-28 pb-6 bg-white">
          <div className="container mx-auto px-6 max-w-4xl">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-black transition-colors mb-6"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>All agents</span>
            </button>

            {state.kind === "loading" && (
              <div className="py-16 text-center text-gray-500 text-sm">
                Loading agent…
              </div>
            )}

            {state.kind === "error" && (
              <div className="py-16 text-center">
                <p className="text-gray-900 font-medium">{state.message}</p>
              </div>
            )}

            {state.kind === "ready" && (
              <>
                <DetailBody
                  agent={state.agent}
                  tools={state.tools}
                  onTestDrive={handleTestDrive}
                />
                <div id="test-drive-section" className="mt-10">
                  <TestDriveSection
                    agent={state.agent}
                    onUnauthorized={onUnauthorized}
                    onNavigateApprovals={onNavigateApprovals}
                  />
                </div>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function DetailBody({
  agent,
  tools,
  onTestDrive,
}: {
  agent: Agent;
  tools: ToolSpec[];
  onTestDrive: () => void;
}) {
  const grantedTools = useMemo(
    () =>
      agent.toolAllowlist
        .map((id) => tools.find((t) => t.id === id))
        .filter((t): t is ToolSpec => Boolean(t)),
    [agent.toolAllowlist, tools],
  );

  const rules = useMemo(
    () =>
      agent.rules
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean),
    [agent.rules],
  );

  const trust = TRUST_COPY[agent.trustMode];

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="flex items-start gap-5">
        <div className="w-16 h-16 rounded-xl bg-black flex items-center justify-center flex-shrink-0">
          <Bot className="w-7 h-7 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="inline-flex items-center gap-2 bg-black/5 border border-gray-200 rounded-full px-3 py-1 mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-black" />
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-black">
              {STATUS_COPY[agent.status]}
            </span>
          </div>
          <h1 className="font-inter text-3xl md:text-4xl font-bold text-black tracking-tight leading-[1.1]">
            {agent.name}
          </h1>
          <p className="text-gray-600 mt-3 leading-relaxed">
            {agent.description}
          </p>
        </div>
        <Button
          variant="outline"
          className="h-11 px-5 border-gray-300 text-black hover:bg-black hover:text-white hover:border-black flex-shrink-0"
          onClick={onTestDrive}
        >
          <Play className="w-4 h-4" />
          <span>Test drive</span>
        </Button>
      </div>

      {/* Trust mode banner */}
      <div className="p-6 rounded-2xl border border-gray-100 bg-gray-50 shadow-sm">
        <div className="flex items-start gap-4">
          <trust.icon className="w-5 h-5 text-black mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-gray-500 mb-1">
              Trust mode
            </p>
            <p className="font-semibold text-black">{trust.label}</p>
            <p className="text-sm text-gray-600 mt-1 leading-relaxed">
              {trust.sub}
            </p>
          </div>
        </div>
      </div>

      {/* Personality */}
      <Section icon={Sparkles} label="Personality">
        <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
          {agent.personality || (
            <span className="text-gray-400 italic">
              No personality set. Edit to define how this agent sounds.
            </span>
          )}
        </p>
      </Section>

      {/* Rules */}
      <Section icon={Shield} label="Rules">
        {rules.length > 0 ? (
          <ul className="space-y-2">
            {rules.map((rule, idx) => (
              <li key={idx} className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-black mt-2 flex-shrink-0" />
                <span className="text-gray-700 leading-relaxed">{rule}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-400 italic">
            No rules set. Edit to add guardrails.
          </p>
        )}
      </Section>

      {/* What it can do */}
      <Section icon={Cog} label="What it can do">
        {grantedTools.length > 0 ? (
          <div className="space-y-3">
            {grantedTools.map((tool) => (
              <ToolRow key={tool.id} tool={tool} />
            ))}
          </div>
        ) : (
          <p className="text-gray-400 italic">
            No tools granted. This agent cannot do anything until you give it at
            least one tool.
          </p>
        )}
      </Section>

      {/* Trigger + spend cap — small-print row */}
      <div className="grid gap-4 md:grid-cols-2">
        <MetaCard
          icon={Calendar}
          label="When it runs"
          value={summariseTrigger(agent.triggerConfig)}
        />
        <MetaCard
          icon={Coins}
          label="Spend cap per run"
          value={formatCents(agent.spendCapCents)}
        />
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Sparkles;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="p-8 rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-white" />
        </div>
        <h2 className="text-xl font-semibold text-black tracking-tight">
          {label}
        </h2>
      </div>
      {children}
    </section>
  );
}

function ToolRow({ tool }: { tool: ToolSpec }) {
  const tone =
    tool.riskTier === 3
      ? "High trust"
      : tool.riskTier === 2
        ? "Medium trust"
        : "Low trust";
  return (
    <div className="flex items-start gap-4 p-4 rounded-xl border border-gray-100 bg-gray-50/50">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-black">{tool.label}</p>
          <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.08em] bg-gray-100 text-gray-700 border border-gray-200">
            {tone}
          </span>
        </div>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed">
          {tool.plainEnglish}
        </p>
      </div>
    </div>
  );
}

function MetaCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Calendar;
  label: string;
  value: string;
}) {
  return (
    <div className="p-5 rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex items-start gap-3">
        <Icon className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-gray-500 mb-1">
            {label}
          </p>
          <p className="text-gray-900 font-medium">{value}</p>
        </div>
      </div>
    </div>
  );
}

function summariseTrigger(cfg: Record<string, unknown>): string {
  const schedule = cfg.schedule;
  if (schedule === "weekly" && typeof cfg.dayOfWeek === "string") {
    const hour =
      typeof cfg.hourOfDayLocal === "number"
        ? String(cfg.hourOfDayLocal).padStart(2, "0") + ":00"
        : "";
    const tz =
      typeof cfg.timezone === "string" ? ` ${String(cfg.timezone)}` : "";
    return `Every ${cfg.dayOfWeek}${hour ? ` · ${hour}` : ""}${tz}`;
  }
  if (schedule === "daily") return "Every day";
  if (schedule === "manual") return "Manual only";
  if (typeof schedule === "string") return schedule;
  return "Manual only";
}

function formatCents(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}
