import { useEffect, useState, useCallback, useRef, useLayoutEffect } from "react";
import { supabase } from "../supabaseClient";
import { TASK_STATUSES, statusClass } from "./constants";
import { useUsers } from "./useUsers";
import TaskDrawer from "./TaskDrawer";
import { notifyAssignment } from "./notifications";
import { displayName, nameInitials, avatarStyle } from "./userMap";
import Avatar from "./Avatar";
import DatePicker from "../components/DatePicker";
import { toast } from "../components/Toaster";

// Classifies a task's due date for highlighting and filtering.
// Returns "overdue", "soon" (within 3 days), or null. Done tasks are never flagged.
function dueState(task) {
  if (!task.due_date) return null;
  if ((task.status || "To do") === "Done") return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(task.due_date + "T00:00:00");
  const diffDays = Math.round((due - today) / 86400000);
  if (diffDays < 0) return "overdue";
  if (diffDays <= 3) return "soon";
  return null;
}

export default function Projects({ userEmail, focusTaskId, onTaskFocused, canEdit = true }) {
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openTaskId, setOpenTaskId] = useState(null);
  const [addingProject, setAddingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [query, setQuery] = useState("");
  const [filterPerson, setFilterPerson] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterDue, setFilterDue] = useState("");
  const [mineOnly, setMineOnly] = useState(false);   // "My tasks" toggle
  const [sortBy, setSortBy] = useState("manual");    // manual | due | status | name
  const [filterOpen, setFilterOpen] = useState(false); // filter dropdown panel
  // Selection for the bottom action bar (Monday-style). Separate sets so a whole
  // project and individual tasks can both be selected at once.
  const [selProjects, setSelProjects] = useState(() => new Set());
  const [selTasks, setSelTasks] = useState(() => new Set());
  const [pendingDelete, setPendingDelete] = useState(null);
  // Activity-feed indicator: per-task update counts + this user's read state.
  const [activity, setActivity] = useState({}); // { [taskId]: { count, latest, latestAuthor } }
  const [reads, setReads] = useState({});       // { [taskId]: last_read_at ISO }
  const [draggingTaskId, setDraggingTaskId] = useState(null); // task being dragged
  const [dragOverProject, setDragOverProject] = useState(null); // project being hovered
  const users = useUsers();
  const newProjRef = useRef(null);

  const load = useCallback(async () => {
    const [{ data: p }, { data: t }] = await Promise.all([
      supabase.from("projects").select("*").order("sort_order").order("created_at"),
      supabase.from("tasks").select("*").order("sort_order").order("created_at"),
    ]);
    setProjects(p ?? []);
    setTasks(t ?? []);
    setLoading(false);
  }, []);

  // Counts updates (task_posts only — NOT replies/comments) per task, plus the
  // newest update's time/author, and this user's last-read time per task.
  const loadActivity = useCallback(async () => {
    const [{ data: posts }, { data: rd }] = await Promise.all([
      supabase.from("task_posts").select("task_id, created_at, author"),
      supabase.from("task_reads").select("task_id, last_read_at").eq("user_email", userEmail),
    ]);
    const a = {};
    for (const post of posts ?? []) {
      const m = a[post.task_id] || (a[post.task_id] = { count: 0, latest: null, latestAuthor: null });
      m.count += 1;
      if (!m.latest || post.created_at > m.latest) { m.latest = post.created_at; m.latestAuthor = post.author; }
    }
    const r = {};
    for (const row of rd ?? []) r[row.task_id] = row.last_read_at;
    setActivity(a);
    setReads(r);
  }, [userEmail]);

  useEffect(() => {
    load();
    loadActivity();
    const ch = supabase
      .channel("projects-v2")
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_posts" }, loadActivity)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [load, loadActivity]);

  useEffect(() => {
    if (addingProject) newProjRef.current?.focus();
  }, [addingProject]);

  async function saveProject(e) {
    e.preventDefault();
    const name = newProjectName.trim();
    if (!name) { setAddingProject(false); return; }
    await supabase.from("projects").insert({ name, sort_order: projects.length });
    setNewProjectName("");
    setAddingProject(false);
    load();
  }

  async function updateProjectName(id, name) {
    if (!name.trim()) return;
    await supabase.from("projects").update({ name: name.trim() }).eq("id", id);
    load();
  }

  async function addTask(projectId) {
    const { data } = await supabase.from("tasks").insert({
      project_id: projectId, title: "New task",
      owners: [],
      sort_order: tasks.filter(t => t.project_id === projectId).length,
    }).select().single();
    load();
    if (data) setOpenTaskId(data.id);
  }

  async function updateTask(id, fields) {
    await supabase.from("tasks").update(fields).eq("id", id);
    load();
  }

  // Drag-and-drop: move a task into a different project. Appends to the end of
  // the target project's list. Optimistic, then reload to reconcile.
  async function moveTaskToProject(taskId, targetProjectId) {
    const t = tasks.find((x) => x.id === taskId);
    if (!t || t.project_id === targetProjectId) return;
    const targetName = projects.find((p) => p.id === targetProjectId)?.name || "project";
    const newOrder = tasks.filter((x) => x.project_id === targetProjectId).length;
    setTasks((prev) => prev.map((x) =>
      x.id === taskId ? { ...x, project_id: targetProjectId, sort_order: newOrder } : x
    ));
    const { error } = await supabase.from("tasks")
      .update({ project_id: targetProjectId, sort_order: newOrder }).eq("id", taskId);
    if (error) {
      toast.error("Couldn't move task — " + error.message);
      load(); // reload to undo the optimistic move
      return;
    }
    toast.success(`Moved "${t.title}" to ${targetName}`);
    load();
  }

  // Marks a task's updates as read for the current user (optimistic + persisted).
  async function markRead(taskId) {
    if (!taskId) return;
    const now = new Date().toISOString();
    setReads((r) => ({ ...r, [taskId]: now }));
    await supabase.from("task_reads").upsert(
      { task_id: taskId, user_email: userEmail, last_read_at: now },
      { onConflict: "task_id,user_email" }
    );
  }

  function handleOpenTask(taskId) {
    markRead(taskId);
    setOpenTaskId(taskId);
  }

  // Open a task requested from global search, once tasks have loaded. Clearing
  // the request in App prevents it re-opening when you later revisit Projects.
  useEffect(() => {
    if (focusTaskId && tasks.some((t) => t.id === focusTaskId)) {
      handleOpenTask(focusTaskId);
      onTaskFocused && onTaskFocused();
    }
  }, [focusTaskId, tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  async function deleteTask(id) {
    if (!confirm("Delete this task?")) return;
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) { toast.error("Couldn't delete task — " + error.message); return; }
    setOpenTaskId(null);
    toast.success("Task deleted");
    load();
  }

  // --- Selection helpers ------------------------------------------------------
  function toggleProject(id) {
    setSelProjects((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleTask(id) {
    setSelTasks((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function clearSelection() { setSelProjects(new Set()); setSelTasks(new Set()); }

  const selectionCount = selProjects.size + selTasks.size;

  function requestDelete() {
    const projIds = [...selProjects];
    // Skip tasks whose whole project is being deleted (cascade handles them).
    const taskIds = [...selTasks].filter((id) => {
      const t = tasks.find((x) => x.id === id);
      return t && !selProjects.has(t.project_id);
    });
    const total = projIds.length + taskIds.length;
    if (total === 0) return;
    setPendingDelete({ projIds, taskIds, total });
  }

  async function confirmDeleteNow() {
    if (!pendingDelete) return;
    const { projIds, taskIds } = pendingDelete;
    let err = null;
    if (projIds.length) { const r = await supabase.from("projects").delete().in("id", projIds); err = err || r.error; }
    if (taskIds.length) { const r = await supabase.from("tasks").delete().in("id", taskIds); err = err || r.error; }
    setPendingDelete(null);
    clearSelection();
    setOpenTaskId(null);
    if (err) { toast.error("Delete failed — " + err.message); load(); return; }
    const parts = [];
    if (projIds.length) parts.push(`${projIds.length} project${projIds.length === 1 ? "" : "s"}`);
    if (taskIds.length) parts.push(`${taskIds.length} task${taskIds.length === 1 ? "" : "s"}`);
    toast.success("Deleted " + parts.join(" & "));
    load();
  }

  async function duplicateSelected() {
    // Duplicate whole projects (with their tasks).
    for (const pid of selProjects) {
      const proj = projects.find((p) => p.id === pid);
      if (!proj) continue;
      const { data: newProj } = await supabase.from("projects")
        .insert({ name: proj.name, sort_order: projects.length })
        .select().single();
      if (!newProj) continue;
      const childTasks = tasks.filter((t) => t.project_id === pid);
      if (childTasks.length) {
        await supabase.from("tasks").insert(childTasks.map((t, i) => ({
          project_id: newProj.id, title: t.title, owners: t.owners || [],
          status: t.status || "To do", due_date: t.due_date || null, sort_order: i,
        })));
      }
    }
    // Duplicate individually-selected tasks (skip those inside a duplicated project).
    for (const tid of selTasks) {
      const t = tasks.find((x) => x.id === tid);
      if (!t || selProjects.has(t.project_id)) continue;
      await supabase.from("tasks").insert({
        project_id: t.project_id, title: t.title, owners: t.owners || [],
        status: t.status || "To do", due_date: t.due_date || null,
        sort_order: tasks.filter((x) => x.project_id === t.project_id).length,
      });
    }
    clearSelection();
    toast.success("Duplicated selection");
    load();
  }

  // Close the filter dropdown on outside-click / Esc. Declared before any early
  // return so the hook order stays stable across renders.
  const filterRef = useRef(null);
  useEffect(() => {
    if (!filterOpen) return;
    function onDown(e) { if (filterRef.current && !filterRef.current.contains(e.target)) setFilterOpen(false); }
    function onEsc(e) { if (e.key === "Escape") setFilterOpen(false); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onEsc); };
  }, [filterOpen]);

  if (loading) return <div className="muted pad">Loading projects…</div>;

  const openTask = tasks.find((t) => t.id === openTaskId) || null;
  const openProject = openTask ? projects.find(p => p.id === openTask.project_id) : null;

  // --- Search + filter --------------------------------------------------------
  const q = query.trim().toLowerCase();
  const anyActive = !!q || !!filterPerson || !!filterStatus || !!filterDue || mineOnly;
  // Number of active filters (excludes the search box) — shown as a badge.
  const activeFilterCount =
    (filterPerson ? 1 : 0) + (filterStatus ? 1 : 0) + (filterDue ? 1 : 0) + (mineOnly ? 1 : 0);

  function clearFilters() {
    setFilterPerson(""); setFilterStatus(""); setFilterDue(""); setMineOnly(false);
  }

  function visibleTasksFor(project, projTasks) {
    const nameHit = !!q && (project.name || "").toLowerCase().includes(q);
    return projTasks.filter((t) => {
      const personOK = !filterPerson || (t.owners || []).includes(filterPerson);
      const statusOK = !filterStatus || (t.status || "To do") === filterStatus;
      const dueOK = !filterDue || dueState(t) === filterDue;
      const mineOK = !mineOnly || (t.owners || []).includes(userEmail);
      const searchOK = !q || nameHit || (t.title || "").toLowerCase().includes(q);
      return personOK && statusOK && dueOK && mineOK && searchOK;
    });
  }

  // Sort tasks within a project. "manual" keeps the saved sort_order (as loaded).
  const STATUS_ORDER = { "To do": 0, "In progress": 1, "Stuck": 2, "Done": 3 };
  function sortTasks(list) {
    if (sortBy === "manual") return list;
    const arr = [...list];
    if (sortBy === "due") {
      arr.sort((a, b) => {
        const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
        const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
        return da - db;
      });
    } else if (sortBy === "status") {
      arr.sort((a, b) => (STATUS_ORDER[a.status ?? "To do"] ?? 0) - (STATUS_ORDER[b.status ?? "To do"] ?? 0));
    } else if (sortBy === "name") {
      arr.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    }
    return arr;
  }

  const visibleProjects = projects
    .map((proj) => {
      const projTasks = tasks.filter((t) => t.project_id === proj.id);
      const visTasks = sortTasks(visibleTasksFor(proj, projTasks));
      const nameHit = !!q && (proj.name || "").toLowerCase().includes(q);
      const done = projTasks.filter((t) => (t.status || "To do") === "Done").length;
      let show;
      if (!anyActive) show = true;
      else if (visTasks.length > 0) show = true;
      // a project whose name matches the search still shows (even if empty),
      // but only when no person/status filter is narrowing things down
      else if (nameHit && !filterPerson && !filterStatus && !filterDue && !mineOnly) show = true;
      else show = false;
      return { proj, tasks: visTasks, show, progress: { done, total: projTasks.length } };
    })
    .filter((x) => x.show);

  return (
    <div className="projects">
      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="Search projects & tasks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="filter-wrap" ref={filterRef}>
          <button
            className={"filter-trigger" + (activeFilterCount > 0 ? " active" : "") + (filterOpen ? " open" : "")}
            onClick={() => setFilterOpen((v) => !v)}
            aria-expanded={filterOpen}
            title="Filter & sort"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 4h18l-7 8v6l-4 2v-8z" />
            </svg>
            Filter
            {activeFilterCount > 0 && <span className="filter-badge">{activeFilterCount}</span>}
          </button>

          {filterOpen && (
            <div className="filter-menu">
              <label className="filter-field">
                <span className="filter-field-label">Person</span>
                <select className="filter-field-select" value={filterPerson} onChange={(e) => setFilterPerson(e.target.value)}>
                  <option value="">All people</option>
                  {users.map((u) => (<option key={u} value={u}>{displayName(u)}</option>))}
                </select>
              </label>

              <label className="filter-field">
                <span className="filter-field-label">Status</span>
                <select className="filter-field-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                  <option value="">All statuses</option>
                  {TASK_STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
                </select>
              </label>

              <label className="filter-field">
                <span className="filter-field-label">Due date</span>
                <select className="filter-field-select" value={filterDue} onChange={(e) => setFilterDue(e.target.value)}>
                  <option value="">Any due date</option>
                  <option value="overdue">Overdue</option>
                  <option value="soon">Due soon (3 days)</option>
                </select>
              </label>

              <button
                className={"filter-mine" + (mineOnly ? " on" : "")}
                onClick={() => setMineOnly((v) => !v)}
                aria-pressed={mineOnly}
              >
                <span className="filter-field-label">My tasks only</span>
                <span className="filter-switch" aria-hidden="true" />
              </button>

              <div className="filter-divider" />

              <label className="filter-field">
                <span className="filter-field-label">Sort by</span>
                <select className="filter-field-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="manual">Manual</option>
                  <option value="due">Due date</option>
                  <option value="status">Status</option>
                  <option value="name">Name</option>
                </select>
              </label>

              {activeFilterCount > 0 && (
                <button className="filter-clear" onClick={clearFilters}>Clear filters</button>
              )}
            </div>
          )}
        </div>

        {canEdit && <button className="btn-accent push-right" onClick={() => setAddingProject(true)}>+ New Project</button>}
      </div>

      {projects.length === 0 && !addingProject ? (
        <div className="empty">
          <p className="empty-title">No projects yet</p>
          <p className="muted">{canEdit ? "Create your first project to start adding tasks." : "You haven't been added to any projects yet."}</p>
          {canEdit && <button className="btn-accent" onClick={() => setAddingProject(true)}>+ New Project</button>}
        </div>
      ) : anyActive && visibleProjects.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No matches</p>
          <p className="muted">No projects or tasks match your search and filters.</p>
          <button className="btn-accent" onClick={() => { setQuery(""); setFilterPerson(""); setFilterStatus(""); setFilterDue(""); setMineOnly(false); }}>
            Clear search &amp; filters
          </button>
        </div>
      ) : (
        <div className="proj-list">
          {visibleProjects.map(({ proj, tasks: projTasks, progress }) => {
            return (
              <ProjectGroup
                key={proj.id}
                project={proj}
                tasks={projTasks}
                users={users}
                userEmail={userEmail}
                progress={progress}
                selected={selProjects.has(proj.id)}
                onToggleSelect={toggleProject}
                selectedTasks={selTasks}
                onToggleTask={toggleTask}
                onUpdateName={updateProjectName}
                onAddTask={addTask}
                onOpenTask={handleOpenTask}
                onUpdateTask={updateTask}
                activity={activity}
                reads={reads}
                draggingTaskId={draggingTaskId}
                onDragTaskStart={setDraggingTaskId}
                onDragTaskEnd={() => { setDraggingTaskId(null); setDragOverProject(null); }}
                isDropTarget={dragOverProject === proj.id}
                onDragOverProject={setDragOverProject}
                onDropTask={moveTaskToProject}
              />
            );
          })}
          {addingProject && (
            <form className="proj-new-form" onSubmit={saveProject}>
              <input ref={newProjRef} className="proj-new-input"
                value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Project name…"
                onBlur={saveProject}
                onKeyDown={(e) => e.key === "Escape" && setAddingProject(false)} />
            </form>
          )}
        </div>
      )}

      {openTask && (
        <TaskDrawer
          task={openTask}
          projectName={openProject?.name}
          userEmail={userEmail}
          users={users}
          onClose={() => { markRead(openTaskId); setOpenTaskId(null); }}
          onUpdate={updateTask}
          onDelete={deleteTask}
        />
      )}

      {selectionCount > 0 && (
        <div className="sel-bar">
          <span className="sel-count">{selectionCount}</span>
          <span className="sel-label">{selectionCount === 1 ? "selected" : "selected"}</span>
          <span className="sel-divider" />
          <button className="sel-action" onClick={duplicateSelected}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <span>Duplicate</span>
          </button>
          <button className="sel-action danger" onClick={requestDelete}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
            <span>Delete</span>
          </button>
          <span className="sel-divider" />
          <button className="sel-x" onClick={clearSelection} aria-label="Clear selection">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {pendingDelete && (
        <div className="confirm-overlay" onClick={() => setPendingDelete(null)}>
          <div className="confirm-bar" onClick={(e) => e.stopPropagation()}>
            <svg className="confirm-icon" width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
            <span className="confirm-msg">
              Delete {pendingDelete.total} item{pendingDelete.total === 1 ? "" : "s"}? This can't be undone.
            </span>
            <button className="confirm-cancel" onClick={() => setPendingDelete(null)}>Cancel</button>
            <button className="confirm-delete" onClick={confirmDeleteNow}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectGroup({ project, tasks, users, userEmail, progress, selected, onToggleSelect, selectedTasks, onToggleTask, onUpdateName, onAddTask, onOpenTask, onUpdateTask, activity, reads, draggingTaskId, onDragTaskStart, onDragTaskEnd, isDropTarget, onDragOverProject, onDropTask }) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(project.name);
  const [collapsed, setCollapsed] = useState(false);

  function saveName() {
    setEditingName(false);
    onUpdateName(project.id, name);
  }

  const done = progress?.done || 0;
  const total = progress?.total || 0;
  const pct = total ? Math.round((done / total) * 100) : 0;

  // This group is the source of the current drag (don't show a drop cue on it).
  const isSource = draggingTaskId != null && tasks.some((t) => t.id === draggingTaskId);
  const showDrop = isDropTarget && draggingTaskId != null && !isSource;

  function handleDragOver(e) {
    if (draggingTaskId == null) return;
    e.preventDefault();                 // allow drop
    e.dataTransfer.dropEffect = "move";
    onDragOverProject(project.id);
  }
  function handleDrop(e) {
    if (draggingTaskId == null) return;
    e.preventDefault();
    onDropTask(draggingTaskId, project.id);
  }

  return (
    <div
      className={"proj-group" + (showDrop ? " drop-target" : "")}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="proj-head">
        <input
          type="checkbox"
          className="proj-check"
          checked={selected}
          onChange={() => onToggleSelect(project.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select project ${project.name}`}
        />
        <button className="proj-collapse" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? "▶" : "▼"}
        </button>
        {editingName ? (
          <input className="proj-name-input" value={name} autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") { setName(project.name); setEditingName(false); } }} />
        ) : (
          <span className="proj-name" title="Double-click to rename" onDoubleClick={() => setEditingName(true)}>{project.name}</span>
        )}
        <span className="proj-count">{tasks.length} {tasks.length === 1 ? "item" : "items"}</span>
        {total > 0 && (
          <span className="proj-progress" title={`${done} of ${total} done`}>
            <span className="proj-progress-bar">
              <span className="proj-progress-fill" style={{ width: pct + "%" }} />
            </span>
            <span className="proj-progress-label">{done}/{total}</span>
          </span>
        )}
      </div>
      {!collapsed && (
        <div className="ptable-wrap">
          <table className="ptable">
            <thead>
              <tr>
                <th className="col-check"></th>
                <th>Item</th>
                <th className="col-person">Person</th>
                <th className="col-status">Status</th>
                <th className="col-date">Date</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 && (
                <tr className="empty-task-row">
                  <td colSpan={5}>Nothing here yet — add your first item below.</td>
                </tr>
              )}
              {tasks.map((t) => {
                const meta = activity[t.id];
                const count = meta?.count || 0;
                const lastRead = reads[t.id];
                // Unread when there are updates from someone else that are newer
                // than this user's last view. Your own updates never flag you.
                const unread = count > 0
                  && meta.latestAuthor !== userEmail
                  && (!lastRead || new Date(meta.latest) > new Date(lastRead));
                return (
                  <TaskRow key={t.id} task={t} users={users} userEmail={userEmail}
                    checked={selectedTasks.has(t.id)}
                    onToggle={onToggleTask}
                    onOpen={() => onOpenTask(t.id)}
                    onUpdate={onUpdateTask}
                    updates={count}
                    unread={unread}
                    dragging={draggingTaskId === t.id}
                    onDragStart={onDragTaskStart}
                    onDragEnd={onDragTaskEnd} />
                );
              })}
              <tr className="add-item-row">
                <td colSpan={5}>
                  <button className="add-item-btn" onClick={() => onAddTask(project.id)}>+ Add item</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, users, userEmail, checked, onToggle, onOpen, onUpdate, updates = 0, unread = false, dragging = false, onDragStart, onDragEnd }) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(task.title);
  const owners = task.owners || (task.owner ? [task.owner] : []);

  useEffect(() => { setTitle(task.title); }, [task.title]);

  function saveTitle() {
    setEditingTitle(false);
    if (title.trim() && title !== task.title) onUpdate(task.id, { title: title.trim() });
  }

  function toggleOwner(email) {
    const prev = task.owners || [];
    const next = prev.includes(email)
      ? prev.filter(e => e !== email)
      : [...prev, email];
    onUpdate(task.id, { owners: next });
    // Notify newly added people only
    if (!prev.includes(email)) {
      notifyAssignment({ to: email, task: task.title, project: "", assignedBy: userEmail, taskId: task.id });
    }
  }

  return (
    <tr
      className={"ptask-row" + (checked ? " selected" : "") + (dragging ? " dragging" : "")}
      onClick={!editingTitle ? onOpen : undefined}
      draggable={!editingTitle}
      onDragStart={(e) => {
        if (editingTitle) return;
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", task.id); } catch {}
        onDragStart && onDragStart(task.id);
      }}
      onDragEnd={() => onDragEnd && onDragEnd()}
    >
      <td className="col-check" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={() => onToggle(task.id)}
          aria-label={`Select task ${task.title}`} />
      </td>
      <td className="col-item">
        <div className="item-cell">
          {editingTitle ? (
            <input className="task-title-input" value={title} autoFocus
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") { setTitle(task.title); setEditingTitle(false); } }} />
          ) : (
            <span className="task-title" title="Double-click to rename" onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true); }}>{task.title}</span>
          )}
        </div>
      </td>
      <td className="col-person" onClick={(e) => e.stopPropagation()}>
        <MultiPersonPicker owners={owners} users={users} onToggle={toggleOwner} />
      </td>
      <td className="col-status" onClick={(e) => e.stopPropagation()}>
        <StatusPicker value={task.status} onChange={(s) => onUpdate(task.id, { status: s })} />
      </td>
      <td className={"col-date" + (dueState(task) ? " due-" + dueState(task) : "")} onClick={(e) => e.stopPropagation()}>
        <DatePicker value={task.due_date || ""} onChange={(v) => onUpdate(task.id, { due_date: v || null })} placeholder="Set date" />
      </td>
    </tr>
  );
}

function UpdatesBadge({ count, unread }) {
  const label = count === 0
    ? "No updates yet"
    : `${count} update${count === 1 ? "" : "s"}${unread ? " · unread" : ""}`;
  return (
    <span
      className={"updates-badge" + (unread ? " unread" : "") + (count === 0 ? " empty" : "")}
      title={label}
      aria-label={label}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
      {count > 0 && <span className="updates-count">{count}</span>}
    </span>
  );
}

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

  // Position against the viewport so it's never clipped by the table's scroll
  // container, flipping up near the bottom edge.
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

  // Position the dropdown against the viewport so it's never clipped by the
  // table's scroll container, and flip it up/left near an edge.
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
