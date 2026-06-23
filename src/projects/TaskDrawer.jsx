import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { TASK_STATUSES, TASK_PRIORITIES } from "./constants";

export default function TaskDrawer({ task, userEmail, onClose, onUpdate, onDelete }) {
  const [local, setLocal] = useState(task);
  const [notes, setNotes] = useState(task.notes || "");
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState("");
  const [savedNote, setSavedNote] = useState(false);

  // keep local in sync if the task prop changes
  useEffect(() => { setLocal(task); setNotes(task.notes || ""); }, [task]);

  const loadComments = useCallback(async () => {
    const { data } = await supabase
      .from("task_comments").select("*").eq("task_id", task.id).order("created_at");
    setComments(data ?? []);
  }, [task.id]);

  useEffect(() => {
    loadComments();
    const ch = supabase
      .channel("task-comments-" + task.id)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "task_comments", filter: "task_id=eq." + task.id },
        loadComments)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [task.id, loadComments]);

  // Esc closes
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function setField(key, value) {
    setLocal((l) => ({ ...l, [key]: value }));
    onUpdate(task.id, { [key]: value });
  }

  async function saveNotes() {
    await onUpdate(task.id, { notes });
    setSavedNote(true);
    setTimeout(() => setSavedNote(false), 1500);
  }

  async function postComment() {
    const body = newComment.trim();
    if (!body) return;
    setNewComment("");
    await supabase.from("task_comments").insert({ task_id: task.id, author: userEmail, body });
    loadComments();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <input className="drawer-title" value={local.title}
            onChange={(e) => setLocal((l) => ({ ...l, title: e.target.value }))}
            onBlur={(e) => onUpdate(task.id, { title: e.target.value })} />
          <button className="link" onClick={onClose}>Close</button>
        </div>

        <div className="drawer-body">
          <div className="drawer-fields">
            <label className="field">
              <span>Owner</span>
              <input value={local.owner || ""} placeholder="name or email"
                onChange={(e) => setLocal((l) => ({ ...l, owner: e.target.value }))}
                onBlur={(e) => onUpdate(task.id, { owner: e.target.value })} />
            </label>
            <label className="field">
              <span>Due date</span>
              <input type="date" value={local.due_date || ""}
                onChange={(e) => setField("due_date", e.target.value || null)} />
            </label>
            <label className="field">
              <span>Status</span>
              <select value={local.status} onChange={(e) => setField("status", e.target.value)}>
                {TASK_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Priority</span>
              <select value={local.priority} onChange={(e) => setField("priority", e.target.value)}>
                {TASK_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
              </select>
            </label>
          </div>

          <div className="drawer-section">
            <div className="drawer-section-head">
              <span>Notes</span>
              <button className="link" onClick={saveNotes}>{savedNote ? "Saved ✓" : "Save"}</button>
            </div>
            <textarea className="notes-area" rows={4} value={notes}
              placeholder="Shared notes for this task…"
              onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="drawer-section">
            <div className="drawer-section-head"><span>Comments</span></div>
            <div className="comments">
              {comments.length === 0 && <p className="muted small">No comments yet.</p>}
              {comments.map((c) => (
                <div className="comment" key={c.id}>
                  <div className="comment-meta">
                    <span className="comment-author">{c.author || "Someone"}</span>
                    <span className="comment-time">{fmtTime(c.created_at)}</span>
                  </div>
                  <p className="comment-body">{c.body}</p>
                </div>
              ))}
            </div>
            <div className="comment-compose">
              <textarea rows={2} value={newComment} placeholder="Write a comment…"
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) postComment(); }} />
              <button className="btn-accent" onClick={postComment} disabled={!newComment.trim()}>Post</button>
            </div>
            <p className="muted small">Tip: ⌘/Ctrl + Enter to post.</p>
          </div>
        </div>

        <div className="drawer-foot">
          <button className="link danger" onClick={() => onDelete(task.id)}>Delete task</button>
        </div>
      </aside>
    </div>
  );
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
