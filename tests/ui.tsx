// Development-only harness. Vite builds only index.html; this is never deployed.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "../src/api";
import { AthleteScreen } from "../src/AthleteScreen";
import { AdminScreen } from "../src/AdminScreen";
import { EventScreen } from "../src/EventScreen";
import "../src/style.css";
import "../src/platform.css";
function Harness() {
  const [me, setMe] = useState<any>(null);
  async function refresh() {
    setMe(await api("/me"));
  }
  useEffect(() => {
    refresh();
  }, []);
  return (
    <div className="platform">
      <div className="real-shell" style={{ marginLeft: 0 }}>
        <header className="real-topbar">
          <strong className="real-brand">Rally</strong>
          <span className="pill">Local integration test · sample data</span>
        </header>
        <main>
          {me ? (
            new URLSearchParams(location.search).get("role") === "admin" ? (
              <AdminScreen />
            ) : new URLSearchParams(location.search).get("event") ? (
              <EventScreen
                id={new URLSearchParams(location.search).get("event")!}
                me={me}
                onLogin={() => {}}
                onRegistered={() => {
                  location.href = "/tests/ui.html";
                }}
                onBack={() => {}}
              />
            ) : (
              <AthleteScreen me={me} refresh={refresh} openEvent={() => {}} />
            )
          ) : (
            <p>Loading fixture…</p>
          )}
        </main>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
