import type { AgentConfig, AgentPersona } from "../shared/types";

// Generates a "bait" reply for an incoming message. Uses an OpenAI-compatible
// chat completions endpoint when an API key is available, and falls back to a
// local template generator otherwise so the app stays functional offline.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

export interface BaitContext {
  persona: AgentPersona;
  config: AgentConfig;
  /** The message to react to. Omit/empty to generate a conversation opener. */
  incomingText?: string;
  fromName?: string;
}

function buildSystemPrompt(persona: AgentPersona, config: AgentConfig): string {
  const direction =
    config.mode === "ragebait"
      ? "Your job is to RAGEBAIT: write a short message engineered to provoke an irritated, defensive, or angry response. Be antagonistic but never use slurs, threats, or anything that could get an account banned."
      : "Your job is to JOYBAIT: write a short message engineered to spark genuine joy, warmth, or excitement, so the person smiles and wants to reply.";

  return [
    `You are "${persona.name}", a chat agent texting from a real person's Telegram.`,
    direction,
    `Persona vibe: ${persona.tagline}.`,
    `Tone to use: ${config.tone}.`,
    `Goal of the message: ${config.goal}.`,
    `Intensity: ${config.intensity}/10 (higher = more extreme).`,
    "Rules: Reply with ONE message only. Keep it under 240 characters. Sound like a real human texting, lowercase is fine. No quotation marks around the whole message. No emojis unless they fit naturally. Never reveal you are an AI or an agent.",
  ].join("\n");
}

export async function generateBait(ctx: BaitContext): Promise<string> {
  const { persona, config, incomingText, fromName } = ctx;
  const isOpener = !incomingText || !incomingText.trim();

  if (OPENAI_API_KEY) {
    try {
      const userPrompt = isOpener
        ? `Start a brand new conversation with ${fromName ?? "someone"} out of nowhere. Write your opening message now.`
        : `Message from ${fromName ?? "them"}: "${incomingText}"\n\nWrite your reply now.`;
      const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          temperature: Math.min(1.2, 0.6 + config.intensity * 0.05),
          max_tokens: 120,
          messages: [
            { role: "system", content: buildSystemPrompt(persona, config) },
            { role: "user", content: userPrompt },
          ],
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) return stripWrappingQuotes(text);
      } else {
        console.error("LLM error", res.status, await res.text());
      }
    } catch (err) {
      console.error("LLM request failed, using fallback", err);
    }
  }

  return fallbackBait(ctx);
}

function stripWrappingQuotes(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).trim();
  }
  return t;
}

// Local, no-API fallback. Picks from persona sample phrases and lightly
// remixes based on the incoming message so demos work without an API key.
function fallbackBait(ctx: BaitContext): string {
  const { persona, incomingText } = ctx;
  const base =
    persona.samplePhrases[
      Math.floor(Math.random() * persona.samplePhrases.length)
    ] ?? "interesting.";

  // No incoming message: just open with a raw sample phrase.
  if (!incomingText || !incomingText.trim()) return base;

  const snippet = incomingText.trim().split(/\s+/).slice(0, 4).join(" ");

  if (persona.mode === "ragebait") {
    const openers = [
      `"${snippet}"... sure, buddy.`,
      `lol "${snippet}". ok.`,
      `imagine genuinely saying "${snippet}".`,
    ];
    const opener = openers[Math.floor(Math.random() * openers.length)]!;
    return `${opener} ${base}`;
  }

  const openers = [
    `honestly "${snippet}" made me smile.`,
    `okay "${snippet}", i love that for you.`,
    `"${snippet}"? that's the good stuff.`,
  ];
  const opener = openers[Math.floor(Math.random() * openers.length)]!;
  return `${opener} ${base}`;
}

export function llmConfigured(): boolean {
  return Boolean(OPENAI_API_KEY);
}
