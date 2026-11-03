import { Trophy } from "lucide-react";
import type { Standing } from "../../shared/types";
import { Crest, Empty } from "../components/ui";
export function Table({
  rows,
  compact = false,
}: {
  rows: Standing[];
  compact?: boolean;
}) {
  return (
    <div className="table-scroll">
      <table className={compact ? "compact" : ""} aria-label="Bajnoki tabella">
        <thead>
          <tr>
            <th>#</th>
            <th>Csapat</th>
            <th title="Mérkőzés">M</th>
            {!compact && (
              <>
                <th title="Győzelem">GY</th>
                <th title="Döntetlen">D</th>
                <th title="Vereség">V</th>
                <th title="Lőtt és kapott gól">Gólok</th>
                <th title="Gólkülönbség">GK</th>
                <th>Forma</th>
              </>
            )}
            <th className="points">Pont</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.team_id}
              className={i === 0 && r.played > 0 ? "leader" : ""}
            >
              <td>
                <span className="rank">{i + 1}</span>
              </td>
              <td>
                <div className="table-team">
                  <Crest small name={r.short_name} color={r.color} />
                  <strong>{r.name}</strong>
                  {i === 0 && r.played > 0 && (
                    <Trophy size={13} className="leader-cup" />
                  )}
                </div>
              </td>
              <td>{r.played}</td>
              {!compact && (
                <>
                  <td>{r.won}</td>
                  <td>{r.drawn}</td>
                  <td>{r.lost}</td>
                  <td>
                    {r.goals_for}:{r.goals_against}
                  </td>
                  <td>
                    {r.difference > 0 ? "+" : ""}
                    {r.difference}
                  </td>
                  <td>
                    <div className="form">
                      {r.form.length ? (
                        r.form.map((f, i) => (
                          <span
                            key={i}
                            className={f}
                            title={
                              f === "W"
                                ? "Győzelem"
                                : f === "D"
                                  ? "Döntetlen"
                                  : "Vereség"
                            }
                          >
                            {f === "W" ? "GY" : f === "D" ? "D" : "V"}
                          </span>
                        ))
                      ) : (
                        <span className="no-form">—</span>
                      )}
                    </div>
                  </td>
                </>
              )}
              <td className="points">
                <b>{r.points}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <Empty title="Még nincs nevezett csapat" />}
    </div>
  );
}
