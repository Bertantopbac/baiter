import type { Campaign, PaymentReceipt } from "../shared/types";

type SendFn = (rentalId: string, chatId: string) => Promise<string>;
type LogFn = (
  rentalId: string,
  kind: "system" | "outgoing" | "error",
  text: string,
) => void;

// Manages time-boxed "hire" campaigns: after payment, the agent fires a
// generated message to a target chat every `intervalSec` until the hire ends.
export class CampaignManager {
  private campaigns = new Map<string, Campaign>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private send: SendFn,
    private log: LogFn,
  ) {}

  get(rentalId: string): Campaign | undefined {
    return this.campaigns.get(rentalId);
  }

  start(opts: {
    rentalId: string;
    chatId: string;
    chatName?: string;
    durationMin: number;
    intervalSec: number;
    receipt: PaymentReceipt;
  }): Campaign {
    this.cancel(opts.rentalId, true);

    const now = Date.now();
    const durationMs = opts.durationMin * 60_000;
    const maxMessages = Math.max(
      1,
      Math.floor(durationMs / (opts.intervalSec * 1000)),
    );

    const campaign: Campaign = {
      rentalId: opts.rentalId,
      chatId: opts.chatId,
      chatName: opts.chatName,
      status: "active",
      startedAt: now,
      endsAt: now + durationMs,
      intervalSec: opts.intervalSec,
      durationMin: opts.durationMin,
      sent: 0,
      maxMessages,
      nextSendAt: now + 2000, // first message shortly after payment
      receipt: opts.receipt,
    };
    this.campaigns.set(opts.rentalId, campaign);

    this.log(
      opts.rentalId,
      "system",
      `Hired for ${opts.durationMin} min via x402 — paid ${opts.receipt.amount} ${opts.receipt.asset} on Algorand (tx ${opts.receipt.txId.slice(0, 8)}…). Sending up to ${maxMessages} message(s), one every ${opts.intervalSec}s.`,
    );

    this.schedule(opts.rentalId);
    return campaign;
  }

  private schedule(rentalId: string) {
    const c = this.campaigns.get(rentalId);
    if (!c || c.status !== "active") return;
    const delay = Math.max(0, c.nextSendAt - Date.now());
    const t = setTimeout(() => void this.tick(rentalId), delay);
    this.timers.set(rentalId, t);
  }

  private async tick(rentalId: string) {
    const c = this.campaigns.get(rentalId);
    if (!c || c.status !== "active") return;

    if (Date.now() >= c.endsAt || c.sent >= c.maxMessages) {
      this.finish(rentalId);
      return;
    }

    try {
      await this.send(rentalId, c.chatId);
      c.sent += 1;
    } catch (err) {
      this.log(
        rentalId,
        "error",
        `Campaign send failed: ${(err as Error).message}`,
      );
    }

    if (c.sent >= c.maxMessages || Date.now() + c.intervalSec * 1000 > c.endsAt) {
      this.finish(rentalId);
      return;
    }

    c.nextSendAt = Date.now() + c.intervalSec * 1000;
    this.schedule(rentalId);
  }

  private finish(rentalId: string) {
    const c = this.campaigns.get(rentalId);
    if (!c) return;
    c.status = "done";
    const t = this.timers.get(rentalId);
    if (t) clearTimeout(t);
    this.timers.delete(rentalId);
    this.log(
      rentalId,
      "system",
      `Hire complete. Sent ${c.sent} message(s). The agent has clocked out.`,
    );
  }

  cancel(rentalId: string, silent = false) {
    const c = this.campaigns.get(rentalId);
    const t = this.timers.get(rentalId);
    if (t) clearTimeout(t);
    this.timers.delete(rentalId);
    if (c && c.status === "active") {
      c.status = "cancelled";
      if (!silent) {
        this.log(
          rentalId,
          "system",
          `Hire cancelled. Sent ${c.sent} message(s) before stopping.`,
        );
      }
    }
  }
}
