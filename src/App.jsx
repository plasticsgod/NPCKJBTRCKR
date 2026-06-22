import { useEffect, useState, useCallback } from "react";
import { supabase } from "./supabaseClient";
import Auth from "./components/Auth";
import Header from "./components/Header";
import JobTable from "./components/JobTable";
import JobBoard from "./components/JobBoard";
import JobModal from "./components/JobModal";

export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("table"); // "table" | "board"
  const [editing, setEditing] = useState(null); // job being edited, or {} for new, or null
  const [query, setQuery] = useState("");

  // --- Auth: track who is signed in -------------------------------------------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // --- Load jobs --------------------------------------------------------------
  const loadJobs = useCallback(async () => {
    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) console.error("Could not load jobs:", error.message);
    else setJobs(data ?? []);
    setLoading(false);
  }, []);

  // --- Live updates: refresh when any teammate changes a job ------------------
  useEffect(() => {
    if (!session) return;
    loadJobs();
    const channel = supabase
      .channel("jobs-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, loadJobs)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadJobs]);

  // --- Create / update / delete ----------------------------------------------
  async function saveJob(job) {
    if (job.id) {
      const { id, created_at, ...fields } = job;
      const { error } = await supabase.from("jobs").update(fields).eq("id", id);
      if (error) return alert("Could not save changes: " + error.message);
    } else {
      const { error } = await supabase.from("jobs").insert(job);
      if (error) return alert("Could not create the job: " + error.message);
    }
    setEditing(null);
    loadJobs();
  }

  async function deleteJob(id) {
    if (!confirm("Delete this job? This cannot be undone.")) return;
    const { error } = await supabase.from("jobs").delete().eq("id", id);
    if (error) return alert("Could not delete: " + error.message);
    loadJobs();
  }

  async function changeStatus(id, status) {
    const { error } = await supabase.from("jobs").update({ status }).eq("id", id);
    if (error) alert("Could not update status: " + error.message);
    else loadJobs();
  }

  // --- Filter by brand (search) ----------------------------------------------
  const q = query.trim().toLowerCase();
  const filtered = q
    ? jobs.filter((j) => (j.brand || "").toLowerCase().includes(q))
    : jobs;

  // --- Render -----------------------------------------------------------------
  if (!authReady) return <div className="screen-center muted">Loading…</div>;
  if (!session) return <Auth />;

  return (
    <div className="app">
      <Header
        count={jobs.length}
        view={view}
        onView={setView}
        email={session.user.email}
        onNew={() => setEditing({})}
        onSignOut={() => supabase.auth.signOut()}
      />

      <main className="main">
        {loading ? (
          <div className="muted pad">Loading jobs…</div>
        ) : jobs.length === 0 ? (
          <div className="empty">
            <p className="empty-title">No jobs yet</p>
            <p className="muted">Add your first job to get the board going.</p>
            <button className="btn-accent" onClick={() => setEditing({})}>
              + New Job
            </button>
          </div>
        ) : (
          <>
            <div className="searchbar">
              <input
                className="search-input"
                type="search"
                placeholder="Search by brand…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {q && (
                <span className="search-count">
                  {filtered.length} {filtered.length === 1 ? "match" : "matches"}
                </span>
              )}
            </div>

            {filtered.length === 0 ? (
              <div className="empty">
                <p className="empty-title">No matches</p>
                <p className="muted">No jobs have a brand matching “{query}”.</p>
              </div>
            ) : view === "table" ? (
              <JobTable jobs={filtered} onEdit={setEditing} onDelete={deleteJob} />
            ) : (
              <JobBoard jobs={filtered} onEdit={setEditing} onStatus={changeStatus} />
            )}
          </>
        )}
      </main>

      {editing !== null && (
        <JobModal
          job={editing}
          onSave={saveJob}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
