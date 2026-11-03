import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createServer } from "node:net";
import { createApp } from "../server/app.js";
import { openDatabase, one } from "../server/db.js";
import { seedDemo } from "../server/seed.js";
import { enqueueSchedule, mailService } from "../server/mail.js";

test("Teljes API folyamat: belépés, CRUD, szerepkörök, CSRF, ütközés, sorsolás, lezárás és értesítés", async (t) => {
  const db = openDatabase(":memory:");
  seedDemo(db);
  const { app } = createApp(db);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const client = () => {
    let cookie = "",
      csrf = "";
    return {
      async request(
        path: string,
        method = "GET",
        body?: unknown,
        withCsrf = true,
      ) {
        const res = await fetch(base + path, {
          method,
          headers: {
            "Content-Type": "application/json",
            Cookie: cookie,
            ...(withCsrf ? { "X-CSRF-Token": csrf } : {}),
          },
          body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
        });
        const set = res.headers.get("set-cookie");
        if (set) cookie = set.split(";")[0];
        const data = await res.json();
        if (data.csrf) csrf = data.csrf;
        return { status: res.status, data };
      },
    };
  };
  const org = client(),
    captain = client(),
    other = client();
  let tournamentId = 0,
    teamIds: number[] = [],
    matchId = 0;
  try {
    await t.test("Jogosulatlan kérés és hibás jelszó elutasítva", async () => {
      assert.equal((await org.request("/tournaments")).status, 401);
      assert.equal(
        (
          await org.request("/auth/login", "POST", {
            email: "szervezo@tournament.local",
            password: "rossz",
          })
        ).status,
        401,
      );
    });
    await t.test("Session cookie és szerepek belépés után", async () => {
      const login = await org.request("/auth/login", "POST", {
        email: "szervezo@tournament.local",
        password: "Szervezo123!",
      });
      assert.equal(login.status, 200);
      assert.equal(login.data.user.role, "organizer");
      assert.ok(!login.data.user.password_hash);
      await captain.request("/auth/login", "POST", {
        email: "kapitany@tournament.local",
        password: "Kapitany123!",
      });
      await other.request("/auth/login", "POST", {
        email: "anna@tournament.local",
        password: "Kapitany123!",
      });
    });
    await t.test(
      "A 12 alapcsapatból azonnal 66 ütközésmentes mérkőzés sorsolható, 11 fordulóban",
      async () => {
        let result = await org.request("/tournaments/1/dashboard");
        assert.equal(result.data.tournament.name, "Megyei bajnokság");
        assert.equal(result.data.teams.length, 12);
        assert.equal(result.data.matches.length, 0);
        const draw = {
          start: "2026-11-01T10:00:00Z",
          interval_days: 7,
          venue: "Sportpálya",
        };
        assert.equal(
          (await org.request("/tournaments/1/draw", "POST", draw)).status,
          201,
        );
        result = await org.request("/tournaments/1/dashboard");
        assert.equal(result.data.matches.length, 66);
        const pairs = new Set<string>();
        for (let round = 1; round <= 11; round++) {
          const matches = result.data.matches.filter(
            (m: { round: number }) => m.round === round,
          );
          assert.equal(matches.length, 6);
          const participants = matches.flatMap(
            (m: { home_id: number; away_id: number }) => [m.home_id, m.away_id],
          );
          assert.equal(new Set(participants).size, 12);
          for (const m of matches)
            pairs.add([m.home_id, m.away_id].sort((a, b) => a - b).join(":"));
        }
        assert.equal(pairs.size, 66);
        assert.ok(
          result.data.standings.every(
            (r: { played: number; points: number }) =>
              r.played === 0 && r.points === 0,
          ),
        );
        assert.equal(
          (await org.request("/tournaments/1/draw", "POST", draw)).status,
          409,
        );
      },
    );
    await t.test("CSRF és szervezői API védett", async () => {
      assert.equal(
        (await org.request("/tournaments", "POST", {}, false)).status,
        403,
      );
      assert.equal(
        (await captain.request("/tournaments", "POST", { name: "Nincs jog" }))
          .status,
        403,
      );
      assert.equal((await captain.request("/captains")).status, 403);
    });
    await t.test(
      "Részletes beállítások mentése, érvényesítése, oda-visszavágós menetrend és pontozásfrissítés",
      async () => {
        const settings = {
          name: "Egyedi szabályok",
          season: "2026",
          location: "Sportpálya",
          sport: "Labdarúgás",
          win_points: 5,
          draw_points: 2,
          loss_points: -1,
          tie_breaker: "wins",
          round_robin_legs: 2,
          round_interval_days: 4,
          max_teams: 4,
        };
        const created = await org.request("/tournaments", "POST", settings);
        assert.equal(created.status, 201);
        const tid = created.data.id;
        for (let i = 0; i < 4; i++)
          assert.equal(
            (
              await captain.request(`/tournaments/${tid}/teams`, "POST", {
                name: `Egyedi ${i}`,
                short_name: `E${i}`,
                color: "#123456",
              })
            ).status,
            201,
          );
        assert.equal(
          (
            await captain.request(`/tournaments/${tid}/teams`, "POST", {
              name: "Ötödik",
              short_name: "E5",
              color: "#123456",
            })
          ).status,
          400,
        );
        let response = await org.request(`/tournaments/${tid}/dashboard`);
        assert.equal(response.data.tournament.win_points, 5);
        assert.equal(response.data.tournament.round_robin_legs, 2);
        assert.equal(
          (
            await org.request(`/tournaments/${tid}/draw`, "POST", {
              start: "2026-11-01T10:00:00Z",
              venue: "Pálya",
            })
          ).status,
          201,
        );
        response = await org.request(`/tournaments/${tid}/dashboard`);
        assert.equal(response.data.matches.length, 12);
        const first = response.data.matches[0],
          secondRound = response.data.matches.find(
            (m: { round: number }) => m.round === 2,
          );
        assert.equal(
          (Date.parse(secondRound.kickoff) - Date.parse(first.kickoff)) /
            86400000,
          4,
        );
        const reverse = response.data.matches.find(
          (m: { home_id: number; away_id: number }) =>
            m.home_id === first.away_id && m.away_id === first.home_id,
        );
        assert.equal(reverse.round, first.round + 3);
        assert.equal(
          (
            await org.request(`/matches/${first.id}/result`, "PUT", {
              home_score: 2,
              away_score: 0,
              status: "final",
              version: first.version,
            })
          ).status,
          200,
        );
        response = await org.request(`/tournaments/${tid}/dashboard`);
        assert.equal(
          response.data.standings.find(
            (r: { team_id: number }) => r.team_id === first.home_id,
          ).points,
          5,
        );
        assert.equal(
          response.data.standings.find(
            (r: { team_id: number }) => r.team_id === first.away_id,
          ).points,
          -1,
        );
        assert.equal(
          (
            await org.request(`/tournaments/${tid}`, "PUT", {
              win_points: 7,
              loss_points: -2,
            })
          ).status,
          200,
        );
        response = await org.request(`/tournaments/${tid}/dashboard`);
        assert.equal(
          response.data.standings.find(
            (r: { team_id: number }) => r.team_id === first.home_id,
          ).points,
          7,
        );
        assert.equal(
          response.data.standings.find(
            (r: { team_id: number }) => r.team_id === first.away_id,
          ).points,
          -2,
        );
        assert.equal(response.data.tournament.max_teams, 4);
        assert.equal(response.data.matches.length, 12);
        assert.equal(
          (await org.request(`/tournaments/${tid}`, "PUT", { max_teams: 3 }))
            .status,
          409,
        );
        assert.equal(
          (
            await org.request(`/tournaments/${tid}`, "PUT", {
              win_points: 0,
              draw_points: 1,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await org.request(`/tournaments/${tid}`, "PUT", {
              round_robin_legs: 3,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await captain.request(`/tournaments/${tid}`, "PUT", {
              win_points: 8,
            })
          ).status,
          403,
        );
      },
    );
    await t.test("Új bajnokság és kapitányi csapatok", async () => {
      const r = await org.request("/tournaments", "POST", {
        name: "Teszt Kupa",
        season: "2026",
        location: "Campus",
        sport: "Labdarúgás",
      });
      assert.equal(r.status, 201);
      tournamentId = r.data.id;
      for (let i = 0; i < 3; i++) {
        const r = await (i === 1 ? other : captain).request(
          `/tournaments/${tournamentId}/teams`,
          "POST",
          {
            name: `Teszt ${i}`,
            short_name: `T${i}`,
            color: "#336644",
            captain_id: 1,
          },
        );
        assert.equal(r.status, 201);
        teamIds.push(r.data.id);
      }
      const row = one<{ captain_id: number }>(
        db,
        "SELECT captain_id FROM teams WHERE id=?",
        teamIds[0],
      );
      assert.equal(
        row!.captain_id,
        2,
        "Kapitány nem adhatja át a tulajdont kérésmanipulációval.",
      );
    });
    await t.test(
      "Más kapitány csapata védett; játékos CRUD és mezszám egyediség",
      async () => {
        assert.equal(
          (
            await captain.request(`/teams/${teamIds[1]}`, "PUT", {
              name: "Átírva",
              short_name: "X",
              color: "#000000",
            })
          ).status,
          403,
        );
        const p = await captain.request(
          `/teams/${teamIds[0]}/players`,
          "POST",
          { name: "Teszt Játékos", number: 10, position: "Csatár" },
        );
        assert.equal(p.status, 201);
        assert.equal(
          (
            await captain.request(`/teams/${teamIds[0]}/players`, "POST", {
              name: "Dupla",
              number: 10,
              position: "Kapus",
            })
          ).status,
          409,
        );
        assert.equal(
          (await other.request(`/players/${p.data.id}`, "DELETE")).status,
          403,
        );
        assert.equal(
          (
            await captain.request(`/players/${p.data.id}`, "PUT", {
              name: "Módosított",
              number: 11,
              position: "Védő",
            })
          ).status,
          200,
        );
        assert.equal(
          (await captain.request(`/players/${p.data.id}`, "DELETE")).status,
          200,
        );
      },
    );
    await t.test("Kézi meccs és keresztoldali ütközés: HTTP 409", async () => {
      const body = {
        home_id: teamIds[0],
        away_id: teamIds[1],
        round: 1,
        kickoff: "2026-11-01T10:00:00Z",
        venue: "Pálya",
      };
      const r = await org.request(
        `/tournaments/${tournamentId}/matches`,
        "POST",
        body,
      );
      assert.equal(r.status, 201);
      matchId = r.data.id;
      assert.equal(
        (
          await org.request(`/tournaments/${tournamentId}/matches`, "POST", {
            ...body,
            home_id: teamIds[2],
            away_id: teamIds[0],
          })
        ).status,
        409,
      );
      assert.equal(
        (await org.request(`/teams/${teamIds[0]}`, "DELETE")).status,
        409,
      );
      assert.equal(
        (
          await org.request(`/tournaments/${tournamentId}/draw`, "POST", {
            start: body.kickoff,
            interval_days: 7,
            venue: "Campus",
          })
        ).status,
        409,
      );
    });
    await t.test(
      "Kapitány draft; final csak szervező; stale version tiltva; tabella csak final",
      async () => {
        const body = {
          home_score: 3,
          away_score: 1,
          status: "draft",
          version: 1,
        };
        assert.equal(
          (
            await captain.request(`/matches/${matchId}/result`, "PUT", {
              ...body,
              status: "final",
            })
          ).status,
          403,
        );
        assert.equal(
          (await captain.request(`/matches/${matchId}/result`, "PUT", body))
            .status,
          200,
        );
        let d = await org.request(`/tournaments/${tournamentId}/dashboard`);
        assert.equal(
          d.data.standings.reduce(
            (s: number, r: { points: number }) => s + r.points,
            0,
          ),
          0,
        );
        assert.equal(
          (
            await org.request(`/matches/${matchId}/result`, "PUT", {
              ...body,
              status: "final",
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await org.request(`/matches/${matchId}/result`, "PUT", {
              ...body,
              status: "final",
              version: 2,
            })
          ).status,
          200,
        );
        d = await org.request(`/tournaments/${tournamentId}/dashboard`);
        assert.equal(d.data.standings[0].points, 3);
        assert.equal(d.data.standings[0].goals_for, 3);
        assert.equal(
          (
            await captain.request(`/matches/${matchId}/result`, "PUT", {
              ...body,
              version: 3,
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await org.request(`/matches/${matchId}/result`, "PUT", {
              ...body,
              version: 3,
            })
          ).status,
          200,
        );
        d = await org.request(`/tournaments/${tournamentId}/dashboard`);
        assert.equal(d.data.standings[0].points, 0);
        assert.equal(
          (
            await org.request(`/matches/${matchId}/result`, "PUT", {
              ...body,
              home_score: -1,
              version: 4,
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "Páratlan sorsolás új bajnokságban, ismétlés nélkül",
      async () => {
        const r = await org.request("/tournaments", "POST", {
          name: "Páratlan Kupa",
          season: "2026",
          location: "Campus",
          sport: "Labdarúgás",
        });
        const tid = r.data.id;
        for (let i = 0; i < 3; i++)
          assert.equal(
            (
              await captain.request(`/tournaments/${tid}/teams`, "POST", {
                name: `Odd ${i}`,
                short_name: `O${i}`,
                color: "#336644",
              })
            ).status,
            201,
          );
        const draw = {
          start: "2026-11-01T10:00:00Z",
          interval_days: 7,
          venue: "Campus",
        };
        assert.equal(
          (await captain.request(`/tournaments/${tid}/draw`, "POST", draw))
            .status,
          403,
        );
        assert.equal(
          (await org.request(`/tournaments/${tid}/draw`, "POST", draw)).status,
          201,
        );
        const d = await org.request(`/tournaments/${tid}/dashboard`);
        assert.equal(d.data.matches.length, 3);
        assert.equal(
          new Set(d.data.matches.map((m: { round: number }) => m.round)).size,
          3,
        );
        assert.equal(
          (await org.request(`/tournaments/${tid}/draw`, "POST", draw)).status,
          409,
        );
      },
    );
    await t.test(
      "Értesítések tartós sorban; preview feldolgozás; kapitány csak saját leveleket lát",
      async () => {
        assert.equal(
          (await org.request("/notifications/process", "POST")).status,
          200,
        );
        const d = await captain.request(
          `/tournaments/${tournamentId}/dashboard`,
        );
        assert.ok(d.data.notifications.length > 0);
        assert.ok(
          d.data.notifications.every(
            (n: { recipient: string; status: string }) =>
              n.recipient === "kapitany@tournament.local" &&
              n.status === "preview",
          ),
        );
        assert.equal(
          (await captain.request("/notifications/process", "POST")).status,
          403,
        );
      },
    );
    await t.test(
      "Kapitányi regisztráció, bemenetvalidálás és kijelentkezés",
      async () => {
        const c = client();
        const r = await c.request("/auth/register", "POST", {
          name: "Új Kapitány",
          email: "uj@example.test",
          password: "HosszuJelszo123!",
          role: "organizer",
        });
        assert.equal(r.status, 200);
        assert.equal(r.data.user.role, "captain");
        assert.equal(
          (
            await c.request("/auth/register", "POST", {
              name: "Új",
              email: "uj@example.test",
              password: "HosszuJelszo123!",
            })
          ).status,
          409,
        );
        assert.equal((await c.request("/auth/logout", "POST")).status, 200);
        assert.equal((await c.request("/tournaments")).status, 401);
      },
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
});

test("Külső SMTP adapter valódi SMTP protokollal, helyi tesztszerveren; sikertelen küldés állapota", async () => {
  let received = "";
  const smtp = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("220 localhost ESMTP\r\n");
    let buf = "",
      inData = false;
    socket.on("data", (chunk) => {
      buf += chunk;
      let end: number;
      while ((end = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, end);
        buf = buf.slice(end + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            socket.write("250 OK queued\r\n");
          } else received += line + "\n";
        } else if (line.startsWith("EHLO"))
          socket.write("250-localhost\r\n250 8BITMIME\r\n");
        else if (line.startsWith("MAIL") || line.startsWith("RCPT"))
          socket.write("250 OK\r\n");
        else if (line === "DATA") {
          inData = true;
          socket.write("354 End with dot\r\n");
        } else if (line === "QUIT") {
          socket.end("221 Bye\r\n");
        } else socket.write("250 OK\r\n");
      }
    });
  });
  smtp.listen(0, "127.0.0.1");
  await new Promise<void>((r) => smtp.once("listening", r));
  const db = openDatabase(":memory:");
  seedDemo(db);
  enqueueSchedule(db, 1);
  try {
    const mailer = mailService(db, {
      mode: "smtp",
      host: "127.0.0.1",
      port: (smtp.address() as AddressInfo).port,
      from: "test@example.test",
      allowReservedRecipients: true,
    });
    await mailer.process();
    assert.equal(
      one<{ n: number }>(
        db,
        "SELECT COUNT(*) n FROM notifications WHERE status='sent'",
      )!.n,
      12,
    );
    assert.ok(received.includes("Subject:"));
    assert.ok(received.includes("kapitany@tournament.local"));
    enqueueSchedule(db, 1);
    await mailService(db, { mode: "smtp" }).process();
    assert.equal(
      one<{ n: number }>(
        db,
        "SELECT COUNT(*) n FROM notifications WHERE status='failed'",
      )!.n,
      12,
    );
  } finally {
    db.close();
    await new Promise<void>((r) => smtp.close(() => r()));
  }
});
