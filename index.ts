import type { Server, ServerWebSocket } from "bun";
import { randomUUID } from "node:crypto";

import index from "./src/app/index.html";
import { AGENTS, getPersona } from "./src/shared/agents";
import * as store from "./src/server/store";
import { TelegramManager } from "./src/server/telegram";
import { CampaignManager } from "./src/server/campaign";
import { buildRequirements, priceForHire, settlePayment } from "./src/server/payments";
import { llmConfigured } from "./src/server/llm";
import type {
  ActivityEvent,
  AgentConfig,
  Platform,
  Rental,
} from "./src/shared/types";

interface WSData {
  rentalId: string;
}

let server: Server<WSData>;

const telegram = new TelegramManager((event: ActivityEvent) => {
  server?.publish(`rental:${event.rentalId}`, JSON.stringify(event));
});

const campaigns = new CampaignManager(
  (rentalId, chatId) => telegram.sendMessage(rentalId, chatId),
  (rentalId, kind, text) => telegram.logEvent(rentalId, kind, text),
);

const clampDuration = (n: number) => Math.max(1, Math.min(180, Math.round(n)));
const clampInterval = (n: number) => Math.max(5, Math.min(3600, Math.round(n)));

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function defaultConfig(personaId: string): AgentConfig {
  const persona = getPersona(personaId)!;
  return {
    mode: persona.mode,
    tone: persona.defaults.tone,
    goal: persona.defaults.goal,
    intensity: persona.defaults.intensity,
    privateOnly: true,
    maxRepliesPerMin: 6,
  };
}

server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  idleTimeout: 120,

  routes: {
    "/": index,

    "/api/meta": {
      GET: () =>
        json({
          llmConfigured: llmConfigured(),
          botTokenConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
        }),
    },

    "/api/agents": {
      GET: () => json(AGENTS),
    },

    "/api/rentals": {
      GET: () => json(store.listRentals()),
      POST: async (req) => {
        const body = (await req.json()) as {
          personaId?: string;
          platform?: Platform;
        };
        if (!body.personaId || !getPersona(body.personaId)) {
          return err("Unknown personaId");
        }
        const platform: Platform = body.platform ?? "telegram";
        const rental: Rental = {
          id: randomUUID(),
          personaId: body.personaId,
          platform,
          config: defaultConfig(body.personaId),
          active: false,
          createdAt: Date.now(),
          telegram: { status: "disconnected" },
        };
        store.createRental(rental);
        // Auto-connect if a bot token is already configured in the environment.
        if (process.env.TELEGRAM_BOT_TOKEN) {
          try {
            const tgState = await telegram.connectBot(
              rental.id,
              process.env.TELEGRAM_BOT_TOKEN,
            );
            rental.telegram = tgState;
          } catch {
            /* non-fatal — user can connect manually */
          }
        }
        return json(rental, 201);
      },
    },

    "/api/rentals/:id": {
      GET: (req) => {
        const rental = store.getRental(req.params.id);
        if (!rental) return err("Not found", 404);
        return json({ rental, activity: store.getActivity(rental.id) });
      },
      DELETE: async (req) => {
        const rental = store.getRental(req.params.id);
        if (!rental) return err("Not found", 404);
        campaigns.cancel(rental.id, true);
        await telegram.disconnect(rental.id);
        store.deleteRental(rental.id);
        return json({ ok: true });
      },
    },

    "/api/rentals/:id/config": {
      PATCH: async (req) => {
        const rental = store.getRental(req.params.id);
        if (!rental) return err("Not found", 404);
        const patch = (await req.json()) as Partial<AgentConfig>;
        const config: AgentConfig = { ...rental.config, ...patch };
        config.intensity = Math.max(1, Math.min(10, config.intensity));
        config.maxRepliesPerMin = Math.max(
          1,
          Math.min(60, config.maxRepliesPerMin),
        );
        store.updateConfig(rental.id, config);
        return json({ ...rental, config });
      },
    },

    "/api/rentals/:id/activate": {
      POST: async (req) => {
        const rental = store.getRental(req.params.id);
        if (!rental) return err("Not found", 404);
        const body = (await req.json()) as { active?: boolean };
        const active = Boolean(body.active);

        if (active && rental.telegram.status !== "connected") {
          return err("Connect Telegram before activating.", 409);
        }

        store.updateActive(rental.id, active);
        try {
          if (active) await telegram.startAgent(rental.id);
          else await telegram.stopAgent(rental.id);
        } catch (e) {
          store.updateActive(rental.id, false);
          return err((e as Error).message, 500);
        }
        return json(store.getRental(rental.id));
      },
    },

    "/api/rentals/:id/telegram/connect": {
      POST: async (req) => {
        const rental = store.getRental(req.params.id);
        if (!rental) return err("Not found", 404);
        const body = (await req.json()) as { token?: string };

        const token = (body.token ?? process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
        if (!token) return err("Missing bot token.");

        try {
          const state = await telegram.connectBot(rental.id, token);
          return json(state);
        } catch (e) {
          const state = { status: "error", error: (e as Error).message };
          store.updateTelegramState(rental.id, state as never);
          return err((e as Error).message, 500);
        }
      },
    },

    "/api/rentals/:id/telegram/disconnect": {
      POST: async (req) => {
        const rental = store.getRental(req.params.id);
        if (!rental) return err("Not found", 404);
        await telegram.disconnect(rental.id);
        store.updateActive(rental.id, false);
        store.updateTelegramState(rental.id, { status: "disconnected" });
        return json({ ok: true });
      },
    },

    "/api/rentals/:id/contacts": {
      GET: (req) => {
        const rental = store.getRental(req.params.id);
        if (!rental) return err("Not found", 404);
        return json(store.listContacts(rental.id));
      },
    },

    "/api/rentals/:id/telegram/send": {
      POST: async (req) => {
        const rental = store.getRental(req.params.id);
        if (!rental) return err("Not found", 404);
        const body = (await req.json()) as { chatId?: string; text?: string };
        const chatId = body.chatId?.trim();
        if (!chatId) return err("Missing chatId.");
        if (rental.telegram.status !== "connected") {
          return err("Connect the bot first.", 409);
        }
        try {
          const sent = await telegram.sendMessage(
            rental.id,
            chatId,
            body.text,
          );
          return json({ ok: true, text: sent });
        } catch (e) {
          return err((e as Error).message, 500);
        }
      },
    },

    // x402: request a quote. Responds with a real HTTP 402 + payment requirements.
    "/api/rentals/:id/hire/quote": {
      POST: async (req) => {
        const rental = store.getRental(req.params.id);
        if (!rental) return err("Not found", 404);
        const body = (await req.json()) as { durationMin?: number };
        const durationMin = clampDuration(body.durationMin ?? 60);
        const requirements = buildRequirements(
          `baiter://agent/${rental.personaId}`,
          durationMin,
        );
        return new Response(
          JSON.stringify({ x402Version: 1, error: "Payment Required", accepts: [requirements] }),
          {
            status: 402,
            headers: {
              "Content-Type": "application/json",
              "WWW-Authenticate": 'x402 realm="baiter", network="algorand"',
            },
          },
        );
      },
    },

    // x402: settle payment (mocked) and kick off the timed campaign.
    "/api/rentals/:id/hire/pay": {
      POST: async (req) => {
        const rental = store.getRental(req.params.id);
        if (!rental) return err("Not found", 404);
        if (rental.telegram.status !== "connected") {
          return err("Connect the bot first.", 409);
        }
        const body = (await req.json()) as {
          chatId?: string;
          chatName?: string;
          durationMin?: number;
          intervalSec?: number;
          payer?: string;
        };
        const chatId = body.chatId?.trim();
        if (!chatId) return err("Missing target chatId.");

        const durationMin = clampDuration(body.durationMin ?? 60);
        const intervalSec = clampInterval(body.intervalSec ?? 300);
        const amount = priceForHire(durationMin).toFixed(2);
        const receipt = settlePayment(body.payer, "ALGO", amount);

        const campaign = campaigns.start({
          rentalId: rental.id,
          chatId,
          chatName: body.chatName,
          durationMin,
          intervalSec,
          receipt,
        });
        return json({ campaign, receipt });
      },
    },

    "/api/rentals/:id/campaign": {
      GET: (req) => {
        const rental = store.getRental(req.params.id);
        if (!rental) return err("Not found", 404);
        return json(campaigns.get(rental.id) ?? null);
      },
    },

    "/api/rentals/:id/campaign/cancel": {
      POST: (req) => {
        const rental = store.getRental(req.params.id);
        if (!rental) return err("Not found", 404);
        campaigns.cancel(rental.id);
        return json(campaigns.get(rental.id) ?? null);
      },
    },
  },

  // WebSocket upgrade for live activity streaming.
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const rentalId = url.searchParams.get("rentalId") ?? "";
      if (srv.upgrade(req, { data: { rentalId } })) return undefined;
      return new Response("Upgrade failed", { status: 400 });
    }
    return new Response("Not found", { status: 404 });
  },

  websocket: {
    open(ws: ServerWebSocket<WSData>) {
      if (ws.data.rentalId) {
        ws.subscribe(`rental:${ws.data.rentalId}`);
        // Replay existing activity so a fresh subscriber sees history.
        for (const ev of store.getActivity(ws.data.rentalId)) {
          ws.send(JSON.stringify(ev));
        }
      }
    },
    message() {
      /* clients are read-only */
    },
    close(ws: ServerWebSocket<WSData>) {
      if (ws.data.rentalId) ws.unsubscribe(`rental:${ws.data.rentalId}`);
    },
  },

  development: {
    hmr: true,
    console: true,
  },
});

// Resume any agents that were active before a restart.
await telegram.resumeAll(store.listRentals());

console.log(`baiter running at http://localhost:${server.port}`);
if (!llmConfigured()) {
  console.log(
    "Note: OPENAI_API_KEY not set. Using built-in fallback bait generator.",
  );
}
