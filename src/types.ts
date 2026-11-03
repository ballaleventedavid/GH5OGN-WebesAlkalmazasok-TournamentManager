import type { Match, Notification, Team } from "../shared/types";
export type Page =
  "overview" | "teams" | "matches" | "standings" | "notifications" | "settings";
export type Dialog =
  | { kind: "team"; team?: Team }
  | { kind: "match" }
  | { kind: "score"; match: Match }
  | { kind: "schedule"; match: Match }
  | { kind: "draw" }
  | { kind: "tournament"; edit?: boolean }
  | { kind: "roster"; team: Team }
  | { kind: "mail"; mail: Notification };
