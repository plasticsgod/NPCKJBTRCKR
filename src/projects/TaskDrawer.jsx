import { useEffect, useState, useCallback, useRef, useLayoutEffect } from "react";
import { supabase } from "../supabaseClient";
import { TASK_STATUSES } from "./constants";
import { notifyAssignment, notifyMentions, notifyComment } from "./notifications";
import { displayName, nameInitials, avatarStyle } from "./userMap";
import Avatar from "./Avatar";
import { timeAgo, fullTime } from "../lib/time";
import DatePicker from "../components/DatePicker";
import ConfirmModal from "../components/ConfirmModal";

// --- Image attachments -------------------------------------------------------
const IMG_BUCKET = "task-images";
const MAX_IMAGES = 4;

function publicUrl(path) {
  return supabase.storage.from(IMG_BUCKET).getPublicUrl(path).data.publicUrl;
}

// Resize + compress an image in the browser before upload so it stays small
// (protects Supabase storage + bandwidth). Returns a JPEG blob.
async function compressImage(file, maxDim = 1600, quality = 0.8) {
  if (!file.type?.startsWith("image/")) return file;
  try {
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = dataUrl;
    });
    let { width, height } = img;
    if (width > maxDim || height > maxDim) {
      const scale = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    canvas.getContext("2d").drawImage(img, 0, 0, width, height);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    return blob || file;
  } catch {
    return file; // if anything fails, fall back to the original file
  }
}

// Compress + upload a list of files to storage; returns the stored paths.
async function uploadImages(files, taskId) {
  const paths = [];
  for (const file of files) {
    const blob = await compressImage(file);
    const path = `${taskId}/${crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage.from(IMG_BUCKET)
      .upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (!error) paths.push(path);
  }
  return paths;
}

// --- File attachments (documents, PDFs, etc.) --------------------------------
// Reuses the same bucket under a files/ subpath (no compression). Each entry
// keeps its original name so we can show + download it. Returns metadata:
// { path, name, type, size }.
const MAX_FILES = 4;

async function uploadFiles(files, taskId) {
  const out = [];
  for (const file of files) {
    const dot = file.name.lastIndexOf(".");
    const ext = dot >= 0 ? file.name.slice(dot) : "";
    const path = `${taskId}/files/${crypto.randomUUID()}${ext}`;
    const { error } = await supabase.storage.from(IMG_BUCKET)
      .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (!error) out.push({ path, name: file.name, type: file.type || "", size: file.size });
  }
  return out;
}

function formatBytes(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

// Resizable task drawer — width is remembered per browser via localStorage.
const DRAWER_WIDTH_KEY = "npck_task_drawer_width";
const DRAWER_MIN_W = 420;
const DRAWER_DEFAULT_W = 720;

// Parse @mentions from text — returns array of emails mentioned. Matches by
// display name (what people type) and still accepts a raw @email for safety.
function parseMentions(text, users) {
  const found = [];
  users.forEach((u) => {
    const name = displayName(u);
    if ((name && text.includes("@" + name)) || text.includes("@" + u)) found.push(u);
  });
  return found;
}

// Render text with @mentions highlighted. Recognizes both @Name and @email.
function RichText({ body, users }) {
  if (!users?.length) return <span>{body}</span>;
  const byName = {};
  users.forEach((u) => { const n = displayName(u); if (n) byName[n] = u; });
  const parts = body.split(/(@\S+)/g);
  return (
    <span>
      {parts.map((p, i) => {
        if (p.startsWith("@")) {
          const tok = p.slice(1);
          const email = users.includes(tok) ? tok : byName[tok];
          if (email) return <strong key={i} className="mention">@{displayName(email)}</strong>;
        }
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
}

// Mention-aware textarea with @ autocomplete
function MentionTextarea({ value, onChange, users, placeholder, rows = 3, onFocus }) {
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
      setSuggestions(
        users
          .filter((u) => (displayName(u) || "").toLowerCase().includes(q) || u.toLowerCase().includes(q))
          .slice(0, 5)
      );
    } else {
      setSuggestions([]);
    }
  }

  function pickSuggestion(u) {
    const token = displayName(u) || u;
    const safe = mentionQ.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const v = value.replace(new RegExp(safe + "$"), "@" + token + " ");
    onChange(v);
    setSuggestions([]);
    ref.current?.focus();
  }

  return (
    <div className="mention-wrap">
      <textarea ref={ref} rows={rows} value={value} onChange={handleChange}
        placeholder={placeholder} className="compose-ta" onFocus={onFocus} />
      {suggestions.length > 0 && (
        <ul className="mention-list">
          {suggestions.map((u) => (
            <li key={u} onMouseDown={(e) => { e.preventDefault(); pickSuggestion(u); }}>
              <span className="avatar sm" style={avatarStyle(u)}>{nameInitials(u)}</span> {displayName(u)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TaskDrawer({ task, projectName, userEmail, users, onClose, onUpdate, onDelete }) {
  const [local, setLocal] = useState({ ...task, owners: task.owners || [] });
  const [confirmState, setConfirmState] = useState(null);
  function deletePost(id, images, files) {
    setConfirmState({ title: "Delete update?", message: "Are you sure you want to delete this update? This cannot be undone.", confirmLabel: "Delete", onConfirm: () => doDeletePost(id, images, files) });
  }
  function deleteReply(id, images, files) {
    setConfirmState({ title: "Delete reply?", message: "Are you sure you want to delete this reply? This cannot be undone.", confirmLabel: "Delete", onConfirm: () => doDeleteReply(id, images, files) });
  }
  const [posts, setPosts] = useState([]);
  const [reactions, setReactions] = useState({}); // { [target_id]: { [emoji]: [user_email, ...] } }
  const [newPost, setNewPost] = useState("");
  const [newImages, setNewImages] = useState([]);
  const [newFiles, setNewFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
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
    const list = data ?? [];
    setPosts(list);
    // Collect every post + reply id, then pull their reactions in one query.
    const ids = [];
    list.forEach((p) => { ids.push(p.id); (p.task_replies ?? []).forEach((r) => ids.push(r.id)); });
    if (ids.length === 0) { setReactions({}); return; }
    const { data: reactionRows } = await supabase
      .from("task_reactions").select("target_id, user_email, emoji").in("target_id", ids);
    const map = {};
    (reactionRows ?? []).forEach((row) => {
      const t = (map[row.target_id] = map[row.target_id] || {});
      (t[row.emoji] = t[row.emoji] || []).push(row.user_email);
    });
    setReactions(map);
  }, [task.id]);

  useEffect(() => {
    loadPosts();
    const ch = supabase.channel("posts-" + task.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_posts", filter: "task_id=eq." + task.id }, loadPosts)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_replies" }, loadPosts)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_reactions" }, loadPosts)
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

  // Add/remove an assignee, notifying the person when newly added.
  function toggleOwner(email) {
    const prev = local.owners || [];
    const adding = !prev.includes(email);
    const next = adding ? [...prev, email] : prev.filter((x) => x !== email);
    setField("owners", next);
    if (adding) {
      notifyAssignment({ to: email, task: task.title, project: projectName || "", assignedBy: userEmail, taskId: task.id });
    }
  }

  async function submitPost() {
    const body = newPost.trim();
    if (!body && newImages.length === 0 && newFiles.length === 0) return;
    setPosting(true);
    const images = newImages.length ? await uploadImages(newImages, task.id) : [];
    const files = newFiles.length ? await uploadFiles(newFiles, task.id) : [];
    const mentions = parseMentions(body, users);
    await supabase.from("task_posts").insert({ task_id: task.id, author: userEmail, body, mentions, images, files });
    notifyMentions({ mentions, task: task.title, project: projectName || "", mentionedBy: userEmail, body, taskId: task.id });
    notifyComment({ owners: local.owners || [], author: userEmail, task: task.title, project: projectName || "", body, mentions, taskId: task.id });
    setNewPost("");
    setNewImages([]);
    setNewFiles([]);
    setPosting(false);
    loadPosts();
  }

  async function doDeletePost(id, images, files) {
    if (images?.length) await supabase.storage.from(IMG_BUCKET).remove(images);
    if (files?.length) await supabase.storage.from(IMG_BUCKET).remove(files.map((f) => f.path));
    await supabase.from("task_posts").delete().eq("id", id);
    loadPosts();
  }

  // Add / remove the current user's reaction with a given emoji. Optimistic;
  // the realtime subscription keeps everyone else in sync.
  async function toggleReaction(targetType, targetId, emoji) {
    const cur = (reactions[targetId] || {})[emoji] || [];
    const has = cur.includes(userEmail);
    setReactions((m) => {
      const t = { ...(m[targetId] || {}) };
      const list = t[emoji] || [];
      const next = has ? list.filter((e) => e !== userEmail) : [...list, userEmail];
      if (next.length) t[emoji] = next; else delete t[emoji];
      return { ...m, [targetId]: t };
    });
    if (has) {
      await supabase.from("task_reactions").delete()
        .eq("target_type", targetType).eq("target_id", targetId).eq("user_email", userEmail).eq("emoji", emoji);
    } else {
      await supabase.from("task_reactions")
        .insert({ target_type: targetType, target_id: targetId, user_email: userEmail, emoji });
    }
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
          <div className="meta-field">
            <span>Assignees</span>
            <MultiPersonPicker owners={local.owners || []} users={users} onToggle={toggleOwner} />
          </div>
          <div className="meta-field">
            <span>Status</span>
            <StatusPicker value={local.status || "To do"} onChange={(s) => setField("status", s)} />
          </div>
          <label className="meta-field">
            <span>Due date</span>
            <DatePicker value={local.due_date || ""} onChange={(v) => setField("due_date", v || null)} />
          </label>
        </div>

        <div className="drawer-body">
          <div className="feed-section">
            <p className="feed-label">Updates</p>

            {/* Compose new post */}
            <div
              className={"compose-box" + (dragOver ? " dropping" : "")}
              onDragOver={(e) => { e.preventDefault(); if (!posting) setDragOver(true); }}
              onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
              onDrop={(e) => {
                e.preventDefault(); setDragOver(false);
                if (posting) return;
                const dropped = Array.from(e.dataTransfer.files || []);
                if (!dropped.length) return;
                const imgs = dropped.filter((f) => f.type.startsWith("image/"));
                const docs = dropped.filter((f) => !f.type.startsWith("image/"));
                if (imgs.length) setNewImages((prev) => [...prev, ...imgs].slice(0, MAX_IMAGES));
                if (docs.length) setNewFiles((prev) => [...prev, ...docs].slice(0, MAX_FILES));
              }}
            >
              <span className="avatar sm" style={avatarStyle(userEmail)}>{nameInitials(userEmail)}</span>
              <div className="compose-right">
                <MentionTextarea value={newPost} onChange={setNewPost} users={users}
                  placeholder={`Write an update… Use @ to mention someone`} rows={2} />
                <Attach images={newImages} setImages={setNewImages} files={newFiles} setFiles={setNewFiles} disabled={posting} />
                <div className="compose-foot">
                  <button className="btn-accent" onClick={submitPost} disabled={(!newPost.trim() && newImages.length === 0 && newFiles.length === 0) || posting}>
                    {posting ? "Posting…" : "Post update"}
                  </button>
                </div>
              </div>
              {dragOver && <div className="compose-drophint">Drop files to attach</div>}
            </div>

            {posts.length === 0 && <p className="muted small feed-empty">No updates yet. Be the first to post.</p>}

            {[...posts].reverse().map((post) => (
              <PostCard key={post.id} post={post} users={users} userEmail={userEmail}
                taskTitle={task.title} projectName={projectName} owners={local.owners || []}
                reactions={reactions} onToggleReaction={toggleReaction}
                onDelete={deletePost} onReply={loadPosts} />
            ))}
          </div>
        </div>

        <div className="drawer-foot">
          <button className="link danger" onClick={() => onDelete(task.id)}>Delete task</button>
        </div>
      </aside>
      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
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

function PostCard({ post, users, userEmail, taskTitle, projectName, owners, reactions, onToggleReaction, onDelete, onReply }) {
  const [replyOpen, setReplyOpen] = useState(false);
  const replyRef = useRef(null);

  // "Reply" button = same as clicking the box: open it and focus the field.
  function openReply() {
    setReplyOpen(true);
    setTimeout(() => replyRef.current?.querySelector("textarea")?.focus(), 0);
  }
  const [reply, setReply] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body);
  const [savingEdit, setSavingEdit] = useState(false);
  const [replyImages, setReplyImages] = useState([]);
  const [replyFiles, setReplyFiles] = useState([]);
  const replies = post.task_replies ?? [];
  const mine = post.author === userEmail;

  async function submitReply() {
    const body = reply.trim();
    if (!body && replyImages.length === 0 && replyFiles.length === 0) return;
    setSubmitting(true);
    const images = replyImages.length ? await uploadImages(replyImages, post.task_id) : [];
    const files = replyFiles.length ? await uploadFiles(replyFiles, post.task_id) : [];
    const mentions = parseMentions(body, users);
    await supabase.from("task_replies").insert({ post_id: post.id, author: userEmail, body, mentions, images, files });
    notifyMentions({ mentions, task: taskTitle, project: projectName || "", mentionedBy: userEmail, body, taskId: post.task_id });
    notifyComment({ owners: owners || [], author: userEmail, task: taskTitle, project: projectName || "", body, mentions, taskId: post.task_id });
    setReply("");
    setReplyImages([]);
    setReplyFiles([]);
    setSubmitting(false);
    setReplyOpen(false);
    onReply();
  }

  async function doDeleteReply(id, images, files) {
    if (images?.length) await supabase.storage.from(IMG_BUCKET).remove(images);
    if (files?.length) await supabase.storage.from(IMG_BUCKET).remove(files.map((f) => f.path));
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
        <Avatar email={post.author} />
        <div className="post-meta">
          <span className="post-author">{displayName(post.author)}</span>
          <span className="post-time" title={fullTime(post.created_at)}>{timeAgo(post.created_at)}</span>
        </div>
        {mine && !editing && (
          <KebabMenu onEdit={startEdit} onDelete={() => onDelete(post.id, post.images, post.files)} />
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
      <ImageGrid paths={post.images} />
      <FileList files={post.files} />

      {/* Replies */}
      {replies.length > 0 && (
        <div className="reply-thread">
          {replies.map((r) => (
            <ReplyItem key={r.id} reply={r} users={users} userEmail={userEmail}
              reactions={reactions[r.id]} onToggleReaction={onToggleReaction}
              onChanged={onReply} onDelete={deleteReply} />
          ))}
        </div>
      )}

      {/* Reactions + reply action */}
      <div className="post-actions">
        <ReactionBar targetType="post" targetId={post.id} reactions={reactions[post.id]}
          userEmail={userEmail} onToggle={onToggleReaction} />
        <button className="post-reply-btn" onClick={openReply}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 17l-5-5 5-5" /><path d="M4 12h11a4 4 0 0 1 4 4v2" />
          </svg>
          Reply{replies.length ? ` (${replies.length})` : ""}
        </button>
      </div>

      {/* Always-visible reply box; controls reveal on focus/content */}
      <div className={"reply-compose" + (replyOpen ? " open" : "")} ref={replyRef}>
        <span className="avatar sm" style={avatarStyle(userEmail)}>{nameInitials(userEmail)}</span>
        <div className="compose-right">
          <MentionTextarea value={reply} onChange={setReply} users={users}
            placeholder="Write a reply… Use @ to mention"
            rows={replyOpen ? 2 : 1}
            onFocus={() => setReplyOpen(true)} />
          {replyOpen && (
            <>
              <Attach images={replyImages} setImages={setReplyImages} files={replyFiles} setFiles={setReplyFiles} disabled={submitting} />
              <div className="compose-foot">
                <button className="link" onClick={() => {
                  setReply(""); setReplyImages([]); setReplyFiles([]); setReplyOpen(false);
                }}>Cancel</button>
                <button className="btn-accent" onClick={submitReply} disabled={(!reply.trim() && replyImages.length === 0 && replyFiles.length === 0) || submitting}>
                  {submitting ? "…" : "Reply"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ReplyItem({ reply, users, userEmail, reactions, onToggleReaction, onChanged, onDelete }) {
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
      <Avatar email={reply.author} size="sm" />
      <div className="reply-content">
        <div className="reply-meta">
          <span className="post-author">{displayName(reply.author)}</span>
          <span className="post-time" title={fullTime(reply.created_at)}>{timeAgo(reply.created_at)}</span>
          {mine && !editing && (
            <KebabMenu onEdit={() => { setDraft(reply.body); setEditing(true); }}
              onDelete={() => onDelete(reply.id, reply.images, reply.files)} />
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
          <>
            <RichText body={reply.body} users={users} />
            <ImageGrid paths={reply.images} />
            <FileList files={reply.files} />
            <div className="reply-actions">
              <ReactionBar targetType="reply" targetId={reply.id} reactions={reactions}
                userEmail={userEmail} onToggle={onToggleReaction} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}



// Like button: gray thumbs-up that turns orange with a count when you've liked.
// Hovering reveals the list of people who liked this update/comment.
// Curated reaction set for the picker.
const REACTION_EMOJIS = ["👍", "❤️", "🎉", "😄", "👀", "✅", "🚀"];

function ReactionBar({ targetType, targetId, reactions, userEmail, onToggle }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!pickerOpen) return;
    function onDown(e) { if (ref.current && !ref.current.contains(e.target)) setPickerOpen(false); }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);

  const map = reactions || {};
  const active = Object.entries(map).filter(([, list]) => list && list.length > 0);

  return (
    <div className="reaction-bar" ref={ref}>
      {active.map(([emoji, list]) => {
        const mine = list.includes(userEmail);
        return (
          <button
            key={emoji}
            type="button"
            className={"reaction-pill" + (mine ? " mine" : "")}
            onClick={() => onToggle(targetType, targetId, emoji)}
            title={list.map(displayName).join(", ")}
          >
            <span className="reaction-emoji">{emoji}</span>
            <span className="reaction-count">{list.length}</span>
          </button>
        );
      })}
      <div className="reaction-add-wrap">
        <button type="button" className="reaction-add" onClick={() => setPickerOpen((v) => !v)}
          aria-label="Add reaction" aria-expanded={pickerOpen}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M8 14s1.5 2 4 2 4-2 4-2" />
            <line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" />
          </svg>
        </button>
        {pickerOpen && (
          <div className="reaction-picker">
            {REACTION_EMOJIS.map((e) => (
              <button key={e} type="button" className="reaction-choice"
                onClick={() => { onToggle(targetType, targetId, e); setPickerOpen(false); }}>
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Image attach control for the composer: pick images, preview, remove before posting.
// Unified attach control: pick images and/or documents in one go. Images are
// routed to the compress + thumbnail path; everything else becomes a file chip.
function Attach({ images, setImages, files, setFiles, disabled }) {
  const inputRef = useRef(null);
  function pick(e) {
    const chosen = Array.from(e.target.files || []);
    const imgs = chosen.filter((f) => f.type.startsWith("image/"));
    const docs = chosen.filter((f) => !f.type.startsWith("image/"));
    if (imgs.length) setImages((prev) => [...prev, ...imgs].slice(0, MAX_IMAGES));
    if (docs.length) setFiles((prev) => [...prev, ...docs].slice(0, MAX_FILES));
    e.target.value = "";
  }
  function removeImage(i) { setImages((prev) => prev.filter((_, idx) => idx !== i)); }
  function removeFile(i) { setFiles((prev) => prev.filter((_, idx) => idx !== i)); }
  const full = images.length >= MAX_IMAGES && files.length >= MAX_FILES;
  const hasAny = images.length > 0 || files.length > 0;
  return (
    <div className="attach">
      <input ref={inputRef} type="file" multiple hidden onChange={pick} />
      <button type="button" className="attach-btn" onClick={() => inputRef.current?.click()}
        disabled={disabled || full} title={full ? "Attachment limit reached" : "Attach an image or file"}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
        {full ? "Max reached" : "Attach"}
      </button>
      {hasAny && (
        <div className="attach-previews">
          {images.map((f, i) => (
            <div className="attach-preview" key={"img" + i}>
              <img src={URL.createObjectURL(f)} alt="" />
              <button type="button" className="attach-remove" onClick={() => removeImage(i)} aria-label="Remove">✕</button>
            </div>
          ))}
          {files.map((f, i) => (
            <span className="file-chip pending" key={"file" + i}>
              <span className="file-chip-name">{f.name}</span>
              <button type="button" className="file-chip-x" onClick={() => removeFile(i)} aria-label="Remove">✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Thumbnails of a comment's images, with a click-to-zoom lightbox.
function ImageGrid({ paths }) {
  const [zoom, setZoom] = useState(null);
  if (!paths || paths.length === 0) return null;
  return (
    <>
      <div className="img-grid">
        {paths.map((p) => (
          <button key={p} type="button" className="img-thumb" onClick={() => setZoom(publicUrl(p))}>
            <img src={publicUrl(p)} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      {zoom && (
        <div className="img-lightbox" onClick={() => setZoom(null)} role="dialog" aria-modal="true">
          <img src={zoom} alt="" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}

// Stored file attachments shown as downloadable chips.
function FileList({ files }) {
  if (!files || files.length === 0) return null;
  return (
    <div className="file-list">
      {files.map((f, i) => (
        <a key={i} className="file-chip" href={publicUrl(f.path)} target="_blank"
          rel="noopener noreferrer" download={f.name} title={f.name}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
          </svg>
          <span className="file-chip-name">{f.name}</span>
          {f.size != null && <span className="file-chip-size">{formatBytes(f.size)}</span>}
        </a>
      ))}
    </div>
  );
}

// Colored status dropdown — identical to the one in the projects table.
function StatusPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const ref = useRef(null);
  const triggerRef = useRef(null);
  const current = value || "To do";
  const slug = (s) => s.toLowerCase().replace(/\s+/g, "-");

  useEffect(() => {
    function onClickOutside(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const PW = Math.max(180, r.width), PH = 230, GAP = 6, EDGE = 8;
      let left = r.left;
      if (left + PW > window.innerWidth - EDGE) left = r.right - PW;
      left = Math.max(EDGE, left);
      let top = r.bottom + GAP;
      if (top + PH > window.innerHeight - EDGE) {
        const up = r.top - GAP - PH;
        top = up >= EDGE ? up : Math.max(EDGE, window.innerHeight - PH - EDGE);
      }
      setCoords({ top, left, width: r.width });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  return (
    <div className="status-picker" ref={ref}>
      <button type="button" ref={triggerRef} className={"tpill tpill-" + slug(current)}
        onClick={() => setOpen((o) => !o)}>
        {current}
      </button>
      {open && coords && (
        <div className="status-menu"
          style={{ position: "fixed", top: coords.top, left: coords.left, minWidth: coords.width }}>
          {TASK_STATUSES.map((s) => (
            <button key={s} type="button"
              className={"status-option tpill-" + slug(s) + (s === current ? " is-current" : "")}
              onClick={() => { onChange(s); setOpen(false); }}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Multi-assignee picker — identical to the one in the projects table.
function MultiPersonPicker({ owners, users, onToggle }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const ref = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    function onClickOutside(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const PW = 230, PH = 300, GAP = 6, EDGE = 8;
      let left = r.left;
      if (left + PW > window.innerWidth - EDGE) left = r.right - PW;
      left = Math.max(EDGE, left);
      let top = r.bottom + GAP;
      if (top + PH > window.innerHeight - EDGE) {
        const up = r.top - GAP - PH;
        top = up >= EDGE ? up : Math.max(EDGE, window.innerHeight - PH - EDGE);
      }
      setCoords({ top, left });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  return (
    <div className="multi-person" ref={ref}>
      <div className="person-avatars" ref={triggerRef} onClick={() => setOpen(!open)}>
        {owners.length === 0
          ? <span className="not-assigned">Not Assigned</span>
          : owners.map(e => (
            <Avatar key={e} email={e} size="sm" />
          ))
        }
        <span className="assign-caret">▾</span>
      </div>
      {open && coords && (
        <div className="person-dropdown" style={{ position: "fixed", top: coords.top, left: coords.left }}>
          {users.map(u => (
            <label key={u} className="person-option">
              <input type="checkbox" checked={owners.includes(u)}
                onChange={() => onToggle(u)} />
              <span className="avatar sm" style={avatarStyle(u)}>{nameInitials(u)}</span>
              <span>{displayName(u)}</span>
            </label>
          ))}
          {owners.length > 0 && (
            <button className="link danger person-clear"
              onClick={() => owners.forEach(e => onToggle(e))}>
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
