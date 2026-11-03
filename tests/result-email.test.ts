import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { SendMailOptions } from "nodemailer";
import { createApp } from "../server/app.js";
import { openDatabase, transaction } from "../server/db.js";
import { enqueueResult, startMailWorker } from "../server/mail.js";
import { getMatches } from "../server/queries.js";
import { seedDemo } from "../server/seed.js";
import type { Notification } from "../shared/types.js";

function fixture() {
  const db = openDatabase(":memory:");
  seedDemo(db);
  db.prepare(
    "INSERT INTO matches(tournament_id,round,home_id,away_id,kickoff,venue) VALUES(1,1,1,2,?,?)",
  ).run("2026-11-01T14:00:00Z", "Sportpálya");
  return db;
}

test("Eredménylezárás, javítás és visszanyitás automatikus levele; tervezet és változatlan mentés nem küld, hibánál nincs részleges mentés", async () => {
  const db = fixture();
  const sent: SendMailOptions[] = [];
  const { app, mailer } = createApp(db, {
    mail: {
      mode: "smtp",
      host: "smtp.bajnoksag.hu",
      user: "felado@bajnoksag.hu",
      pass: "kizarolag-teszt",
      from: "felado@bajnoksag.hu",
      recipientOverride: "cimzett@sajat.hu",
    },
    mailTransportFactory: () => ({
      verify: async () => true,
      sendMail: async (message) => {
        sent.push(message);
        return { accepted: [message.to], messageId: `result-${sent.length}` };
      },
      close: () => {},
    }),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((done) => server.once("listening", done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const client = () => {
    let cookie = "",
      csrf = "";
    return async (
      path: string,
      body: unknown,
      method = "PUT",
      withCsrf = true,
    ) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          ...(withCsrf ? { "X-CSRF-Token": csrf } : {}),
        },
        body: JSON.stringify(body),
      });
      const session = response.headers.get("set-cookie");
      if (session) cookie = session.split(";")[0];
      const data = await response.json();
      if (data.csrf) csrf = data.csrf;
      return { status: response.status, data };
    };
  };
  const org = client(),
    captain = client();
  const match = () => getMatches(db, 1)[0];
  const letters = () =>
    db
      .prepare("SELECT * FROM notifications ORDER BY id")
      .all() as unknown as Notification[];
  const save = async (
    status: "draft" | "final",
    home: number,
    away: number,
    expected = 200,
  ) => {
    const response = await org("/matches/1/result", {
      status,
      home_score: home,
      away_score: away,
      version: match().version,
    });
    assert.equal(response.status, expected);
  };
  const automaticSend = async (expected: number) => {
    const stop = startMailWorker(mailer, 10);
    try {
      const deadline = Date.now() + 2000;
      while ((sent.length < expected || mailer.busy()) && Date.now() < deadline)
        await new Promise((done) => setTimeout(done, 10));
      assert.equal(sent.length, expected);
      assert.ok(
        letters().every((letter) => letter.status === "sent" && letter.sent_at),
      );
    } finally {
      stop();
    }
  };
  try {
    await org(
      "/auth/login",
      { email: "szervezo@tournament.local", password: "Szervezo123!" },
      "POST",
    );
    await captain(
      "/auth/login",
      { email: "kapitany@tournament.local", password: "Kapitany123!" },
      "POST",
    );
    const body = { status: "final", home_score: 2, away_score: 1, version: 1 };
    assert.equal((await captain("/matches/1/result", body)).status, 403);
    assert.equal(
      (await org("/matches/1/result", body, "PUT", false)).status,
      403,
    );
    await save("draft", 2, 1);
    assert.equal(letters().length, 0);
    assert.equal((await org("/matches/1/result", body)).status, 409);
    await save("final", -1, 1, 400);
    assert.equal(letters().length, 0);
    await save("final", 2, 1);
    assert.equal(letters().length, 1);
    assert.equal(letters()[0].recipient, "cimzett@sajat.hu");
    assert.match(letters()[0].subject, /Megyei bajnokság – eredmény lezárva/);
    assert.ok(
      letters()[0].body.includes(`${match().home_name} – ${match().away_name}`),
    );
    assert.match(letters()[0].body, /Végeredmény: 2–1/);
    assert.match(letters()[0].body, /1\. forduló/);
    await automaticSend(1);
    assert.ok(sent[0].html && sent[0].text);
    await save("final", 2, 1);
    assert.equal(letters().length, 1);
    await save("final", 2, 2);
    assert.match(letters()[1].subject, /lezárt eredmény javítva/);
    assert.match(letters()[1].body, /Végeredmény: 2–2/);
    assert.match(letters()[1].body, /Korábbi eredmény: 2–1/);
    await automaticSend(2);
    await save("draft", 0, 0);
    assert.match(letters()[2].subject, /eredmény visszanyitva/);
    assert.match(letters()[2].body, /2–2 eredményt visszanyitották/);
    assert.match(letters()[2].body, /nem számít bele a tabellába/);
    assert.doesNotMatch(letters()[2].body, /Végeredmény: 0–0/);
    await automaticSend(3);
    await save("draft", 3, 3);
    assert.equal(letters().length, 3);
    await save("final", 3, 3);
    assert.match(letters()[3].subject, /eredmény lezárva/);
    await automaticSend(4);

    const before = match();
    const auditCount = db.prepare("SELECT COUNT(*) n FROM audit").get()!.n;
    db.exec(
      "CREATE TEMP TRIGGER reject_result_mail BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT,'teszt levelmentesi hiba'); END;",
    );
    await save("final", 4, 3, 500);
    assert.deepEqual(match(), before);
    assert.equal(letters().length, 4);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM audit").get()!.n,
      auditCount,
    );
    db.exec("DROP TRIGGER reject_result_mail");

    // Közvetlen, tervezet nélküli lezárás is értesítést készít.
    db.exec(
      "INSERT INTO matches(tournament_id,round,home_id,away_id,kickoff,venue) VALUES(1,2,1,2,'2026-11-08T14:00:00Z','Sportpálya');",
    );
    assert.equal(
      (
        await org("/matches/2/result", {
          ...body,
          home_score: 0,
          away_score: 0,
        })
      ).status,
      200,
    );
    assert.match(letters()[4].body, /Végeredmény: 0–0/);
    await automaticSend(5);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    db.close();
  }
});

test("Eredménylevél kizárólag a két érintett csapatnak; közös címnél egy levél, értesítési cím hiányában kapitányi cím", () => {
  const db = fixture();
  const update = (home: number) => {
    const previous = getMatches(db, 1)[0];
    transaction(db, () => {
      db.prepare(
        "UPDATE matches SET status='final',home_score=?,away_score=1 WHERE id=1",
      ).run(home);
      enqueueResult(db, previous);
    });
    const recipients = db
      .prepare("SELECT recipient FROM notifications ORDER BY recipient")
      .all()
      .map((letter) => letter.recipient);
    db.exec("DELETE FROM notifications");
    return recipients;
  };
  try {
    db.exec(
      "UPDATE teams SET notification_email='mas@sajat.hu'; UPDATE teams SET notification_email='hazai@sajat.hu' WHERE id=1; UPDATE teams SET notification_email='vendeg@sajat.hu' WHERE id=2;",
    );
    assert.deepEqual(update(2), ["hazai@sajat.hu", "vendeg@sajat.hu"]);
    db.exec(
      "UPDATE teams SET notification_email='kozos@sajat.hu' WHERE id IN (1,2)",
    );
    assert.deepEqual(update(3), ["kozos@sajat.hu"]);
    const captain = db
      .prepare(
        "SELECT u.email FROM users u JOIN teams t ON t.captain_id=u.id WHERE t.id=1",
      )
      .get()!.email;
    db.exec("UPDATE teams SET notification_email=NULL WHERE id=1");
    assert.deepEqual(update(4), [captain, "kozos@sajat.hu"].sort());
  } finally {
    db.close();
  }
});
