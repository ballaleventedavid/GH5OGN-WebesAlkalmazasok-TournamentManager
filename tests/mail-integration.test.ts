import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import type { AddressInfo } from "node:net";
import type { SendMailOptions } from "nodemailer";
import { createApp } from "../server/app.js";
import { openDatabase, migrateEmailRecipients } from "../server/db.js";
import { createMailSettingsStore } from "../server/mail-settings.js";
import { seedDemo } from "../server/seed.js";
import type { MailConfig, MailTransportFactory } from "../server/mail.js";
import { startMailWorker } from "../server/mail.js";

const configuration = {
  mode: "smtp" as const,
  host: "smtp.bajnoksag.hu",
  port: 465,
  secure: true,
  user: "felado@bajnoksag.hu",
  from: "felado@bajnoksag.hu",
  fromName: "TournamentManager",
  password: "kizarolag-teszthez-kitalalt-jelszo",
  recipientOverride: "cimzett@sajat.hu",
};
function temporaryStore() {
  const testRoot = resolve("data/test-artifacts");
  mkdirSync(testRoot, { recursive: true });
  const folder = mkdtempSync(join(testRoot, "tournament-smtp-tests-"));
  return {
    path: join(folder, "mail-settings.json"),
    cleanup: () => {
      const target = resolve(folder);
      assert.ok(
        target.startsWith(testRoot + sep) &&
          basename(target).startsWith("tournament-smtp-tests-"),
      );
      rmSync(target, { recursive: true, force: true });
    },
  };
}

test("SMTP-beállítások tartósak, a jelszó nem kerül a státuszba és új fiókhoz nem használható fel újra", () => {
  const file = temporaryStore();
  try {
    const store = createMailSettingsStore({ mode: "preview" }, file.path);
    store.save(configuration);
    assert.equal(store.status().configured, true);
    assert.equal(store.status().passwordSet, true);
    assert.ok(!JSON.stringify(store.status()).includes(configuration.password));
    const restarted = createMailSettingsStore({ mode: "preview" }, file.path);
    assert.equal(restarted.get().pass, configuration.password);
    assert.equal(
      restarted.status().recipientOverride,
      configuration.recipientOverride,
    );
    restarted.save({
      ...configuration,
      password: undefined,
      fromName: "Bajnokság",
    });
    assert.equal(restarted.get().pass, configuration.password);
    const persisted = readFileSync(file.path, "utf8");
    assert.throws(() =>
      restarted.save({
        ...configuration,
        host: "masik.smtp.hu",
        password: undefined,
      }),
    );
    assert.equal(readFileSync(file.path, "utf8"), persisted);
    assert.throws(() =>
      restarted.save({
        ...configuration,
        fromName: "Név\r\nBcc: idegen@pelda.hu",
      }),
    );
    assert.throws(() =>
      restarted.save({ ...configuration, host: "https://smtp.bajnoksag.hu" }),
    );
  } finally {
    file.cleanup();
  }
});

test("SMTP felületi API: jogosultság, CSRF, kapcsolat, tesztlevél, közös címzett és csapatonkénti címzés", async () => {
  const file = temporaryStore();
  const db = openDatabase(":memory:");
  seedDemo(db);
  const store = createMailSettingsStore({ mode: "preview" }, file.path);
  const sent: SendMailOptions[] = [],
    transports: MailConfig[] = [];
  let verified = 0;
  const factory: MailTransportFactory = (config) => {
    transports.push(config);
    return {
      verify: async () => {
        verified++;
        if (config.host === "bad.smtp.hu")
          throw Object.assign(new Error(`Provider detail: ${config.pass}`), {
            code: "EAUTH",
          });
        return true;
      },
      sendMail: async (message) => {
        sent.push(message);
        return { accepted: [message.to], messageId: `test-${sent.length}` };
      },
      close: () => {},
    };
  };
  const { app, mailer } = createApp(db, {
    mailSettings: store,
    mailTransportFactory: factory,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((done) => server.once("listening", done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const client = () => {
    let cookie = "",
      csrf = "";
    return async (
      path: string,
      method = "GET",
      body?: unknown,
      withCsrf = true,
    ) => {
      const result = await fetch(base + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          ...(withCsrf ? { "X-CSRF-Token": csrf } : {}),
        },
        body: method === "GET" ? undefined : JSON.stringify(body || {}),
      });
      const set = result.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      const data = await result.json();
      if (data.csrf) csrf = data.csrf;
      return { status: result.status, data };
    };
  };
  const org = client(),
    captain = client();
  let stopWorker: (() => void) | undefined;
  try {
    assert.equal((await org("/settings/email")).status, 401);
    await org("/auth/login", "POST", {
      email: "szervezo@tournament.local",
      password: "Szervezo123!",
    });
    await captain("/auth/login", "POST", {
      email: "kapitany@tournament.local",
      password: "Kapitany123!",
    });
    assert.equal((await captain("/settings/email")).status, 403);
    assert.equal((await captain("/settings/email/recipient")).status, 403);
    assert.equal(
      (
        await captain("/settings/email/recipient", "PUT", {
          recipient: "uj@sajat.hu",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await org(
          "/settings/email/recipient",
          "PUT",
          { recipient: "uj@sajat.hu" },
          false,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await org("/settings/email/recipient", "PUT", {
          recipient: "uj@sajat.hu",
        })
      ).status,
      409,
    );
    assert.equal(
      (await captain("/settings/email", "PUT", configuration)).status,
      403,
    );
    assert.equal(
      (await org("/settings/email", "PUT", configuration, false)).status,
      403,
    );
    assert.equal(
      (await org("/settings/email", "PUT", { ...configuration, password: "" }))
        .status,
      400,
    );
    const saved = await org("/settings/email", "PUT", configuration);
    assert.equal(saved.status, 200);
    assert.equal(saved.data.configured, true);
    assert.ok(!JSON.stringify(saved.data).includes(configuration.password));
    assert.ok(!("pass" in saved.data) && !("password" in saved.data));
    const originalAccount = store.get();
    assert.deepEqual((await org("/settings/email/recipient")).data, {
      recipient: configuration.recipientOverride,
    });
    assert.equal(
      (
        await org("/settings/email/recipient", "PUT", {
          recipient: "hibas-cim",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await org("/settings/email/recipient", "PUT", {
          recipient: "mintacim@example.com",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await org("/settings/email/recipient", "PUT", {
          recipient: "uj@sajat.hu",
          password: "ne-valtozzon",
        })
      ).status,
      400,
    );
    const recipientSaved = await org("/settings/email/recipient", "PUT", {
      recipient: "  UJ@Sajat.hu  ",
    });
    assert.equal(recipientSaved.status, 200);
    assert.deepEqual(recipientSaved.data, { recipient: "uj@sajat.hu" });
    assert.deepEqual(store.get(), {
      ...originalAccount,
      recipientOverride: "uj@sajat.hu",
    });
    await org("/settings/email/recipient", "PUT", {
      recipient: configuration.recipientOverride,
    });
    assert.equal((await org("/settings/email/verify", "POST")).status, 200);
    assert.equal(verified, 1);
    assert.equal(transports[0].secure, true);
    assert.equal(transports[0].requireTLS, false);
    assert.equal(
      (
        await org("/settings/email/test", "POST", {
          recipient: "teszt@sajat.hu",
        })
      ).status,
      200,
    );
    assert.equal(sent[0].to, "teszt@sajat.hu");
    assert.deepEqual(sent[0].from, {
      name: "TournamentManager",
      address: configuration.from,
    });
    assert.ok(sent[0].text && sent[0].html);
    assert.equal(
      (
        await captain("/settings/email/test", "POST", {
          recipient: "teszt@sajat.hu",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await org("/tournaments/1/draw", "POST", {
          start: "2026-11-01T14:00:00Z",
          interval_days: 7,
          venue: "Sportpálya",
        })
      ).status,
      201,
    );
    let rows = db.prepare("SELECT * FROM notifications").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].recipient, configuration.recipientOverride);
    assert.match(String(rows[0].body), /Boldva SE/);
    assert.match(String(rows[0].body), /Sajólád SE/);
    stopWorker = startMailWorker(mailer, 20);
    const deadline = Date.now() + 2000;
    while (
      db.prepare("SELECT status FROM notifications LIMIT 1").get()!.status !==
        "sent" &&
      Date.now() < deadline
    )
      await new Promise((done) => setTimeout(done, 10));
    stopWorker();
    stopWorker = undefined;
    assert.equal(
      db.prepare("SELECT status FROM notifications LIMIT 1").get()!.status,
      "sent",
    );
    assert.equal(sent[1].to, configuration.recipientOverride);
    const team = db
      .prepare("SELECT * FROM teams WHERE captain_id=2 LIMIT 1")
      .get()!;
    assert.equal(
      (
        await captain(`/teams/${team.id}`, "PUT", {
          name: team.name,
          short_name: team.short_name,
          color: team.color,
          notification_email: "kapitany@valodi.hu",
        })
      ).status,
      200,
    );
    assert.equal(
      db.prepare("SELECT email FROM users WHERE id=2").get()!.email,
      "kapitany@tournament.local",
    );
    assert.equal(
      (
        await org("/settings/email", "PUT", {
          ...configuration,
          password: undefined,
          recipientOverride: "",
        })
      ).status,
      200,
    );
    await org("/tournaments/1/notifications", "POST");
    const separate = await org("/notifications/process", "POST");
    assert.equal(separate.data.sent, 1);
    assert.equal(separate.data.failed, 11);
    assert.equal(sent[2].to, "kapitany@valodi.hu");
    const owned = await captain("/tournaments/1/dashboard");
    assert.ok(owned.data.notifications.length > 0);
    assert.ok(
      owned.data.notifications.every(
        (mail: { recipient: string }) =>
          mail.recipient === "kapitany@valodi.hu",
      ),
    );
    assert.equal(
      (
        await org("/settings/email/test", "POST", {
          recipient: "kapitany@tournament.local",
        })
      ).status,
      400,
    );
    await org("/settings/email", "PUT", {
      ...configuration,
      host: "bad.smtp.hu",
    });
    const failed = await org("/settings/email/verify", "POST");
    assert.equal(failed.status, 502);
    assert.match(failed.data.error, /hitelesítés/);
    assert.ok(!JSON.stringify(failed.data).includes(configuration.password));
    assert.equal(
      (
        await org("/settings/email/test", "POST", {
          recipient: "teszt@sajat.hu",
        })
      ).status,
      429,
    );
    assert.equal(sent.length, 3);
  } finally {
    stopWorker?.();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    db.close();
    file.cleanup();
  }
});

test("V3 migráció megőrzi a csapatokat, játékosokat és belépést; a külön értesítési cím nem nullázódik", () => {
  const db = openDatabase(":memory:");
  seedDemo(db);
  try {
    db.exec(
      "ALTER TABLE teams DROP COLUMN notification_email; PRAGMA user_version=2;",
    );
    const teams = db
      .prepare("SELECT * FROM teams ORDER BY id")
      .all()
      .map((row) => ({ ...row }));
    const users = db.prepare("SELECT * FROM users ORDER BY id").all();
    const players = db.prepare("SELECT * FROM players ORDER BY id").all();
    migrateEmailRecipients(db);
    const after = db
      .prepare("SELECT * FROM teams ORDER BY id")
      .all()
      .map(({ notification_email, ...rest }) => rest);
    assert.deepEqual(after, teams);
    assert.deepEqual(
      db.prepare("SELECT * FROM users ORDER BY id").all(),
      users,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM players ORDER BY id").all(),
      players,
    );
    db.prepare(
      "UPDATE teams SET notification_email='sajat@bajnoksag.hu' WHERE id=1",
    ).run();
    migrateEmailRecipients(db);
    assert.equal(
      db.prepare("SELECT notification_email FROM teams WHERE id=1").get()!
        .notification_email,
      "sajat@bajnoksag.hu",
    );
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 3);
  } finally {
    db.close();
  }
});
