import { useState } from "react";
import { ArrowRight, Slack } from "lucide-react";
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

export function SlackCard({ state, onChanged, onUnauthorized }: Props) {
  const { toast } = useToast();
  const [botToken, setBotToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const [activating, setActivating] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const activate = async () => {
    if (!botToken.trim() || !appToken.trim()) {
      toast({ title: "Both tokens are required.", variant: "destructive" });
      return;
    }
    setActivating(true);
    const { status, data } = await api<{ success?: boolean; error?: string }>(
      "POST",
      "/admin/api/integrations/slack",
      { botToken: botToken.trim(), appToken: appToken.trim() },
    );
    setActivating(false);
    if (status === 401) return onUnauthorized();
    if (status === 200 && data?.success) {
      toast({ title: "Slack connected." });
      setBotToken("");
      setAppToken("");
      onChanged();
    } else {
      toast({
        title: data?.error ?? "Activation failed.",
        variant: "destructive",
      });
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect Slack? Credentials will be cleared."))
      return;
    setDisconnecting(true);
    const { status, data } = await api<{ error?: string }>(
      "DELETE",
      "/admin/api/integrations/slack",
    );
    setDisconnecting(false);
    if (status === 401) return onUnauthorized();
    if (status === 200) {
      toast({ title: "Slack disconnected." });
      onChanged();
    } else {
      toast({
        title: data?.error ?? "Disconnect failed.",
        variant: "destructive",
      });
    }
  };

  const rows: Array<[string, string]> = [];
  if (state?.teamName) rows.push(["Workspace", state.teamName]);
  if (state?.botUsername) rows.push(["Bot user", "@" + state.botUsername]);

  return (
    <ChannelCard
      icon={<Slack />}
      title="Slack"
      description="Socket Mode — no public webhook needed."
      state={state}
      meta={rows.length > 0 ? <MetaInfo rows={rows} /> : null}
      instructions={
        <ol>
          <li>
            Go to{" "}
            <a
              href="https://api.slack.com/apps"
              target="_blank"
              rel="noopener noreferrer"
            >
              api.slack.com/apps
            </a>{" "}
            → <strong>Create New App</strong> → from scratch.
          </li>
          <li>
            <strong>OAuth &amp; Permissions</strong> → Bot Token Scopes → add:{" "}
            <code>app_mentions:read</code>, <code>chat:write</code>,{" "}
            <code>im:history</code>, <code>im:read</code>, <code>im:write</code>
            , <code>users:read</code>.
          </li>
          <li>
            <strong>Socket Mode</strong> → toggle on → generate App-Level Token
            with <code>connections:write</code>. Copy the <code>xapp-…</code>{" "}
            token.
          </li>
          <li>
            <strong>Event Subscriptions</strong> → enable → bot events:{" "}
            <code>app_mention</code>, <code>message.im</code> → save.
          </li>
          <li>
            <strong>Install App</strong> → install to your workspace → copy the{" "}
            <code>xoxb-…</code> Bot User OAuth Token.
          </li>
          <li>
            Paste both tokens above and click <strong>Activate</strong>.
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
        id="slack-bot-token"
        label="Bot Token"
        value={botToken}
        onChange={setBotToken}
        placeholder="xoxb-…"
        hint={
          <>
            From <strong className="text-black">Install App</strong> → Bot User
            OAuth Token.
          </>
        }
      />
      <FormRow
        id="slack-app-token"
        label="App-Level Token"
        value={appToken}
        onChange={setAppToken}
        placeholder="xapp-…"
        hint={
          <>
            Scope{" "}
            <code className="font-mono text-[12px] bg-gray-100 px-1.5 py-0.5 rounded">
              connections:write
            </code>
            . From <strong className="text-black">Basic Information</strong> →
            App-Level Tokens.
          </>
        }
      />
    </ChannelCard>
  );
}
