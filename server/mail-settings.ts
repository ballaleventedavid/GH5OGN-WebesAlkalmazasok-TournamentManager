import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { EmailSettingsStatus } from "../shared/types.js";
import type { MailConfig } from "./mail.js";

const fields = z.object({
  mode: z.enum(["preview", "smtp"]),
  host: z
    .string()
    .trim()
    .max(253)
    .regex(
      /^[a-zA-Z0-9.:-]*$/,
      "Csak a szerver nevét add meg, protokoll és útvonal nélkül.",
    ),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z
    .string()
    .trim()
    .max(254)
    .regex(/^[^\r\n]*$/),
  from: z.union([z.email().max(254), z.literal("")]),
  fromName: z
    .string()
    .trim()
    .max(80)
    .regex(/^[^\r\n]*$/),
  recipientOverride: z.union([z.email().max(254), z.literal("")]).default(""),
  password: z.string().max(512).optional(),
});
const configuredFields = fields
  .extend({ password: z.string().max(512) })
  .superRefine((value, ctx) => {
    if (value.mode !== "smtp") return;
    for (const key of ["host", "user", "from", "password"] as const) {
      if (!value[key])
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Az SMTP-küldéshez kötelező mező.",
        });
    }
  });

export function createMailSettingsStore(
  initial: MailConfig = { mode: "preview" },
  filePath?: string,
) {
  const displayFrom = initial.from?.match(/^(.*?)<([^<>]+)>$/);
  let config: MailConfig = {
    ...initial,
    host: initial.host || "",
    port: initial.port || 587,
    secure: !!initial.secure,
    user: initial.user || "",
    pass: initial.pass || "",
    from: (displayFrom?.[2] || initial.from || "").trim(),
    fromName:
      initial.fromName || displayFrom?.[1]?.trim() || "TournamentManager",
    recipientOverride: initial.recipientOverride || "",
  };
  if (config.from === "noreply@example.com") config.from = "";
  if (filePath && existsSync(filePath)) {
    try {
      const stored = configuredFields.parse(
        JSON.parse(readFileSync(filePath, "utf8")),
      );
      const { password, ...rest } = stored;
      config = { ...rest, pass: password, requireTLS: !rest.secure };
    } catch {
      throw new Error(
        "Az e-mail-beállításfájl hibás. Ellenőrizd a data/mail-settings.json fájlt.",
      );
    }
  }
  return {
    get: (): MailConfig => ({ ...config }),
    status: (): EmailSettingsStatus => ({
      mode: config.mode,
      host: config.host || "",
      port: config.port || 587,
      secure: !!config.secure,
      user: config.user || "",
      from: config.from || "",
      fromName: config.fromName || "TournamentManager",
      passwordSet: !!config.pass,
      recipientOverride: config.recipientOverride || "",
      configured:
        config.mode === "smtp" &&
        !!(config.host && config.user && config.pass && config.from),
    }),
    save(input: unknown) {
      const value = fields.parse(input);
      const sameAccount =
        value.host === config.host && value.user === config.user;
      const full = configuredFields.parse({
        ...value,
        password: value.password || (sameAccount ? config.pass || "" : ""),
      });
      if (filePath) {
        mkdirSync(dirname(filePath), { recursive: true });
        const temp = `${filePath}.${randomUUID()}.tmp`;
        try {
          writeFileSync(temp, JSON.stringify(full, null, 2) + "\n", {
            mode: 0o600,
            flag: "wx",
          });
          renameSync(temp, filePath);
        } finally {
          if (existsSync(temp)) unlinkSync(temp);
        }
      }
      const { password, ...rest } = full;
      config = { ...rest, pass: password, requireTLS: !rest.secure };
    },
  };
}
export type MailSettingsStore = ReturnType<typeof createMailSettingsStore>;
