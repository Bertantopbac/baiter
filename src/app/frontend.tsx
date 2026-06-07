import * as React from "react";
import { createRoot } from "react-dom/client";
import {
  X,
  Zap,
  ZapOff,
  Trash2,
  Plug,
  RefreshCw,
  Send,
  Wallet,
  Clock,
  Loader2,
  CheckCircle2,
  ArrowRight,
  Coins,
  Timer,
} from "lucide-react";

import "./styles.css";
import { CardStack, type CardStackItem } from "./CardStack";
import { api } from "./api";
import type {
  ActivityEvent,
  AgentConfig,
  AgentPersona,
  Campaign,
  Contact,
  PaymentRequirements,
  Rental,
} from "../shared/types";

type AgentCardItem = CardStackItem & { persona: AgentPersona };

function modeLabel(mode: string) {
  return mode === "ragebait" ? "RAGEBAIT" : "JOYBAIT";
}

function midTruncate(s: string, head = 8, tail = 6) {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function fmtCountdown(ms: number) {
  if (ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// A throwaway "wallet" address generated client-side for the demo.
function fakePeraAddress() {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let s = "";
  for (let i = 0; i < 58; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

const HIRE_PRESETS = [
  { label: "1 hour", durationMin: 60, intervalSec: 300 },
  { label: "30 min", durationMin: 30, intervalSec: 180 },
  { label: "Demo · 2 min", durationMin: 2, intervalSec: 15 },
];

function clientPrice(durationMin: number) {
  return Math.round((1 + durationMin * 0.1) * 100) / 100;
}

/* ----------------------------- Agent card ----------------------------- */
function AgentCard({ persona }: { persona: AgentPersona }) {
  return (
    <div className="agent-card">
      <div className="glow" style={{ background: persona.gradient }} />
      <div className="veil" />
      <div className="top-row">
        <span className="emoji">{persona.emoji}</span>
        <span className="mode-tag">{modeLabel(persona.mode)}</span>
      </div>
      <div>
        <h3>{persona.name}</h3>
        <p className="tagline">{persona.tagline}</p>
        <p className="desc">{persona.description}</p>
      </div>
    </div>
  );
}

/* ----------------------------- Activity log ----------------------------- */
function ActivityLog({ rentalId }: { rentalId: string }) {
  const [events, setEvents] = React.useState<ActivityEvent[]>([]);
  const boxRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setEvents([]);
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${location.host}/ws?rentalId=${rentalId}`,
    );
    ws.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as ActivityEvent;
        setEvents((prev) => [...prev.slice(-199), ev]);
      } catch {
        /* ignore */
      }
    };
    return () => ws.close();
  }, [rentalId]);

  React.useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [events]);

  return (
    <div className="activity" ref={boxRef}>
      {events.length === 0 ? (
        <div className="log-empty">No activity yet…</div>
      ) : (
        events.map((ev) => (
          <div key={ev.id} className={`log-line ${ev.kind}`}>
            <span className="t">
              {new Date(ev.ts).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
            <span className="msg">
              {ev.kind === "incoming" && `← ${ev.from ?? ""}: `}
              {ev.kind === "outgoing" && `→ reply: `}
              {ev.text}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

/* ----------------------------- Telegram block ----------------------------- */
function TelegramBlock({
  rental,
  onState,
  botTokenConfigured,
}: {
  rental: Rental;
  onState: (next: Rental) => void;
  botTokenConfigured: boolean;
}) {
  const status = rental.telegram.status;
  const [token, setToken] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-block">
      <h4>Telegram bot connection</h4>
      <div className="status-line">
        <span
          className={`dot ${
            status === "connected"
              ? "connected"
              : status === "error"
                ? "error"
                : "disconnected"
          }`}
        />
        <span>
          {status === "connected"
            ? `Connected as ${rental.telegram.botName ?? "bot"}${rental.telegram.username ? ` @${rental.telegram.username}` : ""}`
            : status === "error"
              ? "Connection error"
              : "Not connected"}
        </span>
      </div>

      {status !== "connected" ? (
        <>
          {botTokenConfigured ? (
            <p className="hint">
              Bot token is configured on the server. Click below to connect.
            </p>
          ) : (
            <>
              <p className="hint">
                Create a bot with{" "}
                <a
                  href="https://t.me/BotFather"
                  target="_blank"
                  rel="noreferrer"
                >
                  @BotFather
                </a>{" "}
                and paste its token below.
              </p>
              <div className="field">
                <label>Bot token</label>
                <input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="123456:ABC-DEF…"
                />
              </div>
            </>
          )}
          <button
            className="btn primary"
            disabled={busy || (!botTokenConfigured && !token)}
            onClick={() =>
              run(async () => {
                const state = await api.tgConnect(
                  rental.id,
                  token || undefined,
                );
                onState({ ...rental, telegram: state });
              })
            }
          >
            <Plug size={15} style={{ verticalAlign: "-2px" }} /> Connect bot
          </button>
        </>
      ) : (
        <button
          className="btn danger sm"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api.tgDisconnect(rental.id);
              onState({
                ...rental,
                active: false,
                telegram: { status: "disconnected" },
              });
            })
          }
        >
          Disconnect
        </button>
      )}

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

/* ----------------------------- Send / start convo ----------------------------- */
function SendPanel({ rental }: { rental: Rental }) {
  const [contacts, setContacts] = React.useState<Contact[]>([]);
  const [chatId, setChatId] = React.useState("");
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  const loadContacts = React.useCallback(async () => {
    try {
      setContacts(await api.contacts(rental.id));
    } catch {
      /* ignore */
    }
  }, [rental.id]);

  React.useEffect(() => {
    loadContacts();
    const t = setInterval(loadContacts, 5000);
    return () => clearInterval(t);
  }, [loadContacts]);

  const send = (generate: boolean) =>
    run(async () => {
      const res = await api.tgSend(
        rental.id,
        chatId.trim(),
        generate ? undefined : text,
      );
      setNote(`Sent: ${res.text}`);
      if (!generate) setText("");
    });

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-block" style={{ marginTop: 16 }}>
      <h4>Send a message</h4>
      <p className="hint">
        Pick someone who has already messaged your bot, or paste a chat ID. Leave the message blank to generate an opener automatically.
      </p>

      {contacts.length > 0 && (
        <div className="field">
          <label>Known contacts</label>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) setChatId(e.target.value);
            }}
          >
            <option value="">Pick a contact to fill in their ID…</option>
            {contacts.map((c) => (
              <option key={c.chatId} value={c.chatId}>
                {c.name}
                {c.username ? ` (@${c.username})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label>Chat ID</label>
        <input
          value={chatId}
          onChange={(e) => setChatId(e.target.value)}
          placeholder={contacts.length === 0 ? "No contacts yet — message your bot first" : "e.g. 123456789"}
          inputMode="numeric"
        />
      </div>

      <div className="field">
        <label>Custom message (optional)</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Leave blank to let the agent generate an opener"
        />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          className="btn primary sm"
          disabled={busy || !chatId.trim()}
          onClick={() => send(true)}
        >
          <Zap size={14} style={{ verticalAlign: "-2px" }} /> Generate &amp; send
        </button>
        <button
          className="btn sm"
          disabled={busy || !chatId.trim() || !text.trim()}
          onClick={() => send(false)}
        >
          <Send size={14} style={{ verticalAlign: "-2px" }} /> Send custom
        </button>
        <button
          className="btn ghost sm"
          disabled={busy}
          onClick={() => run(loadContacts)}
        >
          <RefreshCw size={14} style={{ verticalAlign: "-2px" }} /> Refresh
        </button>
      </div>

      {note && (
        <p className="help" style={{ marginTop: 8, color: "var(--good)" }}>
          {note}
        </p>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

/* ----------------------------- Live campaign panel ----------------------------- */
function CampaignPanel({
  rental,
  onHire,
}: {
  rental: Rental;
  onHire: () => void;
}) {
  const [campaign, setCampaign] = React.useState<Campaign | null>(null);
  const [now, setNow] = React.useState(Date.now());

  const load = React.useCallback(async () => {
    try {
      setCampaign(await api.campaign(rental.id));
    } catch {
      /* ignore */
    }
  }, [rental.id]);

  React.useEffect(() => {
    load();
    const poll = setInterval(load, 2000);
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const active = campaign?.status === "active";
  const remaining = campaign ? campaign.endsAt - now : 0;
  const nextIn = campaign ? campaign.nextSendAt - now : 0;
  const pct = campaign
    ? Math.min(100, Math.round((campaign.sent / campaign.maxMessages) * 100))
    : 0;

  return (
    <div className="card-block hire-block" style={{ marginTop: 16 }}>
      <div className="hire-head">
        <h4>
          <Timer size={15} style={{ verticalAlign: "-2px" }} /> Hire &amp; run a
          campaign
        </h4>
        <span className="x402-chip">x402 · Algorand</span>
      </div>

      {!active ? (
        <>
          <p className="hint">
            Pay once and the agent works a shift — it fires generated messages
            at your target on an interval until the time runs out.
          </p>
          {campaign && campaign.status !== "active" && (
            <p className="help" style={{ marginBottom: 10 }}>
              Last hire: {campaign.status} · {campaign.sent}/
              {campaign.maxMessages} sent.
            </p>
          )}
          <button className="btn primary" onClick={onHire}>
            <Wallet size={15} style={{ verticalAlign: "-2px" }} /> Hire with
            x402
          </button>
        </>
      ) : (
        <div className="campaign-live">
          <div className="campaign-row">
            <span className="campaign-label">Target</span>
            <span>{campaign?.chatName ?? campaign?.chatId}</span>
          </div>
          <div className="campaign-row">
            <span className="campaign-label">Time left</span>
            <span className="mono big">{fmtCountdown(remaining)}</span>
          </div>
          <div className="campaign-row">
            <span className="campaign-label">Next message</span>
            <span className="mono">
              {nextIn > 0 ? `in ${fmtCountdown(nextIn)}` : "sending…"}
            </span>
          </div>
          <div className="progress">
            <div className="progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <div className="campaign-row">
            <span className="campaign-label">Sent</span>
            <span>
              {campaign?.sent} / {campaign?.maxMessages}
            </span>
          </div>
          <div className="campaign-row" style={{ fontSize: 11 }}>
            <span className="campaign-label">Paid</span>
            <span className="mono">
              {campaign?.receipt.amount} {campaign?.receipt.asset} · tx{" "}
              {midTruncate(campaign?.receipt.txId ?? "", 6, 4)}
            </span>
          </div>
          <button
            className="btn danger sm"
            style={{ marginTop: 10 }}
            onClick={async () => {
              await api.cancelCampaign(rental.id);
              load();
            }}
          >
            Stop campaign
          </button>
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Hire modal (x402 payment) ----------------------------- */
type PayStep = "idle" | "connecting" | "signing" | "broadcasting" | "confirmed";

function HireModal({
  rental,
  persona,
  onClose,
  onStarted,
}: {
  rental: Rental;
  persona: AgentPersona;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [step, setStep] = React.useState<"config" | "pay" | "done">("config");
  const [contacts, setContacts] = React.useState<Contact[]>([]);
  const [chatId, setChatId] = React.useState("");
  const [durationMin, setDurationMin] = React.useState(60);
  const [intervalSec, setIntervalSec] = React.useState(300);

  const [requirements, setRequirements] =
    React.useState<PaymentRequirements | null>(null);
  const [httpStatus, setHttpStatus] = React.useState<number | null>(null);
  const [wallet, setWallet] = React.useState<string | null>(null);
  const [payStep, setPayStep] = React.useState<PayStep>("idle");
  const [receiptTx, setReceiptTx] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api.contacts(rental.id).then(setContacts).catch(() => {});
  }, [rental.id]);

  const chatName = contacts.find((c) => c.chatId === chatId)?.name;
  const price = requirements ? requirements.amount : clientPrice(durationMin).toFixed(2);
  const estMessages = Math.max(1, Math.floor((durationMin * 60) / intervalSec));

  const reviewPayment = async () => {
    setBusy(true);
    setError(null);
    try {
      const { status, requirements: reqs } = await api.hireQuote(
        rental.id,
        durationMin,
      );
      setHttpStatus(status);
      if (!reqs) throw new Error("No payment requirements returned.");
      setRequirements(reqs);
      setStep("pay");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const connectWallet = async () => {
    setPayStep("connecting");
    await new Promise((r) => setTimeout(r, 900));
    setWallet(fakePeraAddress());
    setPayStep("idle");
  };

  const pay = async () => {
    setError(null);
    try {
      setPayStep("signing");
      await new Promise((r) => setTimeout(r, 1100));
      setPayStep("broadcasting");
      await new Promise((r) => setTimeout(r, 1300));
      const { receipt } = await api.hirePay(rental.id, {
        chatId: chatId.trim(),
        chatName,
        durationMin,
        intervalSec,
        payer: wallet ?? undefined,
      });
      setReceiptTx(receipt.txId);
      setPayStep("confirmed");
      setStep("done");
      onStarted();
    } catch (e) {
      setError((e as Error).message);
      setPayStep("idle");
    }
  };

  const payingNow =
    payStep === "signing" || payStep === "broadcasting";

  return (
    <div className="overlay hire-overlay" onClick={onClose}>
      <div
        className="modal hire-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="emoji">{persona.emoji}</span>
          <div>
            <h3>Hire {persona.name}</h3>
            <p>Pay with Algorand over x402 to run a timed campaign</p>
          </div>
          <button className="x" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="hire-body">
          {/* Step indicator */}
          <div className="steps">
            <span className={step === "config" ? "on" : "done"}>1 · Setup</span>
            <span
              className={
                step === "pay" ? "on" : step === "done" ? "done" : ""
              }
            >
              2 · Pay
            </span>
            <span className={step === "done" ? "on" : ""}>3 · Running</span>
          </div>

          {step === "config" && (
            <>
              <div className="field">
                <label>Target chat</label>
                <select
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                >
                  <option value="">Select a contact…</option>
                  {contacts.map((c) => (
                    <option key={c.chatId} value={c.chatId}>
                      {c.name}
                      {c.username ? ` (@${c.username})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Or enter a chat ID</label>
                <input
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                  placeholder="123456789"
                  inputMode="numeric"
                />
              </div>

              <label className="field-label">Shift length</label>
              <div className="preset-row">
                {HIRE_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    className={`preset ${
                      durationMin === p.durationMin &&
                      intervalSec === p.intervalSec
                        ? "active"
                        : ""
                    }`}
                    onClick={() => {
                      setDurationMin(p.durationMin);
                      setIntervalSec(p.intervalSec);
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="grid2">
                <div className="field">
                  <label>Duration (min)</label>
                  <input
                    type="number"
                    min={1}
                    max={180}
                    value={durationMin}
                    onChange={(e) =>
                      setDurationMin(Number(e.target.value) || 1)
                    }
                  />
                </div>
                <div className="field">
                  <label>Every (seconds)</label>
                  <input
                    type="number"
                    min={5}
                    max={3600}
                    value={intervalSec}
                    onChange={(e) =>
                      setIntervalSec(Number(e.target.value) || 5)
                    }
                  />
                </div>
              </div>

              <div className="quote-line">
                <span>
                  ~{estMessages} messages · {durationMin} min
                </span>
                <span className="price">
                  <Coins size={14} style={{ verticalAlign: "-2px" }} />{" "}
                  {clientPrice(durationMin).toFixed(2)} ALGO
                </span>
              </div>

              <button
                className="btn primary block"
                disabled={busy || !chatId.trim()}
                onClick={reviewPayment}
              >
                {busy ? "Requesting…" : "Review payment"}{" "}
                <ArrowRight size={15} style={{ verticalAlign: "-2px" }} />
              </button>
            </>
          )}

          {step === "pay" && requirements && (
            <>
              <div className="x402-card">
                <div className="x402-top">
                  <span className="status-402">
                    HTTP {httpStatus} Payment Required
                  </span>
                  <span className="net-pill">Algorand</span>
                </div>
                <div className="x402-row">
                  <span>Amount</span>
                  <span className="mono strong">
                    {requirements.amount} {requirements.asset}
                  </span>
                </div>
                <div className="x402-row">
                  <span>Pay to</span>
                  <span className="mono">{midTruncate(requirements.payTo)}</span>
                </div>
                <div className="x402-row">
                  <span>Scheme</span>
                  <span className="mono">
                    {requirements.scheme} · v{requirements.x402Version}
                  </span>
                </div>
                <div className="x402-row">
                  <span>Nonce</span>
                  <span className="mono">{requirements.nonce}</span>
                </div>
                <div className="x402-row muted">
                  <span>Resource</span>
                  <span className="mono">{requirements.resource}</span>
                </div>
              </div>

              {!wallet ? (
                <button
                  className="btn block"
                  disabled={payStep === "connecting"}
                  onClick={connectWallet}
                >
                  {payStep === "connecting" ? (
                    <>
                      <Loader2 className="spin" size={15} /> Connecting…
                    </>
                  ) : (
                    <>
                      <Wallet size={15} style={{ verticalAlign: "-2px" }} />{" "}
                      Connect Pera Wallet
                    </>
                  )}
                </button>
              ) : (
                <>
                  <div className="wallet-row">
                    <Wallet size={14} /> {midTruncate(wallet)}
                    <span className="wallet-bal">balance 142.30 ALGO</span>
                  </div>
                  <button
                    className="btn primary block"
                    disabled={payingNow}
                    onClick={pay}
                  >
                    {payStep === "signing" ? (
                      <>
                        <Loader2 className="spin" size={15} /> Signing in
                        wallet…
                      </>
                    ) : payStep === "broadcasting" ? (
                      <>
                        <Loader2 className="spin" size={15} /> Broadcasting to
                        Algorand…
                      </>
                    ) : (
                      <>
                        Pay {requirements.amount} ALGO
                      </>
                    )}
                  </button>
                </>
              )}
              <button
                className="btn ghost sm block"
                disabled={payingNow}
                onClick={() => setStep("config")}
              >
                Back
              </button>
            </>
          )}

          {step === "done" && (
            <div className="hire-done">
              <CheckCircle2 size={48} className="ok" />
              <h3>Agent hired!</h3>
              <p className="hint">
                Payment settled on Algorand. {persona.name} is now on the clock
                and will message {chatName ?? chatId} every {intervalSec}s for{" "}
                {durationMin} minutes.
              </p>
              {receiptTx && (
                <a
                  className="tx-link mono"
                  href={`https://allo.info/tx/${receiptTx}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  tx {midTruncate(receiptTx, 10, 8)}
                </a>
              )}
              <button className="btn primary block" onClick={onClose}>
                Watch it run
              </button>
            </div>
          )}

          {error && <p className="error-text">{error}</p>}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Configurator ----------------------------- */
function Configurator({
  rental: initial,
  persona,
  botTokenConfigured,
  onClose,
  onChanged,
}: {
  rental: Rental;
  persona: AgentPersona;
  botTokenConfigured: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [rental, setRental] = React.useState<Rental>(initial);
  const [config, setConfig] = React.useState<AgentConfig>(initial.config);
  const [savingActive, setSavingActive] = React.useState(false);
  const [actError, setActError] = React.useState<string | null>(null);
  const [hireOpen, setHireOpen] = React.useState(false);
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced config autosave.
  const patchConfig = (patch: Partial<AgentConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.updateConfig(rental.id, next).then(onChanged).catch(() => {});
    }, 500);
  };

  const setState = (next: Rental) => {
    setRental(next);
    setConfig(next.config);
    onChanged();
  };

  const toggleActive = async (active: boolean) => {
    setSavingActive(true);
    setActError(null);
    try {
      const updated = await api.activate(rental.id, active);
      setRental(updated);
      onChanged();
    } catch (e) {
      setActError((e as Error).message);
    } finally {
      setSavingActive(false);
    }
  };

  const remove = async () => {
    if (!confirm("Delete this rented agent?")) return;
    await api.deleteRental(rental.id);
    onChanged();
    onClose();
  };

  const connected = rental.telegram.status === "connected";

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="emoji">{persona.emoji}</span>
          <div>
            <h3>{persona.name}</h3>
            <p>
              {modeLabel(config.mode)} · {persona.tagline}
            </p>
          </div>
          <button className="x" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {/* Left column: behaviour config */}
          <div>
            <div className="field">
              <label>Bait mode</label>
              <select
                value={config.mode}
                onChange={(e) =>
                  patchConfig({ mode: e.target.value as AgentConfig["mode"] })
                }
              >
                <option value="ragebait">Ragebait, provoke anger</option>
                <option value="joybait">Joybait, spark joy</option>
              </select>
            </div>

            <div className="field">
              <label>Tone</label>
              <input
                value={config.tone}
                onChange={(e) => patchConfig({ tone: e.target.value })}
              />
            </div>

            <div className="field">
              <label>Goal</label>
              <textarea
                value={config.goal}
                onChange={(e) => patchConfig({ goal: e.target.value })}
              />
            </div>

            <div className="field">
              <label>Intensity</label>
              <div className="range-row">
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={config.intensity}
                  onChange={(e) =>
                    patchConfig({ intensity: Number(e.target.value) })
                  }
                />
                <span className="range-val">{config.intensity}</span>
              </div>
            </div>

            <div className="field">
              <label>Max replies / minute</label>
              <div className="range-row">
                <input
                  type="range"
                  min={1}
                  max={30}
                  value={config.maxRepliesPerMin}
                  onChange={(e) =>
                    patchConfig({ maxRepliesPerMin: Number(e.target.value) })
                  }
                />
                <span className="range-val">{config.maxRepliesPerMin}</span>
              </div>
            </div>

            <label className="switch" style={{ marginTop: 4 }}>
              <input
                type="checkbox"
                checked={config.privateOnly}
                onChange={(e) =>
                  patchConfig({ privateOnly: e.target.checked })
                }
              />
              Only reply in private chats
            </label>
          </div>

          {/* Right column: platform + connection + activity */}
          <div>
            <label
              style={{
                fontSize: 12,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--muted)",
              }}
            >
              Platform
            </label>
            <div className="platforms" style={{ marginTop: 6 }}>
              <div className="platform active">Telegram</div>
              <div className="platform disabled">
                X<span className="soon">soon</span>
              </div>
              <div className="platform disabled">
                Email<span className="soon">soon</span>
              </div>
            </div>

            <TelegramBlock
              rental={rental}
              onState={setState}
              botTokenConfigured={botTokenConfigured}
            />

            {connected && (
              <CampaignPanel rental={rental} onHire={() => setHireOpen(true)} />
            )}

            {connected && <SendPanel rental={rental} />}

            <div style={{ marginTop: 16 }}>
              <label
                style={{
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--muted)",
                }}
              >
                Live activity
              </label>
              <div style={{ marginTop: 6 }}>
                <ActivityLog rentalId={rental.id} />
              </div>
            </div>
          </div>
        </div>

        <div className="activate-bar">
          <div className="state">
            <button className="btn danger sm" onClick={remove}>
              <Trash2 size={14} style={{ verticalAlign: "-2px" }} /> Delete
            </button>
            {actError && (
              <span className="error-text" style={{ marginLeft: 12 }}>
                {actError}
              </span>
            )}
          </div>
          <button
            className={`btn primary ${config.mode === "joybait" ? "joy" : ""}`}
            disabled={savingActive || (!connected && !rental.active)}
            onClick={() => toggleActive(!rental.active)}
            title={
              !connected
                ? "Connect Telegram first"
                : rental.active
                  ? "Pause the agent"
                  : "Unleash the agent"
            }
          >
            {rental.active ? (
              <>
                <ZapOff size={15} style={{ verticalAlign: "-2px" }} /> Pause
                agent
              </>
            ) : (
              <>
                <Zap size={15} style={{ verticalAlign: "-2px" }} /> Unleash
                agent
              </>
            )}
          </button>
        </div>
      </div>

      {hireOpen && (
        <HireModal
          rental={rental}
          persona={persona}
          onClose={() => setHireOpen(false)}
          onStarted={onChanged}
        />
      )}
    </div>
  );
}

/* ----------------------------- Rental chip ----------------------------- */
function RentalChip({
  rental,
  persona,
  onOpen,
}: {
  rental: Rental;
  persona: AgentPersona;
  onOpen: () => void;
}) {
  return (
    <div className="rental" onClick={onOpen}>
      <div className="r-head">
        <span className="r-emoji">{persona.emoji}</span>
        <div>
          <div className="r-name">{persona.name}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {modeLabel(rental.config.mode)}
          </div>
        </div>
        <span
          className={`dot ${rental.active ? "on" : "off"}`}
          style={{ marginLeft: "auto" }}
          title={rental.active ? "Active" : "Paused"}
        />
      </div>
      <div className="r-meta">
        <span className="tagchip">
          {rental.telegram.status === "connected"
            ? "Telegram linked"
            : "Not linked"}
        </span>
        <span className="tagchip">intensity {rental.config.intensity}</span>
      </div>
    </div>
  );
}

/* ----------------------------- App ----------------------------- */
function App() {
  const [personas, setPersonas] = React.useState<AgentPersona[]>([]);
  const [rentals, setRentals] = React.useState<Rental[]>([]);
  const [llmOk, setLlmOk] = React.useState<boolean | null>(null);
  const [botTokenConfigured, setBotTokenConfigured] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [renting, setRenting] = React.useState(false);

  const personaById = React.useMemo(() => {
    const m = new Map<string, AgentPersona>();
    personas.forEach((p) => m.set(p.id, p));
    return m;
  }, [personas]);

  const refreshRentals = React.useCallback(async () => {
    setRentals(await api.rentals());
  }, []);

  React.useEffect(() => {
    api.agents().then(setPersonas);
    api.meta().then((m) => {
      setLlmOk(m.llmConfigured);
      setBotTokenConfigured(m.botTokenConfigured);
    });
    refreshRentals();
  }, [refreshRentals]);

  const items: AgentCardItem[] = personas.map((p) => ({
    id: p.id,
    title: p.name,
    persona: p,
  }));

  const activePersona = personas[activeIdx];

  const rentActive = async () => {
    if (!activePersona) return;
    setRenting(true);
    try {
      const rental = await api.createRental(activePersona.id, "telegram");
      await refreshRentals();
      setOpenId(rental.id);
    } finally {
      setRenting(false);
    }
  };

  const openRental = rentals.find((r) => r.id === openId);
  const openPersona = openRental
    ? personaById.get(openRental.personaId)
    : undefined;

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="logo">🪤</div>
          <div>
            <h1>baiter</h1>
            <p>rent an agent. pick your chaos.</p>
          </div>
        </div>
        {llmOk === null ? null : (
          <span className={`pill ${llmOk ? "good" : "warn"}`}>
            {llmOk ? "LLM connected" : "fallback mode (no LLM key)"}
          </span>
        )}
      </div>

      <div className="hero">
        <h2>
          Hire an agent to <span className="rage">ragebait</span> or{" "}
          <span className="joy">joybait</span> anyone
        </h2>
        <p>
          Pick a personality, set its tone and goal, plug in a Telegram bot,
          and let it run. Swipe through the roster below.
        </p>
      </div>

      <div className="stack-wrap">
        {items.length > 0 && (
          <CardStack<AgentCardItem>
            items={items}
            cardWidth={460}
            cardHeight={300}
            onChangeIndex={(i) => setActiveIdx(i)}
            renderCard={(item) => <AgentCard persona={item.persona} />}
          />
        )}
        <div className="stack-cta">
          <button
            className={`btn primary ${
              activePersona?.mode === "joybait" ? "joy" : ""
            }`}
            disabled={renting || !activePersona}
            onClick={rentActive}
          >
            {renting
              ? "Renting…"
              : activePersona
                ? `Rent ${activePersona.name}`
                : "Rent agent"}
          </button>
        </div>
      </div>

      <div className="section-title">
        <h3>Your rented agents</h3>
        <span>{rentals.length} active rental(s)</span>
      </div>
      {rentals.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 14 }}>
          You haven't rented any agents yet. Pick one above to get started.
        </p>
      ) : (
        <div className="rentals">
          {rentals.map((r) => {
            const p = personaById.get(r.personaId);
            if (!p) return null;
            return (
              <RentalChip
                key={r.id}
                rental={r}
                persona={p}
                onOpen={() => setOpenId(r.id)}
              />
            );
          })}
        </div>
      )}

      <p className="disclaimer">
        baiter drives a Telegram bot via the official Bot API. You are
        responsible for how you use it. Don't harass people, and follow
        Telegram's terms of service. Built for fun and experiments.
      </p>

      {openRental && openPersona && (
        <Configurator
          key={openRental.id}
          rental={openRental}
          persona={openPersona}
          botTokenConfigured={botTokenConfigured}
          onClose={() => setOpenId(null)}
          onChanged={refreshRentals}
        />
      )}
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
