import { useEffect, useState } from "react";
import { Bot, Plus, Sparkles } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { AgentCard } from "@/components/agents/AgentCard";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useStageAnimations } from "@/hooks/useStageAnimations";
import type { Agent } from "@/components/agents/types";

interface AgentsViewProps {
  onSignOut: () => void;
  onUnauthorized: () => void;
  onNavigateChannels: () => void;
}

type ListState =
  | { kind: "loading" }
  | { kind: "ready"; agents: Agent[] }
  | { kind: "error"; message: string };

export function AgentsView({
  onSignOut,
  onUnauthorized,
  onNavigateChannels,
}: AgentsViewProps) {
  useStageAnimations();
  const [state, setState] = useState<ListState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status, data } = await api<{ agents: Agent[] }>(
        "GET",
        "/admin/api/jacarenda/agents",
      );
      if (cancelled) return;
      if (status === 401) {
        onUnauthorized();
        return;
      }
      if (status !== 200 || !data) {
        setState({
          kind: "error",
          message: `Couldn't load agents (HTTP ${status}).`,
        });
        return;
      }
      setState({ kind: "ready", agents: data.agents });
    })();
    return () => {
      cancelled = true;
    };
  }, [onUnauthorized]);

  return (
    <div className="min-h-screen bg-white">
      <TopBar
        onSignOut={onSignOut}
        activeTab="agents"
        onNavigateChannels={onNavigateChannels}
        onNavigateAgents={() => {
          /* no-op — already here */
        }}
      />

      <main>
        <section className="pt-32 pb-10 bg-white">
          <div className="container mx-auto px-6 max-w-5xl">
            <div className="inline-flex items-center gap-2 bg-black/5 border border-gray-200 rounded-full px-3 py-1.5 mb-6 animate-fade-in">
              <span className="w-1.5 h-1.5 rounded-full bg-black" />
              <span className="text-[11.5px] font-medium uppercase tracking-[0.1em] text-black">
                Agents
              </span>
            </div>
            <h1 className="font-inter text-4xl md:text-5xl font-bold text-black tracking-tight leading-[1.05]">
              Your AI team.
            </h1>
            <p className="text-lg md:text-xl text-gray-600 mt-4 max-w-2xl leading-relaxed">
              One agent per function — marketing, sales, support, ops, books.
              Each starts in Draft mode. You graduate them to Autopilot when
              you're ready.
            </p>
          </div>
        </section>

        <section className="pb-24 pt-2 bg-white">
          <div className="container mx-auto px-6 max-w-5xl">
            {state.kind === "loading" && (
              <div className="py-16 text-center text-gray-500 text-sm">
                Loading agents…
              </div>
            )}

            {state.kind === "error" && (
              <div className="py-16 text-center">
                <p className="text-gray-900 font-medium">{state.message}</p>
                <p className="text-gray-500 text-sm mt-2">
                  Try refreshing. If it keeps failing, check the gateway logs.
                </p>
              </div>
            )}

            {state.kind === "ready" && state.agents.length === 0 && (
              <EmptyState />
            )}

            {state.kind === "ready" && state.agents.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-6">
                  <p className="text-sm text-gray-500">
                    {state.agents.length} agent
                    {state.agents.length === 1 ? "" : "s"}
                  </p>
                  <Button
                    className="bg-black hover:bg-gray-800 text-white h-10 px-4"
                    disabled
                    title="Wizard lands in Phase 1.3"
                  >
                    <Plus className="w-4 h-4" />
                    <span>New agent</span>
                  </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {state.agents.map((agent) => (
                    <AgentCard key={agent.id} agent={agent} />
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="py-16 flex flex-col items-center text-center">
      <div className="w-14 h-14 rounded-xl bg-black flex items-center justify-center mb-6">
        <Sparkles className="w-6 h-6 text-white" />
      </div>
      <h2 className="text-2xl font-semibold text-black mb-2">No agents yet.</h2>
      <p className="text-gray-600 max-w-md mb-8">
        Pick a template to get started. Every agent begins in Draft mode —
        nothing happens without your say-so.
      </p>
      <Button
        className="bg-black hover:bg-gray-800 text-white h-12 px-6"
        disabled
        title="Wizard lands in Phase 1.3"
      >
        <Bot className="w-4 h-4" />
        <span>Browse templates</span>
      </Button>
    </div>
  );
}
