import { openDatabase } from "./db.js";
import { seedDemo } from "./seed.js";
const db = openDatabase(process.env.DATABASE_PATH);
seedDemo(db);
db.close();
console.log(
  "A Megyei bajnokság kezdőadatai készen állnak. Meglévő adatokat nem írtunk felül.",
);
