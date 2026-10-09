import { useEffect, useState } from "react";
import { api, date, money, upload } from "./api";
import { ProfileForm } from "./ProfileForm";
const label = (status: string) =>
  ({
    awaiting_verification: "Awaiting payment verification",
    needs_review_no_seat: "Late claim — admin capacity review",
    partner_pending: "Waiting for partner",
    awaiting_payment: "Payment due",
    payment_rejected: "Payment rejected",
  })[status] || status.replaceAll("_", " ");
export function AthleteScreen({
  me,
  refresh,
  openEvent,
}: {
  me: any;
  refresh: () => Promise<void>;
  openEvent: (id: string) => void;
}) {
  const [entries, setEntries] = useState<any[]>([]),
    [editing, setEditing] = useState<any>(undefined),
    [tab, setTab] = useState("entries"),
    [error, setError] = useState(""),
    [payment, setPayment] = useState<any>(null),
    [history, setHistory] = useState<any>(null),
    [busy, setBusy] = useState(false);
  async function reload() {
    setEntries(await api("/me/entries"));
    await refresh();
  }
  useEffect(() => {
    let active = true;
    api("/me/entries")
      .then((e) => {
        if (active) setEntries(e);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [me.account.id]);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function showPayment(en: any) {
    await act(async () => {
      const instructions = await api("/me/payment-instructions");
      setPayment({ ...en, instructions });
    });
  }
  return (
    <>
      <div className="section-head">
        <div>
          <span className="eyebrow">YOUR TOURNAMENT JOURNEY</span>
          <h1>My Rally</h1>
          <p>
            Profiles, entries and every step between registration and results.
          </p>
        </div>
        <button
          className="button"
          onClick={() => {
            setEditing(null);
            setTab("profiles");
          }}
        >
          Add athlete
        </button>
      </div>
      <div className="sport-tabs">
        <button disabled={busy} onClick={() => act(() => Promise.resolve())}>
          Refresh updates
        </button>
        {["entries", "profiles", "notifications", "history"].map((t) => (
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
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {tab === "profiles" &&
        (editing !== undefined ? (
          <ProfileForm
            profile={editing}
            onSave={() => {
              setEditing(undefined);
              act(() => Promise.resolve());
            }}
            onCancel={() => setEditing(undefined)}
          />
        ) : (
          <div className="real-grid">
            {me.profiles.map((p: any) => (
              <section className="panel" key={p.id}>
                <span className="pill">
                  {p.kind === "junior"
                    ? "Guardian-managed junior"
                    : "Adult athlete"}{" "}
                  · {p.is_public ? "Public results" : "Private"}
                </span>
                <h2>{p.name}</h2>
                <p>
                  {p.city}, {p.state}
                </p>
                <strong className="big-points">
                  {p.points} <small>Rally points</small>
                </strong>
                {p.sports.map((s: any) => (
                  <div className="category-line" key={s.sport}>
                    <strong>
                      {s.sport}
                      {s.primary_sport ? " · Primary" : ""}
                    </strong>
                    <p>
                      {s.level} · {s.years} years · {s.categories.join(" / ")}
                    </p>
                    {s.rankings.length ? (
                      s.rankings.map((r: any) => (
                        <p key={r.scope}>
                          {r.scope} #{r.rank} ·{" "}
                          {p.ranking_reviews?.find(
                            (review: any) =>
                              review.sport === s.sport &&
                              review.scope === r.scope,
                          )?.status || "self-reported"}
                        </p>
                      ))
                    ) : (
                      <p>Unranked / no official ranking</p>
                    )}
                  </div>
                ))}
                <div className="actions">
                  <button
                    className="button secondary"
                    onClick={() => setEditing(p)}
                  >
                    Edit profile
                  </button>
                  <button
                    onClick={() =>
                      act(() => api("/me/profiles/" + p.id, "DELETE"))
                    }
                  >
                    Remove profile
                  </button>
                </div>
              </section>
            ))}
            {!me.profiles.length && (
              <section className="panel">
                <h2>Your first athlete profile</h2>
                <p>
                  Add the sports you play and the categories you prefer. Juniors
                  use a profile managed by their guardian.
                </p>
                <button className="button" onClick={() => setEditing(null)}>
                  Create profile
                </button>
              </section>
            )}
          </div>
        ))}
      {tab === "entries" && (
        <>
          {!entries.length && (
            <section className="panel empty">
              <h2>Your next tournament is waiting</h2>
              <p>Your entries and payment reviews will appear here.</p>
            </section>
          )}
          {entries.map((en) => (
            <section className="panel entry-card" key={en.id}>
              <div className="split">
                <div>
                  <span className="pill">{label(en.status)}</span>
                  <h2>{en.event_name}</h2>
                  <p>
                    {en.category_name} ·{" "}
                    {en.members?.map((m: any) => m.name).join(" / ")}
                  </p>
                  <p>
                    {date(en.starts_at)} · {en.venue}
                  </p>
                  <small>
                    Entry {en.id.slice(0, 8)} · {money(en.fee)}
                  </small>
                </div>
                <button
                  className="button secondary"
                  onClick={() => openEvent(en.event_id)}
                >
                  Draws & schedule
                </button>
              </div>
              {en.status === "partner_pending" && (
                <div className="rules-box">
                  <strong>Invite your doubles partner</strong>
                  <p>
                    The partner selects their own eligible profile and accepts
                    the rules.
                  </p>
                  <input
                    className="share-input"
                    aria-label="Partner invitation link"
                    readOnly
                    value={location.origin + "/?invite=" + en.invite_token}
                  />
                  <button
                    className="button secondary"
                    onClick={() =>
                      act(async () => {
                        await navigator.clipboard.writeText(
                          location.origin + "/?invite=" + en.invite_token,
                        );
                      })
                    }
                  >
                    Copy invitation link
                  </button>
                  <small>Expires {date(en.invite_expires_at)}</small>
                </div>
              )}
              {en.status === "awaiting_payment" && (
                <p>Slot reserved until {date(en.reservation_expires_at)}.</p>
              )}
              {en.payments?.map((p: any) => (
                <div className="rules-box" key={p.id}>
                  {p.mode === "test" ? "TEST · " : ""}
                  {p.reference} · {p.status}
                  {p.reason ? " — " + p.reason : ""}
                  {p.status !== "confirmed" && (
                    <details>
                      <summary>Request a payment correction</summary>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const reason = new FormData(e.currentTarget).get(
                            "reason",
                          );
                          act(() =>
                            api(
                              "/me/payments/" + p.id + "/correction",
                              "POST",
                              { reason },
                            ),
                          );
                        }}
                      >
                        <label className="field">
                          What needs correcting?
                          <textarea
                            name="reason"
                            required
                            minLength={3}
                            maxLength={1000}
                          />
                        </label>
                        <button className="button secondary" disabled={busy}>
                          Send correction request
                        </button>
                      </form>
                    </details>
                  )}
                </div>
              ))}
              {en.refund && (
                <p className="notice">
                  Refund {en.refund.status} · {money(en.refund.amount)}
                  {en.refund.bank_reference
                    ? " · " + en.refund.bank_reference
                    : ""}
                </p>
              )}
              <div className="actions">
                {["awaiting_payment", "expired", "payment_rejected"].includes(
                  en.status,
                ) &&
                  en.fee > 0 && (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => showPayment(en)}
                    >
                      Submit payment details
                    </button>
                  )}
                {![
                  "withdrawn",
                  "cancelled",
                  "expired",
                  "withdrawal_requested",
                ].includes(en.status) && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      act(() =>
                        api("/me/entries/" + en.id + "/withdraw", "POST", {}),
                      )
                    }
                  >
                    Request withdrawal
                  </button>
                )}
              </div>
            </section>
          ))}
        </>
      )}
      {tab === "notifications" && (
        <section className="panel">
          <div className="split">
            <h2>Updates</h2>
            <button
              onClick={() =>
                act(() => api("/me/notifications/read", "POST", {}))
              }
            >
              Mark all read
            </button>
          </div>
          {me.notifications.length ? (
            me.notifications.map((n: any) => (
              <p className="rules-box" key={n.id}>
                {!n.read_at && <span className="pill">New</span>} {n.text}
                <small>{date(n.created_at)}</small>
              </p>
            ))
          ) : (
            <p>You are up to date.</p>
          )}
        </section>
      )}
      {tab === "history" && (
        <section className="panel">
          <h2>Verified results & certificates</h2>
          <label className="field">
            Athlete
            <select
              defaultValue=""
              onChange={(e) =>
                act(async () =>
                  setHistory({
                    ...(await api("/me/history/" + e.target.value)),
                    athlete: me.profiles.find(
                      (p: any) => p.id === e.target.value,
                    ),
                  }),
                )
              }
            >
              <option value="" disabled>
                Choose a profile
              </option>
              {me.profiles.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {history && (
            <>
              <p>
                {history.matches.length} completed fixtures ·{" "}
                {
                  history.matches.filter((m: any) => m.winner_id === m.my_entry)
                    .length
                }{" "}
                wins
              </p>
              {history.awards.map((a: any) => (
                <div className="history-row" key={a.category_id}>
                  <span>
                    <strong>
                      {a.event_name} · {a.category_name}
                    </strong>
                    <small>
                      {a.placement} · {a.points} Rally points
                    </small>
                  </span>
                  <button
                    className="button secondary"
                    onClick={() => downloadCertificate(history.athlete.name, a)}
                  >
                    Download certificate
                  </button>
                </div>
              ))}
              {history.matches.map((m: any) => (
                <div className="match-row" key={m.id}>
                  <strong>
                    {m.event_name} · {m.category_name}
                  </strong>
                  <p>
                    Round {m.round} ·{" "}
                    {m.score?.sets
                      ?.map((s: number[]) => s.join("–"))
                      .join(", ") || m.status}{" "}
                    · {m.winner_id === m.my_entry ? "Won" : "Completed"}
                  </p>
                  <DisputeForm
                    match={m.id}
                    onSubmit={(reason) =>
                      act(() =>
                        api("/me/disputes", "POST", { match_id: m.id, reason }),
                      )
                    }
                  />
                </div>
              ))}
            </>
          )}
        </section>
      )}
      {payment && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pay-title"
          >
            <button
              className="modal-close"
              aria-label="Close payment form"
              onClick={() => setPayment(null)}
            >
              ×
            </button>
            <span className="pill">
              {payment.instructions.mode === "test"
                ? "TEST PAYMENT · NO MONEY"
                : "Manual UPI verification"}
            </span>
            <h2 id="pay-title">Payment details</h2>
            <p>
              {payment.event_name} · {payment.category_name}
            </p>
            <strong className="big-points">{money(payment.fee)}</strong>
            <div className="rules-box">
              {payment.instructions.instructions}
              {payment.instructions.upi_id && (
                <p>
                  {payment.instructions.merchant_name} ·{" "}
                  {payment.instructions.upi_id}
                </p>
              )}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                act(async () => {
                  const image = f.get("proof") as File;
                  const proof = image?.size
                    ? await upload(image, "proof")
                    : null;
                  await api("/me/entries/" + payment.id + "/payments", "POST", {
                    reference: f.get("reference"),
                    payer_name: f.get("payer"),
                    paid_at: new Date(String(f.get("paid_at"))).toISOString(),
                    ...(proof ? { proof_id: proof.id } : {}),
                  });
                  setPayment(null);
                });
              }}
            >
              <label className="field">
                {payment.instructions.mode === "test"
                  ? "Unique TEST- reference"
                  : "Transaction reference"}
                <input
                  name="reference"
                  required
                  minLength={6}
                  maxLength={40}
                  pattern={
                    payment.instructions.mode === "test"
                      ? "TEST-[a-zA-Z0-9-]+"
                      : "[a-zA-Z0-9-]+"
                  }
                  defaultValue={
                    payment.instructions.mode === "test"
                      ? "TEST-" + Date.now()
                      : ""
                  }
                />
              </label>
              <label className="field">
                Payer name
                <input name="payer" required />
              </label>
              <label className="field">
                Payment time
                <input
                  name="paid_at"
                  type="datetime-local"
                  required
                  defaultValue={localTime()}
                />
              </label>
              <label className="field">
                Private screenshot (optional, maximum 2 MB)
                <input
                  name="proof"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                />
              </label>
              <p>
                Evidence is visible only to its owner and admin. Screenshots do
                not automatically prove payment.
              </p>
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <button className="button full" disabled={busy}>
                {busy ? "Submitting…" : "Submit for admin review"}
              </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
function DisputeForm({
  match,
  onSubmit,
}: {
  match: string;
  onSubmit: (r: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return open ? (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(String(new FormData(e.currentTarget).get("reason")));
        setOpen(false);
      }}
    >
      <label className="field">
        Describe the result dispute
        <textarea name="reason" required minLength={3} maxLength={1000} />
      </label>
      <button className="button secondary">Submit dispute</button>
    </form>
  ) : (
    <button className="text-button" onClick={() => setOpen(true)}>
      Dispute result
    </button>
  );
}
export const localTime = (value = Date.now()) =>
  new Date(value - new Date(value).getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
function downloadCertificate(name: string, award: any) {
  const escape = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="850"><rect width="1200" height="850" fill="#f5f6f1"/><rect x="40" y="40" width="1120" height="770" fill="none" stroke="#143c2d" stroke-width="4"/><g fill="#143c2d" text-anchor="middle" font-family="sans-serif"><text x="600" y="160" font-size="60">Rally</text><text x="600" y="245" font-size="24">CERTIFICATE OF ${escape(award.placement.toUpperCase())}</text><text x="600" y="380" font-size="42">${escape(name)}</text><text x="600" y="470" font-size="26">${escape(award.event_name)}</text><text x="600" y="525" font-size="22">${escape(award.category_name)}</text><text x="600" y="620" font-size="20">${award.points} verified Rally competition points</text><text x="600" y="730" font-size="16">Category verification ID: ${award.category_id}</text></g></svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "rally-certificate.svg";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
