import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase, one, all } from "../server/db.js";
import { seedDemo } from "../server/seed.js";
import { standings } from "../server/domain.js";
import { getTeams, getMatches } from "../server/queries.js";
test("Megyei bajnokság: 12 falusi csapat, 264 játékos, üres menetrend és idempotens kezdőadatok", () => {
  const db = openDatabase(":memory:");
  try {
    seedDemo(db);
    seedDemo(db);
    const count = (table: string) =>
      one<{ n: number }>(db, `SELECT COUNT(*) n FROM ${table}`)!.n;
    assert.equal(count("tournaments"), 1);
    assert.equal(count("teams"), 12);
    assert.equal(count("players"), 264);
    assert.equal(count("matches"), 0);
    assert.equal(count("match_slots"), 0);
    assert.equal(count("notifications"), 0);
    assert.equal(
      one<{ name: string }>(db, "SELECT name FROM tournaments WHERE id=1")!
        .name,
      "Megyei bajnokság",
    );
    const teams = getTeams(db, 1);
    assert.ok(teams.some((t) => t.name === "Boldva SE"));
    assert.ok(teams.some((t) => t.name === "Borsodszirák SE"));
    assert.ok(teams.every((t) => t.player_count === 22));
    const rows = standings(teams, getMatches(db, 1));
    assert.equal(rows.length, 12);
    assert.ok(rows.every((r) => r.played === 0 && r.points === 0));
  } finally {
    db.close();
  }
});
