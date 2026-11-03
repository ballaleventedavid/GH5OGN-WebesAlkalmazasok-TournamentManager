import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDatabase(path = "./data/tournament-megyei.sqlite") {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('organizer','captain'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tournaments (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, season TEXT NOT NULL, location TEXT NOT NULL,
      sport TEXT NOT NULL DEFAULT 'Labdarúgás', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY, tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      name TEXT NOT NULL COLLATE NOCASE, short_name TEXT NOT NULL, color TEXT NOT NULL,
      captain_id INTEGER NOT NULL REFERENCES users(id), UNIQUE(tournament_id,name), UNIQUE(id,tournament_id)
    );
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY, team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      name TEXT NOT NULL, number INTEGER NOT NULL CHECK(number BETWEEN 1 AND 99),
      position TEXT NOT NULL, UNIQUE(team_id,number)
    );
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY, tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      round INTEGER NOT NULL CHECK(round BETWEEN 1 AND 200), home_id INTEGER NOT NULL, away_id INTEGER NOT NULL,
      kickoff TEXT NOT NULL, venue TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','draft','final')),
      home_score INTEGER CHECK(home_score BETWEEN 0 AND 99), away_score INTEGER CHECK(away_score BETWEEN 0 AND 99),
      version INTEGER NOT NULL DEFAULT 1, CHECK(home_id <> away_id),
      CHECK((status='scheduled' AND home_score IS NULL AND away_score IS NULL) OR
            (status IN ('draft','final') AND home_score IS NOT NULL AND away_score IS NOT NULL)),
      FOREIGN KEY(home_id,tournament_id) REFERENCES teams(id,tournament_id),
      FOREIGN KEY(away_id,tournament_id) REFERENCES teams(id,tournament_id)
    );
    -- A közös egyedi kulcs hazai/vendég oldaltól függetlenül véd az ütközéstől.
    CREATE TABLE IF NOT EXISTS match_slots (
      match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      tournament_id INTEGER NOT NULL, round INTEGER NOT NULL, team_id INTEGER NOT NULL,
      PRIMARY KEY(tournament_id,round,team_id),
      FOREIGN KEY(team_id,tournament_id) REFERENCES teams(id,tournament_id)
    );
    CREATE TRIGGER IF NOT EXISTS reserve_match_slots AFTER INSERT ON matches BEGIN
      INSERT INTO match_slots VALUES(NEW.id,NEW.tournament_id,NEW.round,NEW.home_id);
      INSERT INTO match_slots VALUES(NEW.id,NEW.tournament_id,NEW.round,NEW.away_id);
    END;
    CREATE TRIGGER IF NOT EXISTS update_match_slots AFTER UPDATE OF round,home_id,away_id,tournament_id ON matches BEGIN
      DELETE FROM match_slots WHERE match_id=OLD.id;
      INSERT INTO match_slots VALUES(NEW.id,NEW.tournament_id,NEW.round,NEW.home_id);
      INSERT INTO match_slots VALUES(NEW.id,NEW.tournament_id,NEW.round,NEW.away_id);
    END;
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY, tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','preview','sent','failed')),
      error TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), sent_at TEXT, attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      actor TEXT NOT NULL, action TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS matches_tournament ON matches(tournament_id,round);
    CREATE INDEX IF NOT EXISTS teams_captain ON teams(captain_id);
  `);
  migrateTournamentSettings(db);
  migrateEmailRecipients(db);
  return db;
}
export type DB = ReturnType<typeof openDatabase>;


export function migrateEmailRecipients(db: DB) {
  const version = Number(db.prepare("PRAGMA user_version").get()!.user_version);
  if (version >= 3) return;
  transaction(db, () => {
    const columns = db.prepare("PRAGMA table_info(teams)").all();
    if (!columns.some((column) => column.name === "notification_email"))
      db.exec("ALTER TABLE teams ADD COLUMN notification_email TEXT");
    db.exec("PRAGMA user_version=3");
  });
}


export function migrateTournamentSettings(db: DB) {
  const version = Number(
    (db.prepare("PRAGMA user_version").get() as { user_version: number })
      .user_version,
  );
  if (version >= 2) return;
  transaction(db, () => {
    const columns = new Set(
      (
        db.prepare("PRAGMA table_info(tournaments)").all() as { name: string }[]
      ).map((c) => c.name),
    );
    const additions = [
      [
        "win_points",
        "INTEGER NOT NULL DEFAULT 3 CHECK(win_points BETWEEN 0 AND 20)",
      ],
      [
        "draw_points",
        "INTEGER NOT NULL DEFAULT 1 CHECK(draw_points BETWEEN 0 AND 20)",
      ],
      [
        "loss_points",
        "INTEGER NOT NULL DEFAULT 0 CHECK(loss_points BETWEEN -20 AND 20)",
      ],
      [
        "tie_breaker",
        "TEXT NOT NULL DEFAULT 'goal_difference' CHECK(tie_breaker IN ('goal_difference','wins'))",
      ],
      [
        "round_robin_legs",
        "INTEGER NOT NULL DEFAULT 1 CHECK(round_robin_legs IN (1,2))",
      ],
      [
        "round_interval_days",
        "INTEGER NOT NULL DEFAULT 7 CHECK(round_interval_days BETWEEN 1 AND 60)",
      ],
      [
        "max_teams",
        "INTEGER NOT NULL DEFAULT 32 CHECK(max_teams BETWEEN 2 AND 32)",
      ],
    ];
    for (const [name, definition] of additions)
      if (!columns.has(name))
        db.exec(`ALTER TABLE tournaments ADD COLUMN ${name} ${definition}`);
    db.prepare(
      "UPDATE users SET name='Szervező' WHERE email='szervezo@tournament.local' AND role='organizer' AND name='Kovács Dániel'",
    ).run();
    db.prepare(
      "UPDATE audit SET actor='Szervező' WHERE actor='Kovács Dániel'",
    ).run();
    db.exec("PRAGMA user_version=2");
  });
}
export function all<T>(db: DB, sql: string, ...args: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...args) as unknown as T[];
}
export function one<T>(
  db: DB,
  sql: string,
  ...args: SQLInputValue[]
): T | undefined {
  return db.prepare(sql).get(...args) as unknown as T | undefined;
}
export function transaction<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function audit(
  db: DB,
  tournamentId: number,
  actor: string,
  action: string,
) {
  db.prepare("INSERT INTO audit(tournament_id,actor,action) VALUES(?,?,?)").run(
    tournamentId,
    actor,
    action,
  );
}
