import { useEffect, useState, useRef, useMemo } from "react";
import { supabase } from "../supabaseClient";

// Global search ("command palette"). Searches tasks + projects (fetched on open)
// and work orders (passed in from App, which already holds them). Selecting a
// result asks App to open it on the right page.
export default function SearchOverlay({ jobs = [], onClose, onOpenTask, onOpenJob, onOpenProject }) {
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Load projects + tasks once when the palette opens.
  useEffect(() => {
    let on = true;
    (async () => {
      const [p, t] = await Promise.all([
        supabase.from("projects").select("id, name"),
        supabase.from("tasks").select("id, title, project_id, status"),
      ]);
      if (on) { setProjects(p.data || []); setTasks(t.data || []); }
    })();
    return () => { on = false; };
  }, []);

  const projName = useMemo(() => {
    const m = {};
    projects.forEach((p) => { m[p.id] = p.name; });
    return m;
  }, [projects]);

  const q = query.trim().toLowerCase();

  const results = useMemo(() => {
    if (!q) return [];
    const out = [];
    tasks.forEach((t) => {
      const hay = `${t.title || ""} ${projName[t.project_id] || ""}`.toLowerCase();
      if (hay.includes(q)) {
        out.push({ kind: "task", id: t.id, title: t.title || "Untitled task", sub: projName[t.project_id] || "" });
      }
    });
    projects.forEach((p) => {
      if ((p.name || "").toLowerCase().includes(q)) {
        out.push({ kind: "project", id: p.id, title: p.name || "Untitled project", sub: "" });
      }
    });
    jobs.forEach((j) => {
      const hay = `${j.job_title || ""} ${j.brand || ""} ${j.po_number || ""} ${j.status || ""} ${j.sttark_order_id || ""}`.toLowerCase();
      if (hay.includes(q)) {
        out.push({ kind: "job", id: j.id, job: j, title: j.job_title || "Untitled job", sub: [j.brand, j.status].filter(Boolean).join(" · ") });
      }
    });
    return out.slice(0, 40);
  }, [q, tasks, projects, jobs, projName]);

  useEffect(() => { setActive(0); }, [q]);

  // Keep the highlighted row visible during keyboard navigation.
  useEffect(() => {
    const el = listRef.current?.querySelector(".search-item.active");
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(r) {
    if (!r) return;
    if (r.kind === "task") onOpenTask(r.id);
    else if (r.kind === "project") onOpenProject(r.id);
    else if (r.kind === "job") onOpenJob(r.job);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(results[active]); }
  }

  const label = { task: "Task", project: "Project", job: "Work order" };

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-panel" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="search-head">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input ref={inputRef} className="search-box" placeholder="Search tasks, projects, work orders…"
            value={query} onChange={(e) => setQuery(e.target.value)} />
          <kbd className="search-esc">esc</kbd>
        </div>
        <div className="search-results" ref={listRef}>
          {!q && <p className="search-hint">Start typing to search across tasks, projects, and work orders.</p>}
          {q && results.length === 0 && <p className="search-hint">No matches for “{query}”.</p>}
          {results.map((r, i) => (
            <button
              key={r.kind + r.id}
              className={"search-item" + (i === active ? " active" : "")}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(r)}
            >
              <span className={"search-kind k-" + r.kind}>{label[r.kind]}</span>
              <span className="search-title">{r.title}</span>
              {r.sub && <span className="search-sub">{r.sub}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
