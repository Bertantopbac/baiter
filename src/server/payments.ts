import { randomBytes } from "node:crypto";
import type { PaymentReceipt, PaymentRequirements } from "../shared/types";

// Mocked x402 + Algorand payment helpers. No funds move — this exists purely to
// showcase a pay-to-hire flow with realistic-looking requirements and receipts.

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // RFC4648 base32 alphabet

function b32(len: number): string {
  const buf = randomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHA[buf[i]! % 32];
  return s;
}

// A plausible 58-char Algorand address the "agent vault" gets paid into.
const RECEIVER = process.env.ALGO_RECEIVER ?? b32(58);

const BASE_ALGO = 1; // flat booking fee
const ALGO_PER_MIN = 0.1; // time-based rate

export function priceForHire(durationMin: number): number {
  return Math.round((BASE_ALGO + durationMin * ALGO_PER_MIN) * 100) / 100;
}

export function buildRequirements(
  resource: string,
  durationMin: number,
): PaymentRequirements {
  const amount = priceForHire(durationMin);
  return {
    x402Version: 1,
    scheme: "exact",
    network: "algorand",
    resource,
    description: `Hire baiter agent for ${durationMin} minute(s)`,
    payTo: RECEIVER,
    asset: "ALGO",
    amount: amount.toFixed(2),
    amountMicro: Math.round(amount * 1_000_000),
    nonce: b32(16),
    expiresAt: Date.now() + 5 * 60 * 1000,
  };
}

/** Pretend to verify + settle an on-chain payment, returning a receipt. */
export function settlePayment(
  payer: string | undefined,
  asset: string,
  amount: string,
): PaymentReceipt {
  return {
    txId: b32(52),
    payer: payer && payer.length === 58 ? payer : b32(58),
    network: "algorand",
    asset,
    amount,
    settledAt: Date.now(),
  };
}
