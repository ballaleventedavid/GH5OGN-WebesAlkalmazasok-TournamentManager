import { ArrowRight, ChevronLeft, ChevronRight, Shuffle } from "lucide-react";
import { useState } from "react";
import { scheduleSize } from "../../shared/settings";
import type { DashboardData, Match, User } from "../../shared/types";
import { Table } from "../components/StandingsTable";
import { Crest, Empty, Status } from "../components/ui";
import { dt } from "../lib/format";
import type { Dialog, Page } from "../types";

export function Overview({
  data,
  organizer,
  user,
  go,
  open,
}: {
  data: DashboardData;
  organizer: boolean;
  user: User;
  go: (p: Page) => void;
  open: (d: Dialog) => void;
}) {
  const finals = data.matches.filter((m) => m.status === "final");
  const rounds = [...new Set(data.matches.map((m) => m.round))];
  const hasMatches = data.matches.length > 0;
  const { matches: plannedMatches, rounds: plannedRounds } = scheduleSize(
    data.teams.length,
    data.tournament.round_robin_legs,
  );
  const currentRound =
    data.matches.find((m) => m.status !== "final")?.round || rounds.at(-1) || 1;
  const [focusedRound, setFocusedRound] = useState<number | null>(null);
  const round =
    focusedRound !== null && rounds.includes(focusedRound)
      ? focusedRound
      : currentRound;
  const roundIndex = rounds.indexOf(round);
  const fixtures = data.matches.filter((m) => m.round === round);
  const goals = finals.reduce(
    (sum, m) => sum + (m.home_score ?? 0) + (m.away_score ?? 0),
    0,
  );
  const recent = [...finals]
    .sort((a, b) => b.kickoff.localeCompare(a.kickoff))
    .slice(0, 4);
  const canEdit = (m: Match) =>
    organizer ||
    (m.status !== "final" &&
      (m.home_captain === user.id || m.away_captain === user.id));
  return (
    <>
      <section className="league-summary" aria-label="Aktív bajnokság">
        <div className="league-summary-title">
          <h2>{data.tournament.name}</h2>
          <p>
            {data.tournament.location} <span aria-hidden="true">/</span>{" "}
            {data.tournament.sport}
          </p>
        </div>
        <div className="season-progress">
          <div>
            <span>{hasMatches ? "Lejátszott mérkőzések" : "Menetrend"}</span>
            <strong>
              {hasMatches
                ? `${finals.length} / ${data.matches.length}`
                : "Sorsolásra kész"}
            </strong>
          </div>
          {hasMatches && (
            <progress
              aria-label="Lezárt mérkőzések aránya"
              max={data.matches.length}
              value={finals.length}
            />
          )}
        </div>
      </section>
      <section className="stat-grid" aria-label="Bajnokság számokban">
        <Stat
          label="Csapatok"
          value={data.teams.length}
          hint={`${data.teams.reduce((sum, t) => sum + t.player_count, 0)} játékos`}
        />
        <Stat
          label="Mérkőzések"
          value={data.matches.length}
          hint={
            hasMatches
              ? `${rounds.length} fordulóban`
              : `${plannedMatches} párosítás tervezhető`
          }
        />
        <Stat
          label="Lezárt eredmények"
          value={finals.length}
          hint={`${data.matches.filter((m) => m.status === "draft").length} jóváhagyásra vár`}
        />
        <Stat
          label="Gólok"
          value={goals}
          hint={`${(finals.length ? goals / finals.length : 0).toLocaleString("hu-HU", { maximumFractionDigits: 2 })} gól / mérkőzés`}
        />
      </section>
      {hasMatches ? (
        <section className="card overview-fixtures">
          <div className="card-heading">
            <div className="round-title">
              <h2>{round}. forduló</h2>
              <div className="round-switcher">
                <button
                  aria-label="Előző forduló"
                  disabled={roundIndex <= 0}
                  onClick={() => setFocusedRound(rounds[roundIndex - 1])}
                >
                  <ChevronLeft size={17} />
                </button>
                <span>
                  {roundIndex + 1} / {rounds.length}
                </span>
                <button
                  aria-label="Következő forduló"
                  disabled={roundIndex < 0 || roundIndex >= rounds.length - 1}
                  onClick={() => setFocusedRound(rounds[roundIndex + 1])}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </div>
            <button className="text-button" onClick={() => go("matches")}>
              Teljes menetrend <ArrowRight size={16} />
            </button>
          </div>
          {fixtures.map((m) => (
            <button
              className="overview-fixture"
              key={m.id}
              aria-label={`${m.home_name} – ${m.away_name}${canEdit(m) ? " eredmény" : " mérkőzés"}`}
              onClick={() =>
                canEdit(m) ? open({ kind: "score", match: m }) : go("matches")
              }
            >
              <span className="fixture-kickoff">
                <strong>
                  {dt(m.kickoff, { month: "short", day: "numeric" })}
                </strong>
                <span>
                  {dt(m.kickoff, { hour: "2-digit", minute: "2-digit" })}
                </span>
              </span>
              <span className="fixture-pair">
                <span className="fixture-team">
                  <Crest small name={m.home_short} color={m.home_color} />
                  <strong>{m.home_name}</strong>
                </span>
                <span
                  className={`fixture-score ${m.status === "final" ? "complete" : ""}`}
                >
                  {m.status === "scheduled"
                    ? "–"
                    : `${m.home_score} : ${m.away_score}`}
                </span>
                <span className="fixture-team away">
                  <strong>{m.away_name}</strong>
                  <Crest small name={m.away_short} color={m.away_color} />
                </span>
              </span>
              <Status status={m.status} />
              <ArrowRight className="fixture-open" size={16} />
            </button>
          ))}
        </section>
      ) : (
        <section className="draw-ready">
          <div>
            <h2>Indulhat a bajnokság</h2>
            <p>
              {data.teams.length} csapatból {plannedMatches} mérkőzés készül,{" "}
              {plannedRounds} fordulóban.
            </p>
          </div>
          {organizer ? (
            <button
              className="btn primary draw-start"
              disabled={data.teams.length < 2}
              onClick={() => open({ kind: "draw" })}
            >
              <Shuffle size={17} /> Sorsolás indítása <ArrowRight size={17} />
            </button>
          ) : (
            <span className="draw-waiting">
              A sorsolást a szervező indítja.
            </span>
          )}
        </section>
      )}
      <div className="overview-columns">
        <section className="card mini-standings">
          <div className="card-heading">
            <h2>Tabella</h2>
            <button className="text-button" onClick={() => go("standings")}>
              Összes csapat <ArrowRight size={16} />
            </button>
          </div>
          <Table rows={data.standings.slice(0, 6)} compact />
        </section>
        <section className="card recent-results">
          <div className="card-heading">
            <h2>Legutóbbi eredmények</h2>
          </div>
          {recent.map((m) => (
            <div className="recent-match" key={m.id}>
              <div className="recent-caption">
                <span>{m.round}. forduló</span>
                <span>{dt(m.kickoff, { month: "short", day: "numeric" })}</span>
              </div>
              <div>
                <span>
                  <Crest small name={m.home_short} color={m.home_color} />
                  {m.home_name}
                </span>
                <strong>{m.home_score}</strong>
              </div>
              <div>
                <span>
                  <Crest small name={m.away_short} color={m.away_color} />
                  {m.away_name}
                </span>
                <strong>{m.away_score}</strong>
              </div>
            </div>
          ))}
          {!recent.length && (
            <Empty title="Még nincs eredmény">
              Az első lezárt mérkőzés után itt találod a legutóbbi eredményeket.
            </Empty>
          )}
        </section>
      </div>
    </>
  );
}
function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <article className="stat-card">
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
      <p>{hint}</p>
    </article>
  );
}
