import { useState } from "react";
import { supabase } from "../supabaseClient";

export default function Auth() {
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage("");

    const fn =
      mode === "signin"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });

    const { error } = await fn;
    setBusy(false);

    if (error) setMessage(error.message);
    else if (mode === "signup")
      setMessage("Account created. You can sign in now (or confirm your email if asked).");
    // On successful sign in, App's auth listener swaps to the tracker automatically.
  }

  return (
    <div className="screen-center">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">NutraPack</span>
          <span className="brand-sub">Job Tracker</span>
        </div>

        <h1 className="auth-title">
          {mode === "signin" ? "Sign in" : "Create your account"}
        </h1>

        <label className="field">
          <span>Work email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
          />
        </label>

        <button className="btn-accent full" disabled={busy}>
          {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>

        {message && <p className="auth-message">{message}</p>}

        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setMessage("");
          }}
        >
          {mode === "signin"
            ? "New here? Create an account"
            : "Already have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
