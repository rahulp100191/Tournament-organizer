import { useState } from "react";
const screens = [
  ["Athlete entries", "athlete-phone.png"],
  ["Sport passport", "profile-desktop.png"],
  ["Guardian onboarding", "junior-phone.png"],
  ["Admin payment review", "admin-payments.png"],
  ["Admin event creation", "admin-event-form.png"],
];
export function PreviewScreen() {
  const [selected, setSelected] = useState(0);
  return (
    <>
      <div className="section-head">
        <div>
          <span className="eyebrow">REVIEW BEFORE YOU INSTALL</span>
          <h1>Athlete & admin screen preview</h1>
          <p>
            Captured from the working local integration tests using fictional
            data. Connected accounts become available after provider setup.
          </p>
        </div>
      </div>
      <div className="sport-tabs">
        {screens.map(([name], i) => (
          <button
            key={name}
            className={i === selected ? "active" : ""}
            onClick={() => setSelected(i)}
          >
            {name}
          </button>
        ))}
      </div>
      <section className="panel">
        <img
          style={{
            width: "100%",
            maxWidth: selected === 0 || selected === 2 ? 440 : 1000,
            display: "block",
            margin: "auto",
            border: "1px solid #dce4d1",
            borderRadius: 12,
          }}
          src={"/screen-previews/" + screens[selected][1]}
          alt={screens[selected][0] + " with fictional test data"}
        />
      </section>
      <section className="panel">
        <h2>Install Rally on your phone</h2>
        <p>
          Android: download the signed test APK, open it on your phone and allow
          installation from your browser when Android asks. This test app opens
          the same Vercel site; provider configuration is still needed for
          sign-in and shared registrations.
        </p>
        <a
          className="button"
          href="/downloads/Rally-Tournaments-Test.apk"
          download
        >
          Download Android test APK
        </a>
        <p>
          iPhone: open this site in Safari, choose Share → Add to Home Screen.
        </p>
        <p>
          The APK signature was verified during the build. Physical phone
          installation, login and uploads still need a device check.
        </p>
      </section>
    </>
  );
}
