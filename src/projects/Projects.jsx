import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "../supabaseClient";
import { TASK_STATUSES, statusClass } from "./constants";
import { useUsers } from "./useUsers";
import TaskDrawer from "./TaskDrawer";
import { notifyAssignment } from "./notifications";
import { displayName, nameInitials } from "./userMap";
import DatePicker from "../components/DatePicker";

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

  async function deleteProject(id) {
    if (!confirm("Delete this project and all its tasks?")) return;
    await supabase.from("projects").delete().eq("id", id);
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

  if (loading) return <div className="muted pad">Loading projects…</div>;

  const openTask = tasks.find((t) => t.id === openTaskId) || null;
  const openProject = openTask ? projects.find(p => p.id === openTask.project_id) : null;

  // --- Search + filter --------------------------------------------------------
  const q = query.trim().toLowerCase();
  const anyActive = !!q || !!filterPerson || !!filterStatus;

  function visibleTasksFor(project, projTasks) {
    const nameHit = !!q && (project.name || "").toLowerCase().includes(q);
    return projTasks.filter((t) => {
      const personOK = !filterPerson || (t.owners || []).includes(filterPerson);
      const statusOK = !filterStatus || (t.status || "To do") === filterStatus;
      const searchOK = !q || nameHit || (t.title || "").toLowerCase().includes(q);
      return personOK && statusOK && searchOK;
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
      else if (nameHit && !filterPerson && !filterStatus) show = true;
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
        {anyActive && (
          <button className="link" onClick={() => { setQuery(""); setFilterPerson(""); setFilterStatus(""); }}>
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
          <button className="btn-accent" onClick={() => { setQuery(""); setFilterPerson(""); setFilterStatus(""); }}>
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
                onUpdateName={updateProjectName}
                onDelete={deleteProject}
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
    </div>
  );
}

function ProjectGroup({ project, tasks, users, userEmail, onUpdateName, onDelete, onAddTask, onOpenTask, onUpdateTask }) {
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
        <button className="proj-collapse" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? "▶" : "▼"}
        </button>
        {editingName ? (
          <input className="proj-name-input" value={name} autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") { setName(project.name); setEditingName(false); } }} />
        ) : (
          <span className="proj-name" onDoubleClick={() => setEditingName(true)}>{project.name}</span>
        )}
        <span className="proj-count">{tasks.length} {tasks.length === 1 ? "item" : "items"}</span>
        <div className="proj-actions">
          <button className="link danger" onClick={() => onDelete(project.id)}>Delete</button>
        </div>
      </div>
      {!collapsed && (
        <div className="ptable-wrap">
          <table className="ptable">
            <thead>
              <tr>
                <th>Item</th>
                <th className="col-person">Person</th>
                <th className="col-status">Status</th>
                <th className="col-date">Date</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <TaskRow key={t.id} task={t} users={users} userEmail={userEmail}
                  onOpen={() => onOpenTask(t.id)}
                  onUpdate={onUpdateTask} />
              ))}
              <tr className="add-item-row">
                <td colSpan={4}>
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

function TaskRow({ task, users, userEmail, onOpen, onUpdate }) {
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
    <tr className="ptask-row" onClick={!editingTitle ? onOpen : undefined}>
      <td className="col-item">
        {editingTitle ? (
          <input className="task-title-input" value={title} autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") { setTitle(task.title); setEditingTitle(false); } }} />
        ) : (
          <span className="task-title" onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true); }}>{task.title}</span>
        )}
      </td>
      <td className="col-person" onClick={(e) => e.stopPropagation()}>
        <MultiPersonPicker owners={owners} users={users} onToggle={toggleOwner} />
      </td>
      <td className="col-status" onClick={(e) => e.stopPropagation()}>
        <select className={statusClass(task.status)} value={task.status || "To do"}
          onChange={(e) => onUpdate(task.id, { status: e.target.value })}>
          {TASK_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </td>
      <td className="col-date" onClick={(e) => e.stopPropagation()}>
        <DatePicker value={task.due_date || ""} onChange={(v) => onUpdate(task.id, { due_date: v || null })} placeholder="Set date" />
      </td>
    </tr>
  );
}

function MultiPersonPicker({ owners, users, onToggle }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClickOutside(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div className="multi-person" ref={ref}>
      <div className="person-avatars" onClick={() => setOpen(!open)}>
        {owners.length === 0
          ? <span className="not-assigned">Not Assigned</span>
          : owners.map(e => (
            <span key={e} className="avatar sm" title={displayName(e)}>{nameInitials(e)}</span>
          ))
        }
        <span className="assign-caret">▾</span>
      </div>
      {open && (
        <div className="person-dropdown">
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

function initials(name) {
  if (!name) return "?";
  const parts = name.replace(/@.*/, "").split(/[.\s_]+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || name[0]?.toUpperCase();
}
