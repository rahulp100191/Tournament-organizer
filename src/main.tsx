import { PreviewScreen } from "./PreviewScreen";
import { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CalendarDays,
  Compass,
  Trophy,
  UserRound,
  ShieldCheck,
  ArrowUpRight,
  MapPin,
} from "lucide-react";
import { AuthProvider, Login, logout, useAuth } from "./Auth";
import { api, date, levels, money, sports } from "./api";
import { EventScreen } from "./EventScreen";
import "./style.css";
import "./platform.css";
const AthleteScreen = lazy(() =>
  import("./AthleteScreen").then((m) => ({ default: m.AthleteScreen })),
);
const AdminScreen = lazy(() =>
  import("./AdminScreen").then((m) => ({ default: m.AdminScreen })),
);
const samples = sports.map((sport, i) => ({
  id: "preview-" + i,
  name: [
    "Rally Open · Guwahati",
    "City Tennis Weekend",
    "Pickleball Community Cup",
  ][i],
  sport,
  city: ["Guwahati", "Shillong", "Guwahati"][i],
  state: ["Assam", "Meghalaya", "Assam"][i],
  venue: "Sample sports centre",
  starts_at: "2026-11-14T09:00:00+05:30",
  status: "Sample preview",
  categories: [
    {
      name: "Open singles",
      entry_type: "singles",
      levels: ["Amateur", "Competitive amateur"],
      fee: 50000,
    },
  ],
  preview: true,
}));
function App() {
  const { user, loading } = useAuth();
  const [page, setPage] = useState(
      new URLSearchParams(location.search).has("invite")
        ? "invite"
        : location.pathname.slice(1) || "discover",
    ),
    [me, setMe] = useState<any>(null),
    [events, setEvents] = useState<any[]>([]),
    [rankings, setRankings] = useState<any[]>([]),
    [health, setHealth] = useState<any>(null),
    [error, setError] = useState(""),
    [event, setEvent] = useState<string | null>(
      new URLSearchParams(location.search).get("event"),
    ),
    [preview, setPreview] = useState<any>(null),
    [filters, setFilters] = useState({
      sport: "",
      location: "",
      category: "",
      level: "",
      fee: "",
      date: "",
      saved: false,
    }),
    [invite, setInvite] = useState<any>(null);
  async function refresh() {
    if (user?.emailVerified) setMe(await api("/me"));
    else setMe(null);
  }
  useEffect(() => {
    let active = true;
    api("/health")
      .then((h) => {
        if (active) setHealth(h);
      })
      .catch(() => {
        if (active)
          setError("The API is unavailable. Please try again when connected.");
      });
    Promise.all([api("/events"), api("/rankings")])
      .then(([e, r]) => {
        if (active) {
          setEvents(e);
          setRankings(r);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (user?.emailVerified)
      api("/me")
        .then((m) => {
          if (active) {
            setMe(m);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    else setMe(null);
    return () => {
      active = false;
    };
  }, [user?.uid, user?.emailVerified]);
  useEffect(() => {
    const token = new URLSearchParams(location.search).get("invite");
    if (page === "invite" && user?.emailVerified && token)
      api("/invites/" + token)
        .then(setInvite)
        .catch((e) => setError(e.message));
  }, [page, user?.uid]);
  function navigate(p: string) {
    setEvent(null);
    setPage(p);
    history.replaceState(
      {},
      "",
      p === "invite" ? location.href : "/" + (p === "discover" ? "" : p),
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const setup = health && !health.database_configured;
  const displayed = setup ? samples : events;
  const filtered = displayed.filter(
    (e) =>
      (!filters.sport || e.sport === filters.sport) &&
      (!filters.location ||
        (e.city + " " + e.state + " " + e.name)
          .toLowerCase()
          .includes(filters.location.toLowerCase())) &&
      (!filters.date || String(e.starts_at).slice(0, 10) >= filters.date) &&
      (!filters.category ||
        e.categories.some((c: any) => c.entry_type === filters.category)) &&
      (!filters.level ||
        e.categories.some((c: any) => c.levels.includes(filters.level))) &&
      (!filters.fee ||
        e.categories.some((c: any) => c.fee <= Number(filters.fee))) &&
      (!filters.saved || me?.saved.includes(e.id)),
  );
  const nav = [
    ["discover", "Discover", Compass],
    ["athlete", "My Rally", UserRound],
    ["rankings", "Standings", Trophy],
    ["preview", "App preview", ShieldCheck],
    ...(me?.account.role === "admin" ? [["admin", "Admin", ShieldCheck]] : []),
  ] as const;
  return (
    <div className="platform">
      <aside className="real-sidebar">
        <a
          className="real-brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("discover");
          }}
        >
          Rally<span>YOUR NEXT CHAPTER</span>
        </a>
        <p className="sidebar-label">ON & OFF THE COURT</p>
        <nav>
          {nav.map(([p, label, Icon]) => (
            <button
              className={page === p ? "active" : ""}
              key={String(p)}
              onClick={() => navigate(String(p))}
            >
              <Icon size={20} />
              {String(label)}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <Trophy />
          <strong>Find your next challenge.</strong>
          <p>Three sports. A community of competitors. Your place on court.</p>
        </div>
        <a
          href="https://rally-grassroots-demo.vercel.app"
          target="_blank"
          rel="noreferrer"
        >
          Original demo ↗
        </a>
      </aside>
      <div className="real-shell">
        <header className="real-topbar">
          <span className="mobile-brand">Rally</span>
          <span className="header-context">
            GRASSROOTS SPORT, REAL POSSIBILITIES
          </span>
          <span className="pill">
            {health?.payments_mode === "live"
              ? "Live events"
              : "Private testing · no real payments"}
          </span>
          <button
            className="button secondary"
            onClick={() => (user ? logout() : navigate("login"))}
          >
            {user ? "Sign out" : "Sign in"} <ArrowUpRight size={14} />
          </button>
        </header>
        <main>
          {!navigator.onLine && (
            <p className="notice">
              You are offline. Cached public pages are available; account and
              tournament changes require a connection.
            </p>
          )}
          {setup && (
            <div className="setup-notice">
              <strong>Preview ready · services awaiting configuration</strong>
              <p>
                The cards below illustrate the design. Shared events and sign-in
                start after Neon and Firebase are configured. Sample cards
                cannot accept entries.
              </p>
            </div>
          )}
          {error && !setup && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {event ? (
            <EventScreen
              key={event}
              id={event}
              me={me}
              onLogin={() => navigate("login")}
              onRegistered={() => {
                refresh();
                navigate("athlete");
              }}
              onBack={() => setEvent(null)}
            />
          ) : page === "login" ? (
            <Login
              onDone={() => {
                refresh();
                navigate("athlete");
              }}
            />
          ) : page === "athlete" || page === "admin" ? (
            loading ? (
              <p>Checking account…</p>
            ) : !user || !user.emailVerified ? (
              <Login onDone={() => refresh()} />
            ) : !me ? (
              <section className="panel">
                <h2>Account setup</h2>
                <p>{error || "Connecting to your account…"}</p>
              </section>
            ) : (
              <Suspense fallback={<p>Loading your dashboard…</p>}>
                {page === "admin" ? (
                  me.account.role === "admin" ? (
                    <AdminScreen />
                  ) : (
                    <p>Admin access is required.</p>
                  )
                ) : (
                  <AthleteScreen
                    me={me}
                    refresh={refresh}
                    openEvent={setEvent}
                  />
                )}
              </Suspense>
            )
          ) : page === "preview" ? (
            <PreviewScreen />
          ) : page === "rankings" ? (
            <>
              <div className="section-head">
                <div>
                  <span className="eyebrow">EARNED ON COURT</span>
                  <h1>Rally standings</h1>
                  <p>
                    Verified competition points, separate from official
                    federation rankings.
                  </p>
                </div>
              </div>
              <section className="panel">
                {rankings.length ? (
                  rankings.map((r: any, i) => (
                    <div className="history-row" key={r.id + r.sport}>
                      <b>{i + 1}</b>
                      <span>
                        <strong>{r.name}</strong>
                        <small>
                          {r.sport} · {r.city}
                        </small>
                      </span>
                      <b>{r.points} points</b>
                    </div>
                  ))
                ) : (
                  <p>
                    Public standings appear when athletes opt in and admin
                    publishes results.
                  </p>
                )}
              </section>
            </>
          ) : page === "invite" ? (
            <section className="panel">
              <h1>Join your doubles partner</h1>
              {!user || !user.emailVerified ? (
                <Login onDone={() => refresh()} />
              ) : !me?.profiles.length ? (
                <>
                  <p>Create your profile, then reopen this link.</p>
                  <button
                    className="button"
                    onClick={() => navigate("athlete")}
                  >
                    Create profile
                  </button>
                </>
              ) : invite ? (
                <>
                  <p>
                    {invite.event_name} · {invite.category_name} ·{" "}
                    {invite.status}
                  </p>
                  <p>Expires {date(invite.invite_expires_at)}</p>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      try {
                        await api(
                          "/invites/" +
                            new URLSearchParams(location.search).get("invite") +
                            "/accept",
                          "POST",
                          {
                            athlete_id: f.get("athlete"),
                            accepted_rules: true,
                          },
                        );
                        navigate("athlete");
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    <label className="field">
                      Your athlete
                      <select name="athlete">
                        {me.profiles.map((p: any) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="check-label">
                      <input type="checkbox" required />I accept the event
                      rules, category eligibility and refund policy.{" "}
                      <button
                        type="button"
                        onClick={() => {
                          window.open("/?event=" + invite.event_id, "_blank");
                        }}
                      >
                        View event
                      </button>
                    </label>
                    <button className="button">
                      Accept partner invitation
                    </button>
                  </form>
                </>
              ) : (
                <p>{error || "Loading invitation…"}</p>
              )}
            </section>
          ) : ["privacy", "account-deletion", "support"].includes(page) ? (
            <Policy
              page={page}
              deleteAccount={async () => {
                try {
                  await api("/me/account", "DELETE");
                  await logout();
                  navigate("discover");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
          ) : (
            <>
              <div className="section-head">
                <div>
                  <span className="eyebrow">
                    SHOW UP. PLAY HARD. GO FURTHER.
                  </span>
                  <h1>Your next chapter starts on court.</h1>
                  <p>
                    Find your tournament. Bring your game. We’ll take care of
                    the details.
                  </p>
                </div>
              </div>
              <section className="discovery-hero">
                <div>
                  <span className="eyebrow">THE COMPETITION IS CALLING</span>
                  <h2>
                    More than a match.
                    <br />A moment to grow.
                  </h2>
                  <p>
                    Badminton, tennis and pickleball tournaments for every stage
                    of your sporting journey.
                  </p>
                  <button
                    className="button light"
                    onClick={() =>
                      document
                        .querySelector("#events")
                        ?.scrollIntoView({ behavior: "smooth" })
                    }
                  >
                    Find a tournament <ArrowUpRight size={17} />
                  </button>
                </div>
                <span className="hero-caption">
                  YOUR COURT. YOUR COMMUNITY.
                </span>
              </section>
              <div className="sport-tabs" id="events">
                {["All sports", ...sports].map((s) => (
                  <button
                    key={s}
                    className={
                      filters.sport === (s === "All sports" ? "" : s)
                        ? "active"
                        : ""
                    }
                    onClick={() =>
                      setFilters({
                        ...filters,
                        sport: s === "All sports" ? "" : s,
                      })
                    }
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="real-filters">
                <label>
                  Search
                  <input
                    type="search"
                    placeholder="Tournament, city or state"
                    value={filters.location}
                    onChange={(e) =>
                      setFilters({ ...filters, location: e.target.value })
                    }
                  />
                </label>
                <label>
                  Category
                  <select
                    value={filters.category}
                    onChange={(e) =>
                      setFilters({ ...filters, category: e.target.value })
                    }
                  >
                    <option value="">All categories</option>
                    <option value="singles">Singles</option>
                    <option value="doubles">Doubles</option>
                  </select>
                </label>
                <label>
                  Level
                  <select
                    value={filters.level}
                    onChange={(e) =>
                      setFilters({ ...filters, level: e.target.value })
                    }
                  >
                    <option value="">All levels</option>
                    {levels.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Maximum fee
                  <select
                    value={filters.fee}
                    onChange={(e) =>
                      setFilters({ ...filters, fee: e.target.value })
                    }
                  >
                    <option value="">Any fee</option>
                    <option value="0">Free</option>
                    <option value="50000">₹500</option>
                    <option value="100000">₹1,000</option>
                  </select>
                </label>
                <label>
                  From date
                  <input
                    type="date"
                    value={filters.date}
                    onChange={(e) =>
                      setFilters({ ...filters, date: e.target.value })
                    }
                  />
                </label>
                {me && (
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={filters.saved}
                      onChange={(e) =>
                        setFilters({ ...filters, saved: e.target.checked })
                      }
                    />
                    Saved only
                  </label>
                )}
              </div>
              <div className="section-title">
                <h2>Discover tournaments</h2>
                <span className="muted">{filtered.length} events</span>
              </div>
              <div className="real-grid">
                {filtered.map((e: any, i) => (
                  <article className="event-card" key={e.id}>
                    <div className="event-image">
                      <img
                        src={
                          e.poster_url ||
                          [
                            "/images/badminton.jpg",
                            "/images/tennis.jpg",
                            "/images/pickleball.jpg",
                          ][sports.indexOf(e.sport)]
                        }
                        alt={`${e.sport} tournament`}
                        onError={(ev) => {
                          ev.currentTarget.src = "/images/badminton.jpg";
                        }}
                      />
                      <span className="image-tag">{e.status}</span>
                      <span className="date-badge">
                        <strong>{new Date(e.starts_at).getDate()}</strong>
                        {new Date(e.starts_at).toLocaleString("en-IN", {
                          month: "short",
                        })}
                      </span>
                    </div>
                    <div className="event-body">
                      <span className="sport-label">
                        {e.sport.toUpperCase()}
                      </span>
                      <h3>{e.name}</h3>
                      <p className="meta">
                        <MapPin size={14} />
                        {e.city}, {e.state}
                      </p>
                      <p className="meta">
                        <CalendarDays size={14} />
                        {date(e.starts_at)}
                      </p>
                      <div className="event-bottom">
                        <span>
                          <strong>
                            {money(
                              Math.min(...e.categories.map((c: any) => c.fee)),
                            )}
                          </strong>
                          <small>per entry · from</small>
                        </span>
                        <button
                          className="button secondary"
                          onClick={() =>
                            e.preview ? setPreview(e) : setEvent(e.id)
                          }
                        >
                          View event ↗
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              {!filtered.length && (
                <section className="panel empty">
                  <h2>
                    {events.length
                      ? "No matching tournaments"
                      : "The next competition is coming"}
                  </h2>
                  <p>
                    {events.length
                      ? "Try changing your filters."
                      : "Admin-published tournaments will appear here for everyone."}
                  </p>
                </section>
              )}
            </>
          )}
          <footer className="real-footer">
            <strong>Rally</strong>
            <span>Compete. Belong. Grow.</span>
            <div>
              {["privacy", "account-deletion", "support"].map((p) => (
                <button key={p} onClick={() => navigate(p)}>
                  {p.replace("-", " ")}
                </button>
              ))}
            </div>
          </footer>
        </main>
      </div>
      <nav className="bottom-nav">
        {nav.map(([p, label, Icon]) => (
          <button
            key={String(p)}
            className={page === p ? "active" : ""}
            onClick={() => navigate(String(p))}
          >
            <Icon size={20} />
            {String(label)}
          </button>
        ))}
      </nav>
      {preview && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-title"
          >
            <button
              aria-label="Close sample event"
              className="modal-close"
              onClick={() => setPreview(null)}
            >
              ×
            </button>
            <span className="pill">READ-ONLY DESIGN PREVIEW</span>
            <h2 id="preview-title">{preview.name}</h2>
            <p>
              {preview.sport} · {preview.city}
            </p>
            <p>
              Singles and doubles categories, eligibility checks, partner
              invitations and admin-reviewed payments are implemented in the
              connected version.
            </p>
            <div className="rules-box">
              Configure Neon and Firebase to publish an actual event and try
              shared registration. No payment is collected in this preview.
            </div>
            <button
              className="button secondary"
              onClick={() => setPreview(null)}
            >
              Back to discovery
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
function Policy({
  page,
  deleteAccount,
}: {
  page: string;
  deleteAccount: () => void;
}) {
  return (
    <section className="panel policy">
      <span className="eyebrow">RALLY PRIVATE TESTING</span>
      <h1>{page.replace("-", " ")}</h1>
      {page === "privacy" ? (
        <>
          <p>
            Rally collects account identifiers, athlete details, sport
            preferences, guardian consent and tournament contact information to
            organise entries and matches. Optional rankings are self-reported
            until reviewed.
          </p>
          <p>
            Exact birth dates, contact information, guardian details and payment
            evidence are private. Junior profiles stay private. Adult athletes
            can opt in to showing their name and competition points publicly.
          </p>
          <p>
            Firebase handles sign-in, Neon stores tournament records, and Vercel
            hosts the app and image storage. Evidence is accessible only to the
            uploader and authorised admin. Public browsing assets may be cached
            on your device; payment evidence is never included in the offline
            cache.
          </p>
          <p>
            Use sample data during testing. Account deletion removes personal
            profile details and evidence, and anonymises retained competition
            records. Withdraw active entries first. Service providers may retain
            limited security logs and backups under their policies.
          </p>
          <p>
            This is a test notice. Before public or commercial launch, the
            operator must publish their identity, support contact and final
            retention policy.
          </p>
        </>
      ) : page === "account-deletion" ? (
        <>
          <p>
            Sign in, withdraw active entries, then request deletion below.
            Personal profiles and uploaded evidence are removed or anonymised;
            competition history remains anonymous. Admin accounts must transfer
            administration first.
          </p>
          <label className="check-label">
            <input id="delete-confirm" type="checkbox" />I understand that
            deleting my account removes my personal profile information.
          </label>
          <button
            className="button danger"
            onClick={() => {
              if (
                (document.getElementById("delete-confirm") as HTMLInputElement)
                  .checked
              )
                deleteAccount();
            }}
          >
            Delete my account
          </button>
        </>
      ) : (
        <>
          <p>
            For a tournament question, check the event announcements and
            published rules. Registered athletes can dispute a result from My
            Rally → History.
          </p>
          <p>
            During private testing, contact the organiser who invited you. A
            public support address must be configured before a store release.
          </p>
          <p>
            Payment screenshots never confirm a payment automatically. Admin
            reviews every submission. Do not transfer money for test events.
          </p>
        </>
      )}
    </section>
  );
}
createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <App />
  </AuthProvider>,
);
