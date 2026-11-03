import {
  Check,
  LoaderCircle,
  Mail,
  Pencil,
  Plus,
  Shield,
  Shuffle,
  Trash2,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { scheduleSize } from "../../shared/settings";
import type { DashboardData, Player, Team, User } from "../../shared/types";
import { api } from "../api";
import { Button, Crest, Empty } from "../components/ui";
import { dt, err, localDate } from "../lib/format";
import type { Dialog } from "../types";
import { TournamentFields, type TournamentTab } from "./TournamentFields";
export function Modal({
  dialog,
  data,
  user,
  close,
  done,
}: {
  dialog: Dialog;
  data: DashboardData | null;
  user: User;
  close: () => void;
  done: (message: string, id?: number) => Promise<void>;
}) {
  const [tournamentTab, setTournamentTab] = useState<TournamentTab>("general");
  const ref = useRef<HTMLDialogElement>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [captains, setCaptains] = useState<User[]>([]);
  useEffect(() => {
    ref.current?.showModal();
    const previous = document.activeElement;
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  useEffect(() => {
    if (dialog.kind === "team" && user.role === "organizer")
      api<User[]>("/captains")
        .then(setCaptains)
        .catch((e) => setError(err(e)));
  }, [dialog.kind, user.role]);
  const titles: Record<Dialog["kind"], string> = {
    team:
      dialog.kind === "team" && dialog.team
        ? "Csapat szerkesztése"
        : "Új csapat nevezése",
    match: "Új mérkőzés",
    score: "Eredmény rögzítése",
    schedule: "Időpont és helyszín",
    draw: "Automatikus sorsolás",
    tournament:
      dialog.kind === "tournament" && dialog.edit
        ? "Bajnokság szerkesztése"
        : "Indíts új bajnokságot",
    roster: dialog.kind === "roster" ? dialog.team.name : "Játékoskeret",
    mail: "Menetrend-értesítés",
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    if (dialog.kind === "tournament" && !e.currentTarget.checkValidity()) {
      const invalid = e.currentTarget.querySelector<
        HTMLInputElement | HTMLSelectElement
      >(":invalid");
      setTournamentTab(
        invalid
          ?.closest("[data-settings-tab]")
          ?.getAttribute("data-settings-tab") === "advanced"
          ? "advanced"
          : "general",
      );
      setError(invalid?.validationMessage || "Ellenőrizd a kötelező mezőket.");
      return;
    }
    setBusy(true);
    const f = new FormData(e.currentTarget),
      v = (k: string) => String(f.get(k) || ""),
      n = (k: string) => Number(v(k));
    try {
      if (dialog.kind === "team") {
        const t = dialog.team;
        await api(
          t ? `/teams/${t.id}` : `/tournaments/${data!.tournament.id}/teams`,
          t ? "PUT" : "POST",
          {
            name: v("name"),
            short_name: v("short_name"),
            color: v("color"),
            notification_email: v("notification_email"),
            ...(user.role === "organizer"
              ? { captain_id: n("captain_id") }
              : {}),
          },
        );
        await done(t ? "A csapat frissítve." : "Az új csapat benevezett.");
      }
      if (dialog.kind === "tournament") {
        if (
          n("win_points") < n("draw_points") ||
          n("draw_points") < n("loss_points")
        ) {
          setTournamentTab("advanced");
          throw new Error(
            "A győzelemért legalább annyi pont járjon, mint a döntetlenért, a döntetlenért pedig legalább annyi, mint a vereségért.",
          );
        }
        const r = await api<{ id: number }>(
          dialog.edit ? `/tournaments/${data!.tournament.id}` : "/tournaments",
          dialog.edit ? "PUT" : "POST",
          {
            name: v("name"),
            season: v("season"),
            location: v("location"),
            sport: v("sport"),
            win_points: n("win_points"),
            draw_points: n("draw_points"),
            loss_points: n("loss_points"),
            tie_breaker: v("tie_breaker"),
            round_robin_legs: n("round_robin_legs"),
            round_interval_days: n("round_interval_days"),
            max_teams: n("max_teams"),
          },
        );
        await done(
          dialog.edit ? "A bajnokság frissítve." : "Az új bajnokság elkészült.",
          dialog.edit ? undefined : r.id,
        );
      }
      if (dialog.kind === "match") {
        await api(`/tournaments/${data!.tournament.id}/matches`, "POST", {
          home_id: n("home_id"),
          away_id: n("away_id"),
          round: n("round"),
          kickoff: new Date(v("kickoff")).toISOString(),
          venue: v("venue"),
        });
        await done("A mérkőzés bekerült a menetrendbe.");
      }
      if (dialog.kind === "score") {
        await api(`/matches/${dialog.match.id}/result`, "PUT", {
          home_score: n("home_score"),
          away_score: n("away_score"),
          status: v("status"),
          version: dialog.match.version,
        });
        await done(
          v("status") === "final"
            ? "Az eredmény lezárva. A tabella frissült."
            : "Az eredménytervezet mentve.",
        );
      }
      if (dialog.kind === "schedule") {
        await api(`/matches/${dialog.match.id}/schedule`, "PUT", {
          kickoff: new Date(v("kickoff")).toISOString(),
          venue: v("venue"),
          version: dialog.match.version,
        });
        await done("A menetrend frissítve, az értesítések sorba állítva.");
      }
      if (dialog.kind === "draw") {
        await api(`/tournaments/${data!.tournament.id}/draw`, "POST", {
          start: new Date(v("start")).toISOString(),
          interval_days: n("interval_days"),
          venue: v("venue"),
        });
        await done("A sorsolás elkészült, az értesítések sorba állítva.");
      }
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  };
  const tournament =
    dialog.kind === "tournament" && dialog.edit ? data?.tournament : undefined;
  return (
    <dialog
      ref={ref}
      className={`modal ${dialog.kind === "roster" ? "roster-modal" : ""}`}
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else close();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) close();
      }}
      aria-labelledby="modal-title"
    >
      <div className="modal-inner">
        <div className="modal-heading">
          <span className="modal-symbol">
            {dialog.kind === "draw" ? (
              <Shuffle size={22} />
            ) : dialog.kind === "team" || dialog.kind === "roster" ? (
              <Users size={22} />
            ) : dialog.kind === "mail" ? (
              <Mail size={22} />
            ) : (
              <Trophy size={22} />
            )}
          </span>
          <button
            className="icon-btn"
            aria-label="Ablak bezárása"
            onClick={close}
            disabled={busy}
          >
            <X size={21} />
          </button>
        </div>
        <h2 id="modal-title">{titles[dialog.kind]}</h2>
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        {dialog.kind === "roster" ? (
          <Roster
            team={dialog.team}
            user={user}
            changed={() => done("A játékoskeret frissítve.")}
          />
        ) : dialog.kind === "mail" ? (
          <>
            <div className="mail-preview-meta">
              <span>Címzett</span>
              <strong>{dialog.mail.recipient}</strong>
              <span>Tárgy</span>
              <strong>{dialog.mail.subject}</strong>
            </div>
            <pre className="mail-body">{dialog.mail.body}</pre>
            <div className="modal-actions">
              <Button onClick={close}>Bezárás</Button>
            </div>
          </>
        ) : (
          <form onSubmit={submit} noValidate={dialog.kind === "tournament"}>
            {dialog.kind === "team" && (
              <>
                <p className="modal-subtitle">Csapatadatok és kapitány.</p>
                <label>
                  Csapat neve
                  <input
                    name="name"
                    required
                    maxLength={60}
                    placeholder="pl. Boldva SE"
                    defaultValue={dialog.team?.name}
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Rövid név
                    <input
                      name="short_name"
                      required
                      maxLength={4}
                      placeholder="BDV"
                      defaultValue={dialog.team?.short_name}
                    />
                  </label>
                  <label>
                    Csapatszín
                    <input
                      type="color"
                      name="color"
                      defaultValue={dialog.team?.color || "#315e49"}
                    />
                  </label>
                </div>
                <label>
                  Értesítési e-mail-cím
                  <input
                    type="email"
                    name="notification_email"
                    maxLength={254}
                    defaultValue={dialog.team?.notification_email || ""}
                    placeholder="kapitany@szolgaltato.hu"
                  />
                  <small>
                    Üresen a kapitány fiókjának címét használjuk. A belépési
                    címet ez nem módosítja.
                  </small>
                </label>
                {user.role === "organizer" ? (
                  <label>
                    Csapatkapitány
                    <select
                      name="captain_id"
                      required
                      defaultValue={dialog.team?.captain_id || ""}
                    >
                      <option value="" disabled>
                        Válassz kapitányt
                      </option>
                      {captains.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} · {c.email}
                        </option>
                      ))}
                    </select>
                    <small>
                      A kapitányok a belépési oldalon regisztrálhatnak.
                    </small>
                  </label>
                ) : (
                  <div className="form-note">
                    <Shield size={16} />
                    Te leszel a csapat kapitánya.
                  </div>
                )}
              </>
            )}
            {dialog.kind === "tournament" && (
              <TournamentFields
                tournament={tournament}
                tab={tournamentTab}
                onTabChange={setTournamentTab}
                teamCount={dialog.edit ? data?.teams.length || 0 : 0}
              />
            )}
            {dialog.kind === "match" && (
              <>
                <p className="modal-subtitle">
                  Egy fordulóban egy csapat csak egyszer léphet pályára.
                </p>
                <div className="form-grid">
                  <label>
                    Hazai csapat
                    <select name="home_id" required defaultValue="">
                      <option disabled value="">
                        Válassz csapatot
                      </option>
                      {data!.teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Vendégcsapat
                    <select name="away_id" required defaultValue="">
                      <option disabled value="">
                        Válassz csapatot
                      </option>
                      {data!.teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    Forduló
                    <input
                      type="number"
                      name="round"
                      min={1}
                      max={200}
                      required
                      defaultValue={1}
                    />
                  </label>
                  <label>
                    Kezdés (eszköz helyi ideje)
                    <input
                      type="datetime-local"
                      name="kickoff"
                      required
                      defaultValue={localDate()}
                    />
                  </label>
                </div>
                <label>
                  Helyszín
                  <input
                    name="venue"
                    required
                    maxLength={100}
                    defaultValue={data!.tournament.location}
                  />
                </label>
              </>
            )}
            {dialog.kind === "score" && (
              <>
                <p className="modal-subtitle">
                  {dialog.match.round}. forduló · {dt(dialog.match.kickoff)}
                </p>
                <div className="score-editor">
                  <div>
                    <Crest
                      name={dialog.match.home_short}
                      color={dialog.match.home_color}
                    />
                    <strong>{dialog.match.home_name}</strong>
                    <input
                      aria-label="Hazai gólok"
                      type="number"
                      name="home_score"
                      min={0}
                      max={99}
                      required
                      defaultValue={dialog.match.home_score ?? 0}
                    />
                  </div>
                  <span>:</span>
                  <div>
                    <Crest
                      name={dialog.match.away_short}
                      color={dialog.match.away_color}
                    />
                    <strong>{dialog.match.away_name}</strong>
                    <input
                      aria-label="Vendég gólok"
                      type="number"
                      name="away_score"
                      min={0}
                      max={99}
                      required
                      defaultValue={dialog.match.away_score ?? 0}
                    />
                  </div>
                </div>
                <label>
                  Eredmény állapota
                  <select
                    name="status"
                    defaultValue={
                      dialog.match.status === "final" ? "final" : "draft"
                    }
                  >
                    <option value="draft">
                      Tervezet – még nem számít a tabellába
                    </option>
                    {user.role === "organizer" && (
                      <option value="final">
                        Lezárt – beleszámít a tabellába
                      </option>
                    )}
                  </select>
                </label>
                <div className="form-note">
                  <Shield size={17} />
                  {user.role === "organizer"
                    ? "A lezárt eredmény módosítása vagy tervezetre visszanyitása azonnal újraszámolja a tabellát."
                    : "A tervezetet a szervező ellenőrzi és zárja le."}
                </div>
              </>
            )}
            {dialog.kind === "schedule" && (
              <>
                <p className="modal-subtitle">
                  {dialog.match.home_name} – {dialog.match.away_name}
                </p>
                <label>
                  Kezdés (eszköz helyi ideje)
                  <input
                    type="datetime-local"
                    name="kickoff"
                    required
                    defaultValue={localDate(dialog.match.kickoff)}
                  />
                </label>
                <label>
                  Helyszín
                  <input
                    name="venue"
                    required
                    maxLength={100}
                    defaultValue={dialog.match.venue}
                  />
                </label>
                <div className="form-note">
                  <Mail size={17} />A módosításról értesítés kerül a kapitányok
                  levélsorába.
                </div>
              </>
            )}
            {dialog.kind === "draw" && (
              <>
                <p className="modal-subtitle">
                  {data!.tournament.round_robin_legs === 2
                    ? "Oda-visszavágós körmérkőzés, fordított pályaválasztással."
                    : "Mindenki mindenkivel egyszer."}{" "}
                  A párosításokat véletlenszerű sorrendből készítjük el.
                </p>
                <div className="draw-summary">
                  <div>
                    <strong>{data!.teams.length}</strong>
                    <span>csapat</span>
                  </div>
                  <div>
                    <strong>
                      {
                        scheduleSize(
                          data!.teams.length,
                          data!.tournament.round_robin_legs,
                        ).matches
                      }
                    </strong>
                    <span>mérkőzés</span>
                  </div>
                  <div>
                    <strong>
                      {
                        scheduleSize(
                          data!.teams.length,
                          data!.tournament.round_robin_legs,
                        ).rounds
                      }
                    </strong>
                    <span>forduló</span>
                  </div>
                </div>
                {data!.matches.length > 0 ? (
                  <div className="alert">
                    Ebben a bajnokságban már vannak mérkőzések. A sorsoláshoz
                    hozz létre új bajnokságot, vagy töröld az eredmény nélküli
                    mérkőzéseket.
                  </div>
                ) : data!.teams.length < 2 ? (
                  <div className="alert">
                    A sorsoláshoz legalább két csapat szükséges.
                  </div>
                ) : null}
                <div className="form-grid">
                  <label>
                    Első forduló (helyi idő)
                    <input
                      type="datetime-local"
                      name="start"
                      required
                      defaultValue={localDate()}
                    />
                  </label>
                  <label>
                    Fordulók között (nap)
                    <input
                      type="number"
                      name="interval_days"
                      required
                      min={1}
                      max={60}
                      defaultValue={data!.tournament.round_interval_days}
                    />
                  </label>
                </div>
                <label>
                  Helyszín
                  <input
                    name="venue"
                    required
                    maxLength={100}
                    defaultValue={data!.tournament.location}
                  />
                </label>
                <div className="form-note">
                  <Shuffle size={17} />
                  Páratlan csapatszámnál fordulónként egy csapat szabadnapos. A
                  forduló mérkőzései azonos kezdést kapnak; az időpontok és
                  pályák külön módosíthatók. A fordulók közti távolság 24 órás
                  napokban értendő.
                </div>
              </>
            )}
            <div className="modal-actions">
              <Button onClick={close} disabled={busy}>
                Mégse
              </Button>
              <button
                className="btn primary"
                disabled={
                  busy ||
                  (dialog.kind === "draw" &&
                    (data!.matches.length > 0 || data!.teams.length < 2))
                }
              >
                {busy ? (
                  <LoaderCircle className="spin" size={17} />
                ) : dialog.kind === "draw" ? (
                  <Shuffle size={17} />
                ) : (
                  <Check size={17} />
                )}{" "}
                {dialog.kind === "draw" ? "Sorsolás indítása" : "Mentés"}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}

function Roster({
  team,
  user,
  changed,
}: {
  team: Team;
  user: User;
  changed: () => Promise<void>;
}) {
  const [players, setPlayers] = useState<Player[]>([]),
    [edit, setEdit] = useState<Player | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  const editable = user.role === "organizer" || team.captain_id === user.id;
  const load = () =>
    api<Player[]>(`/teams/${team.id}/players`).then(setPlayers);
  useEffect(() => {
    load().catch((e) => setError(err(e)));
  }, [team.id]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form);
    setBusy(true);
    setError("");
    try {
      await api(
        edit ? `/players/${edit.id}` : `/teams/${team.id}/players`,
        edit ? "PUT" : "POST",
        {
          name: String(f.get("name")),
          number: Number(f.get("number")),
          position: String(f.get("position")),
        },
      );
      setEdit(null);
      form.reset();
      await load();
      setDirty(true);
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="modal-subtitle">
        Játékoskeret · {players.length} játékos · {team.captain_name}
      </p>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <div className="roster-list">
        {players.map((p) => (
          <div className="roster-row" key={p.id}>
            <span className="jersey">{p.number}</span>
            <div>
              <strong>{p.name}</strong>
              <small>{p.position}</small>
            </div>
            {editable && (
              <>
                <button
                  className="icon-btn"
                  aria-label={`${p.name} szerkesztése`}
                  onClick={() => setEdit(p)}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="icon-btn danger-hover"
                  aria-label={`${p.name} törlése`}
                  disabled={busy}
                  onClick={async () => {
                    if (!confirm(`Törlöd a játékost: ${p.name}?`)) return;
                    setBusy(true);
                    try {
                      await api(`/players/${p.id}`, "DELETE");
                      await load();
                      setDirty(true);
                      if (edit?.id === p.id) setEdit(null);
                    } catch (e) {
                      setError(err(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {!players.length && <Empty title="Még nincs játékos" />}
      {editable && (
        <form key={edit?.id || "new"} onSubmit={submit} className="roster-form">
          <h3>{edit ? "Játékos szerkesztése" : "Új játékos"}</h3>
          <label>
            Játékos neve
            <input
              name="name"
              required
              maxLength={70}
              defaultValue={edit?.name}
            />
          </label>
          <div className="form-grid">
            <label>
              Mezszám
              <input
                type="number"
                name="number"
                required
                min={1}
                max={99}
                defaultValue={edit?.number}
              />
            </label>
            <label>
              Poszt
              <select
                name="position"
                defaultValue={edit?.position || "Középpályás"}
              >
                {["Kapus", "Védő", "Középpályás", "Csatár", "Egyéb"].map(
                  (p) => (
                    <option key={p}>{p}</option>
                  ),
                )}
              </select>
            </label>
          </div>
          <div className="roster-actions">
            {edit && <Button onClick={() => setEdit(null)}>Mégse</Button>}
            <button className="btn" disabled={busy}>
              <Plus size={16} />
              {edit ? "Módosítás mentése" : "Játékos hozzáadása"}
            </button>
          </div>
        </form>
      )}
      <div className="modal-actions">
        <Button primary disabled={busy} onClick={() => void changed()}>
          {dirty ? "Kész, frissítés" : "Bezárás"}
        </Button>
      </div>
    </>
  );
}
