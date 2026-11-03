import { Settings2, Trophy } from "lucide-react";
import { defaultTournamentSettings } from "../../shared/settings";
import type { Tournament } from "../../shared/types";

export type TournamentTab = "general" | "advanced";

export function TournamentFields({
  tournament,
  tab,
  onTabChange,
  teamCount = 0,
}: {
  tournament?: Tournament;
  tab: TournamentTab;
  onTabChange: (tab: TournamentTab) => void;
  teamCount?: number;
}) {
  const settings = { ...defaultTournamentSettings, ...tournament };
  const tabs = [
    { key: "general" as const, label: "Alapadatok", icon: Trophy },
    {
      key: "advanced" as const,
      label: "Részletes beállítások",
      icon: Settings2,
    },
  ];
  const selectTab = (next: TournamentTab) => {
    onTabChange(next);
    document.getElementById(`tournament-tab-${next}`)?.focus();
  };
  return (
    <>
      <div
        className="tournament-tabs"
        role="tablist"
        aria-label="Bajnokság beállításai"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`tournament-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`tournament-panel-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => onTabChange(t.key)}
            onKeyDown={(e) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                selectTab(
                  e.key === "Home"
                    ? "general"
                    : e.key === "End"
                      ? "advanced"
                      : tab === "general"
                        ? "advanced"
                        : "general",
                );
              }
            }}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>
      <section
        role="tabpanel"
        id="tournament-panel-general"
        aria-labelledby="tournament-tab-general"
        data-settings-tab="general"
        hidden={tab !== "general"}
      >
        <label>
          Bajnokság neve
          <input
            name="name"
            required
            maxLength={70}
            placeholder="pl. Megyei bajnokság"
            defaultValue={tournament?.name}
          />
        </label>
        <div className="form-grid">
          <label>
            Szezon
            <input
              name="season"
              required
              maxLength={30}
              defaultValue={tournament?.season || "2026 / 27"}
            />
          </label>
          <label>
            Sportág
            <input
              name="sport"
              required
              maxLength={50}
              defaultValue={tournament?.sport || "Labdarúgás"}
            />
          </label>
        </div>
        <label>
          Alapértelmezett helyszín
          <input
            name="location"
            required
            maxLength={100}
            defaultValue={tournament?.location}
          />
        </label>
      </section>
      <section
        role="tabpanel"
        id="tournament-panel-advanced"
        aria-labelledby="tournament-tab-advanced"
        data-settings-tab="advanced"
        hidden={tab !== "advanced"}
      >
        <div className="settings-field-heading">
          <h3>Pontozás</h3>
          <p>A lezárt eredmények pontértékei.</p>
        </div>
        <div className="points-inputs">
          <label>
            Győzelem
            <input
              name="win_points"
              type="number"
              required
              min={0}
              max={20}
              step={1}
              defaultValue={settings.win_points}
            />
          </label>
          <label>
            Döntetlen
            <input
              name="draw_points"
              type="number"
              required
              min={0}
              max={20}
              step={1}
              defaultValue={settings.draw_points}
            />
          </label>
          <label>
            Vereség
            <input
              name="loss_points"
              type="number"
              required
              min={-20}
              max={20}
              step={1}
              defaultValue={settings.loss_points}
            />
          </label>
        </div>
        <label>
          Holtverseny feloldása
          <select name="tie_breaker" defaultValue={settings.tie_breaker}>
            <option value="goal_difference">Pontszám után gólkülönbség</option>
            <option value="wins">Pontszám után több győzelem</option>
          </select>
        </label>
        <div className="settings-field-heading">
          <h3>Lebonyolítás</h3>
        </div>
        <label>
          Körmérkőzés típusa
          <select
            name="round_robin_legs"
            defaultValue={settings.round_robin_legs}
          >
            <option value={1}>
              Egyszeres – minden páros egyszer találkozik
            </option>
            <option value={2}>
              Oda-visszavágós – minden páros kétszer találkozik
            </option>
          </select>
        </label>
        <div className="form-grid">
          <label>
            Fordulók között (nap)
            <input
              name="round_interval_days"
              type="number"
              required
              min={1}
              max={60}
              step={1}
              defaultValue={settings.round_interval_days}
            />
          </label>
          <label>
            Legfeljebb ennyi csapat
            <input
              name="max_teams"
              type="number"
              required
              min={Math.max(2, teamCount)}
              max={32}
              step={1}
              defaultValue={settings.max_teams}
            />
          </label>
        </div>
        {tournament && (
          <p className="advanced-settings-note">
            A pontozás és a holtversenyszabály mentése újraszámolja a tabellát.
            A sorsolási beállítások a már létrehozott mérkőzéseket nem rendezik
            át.
          </p>
        )}
      </section>
    </>
  );
}
