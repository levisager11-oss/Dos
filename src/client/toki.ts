// Everything Surge does with Toki (https://playtoki.app): high scores, achievements, inviting
// friends into a room and the player's name. Outside Toki these calls do nothing.
import { saved, save } from "./store";

interface TokiApi {
  score?(n: number, board?: string): void;
  achievement?(id: string): void;
  room?(code: string | null): void;
  onHost?(fn: () => void): void;
  onName?(fn: (name: string) => void): void;
  name?: string | null;
}
const api = (): TokiApi | undefined => (window as unknown as { toki?: TokiApi }).toki;

export const inToki = window.parent !== window;

export const toki = {
  achievement(id: string) { api()?.achievement?.(id); },
  room(code: string | null) { api()?.room?.(code); },
  onHost(fn: () => void) { api()?.onHost?.(fn); },
  onName(fn: (name: string) => void) { api()?.onName?.(fn); },
  /** A won round: the points go to the main list, the number of wins to its own list. */
  won(points: number) {
    save({ wins: saved.wins + 1, best: Math.max(saved.best, points) });
    api()?.score?.(points);
    api()?.score?.(saved.wins, "wins");
    toki.achievement("first-win");
    if (saved.wins >= 10) toki.achievement("wins-10");
    if (points >= 100) toki.achievement("big-score");
  },
};

/** The room code of an invite link (?room=CODE). */
export function inviteCode(): string {
  const c = (new URLSearchParams(location.search).get("room") || "").toUpperCase();
  return /^[A-Z0-9]{4,8}$/.test(c) ? c : "";
}
