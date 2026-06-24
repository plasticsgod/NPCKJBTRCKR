import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { displayName } from "../projects/userMap";

// Header notification bell. Shows the current user's in-app notifications
// (task assignments and @mentions), with an unread badge and live updates.
export default function NotificationBell({ userEmail }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const load = useCallback(async () => {
    if (!userEmail) return;
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("recipient", userEmail)
      .order("created_at", { ascending: false })
      .limit(30);
    setItems(data ?? []);
  }, [userEmail]);

  // Initial load + live updates for this user's notifications.
  useEffect(() => {
    if (!userEmail) return;
    load();
    const ch = supabase
      .channel("notifications-" + userEmail)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: "recipient=eq." + userEmail },
        load
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [userEmail, load]);

  // Close the dropdown when clicking outside it.
  useEffect(() => {
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const unread = items.filter((n) => !n.read).length;

  async function markRead(id) {
    await supabase.from("notifications").update({ read: true }).eq("id", id);
    load();
  }

  async function markAllRead() {
    const ids = items.filter((n) => !n.read).map((n) => n.id);
    if (!ids.length) return;
    await supabase.from("notifications").update({ read: true }).in("id", ids);
    load();
  }

  function openNotification(n) {
    if (!n.read) markRead(n.id);
    setOpen(false);
    // Jump to the Projects page (App listens to the hash and switches pages).
    window.location.hash = "projects";
  }

  function label(n) {
    const who = displayName(n.actor) || "Someone";
    if (n.type === "assignment") return `${who} assigned you to "${n.task}"`;
    return `${who} mentioned you in "${n.task}"`;
  }

  return (
    <div className="notif" ref={ref}>
      <button className="notif-bell" onClick={() => setOpen(!open)} aria-label="Notifications">
        <span className="notif-icon" aria-hidden="true">🔔</span>
        {unread > 0 && <span className="notif-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-head">
            <span>Notifications</span>
            {unread > 0 && <button className="link" onClick={markAllRead}>Mark all read</button>}
          </div>

          {items.length === 0 ? (
            <p className="notif-empty muted">You're all caught up.</p>
          ) : (
            <ul className="notif-list">
              {items.map((n) => (
                <li
                  key={n.id}
                  className={"notif-item" + (n.read ? "" : " unread")}
                  onClick={() => openNotification(n)}
                >
                  <p className="notif-text">{label(n)}</p>
                  {n.body && <p className="notif-snippet muted">{n.body}</p>}
                  <span className="notif-meta muted">
                    {n.project ? n.project + " · " : ""}{fmtTime(n.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
