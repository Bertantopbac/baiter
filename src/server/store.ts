import { Database } from "bun:sqlite";
import type {
  ActivityEvent,
  AgentConfig,
  Contact,
  Platform,
  Rental,
  TelegramState,
} from "../shared/types";

const db = new Database("baiter.sqlite", { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec(`
  CREATE TABLE IF NOT EXISTS rentals (
    id TEXT PRIMARY KEY,
    personaId TEXT NOT NULL,
    platform TEXT NOT NULL,
    config TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL,
    telegramBotToken TEXT,
    telegramState TEXT NOT NULL
  );
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    rentalId TEXT NOT NULL,
    chatId TEXT NOT NULL,
    name TEXT NOT NULL,
    username TEXT,
    lastSeen INTEGER NOT NULL,
    PRIMARY KEY (rentalId, chatId)
  );
`);

// Lightweight migration: add the bot-token column if an older DB lacks it.
try {
  db.exec(`ALTER TABLE rentals ADD COLUMN telegramBotToken TEXT`);
} catch {
  /* column already exists */
}

interface RentalRow {
  id: string;
  personaId: string;
  platform: string;
  config: string;
  active: number;
  createdAt: number;
  telegramState: string;
}

function rowToRental(row: RentalRow): Rental {
  return {
    id: row.id,
    personaId: row.personaId,
    platform: row.platform as Platform,
    config: JSON.parse(row.config) as AgentConfig,
    active: Boolean(row.active),
    createdAt: row.createdAt,
    telegram: JSON.parse(row.telegramState) as TelegramState,
  };
}

export function createRental(rental: Rental): void {
  db.query(
    `INSERT INTO rentals (id, personaId, platform, config, active, createdAt, telegramBotToken, telegramState)
     VALUES ($id, $personaId, $platform, $config, $active, $createdAt, NULL, $telegramState)`,
  ).run({
    $id: rental.id,
    $personaId: rental.personaId,
    $platform: rental.platform,
    $config: JSON.stringify(rental.config),
    $active: rental.active ? 1 : 0,
    $createdAt: rental.createdAt,
    $telegramState: JSON.stringify(rental.telegram),
  });
}

export function listRentals(): Rental[] {
  const rows = db
    .query(`SELECT * FROM rentals ORDER BY createdAt DESC`)
    .all() as RentalRow[];
  return rows.map(rowToRental);
}

export function getRental(id: string): Rental | undefined {
  const row = db
    .query(`SELECT * FROM rentals WHERE id = $id`)
    .get({ $id: id }) as RentalRow | null;
  return row ? rowToRental(row) : undefined;
}

export function updateConfig(id: string, config: AgentConfig): void {
  db.query(`UPDATE rentals SET config = $config WHERE id = $id`).run({
    $id: id,
    $config: JSON.stringify(config),
  });
}

export function updateActive(id: string, active: boolean): void {
  db.query(`UPDATE rentals SET active = $active WHERE id = $id`).run({
    $id: id,
    $active: active ? 1 : 0,
  });
}

export function updateTelegramState(id: string, state: TelegramState): void {
  db.query(`UPDATE rentals SET telegramState = $state WHERE id = $id`).run({
    $id: id,
    $state: JSON.stringify(state),
  });
}

export function saveBotToken(id: string, token: string): void {
  db.query(`UPDATE rentals SET telegramBotToken = $t WHERE id = $id`).run({
    $id: id,
    $t: token,
  });
}

export function getBotToken(id: string): string | undefined {
  const row = db
    .query(`SELECT telegramBotToken FROM rentals WHERE id = $id`)
    .get({ $id: id }) as { telegramBotToken: string | null } | null;
  return row?.telegramBotToken ?? undefined;
}

export function deleteRental(id: string): void {
  db.query(`DELETE FROM rentals WHERE id = $id`).run({ $id: id });
  db.query(`DELETE FROM contacts WHERE rentalId = $id`).run({ $id: id });
}

// --- Contacts (chats that have messaged the bot) ---
export function upsertContact(rentalId: string, contact: Contact): void {
  db.query(
    `INSERT INTO contacts (rentalId, chatId, name, username, lastSeen)
     VALUES ($r, $c, $n, $u, $l)
     ON CONFLICT(rentalId, chatId) DO UPDATE SET
       name = excluded.name,
       username = excluded.username,
       lastSeen = excluded.lastSeen`,
  ).run({
    $r: rentalId,
    $c: contact.chatId,
    $n: contact.name,
    $u: contact.username ?? null,
    $l: contact.lastSeen,
  });
}

export function listContacts(rentalId: string): Contact[] {
  const rows = db
    .query(
      `SELECT chatId, name, username, lastSeen FROM contacts WHERE rentalId = $r ORDER BY lastSeen DESC`,
    )
    .all({ $r: rentalId }) as Array<{
    chatId: string;
    name: string;
    username: string | null;
    lastSeen: number;
  }>;
  return rows.map((r) => ({
    chatId: r.chatId,
    name: r.name,
    username: r.username ?? undefined,
    lastSeen: r.lastSeen,
  }));
}

// --- In-memory activity log (per rental ring buffer) ---
const MAX_EVENTS = 200;
const activityLog = new Map<string, ActivityEvent[]>();

export function pushActivity(event: ActivityEvent): void {
  const list = activityLog.get(event.rentalId) ?? [];
  list.push(event);
  if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS);
  activityLog.set(event.rentalId, list);
}

export function getActivity(rentalId: string): ActivityEvent[] {
  return activityLog.get(rentalId) ?? [];
}
