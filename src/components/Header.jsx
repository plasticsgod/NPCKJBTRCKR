import { useState, useEffect, useRef } from "react";
import { supabase } from "../supabaseClient";
import NotificationBell from "./NotificationBell";
import { displayName, nameInitials, avatarStyle } from "../projects/userMap";

const TITLES = { work_orders: "Work Orders", dashboard: "Dashboard", plastics: "Plastics Estimator", projects: "Projects" };

export default function Header({ page, email, onMenu, onSignOut }) {
  return (
    <header className="header">
      <button className="burger" onClick={onMenu} aria-label="Open menu">
        <span /><span /><span />
      </button>

      <div className="brand">
        <img className="brand-mark" src="/images/favicon.png" alt="NutraPack logo" />
        <span className="brand-name">NutraPack App</span>
        <span className="brand-sub">{TITLES[page]}</span>
      </div>

      <div className="header-right">
        <NotificationBell userEmail={email} />
        <ProfileMenu email={email} onSignOut={onSignOut} />
      </div>
    </header>
  );
}

// Avatar button in the top-right that opens an account menu.
function ProfileMenu({ email, onSignOut }) {
  const [open, setOpen] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [open]);

  return (
    <div className="profile" ref={ref}>
      <button className="profile-btn" onClick={() => setOpen((o) => !o)}
        aria-label="Account menu" aria-haspopup="true" aria-expanded={open}>
        <span className="avatar" style={avatarStyle(email)}>{nameInitials(email)}</span>
      </button>

      {open && (
        <div className="profile-menu" role="menu">
          <div className="profile-head">
            <span className="avatar" style={avatarStyle(email)}>{nameInitials(email)}</span>
            <div className="profile-id">
              <span className="profile-name">{displayName(email)}</span>
              <span className="profile-email" title={email}>{email}</span>
            </div>
          </div>
          <div className="profile-sep" />
          <button className="profile-item" role="menuitem"
            onClick={() => { setOpen(false); setShowEmail(true); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" />
            </svg>
            Change email
          </button>
          <button className="profile-item danger" role="menuitem"
            onClick={() => { setOpen(false); onSignOut(); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" />
            </svg>
            Log out
          </button>
        </div>
      )}

      {showEmail && <ChangeEmailModal currentEmail={email} onClose={() => setShowEmail(false)} />}
    </div>
  );
}

// Modal to request an email change. Verifies the current password, then asks
// Supabase to send a confirmation link to the new address.
function ChangeEmailModal({ currentEmail, onClose }) {
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit() {
    setError("");
    const next = newEmail.trim().toLowerCase();
    if (!next || !next.includes("@")) { setError("Enter a valid email address."); return; }
    if (next === (currentEmail || "").toLowerCase()) { setError("That's already your email."); return; }
    if (!password) { setError("Enter your current password to confirm."); return; }

    setBusy(true);
    // 1) Confirm it's really them by checking the current password.
    const { error: pwErr } = await supabase.auth.signInWithPassword({ email: currentEmail, password });
    if (pwErr) { setBusy(false); setError("Current password is incorrect."); return; }
    // 2) Request the change — Supabase emails a confirmation link to the new address.
    const { error: upErr } = await supabase.auth.updateUser(
      { email: next },
      { emailRedirectTo: window.location.origin }
    );
    setBusy(false);
    if (upErr) { setError(upErr.message || "Could not change email. Please try again."); return; }
    setDone(true);
  }

  return (
    <div className="pm-overlay" onClick={onClose}>
      <div className="pm-modal" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <>
            <h3 className="pm-title">Check your new inbox</h3>
            <p className="pm-text">
              We sent a confirmation link to <strong>{newEmail.trim().toLowerCase()}</strong>.
              Click it to finish the change. Until you do, keep signing in with your current email.
            </p>
            <div className="pm-actions">
              <button className="btn-accent" onClick={onClose}>Got it</button>
            </div>
          </>
        ) : (
          <>
            <h3 className="pm-title">Change email</h3>
            <p className="pm-text">
              Enter your new email and your current password to confirm it's you. We'll send a
              confirmation link to the new address.
            </p>
            <label className="pm-field">
              <span>New email</span>
              <input type="email" className="pm-input" value={newEmail} autoFocus
                placeholder="you@company.com" onChange={(e) => setNewEmail(e.target.value)} />
            </label>
            <label className="pm-field">
              <span>Current password</span>
              <input type="password" className="pm-input" value={password}
                placeholder="••••••••" onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
            </label>
            {error && <p className="pm-error">{error}</p>}
            <div className="pm-actions">
              <button className="link" onClick={onClose}>Cancel</button>
              <button className="btn-accent" onClick={submit} disabled={busy}>
                {busy ? "Sending…" : "Send confirmation"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
