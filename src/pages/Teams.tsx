import { ArrowRight, Pencil, Plus, Trash2 } from "lucide-react";
import type { CSSProperties } from "react";
import { useState } from "react";
import type { DashboardData, Team, User } from "../../shared/types";
import { Button, Crest, Empty, SearchBox } from "../components/ui";
import type { Dialog } from "../types";
export function Teams({
  data,
  user,
  query,
  setQuery,
  open,
  remove,
}: {
  data: DashboardData;
  user: User;
  query: string;
  setQuery: (s: string) => void;
  open: (d: Dialog) => void;
  remove: (t: Team) => void;
}) {
  const [own, setOwn] = useState(false);
  const filtered = data.teams.filter(
    (t) =>
      (!own || t.captain_id === user.id) &&
      (t.name + " " + t.captain_name)
        .toLocaleLowerCase("hu")
        .includes(query.toLocaleLowerCase("hu")),
  );
  return (
    <>
      <div className="section-toolbar">
        <div className="tabs">
          <button
            className={!own ? "active" : ""}
            onClick={() => setOwn(false)}
          >
            Összes csapat <b>{data.teams.length}</b>
          </button>
          <button className={own ? "active" : ""} onClick={() => setOwn(true)}>
            Saját csapataim
          </button>
        </div>
        <div className="toolbar-actions">
          <SearchBox
            value={query}
            set={setQuery}
            placeholder="Csapat keresése…"
          />
          <Button primary onClick={() => open({ kind: "team" })}>
            <Plus size={17} />
            Új csapat
          </Button>
        </div>
      </div>
      <div className="team-grid">
        {filtered.map((t) => {
          const edit = user.role === "organizer" || t.captain_id === user.id;
          const s = data.standings.find((s) => s.team_id === t.id);
          return (
            <article
              className="team-card card"
              key={t.id}
              style={{ "--club-color": t.color } as CSSProperties}
            >
              <div className="team-card-top">
                <div className="team-identity">
                  <Crest name={t.short_name} color={t.color} />
                  <h2>{t.name}</h2>
                </div>
                {edit && (
                  <button
                    className="icon-btn"
                    title="Csapat szerkesztése"
                    aria-label={`${t.name} szerkesztése`}
                    onClick={() => open({ kind: "team", team: t })}
                  >
                    <Pencil size={16} />
                  </button>
                )}
              </div>
              <div className="team-card-stats">
                <div>
                  <strong>{t.player_count}</strong>
                  <span>játékos</span>
                </div>
                <div>
                  <strong>{s?.played || 0}</strong>
                  <span>mérkőzés</span>
                </div>
                <div>
                  <strong>{s?.points || 0}</strong>
                  <span>pont</span>
                </div>
              </div>
              <div className="captain-row">
                <small>Kapitány</small>
                <strong>{t.captain_name}</strong>
              </div>
              <div className="team-card-footer">
                <button onClick={() => open({ kind: "roster", team: t })}>
                  Játékoskeret
                  <ArrowRight size={15} />
                </button>
                {edit && (
                  <button
                    className="icon-btn danger-hover"
                    aria-label={`${t.name} törlése`}
                    onClick={() => remove(t)}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {!filtered.length && (
        <div className="card">
          <Empty title="Nincs megjeleníthető csapat">
            Módosítsd a keresést, vagy hozz létre új csapatot.
          </Empty>
        </div>
      )}
    </>
  );
}
