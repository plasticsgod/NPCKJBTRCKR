import { useEffect, useState, useCallback } from "react";
import { supabase } from "./supabaseClient";
import Auth from "./components/Auth";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import WorkOrders from "./components/WorkOrders";
import PlasticWorkOrders from "./components/PlasticWorkOrders";
import Dashboard from "./components/Dashboard";
import PlasticsEstimator from "./components/PlasticsEstimator";
import PlasticQuotes from "./components/PlasticQuotes";
import { DashboardSkeleton, WorkOrdersSkeleton } from "./components/Skeletons";
import Projects from "./projects/Projects";
import JobModal from "./components/JobModal";
import PlasticJobModal from "./components/PlasticJobModal";
import { Toaster, toast } from "./components/Toaster";
import SearchOverlay from "./components/SearchOverlay";

const PAGES = ["dashboard", "work_orders", "plastic_work_orders", "projects", "plastics", "plastic_quotes"];

// Instant client-side check for the core team (matches the SQL allowlist) so
// they never see a flash; invited "members" are confirmed via RPC below.
const KNOWN_INTERNAL = [
  "eduardonutramedia@gmail.com",
  "jeff.weisser@nutrapack.co",
  "taylor.knox@nutrapack.co",
  "cc@nutramedia.co",
];

function getPageFromHash() {
  const h = window.location.hash.replace("#", "");
  return PAGES.includes(h) ? h : "dashboard";
}

// Invite and password-reset emails land back here with a #type=invite (or
// recovery) token — in both cases we want the "set a password" screen.
function isAuthActionHash() {
  const p = new URLSearchParams(window.location.hash.replace("#", ""));
  const t = p.get("type");
  return t === "recovery" || t === "invite";
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [recovery, setRecovery] = useState(isAuthActionHash);
  const [isInternal, setIsInternal] = useState(false);

  const [jobs, setJobs] = useState([]);
  const [plasticJobs, setPlasticJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [editingPlastic, setEditingPlastic] = useState(null);
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

  // Decide what the signed-in person can see. Core team is known instantly;
  // invited "members" (full access) are confirmed via the same rule RLS uses.
  useEffect(() => {
    if (!session) { setIsInternal(false); return; }
    const email = (session.user.email || "").toLowerCase();
    const known = KNOWN_INTERNAL.includes(email);
    setIsInternal(known);
    supabase.rpc("app_is_internal").then(({ data, error }) => {
      if (!error && typeof data === "boolean") setIsInternal(known || data);
    });
  }, [session]);

  // --- Browser-tab title reflects the current page ---------------------------
  useEffect(() => {
    const names = {
      dashboard: "Dashboard",
      work_orders: "Label Work Orders",
      plastic_work_orders: "Plastics Work Orders",
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

  // --- Plastics work orders (separate table, no Sttark) -----------------------
  const loadPlasticJobs = useCallback(async () => {
    const { data, error } = await supabase
      .from("plastic_jobs")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) console.error("Could not load plastic jobs:", error.message);
    else setPlasticJobs(data ?? []);
  }, []);

  useEffect(() => {
    if (!session) return;
    loadPlasticJobs();
    const channel = supabase
      .channel("plastic-jobs-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "plastic_jobs" }, loadPlasticJobs)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadPlasticJobs]);

  // --- Create / update / delete ----------------------------------------------
  async function saveJob(job) {
    if (job.id) {
      const { id, created_at, ...fields } = job;
      const { error } = await supabase.from("jobs").update(fields).eq("id", id);
      if (error) return toast.error("Could not save changes: " + error.message);
      setEditing(null);
      toast.success("Work order saved");
    } else {
      const { data, error } = await supabase.from("jobs").insert(job).select().single();
      if (error) return toast.error("Could not create the job: " + error.message);
      // Keep the modal open in edit mode so Proofs & Artwork become available now.
      setEditing(data);
      toast.success("Job created — you can now add proofs & artwork");
    }
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
    toast.success(ids.length > 1 ? `${ids.length} work orders deleted` : "Work order deleted");
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

  // --- Plastics: save / delete (mirrors jobs, separate table) -----------------
  async function savePlasticJob(job) {
    if (job.id) {
      const { id, created_at, ...fields } = job;
      const { error } = await supabase.from("plastic_jobs").update(fields).eq("id", id);
      if (error) return toast.error("Could not save changes: " + error.message);
      toast.success("Plastics order saved");
    } else {
      const { error } = await supabase.from("plastic_jobs").insert({ ...job, created_by: session.user.email });
      if (error) return toast.error("Could not create the order: " + error.message);
      toast.success("Plastics order created");
    }
    setEditingPlastic(null);
    loadPlasticJobs();
  }

  async function deletePlasticJobs(ids) {
    const { error } = await supabase.from("plastic_jobs").delete().in("id", ids);
    if (error) return toast.error("Could not delete: " + error.message);
    toast.success(ids.length > 1 ? `${ids.length} orders deleted` : "Order deleted");
    loadPlasticJobs();
  }

  // Plastics customers are derived only from plastic_jobs — kept separate from labels.
  const plasticCustomers = [...new Set(plasticJobs.map((j) => j.brand).filter(Boolean))].sort();

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
      {/* Guests only ever see Projects — pin the page and menu regardless of hash. */}
      <Header
        page={isInternal ? page : "projects"}
        email={session.user.email}
        canInvite={isInternal}
        onMenu={() => setNavOpen(true)}
        onSignOut={() => supabase.auth.signOut()}
        onSearch={() => setSearchOpen(true)}
        onOpenTask={openTaskFromSearch}
      />

      <Sidebar
        open={navOpen}
        page={isInternal ? page : "projects"}
        isInternal={isInternal}
        onClose={() => setNavOpen(false)}
        onNavigate={(p) => {
          setPage(p);
          setNavOpen(false);
        }}
      />

      <main className="main">
        {!isInternal ? (
          <Projects
            userEmail={session.user.email}
            focusTaskId={focusTaskId}
            onTaskFocused={() => setFocusTaskId(null)}
            canEdit={isInternal}
          />
        ) : page === "plastics" ? (
          <PlasticsEstimator userEmail={session.user.email} />
        ) : page === "plastic_quotes" ? (
          <PlasticQuotes />
        ) : page === "plastic_work_orders" ? (
          <PlasticWorkOrders
            jobs={plasticJobs}
            customers={plasticCustomers}
            onNew={() => setEditingPlastic({})}
            onEdit={setEditingPlastic}
            onDeleteMany={deletePlasticJobs}
          />
        ) : page === "projects" ? (
          <Projects
            userEmail={session.user.email}
            focusTaskId={focusTaskId}
            onTaskFocused={() => setFocusTaskId(null)}
            canEdit={isInternal}
          />
        ) : loading ? (
          page === "dashboard" ? <DashboardSkeleton /> : <WorkOrdersSkeleton />
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
          key={editing.id || "new"}
          job={editing}
          customers={customers}
          onSave={saveJob}
          onClose={() => setEditing(null)}
        />
      )}

      {editingPlastic !== null && (
        <PlasticJobModal
          job={editingPlastic}
          customers={plasticCustomers}
          onSave={savePlasticJob}
          onClose={() => setEditingPlastic(null)}
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
