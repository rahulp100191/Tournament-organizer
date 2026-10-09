import { useEffect, useState } from "react";
import { api, date, levels, money, sports, upload } from "./api";
import { auth } from "./Auth";
import { localTime } from "./AthleteScreen";
const category = () => ({
  name: "Open singles",
  entry_type: "singles",
  format: "knockout",
  capacity: 16,
  fee: 50000,
  min_age: 18,
  max_age: 100,
  gender: "any",
  levels: [...levels],
  best_of: 3,
  school_required: false,
  points: { winner: 400, runner: 250, semi: 150, participation: 40 },
});
export function AdminScreen() {
  const [data, setData] = useState<any>(null),
    [tab, setTab] = useState("events"),
    [edit, setEdit] = useState<any>(undefined),
    [selected, setSelected] = useState<any>(null),
    [matches, setMatches] = useState<any[]>([]),
    [entries, setEntries] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function refresh() {
    const overview = await api("/admin/overview");
    setData(overview);
    if (selected) {
      setSelected(overview.events.find((e: any) => e.id === selected.id));
      const [m, e] = await Promise.all([
        api("/admin/events/" + selected.id + "/matches"),
        api("/admin/events/" + selected.id + "/entries"),
      ]);
      setMatches(m);
      setEntries(e);
    }
  }
  useEffect(() => {
    let active = true;
    api("/admin/overview")
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, []);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function select(e: any) {
    setBusy(true);
    setError("");
    try {
      const [m, en] = await Promise.all([
        api("/admin/events/" + e.id + "/matches"),
        api("/admin/events/" + e.id + "/entries"),
      ]);
      setSelected(e);
      setMatches(m);
      setEntries(en);
      setTab("fixtures");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="section-head">
        <div>
          <span className="eyebrow">ORGANISER DESK</span>
          <h1>Tournament operations</h1>
          <p>Publish events. Verify entries. Keep every decision traceable.</p>
        </div>
        <button
          className="button"
          onClick={() => {
            setEdit(null);
            setTab("events");
          }}
        >
          Create event
        </button>
      </div>
      <div className="sport-tabs">
        {[
          "events",
          "payments",
          "refunds",
          "fixtures",
          "rankings",
          "disputes",
          "audit",
        ].map((t) => (
          <button
            className={tab === t ? "active" : ""}
            key={t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!data ? (
        <p>Loading admin dashboard…</p>
      ) : (
        <>
          {tab === "events" &&
            (edit !== undefined ? (
              <EventForm
                event={edit}
                onCancel={() => setEdit(undefined)}
                onSave={() => {
                  setEdit(undefined);
                  act(() => Promise.resolve());
                }}
              />
            ) : (
              <div className="real-grid">
                {data.events.map((e: any) => (
                  <section className="panel" key={e.id}>
                    <span className="pill">
                      {e.status} · {e.sport}
                    </span>
                    <h2>{e.name}</h2>
                    <p>
                      {e.city} · {date(e.starts_at)}
                    </p>
                    <p>{e.categories.length} categories</p>
                    <div className="actions">
                      <button
                        className="button secondary"
                        onClick={() => setEdit(e)}
                      >
                        Edit event
                      </button>
                      <button
                        className="button secondary"
                        onClick={() => select(e)}
                      >
                        Manage entries & fixtures
                      </button>
                    </div>
                    <div className="actions">
                      {(e.status === "draft"
                        ? ["published"]
                        : e.status === "published"
                          ? ["closed", "cancelled"]
                          : e.status === "closed"
                            ? ["published", "completed", "cancelled"]
                            : []
                      ).map((status) => (
                        <button
                          className="button"
                          disabled={busy}
                          key={status}
                          onClick={() =>
                            act(() =>
                              api("/admin/events/" + e.id + "/status", "POST", {
                                status,
                              }),
                            )
                          }
                        >
                          {status === "published"
                            ? "Publish"
                            : status === "closed"
                              ? "Close entries"
                              : status === "completed"
                                ? "Mark completed"
                                : "Cancel event & create refunds"}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ))}
          {tab === "payments" && (
            <>
              {data.corrections?.map((c: any) => (
                <section className="panel" key={c.id}>
                  <span className="pill">Payment correction · {c.status}</span>
                  <p>
                    {c.reference} · {c.reason}
                  </p>
                  {c.status === "open" ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        act(() =>
                          api(
                            "/admin/corrections/" + c.id + "/resolve",
                            "POST",
                            {
                              resolution: f.get("resolution"),
                              allow_resubmit: f.get("resubmit") === "on",
                            },
                          ),
                        );
                      }}
                    >
                      <label className="field">
                        Resolution
                        <input name="resolution" required minLength={3} />
                      </label>
                      <label className="check-label">
                        <input name="resubmit" type="checkbox" />
                        Reject the original submission and allow corrected
                        details
                      </label>
                      <button className="button" disabled={busy}>
                        Resolve correction
                      </button>
                    </form>
                  ) : (
                    <p>{c.resolution}</p>
                  )}
                </section>
              ))}
              {data.payments.filter((p: any) => p.status === "submitted")
                .length === 0 && (
                <section className="panel">
                  <p>No payments awaiting review.</p>
                </section>
              )}
              {data.payments.map((p: any) => (
                <section className="panel" key={p.id}>
                  <div className="split">
                    <div>
                      <span className="pill">
                        {p.mode.toUpperCase()} · {p.status}
                        {p.overdue && p.status === "submitted"
                          ? " · REVIEW OVERDUE >24h"
                          : ""}
                      </span>
                      <h2>{p.event_name}</h2>
                      <p>
                        {p.category_name} · {money(p.amount)}
                      </p>
                      <p>
                        {p.reference} · {p.payer_name} · {date(p.paid_at)}
                      </p>
                      <p>Entry: {p.entry_status}</p>
                    </div>
                    {p.proof_id && (
                      <button
                        className="button secondary"
                        onClick={() => act(() => privateImage(p.proof_id))}
                      >
                        View private evidence
                      </button>
                    )}
                  </div>
                  {p.status === "submitted" && (
                    <ReviewForm
                      busy={busy}
                      label={
                        p.mode === "test"
                          ? "I checked this TEST submission; no money changed hands."
                          : "I checked the actual bank transaction, amount and reference."
                      }
                      onReview={(approved, reason) =>
                        act(() =>
                          api("/admin/payments/" + p.id + "/review", "POST", {
                            approved,
                            reason,
                            bank_checked: true,
                          }),
                        )
                      }
                    />
                  )}
                  {[
                    "needs_review_no_seat",
                    "payment_rejected",
                    "cancelled",
                    "withdrawn",
                  ].includes(p.entry_status) && (
                    <details>
                      <summary>
                        Bank-verified refund without confirming an entry
                      </summary>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          act(() =>
                            api("/admin/payments/" + p.id + "/refund", "POST", {
                              bank_checked: true,
                              reason: new FormData(e.currentTarget).get(
                                "reason",
                              ),
                            }),
                          );
                        }}
                      >
                        <label className="field">
                          Refund reason
                          <input name="reason" required minLength={3} />
                        </label>
                        <label className="check-label">
                          <input type="checkbox" required />I verified the
                          incoming bank transaction (or TEST simulation).
                        </label>
                        <button className="button secondary" disabled={busy}>
                          Create refund task
                        </button>
                      </form>
                    </details>
                  )}
                </section>
              ))}
            </>
          )}
          {tab === "refunds" && (
            <>
              {!data.refunds.length && (
                <section className="panel">
                  <p>No refund tasks.</p>
                </section>
              )}
              {data.refunds.map((r: any) => (
                <section className="panel" key={r.id}>
                  <span className="pill">{r.status}</span>
                  <h2>{r.event_name}</h2>
                  <p>
                    {money(r.amount)} · {r.reason}
                  </p>
                  {r.status === "pending" ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        act(() =>
                          api("/admin/refunds/" + r.id, "POST", {
                            bank_checked: true,
                            bank_reference: f.get("reference"),
                          }),
                        );
                      }}
                    >
                      <label className="field">
                        Bank refund reference (use TEST- in testing)
                        <input name="reference" required minLength={3} />
                      </label>
                      <label className="check-label">
                        <input type="checkbox" required />I verified the refund
                        transaction or test simulation.
                      </label>
                      <button className="button" disabled={busy}>
                        Record refund
                      </button>
                    </form>
                  ) : (
                    <p>Refund reference: {r.bank_reference}</p>
                  )}
                </section>
              ))}
            </>
          )}
          {tab === "fixtures" && (
            <>
              <label className="field">
                Tournament
                <select
                  value={selected?.id || ""}
                  onChange={(e) =>
                    select(
                      data.events.find((v: any) => v.id === e.target.value),
                    )
                  }
                >
                  <option value="" disabled>
                    Choose event
                  </option>
                  {data.events.map((e: any) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
              {selected && (
                <>
                  <section className="panel">
                    <div className="split">
                      <h2>{selected.name}</h2>
                      <button
                        className="button secondary"
                        onClick={() => act(() => exportReport(selected.id))}
                      >
                        Export participants & payments
                      </button>
                    </div>
                    {selected.categories.map((c: any) => (
                      <div className="category-line" key={c.id}>
                        <strong>{c.name}</strong>
                        <p>
                          {c.format} · confirmed entries only · automatic
                          seeding by Rally points
                        </p>
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() =>
                            act(() =>
                              api(
                                "/admin/categories/" + c.id + "/draw",
                                "POST",
                                {},
                              ),
                            )
                          }
                        >
                          {c.draw_published
                            ? "Regenerate unplayed draw"
                            : "Publish draw"}
                        </button>
                      </div>
                    ))}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        act(() =>
                          api(
                            "/admin/events/" + selected.id + "/announcements",
                            "POST",
                            { text: f.get("text") },
                          ),
                        );
                      }}
                    >
                      <label className="field">
                        Publish an announcement
                        <textarea
                          name="text"
                          required
                          minLength={3}
                          maxLength={1000}
                        />
                      </label>
                      <button className="button" disabled={busy}>
                        Publish & notify participants
                      </button>
                    </form>
                  </section>
                  <section className="panel">
                    <h2>Participant register</h2>
                    {entries.map((en) => (
                      <div className="category-line" key={en.id}>
                        <strong>
                          {en.members?.map((m: any) => m.name).join(" / ")}
                        </strong>
                        <p>
                          {en.category_name} · {en.status} · {en.id.slice(0, 8)}
                        </p>
                        <p>
                          Emergency: {en.emergency_contact}
                          {en.school ? " · " + en.school : ""}
                        </p>
                        {en.members
                          ?.filter((m: any) => m.kind === "junior")
                          .map((m: any) => (
                            <p key={m.id}>
                              Guardian: {m.guardian_name} · consent{" "}
                              {date(m.consent_at)} · {m.phone}
                            </p>
                          ))}
                        {en.status === "withdrawal_requested" && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const f = new FormData(e.currentTarget);
                              act(() =>
                                api(
                                  "/admin/entries/" + en.id + "/withdrawal",
                                  "POST",
                                  {
                                    reason: f.get("reason"),
                                    refund: f.get("refund") === "on",
                                  },
                                ),
                              );
                            }}
                          >
                            <label className="field">
                              Withdrawal decision reason
                              <input name="reason" required minLength={3} />
                            </label>
                            <label className="check-label">
                              <input type="checkbox" name="refund" />
                              Create a refund task under the event policy
                            </label>
                            <button className="button" disabled={busy}>
                              Approve withdrawal
                            </button>
                          </form>
                        )}
                      </div>
                    ))}
                  </section>
                  {matches.map((m) => (
                    <MatchForm
                      key={m.id + ":" + m.version}
                      match={m}
                      busy={busy}
                      act={act}
                    />
                  ))}
                </>
              )}
            </>
          )}
          {tab === "rankings" && (
            <>
              {!data.claims.length && (
                <section className="panel">
                  <p>No official ranking claims submitted.</p>
                </section>
              )}
              {data.claims.map((c: any) => (
                <section className="panel" key={c.athlete_id + c.sport}>
                  <h2>
                    {c.name} · {c.sport}
                  </h2>
                  {c.rankings.map((r: any) => (
                    <div className="category-line" key={r.scope}>
                      <strong>
                        {r.scope} #{r.rank} · {r.authority}
                      </strong>
                      <p>
                        {r.category} · {r.date} ·{" "}
                        {r.player_id || "No membership ID"}
                      </p>
                      {r.source && (
                        <a href={r.source} target="_blank" rel="noreferrer">
                          Review source
                        </a>
                      )}
                      <p>
                        {c.reviews.find((v: any) => v.scope === r.scope)
                          ?.status || "Self-reported"}
                      </p>
                      <ReviewForm
                        busy={busy}
                        label="I reviewed the supplied ranking source."
                        onReview={(approved, reason) =>
                          act(() =>
                            api("/admin/rankings/review", "POST", {
                              athlete_id: c.athlete_id,
                              sport: c.sport,
                              scope: r.scope,
                              status: approved ? "verified" : "rejected",
                              reason,
                            }),
                          )
                        }
                      />
                    </div>
                  ))}
                </section>
              ))}
            </>
          )}
          {tab === "disputes" && (
            <>
              {!data.disputes.length && (
                <section className="panel">
                  <p>No result disputes.</p>
                </section>
              )}
              {data.disputes.map((d: any) => (
                <section className="panel" key={d.id}>
                  <span className="pill">{d.status}</span>
                  <p>{d.reason}</p>
                  <small>Match {d.match_id}</small>
                  {d.status === "open" ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        act(() =>
                          api("/admin/disputes/" + d.id + "/resolve", "POST", {
                            resolution: new FormData(e.currentTarget).get(
                              "resolution",
                            ),
                          }),
                        );
                      }}
                    >
                      <label className="field">
                        Resolution
                        <textarea name="resolution" required minLength={3} />
                      </label>
                      <button className="button" disabled={busy}>
                        Resolve & notify athlete
                      </button>
                    </form>
                  ) : (
                    <p>{d.resolution}</p>
                  )}
                </section>
              ))}
            </>
          )}
          {tab === "audit" && (
            <section className="panel">
              <h2>Audit history</h2>
              {data.audit.map((a: any) => (
                <div className="category-line" key={a.id}>
                  <strong>{a.action}</strong>
                  <p>
                    {a.entity_id} · {date(a.created_at)}
                  </p>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </>
  );
}
function ReviewForm({
  label,
  busy,
  onReview,
}: {
  label: string;
  busy: boolean;
  onReview: (approved: boolean, reason: string) => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onReview(f.get("decision") === "approve", String(f.get("reason")));
      }}
    >
      <label className="field">
        Decision
        <select name="decision">
          <option value="approve">Approve</option>
          <option value="reject">Reject</option>
        </select>
      </label>
      <label className="field">
        Reason / verification note
        <input name="reason" required minLength={3} maxLength={1000} />
      </label>
      <label className="check-label">
        <input type="checkbox" required />
        {label}
      </label>
      <button className="button" disabled={busy}>
        Record decision
      </button>
    </form>
  );
}
function MatchForm({
  match: m,
  busy,
  act,
}: {
  match: any;
  busy: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <section className="panel">
      <span className="pill">
        {m.category_name} · Round {m.round} · {m.status}
      </span>
      <h3>
        {m.label_a || "Awaiting opponent"} vs {m.label_b || "Awaiting opponent"}
      </h3>
      <p>
        {date(m.scheduled_at)} · {m.court || "Court not assigned"}
      </p>
      {m.status === "pending" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            act(() =>
              api("/admin/matches/" + m.id + "/schedule", "PUT", {
                court: f.get("court"),
                scheduled_at: new Date(String(f.get("time"))).toISOString(),
              }),
            );
          }}
        >
          <div className="form-grid">
            <label className="field">
              Court
              <input name="court" required defaultValue={m.court || ""} />
            </label>
            <label className="field">
              Match time
              <input
                name="time"
                type="datetime-local"
                required
                defaultValue={
                  m.scheduled_at ? localTime(Date.parse(m.scheduled_at)) : ""
                }
              />
            </label>
          </div>
          <button className="button secondary" disabled={busy}>
            Publish schedule
          </button>
        </form>
      )}
      {m.entry_a && m.entry_b && m.status !== "bye" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            act(async () => {
              const raw = String(f.get("sets")).trim();
              const sets = raw
                ? raw.split(",").map((s) => s.trim().split("-").map(Number))
                : [];
              await api("/admin/matches/" + m.id + "/result", "POST", {
                winner_id: f.get("winner") || null,
                sets,
                outcome: f.get("outcome"),
                version: m.version,
              });
            });
          }}
        >
          <div className="form-grid">
            <label className="field">
              Winner
              <select name="winner" defaultValue={m.winner_id || m.entry_a}>
                <option value={m.entry_a}>{m.label_a}</option>
                <option value={m.entry_b}>{m.label_b}</option>
                <option value="">Neither (double withdrawal)</option>
              </select>
            </label>
            <label className="field">
              Result type
              <select
                name="outcome"
                defaultValue={m.score?.outcome || "played"}
              >
                {["played", "walkover", "withdrawal", "double_withdrawal"].map(
                  (v) => (
                    <option key={v} value={v}>
                      {v.replace("_", " ")}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
          <label className="field">
            Set scores, player A–B (example: 21-15,21-18)
            <input
              name="sets"
              defaultValue={
                m.score?.sets?.map((s: number[]) => s.join("-")).join(",") || ""
              }
            />
          </label>
          <button className="button" disabled={busy}>
            {m.status === "completed"
              ? "Correct result & recalculate points"
              : "Publish verified result"}
          </button>
        </form>
      )}
    </section>
  );
}
export function EventForm({
  event,
  onSave,
  onCancel,
}: {
  event: any;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [e, setE] = useState<any>(
    event || {
      name: "",
      sport: "Badminton",
      city: "",
      state: "",
      venue: "",
      starts_at: "",
      ends_at: "",
      registration_deadline: "",
      withdrawal_deadline: "",
      age_cutoff: "",
      rules: "",
      refund_policy: "",
      poster_url: "",
      categories: [category()],
    },
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setE({ ...e, [k]: v });
  const cat = (i: number, k: string, v: any) =>
    set(
      "categories",
      e.categories.map((c: any, j: number) => (i === j ? { ...c, [k]: v } : c)),
    );
  return (
    <form
      className="panel"
      onSubmit={async (ev) => {
        ev.preventDefault();
        setBusy(true);
        setError("");
        try {
          const payload = { ...e };
          for (const k of [
            "starts_at",
            "ends_at",
            "registration_deadline",
            "withdrawal_deadline",
          ])
            payload[k] = new Date(e[k]).toISOString();
          await api(
            "/admin/events" + (event ? "/" + event.id : ""),
            event ? "PUT" : "POST",
            payload,
          );
          onSave();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>{event ? "Edit event" : "Draft a tournament"}</h2>
      <p>
        Drafts are visible only to admin. Publish when rules, fees and
        eligibility are ready.
      </p>
      <div className="form-grid">
        {[
          ["name", "Tournament name"],
          ["city", "City"],
          ["state", "State"],
          ["venue", "Venue"],
        ].map(([k, label]) => (
          <label className="field" key={k}>
            {label}
            <input
              required
              value={e[k]}
              onChange={(ev) => set(k, ev.target.value)}
            />
          </label>
        ))}
        <label className="field">
          Sport
          <select
            value={e.sport}
            onChange={(ev) => set("sport", ev.target.value)}
          >
            {sports.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        {[
          ["starts_at", "Starts"],
          ["ends_at", "Ends"],
          ["registration_deadline", "Registration deadline"],
          ["withdrawal_deadline", "Withdrawal deadline"],
        ].map(([k, label]) => (
          <label className="field" key={k}>
            {label}
            <input
              required
              type="datetime-local"
              value={e[k] ? localTime(Date.parse(e[k])) : ""}
              onChange={(ev) => set(k, ev.target.value)}
            />
          </label>
        ))}
        <label className="field">
          Published age cutoff
          <input
            required
            type="date"
            value={String(e.age_cutoff).slice(0, 10)}
            onChange={(ev) => set("age_cutoff", ev.target.value)}
          />
        </label>
      </div>
      <label className="field">
        Event poster (optional, maximum 2 MB)
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={async (ev) => {
            if (ev.target.files?.[0]) {
              setBusy(true);
              try {
                const p = await upload(ev.target.files[0], "poster");
                set("poster_url", p.url);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }
          }}
        />
      </label>
      {e.poster_url && (
        <img
          className="poster-preview"
          src={e.poster_url}
          alt="Tournament poster"
        />
      )}
      <label className="field">
        Rules
        <textarea
          required
          minLength={10}
          value={e.rules}
          onChange={(ev) => set("rules", ev.target.value)}
        />
      </label>
      <label className="field">
        Refund and withdrawal policy
        <textarea
          required
          minLength={10}
          value={e.refund_policy}
          onChange={(ev) => set("refund_policy", ev.target.value)}
        />
      </label>
      <h3>Categories</h3>
      {e.categories.map((c: any, i: number) => (
        <fieldset key={i}>
          <legend>Category {i + 1}</legend>
          <div className="form-grid">
            <label className="field">
              Category name
              <input
                required
                value={c.name}
                onChange={(ev) => cat(i, "name", ev.target.value)}
              />
            </label>
            <label className="field">
              Entry type
              <select
                value={c.entry_type}
                onChange={(ev) => cat(i, "entry_type", ev.target.value)}
              >
                <option value="singles">Singles</option>
                <option value="doubles">Doubles</option>
              </select>
            </label>
            <label className="field">
              Format
              <select
                value={c.format}
                onChange={(ev) => cat(i, "format", ev.target.value)}
              >
                <option value="knockout">Single elimination</option>
                <option value="round_robin">Round robin</option>
              </select>
            </label>
            {[
              ["capacity", "Entry / team capacity", c.capacity],
              ["fee", "Entry fee (₹)", c.fee / 100],
              ["min_age", "Minimum age", c.min_age],
              ["max_age", "Maximum age", c.max_age],
            ].map(([k, label, value]) => (
              <label className="field" key={String(k)}>
                {label}
                <input
                  type="number"
                  min="0"
                  required
                  value={value}
                  onChange={(ev) =>
                    cat(
                      i,
                      String(k),
                      Number(ev.target.value) * (k === "fee" ? 100 : 1),
                    )
                  }
                />
              </label>
            ))}
            <label className="field">
              Eligibility category
              <select
                value={c.gender}
                onChange={(ev) => cat(i, "gender", ev.target.value)}
              >
                {["any", "male", "female", "mixed"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Best of
              <select
                value={c.best_of}
                onChange={(ev) => cat(i, "best_of", Number(ev.target.value))}
              >
                {[1, 3, 5].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="actions">
            {levels.map((l) => (
              <label className="check-label" key={l}>
                <input
                  type="checkbox"
                  checked={c.levels.includes(l)}
                  onChange={(ev) =>
                    cat(
                      i,
                      "levels",
                      ev.target.checked
                        ? [...c.levels, l]
                        : c.levels.filter((v: string) => v !== l),
                    )
                  }
                />
                {l}
              </label>
            ))}
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={c.school_required}
              onChange={(ev) => cat(i, "school_required", ev.target.checked)}
            />
            Require school / college details
          </label>
          <details>
            <summary>Rally points awarded</summary>
            <div className="form-grid">
              {Object.keys(c.points).map((k) => (
                <label className="field" key={k}>
                  {k}
                  <input
                    type="number"
                    min="0"
                    max="5000"
                    value={c.points[k]}
                    onChange={(ev) =>
                      cat(i, "points", {
                        ...c.points,
                        [k]: Number(ev.target.value),
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </details>
          {e.categories.length > 1 && (
            <button
              type="button"
              onClick={() =>
                set(
                  "categories",
                  e.categories.filter((_: any, j: number) => i !== j),
                )
              }
            >
              Remove category
            </button>
          )}
        </fieldset>
      ))}
      <button
        className="button secondary"
        type="button"
        onClick={() => set("categories", [...e.categories, category()])}
      >
        Add category
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button className="button" disabled={busy}>
          {busy ? "Saving…" : "Save draft"}
        </button>
        <button type="button" className="button secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
async function privateImage(id: string) {
  const token = await auth?.currentUser?.getIdToken();
  const r = await fetch("/api/v1/me/uploads/" + id, {
    headers: { Authorization: "Bearer " + token },
    cache: "no-store",
  });
  if (!r.ok) throw new Error("Evidence could not be opened.");
  const url = URL.createObjectURL(await r.blob());
  const w = window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  if (!w) throw new Error("Allow popups to view the private evidence.");
}
async function exportReport(id: string) {
  const token = await auth?.currentUser?.getIdToken();
  const r = await fetch("/api/v1/admin/events/" + id + "/export", {
    headers: { Authorization: "Bearer " + token },
  });
  if (!r.ok) throw new Error("Export failed.");
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = "rally-event-report.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
