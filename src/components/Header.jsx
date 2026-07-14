import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../supabaseClient";
import NotificationBell from "./NotificationBell";
import { displayName, nameInitials, avatarStyle } from "../projects/userMap";

const TITLES = { work_orders: "Work Orders", dashboard: "Dashboard", plastics: "Plastics Estimator", projects: "Projects" };

export default function Header({ page, email, onMenu, onSignOut, onSearch, canInvite = true, onOpenTask }) {
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
        <button className="header-search" onClick={onSearch} aria-label="Search" title="Search (⌘K)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
        </button>
        <NotificationBell userEmail={email} onOpenTask={onOpenTask} />
        <ProfileMenu email={email} onSignOut={onSignOut} canInvite={canInvite} />
      </div>
    </header>
  );
}

// Avatar button in the top-right that opens an account menu.
function ProfileMenu({ email, onSignOut, canInvite = true }) {
  const [open, setOpen] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
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
          {canInvite && (
            <button className="profile-item" role="menuitem"
              onClick={() => { setOpen(false); setShowInvite(true); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
              </svg>
              Invite member or guest
            </button>
          )}
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
      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
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

  return createPortal(
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
    </div>,
    document.body
  );
}

// Invite a full-access member (whole app) or a guest (one project). Calls the
// secure invite-user Edge Function, which creates the account, emails an invite
// link, and grants the chosen access.
function InviteModal({ onClose }) {
  const [email, setEmail] = useState("");
  const [scope, setScope] = useState("workspace"); // 'workspace' | 'project' | 'client'
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState("");
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState(""); // "" = not linked to a company
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    supabase.from("projects").select("id,name").order("name").then(({ data }) => {
      setProjects(data || []);
      if (data && data.length) setProjectId((id) => id || data[0].id);
    });
    supabase.from("customers").select("id,name").order("name").then(({ data }) => {
      setCustomers(data || []);
    });
  }, []);

  async function submit() {
    setError(""); setDone("");
    const addr = email.trim().toLowerCase();
    if (!addr || !addr.includes("@")) { setError("Enter a valid email address."); return; }
    if (scope === "project" && !projectId) { setError("Pick a project."); return; }

    setBusy(true);
    const { data, error: fnErr } = await supabase.functions.invoke("invite-user", {
      body: {
        email: addr,
        scope,
        projectId: scope === "project" ? projectId : null,
        customerId: scope === "client" ? (customerId || null) : null,
      },
    });
    setBusy(false);

    if (fnErr || data?.error) {
      setError(data?.error || fnErr?.message || "Could not send the invite.");
      return;
    }
    setDone(
      data?.alreadyExisted
        ? `${addr} already had an account — access granted.`
        : `Invite sent to ${addr}. They'll get an email to set a password.`
    );
    setEmail("");
  }

  return createPortal(
    <div className="pm-overlay" onClick={onClose}>
      <div className="pm-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="pm-title">Invite member or guest</h3>
        <p className="pm-text">
          We'll email them a link to set a password. Choose how much they can see.
        </p>

        <label className="pm-field">
          <span>Email</span>
          <input type="email" className="pm-input" value={email} autoFocus
            placeholder="person@company.com" onChange={(e) => setEmail(e.target.value)} />
        </label>

        <label className="pm-field">
          <span>Access</span>
          <select className="pm-input" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="workspace">Member</option>
            <option value="project">Guest</option>
            <option value="client">Client</option>
          </select>
        </label>

        {scope === "project" && (
          <label className="pm-field">
            <span>Project</span>
            <select className="pm-input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.length === 0 && <option value="">No projects yet</option>}
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}

        {scope === "client" && (
          <label className="pm-field">
            <span>Customer (optional)</span>
            <select className="pm-input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">None — link later</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span className="pm-hint">
              Linking lets their saved quotes show up on that customer's page. You can link later from Customers.
            </span>
          </label>
        )}

        {error && <p className="pm-error">{error}</p>}
        {done && <p className="pm-text" style={{ color: "var(--accent)" }}>{done}</p>}

        <div className="pm-actions">
          <button className="link" onClick={onClose}>Close</button>
          <button className="btn-accent" onClick={submit} disabled={busy}>
            {busy ? "Sending…" : "Send invite"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
