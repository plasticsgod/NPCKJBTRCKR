import { useEffect, useState, useCallback, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../supabaseClient";
import { TASK_STATUSES, statusClass } from "./constants";
import { useUsers } from "./useUsers";
import TaskDrawer from "./TaskDrawer";
import { notifyAssignment } from "./notifications";
import { displayName, nameInitials, avatarStyle } from "./userMap";
import Avatar from "./Avatar";
import DatePicker from "../components/DatePicker";
import { ProjectsSkeleton } from "../components/Skeletons";
import ConfirmModal from "../components/ConfirmModal";
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
  const [confirmState, setConfirmState] = useState(null);
  // Activity-feed indicator: per-task update counts + this user's read state.
  const [activity, setActivity] = useState({}); // { [taskId]: { count, latest, latestAuthor } }
  const [reads, setReads] = useState({});       // { [taskId]: last_read_at ISO }
  const [draggingTaskId, setDraggingTaskId] = useState(null); // task being dragged
  const [dragOverProject, setDragOverProject] = useState(null); // project being hovered
  const users = useUsers();
  const newProjRef = useRef(null);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [mobilePickerOpen, setMobilePickerOpen] = useState(false);
  const [railSearch, setRailSearch] = useState("");

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
    const { data } = await supabase.from("projects").insert({ name, sort_order: projects.length }).select().single();
    setNewProjectName("");
    setAddingProject(false);
    if (data) setActiveProjectId(data.id);
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

  // Inline quick-add: create with the typed title, no drawer, so you can rattle
  // off several in a row.
  async function addTaskInline(projectId, title) {
    const t = title.trim();
    if (!t) return;
    await supabase.from("tasks").insert({
      project_id: projectId, title: t, owners: [],
      sort_order: tasks.filter((x) => x.project_id === projectId).length,
    });
    load();
  }

  async function updateTask(id, fields) {
    // Reflect the change instantly; realtime reconciles, revert on error.
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...fields } : t)));
    const { error } = await supabase.from("tasks").update(fields).eq("id", id);
    if (error) { toast.error("Could not save change: " + error.message); load(); }
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

  // Open a task requested from a notification or global search, once tasks have
  // loaded — and switch the rail to that task's project so the context behind the
  // drawer is correct (not whichever project happened to be selected before).
  useEffect(() => {
    if (!focusTaskId) return;
    const t = tasks.find((x) => x.id === focusTaskId);
    if (!t) return;
    setActiveProjectId(t.project_id);
    handleOpenTask(focusTaskId);
    onTaskFocused && onTaskFocused();
  }, [focusTaskId, tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  async function doDeleteTask(id) {
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) { toast.error("Couldn't delete task — " + error.message); return; }
    setOpenTaskId(null);
    toast.success("Task deleted");
    load();
  }
  function deleteTask(id) {
    setConfirmState({
      title: "Delete task?",
      message: "Are you sure you want to delete this task? This cannot be undone.",
      confirmLabel: "Delete task",
      onConfirm: () => doDeleteTask(id),
    });
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

  if (loading) return <ProjectsSkeleton />;

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

  const sortedProjects = [...projects].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const railProjects = sortedProjects.filter((p) =>
    (p.name || "").toLowerCase().includes(railSearch.trim().toLowerCase()));
  const activeProject = projects.find((p) => p.id === activeProjectId) || sortedProjects[0] || null;
  const activeRaw = activeProject ? tasks.filter((t) => t.project_id === activeProject.id) : [];
  const activeVis = activeProject ? sortTasks(visibleTasksFor(activeProject, activeRaw)) : [];
  const activeProgress = { done: activeRaw.filter((t) => (t.status || "To do") === "Done").length, total: activeRaw.length };

  const renderRailItem = (p) => {
    return (
      <button key={p.id}
        className={"proj-rail-item" + (activeProject && p.id === activeProject.id ? " on" : "") + (dragOverProject === p.id ? " drop" : "")}
        onClick={() => { setActiveProjectId(p.id); setMobilePickerOpen(false); }}
        onDragOver={canEdit ? (e) => { if (draggingTaskId) { e.preventDefault(); setDragOverProject(p.id); } } : undefined}
        onDragLeave={() => setDragOverProject((d) => (d === p.id ? null : d))}
        onDrop={canEdit ? (e) => { e.preventDefault(); if (draggingTaskId) moveTaskToProject(draggingTaskId, p.id); setDragOverProject(null); } : undefined}
      >
        <span className="pri-name">{p.name}</span>
      </button>
    );
  };

  const newProjectForm = (
    <form className="proj-rail-newform" onSubmit={saveProject}>
      <input ref={newProjRef} className="proj-rail-newinput" value={newProjectName}
        onChange={(e) => setNewProjectName(e.target.value)} placeholder="Project name…" autoFocus
        onBlur={saveProject} onKeyDown={(e) => e.key === "Escape" && setAddingProject(false)} />
    </form>
  );

  const toolbar = (
    <div className="toolbar">
      <input className="search-input" type="search" placeholder="Search tasks in this project…"
        value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="filter-wrap" ref={filterRef}>
        <button className={"filter-trigger" + (activeFilterCount > 0 ? " active" : "") + (filterOpen ? " open" : "")}
          onClick={() => setFilterOpen((v) => !v)} aria-expanded={filterOpen} title="Filter & sort">
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
                {TASK_STATUSES.map((st) => (<option key={st} value={st}>{st}</option>))}
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
            <button className={"filter-mine" + (mineOnly ? " on" : "")} onClick={() => setMineOnly((v) => !v)} aria-pressed={mineOnly}>
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
            {activeFilterCount > 0 && (<button className="filter-clear" onClick={clearFilters}>Clear filters</button>)}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="projects proj-railed">
      {projects.length > 0 && (
        <div className="proj-mobile-nav">
          <button className="proj-mobile-pick" onClick={() => setMobilePickerOpen((o) => !o)}>
            <span className="lbl">{activeProject ? activeProject.name : "Select a project"}</span>
            <span className="chev" aria-hidden="true">▾</span>
          </button>
          {mobilePickerOpen && (
            <div className="proj-mobile-drop">
              {sortedProjects.map(renderRailItem)}
              {canEdit && !addingProject && (
                <button className="proj-rail-new" onClick={() => { setMobilePickerOpen(false); setAddingProject(true); }}>+ New project</button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="proj-layout">
        <aside className="proj-rail">
          <div className="proj-rail-head">Projects</div>
          <input className="proj-rail-search" type="search" placeholder="Search projects…"
            value={railSearch} onChange={(e) => setRailSearch(e.target.value)} />
          <div className="proj-rail-list">
            {railProjects.length === 0
              ? <div className="proj-rail-empty">No matches</div>
              : railProjects.map(renderRailItem)}
          </div>
          {canEdit && (addingProject ? newProjectForm : (
            <button className="proj-rail-new" onClick={() => setAddingProject(true)}>+ New project</button>
          ))}
        </aside>

        <div className="proj-main">
          {toolbar}
          {projects.length === 0 ? (
            <div className="empty">
              <p className="empty-title">No projects yet</p>
              <p className="muted">{canEdit ? "Create your first project in the list to start adding tasks." : "You haven't been added to any projects yet."}</p>
            </div>
          ) : !activeProject ? (
            <div className="empty"><p className="muted">Pick a project from the list.</p></div>
          ) : (
            <ProjectGroup
              solo
              key={activeProject.id}
              project={activeProject}
              tasks={activeVis}
              users={users}
              userEmail={userEmail}
              canEdit={canEdit}
              progress={activeProgress}
              selected={selProjects.has(activeProject.id)}
              onToggleSelect={toggleProject}
              selectedTasks={selTasks}
              onToggleTask={toggleTask}
              onUpdateName={updateProjectName}
              onAddTask={addTask}
              onAddTaskInline={addTaskInline}
              onOpenTask={handleOpenTask}
              onUpdateTask={updateTask}
              activity={activity}
              reads={reads}
              draggingTaskId={draggingTaskId}
              onDragTaskStart={setDraggingTaskId}
              onDragTaskEnd={() => { setDraggingTaskId(null); setDragOverProject(null); }}
              isDropTarget={false}
              onDragOverProject={setDragOverProject}
              onDropTask={moveTaskToProject}
            />
          )}
        </div>
      </div>

      {openTask && (
        <TaskDrawer
          key={openTask.id}
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
        <div className="overlay" onClick={() => setPendingDelete(null)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Delete {pendingDelete.total} item{pendingDelete.total === 1 ? "" : "s"}?</h2>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to delete {pendingDelete.total === 1 ? "this item" : "these items"}? This cannot be undone.</p>
            </div>
            <div className="modal-foot">
              <button className="btn-ghost" onClick={() => setPendingDelete(null)}>Cancel</button>
              <button className="btn-danger" onClick={confirmDeleteNow}>Delete {pendingDelete.total === 1 ? "item" : "items"}</button>
            </div>
          </div>
        </div>
      )}
      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}

function fileIcon(name = "") {
  const ext = name.split(".").pop().toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext)) return "photo";
  if (["xls", "xlsx", "csv", "numbers"].includes(ext)) return "spreadsheet";
  if (["pdf"].includes(ext)) return "pdf";
  if (["doc", "docx", "pages", "txt", "rtf"].includes(ext)) return "doc";
  return "file";
}
const fileIconSvg = {
  photo: "M4 5h16v14H4z M8 11l2 2 3-4 3 5H6z",
  spreadsheet: "M4 4h16v16H4z M4 9h16 M9 9v11 M15 9v11",
  pdf: "M6 3h9l3 3v15H6z M14 3v4h4",
  doc: "M6 3h9l3 3v15H6z M9 12h6 M9 16h6",
  file: "M6 3h9l3 3v15H6z",
};

function ProjectFiles({ tasks }) {
  const [entries, setEntries] = useState(null);
  const bucket = supabase.storage.from("task-images");
  const url = (p) => bucket.getPublicUrl(p).data.publicUrl;
  const titleOf = {};
  tasks.forEach((t) => { titleOf[t.id] = t.title; });

  useEffect(() => {
    const ids = tasks.map((t) => t.id);
    if (ids.length === 0) { setEntries([]); return; }
    supabase.from("task_posts").select("task_id, author, created_at, images, files")
      .in("task_id", ids).order("created_at", { ascending: false })
      .then(({ data }) => {
        const out = [];
        (data || []).forEach((p) => {
          (p.files || []).forEach((f) =>
            out.push({ name: f.name, path: f.path, author: p.author, date: p.created_at, task: titleOf[p.task_id] }));
          (p.images || []).forEach((path, i) =>
            out.push({ name: `Image ${i + 1}`, path, image: true, author: p.author, date: p.created_at, task: titleOf[p.task_id] }));
        });
        setEntries(out);
      });
  }, [tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  if (entries === null) return <div className="muted proj-files-loading">Loading files…</div>;
  if (entries.length === 0)
    return <div className="proj-files-empty">No files yet. Files attached to any task's updates show up here.</div>;

  return (
    <div className="proj-files">
      {entries.map((e, i) => {
        const ic = e.image ? "photo" : fileIcon(e.name);
        return (
          <a className="pf-card" key={i} href={url(e.path)} target="_blank" rel="noreferrer" title={`Download ${e.name}`}>
            <span className="pf-ic">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={fileIconSvg[ic]} />
              </svg>
            </span>
            <span className="pf-meta">
              <span className="pf-name">{e.name}</span>
              <span className="pf-sub">{displayName(e.author)} · {e.task || "—"} · {new Date(e.date).toLocaleDateString()}</span>
            </span>
            <svg className="pf-dl" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" />
            </svg>
          </a>
        );
      })}
    </div>
  );
}

function ProjectGroup({ project, tasks, users, userEmail, canEdit = true, solo = false, progress, selected, onToggleSelect, selectedTasks, onToggleTask, onUpdateName, onAddTask, onAddTaskInline, onOpenTask, onUpdateTask, activity, reads, draggingTaskId, onDragTaskStart, onDragTaskEnd, isDropTarget, onDragOverProject, onDropTask }) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(project.name);
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState("tasks"); // "tasks" | "files"
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const doneCount = tasks.filter((t) => (t.status || "To do") === "Done").length;
  const todayISO = new Date().toISOString().slice(0, 10);
  const overdueCount = tasks.filter((t) => t.due_date && t.due_date < todayISO && (t.status || "To do") !== "Done").length;
  const pct = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;

  function saveName() {
    setEditingName(false);
    onUpdateName(project.id, name);
  }


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
        {canEdit && (
          <input
            type="checkbox"
            className="proj-check"
            checked={selected}
            onChange={() => onToggleSelect(project.id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select project ${project.name}`}
          />
        )}
        <button className="proj-collapse" onClick={() => setCollapsed(!collapsed)} style={solo ? { display: "none" } : undefined}
          aria-label={collapsed ? "Expand" : "Collapse"}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round" style={{ transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform var(--dur-fast) var(--ease)" }} aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {editingName && canEdit ? (
          <input className="proj-name-input" value={name} autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") { setName(project.name); setEditingName(false); } }} />
        ) : (
          <span className="proj-name" title={canEdit ? "Double-click to rename" : undefined}
            onDoubleClick={canEdit ? () => setEditingName(true) : undefined}>{project.name}</span>
        )}
        <div className="proj-head-right">
          {(solo || !collapsed) && tasks.length > 0 && (
            <span className="proj-progress" title={`${doneCount} of ${tasks.length} done${overdueCount ? ` · ${overdueCount} overdue` : ""}`}>
              <span style={{ width: pct + "%" }} />
            </span>
          )}
          {canEdit && <ProjectMembers project={project} />}
        </div>
      </div>
      {(solo || !collapsed) && (
        <div className="proj-tabs">
          <button type="button" className={"proj-tab" + (tab === "tasks" ? " on" : "")} onClick={() => setTab("tasks")}>Tasks</button>
          <button type="button" className={"proj-tab" + (tab === "files" ? " on" : "")} onClick={() => setTab("files")}>Files</button>
        </div>
      )}
      {(solo || !collapsed) && tab === "files" && (
        <ProjectFiles tasks={tasks} />
      )}
      {(solo || !collapsed) && tab === "tasks" && (
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
                    canEdit={canEdit}
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
              {canEdit && (
                <tr className="add-item-row">
                  <td className="col-check"></td>
                  <td colSpan={4}>
                    {adding ? (
                      <input className="add-item-input" autoFocus value={newTitle}
                        placeholder="Task name, then Enter"
                        onChange={(e) => setNewTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const v = newTitle.trim();
                            if (v) { onAddTaskInline(project.id, v); setNewTitle(""); }
                          }
                          if (e.key === "Escape") { setAdding(false); setNewTitle(""); }
                        }}
                        onBlur={() => { if (!newTitle.trim()) setAdding(false); }} />
                    ) : (
                      <button className="add-item-btn" onClick={() => setAdding(true)}>
                        <span className="add-item-plus">+</span> Add a task…
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, users, userEmail, canEdit = true, checked, onToggle, onOpen, onUpdate, updates = 0, unread = false, dragging = false, onDragStart, onDragEnd }) {
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
      draggable={canEdit && !editingTitle}
      onDragStart={(e) => {
        if (!canEdit || editingTitle) return;
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", task.id); } catch {}
        onDragStart && onDragStart(task.id);
      }}
      onDragEnd={() => onDragEnd && onDragEnd()}
    >
      <td className="col-check" onClick={(e) => e.stopPropagation()}>
        {canEdit && (
          <input type="checkbox" checked={checked} onChange={() => onToggle(task.id)}
            aria-label={`Select task ${task.title}`} />
        )}
      </td>
      <td className="col-item">
        <div className="item-cell">
          {editingTitle && canEdit ? (
            <input className="task-title-input" value={title} autoFocus
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") { setTitle(task.title); setEditingTitle(false); } }} />
          ) : (
            <span className="task-title" title={canEdit ? "Double-click to rename" : undefined}
              onDoubleClick={canEdit ? (e) => { e.stopPropagation(); setEditingTitle(true); } : undefined}>{task.title}</span>
          )}
        </div>
      </td>
      <td className="col-person" onClick={(e) => e.stopPropagation()}>
        <MultiPersonPicker owners={owners} users={users} onToggle={toggleOwner} readOnly={!canEdit} />
      </td>
      <td className="col-status" onClick={(e) => e.stopPropagation()}>
        <StatusPicker value={task.status} onChange={(s) => onUpdate(task.id, { status: s })} readOnly={!canEdit} />
      </td>
      <td className={"col-date" + (dueState(task) ? " due-" + dueState(task) : "")} onClick={(e) => e.stopPropagation()}>
        {canEdit
          ? <DatePicker value={task.due_date || ""} onChange={(v) => onUpdate(task.id, { due_date: v || null })} placeholder="Set date" />
          : <span className="date-readonly">{task.due_date ? new Date(task.due_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</span>}
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

function StatusPicker({ value, onChange, readOnly }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const ref = useRef(null);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const current = value || "To do";
  const slug = (s) => s.toLowerCase().replace(/\s+/g, "-");

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && ref.current.contains(e.target)) return;
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setOpen(false);
    }
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
      let flip = false;
      if (top + PH > window.innerHeight - EDGE) {
        const up = r.top - GAP - PH;
        top = up >= EDGE ? up : Math.max(EDGE, window.innerHeight - PH - EDGE);
        flip = true;
      }
      setCoords({ top, left, width: r.width, flip });
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
      {readOnly ? (
        <span className={"tpill tpill-" + slug(current)}>{current}</span>
      ) : (
        <button type="button" ref={triggerRef} className={"tpill tpill-" + slug(current)}
          onClick={() => setOpen((o) => !o)}>
          {current}
        </button>
      )}
      {open && coords && !readOnly && createPortal(
        <div className="status-menu" ref={menuRef}
          style={{ position: "fixed", top: coords.top, left: coords.left, minWidth: coords.width, zIndex: 1000, transformOrigin: coords.flip ? "bottom left" : "top left" }}>
          {TASK_STATUSES.map((s) => (
            <button key={s} type="button"
              className={"status-option tpill-" + slug(s) + (s === current ? " is-current" : "")}
              onClick={() => { onChange(s); setOpen(false); }}>
              {s}
            </button>
          ))}
        </div>, document.body)}
    </div>
  );
}

function MultiPersonPicker({ owners, users, onToggle, readOnly }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const ref = useRef(null);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && ref.current.contains(e.target)) return;
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setOpen(false);
    }
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
      let flip = false;
      if (top + PH > window.innerHeight - EDGE) {
        const up = r.top - GAP - PH;
        top = up >= EDGE ? up : Math.max(EDGE, window.innerHeight - PH - EDGE);
        flip = true;
      }
      setCoords({ top, left, flip });
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
      <div className="person-avatars" ref={triggerRef}
        onClick={readOnly ? undefined : () => setOpen(!open)}
        style={readOnly ? { cursor: "default" } : undefined}>
        {owners.length === 0
          ? <span className="not-assigned">Not Assigned</span>
          : owners.map(e => (
            <Avatar key={e} email={e} size="sm" />
          ))
        }
        {!readOnly && <span className="assign-caret">▾</span>}
      </div>
      {open && coords && !readOnly && createPortal(
        <div className="person-dropdown" ref={menuRef} style={{ position: "fixed", top: coords.top, left: coords.left, zIndex: 1000, transformOrigin: coords.flip ? "bottom left" : "top left" }}>
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
        </div>, document.body)}
    </div>
  );
}

// Per-project access: shows the guests on a project and lets internal users add
// (via the secure invite function) or remove them. Panel is position:fixed so
// it escapes the project card's overflow clipping (same trick as StatusPicker).
function ProjectMembers({ project }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const [members, setMembers] = useState(null); // null = loading
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("project_members")
      .select("member_email, created_at")
      .eq("project_id", project.id)
      .order("created_at");
    setMembers(data || []);
  }, [project.id]);

  useEffect(() => { if (open && members === null) load(); }, [open, members, load]);

  useEffect(() => {
    function onDown(e) {
      if (btnRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const PW = 280, PH = 260, GAP = 6, EDGE = 8;
    let left = Math.max(EDGE, r.right - PW);
    let top = r.bottom + GAP;
    let flip = false;
    if (top + PH > window.innerHeight - EDGE) { top = Math.max(EDGE, r.top - PH - GAP); flip = true; }
    setCoords({ top, left, flip });
  }, [open, members]);

  async function addMember() {
    const addr = email.trim().toLowerCase();
    if (!addr || !addr.includes("@")) { toast.error("Enter a valid email address."); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("invite-user", {
      body: { email: addr, scope: "project", projectId: project.id },
    });
    setBusy(false);
    if (error || data?.error) { toast.error(data?.error || error?.message || "Could not add them."); return; }
    toast.success(data?.alreadyExisted ? `${addr} added to this project` : `Invite sent to ${addr}`);
    setEmail("");
    load();
  }

  async function doRemoveMember(memberEmail) {
    const { error } = await supabase.from("project_members").delete()
      .eq("project_id", project.id).eq("member_email", memberEmail);
    if (error) { toast.error("Could not remove: " + error.message); return; }
    toast.success("Access removed");
    load();
  }
  function removeMember(memberEmail) {
    setConfirmState({
      title: "Remove access?",
      message: `Remove ${memberEmail} from "${project.name}"? They'll lose access to this project.`,
      confirmLabel: "Remove",
      onConfirm: () => doRemoveMember(memberEmail),
    });
  }

  const count = members?.length ?? 0;

  return (
    <div className="proj-members">
      <button type="button" ref={btnRef} className="proj-members-btn"
        onClick={() => setOpen((o) => !o)} title="Manage who can see this project">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        Members{count ? ` · ${count}` : ""}
      </button>

      {open && coords && (
        <div className="members-panel" ref={panelRef}
          style={{ position: "fixed", top: coords.top, left: coords.left, transformOrigin: coords.flip ? "bottom right" : "top right" }}
          onClick={(e) => e.stopPropagation()}>
          <div className="members-panel-head">Guests on this project</div>

          {members === null ? (
            <p className="muted members-empty">Loading…</p>
          ) : members.length === 0 ? (
            <p className="muted members-empty">No guests yet. Add someone below — they'll see only this project.</p>
          ) : (
            <ul className="members-list">
              {members.map((m) => (
                <li key={m.member_email}>
                  <span className="members-email" title={m.member_email}>{m.member_email}</span>
                  <button className="members-remove" onClick={() => removeMember(m.member_email)}
                    aria-label={`Remove ${m.member_email}`}>×</button>
                </li>
              ))}
            </ul>
          )}

          <div className="members-add">
            <input type="email" placeholder="person@company.com" value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMember(); } }} />
            <button className="btn-accent" onClick={addMember} disabled={busy}>{busy ? "…" : "Add"}</button>
          </div>
        </div>
      )}
      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}
