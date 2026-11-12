import { Card, Kind, Suit } from "../shared/game";
import { t } from "./i18n";

const GLYPH: Record<Suit, string> = {
  ember: "M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-4 2-7 2 1 3 2 3 4 1-2 1-6 1-9z",
  tide: "M12 2c4 6 7 9 7 13a7 7 0 0 1-14 0c0-4 3-7 7-13z",
  moss: "M4 20C4 10 10 4 20 4c0 10-6 16-16 16z",
  dusk: "M16 3a9 9 0 1 0 5 13A8 8 0 0 1 16 3z",
};

export function SuitIcon({ suit, size = 18 }: { suit: Suit; size?: number }) {
  return (
    <svg class="suit-icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d={GLYPH[suit]} fill="currentColor" />
    </svg>
  );
}

export type IconName = Exclude<Kind, "num" | "spike"> | "shield" | "recycle" | "overdrive" | "bolt" | "trophy" | "sound"
  | "mute" | "bot" | "x" | "back";

/** Line drawings, all on a 24 grid. `f` marks the filled ones. */
const ICONS: Record<IconName, { d: string; f?: boolean }> = {
  stun: { d: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM6.5 17.5l11-11" },
  flip: { d: "M19 12a7 7 0 1 1-2.6-5.4M17 2.5v4.5h-4.5" },
  swap: { d: "M4 8h15l-3.5-3.5M20 16H5l3.5 3.5" },
  lock: { d: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" },
  gift: { d: "M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-1-4-6-3-4 0M12 7c1-4 6-3 4 0" },
  dice: { d: "M4 4h16v16H4zM8.5 8.5h.01M15.5 15.5h.01M12 12h.01M15.5 8.5h.01M8.5 15.5h.01" },
  prism: { d: "" },
  shield: { d: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" },
  recycle: { d: "M8 4v15l-3.5-3.5M16 20V5l3.5 3.5" },
  overdrive: { d: "M5 6l6 6-6 6M13 6l6 6-6 6" },
  bolt: { d: "M13 2 4 14h6l-1 8 9-12h-6z", f: true },
  trophy: { d: "M7 4h10v5a5 5 0 0 1-10 0zM7 6H4c0 3 1 4 3 4M17 6h3c0 3-1 4-3 4M12 14v4M8 20h8" },
  sound: { d: "M4 9h4l5-4v14l-5-4H4zM16.5 9c1.5 1.5 1.5 4.500 0 6" },
  mute: { d: "M4 9h4l5-4v14l-5-4H4zM16 9.500l5 5M21 9.500l-5 5" },
  bot: { d: "M5 8h14v11H5zM12 4v4M9.500 13h.01M14.500 13h.01M9 16.500h6" },
  x: { d: "M6 6l12 12M18 6 6 18" },
  back: { d: "M19 12H5M11 6l-6 6 6 6" },
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  if (name === "prism") {
    return (
      <svg class="icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <path d="M12 2 2 12h10z" fill="var(--ember)" /><path d="M12 2l10 10H12z" fill="var(--tide)" />
        <path d="M2 12l10 10V12z" fill="var(--moss)" /><path d="M22 12 12 22V12z" fill="var(--dusk)" />
      </svg>
    );
  }
  const i = ICONS[name];
  return (
    <svg class="icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d={i.d} fill={i.f ? "currentColor" : "none"} stroke={i.f ? "none" : "currentColor"} stroke-width="2.6"
        stroke-linecap="square" stroke-linejoin="miter" />
    </svg>
  );
}

export function cardName(c: Card): string {
  const kind = c.k === "num" ? String(c.n) : t(`k_${c.k}`);
  return c.s ? `${t(`suit_${c.s}`)} ${kind}` : kind;
}

interface Props {
  card?: Card;
  /** Face down (the deck). */
  back?: boolean;
  dim?: boolean;
  lift?: boolean;
  onClick?: () => void;
  class?: string;
}

export function CardView({ card, back, dim, lift, onClick, class: cls = "" }: Props) {
  if (back || !card) {
    return <div class={`card back ${cls}`} onClick={onClick}><Icon name="bolt" /></div>;
  }
  const text = card.k === "num" ? String(card.n) : card.k === "spike" ? "+2" : "";
  const classes = `card ${card.s ? `s-${card.s}` : "wild"} k-${card.k} ${dim ? "dim" : ""} ${lift ? "lift" : ""} ${cls}`;
  return (
    <button type="button" class={classes} onClick={onClick} aria-label={cardName(card)} title={cardName(card)}>
      <span class="corner">{text || <Icon name={card.k as IconName} />}</span>
      <span class="face">{text || <Icon name={card.k as IconName} />}</span>
      {card.k !== "num" && <span class="kind">{t(`k_${card.k}`)}</span>}
      {card.s && <span class="pip"><SuitIcon suit={card.s} /></span>}
    </button>
  );
}

const ORDER: Record<string, number> = { ember: 0, tide: 1, moss: 2, dusk: 3 };
const KIND_ORDER: Kind[] = ["num", "stun", "flip", "spike", "prism", "lock", "swap", "gift", "dice"];

/** Your hand in a steady order: by suit, numbers first, chaos cards at the end. */
export function sortHand(hand: Card[]): Card[] {
  return [...hand].sort((a, b) =>
    (a.s ? ORDER[a.s] : 9) - (b.s ? ORDER[b.s] : 9) ||
    KIND_ORDER.indexOf(a.k) - KIND_ORDER.indexOf(b.k) ||
    a.n - b.n || a.id - b.id);
}
