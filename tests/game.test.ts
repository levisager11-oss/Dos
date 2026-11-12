import { describe, expect, it } from "vitest";
import { Card, Game, apply, buildDeck, canPlay, newGame, score, top } from "../src/shared/game";
import { botMove } from "../src/shared/bot";

const count = (g: Game) => g.deck.length + g.pile.length + g.players.reduce((n, p) => n + p.hand.length, 0);
const card = (k: Card["k"], s: Card["s"], n = 0, id = 900 + Math.floor(Math.random() * 1e6)): Card => ({ id, k, s, n });

/** A game where player 0 is on turn with exactly these cards. */
function setup(hand: Card[], players = 3): Game {
  const g = newGame(players, 1);
  g.turn = 0;
  g.players[0].hand = hand;
  g.pile.push(card("num", "ember", 5));
  g.suit = "ember";
  return g;
}

describe("deck", () => {
  it("has 112 cards with unique ids", () => {
    const d = buildDeck();
    expect(d.length).toBe(112);
    expect(new Set(d.map((c) => c.id)).size).toBe(112);
  });
});

describe("rules", () => {
  it("matches suit or number, chaos cards always", () => {
    const g = setup([]);
    expect(canPlay(g, card("num", "ember", 1))).toBe(true);
    expect(canPlay(g, card("num", "tide", 5))).toBe(true);
    expect(canPlay(g, card("num", "tide", 4))).toBe(false);
    expect(canPlay(g, card("stun", "tide"))).toBe(false);
    expect(canPlay(g, card("dice", null))).toBe(true);
  });

  it("a matching number on another suit gives a spark", () => {
    const c = card("num", "tide", 5), x = card("num", "moss", 1);
    const g = setup([c, x]);
    const r = apply(g, 0, { t: "play", id: c.id });
    expect(r.ok).toBe(true);
    expect(g.players[0].energy).toBe(2);
    expect(g.suit).toBe("tide");
    expect(g.turn).toBe(1);
  });

  it("stun jumps over the next player, a shield stops it", () => {
    const a = card("stun", "ember"), b = card("stun", "ember"), x = card("num", "moss", 1);
    let g = setup([a, x]);
    apply(g, 0, { t: "play", id: a.id });
    expect(g.turn).toBe(2);
    g = setup([b, x]);
    g.players[1].shield = true;
    apply(g, 0, { t: "play", id: b.id });
    expect(g.turn).toBe(1);
    expect(g.players[1].shield).toBe(false);
  });

  it("spikes stack and the stack is drawn", () => {
    const a = card("spike", "ember"), b = card("spike", "dusk"), x = card("num", "moss", 1);
    const g = setup([a, x]);
    g.players[1].hand = [b, card("num", "moss", 2)];
    g.players[2].hand = [card("num", "moss", 3)];
    apply(g, 0, { t: "play", id: a.id });
    expect(apply(g, 1, { t: "play", id: g.players[1].hand[1].id }).ok).toBe(false);
    apply(g, 1, { t: "play", id: b.id });
    expect(g.pending).toBe(4);
    apply(g, 2, { t: "draw" });
    expect(g.players[2].hand.length).toBe(5);
    expect(g.pending).toBe(0);
    expect(g.turn).toBe(0);
  });

  it("lock holds the suit until its owner's next turn", () => {
    const l = card("lock", null), x = card("num", "moss", 1);
    const g = setup([l, x]);
    apply(g, 0, { t: "play", id: l.id, suit: "dusk" });
    expect(g.suit).toBe("dusk");
    expect(canPlay(g, card("num", "ember", 5))).toBe(false);
    expect(canPlay(g, card("num", "dusk", 2))).toBe(true);
    g.players[1].hand = [card("num", "dusk", 2), x];
    apply(g, 1, { t: "play", id: g.players[1].hand[0].id });
    expect(g.lock).not.toBeNull();
    apply(g, 2, { t: "draw" });
    if (g.turn === 2) apply(g, 2, { t: "pass" });
    expect(g.turn).toBe(0);
    expect(g.lock).toBeNull();
  });

  it("swap trades hands, gift hands a card over", () => {
    const s = card("swap", null), x = card("num", "moss", 1), y = card("num", "moss", 2);
    let g = setup([s, x, y]);
    const theirs = g.players[2].hand.length;
    expect(apply(g, 0, { t: "play", id: s.id }).ok).toBe(false);
    apply(g, 0, { t: "play", id: s.id, target: 2 });
    expect(g.players[0].hand.length).toBe(theirs);
    expect(g.players[2].hand.length).toBe(2);

    const gift = card("gift", null);
    g = setup([gift, x]);
    const r = apply(g, 0, { t: "play", id: gift.id, target: 1, give: x.id });
    expect(r.ok).toBe(true);
    expect(g.winner).toBe(0);
  });

  it("overdrive gives a second turn", () => {
    const a = card("num", "ember", 1), b = card("num", "ember", 2), c = card("num", "moss", 9);
    const g = setup([a, b, c]);
    g.players[0].energy = 3;
    expect(apply(g, 0, { t: "power", p: "overdrive" }).ok).toBe(true);
    apply(g, 0, { t: "play", id: a.id });
    expect(g.turn).toBe(0);
    expect(g.bonus).toBe(true);
    apply(g, 0, { t: "play", id: b.id });
    expect(g.turn).toBe(1);
  });

  it("recycle trades a card for a new one", () => {
    const a = card("num", "ember", 1), b = card("num", "ember", 2);
    const g = setup([a, b]);
    g.players[0].energy = 1;
    const before = count(g);
    expect(apply(g, 0, { t: "power", p: "recycle", id: a.id }).ok).toBe(true);
    expect(g.players[0].hand.length).toBe(2);
    expect(g.players[0].hand.some((c) => c.id === a.id)).toBe(false);
    expect(count(g)).toBe(before);
  });

  it("the last card wins and scores the others' hands", () => {
    const a = card("num", "ember", 1);
    const g = setup([a], 2);
    g.players[1].hand = [card("num", "moss", 7), card("stun", "moss"), card("dice", null)];
    apply(g, 0, { t: "play", id: a.id });
    expect(g.winner).toBe(0);
    expect(score(g)).toBe(37);
    expect(apply(g, 1, { t: "draw" }).ok).toBe(false);
  });
});

describe("bots", () => {
  it("finish whole games without breaking the rules or losing cards", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const players = 2 + (seed % 5);
      const g = newGame(players, seed * 7919);
      expect(top(g).k).toBe("num");
      let steps = 0;
      while (g.winner < 0) {
        const r = apply(g, g.turn, botMove(g, g.turn));
        if (!r.ok) throw new Error(`seed ${seed}: ${r.err}`);
        if (count(g) !== 112) throw new Error(`seed ${seed}: ${count(g)} cards`);
        if (++steps > 20000) throw new Error(`seed ${seed}: never ends`);
      }
      expect(g.players[g.winner].hand.length).toBe(0);
    }
  });
});
