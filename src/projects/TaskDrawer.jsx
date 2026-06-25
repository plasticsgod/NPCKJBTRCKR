import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "../supabaseClient";
import { TASK_STATUSES } from "./constants";
import { notifyAssignment, notifyMentions } from "./notifications";
import { displayName, nameInitials } from "./userMap";
import DatePicker from "../components/DatePicker";

// Resizable task drawer — width is remembered per browser via localStorage.
const DRAWER_WIDTH_KEY = "npck_task_drawer_width";
const DRAWER_MIN_W = 420;
const DRAWER_DEFAULT_W = 720;

// Parse @mentions from text — returns array of emails mentioned
function parseMentions(text, users) {
  const found = [];
  users.forEach((u) => { if (text.includes("@" + u)) found.push(u); });
  return found;
}

// Render text with @mentions highlighted
function RichText({ body, users }) {
  if (!users?.length) return <span>{body}</span>;
  const parts = body.split(/(@\S+)/g);
  return (
    <span>
      {parts.map((p, i) => {
        const email = p.startsWith("@") ? p.slice(1) : null;
        if (email && users.includes(email))
          return <strong key={i} className="mention">@{displayName(email)}</strong>;
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
}

// Mention-aware textarea with @ autocomplete
function MentionTextarea({ value, onChange, users, placeholder, rows = 3 }) {
  const [suggestions, setSuggestions] = useState([]);
  const [mentionQ, setMentionQ] = useState("");
  const ref = useRef(null);

  // Auto-grow: keep the textarea's height matched to its content as the user
  // types, up to a max (then it scrolls). Runs on every value change.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 260) + "px";
  }, [value]);

  function handleChange(e) {
    const v = e.target.value;
    onChange(v);
    // Detect @query
    const cursor = e.target.selectionStart;
    const before = v.slice(0, cursor);
    const match = before.match(/@(\S*)$/);
    if (match) {
      const q = match[1].toLowerCase();
      setMentionQ(match[0]);
      setSuggestions(users.filter((u) => u.toLowerCase().includes(q)).slice(0, 5));
    } else {
      setSuggestions([]);
    }
  }

  function pickSuggestion(u) {
    const v = value.replace(new RegExp(mentionQ.replace("@", "@") + "$"), "@" + u + " ");
    onChange(v);
    setSuggestions([]);
    ref.current?.focus();
  }

  return (
    <div className="mention-wrap">
      <textarea ref={ref} rows={rows} value={value} onChange={handleChange}
        placeholder={placeholder} className="compose-ta" />
      {suggestions.length > 0 && (
        <ul className="mention-list">
          {suggestions.map((u) => (
            <li key={u} onMouseDown={(e) => { e.preventDefault(); pickSuggestion(u); }}>
              <span className="avatar sm">{nameInitials(u)}</span> {displayName(u)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TaskDrawer({ task, projectName, userEmail, users, onClose, onUpdate, onDelete }) {
  const [local, setLocal] = useState({ ...task, owners: task.owners || [] });
  const [posts, setPosts] = useState([]);
  const [newPost, setNewPost] = useState("");
  const [posting, setPosting] = useState(false);

  // --- Resizable drawer width (remembered in this browser) -------------------
  const [drawerWidth, setDrawerWidth] = useState(() => {
    try {
      const saved = parseInt(localStorage.getItem(DRAWER_WIDTH_KEY), 10);
      if (saved && saved >= DRAWER_MIN_W) return saved;
    } catch { /* localStorage unavailable — fall back to default */ }
    return DRAWER_DEFAULT_W;
  });
  const widthRef = useRef(drawerWidth);
  const resizingRef = useRef(false);
  useEffect(() => { widthRef.current = drawerWidth; }, [drawerWidth]);

  useEffect(() => {
    function onMove(e) {
      if (!resizingRef.current) return;
      const maxW = Math.min(window.innerWidth - 40, window.innerWidth * 0.96);
      // Drawer is pinned to the right edge, so its width is the distance from
      // the cursor to the right side of the window.
      const w = Math.max(DRAWER_MIN_W, Math.min(window.innerWidth - e.clientX, maxW));
      setDrawerWidth(w);
    }
    function onUp() {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      try { localStorage.setItem(DRAWER_WIDTH_KEY, String(Math.round(widthRef.current))); } catch { /* ignore */ }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  function startResize(e) {
    e.preventDefault();
    resizingRef.current = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ew-resize";
  }

  useEffect(() => { setLocal({ ...task, owners: task.owners || [] }); }, [task]);

  const loadPosts = useCallback(async () => {
    const { data } = await supabase
      .from("task_posts").select("*, task_replies(*)").eq("task_id", task.id).order("created_at");
    setPosts(data ?? []);
  }, [task.id]);

  useEffect(() => {
    loadPosts();
    const ch = supabase.channel("posts-" + task.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_posts", filter: "task_id=eq." + task.id }, loadPosts)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_replies" }, loadPosts)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [task.id, loadPosts]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function setField(key, value) {
    setLocal((l) => ({ ...l, [key]: value }));
    onUpdate(task.id, { [key]: value });
  }

  async function submitPost() {
    const body = newPost.trim();
    if (!body) return;
    setPosting(true);
    const mentions = parseMentions(body, users);
    await supabase.from("task_posts").insert({ task_id: task.id, author: userEmail, body, mentions });
    notifyMentions({ mentions, task: task.title, project: projectName || "", mentionedBy: userEmail, body });
    setNewPost("");
    setPosting(false);
    loadPosts();
  }

  async function deletePost(id) {
    if (!confirm("Delete this update?")) return;
    await supabase.from("task_posts").delete().eq("id", id);
    loadPosts();
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer drawer-wide" style={{ width: drawerWidth }} onClick={(e) => e.stopPropagation()}>
        <div className="drawer-resize" onMouseDown={startResize} title="Drag to resize" />
        <div className="drawer-head">
          <div className="drawer-breadcrumb">{projectName && <span className="muted">{projectName} /</span>}</div>
          <input className="drawer-title" value={local.title}
            onChange={(e) => setLocal((l) => ({ ...l, title: e.target.value }))}
            onBlur={(e) => onUpdate(task.id, { title: e.target.value })} />
          <button className="link" onClick={onClose}>Close</button>
        </div>

        <div className="drawer-meta">
          <label className="meta-field">
            <span>Assignees</span>
            <div className="drawer-assignees">
              {(local.owners || []).length === 0
                ? <span className="not-assigned">Not Assigned</span>
                : (local.owners || []).map(e => (
                  <span key={e} className="avatar" title={e}>{nameInitials(e)}</span>
                ))
              }
              <select className="person-select" value=""
                onChange={(e) => {
                  const email = e.target.value;
                  if (!email) return;
                  const prev = local.owners || [];
                  const next = prev.includes(email) ? prev.filter(x => x !== email) : [...prev, email];
                  setField("owners", next);
                  if (!prev.includes(email)) {
                    notifyAssignment({ to: email, task: task.title, project: projectName || "", assignedBy: userEmail });
                  }
                }}>
                <option value="">Add person…</option>
                {users.map((u) => (
                  <option key={u} value={u}>
                    {(local.owners || []).includes(u) ? "✓ " : ""}{displayName(u)}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <label className="meta-field">
            <span>Status</span>
            <select value={local.status || "To do"} onChange={(e) => setField("status", e.target.value)}>
              {TASK_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="meta-field">
            <span>Due date</span>
            <DatePicker value={local.due_date || ""} onChange={(v) => setField("due_date", v || null)} />
          </label>
        </div>

        <div className="drawer-body">
          <div className="feed-section">
            <p className="feed-label">Updates</p>

            {/* Compose new post */}
            <div className="compose-box">
              <span className="avatar sm">{nameInitials(userEmail)}</span>
              <div className="compose-right">
                <MentionTextarea value={newPost} onChange={setNewPost} users={users}
                  placeholder={`Write an update… Use @ to mention someone`} rows={2} />
                <div className="compose-foot">
                  <span className="muted small">⌘/Ctrl + Enter to post</span>
                  <button className="btn-accent" onClick={submitPost} disabled={!newPost.trim() || posting}>
                    {posting ? "Posting…" : "Post update"}
                  </button>
                </div>
              </div>
            </div>

            {posts.length === 0 && <p className="muted small feed-empty">No updates yet. Be the first to post.</p>}

            {[...posts].reverse().map((post) => (
              <PostCard key={post.id} post={post} users={users} userEmail={userEmail}
                taskTitle={task.title} projectName={projectName}
                onDelete={deletePost} onReply={loadPosts} />
            ))}
          </div>
        </div>

        <div className="drawer-foot">
          <button className="link danger" onClick={() => onDelete(task.id)}>Delete task</button>
        </div>
      </aside>
    </div>
  );
}

// Small "•••" menu with Edit / Delete, styled to match the selection bar.
// Anchored to its button (no center modal); closes on outside-click or Esc.
function KebabMenu({ onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc, true);
    };
  }, [open]);

  return (
    <div className="kebab" ref={ref}>
      <button className="kebab-btn" onClick={() => setOpen((o) => !o)}
        title="More" aria-label="More options" aria-haspopup="true" aria-expanded={open}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" />
        </svg>
      </button>
      {open && (
        <div className="kebab-menu" role="menu">
          <button className="kebab-item" role="menuitem" onClick={() => { setOpen(false); onEdit(); }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            Edit
          </button>
          <button className="kebab-item danger" role="menuitem" onClick={() => { setOpen(false); onDelete(); }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function PostCard({ post, users, userEmail, taskTitle, projectName, onDelete, onReply }) {
  const [showReply, setShowReply] = useState(false);
  const [reply, setReply] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body);
  const [savingEdit, setSavingEdit] = useState(false);
  const replies = post.task_replies ?? [];
  const mine = post.author === userEmail;

  async function submitReply() {
    const body = reply.trim();
    if (!body) return;
    setSubmitting(true);
    const mentions = parseMentions(body, users);
    await supabase.from("task_replies").insert({ post_id: post.id, author: userEmail, body, mentions });
    notifyMentions({ mentions, task: taskTitle, project: projectName || "", mentionedBy: userEmail, body });
    setReply("");
    setSubmitting(false);
    setShowReply(false);
    onReply();
  }

  async function deleteReply(id) {
    if (!confirm("Delete this reply?")) return;
    await supabase.from("task_replies").delete().eq("id", id);
    onReply();
  }

  function startEdit() { setDraft(post.body); setEditing(true); }
  function cancelEdit() { setEditing(false); setDraft(post.body); }
  async function saveEdit() {
    const body = draft.trim();
    if (!body) return;
    setSavingEdit(true);
    await supabase.from("task_posts").update({ body, mentions: parseMentions(body, users) }).eq("id", post.id);
    setSavingEdit(false);
    setEditing(false);
    onReply();
  }

  return (
    <div className="post-card">
      <div className="post-head">
        <span className="avatar">{nameInitials(post.author)}</span>
        <div className="post-meta">
          <span className="post-author">{displayName(post.author)}</span>
          <span className="post-time">{fmtTime(post.created_at)}</span>
        </div>
        {mine && !editing && (
          <KebabMenu onEdit={startEdit} onDelete={() => onDelete(post.id)} />
        )}
      </div>

      {editing ? (
        <div className="post-edit">
          <MentionTextarea value={draft} onChange={setDraft} users={users} placeholder="Edit update…" rows={2} />
          <div className="edit-actions">
            <button className="link" onClick={cancelEdit}>Cancel</button>
            <button className="btn-accent sm" onClick={saveEdit} disabled={!draft.trim() || savingEdit}>
              {savingEdit ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <div className="post-body">
          <RichText body={post.body} users={users} />
        </div>
      )}

      {/* Replies */}
      {replies.length > 0 && (
        <div className="reply-thread">
          {replies.map((r) => (
            <ReplyItem key={r.id} reply={r} users={users} userEmail={userEmail}
              onChanged={onReply} onDelete={deleteReply} />
          ))}
        </div>
      )}

      {/* Reply compose */}
      <div className="post-actions">
        <button className="link" onClick={() => setShowReply(!showReply)}>
          {showReply ? "Cancel" : `Reply${replies.length ? ` (${replies.length})` : ""}`}
        </button>
      </div>
      {showReply && (
        <div className="reply-compose">
          <span className="avatar sm">{nameInitials(userEmail)}</span>
          <div className="compose-right">
            <MentionTextarea value={reply} onChange={setReply} users={users}
              placeholder="Write a reply… Use @ to mention" rows={2} />
            <div className="compose-foot">
              <button className="btn-accent" onClick={submitReply} disabled={!reply.trim() || submitting}>
                {submitting ? "…" : "Reply"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReplyItem({ reply, users, userEmail, onChanged, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(reply.body);
  const [saving, setSaving] = useState(false);
  const mine = reply.author === userEmail;

  async function saveEdit() {
    const body = draft.trim();
    if (!body) return;
    setSaving(true);
    await supabase.from("task_replies").update({ body, mentions: parseMentions(body, users) }).eq("id", reply.id);
    setSaving(false);
    setEditing(false);
    onChanged();
  }

  return (
    <div className="reply">
      <span className="avatar sm">{nameInitials(reply.author)}</span>
      <div className="reply-content">
        <div className="reply-meta">
          <span className="post-author">{displayName(reply.author)}</span>
          <span className="post-time">{fmtTime(reply.created_at)}</span>
          {mine && !editing && (
            <KebabMenu onEdit={() => { setDraft(reply.body); setEditing(true); }}
              onDelete={() => onDelete(reply.id)} />
          )}
        </div>
        {editing ? (
          <div className="post-edit">
            <MentionTextarea value={draft} onChange={setDraft} users={users} placeholder="Edit reply…" rows={2} />
            <div className="edit-actions">
              <button className="link" onClick={() => { setEditing(false); setDraft(reply.body); }}>Cancel</button>
              <button className="btn-accent sm" onClick={saveEdit} disabled={!draft.trim() || saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <RichText body={reply.body} users={users} />
        )}
      </div>
    </div>
  );
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
