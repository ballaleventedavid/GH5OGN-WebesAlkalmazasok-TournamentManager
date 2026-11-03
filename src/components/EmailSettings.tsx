import { Check, LoaderCircle, Mail, Save } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { EmailRecipientSettings } from "../../shared/types";
import { api } from "../api";
import { err } from "../lib/format";

export function EmailSettings({ changed }: { changed?: () => Promise<void> }) {
  const [recipient, setRecipient] = useState("");
  const [savedRecipient, setSavedRecipient] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    api<EmailRecipientSettings>("/settings/email/recipient")
      .then((value) => {
        if (!active) return;
        setRecipient(value.recipient);
        setSavedRecipient(value.recipient);
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
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const value = await api<EmailRecipientSettings>(
        "/settings/email/recipient",
        "PUT",
        { recipient: recipient.trim() },
      );
      setRecipient(value.recipient);
      setSavedRecipient(value.recipient);
      setMessage("A címzett mentve. Az értesítések automatikusan érkeznek.");
      await changed?.();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card email-settings-card">
      <div className="card-heading">
        <h2>E-mail-értesítések</h2>
        <Mail size={19} />
      </div>
      <div className="email-settings-content">
        <p className="email-intro">
          A menetrend változásairól és a lezárt eredményekről automatikus
          értesítést küldünk erre a címre.
        </p>
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        {message && (
          <div className="email-feedback" role="status">
            <Check size={17} />
            {message}
          </div>
        )}
        <form
          className="email-recipient-form"
          onSubmit={save}
          aria-busy={loading || busy}
        >
          <label htmlFor="notification-recipient">
            Címzett e-mail-címe
            <input
              id="notification-recipient"
              name="recipient"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              placeholder="nev@pelda.hu"
              value={recipient}
              disabled={loading || busy}
              onChange={(event) => {
                setRecipient(event.target.value);
                setMessage("");
              }}
            />
          </label>
          <button
            className="btn primary"
            disabled={loading || busy || recipient.trim() === savedRecipient}
          >
            {loading || busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Save size={16} />
            )}{" "}
            Mentés
          </button>
        </form>
      </div>
    </section>
  );
}
