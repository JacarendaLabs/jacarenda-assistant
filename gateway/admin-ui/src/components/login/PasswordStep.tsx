import { useState } from "react";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/api";
import type { SetupPayload } from "./LoginView";

interface LoginResponse {
  success?: boolean;
  needsTotp?: boolean;
  setup?: SetupPayload;
  retryAfterSeconds?: number;
}

interface Props {
  password: string;
  setPassword: (p: string) => void;
  rememberMe: boolean;
  setRememberMe: (v: boolean) => void;
  onNeedsTotp: () => void;
  onNeedsSetup: (payload: SetupPayload) => void;
  onAuthenticated: () => void;
}

export function PasswordStep({
  password,
  setPassword,
  rememberMe,
  setRememberMe,
  onNeedsTotp,
  onNeedsSetup,
  onAuthenticated,
}: Props) {
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const { status, data } = await api<LoginResponse>(
      "POST",
      "/admin/api/login",
      { password, rememberMe },
    );
    setSubmitting(false);

    if (status === 429) {
      setError(
        `Too many attempts. Try again in ${data?.retryAfterSeconds ?? "a few"}s.`,
      );
      return;
    }
    if (status === 401) {
      setError("Wrong password.");
      return;
    }
    if (status !== 200 || !data) {
      setError("Login failed. Try again.");
      return;
    }
    if (data.setup) {
      onNeedsSetup(data.setup);
      return;
    }
    if (data.success) {
      onAuthenticated();
      return;
    }
    if (data.needsTotp) {
      onNeedsTotp();
      return;
    }
    onNeedsTotp();
  };

  return (
    <form onSubmit={submit} noValidate>
      <h1 className="font-inter text-3xl font-semibold text-black tracking-tight">
        Sign in.
      </h1>

      <label
        htmlFor="login-password"
        className="block mt-8 mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-gray-500"
      >
        Password
      </label>
      <div className="relative">
        <Input
          id="login-password"
          type={showPassword ? "text" : "password"}
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-12 pr-12 text-base"
        />
        <button
          type="button"
          aria-label={`${showPassword ? "Hide" : "Show"} password`}
          aria-pressed={showPassword}
          onClick={() => setShowPassword((s) => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md text-gray-400 hover:text-black hover:bg-gray-50 transition-colors"
        >
          {showPassword ? (
            <EyeOff className="w-4 h-4" />
          ) : (
            <Eye className="w-4 h-4" />
          )}
        </button>
      </div>

      <label className="flex items-center gap-2.5 mt-5 cursor-pointer select-none">
        <Checkbox
          checked={rememberMe}
          onCheckedChange={(v) => setRememberMe(v === true)}
        />
        <span className="text-sm text-gray-700">
          Remember me on this device
        </span>
      </label>

      <Button
        type="submit"
        disabled={submitting || !password}
        className="h-12 px-6 mt-7 bg-black hover:bg-gray-800 text-white"
      >
        {submitting ? "Signing in…" : "Continue"}
        {!submitting && <ArrowRight className="w-4 h-4" />}
      </Button>

      {error && (
        <p className="text-red-500 text-sm mt-4 animate-fade-in">{error}</p>
      )}
    </form>
  );
}
