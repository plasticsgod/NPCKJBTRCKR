import { useEffect, useState, useCallback } from "react";
import { supabase } from "./supabaseClient";
import Auth from "./components/Auth";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import WorkOrders from "./components/WorkOrders";
import Dashboard from "./components/Dashboard";
import PlasticsEstimator from "./components/PlasticsEstimator";
import PlasticQuotes from "./components/PlasticQuotes";
import Projects from "./projects/Projects";
import JobModal from "./components/JobModal";
import { Toaster, toast } from "./components/Toaster";
import SearchOverlay from "./components/SearchOverlay";

const PAGES = ["dashboard", "work_orders", "projects", "plastics", "plastic_quotes"];

function getPageFromHash() {
  const h = window.location.hash.replace("#", "");
  return PAGES.includes(h) ? h : "dashboard";
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [recovery, setRecovery] = useState(false);

  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [page, setPageState] = useState(getPageFromHash);
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusTaskId, setFocusTaskId] = useState(null);

  function setPage(p) {
    setPageState(p);
    window.location.hash = p;
  }

  // Keep page in sync if user presses browser back/forward
  useEffect(() => {
    function onHashChange() { setPageState(getPageFromHash()); }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // ⌘K / Ctrl+K opens global search from anywhere.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Search result handlers: close the palette and open the item on its page.
  function openTaskFromSearch(taskId) {
    setSearchOpen(false);
    setPage("projects");
    setFocusTaskId(taskId);
  }
  function openJobFromSearch(job) {
    setSearchOpen(false);
    setPage("work_orders");
    setEditing(job);
  }
  function openProjectFromSearch() {
    setSearchOpen(false);
    setPage("projects");
  }

  // --- Auth -------------------------------------------------------------------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Arriving via a password-reset email link: show the "set new password"
      // form instead of dropping the user straight into the app.
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // --- Browser-tab title reflects the current page ---------------------------
  useEffect(() => {
    const names = {
      dashboard: "Dashboard",
      work_orders: "Work Orders",
      plastics: "Plastics Estimator",
      plastic_quotes: "Plastic Quotes",
      projects: "Projects",
    };
    document.title = `${names[page] || "NutraPack"} · NutraPack App`;
  }, [page]);

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

  // --- Live updates -----------------------------------------------------------
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
      if (error) return toast.error("Could not save changes: " + error.message);
    } else {
      const { error } = await supabase.from("jobs").insert(job);
      if (error) return toast.error("Could not create the job: " + error.message);
    }
    setEditing(null);
    loadJobs();
  }

  async function deleteJob(id) {
    if (!confirm("Delete this job? This cannot be undone.")) return;
    const { error } = await supabase.from("jobs").delete().eq("id", id);
    if (error) return toast.error("Could not delete: " + error.message);
    loadJobs();
  }

  // Bulk delete (the Work Orders page shows its own confirm popup first)
  async function deleteJobs(ids) {
    const { error } = await supabase.from("jobs").delete().in("id", ids);
    if (error) return toast.error("Could not delete: " + error.message);
    loadJobs();
  }

  async function changeStatus(id, status) {
    const { error } = await supabase.from("jobs").update({ status }).eq("id", id);
    if (error) toast.error("Could not update status: " + error.message);
    else loadJobs();
  }

  async function changeFacility(id, printing_facility) {
    const { error } = await supabase.from("jobs").update({ printing_facility }).eq("id", id);
    if (error) toast.error("Could not update facility: " + error.message);
    else loadJobs();
  }

  // List of existing customers (for the combobox dropdown)
  const customers = [...new Set(jobs.map((j) => j.brand).filter(Boolean))].sort();

  // --- Render -----------------------------------------------------------------
  if (!authReady) return <div className="screen-center muted">Loading…</div>;
  if (recovery)
    return (
      <Auth
        recovery
        onRecovered={() => {
          setRecovery(false);
          // Clean the recovery token out of the URL and land on the dashboard.
          window.location.hash = "dashboard";
        }}
      />
    );
  if (!session) return <Auth />;

  return (
    <div className="app">
      <Header
        page={page}
        email={session.user.email}
        onMenu={() => setNavOpen(true)}
        onSignOut={() => supabase.auth.signOut()}
        onSearch={() => setSearchOpen(true)}
      />

      <Sidebar
        open={navOpen}
        page={page}
        onClose={() => setNavOpen(false)}
        onNavigate={(p) => {
          setPage(p);
          setNavOpen(false);
        }}
      />

      <main className="main">
        {page === "plastics" ? (
          <PlasticsEstimator userEmail={session.user.email} />
        ) : page === "plastic_quotes" ? (
          <PlasticQuotes />
        ) : page === "projects" ? (
          <Projects
            userEmail={session.user.email}
            focusTaskId={focusTaskId}
            onTaskFocused={() => setFocusTaskId(null)}
          />
        ) : loading ? (
          <div className="muted pad">Loading…</div>
        ) : page === "dashboard" ? (
          <Dashboard jobs={jobs} />
        ) : (
          <WorkOrders
            jobs={jobs}
            customers={customers}
            onNew={() => setEditing({})}
            onEdit={setEditing}
            onDeleteMany={deleteJobs}
            onStatus={changeStatus}
            onFacility={changeFacility}
          />
        )}
      </main>

      {editing !== null && (
        <JobModal
          job={editing}
          customers={customers}
          onSave={saveJob}
          onClose={() => setEditing(null)}
        />
      )}

      <Toaster />

      {searchOpen && (
        <SearchOverlay
          jobs={jobs}
          onClose={() => setSearchOpen(false)}
          onOpenTask={openTaskFromSearch}
          onOpenJob={openJobFromSearch}
          onOpenProject={openProjectFromSearch}
        />
      )}
    </div>
  );
}
