import { useEffect, useState } from "react";
import { LoginView } from "@/components/login/LoginView";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { AgentsView } from "@/components/agents/AgentsView";
import { AgentDetailView } from "@/components/agents/AgentDetailView";
import { AgentWizardView } from "@/components/agents/AgentWizardView";
import { ApprovalsView } from "@/components/approvals/ApprovalsView";
import { Toaster } from "@/components/ui/toaster";
import { api } from "@/lib/api";

type AuthState = "checking" | "authed" | "unauthed";
type View =
  | { kind: "channels" }
  | { kind: "agents" }
  | { kind: "agent-detail"; id: string }
  | { kind: "agent-wizard" }
  | { kind: "approvals" };

export default function App() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [view, setView] = useState<View>({ kind: "channels" });

  // Probe: if the session cookie is valid, the gateway returns 200 for the
  // slack integration GET; any other status means we need to show the login
  // flow (this matches the legacy bootstrap behaviour 1:1).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status } = await api("GET", "/admin/api/integrations/slack");
      if (cancelled) return;
      setAuth(status === 200 ? "authed" : "unauthed");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignOut = async () => {
    await api("POST", "/admin/api/logout");
    setAuth("unauthed");
    setView({ kind: "channels" });
  };

  return (
    <>
      {auth === "checking" && (
        <div className="min-h-screen bg-white" aria-hidden="true" />
      )}
      {auth === "unauthed" && (
        <LoginView onAuthenticated={() => setAuth("authed")} />
      )}
      {auth === "authed" && view.kind === "channels" && (
        <Dashboard
          onSignOut={handleSignOut}
          onUnauthorized={() => setAuth("unauthed")}
          onNavigateAgents={() => setView({ kind: "agents" })}
          onNavigateApprovals={() => setView({ kind: "approvals" })}
        />
      )}
      {auth === "authed" && view.kind === "agents" && (
        <AgentsView
          onSignOut={handleSignOut}
          onUnauthorized={() => setAuth("unauthed")}
          onNavigateChannels={() => setView({ kind: "channels" })}
          onNavigateApprovals={() => setView({ kind: "approvals" })}
          onSelectAgent={(id) => setView({ kind: "agent-detail", id })}
          onNewAgent={() => setView({ kind: "agent-wizard" })}
        />
      )}
      {auth === "authed" && view.kind === "agent-detail" && (
        <AgentDetailView
          agentId={view.id}
          onSignOut={handleSignOut}
          onUnauthorized={() => setAuth("unauthed")}
          onBack={() => setView({ kind: "agents" })}
          onNavigateChannels={() => setView({ kind: "channels" })}
          onNavigateApprovals={() => setView({ kind: "approvals" })}
        />
      )}
      {auth === "authed" && view.kind === "agent-wizard" && (
        <AgentWizardView
          onSignOut={handleSignOut}
          onUnauthorized={() => setAuth("unauthed")}
          onCancel={() => setView({ kind: "agents" })}
          onCreated={(agent) => setView({ kind: "agent-detail", id: agent.id })}
          onNavigateChannels={() => setView({ kind: "channels" })}
        />
      )}
      {auth === "authed" && view.kind === "approvals" && (
        <ApprovalsView
          onSignOut={handleSignOut}
          onUnauthorized={() => setAuth("unauthed")}
          onNavigateChannels={() => setView({ kind: "channels" })}
          onNavigateAgents={() => setView({ kind: "agents" })}
        />
      )}
      <Toaster />
    </>
  );
}
