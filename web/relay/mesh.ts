// Simulated BLE mesh: bot peers with presence, ambient chatter, and reactions.
// Mirrors the vibe of bitchat's #mesh channel (IRC style, radio flavor).

import type { ChatMessage, Peer } from "./types";
import {
  AMBIENT_LINES,
  HUG_REACTIONS,
  DM_REPLIES,
  MENTION_REPLIES,
  QUESTION_REPLIES,
  SLAP_REACTIONS,
} from "./phrases";

const BOT_NAMES = [
  "satoshi",
  "hal",
  "duffie",
  "gmax",
  "nick",
  "ada",
  "linus",
  "tux",
  "murch",
  "eliz",
];

export type BroadcastFn = (msg: ChatMessage) => void;
export type PeersChangedFn = () => void;

export class MeshSimulator {
  private bots = new Map<
    string,
    { id: string; nickname: string; hops: number; online: boolean; lastSeen: number }
  >();
  private ambientTimer: any = null;
  private churnTimer: any = null;
  private broadcast: BroadcastFn | null = null;
  private onPeersChanged: PeersChangedFn | null = null;

  constructor() {
    for (const name of BOT_NAMES) {
      this.bots.set(`bot:${name}`, {
        id: `bot:${name}`,
        nickname: name,
        hops: 1 + Math.floor(Math.random() * 3),
        online: false,
        lastSeen: Date.now(),
      });
    }
    // start with a few online
    const initial = [...this.bots.values()].sort(() => Math.random() - 0.5).slice(0, 5);
    for (const b of initial) b.online = true;
  }

  start(broadcast: BroadcastFn, onPeersChanged: PeersChangedFn) {
    this.broadcast = broadcast;
    this.onPeersChanged = onPeersChanged;

    this.ambientTimer = setInterval(() => this.ambientChatter(), 18_000);
    this.churnTimer = setInterval(() => this.churn(), 45_000);
  }

  stop() {
    if (this.ambientTimer) clearInterval(this.ambientTimer);
    if (this.churnTimer) clearInterval(this.churnTimer);
  }

  private msg(nickname: string, content: string, kind: ChatMessage["kind"] = "chat"): ChatMessage {
    return {
      id: `bot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      channel: "mesh",
      kind,
      senderId: `bot:${nickname}`,
      nickname,
      content,
      ts: Date.now(),
      origin: "mesh",
      hops: this.bots.get(`bot:${nickname}`)?.hops ?? 1,
    };
  }

  sys(content: string): ChatMessage {
    return {
      id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      channel: "mesh",
      kind: "system",
      senderId: "system",
      nickname: "",
      content,
      ts: Date.now(),
      origin: "mesh",
    };
  }

  private onlineBots() {
    return [...this.bots.values()].filter((b) => b.online);
  }

  peers(): Peer[] {
    return this.onlineBots().map((b) => ({
      id: b.id,
      nickname: b.nickname,
      origin: "mesh" as const,
      hops: b.hops,
      lastSeen: Date.now(),
    }));
  }

  botByNickname(nick: string) {
    const n = nick.toLowerCase().replace(/^@/, "");
    return this.bots.get(`bot:${n}`);
  }

  isBotOnline(id: string): boolean {
    const b = this.bots.get(id);
    return !!b && b.online;
  }

  hopCount(nickname: string): number {
    return this.bots.get(`bot:${nickname}`)?.hops ?? 1;
  }

  private ambientChatter() {
    const bots = this.onlineBots();
    if (!bots.length || !this.broadcast) return;
    if (Math.random() < 0.55) return;
    const bot = bots[Math.floor(Math.random() * bots.length)];
    const line = AMBIENT_LINES[Math.floor(Math.random() * AMBIENT_LINES.length)];
    this.broadcast(this.msg(bot.nickname, line));
  }

  private churn() {
    if (!this.broadcast) return;
    const offline = [...this.bots.values()].filter((b) => !b.online);
    const online = this.onlineBots();
    if (offline.length && (online.length < 4 || Math.random() < 0.4)) {
      const bot = offline[Math.floor(Math.random() * offline.length)];
      bot.online = true;
      bot.hops = 1 + Math.floor(Math.random() * 3);
      this.broadcast(this.sys(`— ${bot.nickname} joined the mesh (${bot.hops} hop${bot.hops > 1 ? "s" : ""})`));
      this.onPeersChanged?.();
    } else if (online.length > 3 && Math.random() < 0.5) {
      const bot = online[Math.floor(Math.random() * online.length)];
      bot.online = false;
      this.broadcast(this.sys(`— ${bot.nickname} went out of range`));
      this.onPeersChanged?.();
    }
  }

  /** React to a user message in #mesh (or a group). */
  reactToMessage(senderNickname: string, content: string) {
    if (!this.broadcast) return;
    const lower = content.toLowerCase();
    const mention = this.onlineBots().find((b) =>
      lower.includes(`@${b.nickname}`) || new RegExp(`\\b${b.nickname}\\b`, "i").test(content)
    );
    if (mention) {
      if (Math.random() < 0.85) {
        setTimeout(() => {
          if (!this.isBotOnline(mention.id) || !this.broadcast) return;
          const reply = MENTION_REPLIES[Math.floor(Math.random() * MENTION_REPLIES.length)];
          this.broadcast(this.msg(mention.nickname, reply));
        }, 800 + Math.random() * 2500);
      }
      return;
    }
    if (content.trim().endsWith("?") && Math.random() < 0.4) {
      const bots = this.onlineBots();
      const bot = bots[Math.floor(Math.random() * bots.length)];
      if (!bot) return;
      setTimeout(() => {
        if (!this.isBotOnline(bot.id) || !this.broadcast) return;
        const reply = QUESTION_REPLIES[Math.floor(Math.random() * QUESTION_REPLIES.length)];
        this.broadcast(this.msg(bot.nickname, reply));
      }, 1200 + Math.random() * 3000);
    }
  }

  reactToSlap(botId: string, byNickname: string) {
    if (!this.broadcast) return;
    const bot = this.bots.get(botId);
    if (!bot || !bot.online) return;
    const line = SLAP_REACTIONS[Math.floor(Math.random() * SLAP_REACTIONS.length)];
    setTimeout(() => {
      if (!this.isBotOnline(bot.id) || !this.broadcast) return;
      this.broadcast(this.msg(bot.nickname, line));
    }, 700 + Math.random() * 1800);
  }

  reactToHug(botId: string) {
    if (!this.broadcast) return;
    const bot = this.bots.get(botId);
    if (!bot || !bot.online) return;
    const line = HUG_REACTIONS[Math.floor(Math.random() * HUG_REACTIONS.length)];
    setTimeout(() => {
      if (!this.isBotOnline(bot.id) || !this.broadcast) return;
      this.broadcast(this.msg(bot.nickname, line));
    }, 600 + Math.random() * 1500);
  }

  replyToDm(botId: string, dmChannel: string): ChatMessage | null {
    const bot = this.bots.get(botId);
    if (!bot || !bot.online) return null;
    const line = DM_REPLIES[Math.floor(Math.random() * DM_REPLIES.length)];
    return {
      id: `botdm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      channel: dmChannel,
      kind: "chat",
      senderId: bot.id,
      nickname: bot.nickname,
      content: line,
      ts: Date.now(),
      origin: "mesh",
    };
  }

  /** A bot joins a group chat and occasionally talks there. */
  groupChatter(groupChan: string): ChatMessage | null {
    const bots = this.onlineBots();
    if (!bots.length) return null;
    if (Math.random() < 0.5) return null;
    const bot = bots[Math.floor(Math.random() * bots.length)];
    const line = AMBIENT_LINES[Math.floor(Math.random() * AMBIENT_LINES.length)];
    return {
      id: `botgrp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      channel: groupChan,
      kind: "chat",
      senderId: bot.id,
      nickname: bot.nickname,
      content: line,
      ts: Date.now(),
      origin: "mesh",
      hops: bot.hops,
    };
  }
}
