import { Bot } from "lucide-react";
import type { Agent } from "./types";

interface AgentCardProps {
  agent: Agent;
  onClick?: (id: string) => void;
}

const TRUST_LABEL: Record<Agent["trustMode"], string> = {
  draft: "Draft only",
  ask: "Ask first",
  autopilot: "Autopilot",
};

const STATUS_LABEL: Record<Agent["status"], string> = {
  active: "Active",
  paused: "Paused",
  archived: "Archived",
};

export function AgentCard({ agent, onClick }: AgentCardProps) {
  const toolCount = agent.toolAllowlist.length;
  const interactive = Boolean(onClick);
  return (
    <button
      type="button"
      onClick={interactive ? () => onClick!(agent.id) : undefined}
      disabled={!interactive}
      className={`group text-left w-full p-8 rounded-2xl border border-gray-100 transition-all duration-300 bg-white shadow-sm ${
        interactive
          ? "hover:border-gray-300 hover-lift cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
          : "cursor-default"
      }`}
    >
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 rounded-xl bg-black flex items-center justify-center flex-shrink-0 transition-transform duration-300 group-hover:scale-110">
          <Bot className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-lg font-semibold text-black truncate">
              {agent.name}
            </h3>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed line-clamp-2">
            {agent.description}
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Pill tone={agent.status === "active" ? "dark" : "light"}>
          {STATUS_LABEL[agent.status]}
        </Pill>
        <Pill tone="light">{TRUST_LABEL[agent.trustMode]}</Pill>
        <Pill tone="light">
          {toolCount} tool{toolCount === 1 ? "" : "s"}
        </Pill>
      </div>
    </button>
  );
}

function Pill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "dark" | "light";
}) {
  const base =
    "inline-flex items-center rounded-full px-3 py-1 text-[11.5px] font-medium uppercase tracking-[0.08em]";
  const skin =
    tone === "dark"
      ? "bg-black text-white"
      : "bg-gray-100 text-gray-700 border border-gray-200";
  return <span className={`${base} ${skin}`}>{children}</span>;
}
