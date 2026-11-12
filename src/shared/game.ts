// The rules of Dos. Pure functions on a plain object, so the same code runs in the online
// room (Cloudflare) and in the browser (solo against bots).

export const SUITS = ["ember", "tide", "moss", "dusk"] as const;
export type Suit = (typeof SUITS)[number];
export type Kind = "num" | "stun" | "flip" | "spike" | "prism" | "lock" | "swap" | "gift" | "dice";
/** s is null for chaos cards (they have no suit); n is 1-9 for number cards, else 0. */
export interface Card { id: number; k: Kind; s: Suit | null; n: number }
export interface PlayerState { hand: Card[]; energy: number; shield: boolean }
export type DiceFx = "rotate" | "storm" | "backfire" | "jackpot";

export interface Game {
  players: PlayerState[];
  deck: Card[];
  /** The discard pile, top card last. */
  pile: Card[];
  suit: Suit;
  turn: number;
  dir: 1 | -1;
  /** Cards the next player must draw (stacked spikes). */
  pending: number;
  /** Who played the last spike of the stack. */
  spiker: number;
  /** Only this suit can be played until its owner's next turn. */
  lock: { suit: Suit; owner: number } | null;
  /** The current player has drawn this turn (they may still play or pass). */
  drew: boolean;
  /** The current player is on their second turn in a row (overdrive). */
  bonus: boolean;
  /** Overdrive is armed: after the next card, the same player goes again. */
  overdrive: boolean;
  /** How many players the next change of turn jumps over. */
  skip: number;
  winner: number;
  turnNo: number;
  rng: number;
}

export type Power = "shield" | "recycle" | "overdrive";
export type Action =
  | { t: "play"; id: number; suit?: Suit; target?: number; give?: number }
  | { t: "draw" }
  | { t: "pass" }
  | { t: "power"; p: Power; id?: number };

/** What happened, for the players' screens. p = who did it, q = who it hit. */
export interface Ev {
  t: "play" | "draw" | "hit" | "pass" | "stunned" | "block" | "flip" | "suit" | "lock" | "unlock" | "swap"
    | "gift" | "dice" | "spark" | "again" | "power" | "win" | "reshuffle";
  p?: number;
  q?: number;
  n?: number;
  card?: Card;
  suit?: Suit;
  fx?: DiceFx;
  power?: Power;
  bonus?: boolean;
}

export const HAND_SIZE = 7;
export const MAX_ENERGY = 6;
export const COST: Record<Power, number> = { recycle: 1, shield: 2, overdrive: 3 };
export const WILD: Kind[] = ["prism", "lock", "swap", "gift", "dice"];

function rand(g: { rng: number }): number {
  // mulberry32
  let t = (g.rng = (g.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffle<T>(g: { rng: number }, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(g) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildDeck(): Card[] {
  const out: Card[] = [];
  let id = 1;
  const add = (k: Kind, s: Suit | null, n = 0) => out.push({ id: id++, k, s, n });
  for (const s of SUITS) {
    for (let n = 1; n <= 9; n++) { add("num", s, n); add("num", s, n); }
    for (const k of ["stun", "flip", "spike"] as Kind[]) { add(k, s); add(k, s); }
  }
  const wilds: [Kind, number][] = [["prism", 4], ["lock", 3], ["swap", 2], ["gift", 3], ["dice", 4]];
  for (const [k, count] of wilds) for (let i = 0; i < count; i++) add(k, null);
  return out;
}

export function newGame(players: number, seed: number): Game {
  const g: Game = {
    players: [], deck: [], pile: [], suit: "ember", turn: 0, dir: 1, pending: 0, spiker: -1, lock: null,
    drew: false, bonus: false, overdrive: false, skip: 0, winner: -1, turnNo: 0, rng: seed | 0,
  };
  g.deck = shuffle(g, buildDeck());
  for (let p = 0; p < players; p++) g.players.push({ hand: g.deck.splice(-HAND_SIZE), energy: 0, shield: false });
  // The first card on the pile is always a plain number.
  const i = g.deck.map((c) => c.k).lastIndexOf("num");
  const [top] = g.deck.splice(i, 1);
  g.pile.push(top);
  g.suit = top.s!;
  g.turn = Math.floor(rand(g) * players);
  return g;
}

export function top(g: Game): Card { return g.pile[g.pile.length - 1]; }
export function isWild(c: Card): boolean { return c.s === null; }
/** The player `steps` seats after `from` in the direction of play. */
export function seatAfter(g: Game, from: number, steps = 1): number {
  const n = g.players.length;
  return (((from + g.dir * steps) % n) + n) % n;
}
/** The current player has to answer a spike (play their own or draw the stack). */
export function underSpike(g: Game): boolean { return g.pending > 0 && !g.bonus; }

export function canPlay(g: Game, c: Card): boolean {
  if (underSpike(g)) return c.k === "spike";
  if (c.s === null) return true;
  if (g.lock) return c.s === g.lock.suit;
  const t = top(g);
  return c.s === g.suit || (t.s !== null && t.k === c.k && (c.k !== "num" || c.n === t.n));
}

export function playable(g: Game, p: number): number[] {
  if (g.winner >= 0 || g.turn !== p) return [];
  return g.players[p].hand.filter((c) => canPlay(g, c)).map((c) => c.id);
}

export function cardPoints(c: Card): number {
  return c.k === "num" ? c.n : c.s === null ? 20 : 10;
}
/** The winner's points: everything the others still hold. */
export function score(g: Game): number {
  let sum = 0;
  g.players.forEach((pl, i) => { if (i !== g.winner) for (const c of pl.hand) sum += cardPoints(c); });
  return sum;
}

function refill(g: Game, ev: Ev[]) {
  if (g.pile.length < 2) return;
  const t = g.pile.pop()!;
  g.deck = shuffle(g, g.pile);
  g.pile = [t];
  ev.push({ t: "reshuffle" });
}

function drawCards(g: Game, p: number, n: number, ev: Ev[], hit = false): number {
  let got = 0;
  for (let i = 0; i < n; i++) {
    if (!g.deck.length) refill(g, ev);
    if (!g.deck.length) break;
    g.players[p].hand.push(g.deck.pop()!);
    got++;
  }
  if (got || hit) ev.push({ t: hit ? "hit" : "draw", p, n: got });
  return got;
}

function gain(g: Game, p: number, n: number) {
  g.players[p].energy = Math.min(MAX_ENERGY, g.players[p].energy + n);
}

/** Uses up the shield of `q`, if they have one. */
function blocked(g: Game, q: number, ev: Ev[]): boolean {
  if (!g.players[q].shield) return false;
  g.players[q].shield = false;
  ev.push({ t: "block", p: q });
  return true;
}

function advance(g: Game, ev: Ev[]) {
  g.bonus = false;
  g.overdrive = false;
  g.drew = false;
  let t = seatAfter(g, g.turn);
  while (g.skip > 0) {
    g.skip--;
    if (blocked(g, t, ev)) { g.skip = 0; break; }
    ev.push({ t: "stunned", p: t });
    if (g.lock && g.lock.owner === t) { g.lock = null; ev.push({ t: "unlock" }); }
    t = seatAfter(g, t);
  }
  g.turn = t;
  g.turnNo++;
  if (g.lock && g.lock.owner === t) { g.lock = null; ev.push({ t: "unlock" }); }
}

function afterPlay(g: Game, p: number, ev: Ev[]) {
  if (g.overdrive) {
    g.overdrive = false;
    g.bonus = true;
    g.drew = false;
    ev.push({ t: "again", p });
  } else advance(g, ev);
}

function win(g: Game, p: number, ev: Ev[]) {
  g.winner = p;
  ev.push({ t: "win", p, n: score(g), bonus: g.bonus });
}

const DICE: [DiceFx, number][] = [["rotate", 25], ["storm", 35], ["backfire", 20], ["jackpot", 20]];

function rollDice(g: Game, p: number, ev: Ev[]) {
  let r = rand(g) * 100;
  let fx: DiceFx = "storm";
  for (const [f, w] of DICE) { if (r < w) { fx = f; break; } r -= w; }
  ev.push({ t: "dice", p, fx });
  if (fx === "rotate") {
    // Every hand moves one seat on, in the direction of play.
    const n = g.players.length;
    const hands = g.players.map((pl) => pl.hand);
    for (let i = 0; i < n; i++) g.players[seatAfter(g, i)].hand = hands[i];
  } else if (fx === "storm") {
    for (let i = 1; i < g.players.length; i++) drawCards(g, seatAfter(g, p, i), 1, ev);
  } else if (fx === "backfire") {
    drawCards(g, p, 2, ev);
  } else gain(g, p, 3);
}

export type Result = { ok: true; ev: Ev[] } | { ok: false; err: string };
const no = (err: string): Result => ({ ok: false, err });

/** Does what player `p` asks for, if the rules allow it. Changes `g`. */
export function apply(g: Game, p: number, a: Action): Result {
  if (g.winner >= 0) return no("over");
  if (g.turn !== p) return no("not_your_turn");
  const me = g.players[p];
  const ev: Ev[] = [];
  const others = g.players.length;

  if (a.t === "draw") {
    if (underSpike(g)) {
      if (blocked(g, p, ev)) { g.pending = 0; return { ok: true, ev }; }
      drawCards(g, p, g.pending, ev, true);
      ev[ev.length - 1].q = g.spiker;
      g.pending = 0;
      advance(g, ev);
      return { ok: true, ev };
    }
    if (g.drew) return no("already_drew");
    drawCards(g, p, 1, ev);
    g.drew = true;
    if (!playable(g, p).length) { ev.push({ t: "pass", p }); advance(g, ev); }
    return { ok: true, ev };
  }

  if (a.t === "pass") {
    if (!g.drew) return no("draw_first");
    ev.push({ t: "pass", p });
    advance(g, ev);
    return { ok: true, ev };
  }

  if (a.t === "power") {
    const cost = COST[a.p];
    if (!cost) return no("bad_power");
    if (me.energy < cost) return no("no_energy");
    if (a.p === "shield") {
      if (me.shield) return no("has_shield");
      me.shield = true;
    } else if (a.p === "overdrive") {
      if (g.overdrive) return no("has_overdrive");
      g.overdrive = true;
    } else {
      const i = me.hand.findIndex((c) => c.id === a.id);
      if (i < 0) return no("bad_card");
      const [c] = me.hand.splice(i, 1);
      g.deck.unshift(c);
      me.hand.push(g.deck.pop()!);
    }
    me.energy -= cost;
    ev.push({ t: "power", p, power: a.p });
    return { ok: true, ev };
  }

  if (a.t !== "play") return no("bad_action");
  const i = me.hand.findIndex((c) => c.id === a.id);
  if (i < 0) return no("bad_card");
  const card = me.hand[i];
  if (!canPlay(g, card)) return no("cant_play");
  const last = me.hand.length === 1;
  // Check what the card needs before anything changes.
  if (!last) {
    if ((card.k === "prism" || card.k === "lock") && !SUITS.includes(a.suit as Suit)) return no("need_suit");
    if (card.k === "swap" || card.k === "gift") {
      const q = a.target;
      if (typeof q !== "number" || !Number.isInteger(q) || q < 0 || q >= others || q === p) return no("need_target");
    }
    if (card.k === "gift" && !me.hand.some((c) => c.id === a.give && c.id !== card.id)) return no("need_gift");
  }

  const before = top(g);
  me.hand.splice(i, 1);
  g.pile.push(card);
  if (card.s && !g.lock) g.suit = card.s;
  ev.push({ t: "play", p, card });
  gain(g, p, 1);
  if (card.k === "num" && before.k === "num" && before.n === card.n && before.s !== card.s) {
    gain(g, p, 1);
    ev.push({ t: "spark", p });
  }
  if (last) { win(g, p, ev); return { ok: true, ev }; }

  switch (card.k) {
    case "stun":
      g.skip = 1;
      break;
    case "flip":
      g.dir = g.dir === 1 ? -1 : 1;
      ev.push({ t: "flip" });
      if (others === 2) g.skip = 1;
      break;
    case "spike":
      g.pending += 2;
      g.spiker = p;
      break;
    case "prism":
      if (!g.lock) { g.suit = a.suit!; ev.push({ t: "suit", p, suit: a.suit }); }
      break;
    case "lock":
      g.suit = a.suit!;
      g.lock = { suit: a.suit!, owner: p };
      ev.push({ t: "lock", p, suit: a.suit });
      break;
    case "swap": {
      const q = a.target!;
      if (!blocked(g, q, ev)) {
        const diff = me.hand.length - g.players[q].hand.length;
        [me.hand, g.players[q].hand] = [g.players[q].hand, me.hand];
        ev.push({ t: "swap", p, q, n: diff });
      }
      break;
    }
    case "gift": {
      const q = a.target!;
      if (!blocked(g, q, ev)) {
        const j = me.hand.findIndex((c) => c.id === a.give);
        g.players[q].hand.push(me.hand.splice(j, 1)[0]);
        ev.push({ t: "gift", p, q });
        if (!me.hand.length) { win(g, p, ev); return { ok: true, ev }; }
      }
      break;
    }
    case "dice":
      rollDice(g, p, ev);
      break;
  }
  afterPlay(g, p, ev);
  return { ok: true, ev };
}
