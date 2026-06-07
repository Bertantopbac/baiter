// Shared types used by both the Bun server and the React frontend.

export type BaitMode = "ragebait" | "joybait";

export type Platform = "telegram" | "x" | "email";

export interface AgentPersona {
  id: string;
  name: string;
  tagline: string;
  description: string;
  mode: BaitMode;
  /** Tailwind-ish gradient classes used to paint the card. */
  gradient: string;
  emoji: string;
  /** Default config applied when this persona is rented. */
  defaults: {
    tone: string;
    goal: string;
    intensity: number; // 1..10
  };
  samplePhrases: string[];
}

export interface AgentConfig {
  mode: BaitMode;
  tone: string;
  goal: string;
  intensity: number; // 1..10
  /** Only reply to private chats (true) or any chat the message arrives in. */
  privateOnly: boolean;
  /** Max replies per minute, to avoid getting the account flagged. */
  maxRepliesPerMin: number;
}

export type TelegramStatus = "disconnected" | "connected" | "error";

export interface TelegramState {
  status: TelegramStatus;
  /** The bot's @username (without the @). */
  username?: string;
  /** The bot's display name. */
  botName?: string;
  botId?: string;
  error?: string;
}

/** A person/chat that has messaged the bot (the only chats a bot can DM). */
export interface Contact {
  chatId: string;
  name: string;
  username?: string;
  lastSeen: number;
}

export interface Rental {
  id: string;
  personaId: string;
  platform: Platform;
  config: AgentConfig;
  active: boolean;
  createdAt: number;
  telegram: TelegramState;
}

export interface ActivityEvent {
  id: string;
  rentalId: string;
  ts: number;
  kind: "system" | "incoming" | "outgoing" | "error";
  chat?: string;
  from?: string;
  text: string;
}

// --- x402 / Algorand payment (mocked for showcase) ---

/** x402-style payment requirements returned with an HTTP 402 response. */
export interface PaymentRequirements {
  x402Version: number;
  scheme: string; // "exact"
  network: string; // "algorand"
  resource: string;
  description: string;
  payTo: string; // Algorand address
  asset: string; // "ALGO"
  amount: string; // human readable, e.g. "7.00"
  amountMicro: number; // microALGO
  nonce: string;
  expiresAt: number;
}

export interface PaymentReceipt {
  txId: string;
  payer: string;
  network: string;
  asset: string;
  amount: string;
  settledAt: number;
}

export type CampaignStatus = "active" | "done" | "cancelled";

/** A paid, time-boxed run where the agent sends messages on an interval. */
export interface Campaign {
  rentalId: string;
  chatId: string;
  chatName?: string;
  status: CampaignStatus;
  startedAt: number;
  endsAt: number;
  intervalSec: number;
  durationMin: number;
  sent: number;
  maxMessages: number;
  nextSendAt: number;
  receipt: PaymentReceipt;
}
