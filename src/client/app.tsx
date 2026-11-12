import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { Action, Card, COST, Ev, MAX_ENERGY, Power, SUITS, Suit } from "../shared/game";
import { ClientMsg, MAX_PLAYERS, TURN_MS, View } from "../shared/room";
import { CardView, Icon, IconName, SuitIcon, sortHand } from "./cards";
import { lang, t } from "./i18n";
import { Conn, online, randomCode, solo } from "./net";
import { sound } from "./sound";
import { save, saved } from "./store";
import { inToki, inviteCode, toki } from "./toki";

type Mode = "solo" | "online";
interface Line { id: number; text: string }
let lineId = 0;

function seatName(v: View, seat: number): string {
  const g = v.game;
  return (g && v.members[g.players[seat]?.m]?.name) || "?";
}

/** One line for the log, or "" when the event needs no words. */
function describe(v: View, e: Ev): string {
  const p = e.p !== undefined ? seatName(v, e.p) : "";
  const q = e.q !== undefined ? seatName(v, e.q) : "";
  switch (e.t) {
    case "draw": return (e.n ?? 0) > 1 ? t("e_draw", { p, n: e.n! }) : "";
    case "hit": return t("e_hit", { p, n: e.n ?? 0 });
    case "suit": case "lock": return t(`e_${e.t}`, { p, suit: t(`suit_${e.suit}`) });
    case "dice": return t(`e_dice_${e.fx}`, { p });
    case "power": return t(`e_power_${e.power}`, { p });
    case "stunned": case "block": case "flip": case "unlock": case "swap": case "gift": case "spark": case "again":
      return t(`e_${e.t}`, { p, q });
    default: return "";
  }
}

const EV_SOUND: Partial<Record<Ev["t"], string>> = {
  play: "play", draw: "draw", hit: "hit", block: "block", power: "power", dice: "chaos", swap: "chaos", gift: "chaos",
  stunned: "hit", lock: "chaos",
};

export function App() {
  const [view, setView] = useState<View | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [linked, setLinked] = useState(true);
  const [error, setError] = useState("");
  const [log, setLog] = useState<Line[]>([]);
  const [help, setHelp] = useState(false);
  const [, redraw] = useState(0);
  const conn = useRef<Conn | null>(null);
  const modeRef = useRef<Mode | null>(null);
  const round = useRef({ no: -1, maxHand: 0, wasTurn: false });
  const clock = useRef(0);

  const leave = useCallback((msg = "") => {
    conn.current?.close();
    conn.current = null;
    modeRef.current = null;
    toki.room(null);
    setView(null); setMode(null); setLog([]); setLinked(true);
    setError(msg);
  }, []);

  const onView = useCallback((v: View) => {
    clock.current = v.now - Date.now();
    const g = v.game;
    if (g) {
      const r = round.current;
      if (r.no !== v.round) { r.no = v.round; r.maxHand = 0; r.wasTurn = false; setLog([]); }
      r.maxHand = Math.max(r.maxHand, g.hand.length);
      const lines: Line[] = [];
      for (const e of v.ev) {
        if (EV_SOUND[e.t]) sound(EV_SOUND[e.t]!);
        const text = describe(v, e);
        if (text) lines.push({ id: ++lineId, text });
        if (e.t === "play" && e.p !== undefined && g.players[e.p].count === 1 && g.winner < 0) {
          lines.push({ id: ++lineId, text: t("e_last", { p: seatName(v, e.p) }) });
        }
        const mine = e.p === g.me && g.me >= 0;
        if (e.t === "block" && mine) toki.achievement("shield-block");
        if (e.t === "dice" && e.fx === "jackpot" && mine) toki.achievement("jackpot");
        if (e.t === "swap" && mine && (e.n ?? 0) >= 4) toki.achievement("swap-master");
        if (e.t === "hit" && e.q === g.me && g.me >= 0 && (e.n ?? 0) >= 6) toki.achievement("spike-chain");
        if (e.t === "win") {
          save({ games: saved.games + 1 });
          if (mine) {
            sound("win");
            toki.won(e.n ?? 0);
            if (e.bonus) toki.achievement("turbo-finish");
            if (r.maxHand >= 12) toki.achievement("comeback");
            if (g.players.length >= MAX_PLAYERS) toki.achievement("full-table");
            const people = g.players.filter((pl) => v.members[pl.m] && !v.members[pl.m].bot).length;
            if (modeRef.current === "online" && people >= 2) toki.achievement("with-friends");
          } else if (g.me >= 0) sound("lose");
        }
      }
      if (lines.length) setLog((old) => [...old, ...lines].slice(-30));
      const myTurn = g.turn === g.me && g.winner < 0;
      if (myTurn && !r.wasTurn) sound("turn");
      r.wasTurn = myTurn;
    }
    setView(v);
  }, []);

  const handlers = {
    view: onView,
    status: setLinked,
    error: (code: string, fatal: boolean) => {
      if (fatal) leave(t(`err_${["no_room", "full", "offline", "lost", "replaced", "closed"].includes(code) ? code : "generic"}`));
    },
  };

  const startSolo = () => {
    leave();
    modeRef.current = "solo"; setMode("solo");
    conn.current = solo(saved.bots, handlers);
  };
  const startOnline = (code: string, create: boolean) => {
    leave();
    modeRef.current = "online"; setMode("online");
    setLinked(false);
    conn.current = online(code, create, handlers);
  };

  useEffect(() => {
    toki.onName((name) => { if (!saved.name) { save({ name: name.slice(0, 16) }); redraw((n) => n + 1); } });
    // "Invite friends" on Toki before a room is open: open one.
    toki.onHost(() => { if (modeRef.current !== "online") startOnline(randomCode(), true); });
    const code = inviteCode();
    if (code) startOnline(code, false);
    if (!saved.seenHelp && !code) { setHelp(true); save({ seenHelp: true }); }
  }, []);

  // Tell Toki which room the player is in, so they can invite friends.
  const code = mode === "online" && view ? view.code : null;
  useEffect(() => { toki.room(code); }, [code]);

  const send = (msg: ClientMsg) => conn.current?.send(msg);

  let screen;
  if (!mode) {
    screen = <Home error={error} onSolo={startSolo} onCreate={() => startOnline(randomCode(), true)}
      onJoin={(c) => startOnline(c, false)} onHelp={() => setHelp(true)} redraw={() => redraw((n) => n + 1)} />;
  } else if (!view) {
    screen = <div class="center-msg"><div class="spinner" />{t("connecting")}<button class="btn ghost" onClick={() => leave()}>{t("cancel")}</button></div>;
  } else if (view.phase === "lobby" || !view.game) {
    screen = <Lobby view={view} send={send} onLeave={() => leave()} />;
  } else {
    screen = <Table view={view} send={send} log={log} solo={mode === "solo"} clock={clock.current}
      onLeave={() => leave()} onHelp={() => setHelp(true)} />;
  }
  return (
    <div class="app">
      {screen}
      {mode === "online" && view && !linked && <div class="offline-bar">{t("reconnecting")}</div>}
      {help && <Help onClose={() => setHelp(false)} />}
    </div>
  );
}

function Logo() {
  return <div class="logo"><Icon name="bolt" size={40} /><span>DOS</span></div>;
}

function Home(p: { error: string; onSolo(): void; onCreate(): void; onJoin(code: string): void; onHelp(): void; redraw(): void }) {
  const [code, setCode] = useState("");
  const ok = /^[A-Z0-9]{4,8}$/.test(code);
  return (
    <div class="home">
      <div class="home-top">
        <button class="chip" onClick={() => { save({ lang: lang() === "de" ? "en" : "de" }); p.redraw(); }}>{lang() === "de" ? "DE" : "EN"}</button>
        <button class="chip" onClick={() => { save({ mute: !saved.mute }); p.redraw(); }}><Icon name={saved.mute ? "mute" : "sound"} size={16} /></button>
      </div>
      <Logo />
      <p class="tagline">{t("tagline")}</p>
      <div class="fan" aria-hidden="true">
        <CardView card={{ id: -1, k: "num", s: "tide", n: 7 }} />
        <CardView card={{ id: -2, k: "spike", s: "ember", n: 0 }} />
        <CardView card={{ id: -3, k: "dice", s: null, n: 0 }} />
        <CardView card={{ id: -4, k: "num", s: "moss", n: 3 }} />
        <CardView card={{ id: -5, k: "flip", s: "dusk", n: 0 }} />
      </div>
      {p.error && <div class="error">{p.error}</div>}
      <div class="panel">
        <label class="field">
          <span>{t("yourName")}</span>
          <input value={saved.name} maxLength={16} placeholder="Player" autocomplete="off"
            onInput={(e) => { save({ name: (e.target as HTMLInputElement).value }); p.redraw(); }} />
        </label>
        <div class="row">
          <button class="btn primary grow" onClick={p.onSolo}>{t("playSolo")}</button>
          <label class="stepper" title={t("bots")}>
            <button onClick={() => { save({ bots: Math.max(1, saved.bots - 1) }); p.redraw(); }}>−</button>
            <span>{saved.bots} {t("bots")}</span>
            <button onClick={() => { save({ bots: Math.min(MAX_PLAYERS - 1, saved.bots + 1) }); p.redraw(); }}>+</button>
          </label>
        </div>
        <button class="btn" onClick={p.onCreate}>{t("createRoom")}</button>
        <form class="row" onSubmit={(e) => { e.preventDefault(); if (ok) p.onJoin(code); }}>
          <input class="grow code-input" value={code} maxLength={8} placeholder={t("roomCode")} autocomplete="off" autocapitalize="characters"
            onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
          <button class="btn" disabled={!ok}>{t("joinRoom")}</button>
        </form>
        <button class="btn ghost" onClick={p.onHelp}>{t("howTo")}</button>
      </div>
      {saved.wins > 0 && <p class="stats">{t("stats", { wins: saved.wins, best: saved.best })}</p>}
    </div>
  );
}

function Lobby({ view, send, onLeave }: { view: View; send(m: ClientMsg): void; onLeave(): void }) {
  const [copied, setCopied] = useState(false);
  const host = view.you === view.host;
  const link = `${location.origin}${location.pathname}?room=${view.code}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* not allowed here */ }
  };
  return (
    <div class="lobby">
      <Logo />
      <div class="panel">
        <div class="room-code">
          <span>{t("room")}</span>
          <strong>{view.code}</strong>
        </div>
        {!inToki && <button class="btn ghost" onClick={copy}>{copied ? t("copied") : t("copyLink")}</button>}
        <ul class="members">
          {view.members.map((m, i) => (
            <li key={i} class={m.on ? "" : "off"}>
              <Avatar name={m.name} i={i} bot={m.bot} />
              <span class="grow">{m.name}{i === view.you && <em> ({t("you")})</em>}</span>
              {m.wins > 0 && <span class="tag gold"><Icon name="trophy" size={12} /> {m.wins}</span>}
              {i === view.host && <span class="tag">{t("host")}</span>}
              {m.bot && <span class="tag">{t("bot")}</span>}
              {!m.on && <span class="tag">{t("away")}</span>}
              {host && i !== view.you && <button class="x" onClick={() => send({ t: "kick", i })} aria-label="remove"><Icon name="x" size={14} /></button>}
            </li>
          ))}
        </ul>
        {host ? (
          <>
            {view.members.length < MAX_PLAYERS && <button class="btn" onClick={() => send({ t: "bot" })}>+ {t("addBot")}</button>}
            <button class="btn primary" disabled={view.members.length < 2} onClick={() => send({ t: "start" })}>{t("start")}</button>
            {view.members.length < 2 && <p class="hint">{t("needPlayers")}</p>}
          </>
        ) : <p class="hint">{t("waitHost", { name: view.members[view.host]?.name ?? "?" })}</p>}
        <button class="btn ghost" onClick={onLeave}>{t("leave")}</button>
      </div>
    </div>
  );
}

const AVATAR_COLORS = ["#ff6a3d", "#19b5e6", "#86d43a", "#a877ff", "#ffd23f", "#ff5fa2"];
function Avatar({ name, i, bot }: { name: string; i: number; bot?: boolean }) {
  return <span class="avatar" style={{ background: AVATAR_COLORS[((i % 6) + 6) % 6] }}>{bot ? <Icon name="bot" size={18} /> : (name[0] || "?").toUpperCase()}</span>;
}

function Timer({ deadline, clock }: { deadline: number; clock: number }) {
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 250); return () => clearInterval(id); }, []);
  const left = Math.max(0, Math.min(1, (deadline - (Date.now() + clock)) / TURN_MS));
  return <div class={`timer ${left < 0.25 ? "low" : ""}`}><i style={{ width: `${left * 100}%` }} /></div>;
}

type Ask =
  | { k: "suit"; card: Card }
  | { k: "target"; card: Card }
  | { k: "give"; card: Card; target: number }
  | { k: "recycle" };

function Table(p: { view: View; send(m: ClientMsg): void; log: Line[]; solo: boolean; clock: number; onLeave(): void; onHelp(): void }) {
  const { view, send } = p;
  const g = view.game!;
  const [ask, setAsk] = useState<Ask | null>(null);
  const [shake, setShake] = useState(0);
  const [, redraw] = useState(0);
  const me = g.me;
  const myTurn = me >= 0 && g.turn === me && g.winner < 0;
  const mine = me >= 0 ? g.players[me] : null;
  const spiked = g.pending > 0 && !g.bonus;
  useEffect(() => { if (!myTurn) setAsk(null); }, [myTurn, g.turn]);

  const n = g.players.length;
  const others: number[] = [];
  for (let i = me >= 0 ? 1 : 0; i < n; i++) others.push(((me >= 0 ? me : 0) + i) % n);

  const act = (a: Action) => {
    send({ t: "act", a });
    setAsk(null);
  };
  const tap = (c: Card) => {
    if (!myTurn) return;
    if (ask?.k === "recycle") return act({ t: "power", p: "recycle", id: c.id });
    if (!g.playable.includes(c.id)) { setShake(c.id); setTimeout(() => setShake(0), 350); return; }
    if (g.hand.length > 1) {
      if (c.k === "prism" || c.k === "lock") return setAsk({ k: "suit", card: c });
      if (c.k === "swap" || c.k === "gift") {
        if (others.length === 1 && c.k === "swap") return act({ t: "play", id: c.id, target: others[0] });
        return setAsk({ k: "target", card: c });
      }
    }
    act({ t: "play", id: c.id });
  };
  const power = (pw: Power) => {
    if (pw === "recycle") return setAsk(ask?.k === "recycle" ? null : { k: "recycle" });
    act({ t: "power", p: pw });
  };

  const hand = sortHand(g.hand);
  // On a phone, a big hand goes on two rows so every card stays readable.
  const half = Math.ceil(hand.length / 2);
  const rows = window.innerWidth < 560 && hand.length > 7 ? [hand.slice(0, half), hand.slice(half)] : [hand];
  const host = view.you === view.host;
  const turnName = seatName(view, g.turn);
  const status = g.winner >= 0 ? "" : myTurn
    ? (spiked ? t("mustAnswer", { n: g.pending }) : g.bonus ? t("bonusTurn") : t("yourTurn"))
    : t("turnOf", { name: turnName });

  return (
    <div class={`table suit-${g.suit} ${myTurn ? "my-turn" : ""}`}>
      <header class="bar">
        <button class="chip" onClick={p.onLeave}><Icon name="back" size={14} /> {t("leave")}</button>
        {!p.solo && <span class="chip static">{t("room")} {view.code}</span>}
        <span class="grow" />
        <button class="chip" onClick={() => { save({ mute: !saved.mute }); redraw((x) => x + 1); }}><Icon name={saved.mute ? "mute" : "sound"} size={16} /></button>
        <button class="chip" onClick={p.onHelp}>?</button>
      </header>

      <div class="opponents">
        {others.map((seat) => {
          const pl = g.players[seat], m = view.members[pl.m];
          const on = g.turn === seat && g.winner < 0;
          return (
            <div key={seat} class={`opp ${on ? "on" : ""} ${m && !m.on ? "off" : ""}`}>
              <Avatar name={m?.name ?? "?"} i={pl.m} bot={m?.bot} />
              <div class="opp-info">
                <span class="opp-name">{m?.name ?? "?"}{pl.shield && <b class="state" title={t("p_shield")}><Icon name="shield" size={13} /></b>}</span>
                <span class="opp-cards"><i class="mini" /><b>{pl.count}</b><span class="pips">{Array.from({ length: pl.energy }, (_, k) => <i key={k} />)}</span></span>
              </div>
              {on && <Timer deadline={g.deadline} clock={p.clock} />}
            </div>
          );
        })}
      </div>

      <div class="middle">
        <div class="mat">
          <div class="now">
            <SuitIcon suit={g.suit} size={13} />
            <span>{t(`suit_${g.suit}`)}</span>
            {g.lock && <span class="lock"><Icon name="lock" size={12} /> {t("locked")}</span>}
          </div>
          <div class="deck" onClick={() => myTurn && !g.drew && act({ t: "draw" })}>
            <CardView back class={myTurn && !g.drew ? "ready" : ""} />
            <span class="count">{g.deck}</span>
          </div>
          <div class="pile">
            <CardView key={g.top.id} card={g.top} class="drop" />
            {g.pending > 0 && <span class="badge spike">+{g.pending}</span>}
          </div>
          <div class={`dir ${g.dir === 1 ? "" : "rev"}`} aria-hidden="true"><Icon name="flip" /></div>
        </div>
      </div>

      <div class="status">
        <strong>{status}</strong>
        {p.log.slice(-3).map((l, k, a) => <span key={l.id} class={`event ${k === a.length - 1 ? "new" : ""}`}>{l.text}</span>)}
      </div>

      {mine && (
        <div class="me">
          <div class="me-bar">
            <div class="energy" title={t("energy")}>
              <span class="bolt"><Icon name="bolt" size={18} /></span>
              {Array.from({ length: MAX_ENERGY }, (_, i) => <i key={i} class={i < mine.energy ? "full" : ""} />)}
              {mine.shield && <b class="state" title={t("p_shield")}><Icon name="shield" size={16} /></b>}
              {g.overdrive && <b class="state" title={t("p_overdrive")}><Icon name="overdrive" size={16} /></b>}
            </div>
            <div class="powers">
              {(["recycle", "shield", "overdrive"] as Power[]).map((pw) => {
                const off = !myTurn || mine.energy < COST[pw] || (pw === "shield" && mine.shield) || (pw === "overdrive" && g.overdrive);
                return (
                  <button key={pw} class={`power ${ask?.k === "recycle" && pw === "recycle" ? "active" : ""}`} disabled={off}
                    title={t(`pd_${pw}`)} onClick={() => power(pw)}>
                    <Icon name={pw} size={16} /><span>{t(`p_${pw}`)}</span>
                    <small><Icon name="bolt" size={11} />{COST[pw]}</small>
                  </button>
                );
              })}
            </div>
            <div class="turn-actions">
              {myTurn && !g.drew && <button class="btn small" onClick={() => act({ t: "draw" })}>{spiked ? t("drawN", { n: g.pending }) : t("draw")}</button>}
              {myTurn && g.drew && <button class="btn small" onClick={() => act({ t: "pass" })}>{t("pass")}</button>}
            </div>
          </div>
          {myTurn && <Timer deadline={g.deadline} clock={p.clock} />}
          {ask?.k === "recycle" && <div class="hint strong">{t("pickRecycle")}</div>}
          {rows.map((row, r) => (
            <div key={r} class="hand" style={{ "--n": Math.max(2, row.length) }}>
              {row.map((c) => (
                <CardView key={c.id} card={c} onClick={() => tap(c)}
                  dim={myTurn && ask?.k !== "recycle" && !g.playable.includes(c.id)}
                  lift={myTurn && (ask?.k === "recycle" || g.playable.includes(c.id))}
                  class={shake === c.id ? "shake" : ""} />
              ))}
            </div>
          ))}
        </div>
      )}
      {!mine && g.winner < 0 && <div class="hint spectate">{t("waitRound")}</div>}

      {ask?.k === "suit" && (
        <Modal title={t(ask.card.k === "lock" ? "pickSuitLock" : "pickSuit")} onClose={() => setAsk(null)}>
          <div class="suit-grid">
            {SUITS.map((s: Suit) => (
              <button key={s} class={`suit-btn s-${s}`} onClick={() => act({ t: "play", id: ask.card.id, suit: s })}>
                <SuitIcon suit={s} size={36} /><span>{t(`suit_${s}`)}</span>
                <small>{g.hand.filter((c) => c.s === s).length}</small>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {ask?.k === "target" && (
        <Modal title={t(ask.card.k === "gift" ? "pickTargetGift" : "pickTarget")} onClose={() => setAsk(null)}>
          <div class="target-list">
            {others.map((seat) => {
              const pl = g.players[seat], m = view.members[pl.m];
              return (
                <button key={seat} class="btn target" onClick={() =>
                  ask.card.k === "gift" ? setAsk({ k: "give", card: ask.card, target: seat }) : act({ t: "play", id: ask.card.id, target: seat })}>
                  <Avatar name={m?.name ?? "?"} i={pl.m} bot={m?.bot} />
                  <span class="grow">{m?.name ?? "?"} {pl.shield && <Icon name="shield" size={14} />}</span>
                  <span>{t("cards", { n: pl.count })}</span>
                </button>
              );
            })}
          </div>
        </Modal>
      )}
      {ask?.k === "give" && (
        <Modal title={t("pickGift")} onClose={() => setAsk(null)}>
          <div class="give-grid">
            {hand.filter((c) => c.id !== ask.card.id).map((c) => (
              <CardView key={c.id} card={c} onClick={() => act({ t: "play", id: ask.card.id, target: ask.target, give: c.id })} />
            ))}
          </div>
        </Modal>
      )}

      {g.winner >= 0 && (
        <div class="overlay">
          <div class="modal end">
            <div class="trophy"><Icon name="trophy" size={56} /></div>
            <h2>{g.winner === me ? t("winnerYou") : t("winner", { name: seatName(view, g.winner) })}</h2>
            <p class="points">{t("points", { n: view.result?.points ?? 0 })}</p>
            <ul class="members">
              {g.players.map((pl, seat) => (
                <li key={seat} class={seat === g.winner ? "won" : ""}>
                  <Avatar name={seatName(view, seat)} i={pl.m} bot={view.members[pl.m]?.bot} />
                  <span class="grow">{seatName(view, seat)}</span>
                  <span class={`tag ${seat === g.winner ? "gold" : ""}`}>{seat === g.winner ? <Icon name="trophy" size={12} /> : t("left", { n: pl.count })}</span>
                </li>
              ))}
            </ul>
            {host ? (
              <>
                <button class="btn primary" onClick={() => send({ t: "start" })}>{t("again")}</button>
                {!p.solo && <button class="btn" onClick={() => send({ t: "lobby" })}>{t("toLobby")}</button>}
              </>
            ) : <p class="hint">{t("waitHost", { name: view.members[view.host]?.name ?? "?" })}</p>}
            <button class="btn ghost" onClick={p.onLeave}>{t("leave")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Modal(p: { title: string; onClose(): void; children: preact.ComponentChildren }) {
  return (
    <div class="overlay" onClick={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div class="modal">
        <h3>{p.title}</h3>
        {p.children}
        <button class="btn ghost" onClick={p.onClose}>{t("cancel")}</button>
      </div>
    </div>
  );
}

function Help({ onClose }: { onClose(): void }) {
  const row = (k: string, wild = false) => (
    <li><span class={`sym ${wild ? "wild" : ""}`}>{k === "spike" ? "+2" : <Icon name={k as IconName} size={18} />}</span><span><b>{t(`k_${k}`)}</b> {t(`h_${k}`)}</span></li>
  );
  const pow = (k: "recycle" | "shield" | "overdrive") => (
    <li><span class="sym gold"><Icon name={k} size={18} /></span><span><b>{t(`p_${k}`)}</b> ({COST[k]}) {t(`pd_${k}`)}</span></li>
  );
  return (
    <div class="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="modal help">
        <h3>{t("howTo")}</h3>
        <p><b>{t("h_goal")}</b> {t("h_match")}</p>
        <h4>{t("h_actions")}</h4>
        <ul>{row("stun")}{row("flip")}{row("spike")}</ul>
        <h4>{t("h_chaos")}</h4>
        <ul>{row("prism", true)}{row("lock", true)}{row("swap", true)}{row("gift", true)}{row("dice", true)}</ul>
        <h4>{t("h_energy")}</h4>
        <p>{t("h_energyText")}</p>
        <ul>{pow("recycle")}{pow("shield")}{pow("overdrive")}</ul>
        <p>{t("h_score")}</p>
        <button class="btn primary" onClick={onClose}>{t("close")}</button>
      </div>
    </div>
  );
}
