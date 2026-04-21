import { useState } from "react";
import { ArrowRight, Send } from "lucide-react";
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

export function TelegramCard({ state, onChanged, onUnauthorized }: Props) {
  const { toast } = useToast();
  const [botToken, setBotToken] = useState("");
  const [activating, setActivating] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const activate = async () => {
    if (!botToken.trim()) {
      toast({ title: "Bot token is required.", variant: "destructive" });
      return;
    }
    setActivating(true);
    const { status, data } = await api<{ success?: boolean; error?: string }>(
      "POST",
      "/admin/api/integrations/telegram",
      { botToken: botToken.trim() },
    );
    setActivating(false);
    if (status === 401) return onUnauthorized();
    if (status === 200 && data?.success) {
      toast({ title: "Telegram connected. Webhook registered." });
      setBotToken("");
      onChanged();
    } else {
      toast({
        title: data?.error ?? "Activation failed.",
        variant: "destructive",
      });
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect Telegram? Credentials will be cleared."))
      return;
    setDisconnecting(true);
    const { status } = await api("DELETE", "/admin/api/integrations/telegram");
    setDisconnecting(false);
    if (status === 401) return onUnauthorized();
    if (status === 200) {
      toast({ title: "Telegram disconnected." });
      onChanged();
    }
  };

  const rows: Array<[string, string]> = [];
  if (state?.botUsername) rows.push(["Bot user", "@" + state.botUsername]);
  if (state?.webhookUrl) rows.push(["Webhook", state.webhookUrl]);

  return (
    <ChannelCard
      icon={<Send />}
      title="Telegram"
      description="Webhook. Auto-registered on activation."
      state={state}
      meta={rows.length > 0 ? <MetaInfo rows={rows} /> : null}
      instructions={
        <ol>
          <li>
            Open Telegram → search <strong>@BotFather</strong> → start chat.
          </li>
          <li>
            Send <code>/newbot</code>.
          </li>
          <li>
            Reply with a display name (e.g. <em>Jacarenda Assistant</em>).
          </li>
          <li>
            Reply with a username — must end in <code>bot</code> (e.g.{" "}
            <code>jacarenda_assistant_bot</code>).
          </li>
          <li>
            BotFather replies with the HTTP API token:{" "}
            <code>1234567890:AAH…</code>. Copy the whole string.
          </li>
          <li>
            Paste above and click <strong>Activate</strong>.
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
        id="telegram-bot-token"
        label="Bot Token"
        value={botToken}
        onChange={setBotToken}
        placeholder="1234567890:ABC…"
        hint="The full token string from BotFather, including the colon."
      />
    </ChannelCard>
  );
}
