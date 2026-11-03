import type { DB } from "./db.js";
import { all } from "./db.js";
import type { Match, Team } from "../shared/types.js";
export const teamQuery = `SELECT t.*,u.name captain_name,u.email captain_email,(SELECT COUNT(*) FROM players p WHERE p.team_id=t.id) player_count FROM teams t JOIN users u ON u.id=t.captain_id`;
export const matchQuery = `SELECT m.*,h.name home_name,a.name away_name,h.short_name home_short,a.short_name away_short,h.color home_color,a.color away_color,h.captain_id home_captain,a.captain_id away_captain FROM matches m JOIN teams h ON h.id=m.home_id JOIN teams a ON a.id=m.away_id`;
export const getTeams = (db: DB, id: number) =>
  all<Team>(
    db,
    `${teamQuery} WHERE t.tournament_id=? ORDER BY t.name COLLATE NOCASE`,
    id,
  );
export const getMatches = (db: DB, id: number) =>
  all<Match>(
    db,
    `${matchQuery} WHERE m.tournament_id=? ORDER BY m.round,m.kickoff,m.id`,
    id,
  );
