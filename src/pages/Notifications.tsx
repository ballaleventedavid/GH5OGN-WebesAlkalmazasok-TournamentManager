import { Eye, Mail, Plus, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import type { DashboardData } from "../../shared/types";
import { Button, Empty } from "../components/ui";
import { dt } from "../lib/format";
import type { Dialog } from "../types";
export function Notifications({
  data,
  organizer,
  open,
  action,
  configure,
  refresh,
}: {
  data: DashboardData;
  organizer: boolean;
  open: (d: Dialog) => void;
  action: (
    p: string,
    m: string,
    b?: unknown,
    message?: string,
  ) => Promise<void>;
  configure?: () => void;
  refresh?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const pending = data.notifications.some(
    (notification) => notification.status === "queued",
  );
  useEffect(() => {
    if (!pending || !refresh) return;
    const timer = setInterval(() => void refresh().catch(() => {}), 3000);
    return () => clearInterval(timer);
  }, [pending, refresh]);
  const labels = {
    queued: "Sorban áll",
    preview: "Előnézet",
    sent: "Elküldve",
    failed: "Sikertelen",
  };
  const run = async (path: string, message: string) => {
    setBusy(true);
    await action(path, "POST", {}, message);
    setBusy(false);
  };
  return (
    <>
      <div className="notification-status">
        <span className={data.mailMode === "smtp" ? "on" : ""}>
          <i />
          {data.mailMode === "smtp"
            ? "Automatikus e-mail-értesítések"
            : "E-mail-küldés kikapcsolva"}
        </span>
        {organizer && (
          <div className="notification-status-actions">
            {configure && (
              <button className="text-button" onClick={configure}>
                Címzett módosítása
              </button>
            )}
          </div>
        )}
      </div>
      <div className="section-toolbar">
        <div>
          <h2>
            Értesítések{" "}
            <span className="count-pill">{data.notifications.length}</span>
          </h2>
        </div>
        {organizer && (
          <Button
            primary
            disabled={busy}
            onClick={() =>
              run(
                `/tournaments/${data.tournament.id}/notifications`,
                "Az új értesítések sorba állítva.",
              )
            }
          >
            <Plus size={17} />
            Menetrend újraküldése
          </Button>
        )}
      </div>
      <section className="card notification-list">
        {data.notifications.length ? (
          data.notifications.map((n) => (
            <div className="notification-row" key={n.id}>
              <span className={`notification-icon ${n.status}`}>
                <Mail size={19} />
              </span>
              <div className="notification-copy">
                <strong>{n.subject}</strong>
                <span>{n.recipient}</span>
                {n.error && <small className="error-text">{n.error}</small>}
              </div>
              <div className="notification-meta">
                <span className={`badge mail-${n.status}`}>
                  {labels[n.status]}
                </span>
                <small>{dt(n.created_at)}</small>
              </div>
              <button
                className="icon-btn"
                aria-label="Levél megtekintése"
                onClick={() => open({ kind: "mail", mail: n })}
              >
                <Eye size={18} />
              </button>
              {organizer && n.status === "failed" && (
                <button
                  className="icon-btn"
                  aria-label="Újrapróbálás"
                  disabled={busy}
                  onClick={() =>
                    run(
                      `/notifications/${n.id}/retry`,
                      "Újrapróbálás sorba állítva.",
                    )
                  }
                >
                  <RotateCcw size={17} />
                </button>
              )}
            </div>
          ))
        ) : (
          <Empty title="Még nincs értesítés">
            A következő menetrendváltozás vagy eredménylezárás után itt látod az
            értesítéseket.
          </Empty>
        )}
      </section>
    </>
  );
}
