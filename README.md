# Dos

A fast card game for [Toki](https://www.playtoki.app): get rid of your cards by matching suits and
numbers, throw chaos cards, and spend energy on powers. Online with up to 6 players, or solo
against bots.

## The rules in short

- Play a card with the same suit or number as the top of the pile, or draw one.
- **Stun** skips the next player, **Flip** turns the direction, **Spike** makes the next player
  draw 2 (they can answer with their own Spike and pass the pile on).
- Chaos cards go on anything: **Prism** (pick a suit), **Lock** (only one suit until your next
  turn), **Swap** (trade hands), **Gift** (hand a card over), **Dice** (a random event).
- Every card you play gives energy. Spend it on **Trade** (1), **Shield** (2) or **Turbo** (3).
- The first player without cards wins and scores what the others still hold.

## How it is built

| Part | Where |
| --- | --- |
| Rules, bots, room logic (shared by browser and server) | `src/shared/` |
| The game's screens (Preact + Vite) | `src/client/` |
| Online rooms (Cloudflare Worker + Durable Object) | `server/worker.ts`, `wrangler.toml` |
| Toki details (title, achievements, high-score lists) | `toki.json` |

```bash
npm install
npm run server:dev   # the room server on localhost:8787
npm run dev          # the game on localhost:5173
npm test
```

`npm run build` writes the game to `dist/`. The address of the room server is set in
`.env.production` (`VITE_SERVER`); `npm run server:deploy` puts the server on Cloudflare.

## Toki

- High scores: the points of a won round go to the main list, the number of wins to "Total wins".
- Achievements: see `toki.json`.
- Play together: the game tells Toki its room code, reads `?room=CODE` from invite links and
  opens a room when Toki asks for one.
- Pushes to `main` publish the game on Toki (`.github/workflows/toki.yml`).
