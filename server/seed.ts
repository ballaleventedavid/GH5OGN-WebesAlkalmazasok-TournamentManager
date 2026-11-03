import { hashPassword } from "./auth.js";
import { one, transaction, type DB } from "./db.js";

// Borsod-Abaúj-Zemplén megyei falvak nevéből képzett mintacsapatok.
const clubs = [
  { name: "Boldva SE", short: "BDV", color: "#16804a" },
  { name: "Borsodszirák SE", short: "BSZ", color: "#6c3e9d" },
  { name: "Szendrőlád SE", short: "SZL", color: "#0a7668" },
  { name: "Szalonna SE", short: "SZA", color: "#244e77" },
  { name: "Perkupa SE", short: "PER", color: "#467942" },
  { name: "Bódvaszilas SE", short: "BVS", color: "#c8353f" },
  { name: "Szögliget SE", short: "SZG", color: "#2274bb" },
  { name: "Jósvafő SE", short: "JSF", color: "#b72e46" },
  { name: "Aggtelek SE", short: "AGG", color: "#9c333a" },
  { name: "Sajóvámos SE", short: "SVM", color: "#a52d39" },
  { name: "Sajókeresztúr SE", short: "SKR", color: "#234d85" },
  { name: "Sajólád SE", short: "SLD", color: "#1764ac" },
];
const surnames = [
  "Kovács",
  "Nagy",
  "Tóth",
  "Szabó",
  "Horváth",
  "Varga",
  "Kiss",
  "Molnár",
  "Németh",
  "Farkas",
  "Balogh",
  "Papp",
  "Lakatos",
  "Takács",
  "Juhász",
  "Mészáros",
  "Oláh",
  "Simon",
  "Rácz",
  "Fekete",
  "Szilágyi",
  "Török",
  "Fehér",
  "Balázs",
  "Gál",
  "Kocsis",
  "Szalai",
  "Sipos",
  "Bíró",
  "Kelemen",
  "Orbán",
  "Lukács",
  "Sándor",
  "Vincze",
  "Fazekas",
  "Bálint",
];
const firstNames = [
  "Dániel",
  "Bence",
  "Ádám",
  "Márton",
  "Levente",
  "Dominik",
  "Péter",
  "Gergő",
  "Kristóf",
  "Milán",
  "Dávid",
  "Bálint",
  "Zoltán",
  "Tamás",
  "András",
  "Máté",
  "Botond",
  "Barnabás",
  "Áron",
  "Benedek",
  "Attila",
  "László",
  "Gábor",
  "Patrik",
];
export function seedDemo(db: DB) {
  if (one(db, "SELECT id FROM users LIMIT 1")) return;
  transaction(db, () => {
    const userInsert = db.prepare(
      "INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)",
    );
    userInsert.run(
      "Szervező",
      "szervezo@tournament.local",
      hashPassword("Szervezo123!"),
      "organizer",
    );
    const captainHash = hashPassword("Kapitany123!");
    clubs.forEach((club, i) => {
      const name =
        i === 0
          ? "Nagy Bence"
          : i === 1
            ? "Szabó Anna"
            : `${surnames[(i * 3) % surnames.length]} ${firstNames[(i * 5) % firstNames.length]}`;
      const email =
        i === 0
          ? "kapitany@tournament.local"
          : i === 1
            ? "anna@tournament.local"
            : `${club.short
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")}@example.test`;
      userInsert.run(name, email, captainHash, "captain");
    });
    db.prepare(
      "INSERT INTO tournaments(name,season,location,sport) VALUES(?,?,?,?)",
    ).run(
      "Megyei bajnokság",
      "2026 / 27",
      "Borsod-Abaúj-Zemplén",
      "Labdarúgás",
    );
    clubs.forEach((club, i) => {
      const teamId = Number(
        db
          .prepare(
            "INSERT INTO teams(tournament_id,name,short_name,color,captain_id) VALUES(1,?,?,?,?)",
          )
          .run(club.name, club.short, club.color, i + 2).lastInsertRowid,
      );
      for (let p = 0; p < 22; p++) {
        const name = `${surnames[(i * 7 + p) % surnames.length]} ${firstNames[(i * 3 + Math.floor(p / 2)) % firstNames.length]}`;
        const position =
          p < 2 ? "Kapus" : p < 10 ? "Védő" : p < 17 ? "Középpályás" : "Csatár";
        db.prepare(
          "INSERT INTO players(team_id,name,number,position) VALUES(?,?,?,?)",
        ).run(teamId, name, p + 1, position);
      }
    });
    db.prepare(
      "INSERT INTO audit(tournament_id,actor,action) VALUES(1,?,?)",
    ).run("Szervező", "A bajnokság csapatai nevezve. A menetrend sorsolható.");
  });
}
