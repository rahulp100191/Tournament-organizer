import { useEffect, useState } from "react";
import { api, date, money } from "./api";
export function EventScreen({
  id,
  me,
  onLogin,
  onRegistered,
  onBack,
}: {
  id: string;
  me: any;
  onLogin: () => void;
  onRegistered: () => void;
  onBack: () => void;
}) {
  const [event, setEvent] = useState<any>(null),
    [matches, setMatches] = useState<any[]>([]),
    [tables, setTables] = useState<Record<string, any[]>>({}),
    [error, setError] = useState(""),
    [cat, setCat] = useState(""),
    [athlete, setAthlete] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([api("/events/" + id), api("/events/" + id + "/matches")])
      .then(([e, m]) => {
        if (cancelled) return;
        setEvent(e);
        setMatches(m);
        setCat(e.categories[0]?.id || "");
        Promise.all(
          e.categories
            .filter((c: any) => c.format === "round_robin" && c.draw_published)
            .map(async (c: any) => [
              c.id,
              await api("/categories/" + c.id + "/standings"),
            ]),
        )
          .then((rows) => {
            if (!cancelled) setTables(Object.fromEntries(rows));
          })
          .catch((e) => setError(e.message));
      })
      .catch((e) => setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);
  if (!event)
    return (
      <section className="panel">
        <button onClick={onBack}>← All tournaments</button>
        <p role="status">{error || "Loading tournament…"}</p>
      </section>
    );
  const category = event.categories.find((c: any) => c.id === cat);
  return (
    <>
      <button className="text-button" onClick={onBack}>
        ← All tournaments
      </button>
      <div
        className="event-cover"
        style={{
          backgroundImage: `linear-gradient(90deg,#143c2dee,#143c2d40),url(${event.poster_url || "/images/tournament.svg"})`,
        }}
      >
        <span className="pill">
          {event.sport} · {event.status}
        </span>
        <h1>{event.name}</h1>
        <p>
          {event.city}, {event.state} · {event.venue}
        </p>
        <p>
          {date(event.starts_at)} — {date(event.ends_at)}
        </p>
      </div>
      <div className="real-two">
        <section className="panel">
          <h2>Everything before you enter</h2>
          {event.details?.description && (
            <p className="preserve">{event.details.description}</p>
          )}
          <div className="detail-grid">
            <div>
              <strong>Entries close</strong>
              <small>{date(event.registration_deadline)}</small>
            </div>
            <div>
              <strong>Age cutoff</strong>
              <small>{String(event.age_cutoff).slice(0, 10)}</small>
            </div>
            <div>
              <strong>Withdrawal deadline</strong>
              <small>{date(event.withdrawal_deadline)}</small>
            </div>
            <div>
              <strong>Venue</strong>
              <small>{event.venue}</small>
            </div>
          </div>
          {event.details?.address && <p>{event.details.address}</p>}
          {event.details?.map_url && (
            <a
              href={event.details.map_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open venue map
            </a>
          )}
          {event.details?.organizer_name && (
            <div className="rules-box">
              <strong>Organised by {event.details.organizer_name}</strong>
              <p>
                Contact: {event.details.contact_phone} ·{" "}
                {event.details.contact_email}
              </p>
            </div>
          )}
          {event.details?.equipment && (
            <>
              <h3>Before you arrive</h3>
              <p className="preserve">{event.details.equipment}</p>
            </>
          )}
          <h3>Categories & eligibility</h3>
          {event.categories.map((c: any) => (
            <div className="category-line" key={c.id}>
              <strong>{c.name}</strong>
              <p>
                {c.entry_type === "singles"
                  ? "Individual / singles"
                  : c.entry_type}{" "}
                · {c.format.replace("_", " ")} ·{" "}
                {c.scoring_mode === "score"
                  ? "Final score"
                  : `Best of ${c.best_of}`}
              </p>
              <p>
                Ages {c.min_age}–{c.max_age} · {c.gender} ·{" "}
                {c.levels.join(", ")}
              </p>
              {c.entry_type === "team" && c.gender === "mixed" && (
                <p>Mixed roster: at least one male and one female player.</p>
              )}
              <p>
                {c.entry_type === "team" && (
                  <>
                    Roster: {c.team_min}–{c.team_max} players including
                    substitutes ·{" "}
                  </>
                )}
                {c.remaining} of {c.capacity}{" "}
                {c.entry_type !== "singles" ? "team" : "entry"} slots available
                · {money(c.fee)}
              </p>
              {c.school_required && (
                <span className="pill">School / college details required</span>
              )}
            </div>
          ))}
          <h3>Rules</h3>
          <p className="preserve">{event.rules}</p>
          <h3>Withdrawals & refunds</h3>
          <p className="preserve">{event.refund_policy}</p>
          <p>
            Refunds remain pending until admin records the bank refund
            reference.
          </p>
          <h3>Announcements</h3>
          {event.announcements.length ? (
            event.announcements.map((a: any) => (
              <p key={a.id} className="rules-box">
                {a.text}
                <small>{date(a.created_at)}</small>
              </p>
            ))
          ) : (
            <p>No announcements yet.</p>
          )}
        </section>
        <section className="panel registration-panel">
          <span className="eyebrow">TAKE YOUR PLACE ON COURT</span>
          <h2>Enter this tournament</h2>
          {!me ? (
            <>
              <p>Your profile helps us check category eligibility.</p>
              <button className="button" onClick={onLogin}>
                Sign in to register
              </button>
            </>
          ) : me.account.role === "admin" ? (
            <p>
              Admin manages this tournament. Athletes register using their own
              accounts and profiles.
            </p>
          ) : !me.profiles.length ? (
            <>
              <p>Create an athlete profile before entering.</p>
              <button className="button" onClick={onRegistered}>
                Create my profile
              </button>
            </>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                const f = new FormData(e.currentTarget);
                try {
                  await api("/me/entries", "POST", {
                    category_id: cat,
                    athlete_id: athlete || me.profiles[0].id,
                    emergency_contact: f.get("emergency"),
                    school: f.get("school") || "",
                    accepted_rules: true,
                    idempotency_key: crypto.randomUUID(),
                    ...(category?.entry_type === "team"
                      ? {
                          team_name: f.get("team_name"),
                          roster_size: Number(f.get("roster_size")),
                        }
                      : {}),
                  });
                  onRegistered();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="field">
                Athlete
                <select
                  value={athlete || me.profiles[0].id}
                  onChange={(e) => setAthlete(e.target.value)}
                >
                  {me.profiles.map((p: any) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                      {p.kind === "junior" ? " (junior)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Category
                <select value={cat} onChange={(e) => setCat(e.target.value)}>
                  {event.categories.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {money(c.fee)}
                    </option>
                  ))}
                </select>
              </label>
              {category?.entry_type === "team" && (
                <>
                  <label className="field">
                    Team name (public)
                    <input
                      name="team_name"
                      required
                      minLength={2}
                      maxLength={100}
                    />
                  </label>
                  <label className="field">
                    Total roster size including captain and substitutes
                    <input
                      name="roster_size"
                      type="number"
                      required
                      min={category.team_min}
                      max={category.team_max}
                      defaultValue={category.team_min}
                      key={cat}
                    />
                  </label>
                  <p>
                    You are the captain. Invite each teammate or guardian to
                    accept with their own eligible profile. The complete roster
                    uses one team slot and one payment.
                  </p>
                </>
              )}
              <label className="field">
                Emergency contact name and phone
                <input name="emergency" required maxLength={200} />
              </label>
              {category?.school_required && (
                <label className="field">
                  School / college
                  <input name="school" required maxLength={250} />
                </label>
              )}
              <div className="rules-box">
                {category?.entry_type === "team"
                  ? "Payment opens after the full roster accepts. Joining an invitation does not reserve a slot until the roster is complete."
                  : category?.entry_type === "doubles"
                    ? "Create your entry, then share the partner link. Both athletes must accept before payment. One team uses one slot and one payment."
                    : "A slot is held for 30 minutes, bounded by the entry deadline. Payment remains pending until admin review."}
              </div>
              <label className="check-label">
                <input type="checkbox" required />I accept eligibility rules,
                the refund policy and the tournament rules.
              </label>
              <div className="checkout-bar">
                <span>
                  Total entry fee<strong>{money(category?.fee || 0)}</strong>
                </span>
                <button
                  className="button"
                  disabled={
                    busy ||
                    event.status !== "published" ||
                    Date.parse(event.registration_deadline) <= Date.now()
                  }
                >
                  {busy
                    ? "Checking eligibility…"
                    : category?.entry_type === "team"
                      ? "Create team & invite players"
                      : category?.entry_type === "doubles"
                        ? "Create partner invitation"
                        : "Reserve entry"}
                </button>
              </div>
            </form>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {me && (
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  await api("/me/saved/" + id, "POST", {
                    saved: !me.saved.includes(id),
                  });
                  onRegistered();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {me.saved.includes(id) ? "Remove from saved" : "Save tournament"}
            </button>
          )}
        </section>
      </div>
      <section className="panel">
        <h2>Draws & schedule</h2>
        {matches.length ? (
          matches.map((m) => (
            <div className="match-row" key={m.id}>
              <span className="pill">
                {m.category_name} · Round {m.round}
              </span>
              <strong>
                {m.label_a || "Awaiting opponent"}{" "}
                <span className="muted">vs</span>{" "}
                {m.label_b || "Awaiting opponent"}
              </strong>
              <p>
                {m.status === "bye"
                  ? "Bye"
                  : m.score?.sets
                      ?.map((s: number[]) => s.join("–"))
                      .join(", ") || m.status}{" "}
                · {date(m.scheduled_at)}
                {m.court ? " · " + m.court : ""}
              </p>
            </div>
          ))
        ) : (
          <p>Fixtures appear after admin publishes the draw.</p>
        )}
        {Object.entries(tables).map(([category, rows]) => (
          <div key={category}>
            <h3>
              {event.categories.find((c: any) => c.id === category)?.name}{" "}
              standings
            </h3>
            <p>
              {event.categories.find((c: any) => c.id === category)
                ?.scoring_mode === "score"
                ? "Order: league points, score difference, then entry ID for exact ties."
                : "Order: wins, set difference, point difference, then entry ID for exact ties."}
            </p>
            <table>
              <thead>
                <tr>
                  <th>Entry</th>
                  <th>Wins</th>
                  <th>Losses</th>
                  <th>Draws</th>
                  <th>League points</th>
                  <th>Set difference</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.entry_id}>
                    <td>{r.label || r.entry_id.slice(0, 8)}</td>
                    <td>{r.wins}</td>
                    <td>{r.losses}</td>
                    <td>{r.draws}</td>
                    <td>{r.table_points}</td>
                    <td>{r.set_difference}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>
    </>
  );
}
