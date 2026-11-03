import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { checkPassword, hashPassword, hashToken, randomToken } from "./auth.js";
import { all, one, transaction, audit, type DB } from "./db.js";
import { getMatches, getTeams } from "./queries.js";
import { roundRobin, standings } from "./domain.js";
import {
  enqueueSchedule,
  enqueueResult,
  mailService,
  mailErrorMessage,
  reservedRecipient,
  MailServiceError,
  type MailConfig,
  type MailTransportFactory,
} from "./mail.js";
import {
  createMailSettingsStore,
  type MailSettingsStore,
} from "./mail-settings.js";
import type {
  Match,
  Notification,
  Team,
  Tournament,
  User,
} from "../shared/types.js";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      csrf?: string;
    }
  }
}
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const text = (max = 100) =>
  z.string().trim().min(1, "Ez a mező kötelező.").max(max);
const id = (input: unknown) => z.coerce.number().int().positive().parse(input);
const teamSchema = z.object({
  name: text(60),
  short_name: text(4),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  captain_id: z.number().int().positive().optional(),
  notification_email: z.union([z.email().max(254), z.literal("")]).optional(),
});
const playerSchema = z.object({
  name: text(70),
  number: z.number().int().min(1).max(99),
  position: z.enum(["Kapus", "Védő", "Középpályás", "Csatár", "Egyéb"]),
});
const tournamentSchema = z
  .object({
    name: text(70),
    season: text(30),
    location: text(100),
    sport: text(50),
    win_points: z.number().int().min(0).max(20).default(3),
    draw_points: z.number().int().min(0).max(20).default(1),
    loss_points: z.number().int().min(-20).max(20).default(0),
    tie_breaker: z.enum(["goal_difference", "wins"]).default("goal_difference"),
    round_robin_legs: z.union([z.literal(1), z.literal(2)]).default(1),
    round_interval_days: z.number().int().min(1).max(60).default(7),
    max_teams: z.number().int().min(2).max(32).default(32),
  })
  .refine(
    (d) => d.win_points >= d.draw_points && d.draw_points >= d.loss_points,
    {
      path: ["win_points"],
      message:
        "A győzelemért legalább annyi pont járjon, mint a döntetlenért, a döntetlenért pedig legalább annyi, mint a vereségért.",
    },
  );
const kickoffSchema = z.string().datetime({ offset: true });

export function createApp(
  db: DB,
  options: {
    mail?: MailConfig;
    mailSettings?: MailSettingsStore;
    mailTransportFactory?: MailTransportFactory;
    secureCookie?: boolean;
    origin?: string;
  } = {},
) {
  const app = express();
  const mailSettings =
    options.mailSettings || createMailSettingsStore(options.mail);
  const mailer = mailService(
    db,
    mailSettings.get,
    options.mailTransportFactory,
  );
  const queueSchedule = (tournamentId: number) =>
    enqueueSchedule(db, tournamentId, mailSettings.get().recipientOverride);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy:
        process.env.NODE_ENV === "production" ? undefined : false,
    }),
  );
  app.use(express.json({ limit: "32kb" }));

  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (!req.is("application/json"))
        return next(new HttpError(415, "JSON kérés szükséges."));
      const origin = req.get("origin");
      const expected = options.origin || `${req.protocol}://${req.get("host")}`;
      if (origin && origin !== expected)
        return next(new HttpError(403, "Idegen eredetű kérés."));
    }
    const cookie = req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("tm_session="))
      ?.slice(11);
    if (cookie) {
      const row = one<User & { csrf: string }>(
        db,
        `SELECT u.id,u.name,u.email,u.role,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=? AND expires_at>?`,
        hashToken(cookie),
        Date.now(),
      );
      if (row) {
        const { csrf, ...user } = row;
        req.user = user;
        req.csrf = csrf;
      }
    }
    next();
  });
  const cookieOptions = {
    httpOnly: true,
    secure: options.secureCookie || false,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 7 * 86400000,
  };
  function session(res: Response, user: User) {
    const token = randomToken(),
      csrf = randomToken();
    db.prepare("DELETE FROM sessions WHERE expires_at<?").run(Date.now());
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
      hashToken(token),
      user.id,
      csrf,
      Date.now() + 7 * 86400000,
    );
    res.cookie("tm_session", token, cookieOptions).json({ user, csrf });
  }
  const authLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Túl sok belépési kísérlet. Próbáld később." },
  });
  app.post("/api/auth/login", authLimit, (req, res) => {
    const data = z
      .object({
        email: z.email().max(254),
        password: z.string().min(1).max(128),
      })
      .parse(req.body);
    const row = one<User & { password_hash: string }>(
      db,
      "SELECT * FROM users WHERE email=?",
      data.email.toLowerCase(),
    );

    const valid = checkPassword(
      data.password,
      row?.password_hash || `${"0".repeat(32)}:${"0".repeat(128)}`,
    );
    if (!row || !valid)
      throw new HttpError(401, "Hibás e-mail-cím vagy jelszó.");
    const { password_hash, ...user } = row;
    session(res, user);
  });
  app.post("/api/auth/register", authLimit, (req, res) => {
    const d = z
      .object({
        name: text(70),
        email: z.email().max(254),
        password: z
          .string()
          .min(10, "Legalább 10 karakteres jelszó szükséges.")
          .max(128),
      })
      .parse(req.body);
    if (one(db, "SELECT id FROM users WHERE email=?", d.email))
      throw new HttpError(409, "Ez az e-mail-cím már regisztrálva van.");
    const result = db
      .prepare(
        "INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'captain')",
      )
      .run(d.name, d.email.toLowerCase(), hashPassword(d.password));
    session(res, {
      id: Number(result.lastInsertRowid),
      name: d.name,
      email: d.email.toLowerCase(),
      role: "captain",
    });
  });
  app.get("/api/auth/me", (req, res) =>
    res.json({ user: req.user || null, csrf: req.csrf || null }),
  );
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api", (req, _res, next) => {
    if (!req.user)
      return next(new HttpError(401, "A folytatáshoz jelentkezz be."));
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("x-csrf-token") !== req.csrf
    )
      return next(
        new HttpError(403, "Érvénytelen munkamenet. Frissítsd az oldalt."),
      );
    next();
  });
  const organizer = (req: Request) => {
    if (req.user?.role !== "organizer")
      throw new HttpError(403, "Ehhez szervezői jogosultság szükséges.");
  };
  const emailLimit = rateLimit({
    windowMs: 60000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error:
        "Percenként legfeljebb öt SMTP-ellenőrzés vagy tesztküldés indítható.",
    },
  });
  app.get("/api/settings/email", (req, res) => {
    organizer(req);
    res.json(mailSettings.status());
  });
  app.get("/api/settings/email/recipient", (req, res) => {
    organizer(req);
    res.json({ recipient: mailSettings.status().recipientOverride });
  });
  app.put("/api/settings/email/recipient", (req, res) => {
    organizer(req);
    const { recipient } = z
      .object({
        recipient: z.string().trim().toLowerCase().pipe(z.email().max(254)),
      })
      .strict()
      .parse(req.body);
    if (reservedRecipient(recipient))
      throw new HttpError(
        400,
        "Adj meg valódi e-mail-címet az értesítésekhez.",
      );
    if (mailer.busy())
      throw new HttpError(
        409,
        "Értesítésküldés van folyamatban. A címzettet utána módosíthatod.",
      );
    const saved = mailSettings.status();
    if (!saved.host || !saved.user || !saved.from || !saved.passwordSet)
      throw new HttpError(
        409,
        "Az e-mail-küldőfiók szerveroldali beállítása hiányzik.",
      );
    mailSettings.save({ ...saved, mode: "smtp", recipientOverride: recipient });
    res.json({ recipient });
  });
  app.put("/api/settings/email", (req, res) => {
    organizer(req);
    if (mailer.busy())
      throw new HttpError(
        409,
        "E-mail-művelet van folyamatban. A beállításokat utána mentheted.",
      );
    mailSettings.save(req.body);
    res.json(mailSettings.status());
  });
  app.post("/api/settings/email/verify", emailLimit, async (req, res) => {
    organizer(req);
    try {
      res.json(await mailer.verify());
    } catch (error) {
      throw new HttpError(
        error instanceof MailServiceError ? error.status : 502,
        mailErrorMessage(error),
      );
    }
  });
  app.post("/api/settings/email/test", emailLimit, async (req, res) => {
    organizer(req);
    const { recipient } = z
      .object({ recipient: z.email().max(254) })
      .parse(req.body);
    try {
      res.json(await mailer.sendTest(recipient));
    } catch (error) {
      throw new HttpError(
        error instanceof MailServiceError ? error.status : 502,
        mailErrorMessage(error),
      );
    }
  });
  const tournament = (input: unknown) => {
    const row = one<Tournament>(
      db,
      "SELECT * FROM tournaments WHERE id=?",
      id(input),
    );
    if (!row) throw new HttpError(404, "A bajnokság nem található.");
    return row;
  };
  const team = (input: unknown, req: Request, edit = true) => {
    const row = one<Team>(db, "SELECT * FROM teams WHERE id=?", id(input));
    if (!row) throw new HttpError(404, "A csapat nem található.");
    if (
      edit &&
      req.user?.role !== "organizer" &&
      row.captain_id !== req.user?.id
    )
      throw new HttpError(403, "Csak a saját csapatodat módosíthatod.");
    return row;
  };
  app.post("/api/auth/logout", (req, res) => {
    db.prepare("DELETE FROM sessions WHERE user_id=? AND csrf=?").run(
      req.user!.id,
      req.csrf!,
    );
    res
      .clearCookie("tm_session", { ...cookieOptions, maxAge: undefined })
      .json({ ok: true });
  });
  app.get("/api/tournaments", (_req, res) =>
    res.json(all<Tournament>(db, "SELECT * FROM tournaments ORDER BY id DESC")),
  );
  app.post("/api/tournaments", (req, res) => {
    organizer(req);
    const d = tournamentSchema.parse(req.body);
    const newId = transaction(db, () => {
      const value = Number(
        db
          .prepare(
            "INSERT INTO tournaments(name,season,location,sport,win_points,draw_points,loss_points,tie_breaker,round_robin_legs,round_interval_days,max_teams) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            d.name,
            d.season,
            d.location,
            d.sport,
            d.win_points,
            d.draw_points,
            d.loss_points,
            d.tie_breaker,
            d.round_robin_legs,
            d.round_interval_days,
            d.max_teams,
          ).lastInsertRowid,
      );
      audit(db, value, req.user!.name, "Bajnokság létrehozva.");
      return value;
    });
    res.status(201).json({ id: newId });
  });
  app.put("/api/tournaments/:id", (req, res) => {
    organizer(req);
    const t = tournament(req.params.id),
      d = tournamentSchema.parse({ ...t, ...req.body });
    transaction(db, () => {
      if (getTeams(db, t.id).length > d.max_teams)
        throw new HttpError(
          409,
          "A csapatlétszám-korlát nem lehet kisebb a már benevezett csapatok számánál.",
        );
      db.prepare(
        "UPDATE tournaments SET name=?,season=?,location=?,sport=?,win_points=?,draw_points=?,loss_points=?,tie_breaker=?,round_robin_legs=?,round_interval_days=?,max_teams=? WHERE id=?",
      ).run(
        d.name,
        d.season,
        d.location,
        d.sport,
        d.win_points,
        d.draw_points,
        d.loss_points,
        d.tie_breaker,
        d.round_robin_legs,
        d.round_interval_days,
        d.max_teams,
        t.id,
      );
      audit(db, t.id, req.user!.name, "Bajnokság adatai frissítve.");
    });
    res.json({ ok: true });
  });
  app.get("/api/captains", (req, res) => {
    organizer(req);
    res.json(
      all<User>(
        db,
        "SELECT id,name,email,role FROM users WHERE role='captain' ORDER BY name",
      ),
    );
  });
  app.get("/api/tournaments/:id/dashboard", (req, res) => {
    const t = tournament(req.params.id),
      teams = getTeams(db, t.id),
      matches = getMatches(db, t.id);
    res.json({
      tournament: t,
      teams,
      matches,
      standings: standings(teams, matches, t),
      notifications: all<Notification>(
        db,
        `SELECT * FROM notifications WHERE tournament_id=? ${req.user!.role === "captain" ? "AND recipient IN (SELECT COALESCE(t.notification_email,u.email) FROM teams t JOIN users u ON u.id=t.captain_id WHERE t.tournament_id=? AND t.captain_id=?)" : ""} ORDER BY id DESC LIMIT 200`,
        t.id,
        ...(req.user!.role === "captain" ? [t.id, req.user!.id] : []),
      ),
      audit: all(
        db,
        "SELECT * FROM audit WHERE tournament_id=? ORDER BY id DESC LIMIT 12",
        t.id,
      ),
      mailMode: mailSettings.get().mode,
    });
  });
  app.post("/api/tournaments/:id/teams", (req, res) => {
    const t = tournament(req.params.id),
      d = teamSchema.parse(req.body);
    const captainId =
      req.user!.role === "captain" ? req.user!.id : d.captain_id;
    if (
      !captainId ||
      !one(db, "SELECT id FROM users WHERE id=? AND role='captain'", captainId)
    )
      throw new HttpError(400, "Válassz regisztrált csapatkapitányt.");
    if (getTeams(db, t.id).length >= t.max_teams)
      throw new HttpError(
        400,
        `Ebben a bajnokságban legfeljebb ${t.max_teams} csapat nevezhető.`,
      );
    const newId = transaction(db, () => {
      const value = Number(
        db
          .prepare(
            "INSERT INTO teams(tournament_id,name,short_name,color,captain_id,notification_email) VALUES(?,?,?,?,?,?)",
          )
          .run(
            t.id,
            d.name,
            d.short_name.toUpperCase(),
            d.color,
            captainId,
            d.notification_email?.toLowerCase() || null,
          ).lastInsertRowid,
      );
      audit(db, t.id, req.user!.name, `Csapat létrehozva: ${d.name}.`);
      return value;
    });
    res.status(201).json({ id: newId });
  });
  app.put("/api/teams/:id", (req, res) => {
    const t = team(req.params.id, req),
      d = teamSchema.parse(req.body);
    const captainId =
      req.user!.role === "organizer"
        ? d.captain_id || t.captain_id
        : t.captain_id;
    if (
      !one(db, "SELECT id FROM users WHERE id=? AND role='captain'", captainId)
    )
      throw new HttpError(400, "Érvénytelen csapatkapitány.");
    transaction(db, () => {
      db.prepare(
        "UPDATE teams SET name=?,short_name=?,color=?,captain_id=?,notification_email=? WHERE id=?",
      ).run(
        d.name,
        d.short_name.toUpperCase(),
        d.color,
        captainId,
        d.notification_email === undefined
          ? t.notification_email || null
          : d.notification_email.toLowerCase() || null,
        t.id,
      );
      audit(
        db,
        t.tournament_id,
        req.user!.name,
        `Csapat módosítva: ${d.name}.`,
      );
    });
    res.json({ ok: true });
  });
  app.delete("/api/teams/:id", (req, res) => {
    const t = team(req.params.id, req);
    if (
      one(db, "SELECT id FROM matches WHERE home_id=? OR away_id=?", t.id, t.id)
    )
      throw new HttpError(
        409,
        "A csapatnak már van mérkőzése, ezért nem törölhető.",
      );
    transaction(db, () => {
      db.prepare("DELETE FROM teams WHERE id=?").run(t.id);
      audit(db, t.tournament_id, req.user!.name, `Csapat törölve: ${t.name}.`);
    });
    res.json({ ok: true });
  });
  app.get("/api/teams/:id/players", (req, res) => {
    const t = team(req.params.id, req, false);
    res.json(
      all(db, "SELECT * FROM players WHERE team_id=? ORDER BY number", t.id),
    );
  });
  app.post("/api/teams/:id/players", (req, res) => {
    const t = team(req.params.id, req),
      d = playerSchema.parse(req.body);
    if (
      Number(
        one<{ n: number }>(
          db,
          "SELECT COUNT(*) n FROM players WHERE team_id=?",
          t.id,
        )!.n,
      ) >= 50
    )
      throw new HttpError(400, "Legfeljebb 50 játékos adható egy csapathoz.");
    const result = db
      .prepare(
        "INSERT INTO players(team_id,name,number,position) VALUES(?,?,?,?)",
      )
      .run(t.id, d.name, d.number, d.position);
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });
  app.put("/api/players/:id", (req, res) => {
    const p = one<{ team_id: number }>(
      db,
      "SELECT team_id FROM players WHERE id=?",
      id(req.params.id),
    );
    if (!p) throw new HttpError(404, "A játékos nem található.");
    team(p.team_id, req);
    const d = playerSchema.parse(req.body);
    db.prepare("UPDATE players SET name=?,number=?,position=? WHERE id=?").run(
      d.name,
      d.number,
      d.position,
      id(req.params.id),
    );
    res.json({ ok: true });
  });
  app.delete("/api/players/:id", (req, res) => {
    const p = one<{ team_id: number }>(
      db,
      "SELECT team_id FROM players WHERE id=?",
      id(req.params.id),
    );
    if (!p) throw new HttpError(404, "A játékos nem található.");
    team(p.team_id, req);
    db.prepare("DELETE FROM players WHERE id=?").run(id(req.params.id));
    res.json({ ok: true });
  });
  app.post("/api/tournaments/:id/matches", (req, res) => {
    organizer(req);
    const t = tournament(req.params.id);
    const d = z
      .object({
        home_id: z.number().int().positive(),
        away_id: z.number().int().positive(),
        round: z.number().int().min(1).max(200),
        kickoff: kickoffSchema,
        venue: text(100),
      })
      .parse(req.body);
    if (d.home_id === d.away_id)
      throw new HttpError(400, "Egy csapat nem játszhat önmaga ellen.");
    for (const tid of [d.home_id, d.away_id])
      if (team(tid, req, false).tournament_id !== t.id)
        throw new HttpError(
          400,
          "Mindkét csapatnak ebben a bajnokságban kell szerepelnie.",
        );
    const newId = transaction(db, () => {
      const value = Number(
        db
          .prepare(
            "INSERT INTO matches(tournament_id,round,home_id,away_id,kickoff,venue) VALUES(?,?,?,?,?,?)",
          )
          .run(t.id, d.round, d.home_id, d.away_id, d.kickoff, d.venue)
          .lastInsertRowid,
      );
      queueSchedule(t.id);
      audit(
        db,
        t.id,
        req.user!.name,
        `Mérkőzés létrehozva: ${d.round}. forduló.`,
      );
      return value;
    });
    res.status(201).json({ id: newId });
  });
  app.put("/api/matches/:id/schedule", (req, res) => {
    organizer(req);
    const m = one<Match>(
      db,
      "SELECT * FROM matches WHERE id=?",
      id(req.params.id),
    );
    if (!m) throw new HttpError(404, "A mérkőzés nem található.");
    const d = z
      .object({
        kickoff: kickoffSchema,
        venue: text(100),
        version: z.number().int(),
      })
      .parse(req.body);
    transaction(db, () => {
      const result = db
        .prepare(
          "UPDATE matches SET kickoff=?,venue=?,version=version+1 WHERE id=? AND version=?",
        )
        .run(d.kickoff, d.venue, m.id, d.version);
      if (!result.changes)
        throw new HttpError(
          409,
          "Közben módosult a mérkőzés. Frissítsd az oldalt.",
        );
      queueSchedule(m.tournament_id);
      audit(
        db,
        m.tournament_id,
        req.user!.name,
        "Mérkőzés időpontja vagy helyszíne módosítva.",
      );
    });
    res.json({ ok: true });
  });
  app.delete("/api/matches/:id", (req, res) => {
    organizer(req);
    const m = one<Match>(
      db,
      "SELECT * FROM matches WHERE id=?",
      id(req.params.id),
    );
    if (!m) throw new HttpError(404, "A mérkőzés nem található.");
    if (m.status !== "scheduled")
      throw new HttpError(409, "Csak eredmény nélküli mérkőzés törölhető.");
    transaction(db, () => {
      db.prepare("DELETE FROM matches WHERE id=?").run(m.id);
      queueSchedule(m.tournament_id);
      audit(
        db,
        m.tournament_id,
        req.user!.name,
        `Mérkőzés törölve (#${m.id}).`,
      );
    });
    res.json({ ok: true });
  });
  app.put("/api/matches/:id/result", (req, res) => {
    const m = one<Match>(
      db,
      "SELECT * FROM matches WHERE id=?",
      id(req.params.id),
    );
    if (!m) throw new HttpError(404, "A mérkőzés nem található.");
    const d = z
      .object({
        home_score: z.number().int().min(0).max(99),
        away_score: z.number().int().min(0).max(99),
        status: z.enum(["draft", "final"]),
        version: z.number().int(),
      })
      .parse(req.body);
    if (req.user!.role !== "organizer") {
      const own = one(
        db,
        "SELECT id FROM teams WHERE id IN (?,?) AND captain_id=?",
        m.home_id,
        m.away_id,
        req.user!.id,
      );
      if (!own || d.status === "final" || m.status === "final")
        throw new HttpError(
          403,
          "Kapitányként saját mérkőzéshez küldhetsz be eredménytervezetet. A lezárás a szervező feladata.",
        );
    }
    transaction(db, () => {
      const result = db
        .prepare(
          "UPDATE matches SET home_score=?,away_score=?,status=?,version=version+1 WHERE id=? AND version=?",
        )
        .run(d.home_score, d.away_score, d.status, m.id, d.version);
      if (!result.changes)
        throw new HttpError(
          409,
          "Közben módosult az eredmény. Frissítsd az oldalt.",
        );
      enqueueResult(db, m, mailSettings.get().recipientOverride);
      audit(
        db,
        m.tournament_id,
        req.user!.name,
        `Eredmény ${d.status === "final" ? "lezárva" : "tervezetként mentve"}: ${d.home_score}–${d.away_score} (#${m.id}).`,
      );
    });
    res.json({ ok: true });
  });
  app.post("/api/tournaments/:id/draw", (req, res) => {
    organizer(req);
    const t = tournament(req.params.id);
    const d = z
      .object({
        start: kickoffSchema,
        interval_days: z
          .number()
          .int()
          .min(1)
          .max(60)
          .default(t.round_interval_days),
        venue: text(100),
      })
      .parse(req.body);
    transaction(db, () => {
      if (one(db, "SELECT id FROM matches WHERE tournament_id=?", t.id))
        throw new HttpError(
          409,
          "Az automatikus sorsoláshoz üres menetrend szükséges. Hozz létre új bajnokságot, vagy töröld az eredmény nélküli mérkőzéseket.",
        );
      const teams = getTeams(db, t.id);
      if (teams.length < 2)
        throw new HttpError(
          400,
          "Legalább két csapat szükséges a sorsoláshoz.",
        );
      for (const m of roundRobin(
        teams.map((t) => t.id),
        true,
        t.round_robin_legs,
      )) {
        const date = new Date(d.start);
        date.setUTCDate(date.getUTCDate() + (m.round - 1) * d.interval_days);
        db.prepare(
          "INSERT INTO matches(tournament_id,round,home_id,away_id,kickoff,venue) VALUES(?,?,?,?,?,?)",
        ).run(t.id, m.round, m.home, m.away, date.toISOString(), d.venue);
      }
      queueSchedule(t.id);
      audit(
        db,
        t.id,
        req.user!.name,
        `Automatikus körmérkőzéses sorsolás: ${teams.length} csapat.`,
      );
    });
    res.status(201).json({ ok: true });
  });
  app.post("/api/tournaments/:id/notifications", (req, res) => {
    organizer(req);
    const t = tournament(req.params.id);
    if (!getMatches(db, t.id).length)
      throw new HttpError(400, "Előbb hozz létre mérkőzést.");
    transaction(db, () => {
      queueSchedule(t.id);
      audit(
        db,
        t.id,
        req.user!.name,
        "Menetrend-értesítések újra sorba állítva.",
      );
    });
    res.status(201).json({ ok: true });
  });
  app.post("/api/notifications/process", async (req, res) => {
    organizer(req);
    const result = await mailer.process();
    res.json({ ok: true, ...result });
  });
  app.post("/api/notifications/:id/retry", (req, res) => {
    organizer(req);
    const changed = db
      .prepare(
        "UPDATE notifications SET status='queued',error=NULL WHERE id=? AND status='failed'",
      )
      .run(id(req.params.id));
    if (!changed.changes)
      throw new HttpError(409, "Csak sikertelen levél próbálható újra.");
    res.json({ ok: true });
  });
  app.use("/api", (_req, _res, next) =>
    next(new HttpError(404, "Az API végpont nem található.")),
  );
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof z.ZodError)
        return res.status(400).json({
          error: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join(" · "),
        });
      if (error instanceof HttpError)
        return res.status(error.status).json({ error: error.message });
      const message = error instanceof Error ? error.message : "";
      if (message.includes("match_slots"))
        return res.status(409).json({
          error: "Ebben a fordulóban a csapat már szerepel másik mérkőzésen.",
        });
      if (message.includes("UNIQUE constraint"))
        return res.status(409).json({
          error: "Ez a csapatnév, e-mail-cím vagy mezszám már foglalt.",
        });
      if (error instanceof SyntaxError)
        return res.status(400).json({ error: "Hibás JSON kérés." });
      console.error(
        "API hiba:",
        error instanceof Error ? error.name : "Ismeretlen",
      );
      res.status(500).json({ error: "Váratlan szerverhiba történt." });
    },
  );
  return { app, mailer };
}
