# TournamentManager

Magyar nyelvű, teljes TypeScript webalkalmazás csapatbajnokságokhoz. Csapatok, játékosok, mérkőzések, eredmények, automatikus sorsolás, tabella és SMTP menetrend-értesítések.

## Indítás Windows alatt

1. Nyissa meg a `tournament-manager` mappát, és indítssa a **start.cmd** fájlt.
2. A terminálban megjelenő cím alapértelmezésben **http://localhost:3000**.
3.  Leállítás: **Ctrl+C**.

## Belépési adatok

| Szerep         | E-mail                      | Jelszó         |
| -------------- | --------------------------- | -------------- |
| Szervező       | `szervezo@tournament.local` | `Szervezo123!` |
| Csapatkapitány | `kapitany@tournament.local` | `Kapitany123!` |
| Másik kapitány | `anna@tournament.local`     | `Kapitany123!` |


## Mit tud?

- Több bajnokság létrehozása és szerkesztése; bajnokságválasztó.
- Csapatok létrehozása, szerkesztése, keresése és saját csapatokra szűrése.
- Játékoskeret: név, mezszám, poszt; hozzáadás, szerkesztés, törlés. Egy csapatban a mezszám egyedi.
- Kézi mérkőzéslétrehozás fordulóval, kezdéssel és helyszínnel; időpontmódosítás, eredmény nélküli meccs törlése.
- Véletlen kezdősorrendből generált egyszeres vagy oda-visszavágós körmérkőzéses sorsolás, 2–32 csapatra. Páratlan létszámnál szabadnap.
- A fordulóütközés alkalmazásoldali és adatbázisoldali védelme hazai/vendég oldaltól függetlenül.
- Eredménytervezet és szervezői lezárás. A lezárt eredmény szervezőként módosítható vagy tervezetre visszanyitható.
- Dinamikus tabella: M/GY/D/V, lőtt és kapott gól, gólkülönbség, pont és utolsó öt meccs formája.
- Menetrend- és tabellaexport CSV-be, táblázatkezelőben megnyitható formában.
- Tartós e-mail-sor, helyi levélelőnézet, valódi külső SMTP adapter, hibajelzés és kézi újrapróbálás.
- Reszponzív magyar felület, mobilmenü, billentyűzettel kezelhető natív dialógusok, eseménynapló.


## Adatbázis és üzleti szabályok

Az SQLite fájl alapértelmezésben `data/tournament-megyei.sqlite`. Induláskor a séma és az indexek automatikusan létrejönnek; a seed csak teljesen üres felhasználótábla esetén fut. Az adatok újraindítás után megmaradnak. Az adatmodell és a fontos tranzakciók a [docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md) fájlban olvashatók.

Egy fordulóban egy csapat legfeljebb egyszer szerepelhet. Ezt a `match_slots(tournament_id, round, team_id)` elsődleges kulcs és a mérkőzésekhez tartozó SQLite triggerek kényszerítik ki. A sorsolás egyetlen tranzakció; hiba esetén nem marad félkész menetrend.

A tabella kizárólag `final` állapotú eredményekből számol.

