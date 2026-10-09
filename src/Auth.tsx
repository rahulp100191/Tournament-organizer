import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  type User,
} from "firebase/auth";
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
export const auth =
  config.apiKey && config.projectId ? getAuth(initializeApp(config)) : null;
const Context = createContext<{ user: User | null; loading: boolean }>({
  user: null,
  loading: true,
});
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(!!auth);
  useEffect(
    () =>
      auth
        ? onAuthStateChanged(auth, (u) => {
            setUser(u);
            setLoading(false);
          })
        : undefined,
    [],
  );
  return (
    <Context.Provider value={{ user, loading }}>{children}</Context.Provider>
  );
}
export const useAuth = () => useContext(Context);
export const logout = () => auth && signOut(auth);
export function Login({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  const [mode, setMode] = useState("login"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      if (auth?.currentUser?.emailVerified) onDone();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }
  if (!auth)
    return (
      <section className="panel">
        <h2>Sign-in is being configured</h2>
        <p>
          The preview is ready to connect to Firebase. Google and email sign-in
          become available after project setup.
        </p>
      </section>
    );
  return (
    <section className="panel auth-panel">
      <span className="eyebrow">YOUR NEXT CHAPTER</span>
      <h1>
        {user
          ? "Verify your email"
          : mode === "signup"
            ? "Join Rally"
            : "Welcome to Rally"}
      </h1>
      <p>
        Browse freely. Sign in to enter tournaments and manage your athletes.
      </p>
      {user && !user.emailVerified ? (
        <>
          <p>
            Check {user.email} for the verification link, then refresh this
            page.
          </p>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await sendEmailVerification(user);
                setMessage("Verification email sent.");
              })
            }
          >
            Resend verification
          </button>
          <button className="button secondary" onClick={() => logout()}>
            Sign out
          </button>
        </>
      ) : (
        <>
          <button
            className="button secondary full"
            disabled={busy}
            onClick={() =>
              run(() => signInWithPopup(auth!, new GoogleAuthProvider()))
            }
          >
            Continue with Google
          </button>
          <p className="divider">or use email</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                if (mode === "signup") {
                  const c = await createUserWithEmailAndPassword(
                    auth!,
                    email,
                    password,
                  );
                  await sendEmailVerification(c.user);
                  setMessage("Check your inbox to verify your email.");
                } else await signInWithEmailAndPassword(auth!, email, password);
              });
            }}
          >
            <label className="field">
              Email
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="field">
              Password
              <input
                type="password"
                minLength={8}
                required
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {mode === "signup" && (
              <label className="check-label">
                <input type="checkbox" required />I am at least 18. I will
                manage any junior athletes as their authorised guardian.
              </label>
            )}
            <button className="button full" disabled={busy}>
              {busy
                ? "Please wait…"
                : mode === "signup"
                  ? "Create account"
                  : "Sign in"}
            </button>
          </form>
          <div className="actions">
            <button
              onClick={() => setMode(mode === "signup" ? "login" : "signup")}
            >
              {mode === "signup"
                ? "Already have an account?"
                : "Create an account"}
            </button>
            <button
              disabled={!email || busy}
              onClick={() =>
                run(async () => {
                  await sendPasswordResetEmail(auth!, email);
                  setMessage("Password recovery email sent.");
                })
              }
            >
              Forgot password?
            </button>
          </div>
        </>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
    </section>
  );
}
