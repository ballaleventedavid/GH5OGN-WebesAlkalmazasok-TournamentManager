import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import express from "express";
import { createApp } from "./app.js";
import { openDatabase, one } from "./db.js";
import { hashPassword } from "./auth.js";
import { seedDemo } from "./seed.js";
import { createMailSettingsStore } from "./mail-settings.js";
import { startMailWorker } from "./mail.js";

if (existsSync(".env")) loadEnvFile(".env");
const production = process.env.NODE_ENV === "production";
const db = openDatabase(process.env.DATABASE_PATH);
if (
  process.env.SEED_DEMO === "true" ||
  (!production && process.env.SEED_DEMO !== "false")
)
  seedDemo(db);
if (!one(db, "SELECT id FROM users LIMIT 1")) {
  const email = process.env.INITIAL_ADMIN_EMAIL,
    password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12)
    throw new Error(
      "Üres adatbázishoz INITIAL_ADMIN_EMAIL és legalább 12 karakteres INITIAL_ADMIN_PASSWORD szükséges.",
    );
  db.prepare(
    "INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'organizer')",
  ).run(
    process.env.INITIAL_ADMIN_NAME || "Szervező",
    email.toLowerCase(),
    hashPassword(password),
  );
}
const mailSettings = createMailSettingsStore(
  {
    mode: process.env.MAIL_MODE === "smtp" ? "smtp" : "preview",
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM,
    requireTLS: process.env.SMTP_REQUIRE_TLS !== "false",
  },
  resolve(
    dirname(process.env.DATABASE_PATH || "./data/tournament-megyei.sqlite"),
    "mail-settings.json",
  ),
);
const { app, mailer } = createApp(db, {
  secureCookie: process.env.COOKIE_SECURE === "true",
  origin: process.env.APP_ORIGIN,
  mailSettings,
});
if (production) {
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000),
  host = process.env.HOST || "127.0.0.1";
export const server = app.listen(port, host, () =>
  console.log(
    `TournamentManager: http://${host === "127.0.0.1" ? "localhost" : host}:${port}`,
  ),
);
const stopMailWorker = startMailWorker(mailer);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopMailWorker();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
