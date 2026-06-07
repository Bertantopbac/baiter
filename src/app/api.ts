import type {
  ActivityEvent,
  AgentConfig,
  AgentPersona,
  Campaign,
  Contact,
  PaymentReceipt,
  PaymentRequirements,
  Platform,
  Rental,
  TelegramState,
} from "../shared/types";

async function req<T>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  meta: () =>
    req<{ llmConfigured: boolean; botTokenConfigured: boolean }>("/api/meta"),
  agents: () => req<AgentPersona[]>("/api/agents"),
  rentals: () => req<Rental[]>("/api/rentals"),
  rental: (id: string) =>
    req<{ rental: Rental; activity: ActivityEvent[] }>(`/api/rentals/${id}`),
  createRental: (personaId: string, platform: Platform) =>
    req<Rental>("/api/rentals", "POST", { personaId, platform }),
  deleteRental: (id: string) =>
    req<{ ok: true }>(`/api/rentals/${id}`, "DELETE"),
  updateConfig: (id: string, config: Partial<AgentConfig>) =>
    req<Rental>(`/api/rentals/${id}/config`, "PATCH", config),
  activate: (id: string, active: boolean) =>
    req<Rental>(`/api/rentals/${id}/activate`, "POST", { active }),
  tgConnect: (id: string, token?: string) =>
    req<TelegramState>(`/api/rentals/${id}/telegram/connect`, "POST", { token }),
  tgDisconnect: (id: string) =>
    req<{ ok: true }>(`/api/rentals/${id}/telegram/disconnect`, "POST"),
  contacts: (id: string) => req<Contact[]>(`/api/rentals/${id}/contacts`),
  tgSend: (id: string, chatId: string, text?: string) =>
    req<{ ok: true; text: string }>(`/api/rentals/${id}/telegram/send`, "POST", {
      chatId,
      text,
    }),

  // x402 hire flow
  hireQuote: async (id: string, durationMin: number) => {
    const res = await fetch(`/api/rentals/${id}/hire/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ durationMin }),
    });
    const data = (await res.json()) as {
      accepts?: PaymentRequirements[];
    };
    return {
      status: res.status,
      requirements: data.accepts?.[0],
    };
  },
  hirePay: (
    id: string,
    body: {
      chatId: string;
      chatName?: string;
      durationMin: number;
      intervalSec: number;
      payer?: string;
    },
  ) =>
    req<{ campaign: Campaign; receipt: PaymentReceipt }>(
      `/api/rentals/${id}/hire/pay`,
      "POST",
      body,
    ),
  campaign: (id: string) => req<Campaign | null>(`/api/rentals/${id}/campaign`),
  cancelCampaign: (id: string) =>
    req<Campaign | null>(`/api/rentals/${id}/campaign/cancel`, "POST"),
};
