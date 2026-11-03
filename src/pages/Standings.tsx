import { ArrowDownToLine } from "lucide-react";
import { tieBreakerDescription } from "../../shared/settings";
import type { DashboardData } from "../../shared/types";
import { Table } from "../components/StandingsTable";
import { Button } from "../components/ui";
import { exportCsv } from "../lib/format";
export function Standings({ data }: { data: DashboardData }) {
  const final = data.matches.filter((m) => m.status === "final").length;
  return (
    <>
      <div className="standings-toolbar">
        <p>
          {data.teams.length} csapat · {final} lezárt mérkőzés
        </p>
        <Button
          onClick={() =>
            exportCsv("tabella.csv", [
              [
                "Helyezés",
                "Csapat",
                "M",
                "GY",
                "D",
                "V",
                "LG",
                "KG",
                "GK",
                "Pont",
              ],
              ...data.standings.map((s, i) => [
                i + 1,
                s.name,
                s.played,
                s.won,
                s.drawn,
                s.lost,
                s.goals_for,
                s.goals_against,
                s.difference,
                s.points,
              ]),
            ])
          }
        >
          <ArrowDownToLine size={17} />
          Tabella exportálása
        </Button>
      </div>
      <section className="card standings-card">
        <div className="card-heading">
          <h2>Tabella</h2>
          <span className="badge scheduled">
            <i /> Lezárt eredmények alapján
          </span>
        </div>
        <Table rows={data.standings} />
      </section>
      <details className="table-help">
        <summary>Pontozás és sorrend</summary>
        <p>
          Győzelem: {data.tournament.win_points} pont · Döntetlen:{" "}
          {data.tournament.draw_points} pont · Vereség:{" "}
          {data.tournament.loss_points} pont.
          <br />
          Sorrend: {tieBreakerDescription(data.tournament.tie_breaker)}. A
          tabella csak lezárt eredményekből számol.
        </p>
      </details>
    </>
  );
}
