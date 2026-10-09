import { useState } from "react";
import { api, levels, sports, upload } from "./api";
import { PrivatePhoto } from "./PrivatePhoto";
export function ProfileForm({
  profile,
  onSave,
  onCancel,
}: {
  profile?: any;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [p, setP] = useState<any>(
    profile
      ? {
          ...profile,
          dob: String(profile.dob).slice(0, 10),
          consent: !!profile.consent_at,
        }
      : {
          kind: "self",
          name: "",
          dob: "",
          gender: "prefer_not_to_say",
          state: "",
          city: "",
          phone: "",
          guardian_name: "",
          guardian_relationship: "",
          consent: false,
          is_public: false,
          academy: "",
          coach: "",
          goal: "",
          sports: [
            {
              sport: "Badminton",
              level: "Amateur",
              years: 0,
              primary_sport: true,
              categories: ["singles", "doubles"],
              rankings: [],
            },
          ],
        },
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const set = (k: string, v: any) =>
    setP((previous: any) => ({ ...previous, [k]: v }));
  const changeSport = (i: number, k: string, v: any) =>
    set(
      "sports",
      p.sports.map((s: any, j: number) => (i === j ? { ...s, [k]: v } : s)),
    );
  return (
    <form
      className="panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api(
            "/me/profiles" + (profile ? "/" + profile.id : ""),
            profile ? "PUT" : "POST",
            p,
          );
          onSave();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>{profile ? "Edit athlete" : "Create athlete profile"}</h2>
      <p>
        Contact details and date of birth stay private. Official ranking claims
        require admin verification.
      </p>
      <label className="field">
        Profile type
        <select value={p.kind} onChange={(e) => set("kind", e.target.value)}>
          <option value="self">My adult profile</option>
          <option value="junior">Junior I manage</option>
        </select>
      </label>
      <div className="form-grid">
        {[
          ["name", "Full name", "text"],
          ["dob", "Date of birth", "date"],
          ["state", "State", "text"],
          ["city", "City", "text"],
          [
            "phone",
            p.kind === "junior" ? "Guardian contact phone" : "Contact phone",
            "tel",
          ],
        ].map(([k, label, type]) => (
          <label className="field" key={k}>
            {label}
            <input
              required
              type={type}
              value={p[k]}
              onChange={(e) => set(k, e.target.value)}
            />
          </label>
        ))}
        <label className="field">
          Category eligibility
          <select
            value={p.gender}
            onChange={(e) => set("gender", e.target.value)}
          >
            {["male", "female", "nonbinary", "prefer_not_to_say"].map((v) => (
              <option key={v} value={v}>
                {v.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
      </div>
      {p.kind === "junior" ? (
        <div className="rules-box">
          <label className="field">
            Guardian name
            <input
              required
              value={p.guardian_name}
              onChange={(e) => set("guardian_name", e.target.value)}
            />
          </label>
          <label className="field">
            Relationship
            <input
              required
              value={p.guardian_relationship}
              onChange={(e) => set("guardian_relationship", e.target.value)}
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              required
              checked={p.consent}
              onChange={(e) => set("consent", e.target.checked)}
            />
            I am an adult authorised guardian and consent to this junior’s
            participation and required event data processing.
          </label>
        </div>
      ) : (
        <label className="check-label">
          <input
            type="checkbox"
            checked={p.is_public}
            onChange={(e) => set("is_public", e.target.checked)}
          />
          Show my name and Rally competition points on public results and
          rankings.
        </label>
      )}
      <h3>Sport passport</h3>
      {p.sports.map((s: any, i: number) => (
        <fieldset key={i}>
          <legend>{s.sport}</legend>
          <div className="form-grid">
            <label className="field">
              Sport
              <select
                value={s.sport}
                onChange={(e) => changeSport(i, "sport", e.target.value)}
              >
                {sports.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Playing level
              <select
                value={s.level}
                onChange={(e) => changeSport(i, "level", e.target.value)}
              >
                {levels.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Years playing
              <input
                type="number"
                min="0"
                max="90"
                value={s.years}
                onChange={(e) =>
                  changeSport(i, "years", Number(e.target.value))
                }
              />
            </label>
          </div>
          <label className="check-label">
            <input
              type="radio"
              name="primary"
              checked={s.primary_sport}
              onChange={() =>
                set(
                  "sports",
                  p.sports.map((v: any, j: number) => ({
                    ...v,
                    primary_sport: j === i,
                  })),
                )
              }
            />
            Primary sport
          </label>
          <div className="actions">
            {["singles", "doubles"].map((v) => (
              <label className="check-label" key={v}>
                <input
                  type="checkbox"
                  checked={s.categories.includes(v)}
                  onChange={(e) =>
                    changeSport(
                      i,
                      "categories",
                      e.target.checked
                        ? [...s.categories, v]
                        : s.categories.filter((c: string) => c !== v),
                    )
                  }
                />
                {v}
              </label>
            ))}
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={!s.rankings.length}
              onChange={(e) =>
                changeSport(
                  i,
                  "rankings",
                  e.target.checked
                    ? []
                    : [
                        {
                          scope: "state",
                          rank: 1,
                          authority: "",
                          category: "",
                          date: new Date().toISOString().slice(0, 10),
                          source: "",
                          player_id: "",
                        },
                      ],
                )
              }
            />
            Unranked / no official ranking
          </label>
          {s.rankings.map((r: any, j: number) => (
            <div className="ranking-form" key={j}>
              <div className="form-grid">
                <label className="field">
                  Ranking scope
                  <select
                    value={r.scope}
                    onChange={(e) =>
                      changeSport(
                        i,
                        "rankings",
                        s.rankings.map((v: any, k: number) =>
                          k === j ? { ...v, scope: e.target.value } : v,
                        ),
                      )
                    }
                  >
                    <option value="state">State</option>
                    <option value="national">National</option>
                  </select>
                </label>
                {[
                  ["rank", "Rank", "number"],
                  ["authority", "Authority / federation", "text"],
                  ["category", "Ranking category", "text"],
                  ["date", "Ranking date", "date"],
                  ["player_id", "Membership / player ID (optional)", "text"],
                  ["source", "HTTPS source link (optional)", "url"],
                ].map(([k, label, type]) => (
                  <label className="field" key={k}>
                    {label}
                    <input
                      type={type}
                      required={!["source", "player_id"].includes(k)}
                      min={k === "rank" ? 1 : undefined}
                      value={r[k]}
                      onChange={(e) =>
                        changeSport(
                          i,
                          "rankings",
                          s.rankings.map((v: any, n: number) =>
                            n === j
                              ? {
                                  ...v,
                                  [k]:
                                    type === "number"
                                      ? Number(e.target.value)
                                      : e.target.value,
                                }
                              : v,
                          ),
                        )
                      }
                    />
                  </label>
                ))}
              </div>
              <span className="pill">Self-reported until reviewed</span>
              <button
                type="button"
                onClick={() =>
                  changeSport(
                    i,
                    "rankings",
                    s.rankings.filter((_: any, n: number) => n !== j),
                  )
                }
              >
                Remove claim
              </button>
            </div>
          ))}
          {s.rankings.length === 1 && (
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                changeSport(i, "rankings", [
                  ...s.rankings,
                  {
                    ...s.rankings[0],
                    scope:
                      s.rankings[0].scope === "state" ? "national" : "state",
                  },
                ])
              }
            >
              Add second ranking scope
            </button>
          )}
          {p.sports.length > 1 && (
            <button
              type="button"
              onClick={() => {
                const remain = p.sports.filter((_: any, j: number) => i !== j);
                if (!remain.some((v: any) => v.primary_sport))
                  remain[0].primary_sport = true;
                set("sports", remain);
              }}
            >
              Remove sport
            </button>
          )}
        </fieldset>
      ))}
      {p.sports.length < 3 && (
        <button
          className="button secondary"
          type="button"
          onClick={() =>
            set("sports", [
              ...p.sports,
              {
                sport: sports.find(
                  (v) => !p.sports.some((s: any) => s.sport === v),
                ),
                level: "Amateur",
                years: 0,
                primary_sport: false,
                categories: ["singles", "doubles"],
                rankings: [],
              },
            ])
          }
        >
          Add another sport
        </button>
      )}
      <div className="form-grid">
        {[
          ["academy", "Academy / club (optional)"],
          ["coach", "Coach (optional)"],
          ["goal", "Sporting goal (optional)"],
        ].map(([k, l]) => (
          <label className="field" key={k}>
            {l}
            <input value={p[k]} onChange={(e) => set(k, e.target.value)} />
          </label>
        ))}
      </div>
      <label className="field">
        Private profile photo (optional, maximum 2 MB)
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            try {
              const image = await upload(file, "avatar");
              set("photo_url", "/api/v1/me/uploads/" + image.id);
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {p.photo_url && (
        <>
          <PrivatePhoto path={p.photo_url} name={p.name} />
          <button
            type="button"
            className="text-button"
            onClick={() => set("photo_url", null)}
          >
            Remove profile photo
          </button>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button className="button" disabled={busy}>
          {busy ? "Saving…" : "Save profile"}
        </button>
        <button className="button secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
