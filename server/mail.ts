import nodemailer, { type SendMailOptions } from "nodemailer";
import { all, one, type DB } from "./db.js";
import { getMatches, getTeams, matchQuery } from "./queries.js";
import type { Match, Notification, Tournament } from "../shared/types.js";

export function enqueueSchedule(
  db: DB,
  tournamentId: number,
  recipientOverride?: string,
) {
  const tournament = one<Tournament>(
    db,
    "SELECT * FROM tournaments WHERE id=?",
    tournamentId,
  )!;
  const teams = getTeams(db, tournamentId).map((team) => ({
    ...team,
    captain_email: team.notification_email || team.captain_email,
  })),
    matches = getMatches(db, tournamentId);
  const recipients = new Set(
    recipientOverride ? [recipientOverride] : teams.map((t) => t.captain_email),
  );
  const insert = db.prepare(
    "INSERT INTO notifications(tournament_id,recipient,subject,body) VALUES(?,?,?,?)",
  );
  for (const recipient of recipients) {
    const ownIds = teams
      .filter((t) => recipientOverride || t.captain_email === recipient)
      .map((t) => t.id);
    const relevant = matches.filter(
      (m) => ownIds.includes(m.home_id) || ownIds.includes(m.away_id),
    );
    const body =
      `Szia!\n\nFrissült a(z) ${tournament.name} menetrendje.\n\n` +
      (relevant.length
        ? relevant
          .map(
            (m) =>
              `${m.round}. forduló · ${new Date(m.kickoff).toLocaleString("hu-HU", { timeZone: "Europe/Budapest" })}\n${m.home_name} – ${m.away_name}\nHelyszín: ${m.venue}`,
          )
          .join("\n\n")
        : "Jelenleg nincs kiírt mérkőzése a csapatodnak.") +
      `\n\nIdőzóna: Europe/Budapest\nRészletek: ${process.env.APP_ORIGIN || "http://localhost:3000"}\n\nTournamentManager`;
    insert.run(
      tournamentId,
      recipient,
      `${tournament.name} – friss menetrend`,
      body,
    );
  }
}
export function enqueueResult(
  db: DB,
  previous: Pick<Match, "id" | "status" | "home_score" | "away_score">,
  recipientOverride?: string,
) {
  const match = one<Match>(db, `${matchQuery} WHERE m.id=?`, previous.id);
  if (!match) throw new Error("Az eredményértesítés mérkőzése nem található.");
  if (match.status !== "final" && previous.status !== "final") return;
  if (
    match.status === previous.status &&
    match.home_score === previous.home_score &&
    match.away_score === previous.away_score
  )
    return;
  const tournament = one<Tournament>(
    db,
    "SELECT * FROM tournaments WHERE id=?",
    match.tournament_id,
  )!;
  const reopened = match.status !== "final";
  const corrected = !reopened && previous.status === "final";
  const event = reopened
    ? "Eredmény visszanyitva"
    : corrected
      ? "Lezárt eredmény javítva"
      : "Eredmény lezárva";
  const details = reopened
    ? `A korábban lezárt ${previous.home_score}–${previous.away_score} eredményt visszanyitották. Az eredmény újbóli lezárásig nem számít bele a tabellába.`
    : `Végeredmény: ${match.home_score}–${match.away_score}\n` +
    (corrected
      ? `Korábbi eredmény: ${previous.home_score}–${previous.away_score}\n`
      : "") +
    "A tabella frissült a lezárt eredménnyel.";
  const body =
    `Szia!\n\n${event}.\nBajnokság: ${tournament.name}\n\n` +
    `${match.home_name} – ${match.away_name}\n${details}\n\n` +
    `${match.round}. forduló\n` +
    `Időpont: ${new Date(match.kickoff).toLocaleString("hu-HU", { timeZone: "Europe/Budapest" })}\n` +
    `Helyszín: ${match.venue}\n\n` +
    `Időzóna: Europe/Budapest\nRészletek: ${process.env.APP_ORIGIN || "http://localhost:3000"}\n\nTournamentManager`;
  const recipients = new Set(
    recipientOverride
      ? [recipientOverride]
      : getTeams(db, match.tournament_id)
        .filter(
          (team) => team.id === match.home_id || team.id === match.away_id,
        )
        .map((team) => team.notification_email || team.captain_email),
  );
  const insert = db.prepare(
    "INSERT INTO notifications(tournament_id,recipient,subject,body) VALUES(?,?,?,?)",
  );
  for (const recipient of recipients)
    insert.run(
      match.tournament_id,
      recipient,
      `${tournament.name} – ${event.toLocaleLowerCase("hu-HU")}`,
      body,
    );
}
export interface MailConfig {
  mode: "smtp" | "preview";
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  from?: string;
  fromName?: string;
  recipientOverride?: string;
  requireTLS?: boolean;
  allowReservedRecipients?: boolean;
}
export interface MailTransport {
  verify(): Promise<unknown>;
  sendMail(
    message: SendMailOptions,
  ): Promise<{ accepted?: unknown[]; messageId?: string }>;
  close(): void;
}
export type MailTransportFactory = (config: MailConfig) => MailTransport;
export const createSmtpTransport: MailTransportFactory = (config) =>
  nodemailer.createTransport({
    host: config.host,
    port: config.port || 587,
    secure: !!config.secure,
    requireTLS: config.requireTLS ?? (!!config.user && !config.secure),
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    dnsTimeout: 10000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
export class MailServiceError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}
export function mailErrorMessage(error: unknown) {
  if (error instanceof MailServiceError) return error.message;
  const code = (error as { code?: string })?.code;
  if (code === "EAUTH" || code === "ENOAUTH")
    return "Az SMTP-hitelesítés sikertelen. Ellenőrizd a felhasználónevet és az SMTP- vagy alkalmazásjelszót.";
  if (
    [
      "ETLS",
      "CERT_HAS_EXPIRED",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "ERR_TLS_CERT_ALTNAME_INVALID",
    ].includes(code || "")
  )
    return "A titkosított SMTP-kapcsolat nem hozható létre. Ellenőrizd a szerver nevét, portját és a TLS-beállítást.";
  if (
    [
      "ETIMEDOUT",
      "ECONNECTION",
      "ECONNREFUSED",
      "EDNS",
      "ENOTFOUND",
      "ESOCKET",
    ].includes(code || "")
  )
    return "Az SMTP-szerver nem érhető el. Ellenőrizd a szerver nevét, portját és az internetkapcsolatot.";
  if (code === "EENVELOPE")
    return "Az SMTP-szerver elutasította a feladót vagy a címzettet. Ellenőrizd az e-mail-címeket és az engedélyezett feladót.";
  return "Az SMTP-művelet sikertelen. Ellenőrizd a szolgáltatód beállításait, majd próbáld újra.";
}
export function reservedRecipient(email: string) {
  const domain = email.split("@").at(-1)?.toLowerCase() || "";
  return (
    /(^|\.)(local|localhost|test|invalid|example)$/.test(domain) ||
    /(^|\.)example\.(com|net|org)$/.test(domain)
  );
}
function ensureSmtp(config: MailConfig) {
  if (config.mode !== "smtp")
    throw new MailServiceError(
      "Előbb kapcsold be és mentsd az SMTP-küldést a Beállításokban.",
      409,
    );
  if (!config.host || !config.from || (config.user && !config.pass))
    throw new MailServiceError(
      "Hiányos SMTP-beállítás. Ellenőrizd a szervert, feladót és hitelesítést.",
      409,
    );
}
function messageOptions(
  config: MailConfig,
  recipient: string,
  subject: string,
  text: string,
): SendMailOptions {
  const escaped = text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
      char
      ]!,
  );
  return {
    from: config.fromName
      ? { name: config.fromName, address: config.from! }
      : config.from,
    to: recipient,
    subject,
    text,
    html: `<div style="font:14px/1.8 Arial,Helvetica,sans-serif;color:#252936;max-width:640px;margin:24px auto"><div style="padding:18px 24px;background:#222631;color:#fff;border-left:4px solid #ff927b;font-weight:bold">TournamentManager</div><div style="padding:24px;border:1px solid #e0e3eb">${escaped.replaceAll("\n", "<br>")}</div></div>`,
  };
}
async function send(
  transport: MailTransport,
  config: MailConfig,
  recipient: string,
  subject: string,
  body: string,
) {
  if (!config.allowReservedRecipients && reservedRecipient(recipient))
    throw new MailServiceError(
      "Ez mintacím, nem valódi címzett. Adj meg értesítési e-mail-címet a csapat szerkesztésénél.",
      400,
    );
  const info = await transport.sendMail(
    messageOptions(config, recipient, subject, body),
  );
  if (!info.accepted?.length)
    throw new MailServiceError("Az SMTP-szerver nem fogadta el a címzettet.");
  return info.messageId || null;
}
export function mailService(
  db: DB,
  source: MailConfig | (() => MailConfig),
  factory = createSmtpTransport,
) {
  const current = () =>
    typeof source === "function" ? source() : { ...source };
  let running = false;
  const release = (transport?: MailTransport) => {
    try {
      transport?.close();
    } finally {
      running = false;
    }
  };
  const exclusive = async <T>(
    operation: (transport: MailTransport, config: MailConfig) => Promise<T>,
  ) => {
    if (running)
      throw new MailServiceError(
        "Egy e-mail-művelet már folyamatban van. Próbáld meg kicsit később.",
        409,
      );
    const config = current();
    ensureSmtp(config);
    running = true;
    let transport: MailTransport | undefined;
    try {
      transport = factory(config);
      return await operation(transport, config);
    } finally {
      release(transport);
    }
  };
  return {
    busy: () => running,
    verify: () =>
      exclusive(async (transport) => {
        await transport.verify();
        return { ok: true };
      }),
    sendTest: (recipient: string) =>
      exclusive(async (transport, config) => ({
        ok: true,
        messageId: await send(
          transport,
          config,
          recipient,
          "TournamentManager – e-mail-kapcsolat tesztje",
          "Szia!\n\nEz a TournamentManager tesztlevele, amelyet a Beállítások oldalon indítottál el.\n\nAz alkalmazás a megadott SMTP-fiókon keresztül küldte ezt az üzenetet. A menetrendváltozásokról ugyanígy kapnak értesítést a csapatok.\n\nTournamentManager",
        ),
      })),
    async process() {
      const result = { sent: 0, preview: 0, failed: 0, busy: running };
      if (running) return result;
      const config = current();
      running = true;
      let transport: MailTransport | undefined;
      try {
        for (const mail of all<Notification>(
          db,
          "SELECT * FROM notifications WHERE status='queued' ORDER BY id LIMIT 50",
        )) {
          try {
            if (config.mode === "smtp") {
              ensureSmtp(config);
              if (
                !config.allowReservedRecipients &&
                reservedRecipient(mail.recipient)
              )
                throw new MailServiceError(
                  "Ez mintacím, nem valódi címzett. Adj meg értesítési e-mail-címet a csapat szerkesztésénél.",
                  400,
                );
              transport ??= factory(config);
              await send(
                transport,
                config,
                mail.recipient,
                mail.subject,
                mail.body,
              );
            }
            db.prepare(
              "UPDATE notifications SET status=?,sent_at=?,attempts=attempts+1,error=NULL WHERE id=?",
            ).run(
              config.mode === "smtp" ? "sent" : "preview",
              config.mode === "smtp" ? new Date().toISOString() : null,
              mail.id,
            );
            result[config.mode === "smtp" ? "sent" : "preview"]++;
          } catch (error) {
            db.prepare(
              "UPDATE notifications SET status='failed',attempts=attempts+1,error=? WHERE id=?",
            ).run(mailErrorMessage(error), mail.id);
            result.failed++;
          }
        }
      } finally {
        release(transport);
      }
      return result;
    },
  };
}

export function startMailWorker(
  mailer: Pick<ReturnType<typeof mailService>, "process">,
  intervalMs = 5000,
) {
  const run = () =>
    void mailer
      .process()
      .catch(() =>
        console.error(
          "Az értesítések feldolgozása átmenetileg sikertelen. A következő ciklus újrapróbálja.",
        ),
      );
  const timer = setInterval(run, intervalMs);
  timer.unref();
  run();
  return () => clearInterval(timer);
}
