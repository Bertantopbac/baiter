import { randomUUID } from "node:crypto";

import * as store from "./store";
import { getPersona } from "../shared/agents";
import { generateBait } from "./llm";
import type { ActivityEvent, Rental, TelegramState } from "../shared/types";

type Broadcast = (event: ActivityEvent) => void;

interface TgUser {
  id: number;
  is_bot: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}
interface TgChat {
  id: number;
  type: string;
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}
interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

/**
 * One shared polling loop per bot token.
 * Dispatches incoming messages to every rental registered under that token.
 */
interface TokenPoller {
  token: string;
  offset: number;
  alive: boolean;
  abort: AbortController;
  /** rentalId → rate-limit timestamps */
  rentals: Map<string, number[]>;
}

const API = "https://api.telegram.org";

export class TelegramManager {
  /** keyed by bot token — one poller per token regardless of how many rentals use it */
  private pollers = new Map<string, TokenPoller>();
  /** rentalId → token — for quick reverse lookup */
  private rentalToken = new Map<string, string>();
  private broadcast: Broadcast;

  constructor(broadcast: Broadcast) {
    this.broadcast = broadcast;
  }

  // ---------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------

  /** Public hook so other subsystems (e.g. campaigns) can append to the log. */
  logEvent(
    rentalId: string,
    kind: ActivityEvent["kind"],
    text: string,
    extra?: { chat?: string; from?: string },
  ) {
    this.log(rentalId, kind, text, extra);
  }

  private log(
    rentalId: string,
    kind: ActivityEvent["kind"],
    text: string,
    extra?: { chat?: string; from?: string },
  ) {
    const event: ActivityEvent = {
      id: randomUUID(),
      rentalId,
      ts: Date.now(),
      kind,
      text,
      chat: extra?.chat,
      from: extra?.from,
    };
    store.pushActivity(event);
    this.broadcast(event);
  }

  // ---------------------------------------------------------------------------
  // Bot API
  // ---------------------------------------------------------------------------

  private async call<T>(
    token: string,
    method: string,
    params?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params ?? {}),
      signal,
    });
    const data = (await res.json()) as {
      ok: boolean;
      result?: T;
      description?: string;
    };
    if (!data.ok) {
      throw new Error(data.description ?? `Telegram API ${method} failed`);
    }
    return data.result as T;
  }

  // ---------------------------------------------------------------------------
  // Connect / disconnect
  // ---------------------------------------------------------------------------

  async connectBot(rentalId: string, token: string): Promise<TelegramState> {
    const trimmed = token.trim();

    // Clear any stale webhook or prior long-poll session held by Telegram.
    // This is the fix for the "Conflict: terminated by other getUpdates" error.
    await this.call(trimmed, "deleteWebhook", { drop_pending_updates: false }).catch(() => {});

    const me = await this.call<TgUser>(trimmed, "getMe");

    store.saveBotToken(rentalId, trimmed);
    const state: TelegramState = {
      status: "connected",
      username: me.username,
      botName: me.first_name,
      botId: me.id.toString(),
    };
    store.updateTelegramState(rentalId, state);

    this.addRentalToPoller(rentalId, trimmed);

    this.log(
      rentalId,
      "system",
      `Connected to bot @${me.username ?? me.id}. Send it a message to start a chat.`,
    );
    return state;
  }

  /** Remove a rental from its poller. Stops the poller only if no rentals remain. */
  async disconnect(rentalId: string): Promise<void> {
    const token = this.rentalToken.get(rentalId);
    this.rentalToken.delete(rentalId);
    if (!token) return;

    const poller = this.pollers.get(token);
    if (!poller) return;
    poller.rentals.delete(rentalId);

    if (poller.rentals.size === 0) {
      poller.alive = false;
      poller.abort.abort();
      this.pollers.delete(token);
    }
  }

  // ---------------------------------------------------------------------------
  // Polling loop — ONE per token
  // ---------------------------------------------------------------------------

  private addRentalToPoller(rentalId: string, token: string) {
    this.rentalToken.set(rentalId, token);

    let poller = this.pollers.get(token);
    if (!poller) {
      poller = {
        token,
        offset: 0,
        alive: true,
        abort: new AbortController(),
        rentals: new Map(),
      };
      this.pollers.set(token, poller);
      void this.pollLoop(poller);
    }
    if (!poller.rentals.has(rentalId)) {
      poller.rentals.set(rentalId, []);
    }
  }

  private async pollLoop(poller: TokenPoller) {
    while (poller.alive) {
      try {
        const updates = await this.call<TgUpdate[]>(
          poller.token,
          "getUpdates",
          {
            offset: poller.offset,
            timeout: 30,
            allowed_updates: ["message"],
          },
          poller.abort.signal,
        );

        for (const update of updates) {
          poller.offset = update.update_id + 1;
          if (update.message) {
            await this.dispatchMessage(poller, update.message);
          }
        }
      } catch (err) {
        if (poller.abort.signal.aborted || !poller.alive) break;
        // Log the error to every rental sharing this poller.
        const msg = `Polling error: ${(err as Error).message}`;
        for (const rentalId of poller.rentals.keys()) {
          this.log(rentalId, "error", msg);
        }
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Message dispatch
  // ---------------------------------------------------------------------------

  private contactName(chat: TgChat): string {
    if (chat.title) return chat.title;
    const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ");
    return name || chat.username || chat.id.toString();
  }

  private async dispatchMessage(poller: TokenPoller, message: TgMessage) {
    const chat = message.chat;
    const name = this.contactName(chat);
    const text = message.text?.trim();

    // Register contact for every rental sharing this token.
    for (const rentalId of poller.rentals.keys()) {
      store.upsertContact(rentalId, {
        chatId: chat.id.toString(),
        name,
        username: chat.username,
        lastSeen: Date.now(),
      });
    }

    if (!text) return;

    // Fan out: let every active rental with auto-reply on react.
    for (const [rentalId, timestamps] of poller.rentals) {
      this.log(rentalId, "incoming", text, { from: name, chat: name });

      const rental = store.getRental(rentalId);
      if (!rental?.active) continue;
      if (rental.config.privateOnly && chat.type !== "private") continue;

      const persona = getPersona(rental.personaId);
      if (!persona) continue;

      const now = Date.now();
      const recent = timestamps.filter((t) => now - t < 60_000);
      poller.rentals.set(rentalId, recent);
      if (recent.length >= rental.config.maxRepliesPerMin) {
        this.log(rentalId, "system", "Rate limit reached. Skipping this one.");
        continue;
      }

      try {
        const reply = await generateBait({
          persona,
          config: rental.config,
          incomingText: text,
          fromName: name,
        });
        await new Promise((r) => setTimeout(r, 600 + Math.random() * 1200));
        await this.call(poller.token, "sendMessage", {
          chat_id: chat.id,
          text: reply,
        });
        recent.push(Date.now());
        poller.rentals.set(rentalId, recent);
        this.log(rentalId, "outgoing", reply, { from: name, chat: name });
      } catch (err) {
        this.log(
          rentalId,
          "error",
          `Failed to reply: ${(err as Error).message}`,
        );
      }
      // Only one rental should reply to avoid double-messages; break after first active one.
      break;
    }
  }

  // ---------------------------------------------------------------------------
  // Proactive send
  // ---------------------------------------------------------------------------

  async sendMessage(
    rentalId: string,
    chatId: string,
    text?: string,
  ): Promise<string> {
    const rental = store.getRental(rentalId);
    if (!rental) throw new Error("Rental not found.");

    const token =
      this.rentalToken.get(rentalId) ?? store.getBotToken(rentalId);
    if (!token) throw new Error("Bot is not connected.");

    let outgoing = text?.trim();
    if (!outgoing) {
      const persona = getPersona(rental.personaId);
      if (!persona) throw new Error("Unknown persona.");
      const contact = store
        .listContacts(rentalId)
        .find((c) => c.chatId === chatId);
      outgoing = await generateBait({
        persona,
        config: rental.config,
        fromName: contact?.name,
      });
    }

    await this.call(token, "sendMessage", { chat_id: chatId, text: outgoing });
    const contact = store
      .listContacts(rentalId)
      .find((c) => c.chatId === chatId);
    this.log(rentalId, "outgoing", outgoing, {
      chat: contact?.name ?? chatId,
      from: contact?.name ?? chatId,
    });
    return outgoing;
  }

  // ---------------------------------------------------------------------------
  // Arm / disarm (auto-reply flag lives in the rental row, not here)
  // ---------------------------------------------------------------------------

  async startAgent(rentalId: string): Promise<void> {
    const token =
      this.rentalToken.get(rentalId) ?? store.getBotToken(rentalId);
    if (!token) throw new Error("Telegram bot not connected for this agent.");
    // Make sure we're in the poller (e.g. after a server restart).
    if (!this.rentalToken.has(rentalId)) {
      this.addRentalToPoller(rentalId, token);
    }
    this.log(rentalId, "system", "Agent armed. Auto-replies are on.");
  }

  async stopAgent(rentalId: string): Promise<void> {
    this.log(rentalId, "system", "Agent disarmed. Auto-replies paused.");
  }

  // ---------------------------------------------------------------------------
  // Resume on server boot
  // ---------------------------------------------------------------------------

  async resumeAll(rentals: Rental[]): Promise<void> {
    // Group rentals by token so we only start one poller per token.
    const byToken = new Map<string, string[]>();
    for (const rental of rentals) {
      if (rental.telegram.status !== "connected") continue;
      const token = store.getBotToken(rental.id);
      if (!token) continue;
      const list = byToken.get(token) ?? [];
      list.push(rental.id);
      byToken.set(token, list);
    }

    for (const [token, rentalIds] of byToken) {
      for (const rentalId of rentalIds) {
        this.addRentalToPoller(rentalId, token);
      }
    }
  }
}
