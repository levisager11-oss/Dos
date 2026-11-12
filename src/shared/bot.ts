// A simple computer player. Also plays for people who are away or ran out of time.
import { Action, Card, COST, Game, SUITS, Suit, cardPoints, playable, seatAfter, underSpike } from "./game";

function bestSuit(hand: Card[], skip: number): Suit {
  let best: Suit = SUITS[Math.floor(Math.random() * 4)], most = 0;
  for (const s of SUITS) {
    const n = hand.filter((c) => c.s === s && c.id !== skip).length;
    if (n > most) { most = n; best = s; }
  }
  return best;
}

/** The opponent with the fewest cards. */
function leader(g: Game, p: number): number {
  let best = -1;
  g.players.forEach((pl, i) => {
    if (i !== p && (best < 0 || pl.hand.length < g.players[best].hand.length)) best = i;
  });
  return best;
}

/** `powers` false: only play, draw or pass (for a player whose time ran out). */
export function botMove(g: Game, p: number, powers = true): Action {
  const me = g.players[p];
  const ids = playable(g, p);
  const cards = me.hand.filter((c) => ids.includes(c.id));
  if (underSpike(g)) return cards.length ? { t: "play", id: cards[0].id } : { t: "draw" };

  const lead = leader(g, p);
  const leadCards = g.players[lead].hand.length;
  if (powers) {
    if (me.energy >= COST.shield && !me.shield && (leadCards <= 3 || Math.random() < 0.25)) return { t: "power", p: "shield" };
    if (me.energy >= COST.overdrive && !g.overdrive && !g.bonus && cards.length >= 2 && me.hand.length <= 4) {
      return { t: "power", p: "overdrive" };
    }
  }
  if (!cards.length) return g.drew ? { t: "pass" } : { t: "draw" };

  const next = g.players[seatAfter(g, p)].hand.length;
  const rate = (c: Card): number => {
    if (me.hand.length === 1) return 100;
    switch (c.k) {
      case "num": return 10 + c.n;
      case "stun": case "flip": case "spike": return 20 + (next <= 2 ? 15 : 0);
      case "swap": return leadCards < me.hand.length - 2 ? 40 : -5;
      case "gift": return me.hand.length > 1 ? 18 : 2;
      case "dice": return me.hand.length <= 2 ? 1 : 8;
      case "lock": return 6;
      default: return 5;
    }
  };
  const card = cards.reduce((a, b) => (rate(b) > rate(a) ? b : a));
  if (rate(card) < 0) return g.drew ? { t: "pass" } : { t: "draw" };
  const act: Action = { t: "play", id: card.id };
  if (card.k === "prism" || card.k === "lock") act.suit = bestSuit(me.hand, card.id);
  if (card.k === "swap" || card.k === "gift") act.target = lead;
  if (card.k === "gift") {
    const rest = me.hand.filter((c) => c.id !== card.id);
    if (rest.length) act.give = rest.reduce((a, b) => (cardPoints(b) > cardPoints(a) && b.s !== null ? b : a)).id;
  }
  return act;
}
