// Message history: sqlite-backed ring buffers per channel (survives restarts)

import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { join } from "path";
import type { ChatMessage } from "./types";

const DATA_DIR = join(import.meta.dir, "data");
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, "bitchat.db"));
db.exec("PRAGMA journal_mode=WAL;");
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    kind TEXT NOT NULL,
    senderId TEXT NOT NULL,
    nickname TEXT NOT NULL,
    content TEXT NOT NULL,
    ts INTEGER NOT NULL,
    origin TEXT,
    hops INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_messages_channel_ts ON messages(channel, ts);
`);

const insert = db.prepare(
  `INSERT OR IGNORE INTO messages (id, channel, kind, senderId, nickname, content, ts, origin, hops)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const selectRecent = db.prepare(
  `SELECT id, channel, kind, senderId, nickname, content, ts, origin, hops
   FROM messages WHERE channel = ? ORDER BY ts DESC LIMIT ?`
);
const purgeOld = db.prepare(`DELETE FROM messages WHERE ts < ?`);
const trimChannel = db.prepare(
  `DELETE FROM messages WHERE channel = ? AND id NOT IN (
     SELECT id FROM messages WHERE channel = ? ORDER BY ts DESC LIMIT 800
   )`
);

export function saveMessage(m: ChatMessage) {
  try {
    insert.run(
      m.id,
      m.channel,
      m.kind,
      m.senderId,
      m.nickname,
      m.content.slice(0, 2000),
      m.ts,
      m.origin ?? null,
      m.hops ?? null
    );
  } catch {
    /* duplicate id — fine */
  }
}

export function history(channel: string, limit = 60): ChatMessage[] {
  try {
    const rows = selectRecent.all(channel, limit) as any[];
    return rows
      .map((r) => ({
        id: r.id,
        channel: r.channel,
        kind: r.kind as ChatMessage["kind"],
        senderId: r.senderId,
        nickname: r.nickname,
        content: r.content,
        ts: r.ts,
        origin: (r.origin ?? undefined) as ChatMessage["origin"],
        hops: r.hops ?? undefined,
      }))
      .reverse();
  } catch {
    return [];
  }
}

export function startupPurge() {
  try {
    purgeOld.run(Date.now() - 24 * 60 * 60 * 1000);
  } catch {}
}

export function trim(channel: string) {
  try {
    trimChannel.run(channel, channel);
  } catch {}
}
