// A room: who is in it, the lobby, the running game, bots and timers. It only knows the time it
// is told, so it runs the same inside a Cloudflare Durable Object (online) and in the browser
// (solo). The whole state is one plain object that can be stored as JSON.
import { Action, Card, Ev, Game, Suit, apply, newGame, playable } from "./game";
import { botMove } from "./bot";

export const MAX_PLAYERS = 6;
export const TURN_MS = 30000;
/** A room without any player online is closed after this long. */
export const IDLE_MS = 5 * 60000;
const BOT_NAMES = ["Volt", "Pixel", "Nova", "Zap", "Echo", "Blip", "Fuse", "Orbit"];

export interface Member {
  /** The player's secret id (never sent to others). Bots: "bot:N". */
  pid: string;
  name: string;
  bot: boolean;
  on: boolean;
  wins: number;
  /** A person who left during a game: a bot finishes it for them, then they are removed. */
  gone?: boolean;
}

export interface RoomState {
  code: string;
  members: Member[];
  host: string;
  phase: "lobby" | "play" | "over";
  game: Game | null;
  /** pid of each player of the running game, in seat order. */
  seats: string[];
  round: number;
  result: { winner: number; points: number } | null;
  /** When the bot (or the stand-in for someone away) moves next. */
  actAt: number;
  /** When the current player's time is up. */
  deadline: number;
  tkey: string;
  idleSince: number;
  botSeq: number;
}

export type ClientMsg =
  | { t: "bot" }
  | { t: "kick"; i: number }
  | { t: "start" }
  | { t: "lobby" }
  | { t: "act"; a: Action }
  | { t: "leave" };

export interface GameView {
  /** For each seat: which member sits there and what everyone may know. */
  players: { m: number; count: number; energy: number; shield: boolean }[];
  /** Your seat, or -1 when you only watch. */
  me: number;
  hand: Card[];
  playable: number[];
  top: Card;
  suit: Suit;
  dir: 1 | -1;
  turn: number;
  pending: number;
  lock: Suit | null;
  deck: number;
  drew: boolean;
  bonus: boolean;
  overdrive: boolean;
  deadline: number;
  winner: number;
  /** After the game: what everybody was left with. */
  hands?: Card[][];
}

export interface View {
  code: string;
  phase: RoomState["phase"];
  you: number;
  host: number;
  members: { name: string; bot: boolean; on: boolean; wins: number; playing: boolean }[];
  round: number;
  game: GameView | null;
  result: RoomState["result"];
  ev: Ev[];
  now: number;
}

export function cleanName(name: unknown): string {
  const s = String(name ?? "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
  return s || "Player";
}

export function newRoom(code: string, now: number): RoomState {
  return {
    code, members: [], host: "", phase: "lobby", game: null, seats: [], round: 0, result: null,
    actAt: 0, deadline: 0, tkey: "", idleSince: now, botSeq: 0,
  };
}

export class RoomCore {
  /** What happened since the last flush (sent along with the next views). */
  ev: Ev[] = [];
  constructor(public s: RoomState) {}

  private member(pid: string) { return this.s.members.find((m) => m.pid === pid); }
  private humans() { return this.s.members.filter((m) => !m.bot && !m.gone); }

  /** A player comes in (or comes back). */
  join(pid: string, name: string, now: number): string | null {
    const s = this.s;
    let m = this.member(pid);
    if (m && m.gone) { m.gone = false; m.bot = false; }
    if (!m) {
      if (s.members.length >= MAX_PLAYERS) {
        // A person takes a bot's place, in the lobby only.
        const i = s.phase === "play" ? -1 : s.members.findIndex((x) => x.bot && !x.gone);
        if (i < 0) return "full";
        s.members.splice(i, 1);
      }
      m = { pid, name: cleanName(name), bot: false, on: true, wins: 0 };
      s.members.push(m);
    }
    m.on = true;
    m.name = cleanName(name);
    if (!this.member(s.host) || this.member(s.host)!.bot) s.host = pid;
    this.schedule(now);
    return null;
  }

  setOn(pid: string, on: boolean, now: number) {
    const m = this.member(pid);
    if (!m) return;
    m.on = on;
    if (!this.humans().some((x) => x.on)) this.s.idleSince = now;
    this.pickHost();
    this.schedule(now, true);
  }

  private pickHost() {
    const s = this.s;
    const h = this.member(s.host);
    if (h && !h.bot && !h.gone && h.on) return;
    const next = this.humans().find((m) => m.on) ?? this.humans()[0];
    if (next) s.host = next.pid;
  }

  private remove(pid: string) {
    const s = this.s;
    const m = this.member(pid);
    if (!m) return;
    if (s.phase === "play" && s.seats.includes(pid)) {
      // The game goes on: a bot plays their cards.
      m.gone = true; m.bot = true; m.on = false;
    } else s.members = s.members.filter((x) => x !== m);
    this.pickHost();
  }

  /** Nobody is here any more (or hasn't been for a while): the room can be deleted. */
  dead(now: number): boolean {
    const h = this.humans();
    return !h.length || (!h.some((m) => m.on) && now - this.s.idleSince >= IDLE_MS);
  }

  handle(pid: string, msg: ClientMsg, now: number): string | null {
    const s = this.s;
    const m = this.member(pid);
    if (!m || !msg || typeof msg !== "object") return "bad";
    const host = s.host === pid;
    switch (msg.t) {
      case "bot":
        if (!host || s.phase === "play") return "not_allowed";
        if (s.members.length >= MAX_PLAYERS) return "full";
        s.members.push({ pid: `bot:${++s.botSeq}`, name: this.botName(), bot: true, on: true, wins: 0 });
        return null;
      case "kick": {
        if (!host || s.phase === "play") return "not_allowed";
        const k = s.members[msg.i];
        if (!k || k.pid === pid) return "bad";
        s.members.splice(msg.i, 1);
        return null;
      }
      case "start":
        if (!host || s.phase === "play") return "not_allowed";
        if (s.members.length < 2) return "need_players";
        this.start(now);
        return null;
      case "lobby":
        if (!host || s.phase !== "over") return "not_allowed";
        s.phase = "lobby"; s.game = null; s.seats = []; s.result = null;
        s.members = s.members.filter((x) => !x.gone);
        return null;
      case "leave":
        this.remove(pid);
        this.schedule(now, true);
        return null;
      case "act": {
        if (s.phase !== "play" || !s.game) return "no_game";
        const seat = s.seats.indexOf(pid);
        if (seat < 0) return "not_playing";
        const err = this.act(seat, msg.a, now);
        return err;
      }
    }
    return "bad";
  }

  private botName(): string {
    const used = new Set(this.s.members.map((m) => m.name));
    const free = BOT_NAMES.filter((n) => !used.has(n));
    return free.length ? free[Math.floor(Math.random() * free.length)] : `Bot ${this.s.botSeq}`;
  }

  private start(now: number) {
    const s = this.s;
    s.members = s.members.filter((m) => !m.gone);
    s.seats = s.members.map((m) => m.pid);
    s.game = newGame(s.seats.length, Math.floor(Math.random() * 2 ** 31));
    s.phase = "play";
    s.result = null;
    s.round++;
    s.tkey = "";
    this.ev = [];
    this.schedule(now);
  }

  private act(seat: number, a: Action, now: number): string | null {
    const s = this.s, g = s.game!;
    const r = apply(g, seat, a);
    if (!r.ok) return r.err;
    this.ev.push(...r.ev);
    if (g.winner >= 0) {
      const w = this.member(s.seats[g.winner]);
      if (w) w.wins++;
      s.phase = "over";
      s.result = { winner: g.winner, points: r.ev.find((e) => e.t === "win")?.n ?? 0 };
      this.pickHost();
    }
    this.schedule(now);
    return null;
  }

  /** The current seat is played by the computer (a bot, or a person who is away). */
  private auto(): boolean {
    const s = this.s;
    if (s.phase !== "play" || !s.game) return false;
    const m = this.member(s.seats[s.game.turn]);
    return !m || m.bot || !m.on;
  }

  private schedule(now: number, onlineChanged = false) {
    const s = this.s, g = s.game;
    if (s.phase !== "play" || !g) { s.actAt = 0; s.deadline = 0; return; }
    const key = `${s.round}:${g.turnNo}:${g.bonus ? 1 : 0}`;
    if (key !== s.tkey) {
      s.tkey = key;
      s.deadline = now + TURN_MS;
      s.actAt = now + 900 + Math.floor(Math.random() * 800);
    } else if (!onlineChanged) s.actAt = now + 650 + Math.floor(Math.random() * 400);
    else if (s.actAt < now) s.actAt = now + 1200;
  }

  /** When tick() has to be called next, or 0. */
  wake(now: number): number {
    const s = this.s;
    let t = 0;
    if (s.phase === "play") t = this.auto() ? s.actAt : s.deadline;
    if (!this.humans().some((m) => m.on)) {
      const idle = s.idleSince + IDLE_MS;
      t = t ? Math.min(t, idle) : idle;
    }
    return t ? Math.max(t, now + 1) : 0;
  }

  /** Lets time pass: bots move, slow players are moved for. */
  tick(now: number) {
    const s = this.s;
    if (s.phase !== "play" || !s.game) return;
    // With nobody watching, the game waits (and the room closes after a while).
    if (!this.humans().some((m) => m.on)) return;
    const g = s.game;
    if (this.auto()) {
      if (now < s.actAt) return;
      this.botAct(g.turn, true, now);
    } else if (now >= s.deadline) {
      // Time is up: draw or play something, until the turn has moved on.
      const turn = s.tkey;
      for (let i = 0; i < 4 && s.phase === "play" && s.tkey === turn; i++) this.botAct(g.turn, false, now);
    }
  }

  private botAct(seat: number, powers: boolean, now: number) {
    const g = this.s.game!;
    if (this.act(seat, botMove(g, seat, powers), now) !== null) {
      // Should never happen; keep the game moving anyway.
      if (this.act(seat, { t: "draw" }, now) !== null) this.act(seat, { t: "pass" }, now);
    }
  }

  /** Takes the events collected since the last call. */
  flush(): Ev[] {
    const ev = this.ev;
    this.ev = [];
    return ev;
  }

  view(pid: string, ev: Ev[], now: number): View {
    const s = this.s, g = s.game;
    let game: GameView | null = null;
    if (g) {
      const me = s.seats.indexOf(pid);
      game = {
        players: g.players.map((p, i) => ({
          m: s.members.findIndex((m) => m.pid === s.seats[i]),
          count: p.hand.length, energy: p.energy, shield: p.shield,
        })),
        me,
        hand: me >= 0 ? g.players[me].hand : [],
        playable: me >= 0 ? playable(g, me) : [],
        top: g.pile[g.pile.length - 1],
        suit: g.suit, dir: g.dir, turn: g.turn, pending: g.pending,
        lock: g.lock ? g.lock.suit : null,
        deck: g.deck.length, drew: g.drew, bonus: g.bonus, overdrive: g.overdrive,
        deadline: s.deadline, winner: g.winner,
      };
      if (g.winner >= 0) game.hands = g.players.map((p) => p.hand);
    }
    return {
      code: s.code, phase: s.phase,
      you: s.members.findIndex((m) => m.pid === pid),
      host: s.members.findIndex((m) => m.pid === s.host),
      members: s.members.map((m) => ({ name: m.name, bot: m.bot, on: m.on, wins: m.wins, playing: s.seats.includes(m.pid) })),
      round: s.round, game, result: s.result, ev, now,
    };
  }
}
