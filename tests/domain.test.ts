import { test } from "node:test";
import assert from "node:assert/strict";
import { roundRobin, standings } from "../server/domain.js";
import { openDatabase, transaction, one } from "../server/db.js";
import { seedDemo } from "../server/seed.js";

test("Sorsolás 2–32 csapatra: minden pár egyszer, fordulónként csapatonként legfeljebb egy mérkőzés", () => {
  for (let n = 2; n <= 32; n++)
    for (const shuffle of [false, true]) {
      const ids = Array.from({ length: n }, (_, i) => i + 1),
        draw = roundRobin(ids, shuffle);
      assert.equal(draw.length, (n * (n - 1)) / 2);
      assert.equal(
        new Set(
          draw.map((m) => [m.home, m.away].sort((a, b) => a - b).join(":")),
        ).size,
        draw.length,
      );
      const rounds = new Set(draw.map((m) => m.round));
      assert.equal(rounds.size, n % 2 ? n : n - 1);
      for (const r of rounds) {
        const participants = draw
          .filter((m) => m.round === r)
          .flatMap((m) => [m.home, m.away]);
        assert.equal(new Set(participants).size, participants.length);
        assert.equal(participants.length, Math.floor(n / 2) * 2);
      }
      assert.deepEqual(
        ids,
        Array.from({ length: n }, (_, i) => i + 1),
        "A bemenet nem módosul.",
      );
    }
});
test("Hibás sorsolási bemenet elutasítva", () => {
  assert.throws(() => roundRobin([1]));
  assert.throws(() => roundRobin([1, 1]));
});
test("Tabella: kizárólag lezárt eredmények, 3/1/0 pont és gólkülönbség", () => {
  const teams = [1, 2, 3].map((id) => ({
    id,
    name: `Csapat ${id}`,
    short_name: `C${id}`,
    color: "#336644",
  }));
  const match = (
    id: number,
    home_id: number,
    away_id: number,
    home_score: number,
    away_score: number,
    status: "draft" | "final",
  ) => ({
    id,
    home_id,
    away_id,
    home_score,
    away_score,
    status,
    kickoff: `2026-10-${id + 10}T12:00:00Z`,
  });
  const rows = standings(teams, [
    match(1, 1, 2, 3, 1, "final"),
    match(2, 2, 3, 2, 2, "final"),
    match(3, 1, 3, 99, 0, "draft"),
  ]);
  assert.equal(rows[0].team_id, 1);
  assert.equal(rows[0].points, 3);
  assert.equal(rows[0].played, 1);
  assert.equal(rows[0].goals_for, 3);
  assert.equal(rows[0].difference, 2);
  assert.equal(rows[0].form[0], "W");
  assert.equal(rows.find((r) => r.team_id === 2)!.points, 1);
  assert.equal(rows.find((r) => r.team_id === 2)!.played, 2);
  assert.equal(rows.find((r) => r.team_id === 2)!.lost, 1);
  assert.equal(
    rows.reduce((s, r) => s + r.goals_for, 0),
    rows.reduce((s, r) => s + r.goals_against, 0),
  );
});
test("Visszanyitás után az eredmény kikerül a tabellából", () => {
  const teams = [
    { id: 1, name: "A", short_name: "A", color: "#000000" },
    { id: 2, name: "B", short_name: "B", color: "#000000" },
  ];
  const m = {
    id: 1,
    home_id: 1,
    away_id: 2,
    home_score: 2,
    away_score: 1,
    status: "draft" as const,
    kickoff: "2026-10-01T10:00:00Z",
  };
  assert.equal(
    standings(teams, [m]).reduce((s, r) => s + r.points, 0),
    0,
  );
});
test("Adatbázis: keresztoldali fordulóütközés INSERT és UPDATE esetén is tiltott, rollback megőrzi a régi foglalást", () => {
  const db = openDatabase(":memory:");
  try {
    seedDemo(db);
    const insert = db.prepare(
      "INSERT INTO matches(tournament_id,round,home_id,away_id,kickoff,venue) VALUES(1,?,?,?,?,?)",
    );
    insert.run(100, 1, 2, "2026-11-01T10:00:00Z", "Pálya");
    assert.throws(
      () => insert.run(100, 3, 1, "2026-11-01T12:00:00Z", "Pálya"),
      /UNIQUE/,
    );
    const m = insert.run(101, 3, 4, "2026-11-08T10:00:00Z", "Pálya");
    assert.throws(
      () =>
        db
          .prepare("UPDATE matches SET round=100,away_id=2 WHERE id=?")
          .run(m.lastInsertRowid),
      /UNIQUE/,
    );
    assert.equal(
      one<{ n: number }>(
        db,
        "SELECT COUNT(*) n FROM match_slots WHERE match_id=?",
        m.lastInsertRowid,
      )!.n,
      2,
    );
    assert.throws(
      () =>
        transaction(db, () => {
          insert.run(102, 1, 2, "2026-11-15T10:00:00Z", "Pálya");
          insert.run(102, 2, 3, "2026-11-15T10:00:00Z", "Pálya");
        }),
      /UNIQUE/,
    );
    assert.equal(
      one<{ n: number }>(db, "SELECT COUNT(*) n FROM matches WHERE round=102")!
        .n,
      0,
    );
  } finally {
    db.close();
  }
});
test("Adatbázis: önmaga ellen, más bajnokság csapata és hibás lezárt eredmény tiltott", () => {
  const db = openDatabase(":memory:");
  try {
    seedDemo(db);
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO matches(tournament_id,round,home_id,away_id,kickoff,venue) VALUES(1,10,1,1,'2026-11-01','Pálya')",
          )
          .run(),
      /CHECK/,
    );
    db.prepare(
      "INSERT INTO matches(tournament_id,round,home_id,away_id,kickoff,venue) VALUES(1,100,1,2,'2026-11-01T10:00:00Z','Pálya')",
    ).run();
    assert.throws(
      () =>
        db
          .prepare(
            "UPDATE matches SET status='final',home_score=NULL WHERE id=1",
          )
          .run(),
      /CHECK/,
    );
    db.prepare(
      "INSERT INTO tournaments(name,season,location) VALUES('Másik','2026','Itt')",
    ).run();
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO matches(tournament_id,round,home_id,away_id,kickoff,venue) VALUES(2,1,1,2,'2026-11-01','Pálya')",
          )
          .run(),
      /FOREIGN KEY/,
    );
  } finally {
    db.close();
  }
});
