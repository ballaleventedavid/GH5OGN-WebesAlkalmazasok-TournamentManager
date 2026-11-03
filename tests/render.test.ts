import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { openDatabase, one } from "../server/db.js";
import { seedDemo } from "../server/seed.js";
import { getMatches, getTeams } from "../server/queries.js";
import { roundRobin, standings } from "../server/domain.js";
import type { DashboardData, Tournament, User } from "../shared/types.js";
import { Overview } from "../src/pages/Overview.js";
import { Teams } from "../src/pages/Teams.js";
import { Matches } from "../src/pages/Matches.js";
import { Standings } from "../src/pages/Standings.js";
import { Notifications } from "../src/pages/Notifications.js";
import { Settings } from "../src/pages/Settings.js";
import { Login } from "../src/components/Login.js";

test("Frontend futásidejű render: minden oldal valódi kezdőadatokból, szervező és kapitány szereppel", () => {
  const db = openDatabase(":memory:");
  seedDemo(db);
  try {
    const teams = getTeams(db, 1),
      matches = getMatches(db, 1);
    const data: DashboardData = {
      tournament: one<Tournament>(db, "SELECT * FROM tournaments WHERE id=1")!,
      teams,
      matches,
      standings: standings(teams, matches),
      notifications: [],
      audit: [],
      mailMode: "preview",
    };
    for (const role of ["organizer", "captain"] as const) {
      const user: User = {
        id: role === "organizer" ? 1 : 2,
        name: "Teszt Elek",
        email: "test@example.test",
        role,
      };
      const noOp = () => {};
      const pages = [
        createElement(Overview, {
          data,
          user,
          organizer: role === "organizer",
          go: noOp,
          open: noOp,
        }),
        createElement(Teams, {
          data,
          user,
          query: "",
          setQuery: noOp,
          open: noOp,
          remove: noOp,
        }),
        createElement(Matches, {
          data,
          user,
          query: "",
          setQuery: noOp,
          open: noOp,
          remove: noOp,
        }),
        createElement(Standings, { data }),
        createElement(Notifications, {
          data,
          organizer: role === "organizer",
          open: noOp,
          action: async () => {},
        }),
        createElement(Settings, { data, user, open: noOp }),
      ];
      const expectedContent = [
        "Megyei bajnokság",
        "Boldva SE",
        "Még nincs mérkőzés",
        "Bajnoki tabella",
        "Értesítések",
        "Bajnokság adatai",
      ];
      for (const [index, page] of pages.entries()) {
        const html = renderToStaticMarkup(page);
        assert.ok(
          html.includes(expectedContent[index]),
          `${role}: ${expectedContent[index]}`,
        );
        assert.ok(!html.includes("undefined"));
        assert.doesNotMatch(
          html,
          /NB I|league-art-nb|Ferencváros|Puskás Akadémia/,
        );
      }
    }
    // A fordulólista kitöltött állapotban is az összes párosítást mutatja.
    const insert = db.prepare(
      "INSERT INTO matches(tournament_id,round,home_id,away_id,kickoff,venue) VALUES(1,?,?,?,?,?)",
    );
    for (const match of roundRobin(
      teams.map((team) => team.id),
      false,
    )) {
      insert.run(
        match.round,
        match.home,
        match.away,
        "2026-11-01T14:00:00.000Z",
        "Sportpálya",
      );
    }
    db.exec(
      "UPDATE matches SET status='final',home_score=2,away_score=1 WHERE id=1; UPDATE matches SET status='draft',home_score=0,away_score=0 WHERE id=2;",
    );
    data.matches = getMatches(db, 1);
    data.standings = standings(teams, data.matches, data.tournament);
    const scheduledHtml = renderToStaticMarkup(
      createElement(Overview, {
        data,
        organizer: true,
        user: {
          id: 1,
          name: "Szervező",
          email: "test@example.test",
          role: "organizer",
        },
        go: () => {},
        open: () => {},
      }),
    );
    assert.equal(
      (scheduledHtml.match(/class="overview-fixture"/g) || []).length,
      6,
    );
    assert.match(scheduledHtml, /Lezárt/);
    assert.match(scheduledHtml, /Jóváhagyásra vár/);
    assert.match(scheduledHtml, /Ütemezett/);
    assert.match(
      renderToStaticMarkup(
        createElement(Login, { initialError: "", onLogin: () => {} }),
      ),
      /Bejelentkezés/,
    );
  } finally {
    db.close();
  }
});
