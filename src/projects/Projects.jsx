import { useEffect, useState, useCallback, useRef, useLayoutEffect } from "react";
import { supabase } from "../supabaseClient";
import { TASK_STATUSES, statusClass } from "./constants";
import { useUsers } from "./useUsers";
import TaskDrawer from "./TaskDrawer";
import { notifyAssignment } from "./notifications";
import { displayName, nameInitials } from "./userMap";
import DatePicker from "../components/DatePicker";

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

export default function Projects({ userEmail }) {
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
  // Selection for the bottom action bar (Monday-style). Separate sets so a whole
  // project and individual tasks can both be selected at once.
  const [selProjects, setSelProjects] = useState(() => new Set());
  const [selTasks, setSelTasks] = useState(() => new Set());
  const [pendingDelete, setPendingDelete] = useState(null);
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

  useEffect(() => {
    load();
    const ch = supabase
      .channel("projects-v2")
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [load]);

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

  async function deleteTask(id) {
    if (!confirm("Delete this task?")) return;
    await supabase.from("tasks").delete().eq("id", id);
    setOpenTaskId(null);
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
    if (projIds.length) await supabase.from("projects").delete().in("id", projIds);
    if (taskIds.length) await supabase.from("tasks").delete().in("id", taskIds);
    setPendingDelete(null);
    clearSelection();
    setOpenTaskId(null);
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
    load();
  }

  if (loading) return <div className="muted pad">Loading projects…</div>;

  const openTask = tasks.find((t) => t.id === openTaskId) || null;
  const openProject = openTask ? projects.find(p => p.id === openTask.project_id) : null;

  // --- Search + filter --------------------------------------------------------
  const q = query.trim().toLowerCase();
  const anyActive = !!q || !!filterPerson || !!filterStatus || !!filterDue;

  function visibleTasksFor(project, projTasks) {
    const nameHit = !!q && (project.name || "").toLowerCase().includes(q);
    return projTasks.filter((t) => {
      const personOK = !filterPerson || (t.owners || []).includes(filterPerson);
      const statusOK = !filterStatus || (t.status || "To do") === filterStatus;
      const dueOK = !filterDue || dueState(t) === filterDue;
      const searchOK = !q || nameHit || (t.title || "").toLowerCase().includes(q);
      return personOK && statusOK && dueOK && searchOK;
    });
  }

  const visibleProjects = projects
    .map((proj) => {
      const projTasks = tasks.filter((t) => t.project_id === proj.id);
      const visTasks = visibleTasksFor(proj, projTasks);
      const nameHit = !!q && (proj.name || "").toLowerCase().includes(q);
      let show;
      if (!anyActive) show = true;
      else if (visTasks.length > 0) show = true;
      // a project whose name matches the search still shows (even if empty),
      // but only when no person/status filter is narrowing things down
      else if (nameHit && !filterPerson && !filterStatus && !filterDue) show = true;
      else show = false;
      return { proj, tasks: visTasks, show };
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
        <select
          className="filter-select"
          value={filterPerson}
          onChange={(e) => setFilterPerson(e.target.value)}
          aria-label="Filter by person"
        >
          <option value="">All people</option>
          {users.map((u) => (
            <option key={u} value={u}>{displayName(u)}</option>
          ))}
        </select>
        <select
          className="filter-select"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          className="filter-select"
          value={filterDue}
          onChange={(e) => setFilterDue(e.target.value)}
          aria-label="Filter by due date"
        >
          <option value="">Any due date</option>
          <option value="overdue">Overdue</option>
          <option value="soon">Due soon (3 days)</option>
        </select>
        {anyActive && (
          <button className="link" onClick={() => { setQuery(""); setFilterPerson(""); setFilterStatus(""); setFilterDue(""); }}>
            Clear
          </button>
        )}
        <button className="btn-accent push-right" onClick={() => setAddingProject(true)}>+ New Project</button>
      </div>

      {projects.length === 0 && !addingProject ? (
        <div className="empty">
          <p className="empty-title">No projects yet</p>
          <p className="muted">Create your first project to start adding tasks.</p>
          <button className="btn-accent" onClick={() => setAddingProject(true)}>+ New Project</button>
        </div>
      ) : anyActive && visibleProjects.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No matches</p>
          <p className="muted">No projects or tasks match your search and filters.</p>
          <button className="btn-accent" onClick={() => { setQuery(""); setFilterPerson(""); setFilterStatus(""); setFilterDue(""); }}>
            Clear search &amp; filters
          </button>
        </div>
      ) : (
        <div className="proj-list">
          {visibleProjects.map(({ proj, tasks: projTasks }) => {
            return (
              <ProjectGroup
                key={proj.id}
                project={proj}
                tasks={projTasks}
                users={users}
                userEmail={userEmail}
                selected={selProjects.has(proj.id)}
                onToggleSelect={toggleProject}
                selectedTasks={selTasks}
                onToggleTask={toggleTask}
                onUpdateName={updateProjectName}
                onAddTask={addTask}
                onOpenTask={setOpenTaskId}
                onUpdateTask={updateTask}
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
          onClose={() => setOpenTaskId(null)}
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

function ProjectGroup({ project, tasks, users, userEmail, selected, onToggleSelect, selectedTasks, onToggleTask, onUpdateName, onAddTask, onOpenTask, onUpdateTask }) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(project.name);
  const [collapsed, setCollapsed] = useState(false);

  function saveName() {
    setEditingName(false);
    onUpdateName(project.id, name);
  }

  return (
    <div className="proj-group">
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
              {tasks.map((t) => (
                <TaskRow key={t.id} task={t} users={users} userEmail={userEmail}
                  checked={selectedTasks.has(t.id)}
                  onToggle={onToggleTask}
                  onOpen={() => onOpenTask(t.id)}
                  onUpdate={onUpdateTask} />
              ))}
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

function TaskRow({ task, users, userEmail, checked, onToggle, onOpen, onUpdate }) {
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
      notifyAssignment({ to: email, task: task.title, project: "", assignedBy: userEmail });
    }
  }

  return (
    <tr className={"ptask-row" + (checked ? " selected" : "")} onClick={!editingTitle ? onOpen : undefined}>
      <td className="col-check" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={() => onToggle(task.id)}
          aria-label={`Select task ${task.title}`} />
      </td>
      <td className="col-item">
        {editingTitle ? (
          <input className="task-title-input" value={title} autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") { setTitle(task.title); setEditingTitle(false); } }} />
        ) : (
          <span className="task-title" title="Double-click to rename" onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true); }}>{task.title}</span>
        )}
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
            <span key={e} className="avatar sm" title={displayName(e)}>{nameInitials(e)}</span>
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
              <span className="avatar sm">{nameInitials(u)}</span>
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
