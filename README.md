# baiter

https://raw.githubusercontent.com/Bertantopbac/baiter/main/baiter-demo.mp4

Rent an agent to **ragebait** or **joybait** people through a **Telegram bot**.
Pick a personality from the card stack, set its tone / goal / intensity, connect
a bot token, and let it auto-reply or proactively message people.

> Telegram is the only functional platform right now. X and Email are stubbed
> in the UI as "coming soon".

> Uses the Telegram **Bot API**. A bot can only message people who have messaged
> it first (Telegram restriction), so to start a chat, the target must `/start`
> your bot once. They then appear in the "Send / start a conversation" list.

## Stack

- **Bun** (`Bun.serve` + HTML imports for the React frontend, `bun:sqlite` for storage)
- **React 19** + **framer-motion** (the swipeable `CardStack`) + **lucide-react**
- **Telegram Bot API** (long polling via `getUpdates`, no extra dependency)
- Optional **OpenAI-compatible LLM** for generating replies (falls back to a
  built-in generator when no key is set)

## Run

```sh
bun install
bun --hot ./index.ts
# open http://localhost:3000
```

## Configuration (env / `.env`)

Copy `.env.example` to `.env`. Bun auto-loads it. All values are optional:

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Default bot token so users can leave the token field blank in the UI. |
| `OPENAI_API_KEY` | Enables LLM-generated baits. Without it, a local fallback generator is used. |
| `OPENAI_BASE_URL` | Override the API base (default `https://api.openai.com/v1`). |
| `OPENAI_MODEL` | Chat model (default `gpt-4o-mini`). |
| `PORT` | Server port (default `3000`). |

## Connecting Telegram

1. In Telegram, open [@BotFather](https://t.me/BotFather) → `/newbot` → get a
   **bot token** like `123456:ABC-DEF...`.
2. Rent an agent in the UI, open it, paste the token, and hit **Connect bot**
   (or put it in `.env` as `TELEGRAM_BOT_TOKEN` and leave the field blank).
3. Hit **Unleash agent** to turn on auto-replies.
4. Message your bot from another Telegram account (or have your target `/start`
   it). They appear under **Send / start a conversation**, where you can fire a
   generated opener or a custom message at them.

Bot token + known contacts are persisted in `baiter.sqlite`, so agents resume
on restart.

## How it works

- `src/shared/` – agent catalog + shared types (used by server and client).
- `src/server/telegram.ts` – Bot API client: `getMe`, `getUpdates` long-poll
  loop, auto-reply, and proactive `sendMessage` (rate-limited).
- `src/server/llm.ts` – bait generation, replies and openers (LLM or fallback).
- `src/server/store.ts` – `bun:sqlite` persistence (rentals, bot token,
  contacts) + in-memory activity log.
- `src/app/` – React UI: the `CardStack` roster, configurator modal, send panel,
  and a WebSocket-driven live activity log.

## Disclaimer

This drives a Telegram **bot** through the official Bot API. You're responsible
for how you use it. Don't harass anyone and follow Telegram's ToS. Built for fun
and experiments.
