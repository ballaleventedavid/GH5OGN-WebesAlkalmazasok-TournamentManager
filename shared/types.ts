import type { TournamentSettings } from "./settings.js";
export type Role = "organizer" | "captain";
export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
}
export interface Tournament extends TournamentSettings {
  id: number;
  name: string;
  season: string;
  location: string;
  sport: string;
  created_at: string;
}
export interface Team {
  id: number;
  tournament_id: number;
  name: string;
  short_name: string;
  color: string;
  captain_id: number;
  captain_name: string;
  captain_email: string;
  notification_email: string | null;
  player_count: number;
}
export interface Player {
  id: number;
  team_id: number;
  name: string;
  number: number;
  position: string;
}
export type MatchStatus = "scheduled" | "draft" | "final";
export interface Match {
  id: number;
  tournament_id: number;
  round: number;
  home_id: number;
  away_id: number;
  home_name: string;
  away_name: string;
  home_short: string;
  away_short: string;
  home_color: string;
  away_color: string;
  home_captain: number;
  away_captain: number;
  kickoff: string;
  venue: string;
  status: MatchStatus;
  home_score: number | null;
  away_score: number | null;
  version: number;
}
export interface Standing {
  team_id: number;
  name: string;
  short_name: string;
  color: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  difference: number;
  points: number;
  form: string[];
}
export interface Notification {
  id: number;
  tournament_id: number;
  recipient: string;
  subject: string;
  body: string;
  status: "queued" | "preview" | "sent" | "failed";
  error: string | null;
  created_at: string;
  sent_at: string | null;
  attempts: number;
}
export interface Audit {
  id: number;
  actor: string;
  action: string;
  created_at: string;
}
export interface DashboardData {
  tournament: Tournament;
  teams: Team[];
  matches: Match[];
  standings: Standing[];
  notifications: Notification[];
  audit: Audit[];
  mailMode: string;
}
export interface EmailSettingsStatus {
  mode: "smtp" | "preview";
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  fromName: string;
  recipientOverride: string;
  passwordSet: boolean;
  configured: boolean;
}
export interface EmailRecipientSettings {
  recipient: string;
}
