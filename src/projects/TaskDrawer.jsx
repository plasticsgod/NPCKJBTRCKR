import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "../supabaseClient";
import { TASK_STATUSES } from "./constants";
import { notifyAssignment, notifyMentions } from "./notifications";
import { displayName, nameInitials } from "./userMap";

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

  function setField(key, value) {
    setLocal((l) => ({ ...l, [key]: value }));
    onUpdate(task.id, { [key]: value });
    if (key === "owner" && value && value !== task.owner) {
      notifyAssignment({ to: value, task: task.title, project: projectName || "", assignedBy: userEmail });
    }
  }

  async function deletePost(id) {
    if (!confirm("Delete this update?")) return;
    await supabase.from("task_posts").delete().eq("id", id);
    loadPosts();
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer drawer-wide" onClick={(e) => e.stopPropagation()}>
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
                  <span key={e} className="avatar" title={displayName(e)}>{nameInitials(e)}</span>
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
            <input type="date" value={local.due_date || ""} onChange={(e) => setField("due_date", e.target.value || null)} />
          </label>
        </div>

        <div className="drawer-body">
          <div className="feed-section">
            <p className="feed-label">Updates</p>

            {/* Compose new post */}
            <div className="compose-box">
              <span className="avatar sm">{initials(userEmail)}</span>
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

function PostCard({ post, users, userEmail, taskTitle, projectName, onDelete, onReply }) {
  const [showReply, setShowReply] = useState(false);
  const [reply, setReply] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const replies = post.task_replies ?? [];

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

  return (
    <div className="post-card">
      <div className="post-head">
        <span className="avatar">{initials(post.author)}</span>
        <div className="post-meta">
          <span className="post-author">{post.author}</span>
          <span className="post-time">{fmtTime(post.created_at)}</span>
        </div>
        {post.author === userEmail && (
          <button className="link danger post-del" onClick={() => onDelete(post.id)}>Delete</button>
        )}
      </div>
      <div className="post-body">
        <RichText body={post.body} users={users} />
      </div>

      {/* Replies */}
      {replies.length > 0 && (
        <div className="reply-thread">
          {replies.map((r) => (
            <div className="reply" key={r.id}>
              <span className="avatar sm">{initials(r.author)}</span>
              <div className="reply-content">
                <div className="reply-meta">
                  <span className="post-author">{r.author}</span>
                  <span className="post-time">{fmtTime(r.created_at)}</span>
                  {r.author === userEmail && (
                    <button className="link danger post-del" onClick={() => deleteReply(r.id)}>Delete</button>
                  )}
                </div>
                <RichText body={r.body} users={users} />
              </div>
            </div>
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
          <span className="avatar sm">{initials(userEmail)}</span>
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

function initials(name) {
  if (!name) return "?";
  const parts = name.replace(/@.*/, "").split(/[.\s_]+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || name[0]?.toUpperCase();
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
