import { ArrowRight, LoaderCircle, Trophy } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { User } from "../../shared/types";
import { api } from "../api";
import { err } from "../lib/format";
export function Login({
  onLogin,
  initialError,
}: {
  onLogin: (user: User, csrf: string) => void;
  initialError: string;
}) {
  const [register, setRegister] = useState(false),
    [error, setError] = useState(initialError),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await api<{ user: User; csrf: string }>(
        `/auth/${register ? "register" : "login"}`,
        "POST",
        Object.fromEntries(form),
      );
      onLogin(result.user, result.csrf);
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <header className="login-header">
        <a className="login-brand" href="/">
          <span className="brand-mark">
            <Trophy size={24} />
          </span>
          TournamentManager
        </a>
      </header>
      <section className="login-form-side">
        <div className="login-card">
          <h1>{register ? "Új fiók" : "Bejelentkezés"}</h1>
          <p>
            {register
              ? "Regisztráció csapatkapitányként."
              : "Lépj be a bajnokság kezeléséhez."}
          </p>
          {error && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}
          <form key={register ? "register" : "login"} onSubmit={submit}>
            {register && (
              <label>
                Teljes név
                <input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={70}
                />
              </label>
            )}
            <label>
              E-mail-cím
              <input
                type="email"
                name="email"
                autoComplete="email"
                placeholder="nev@pelda.hu"
                required
              />
            </label>
            <label>
              Jelszó
              <input
                name="password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                minLength={register ? 10 : 1}
                maxLength={128}
                required
              />
            </label>
            <button className="btn primary full" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={20} />
              ) : (
                <>
                  {register ? "Fiók létrehozása" : "Bejelentkezés"}
                  <ArrowRight size={19} />
                </>
              )}
            </button>
          </form>
          <p className="switch-auth">
            {register ? "Már van fiókod?" : "Még nincs fiókod?"}{" "}
            <button
              onClick={() => {
                setRegister(!register);
                setError("");
              }}
            >
              {register ? "Bejelentkezés" : "Regisztráció"}
            </button>
          </p>
        </div>
        <span className="login-copyright">TournamentManager © 2026</span>
      </section>
    </div>
  );
}
