import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { TASK_STATUSES, TASK_PRIORITIES, statusClass, priorityClass } from "./constants";
import TaskDrawer from "./TaskDrawer";

export default function Projects({ userEmail }) {
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openTaskId, setOpenTaskId] = useState(null);

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
      .channel("projects-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [load]);

  async function addProject() {
    const name = prompt("New project name:");
    if (!name?.trim()) return;
    await supabase.from("projects").insert({ name: name.trim(), sort_order: projects.length });
    load();
  }

  async function addTask(projectId) {
    const title = prompt("New task:");
    if (!title?.trim()) return;
    await supabase.from("tasks").insert({ project_id: projectId, title: title.trim() });
    load();
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

  async function deleteProject(id) {
    if (!confirm("Delete this project and all its tasks?")) return;
    await supabase.from("projects").delete().eq("id", id);
    load();
  }

  if (loading) return <div className="muted pad">Loading projects…</div>;

  const openTask = tasks.find((t) => t.id === openTaskId) || null;

  return (
    <div className="projects">
      <div className="toolbar">
        <span className="count">{projects.length} {projects.length === 1 ? "project" : "projects"}</span>
        <button className="btn-accent push-right" onClick={addProject}>+ New Project</button>
      </div>

      {projects.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No projects yet</p>
          <p className="muted">Create your first project to start adding tasks.</p>
          <button className="btn-accent" onClick={addProject}>+ New Project</button>
        </div>
      ) : (
        projects.map((proj) => {
          const projTasks = tasks.filter((t) => t.project_id === proj.id);
          return (
            <div className="proj-group" key={proj.id}>
              <div className="proj-head">
                <span className="proj-name">{proj.name}</span>
                <span className="proj-count">{projTasks.length} {projTasks.length === 1 ? "task" : "tasks"}</span>
                <div className="proj-actions">
                  <button className="link" onClick={() => addTask(proj.id)}>+ Task</button>
                  <button className="link danger" onClick={() => deleteProject(proj.id)}>Delete</button>
                </div>
              </div>

              {projTasks.length > 0 && (
                <div className="ptable-wrap">
                  <table className="ptable">
                    <thead>
                      <tr><th>Task</th><th>Owner</th><th>Status</th><th>Priority</th><th>Due</th></tr>
                    </thead>
                    <tbody>
                      {projTasks.map((t) => (
                        <tr key={t.id} className="row" onClick={() => setOpenTaskId(t.id)}>
                          <td className="cell-title">{t.title}</td>
                          <td>{t.owner ? <span className="avatar">{initials(t.owner)}</span> : "—"}</td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <select className={statusClass(t.status)} value={t.status}
                              onChange={(e) => updateTask(t.id, { status: e.target.value })}>
                              {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <select className={priorityClass(t.priority)} value={t.priority}
                              onChange={(e) => updateTask(t.id, { priority: e.target.value })}>
                              {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                          </td>
                          <td className="cell-date">{t.due_date || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })
      )}

      {openTask && (
        <TaskDrawer
          task={openTask}
          userEmail={userEmail}
          onClose={() => setOpenTaskId(null)}
          onUpdate={updateTask}
          onDelete={deleteTask}
        />
      )}
    </div>
  );
}

function initials(name) {
  const parts = name.replace(/@.*/, "").split(/[.\s_]+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || name[0]?.toUpperCase();
}
