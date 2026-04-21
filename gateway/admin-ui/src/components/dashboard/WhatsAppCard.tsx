import { useState } from "react";
import { ArrowRight, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChannelCard, MetaInfo } from "./ChannelCard";
import { FormRow } from "./FormRow";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/use-toast";
import type { ChannelState } from "./ChannelsSection";

interface Props {
  state: ChannelState | null;
  onChanged: () => void;
  onUnauthorized: () => void;
}

export function WhatsAppCard({ state, onChanged, onUnauthorized }: Props) {
  const { toast } = useToast();
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [activating, setActivating] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const activate = async () => {
    if (
      !phoneNumberId.trim() ||
      !accessToken.trim() ||
      !verifyToken.trim() ||
      !appSecret.trim()
    ) {
      toast({ title: "All four fields are required.", variant: "destructive" });
      return;
    }
    setActivating(true);
    const { status, data } = await api<{ success?: boolean; error?: string }>(
      "POST",
      "/admin/api/integrations/whatsapp",
      {
        phoneNumberId: phoneNumberId.trim(),
        accessToken: accessToken.trim(),
        webhookVerifyToken: verifyToken.trim(),
        appSecret: appSecret.trim(),
      },
    );
    setActivating(false);
    if (status === 401) return onUnauthorized();
    if (status === 200 && data?.success) {
      toast({ title: "WhatsApp credentials stored." });
      setPhoneNumberId("");
      setAccessToken("");
      setVerifyToken("");
      setAppSecret("");
      onChanged();
    } else {
      toast({
        title: data?.error ?? "Activation failed.",
        variant: "destructive",
      });
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect WhatsApp? Credentials will be cleared."))
      return;
    setDisconnecting(true);
    const { status } = await api("DELETE", "/admin/api/integrations/whatsapp");
    setDisconnecting(false);
    if (status === 401) return onUnauthorized();
    if (status === 200) {
      toast({ title: "WhatsApp disconnected." });
      onChanged();
    }
  };

  const rows: Array<[string, string]> = [];
  if (state?.phoneNumberId) rows.push(["Phone number ID", state.phoneNumberId]);
  if (state?.webhookUrl) rows.push(["Webhook", state.webhookUrl]);

  return (
    <ChannelCard
      icon={<MessageCircle />}
      title="WhatsApp"
      description="Cloud API via Meta. Requires business verification."
      state={state}
      meta={rows.length > 0 ? <MetaInfo rows={rows} /> : null}
      instructions={
        <ol>
          <li>
            In{" "}
            <a
              href="https://developers.facebook.com/apps"
              target="_blank"
              rel="noopener noreferrer"
            >
              Meta for Developers
            </a>
            , create a Business app → add the <strong>WhatsApp</strong> product.
          </li>
          <li>
            <strong>API Setup</strong> → add a test phone number (or a verified
            one) → note the <strong>Phone Number ID</strong>.
          </li>
          <li>
            <strong>System Users</strong> → create a system user with{" "}
            <code>whatsapp_business_messaging</code> permission → generate a
            permanent access token.
          </li>
          <li>
            <strong>Settings → Basic</strong> → copy the{" "}
            <strong>App Secret</strong>.
          </li>
          <li>
            Invent a strong <strong>Webhook Verify Token</strong>. Keep it
            handy.
          </li>
          <li>
            Paste all four values above and click <strong>Activate</strong>.
            We'll show you the webhook URL to paste into Meta's{" "}
            <em>Configuration → Webhooks → Edit</em> screen.
          </li>
          <li>
            In Meta, subscribe the webhook to the <code>messages</code> event.
          </li>
        </ol>
      }
      actions={
        <>
          <Button
            onClick={activate}
            disabled={activating}
            className="h-11 px-5 bg-black hover:bg-gray-800 text-white"
          >
            {activating
              ? "Connecting…"
              : state?.connected
                ? "Update credentials"
                : "Activate"}
            {!activating && <ArrowRight className="w-4 h-4" />}
          </Button>
          {state?.connected && (
            <Button
              onClick={disconnect}
              disabled={disconnecting}
              variant="outline"
              className="h-11 px-5 border-gray-300 text-black hover:border-red-500 hover:text-red-600 hover:bg-red-50"
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
          )}
        </>
      }
    >
      <FormRow
        id="wa-phone-id"
        label="Phone Number ID"
        value={phoneNumberId}
        onChange={setPhoneNumberId}
        placeholder="123456789012345"
        hint="Numeric ID of the sending phone number, from the WhatsApp app's API Setup screen."
      />
      <FormRow
        id="wa-access-token"
        label="Access Token"
        value={accessToken}
        onChange={setAccessToken}
        placeholder="EAAG…"
        hint={
          <>
            Permanent system-user token with{" "}
            <code className="font-mono text-[12px] bg-gray-100 px-1.5 py-0.5 rounded">
              whatsapp_business_messaging
            </code>{" "}
            permission.
          </>
        }
      />
      <FormRow
        id="wa-verify-token"
        label="Webhook Verify Token"
        value={verifyToken}
        onChange={setVerifyToken}
        placeholder="a strong string you invent"
        hint="Any strong random string you choose; you'll paste the same string into Meta's webhook config."
      />
      <FormRow
        id="wa-app-secret"
        label="App Secret"
        value={appSecret}
        onChange={setAppSecret}
        placeholder="32+ hex chars"
        hint={
          <>
            From your Meta App →{" "}
            <em className="italic">Settings → Basic → App Secret → Show</em>.
            Used to sign webhook payloads.
          </>
        }
      />
    </ChannelCard>
  );
}
