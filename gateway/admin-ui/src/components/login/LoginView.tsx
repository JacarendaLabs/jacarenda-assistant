import { useState } from "react";
import { BrandLock } from "@/components/layout/BrandLock";
import { PasswordStep } from "./PasswordStep";
import { TotpStep } from "./TotpStep";
import { SetupStep } from "./SetupStep";

export type LoginStep = "password" | "totp" | "setup";

export interface SetupPayload {
  setupToken: string;
  secretBase32: string;
  otpauthUri: string;
  qrSvg: string;
}

interface LoginViewProps {
  onAuthenticated: () => void;
}

/**
 * Three-step login card:
 *   1. password (+ Remember-me)
 *   2a. TOTP verification (returning user)
 *   2b. TOTP first-time enrolment (QR + base32 secret)
 *
 * The password and rememberMe values are held here so they can be threaded
 * through to the TOTP step (which re-POSTs the full credential set) and the
 * setup confirmation step.
 */
export function LoginView({ onAuthenticated }: LoginViewProps) {
  const [step, setStep] = useState<LoginStep>("password");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [setupPayload, setSetupPayload] = useState<SetupPayload | null>(null);

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-white px-4 py-12 relative overflow-hidden"
      style={{
        backgroundImage:
          "radial-gradient(70% 45% at 50% 10%, rgba(200,210,220,0.16), transparent 70%), radial-gradient(55% 45% at 80% 95%, rgba(220,230,220,0.18), transparent 70%)",
      }}
    >
      <div className="w-full max-w-md bg-white border border-gray-100 rounded-2xl shadow-sm p-10 animate-fade-in">
        <div className="mb-10">
          <BrandLock size="md" />
        </div>

        {step === "password" && (
          <PasswordStep
            password={password}
            setPassword={setPassword}
            rememberMe={rememberMe}
            setRememberMe={setRememberMe}
            onNeedsTotp={() => setStep("totp")}
            onNeedsSetup={(payload) => {
              setSetupPayload(payload);
              setStep("setup");
            }}
            onAuthenticated={onAuthenticated}
          />
        )}

        {step === "totp" && (
          <TotpStep
            password={password}
            rememberMe={rememberMe}
            onBack={() => setStep("password")}
            onAuthenticated={onAuthenticated}
          />
        )}

        {step === "setup" && setupPayload && (
          <SetupStep
            payload={setupPayload}
            rememberMe={rememberMe}
            onAuthenticated={onAuthenticated}
          />
        )}
      </div>

      <p className="absolute bottom-6 left-0 right-0 text-center text-xs text-gray-400 tracking-wide">
        Session times out after 1 hour. Enable "Remember me" for 30 days.
      </p>
    </div>
  );
}
