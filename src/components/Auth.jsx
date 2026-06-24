import { useState } from "react";
import { supabase } from "../supabaseClient";

// Feather-style eye icons (inline so there's no asset to manage).
function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

// `recovery` is set by App when the user arrives via a password-reset link.
// `onRecovered` lets App drop back to the normal app once the password is set.
export default function Auth({ recovery = false, onRecovered }) {
  const [mode, setMode] = useState(recovery ? "recovery" : "signin"); // signin | signup | forgot | recovery
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function switchMode(next) {
    setMode(next);
    setMessage("");
    setShowPassword(false);
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage("");

    // Send a reset link to the entered email.
    if (mode === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      setBusy(false);
      setMessage(
        error
          ? error.message
          : "If that email has an account, a password reset link is on its way. Check your inbox."
      );
      return;
    }

    // Set the new password after following the reset link.
    if (mode === "recovery") {
      if (password.length < 6) {
        setBusy(false);
        setMessage("Password must be at least 6 characters.");
        return;
      }
      const { error } = await supabase.auth.updateUser({ password });
      setBusy(false);
      if (error) { setMessage(error.message); return; }
      setMessage("Password updated. Signing you in…");
      onRecovered?.();
      return;
    }

    // Normal sign in / sign up.
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

  const title =
    mode === "signin" ? "Sign in"
    : mode === "signup" ? "Create your account"
    : mode === "forgot" ? "Reset your password"
    : "Set a new password";

  const buttonLabel =
    busy ? "Working…"
    : mode === "signin" ? "Sign in"
    : mode === "signup" ? "Create account"
    : mode === "forgot" ? "Send reset link"
    : "Update password";

  return (
    <div className="screen-center">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand">
          <img className="brand-mark" src="/images/favicon.png" alt="NutraPack logo" />
          <span className="brand-name">NutraPack</span>
          <span className="brand-sub">Job Tracker</span>
        </div>

        <h1 className="auth-title">{title}</h1>

        {mode !== "recovery" && (
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
        )}

        {mode !== "forgot" && (
          <label className="field">
            <span>{mode === "recovery" ? "New password" : "Password"}</span>
            <div className="password-wrap">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
              />
              <button
                type="button"
                className="pw-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </label>
        )}

        <button className="btn-accent full" disabled={busy}>
          {buttonLabel}
        </button>

        {message && <p className="auth-message">{message}</p>}

        {mode === "signin" && (
          <>
            <button type="button" className="link" onClick={() => switchMode("forgot")}>
              Forgot password?
            </button>
            <button type="button" className="link" onClick={() => switchMode("signup")}>
              New here? Create an account
            </button>
          </>
        )}

        {mode === "signup" && (
          <button type="button" className="link" onClick={() => switchMode("signin")}>
            Already have an account? Sign in
          </button>
        )}

        {mode === "forgot" && (
          <button type="button" className="link" onClick={() => switchMode("signin")}>
            Back to sign in
          </button>
        )}
      </form>
    </div>
  );
}
