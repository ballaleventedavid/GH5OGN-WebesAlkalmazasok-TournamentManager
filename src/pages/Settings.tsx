import { Clock3, Pencil, Shield } from "lucide-react";
import { tieBreakerDescription } from "../../shared/settings";
import type { DashboardData, User } from "../../shared/types";
import { dt } from "../lib/format";
import type { Dialog } from "../types";
import { EmailSettings } from "../components/EmailSettings";
export function Settings({
  data,
  user,
  open,
  changed,
}: {
  data: DashboardData;
  user: User;
  open: (d: Dialog) => void;
  changed?: () => Promise<void>;
}) {
  return (
    <div className="settings-grid">
      <section className="card">
        <div className="card-heading">
          <h2>Bajnokság adatai</h2>
          {user.role === "organizer" && (
            <button
              className="icon-btn"
              aria-label="Bajnokság szerkesztése"
              onClick={() => open({ kind: "tournament", edit: true })}
            >
              <Pencil size={17} />
            </button>
          )}
        </div>
        <dl>
          <dt>Név</dt>
          <dd>{data.tournament.name}</dd>
          <dt>Szezon</dt>
          <dd>{data.tournament.season}</dd>
          <dt>Sportág</dt>
          <dd>{data.tournament.sport}</dd>
          <dt>Helyszín</dt>
          <dd>{data.tournament.location}</dd>
          <dt>Pontozás</dt>
          <dd>
            {data.tournament.win_points} / {data.tournament.draw_points} /{" "}
            {data.tournament.loss_points} (győzelem / döntetlen / vereség)
          </dd>
          <dt>Holtverseny</dt>
          <dd>{tieBreakerDescription(data.tournament.tie_breaker)}</dd>
          <dt>Lebonyolítás</dt>
          <dd>
            {data.tournament.round_robin_legs === 2
              ? "Oda-visszavágós körmérkőzés"
              : "Egyszeres körmérkőzés"}
          </dd>
          <dt>Fordulóköz</dt>
          <dd>{data.tournament.round_interval_days} nap</dd>
          <dt>Csapatkorlát</dt>
          <dd>{data.tournament.max_teams} csapat</dd>
          <dt>Értesítések</dt>
          <dd>{data.mailMode === "smtp" ? "Bekapcsolva" : "Előnézet"}</dd>
        </dl>
      </section>
      <section className="card">
        <div className="card-heading">
          <h2>Saját profil</h2>
          <Shield size={18} />
        </div>
        <dl>
          <dt>Név</dt>
          <dd>{user.role === "organizer" ? "Szervező" : user.name}</dd>
          <dt>E-mail</dt>
          <dd>{user.email}</dd>
          <dt>Szerepkör</dt>
          <dd>{user.role === "organizer" ? "Szervező" : "Csapatkapitány"}</dd>
        </dl>
        <p className="settings-note">
          {user.role === "organizer"
            ? "Te kezeled a bajnokságokat, a sorsolást és az eredmények lezárását."
            : "Saját csapatokat és játékosokat kezelhetsz, saját mérkőzéseid eredményét tervezetként küldheted be."}
        </p>
      </section>

      {user.role === "organizer" && <EmailSettings changed={changed} />}
      <section className="card audit-card">
        <div className="card-heading">
          <h2>Eseménynapló</h2>
          <Clock3 size={18} />
        </div>
        {data.audit.map((a) => (
          <div className="audit-row" key={a.id}>
            <span className="activity-dot" />
            <div>
              <strong>{a.action}</strong>
              <span>
                {a.actor} · {dt(a.created_at)}
              </span>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
