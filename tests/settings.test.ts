import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { standings, roundRobin } from "../server/domain.js";
import { migrateTournamentSettings, openDatabase, one } from "../server/db.js";
import { defaultTournamentSettings, scheduleSize } from "../shared/settings.js";

const teams = [1, 2, 3, 4].map((id) => ({
  id,
  name: `Csapat ${id}`,
  short_name: `C${id}`,
  color: "#123456",
}));
const match = (
  id: number,
  home_id: number,
  away_id: number,
  home_score: number,
  away_score: number,
  status: "final" | "draft" = "final",
) => ({
  id,
  home_id,
  away_id,
  home_score,
  away_score,
  status,
  kickoff: `2026-11-${String(id).padStart(2, "0")}T10:00:00Z`,
});

test("Egyedi pontozás: győzelem, döntetlen és negatív vereségpont csak lezárt eredményekből", () => {
  const rows = standings(
    teams,
    [match(1, 1, 2, 2, 0), match(2, 2, 3, 1, 1), match(3, 1, 3, 9, 0, "draft")],
    { win_points: 5, draw_points: 2, loss_points: -1 },
  );
  assert.equal(rows.find((r) => r.team_id === 1)!.points, 5);
  assert.equal(rows.find((r) => r.team_id === 2)!.points, 1);
  assert.equal(rows.find((r) => r.team_id === 3)!.points, 2);
  assert.equal(rows.find((r) => r.team_id === 4)!.played, 0);
  assert.equal(
    standings(teams, [match(1, 1, 2, 2, 0)], {
      win_points: 7,
      loss_points: -2,
    }).find((r) => r.team_id === 1)!.points,
    7,
  );
});

test("Választható holtversenyszabály: győzelmek vagy gólkülönbség dönti el az azonos pontszámot", () => {
  const matches = [
    match(1, 1, 3, 1, 0),
    match(2, 1, 4, 0, 6),
    match(3, 2, 3, 1, 1),
    match(4, 2, 4, 0, 0),
  ];
  const byDifference = standings(teams, matches, {
    win_points: 2,
    tie_breaker: "goal_difference",
  });
  const byWins = standings(teams, matches, {
    win_points: 2,
    tie_breaker: "wins",
  });
  assert.ok(
    byDifference.findIndex((r) => r.team_id === 2) <
      byDifference.findIndex((r) => r.team_id === 1),
  );
  assert.ok(
    byWins.findIndex((r) => r.team_id === 1) <
      byWins.findIndex((r) => r.team_id === 2),
  );
});

test("Oda-visszavágós sorsolás: páratlan és páros csapatszámnál fordított pályaválasztás és ütközésmentes fordulók", () => {
  for (const n of [3, 4, 12]) {
    const draw = roundRobin(
        Array.from({ length: n }, (_, i) => i + 1),
        true,
        2,
      ),
      size = scheduleSize(n, 2);
    assert.equal(draw.length, size.matches);
    assert.equal(new Set(draw.map((m) => m.round)).size, size.rounds);
    const firstLegRounds = size.rounds / 2;
    for (const m of draw.filter((m) => m.round <= firstLegRounds))
      assert.ok(
        draw.some(
          (other) =>
            other.home === m.away &&
            other.away === m.home &&
            other.round === m.round + firstLegRounds,
        ),
      );
    for (let r = 1; r <= size.rounds; r++) {
      const ids = draw
        .filter((m) => m.round === r)
        .flatMap((m) => [m.home, m.away]);
      assert.equal(new Set(ids).size, ids.length);
    }
  }
});

test("V1 adatbázis migrációja megőrzi a bajnokságot és hitelesítést, alapértékekkel bővít és egyszer nevez át", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT,password_hash TEXT,role TEXT);
   CREATE TABLE tournaments(id INTEGER PRIMARY KEY,name TEXT,season TEXT,location TEXT,sport TEXT);
   CREATE TABLE audit(id INTEGER PRIMARY KEY,actor TEXT);
   INSERT INTO users VALUES(1,'Kovács Dániel','szervezo@tournament.local','eredeti-hash','organizer');
   INSERT INTO tournaments VALUES(1,'Saját bajnokság','2026','Sportpálya','Labdarúgás');
   INSERT INTO audit VALUES(1,'Kovács Dániel'); PRAGMA user_version=1;`);
    migrateTournamentSettings(db);
    const row = db.prepare("SELECT * FROM tournaments WHERE id=1").get()!;
    assert.equal(row.name, "Saját bajnokság");
    for (const [key, value] of Object.entries(defaultTournamentSettings))
      assert.equal(row[key], value);
    assert.equal(
      db.prepare("SELECT name FROM users WHERE id=1").get()!.name,
      "Szervező",
    );
    assert.equal(
      db.prepare("SELECT password_hash FROM users WHERE id=1").get()!
        .password_hash,
      "eredeti-hash",
    );
    assert.equal(
      db.prepare("SELECT actor FROM audit WHERE id=1").get()!.actor,
      "Szervező",
    );
    db.prepare("UPDATE tournaments SET win_points=9 WHERE id=1").run();
    migrateTournamentSettings(db);
    assert.equal(
      db.prepare("SELECT win_points FROM tournaments WHERE id=1").get()!
        .win_points,
      9,
    );
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 2);
  } finally {
    db.close();
  }
});

test("Az új beállítások adatbázisoldali korlátai védik az érvénytelen értékeket", () => {
  const db = openDatabase(":memory:");
  try {
    db.prepare(
      "INSERT INTO tournaments(name,season,location) VALUES('Kupa','2026','Pálya')",
    ).run();
    assert.throws(
      () =>
        db
          .prepare("UPDATE tournaments SET round_robin_legs=3 WHERE id=1")
          .run(),
      /CHECK/,
    );
    assert.throws(
      () => db.prepare("UPDATE tournaments SET max_teams=1 WHERE id=1").run(),
      /CHECK/,
    );
    assert.throws(
      () =>
        db
          .prepare("UPDATE tournaments SET round_interval_days=0 WHERE id=1")
          .run(),
      /CHECK/,
    );
    assert.equal(
      one<{ win_points: number }>(
        db,
        "SELECT win_points FROM tournaments WHERE id=1",
      )!.win_points,
      3,
    );
  } finally {
    db.close();
  }
});
