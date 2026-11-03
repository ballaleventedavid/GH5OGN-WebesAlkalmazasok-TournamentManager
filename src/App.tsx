import {
  CalendarDays,
  Check,
  ChevronDown,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Mail,
  Menu,
  Plus,
  Settings2,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { DashboardData, Tournament, User } from "../shared/types";
import { api, setCsrf } from "./api";
import { Login } from "./components/Login";
import { Modal } from "./components/Modal";
import { Empty } from "./components/ui";
import { err, initials } from "./lib/format";
import { Matches } from "./pages/Matches";
import { Notifications } from "./pages/Notifications";
import { Overview } from "./pages/Overview";
import { Settings } from "./pages/Settings";
import { Standings } from "./pages/Standings";
import { Teams } from "./pages/Teams";
import type { Dialog, Page } from "./types";
const nav = [
  { key: "overview", label: "Áttekintés", icon: LayoutDashboard },
  { key: "teams", label: "Csapatok", icon: Users },
  { key: "matches", label: "Mérkőzések", icon: CalendarDays },
  { key: "standings", label: "Tabella", icon: Trophy },
  { key: "notifications", label: "Értesítések", icon: Mail },
] as const;
const pageLabels: Record<Page, string> = {
  overview: "Áttekintés",
  teams: "Csapatok",
  matches: "Mérkőzések",
  standings: "Tabella",
  notifications: "Értesítések",
  settings: "Beállítások",
};
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [boot, setBoot] = useState(true),
    [authError, setAuthError] = useState("");
  const [tournaments, setTournaments] = useState<Tournament[]>([]),
    [selected, setSelected] = useState(0),
    [data, setData] = useState<DashboardData | null>(null);
  const [page, setPage] = useState<Page>("overview"),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [query, setQuery] = useState(""),
    [mobile, setMobile] = useState(false),
    [loading, setLoading] = useState(false);
  const notify = (message: string) => {
    setToast(message);
  };
  useEffect(() => {
    api<{ user: User | null; csrf: string }>("/auth/me")
      .then((r) => {
        setUser(r.user);
        setCsrf(r.csrf || "");
      })
      .catch((e) => setAuthError(err(e)))
      .finally(() => setBoot(false));
  }, []);
  const loadTournaments = useCallback(async () => {
    const list = await api<Tournament[]>("/tournaments");
    setTournaments(list);
    setSelected((id) =>
      list.some((t) => t.id === id) ? id : list[0]?.id || 0,
    );
  }, []);
  useEffect(() => {
    if (user) loadTournaments().catch((e) => setError(err(e)));
  }, [user, loadTournaments]);
  const refresh = useCallback(async () => {
    if (selected) {
      const d = await api<DashboardData>(`/tournaments/${selected}/dashboard`);
      setData(d);
    }
  }, [selected]);
  useEffect(() => {
    if (!selected) {
      setData(null);
      return;
    }
    let active = true;
    setLoading(true);
    setData(null);
    setError("");
    api<DashboardData>(`/tournaments/${selected}/dashboard`)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(err(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selected]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const mutate = async (
    path: string,
    method: string,
    body?: unknown,
    message = "Sikeresen mentve.",
  ) => {
    try {
      await api(path, method, body);
      await refresh();
      notify(message);
    } catch (e) {
      setError(err(e));
    }
  };
  const changePage = (p: Page) => {
    setPage(p);
    setQuery("");
    setMobile(false);
    setError("");
  };
  if (boot)
    return (
      <div className="boot">
        <LoaderCircle className="spin" /> Betöltés…
      </div>
    );
  if (!user)
    return (
      <Login
        initialError={authError}
        onLogin={(u, token) => {
          setCsrf(token);
          setUser(u);
          setAuthError("");
        }}
      />
    );
  const organizer = user.role === "organizer",
    pending = data?.matches.filter((m) => m.status === "draft").length || 0;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "visible" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            changePage("overview");
          }}
        >
          <span className="brand-mark">
            <Trophy size={21} />
          </span>
          <span>
            Tournament<span className="brand-light">Manager</span>
          </span>
        </a>
        <div className="sidebar-league">
          <div>
            <strong>{data?.tournament.name || "Bajnokság"}</strong>
            <span>{data?.tournament.season || "2026 / 27"}</span>
          </div>
        </div>
        <nav aria-label="Fő navigáció">
          {nav.map((n) => (
            <button
              key={n.key}
              className={page === n.key ? "active" : ""}
              onClick={() => changePage(n.key)}
            >
              <n.icon size={19} />
              {n.label}
              {n.key === "matches" && pending > 0 && (
                <b className="nav-count">{pending}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={`settings-nav ${page === "settings" ? "selected" : ""}`}
            onClick={() => changePage("settings")}
          >
            <Settings2 size={18} />
            Beállítások
          </button>
          <div className="profile">
            <span className="avatar">
              {organizer ? <Users size={19} /> : initials(user.name)}
            </span>
            <div>
              <strong>{organizer ? "Szervező" : user.name}</strong>
              {!organizer && <small>Csapatkapitány</small>}
            </div>
            <button
              className="icon-btn logout"
              aria-label="Kijelentkezés"
              onClick={async () => {
                try {
                  await api("/auth/logout", "POST");
                  setUser(null);
                  setData(null);
                  setSelected(0);
                } catch (e) {
                  setError(err(e));
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      {mobile && (
        <button
          className="mobile-backdrop"
          aria-label="Menü bezárása"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="main-shell">
        <header className="mobile-topbar">
          <button
            className="icon-btn"
            aria-label="Menü megnyitása"
            aria-expanded={mobile}
            onClick={() => setMobile(!mobile)}
          >
            <Menu size={23} />
          </button>
        </header>
        <main>
          <div className="page-heading">
            <div className="heading-copy">
              <h1>{pageLabels[page]}</h1>
            </div>
            <div className="heading-actions">
              <div className="select-wrap">
                <Trophy size={16} />
                <select
                  aria-label="Bajnokság kiválasztása"
                  value={selected}
                  onChange={(e) => setSelected(Number(e.target.value))}
                >
                  {!tournaments.length && (
                    <option value={0}>Nincs bajnokság</option>
                  )}
                  {tournaments.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </div>
              {organizer && (
                <button
                  className="btn new-tournament-button"
                  onClick={() => setDialog({ kind: "tournament" })}
                >
                  <Plus size={19} />
                  Új bajnokság
                </button>
              )}
            </div>
          </div>
          {error && (
            <div className="alert" role="alert">
              {error}
              <button
                className="icon-btn"
                aria-label="Hiba bezárása"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading">
              <LoaderCircle className="spin" /> Bajnokság betöltése…
            </div>
          ) : !data ? (
            <div className="card">
              <Empty title="Indítsd el az első bajnokságot">
                {organizer
                  ? "Hozz létre bajnokságot a fenti Új bajnokság gombbal."
                  : "A szervező még nem hozott létre bajnokságot."}
              </Empty>
            </div>
          ) : (
            <>
              {page === "overview" && (
                <Overview
                  data={data}
                  organizer={organizer}
                  user={user}
                  go={changePage}
                  open={setDialog}
                />
              )}
              {page === "teams" && (
                <Teams
                  data={data}
                  user={user}
                  query={query}
                  setQuery={setQuery}
                  open={setDialog}
                  remove={async (t) => {
                    if (
                      confirm(`Törlöd a(z) ${t.name} csapatot és játékosait?`)
                    )
                      await mutate(
                        `/teams/${t.id}`,
                        "DELETE",
                        undefined,
                        "A csapat törölve.",
                      );
                  }}
                />
              )}
              {page === "matches" && (
                <Matches
                  data={data}
                  user={user}
                  query={query}
                  setQuery={setQuery}
                  open={setDialog}
                  remove={async (m) => {
                    if (confirm("Törlöd ezt az eredmény nélküli mérkőzést?"))
                      await mutate(
                        `/matches/${m.id}`,
                        "DELETE",
                        undefined,
                        "A mérkőzés törölve.",
                      );
                  }}
                />
              )}
              {page === "standings" && <Standings data={data} />}
              {page === "notifications" && (
                <Notifications
                  data={data}
                  organizer={organizer}
                  open={setDialog}
                  action={mutate}
                  configure={() => changePage("settings")}
                  refresh={refresh}
                />
              )}
              {page === "settings" && (
                <Settings
                  data={data}
                  user={user}
                  open={setDialog}
                  changed={refresh}
                />
              )}
            </>
          )}
          <footer>
            <span>TournamentManager</span>
            <span>
              {data?.tournament.name} · {data?.tournament.season}
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <span>
            <Check size={16} />
          </span>
          {toast}
          <button
            className="icon-btn"
            aria-label="Értesítés bezárása"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {dialog && (
        <Modal
          key={JSON.stringify(dialog)}
          dialog={dialog}
          data={data}
          user={user}
          close={() => {
            setDialog(null);
            void refresh().catch((e) => setError(err(e)));
          }}
          done={async (message, newId) => {
            setDialog(null);
            await loadTournaments();
            if (newId) {
              setSelected(newId);
              changePage("overview");
            } else await refresh();
            notify(message);
          }}
        />
      )}
    </div>
  );
}
