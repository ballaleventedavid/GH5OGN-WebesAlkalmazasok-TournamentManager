import {
  ArrowDownToLine,
  CalendarDays,
  MapPin,
  Pencil,
  Plus,
  Shield,
  Shuffle,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { DashboardData, Match, User } from "../../shared/types";
import { Button, Crest, Empty, SearchBox, Status } from "../components/ui";
import { dt, exportCsv } from "../lib/format";
import type { Dialog } from "../types";
export function Matches({
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
  remove: (m: Match) => void;
}) {
  const [filter, setFilter] = useState("all"),
    [round, setRound] = useState(
      data.matches.find((m) => m.status === "scheduled")?.round || 0,
    );
  const organizer = user.role === "organizer";
  const filtered = data.matches.filter(
    (m) =>
      (filter === "all" || m.status === filter) &&
      (!round || m.round === round) &&
      (m.home_name + " " + m.away_name)
        .toLocaleLowerCase("hu")
        .includes(query.toLocaleLowerCase("hu")),
  );
  const rounds = [...new Set(data.matches.map((m) => m.round))];
  return (
    <>
      <div className="section-toolbar">
        <div className="tabs">
          {[
            ["all", "Összes"],
            ["scheduled", "Ütemezett"],
            ["draft", "Jóváhagyásra vár"],
            ["final", "Lezárt"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={filter === key ? "active" : ""}
              onClick={() => {
                setFilter(key);
                setRound(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {organizer && (
          <div className="toolbar-actions">
            <Button onClick={() => open({ kind: "draw" })}>
              <Shuffle size={17} />
              Sorsolás
            </Button>
            <Button primary onClick={() => open({ kind: "match" })}>
              <Plus size={17} />
              Új mérkőzés
            </Button>
          </div>
        )}
      </div>
      <div className="matches-controls">
        <SearchBox
          value={query}
          set={setQuery}
          placeholder="Csapat keresése…"
        />
        <select
          aria-label="Forduló szűrése"
          value={round}
          onChange={(e) => setRound(Number(e.target.value))}
        >
          <option value={0}>Minden forduló</option>
          {rounds.map((r) => (
            <option value={r} key={r}>
              {r}. forduló
            </option>
          ))}
        </select>
        <button
          className="text-button export"
          onClick={() =>
            exportCsv("menetrend.csv", [
              [
                "Forduló",
                "Hazai",
                "Vendég",
                "Kezdés (Budapest)",
                "Helyszín",
                "Állapot",
                "Hazai gól",
                "Vendég gól",
              ],
              ...filtered.map((m) => [
                m.round,
                m.home_name,
                m.away_name,
                dt(m.kickoff),
                m.venue,
                m.status,
                m.home_score ?? "",
                m.away_score ?? "",
              ]),
            ])
          }
        >
          <ArrowDownToLine size={16} />
          CSV export
        </button>
      </div>
      <div className="match-list">
        {rounds
          .filter((r) => filtered.some((m) => m.round === r))
          .map((r) => (
            <section key={r}>
              <div className="round-heading">
                <h2>{r}. forduló</h2>
                <span>
                  {filtered.filter((m) => m.round === r).length} mérkőzés
                </span>
                <div />
              </div>
              {filtered
                .filter((m) => m.round === r)
                .map((m) => {
                  const editable =
                    organizer ||
                    ((m.home_captain === user.id ||
                      m.away_captain === user.id) &&
                      m.status !== "final");
                  return (
                    <article className="match-row card" key={m.id}>
                      <div className="match-date">
                        <strong>
                          {dt(m.kickoff, { month: "short", day: "numeric" })}
                        </strong>
                        <span>
                          {dt(m.kickoff, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <div className="match-row-teams">
                        <div>
                          <Crest
                            small
                            name={m.home_short}
                            color={m.home_color}
                          />
                          <strong>{m.home_name}</strong>
                        </div>
                        <span
                          className={`score ${m.status === "final" ? "complete" : ""}`}
                        >
                          {m.status === "scheduled"
                            ? "–"
                            : `${m.home_score} : ${m.away_score}`}
                        </span>
                        <div className="away">
                          <strong>{m.away_name}</strong>
                          <Crest
                            small
                            name={m.away_short}
                            color={m.away_color}
                          />
                        </div>
                      </div>
                      <div className="match-row-info">
                        <Status status={m.status} />
                        <span>
                          <MapPin size={12} />
                          {m.venue}
                        </span>
                      </div>
                      <div className="match-row-actions">
                        {editable && (
                          <button
                            className="icon-btn"
                            title={
                              organizer
                                ? "Eredmény rögzítése / módosítása"
                                : "Eredmény beküldése"
                            }
                            aria-label={`${m.home_name} – ${m.away_name} eredmény`}
                            onClick={() => open({ kind: "score", match: m })}
                          >
                            <Pencil size={16} />
                          </button>
                        )}
                        {organizer && (
                          <>
                            <button
                              className="icon-btn"
                              aria-label="Időpont szerkesztése"
                              title="Időpont és helyszín"
                              onClick={() =>
                                open({ kind: "schedule", match: m })
                              }
                            >
                              <CalendarDays size={16} />
                            </button>
                            {m.status === "scheduled" && (
                              <button
                                className="icon-btn danger-hover"
                                aria-label="Mérkőzés törlése"
                                onClick={() => remove(m)}
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
            </section>
          ))}
      </div>
      {!filtered.length && (
        <div className="card">
          <Empty
            title={data.matches.length ? "Nincs találat" : "Még nincs mérkőzés"}
          >
            {data.matches.length
              ? "Ehhez a szűréshez nem tartozik mérkőzés."
              : "Hozz létre mérkőzést, vagy sorsold ki automatikusan a teljes bajnokságot."}
          </Empty>
        </div>
      )}
      <div className="info-strip">
        <Shield size={16} /> Egy fordulóban minden csapat legfeljebb egy
        mérkőzést játszhat. <span>Időpontok: Europe/Budapest</span>
      </div>
    </>
  );
}
