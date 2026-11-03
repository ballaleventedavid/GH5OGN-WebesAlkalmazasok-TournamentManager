import { randomInt } from "node:crypto";
import type { Match, Standing, Team } from "../shared/types.js";
import {
  defaultTournamentSettings,
  type TournamentSettings,
} from "../shared/settings.js";

/** Körmódszer: páratlan létszámnál a null jelenti a szabadnapos csapatot. */
export function roundRobin(
  ids: number[],
  shuffle = true,
  legs: 1 | 2 = 1,
): { round: number; home: number; away: number }[] {
  if (ids.length < 2 || new Set(ids).size !== ids.length)
    throw new Error("Legalább két különböző csapat szükséges.");
  const ring: (number | null)[] = [...ids];
  if (shuffle)
    for (let i = ring.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [ring[i], ring[j]] = [ring[j], ring[i]];
    }
  if (ring.length % 2) ring.push(null);
  const result: { round: number; home: number; away: number }[] = [];
  for (let r = 0; r < ring.length - 1; r++) {
    for (let i = 0; i < ring.length / 2; i++) {
      const a = ring[i],
        b = ring[ring.length - 1 - i];
      if (a !== null && b !== null)
        result.push({
          round: r + 1,
          home: (r + i) % 2 ? b : a,
          away: (r + i) % 2 ? a : b,
        });
    }
    ring.splice(1, 0, ring.pop()!);
  }
  if (legs === 1) return result;
  const roundCount = ring.length - 1;
  return [
    ...result,
    ...result.map((m) => ({
      round: m.round + roundCount,
      home: m.away,
      away: m.home,
    })),
  ];
}
export function standings(
  teams: Pick<Team, "id" | "name" | "short_name" | "color">[],
  matches: Pick<
    Match,
    | "home_id"
    | "away_id"
    | "home_score"
    | "away_score"
    | "status"
    | "kickoff"
    | "id"
  >[],
  settings: Partial<TournamentSettings> = {},
): Standing[] {
  const scoring = { ...defaultTournamentSettings, ...settings };
  const rows = new Map(
    teams.map((t) => [
      t.id,
      {
        team_id: t.id,
        name: t.name,
        short_name: t.short_name,
        color: t.color,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goals_for: 0,
        goals_against: 0,
        difference: 0,
        points: 0,
        form: [],
      } as Standing,
    ]),
  );
  for (const m of [...matches].sort(
    (a, b) => a.kickoff.localeCompare(b.kickoff) || a.id - b.id,
  )) {
    if (m.status !== "final" || m.home_score === null || m.away_score === null)
      continue;
    const h = rows.get(m.home_id),
      a = rows.get(m.away_id);
    if (!h || !a) continue;
    h.played++;
    a.played++;
    h.goals_for += m.home_score;
    h.goals_against += m.away_score;
    a.goals_for += m.away_score;
    a.goals_against += m.home_score;
    if (m.home_score > m.away_score) {
      h.won++;
      h.points += scoring.win_points;
      a.points += scoring.loss_points;
      a.lost++;
      h.form.push("W");
      a.form.push("L");
    } else if (m.home_score < m.away_score) {
      a.won++;
      a.points += scoring.win_points;
      h.points += scoring.loss_points;
      h.lost++;
      a.form.push("W");
      h.form.push("L");
    } else {
      h.drawn++;
      a.drawn++;
      h.points += scoring.draw_points;
      a.points += scoring.draw_points;
      h.form.push("D");
      a.form.push("D");
    }
  }
  return [...rows.values()]
    .map((r) => ({
      ...r,
      difference: r.goals_for - r.goals_against,
      form: r.form.slice(-5),
    }))
    .sort(
      (a, b) =>
        b.points - a.points ||
        (scoring.tie_breaker === "wins" ? b.won - a.won : 0) ||
        b.difference - a.difference ||
        b.goals_for - a.goals_for ||
        a.name.localeCompare(b.name, "hu") ||
        a.team_id - b.team_id,
    );
}
