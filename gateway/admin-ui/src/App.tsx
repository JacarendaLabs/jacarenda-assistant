import { useEffect, useState } from "react";
import { LoginView } from "@/components/login/LoginView";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { Toaster } from "@/components/ui/toaster";
import { api } from "@/lib/api";

type AuthState = "checking" | "authed" | "unauthed";

export default function App() {
  const [auth, setAuth] = useState<AuthState>("checking");

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
  };

  return (
    <>
      {auth === "checking" && (
        <div className="min-h-screen bg-white" aria-hidden="true" />
      )}
      {auth === "unauthed" && (
        <LoginView onAuthenticated={() => setAuth("authed")} />
      )}
      {auth === "authed" && (
        <Dashboard
          onSignOut={handleSignOut}
          onUnauthorized={() => setAuth("unauthed")}
        />
      )}
      <Toaster />
    </>
  );
}
