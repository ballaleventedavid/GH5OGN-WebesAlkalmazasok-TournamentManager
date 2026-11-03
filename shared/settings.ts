export interface TournamentSettings {
  win_points: number;
  draw_points: number;
  loss_points: number;
  tie_breaker: "goal_difference" | "wins";
  round_robin_legs: 1 | 2;
  round_interval_days: number;
  max_teams: number;
}

export const defaultTournamentSettings: TournamentSettings = {
  win_points: 3,
  draw_points: 1,
  loss_points: 0,
  tie_breaker: "goal_difference",
  round_robin_legs: 1,
  round_interval_days: 7,
  max_teams: 32,
};

export function scheduleSize(teamCount: number, legs = 1) {
  return {
    matches: teamCount < 2 ? 0 : ((teamCount * (teamCount - 1)) / 2) * legs,
    rounds:
      teamCount < 2 ? 0 : (teamCount % 2 ? teamCount : teamCount - 1) * legs,
  };
}

export function tieBreakerDescription(
  value: TournamentSettings["tie_breaker"],
) {
  return value === "wins"
    ? "Pontszám → győzelmek → gólkülönbség → lőtt gólok → csapatnév"
    : "Pontszám → gólkülönbség → lőtt gólok → csapatnév";
}
