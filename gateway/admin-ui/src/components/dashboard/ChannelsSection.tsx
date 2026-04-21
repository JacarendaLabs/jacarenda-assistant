import { useCallback, useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SlackCard } from "./SlackCard";
import { TelegramCard } from "./TelegramCard";
import { WhatsAppCard } from "./WhatsAppCard";
import { api } from "@/lib/api";

export type ChannelKey = "slack" | "telegram" | "whatsapp";

export interface ChannelState {
  connected: boolean;
  // Slack
  teamName?: string;
  botUsername?: string;
  // Telegram / WhatsApp
  webhookUrl?: string;
  // WhatsApp
  phoneNumberId?: string;
}

interface ChannelsSectionProps {
  onUnauthorized: () => void;
}

/**
 * Orchestrates fetch/refresh for all three channel integrations and
 * hands each card its current state + a re-fetch callback.
 */
export function ChannelsSection({ onUnauthorized }: ChannelsSectionProps) {
  const [states, setStates] = useState<Record<ChannelKey, ChannelState | null>>(
    { slack: null, telegram: null, whatsapp: null },
  );

  const refresh = useCallback(
    async (key: ChannelKey) => {
      const { status, data } = await api<ChannelState>(
        "GET",
        `/admin/api/integrations/${key}`,
      );
      if (status === 401) {
        onUnauthorized();
        return;
      }
      setStates((prev) => ({
        ...prev,
        [key]: status === 200 ? data : null,
      }));
    },
    [onUnauthorized],
  );

  useEffect(() => {
    void refresh("slack");
    void refresh("telegram");
    void refresh("whatsapp");
  }, [refresh]);

  return (
    <Tabs defaultValue="slack" className="w-full">
      <TabsList className="bg-transparent border-b border-gray-100 rounded-none p-0 h-auto w-full justify-start gap-0">
        {(
          [
            { value: "slack", label: "Slack" },
            { value: "telegram", label: "Telegram" },
            { value: "whatsapp", label: "WhatsApp" },
          ] as const
        ).map((t) => (
          <TabsTrigger
            key={t.value}
            value={t.value}
            className="rounded-none border-b-2 border-transparent px-6 py-3 text-sm font-medium text-gray-500 data-[state=active]:bg-transparent data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:shadow-none -mb-px"
          >
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="slack" className="mt-8">
        <SlackCard
          state={states.slack}
          onChanged={() => refresh("slack")}
          onUnauthorized={onUnauthorized}
        />
      </TabsContent>
      <TabsContent value="telegram" className="mt-8">
        <TelegramCard
          state={states.telegram}
          onChanged={() => refresh("telegram")}
          onUnauthorized={onUnauthorized}
        />
      </TabsContent>
      <TabsContent value="whatsapp" className="mt-8">
        <WhatsAppCard
          state={states.whatsapp}
          onChanged={() => refresh("whatsapp")}
          onUnauthorized={onUnauthorized}
        />
      </TabsContent>
    </Tabs>
  );
}
