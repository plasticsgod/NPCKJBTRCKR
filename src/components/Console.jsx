import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { toast } from "./Toaster";

// Admin console. Gated in App (only the admin email routes here) AND by RLS on
// the tables it writes — so the UI gate is convenience, the DB is enforcement.
export default function Console() {
  const [facilities, setFacilities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");

  async function load() {
    const { data, error } = await supabase
      .from("printing_facilities")
      .select("*")
      .order("active", { ascending: false })
      .order("name");
    if (error) { toast.error("Couldn't load facilities."); setLoading(false); return; }
    setFacilities(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function addFacility(e) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setAdding(true);
    const { error } = await supabase.from("printing_facilities").insert({ name: n });
    setAdding(false);
    if (error) {
      toast.error(/duplicate|unique/i.test(error.message || "") ? "That facility already exists." : "Couldn't add facility.");
      return;
    }
    setName("");
    toast.success(`Added “${n}”`);
    load();
  }

  async function toggleActive(f) {
    const { error } = await supabase.from("printing_facilities").update({ active: !f.active }).eq("id", f.id);
    if (error) { toast.error("Couldn't update. Please try again."); return; }
    load();
  }

  function startRename(f) { setEditingId(f.id); setEditName(f.name); }
  async function saveRename(f) {
    const n = editName.trim();
    if (!n || n === f.name) { setEditingId(null); return; }
    const { error } = await supabase.from("printing_facilities").update({ name: n }).eq("id", f.id);
    if (error) {
      toast.error(/duplicate|unique/i.test(error.message || "") ? "That name is already taken." : "Couldn't rename.");
      return;
    }
    setEditingId(null);
    toast.success("Renamed");
    load();
  }

  return (
    <div className="page-card console-page">
      <div className="page-head">
        <div className="page-head-left">
          <h1 className="page-title">Console</h1>
          <span className="page-meta">Admin settings</span>
        </div>
      </div>

      <section className="console-section">
        <div className="console-section-head">
          <h2 className="console-h2">Printing facilities</h2>
          {!loading && facilities.length > 0 && (
            <span className="console-count">{facilities.filter((f) => f.active).length} active</span>
          )}
        </div>
        <p className="muted small console-note">
          These appear in the label work-order facility dropdown. Deactivate one to hide it from the dropdown without losing it from past orders.
        </p>

        <form className="console-add" onSubmit={addFacility}>
          <input
            className="pm-input console-add-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Add a printing facility…"
          />
          <button className="btn-accent" type="submit" disabled={adding || !name.trim()}>
            {adding ? "Adding…" : "Add facility"}
          </button>
        </form>

        {loading ? (
          <p className="muted">Loading…</p>
        ) : facilities.length === 0 ? (
          <div className="console-card"><p className="console-empty">No facilities yet. Add the first one above.</p></div>
        ) : (
          <div className="console-card">
            <ul className="console-list">
              {facilities.map((f) => (
                <li key={f.id} className={"console-row" + (f.active ? "" : " inactive")}>
                  {editingId === f.id ? (
                    <input
                      className="pm-input console-edit"
                      value={editName}
                      autoFocus
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); saveRename(f); }
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onBlur={() => saveRename(f)}
                    />
                  ) : (
                    <span className="console-name">
                      <span className="console-name-text">{f.name}</span>
                      {!f.active && <span className="console-badge">inactive</span>}
                    </span>
                  )}
                  <div className="console-row-actions">
                    <button type="button" className="console-action" onClick={() => startRename(f)}>Rename</button>
                    <button type="button" className={"console-action" + (f.active ? " danger" : "")} onClick={() => toggleActive(f)}>
                      {f.active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <MembersSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Members & Access: view everyone, add people (Client / Member / Guest via the
// invite-user function), switch someone's role, or revoke (remove-all). The
// admin's own email is never revocable or changeable here.
// ---------------------------------------------------------------------------
const ADMIN_EMAIL = "eduardonutramedia@gmail.com";
const ROLE_LABEL = { internal: "Internal", member: "Member", guest: "Guest", client: "Client", none: "No access" };

function MembersSection() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myEmail, setMyEmail] = useState("");
  const [projects, setProjects] = useState([]);
  const [customers, setCustomers] = useState([]);

  // add-person form
  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState("member");   // member | guest | client
  const [addProject, setAddProject] = useState("");
  const [addCustomer, setAddCustomer] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  // per-row role editor
  const [editEmail, setEditEmail] = useState(null);
  const [editRole, setEditRole] = useState("member");
  const [editProject, setEditProject] = useState("");
  const [editCustomer, setEditCustomer] = useState("");
  const [rowBusy, setRowBusy] = useState(false);

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMyEmail((data.user?.email || "").toLowerCase())); }, []);

  async function load() {
    const [{ data: mem, error }, { data: proj }, { data: cust }] = await Promise.all([
      supabase.from("member_access").select("*").order("access").order("email"),
      supabase.from("projects").select("id,name").order("name"),
      supabase.from("customers").select("id,name").order("name"),
    ]);
    if (error) { toast.error("Couldn't load members."); setLoading(false); return; }
    setRows(mem || []);
    setProjects(proj || []);
    setCustomers(cust || []);
    if (proj && proj.length && !addProject) setAddProject(proj[0].id);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function removeAllGrants(email) {
    const e = email.toLowerCase();
    for (const t of ["workspace_members", "client_users", "project_members"]) {
      const { error } = await supabase.from(t).delete().ilike("member_email", e);
      if (error) throw error;
    }
  }

  async function applyRole(email, role, projectId, customerId) {
    const e = email.toLowerCase();
    await removeAllGrants(e);
    if (role === "member") {
      const { error } = await supabase.from("workspace_members").upsert({ member_email: e, added_by: myEmail }, { onConflict: "member_email" });
      if (error) throw error;
    } else if (role === "client") {
      const { error } = await supabase.from("client_users").upsert({ member_email: e, customer_id: customerId || null, added_by: myEmail }, { onConflict: "member_email" });
      if (error) throw error;
    } else if (role === "guest") {
      if (!projectId) throw new Error("Pick a project for the guest.");
      const { error } = await supabase.from("project_members").upsert({ project_id: projectId, member_email: e, added_by: myEmail }, { onConflict: "project_id,member_email" });
      if (error) throw error;
    }
  }

  async function addPerson(e) {
    e.preventDefault();
    const email = addEmail.trim().toLowerCase();
    if (!email.includes("@")) { toast.error("Enter a valid email."); return; }
    if (addRole === "guest" && !addProject) { toast.error("Pick a project."); return; }
    setAddBusy(true);
    const scope = addRole === "member" ? "workspace" : addRole === "guest" ? "project" : "client";
    const { data, error } = await supabase.functions.invoke("invite-user", {
      body: { email, scope, projectId: scope === "project" ? addProject : null, customerId: scope === "client" ? (addCustomer || null) : null },
    });
    setAddBusy(false);
    if (error || data?.error) { toast.error(data?.error || error?.message || "Couldn't add person."); return; }
    toast.success(data?.alreadyExisted ? `${email} already had an account — access granted.` : `Invite sent to ${email}.`);
    setAddEmail(""); setAddCustomer(""); setAddOpen(false);
    load();
  }

  function startEdit(r) {
    setEditEmail(r.email);
    setEditRole(r.is_member ? "member" : r.is_guest ? "guest" : r.is_client ? "client" : "member");
    setEditProject(projects[0]?.id || "");
    setEditCustomer(r.customer_id || "");
  }
  async function saveEdit(r) {
    if (editRole === "guest" && !editProject) { toast.error("Pick a project."); return; }
    setRowBusy(true);
    try {
      await applyRole(r.email, editRole, editProject, editCustomer);
      toast.success(`${r.email} is now a ${ROLE_LABEL[editRole].toLowerCase()}.`);
      setEditEmail(null);
      load();
    } catch (err) { toast.error(err.message || "Couldn't change role."); }
    setRowBusy(false);
  }
  async function revoke(r) {
    if (!window.confirm(`Remove all access for ${r.email}? Their login stays; you can re-invite later.`)) return;
    setRowBusy(true);
    try {
      await removeAllGrants(r.email);
      toast.success(`Access removed for ${r.email}.`);
      load();
    } catch (err) { toast.error(err.message || "Couldn't remove access."); }
    setRowBusy(false);
  }

  const withAccess = rows.filter((r) => r.access !== "none");
  const noAccess = rows.filter((r) => r.access === "none");
  const ordered = [...withAccess, ...noAccess];

  const [filter, setFilter] = useState("all");
  const counts = rows.reduce((a, r) => { a[r.access] = (a[r.access] || 0) + 1; return a; }, {});
  const FILTERS = [
    ["all", "All", ordered.length],
    ["internal", "Internal", counts.internal || 0],
    ["member", "Members", counts.member || 0],
    ["guest", "Guests", counts.guest || 0],
    ["client", "Clients", counts.client || 0],
    ["none", "No access", counts.none || 0],
  ];
  const shown = filter === "all" ? ordered : ordered.filter((r) => r.access === filter);

  return (
    <section className="console-section">
      <div className="console-section-head">
        <h2 className="console-h2">Members &amp; access</h2>
        {!loading && <span className="console-count">{withAccess.length} with access</span>}
      </div>
      <p className="muted small console-note">
        Add people and set what they can see. Clients only ever get the estimator; members get the whole app; guests get one project.
      </p>

      {!addOpen ? (
        <div className="console-add">
          <button type="button" className="btn-accent" onClick={() => setAddOpen(true)}>+ Add person</button>
        </div>
      ) : (
        <form className="console-addbox" onSubmit={addPerson}>
          <div className="console-addbox-row">
            <input className="pm-input" type="email" placeholder="person@company.com" value={addEmail} autoFocus onChange={(e) => setAddEmail(e.target.value)} />
            <select className="pm-input console-role-select" value={addRole} onChange={(e) => setAddRole(e.target.value)}>
              <option value="member">Member — whole app</option>
              <option value="guest">Guest — one project</option>
              <option value="client">Client — estimator only</option>
            </select>
          </div>
          {addRole === "guest" && (
            <select className="pm-input" value={addProject} onChange={(e) => setAddProject(e.target.value)}>
              {projects.length === 0 && <option value="">No projects yet</option>}
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {addRole === "client" && (
            <select className="pm-input" value={addCustomer} onChange={(e) => setAddCustomer(e.target.value)}>
              <option value="">Customer (optional) — link later</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <div className="console-addbox-actions">
            <button type="button" className="console-action" onClick={() => setAddOpen(false)}>Cancel</button>
            <button type="submit" className="btn-accent" disabled={addBusy || !addEmail.trim()}>{addBusy ? "Sending…" : "Send invite"}</button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="console-filters">
            {FILTERS.map(([key, label, n]) => (
              <button
                key={key}
                type="button"
                className={"console-filter" + (filter === key ? " on" : "")}
                onClick={() => setFilter(key)}
              >
                {label}<span className="console-filter-count">{n}</span>
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <div className="console-card"><p className="console-empty">No {filter === "all" ? "people" : FILTERS.find((f) => f[0] === filter)[1].toLowerCase()} yet.</p></div>
          ) : (
          <div className="console-card scrolls">
            <ul className="console-list">
              {shown.map((r) => {
              const locked = r.email === ADMIN_EMAIL;
              const detail = r.access === "client"
                ? (r.customer_name ? `Client · ${r.customer_name}` : "Client · no customer")
                : r.access === "guest"
                ? `Guest · ${r.project_count} project${r.project_count === 1 ? "" : "s"}`
                : ROLE_LABEL[r.access] || "";
              const editing = editEmail === r.email;
              return (
                <li key={r.email} className={"console-row" + (r.access === "none" ? " inactive" : "")}>
                  {editing ? (
                    <div className="console-editrow">
                      <span className="console-name"><span className="console-name-text">{r.email}</span></span>
                      <div className="console-editrow-ctrls">
                        <select className="pm-input console-role-select" value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                          <option value="member">Member</option>
                          <option value="guest">Guest</option>
                          <option value="client">Client</option>
                        </select>
                        {editRole === "guest" && (
                          <select className="pm-input" value={editProject} onChange={(e) => setEditProject(e.target.value)}>
                            {projects.length === 0 && <option value="">No projects</option>}
                            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        )}
                        {editRole === "client" && (
                          <select className="pm-input" value={editCustomer} onChange={(e) => setEditCustomer(e.target.value)}>
                            <option value="">No customer</option>
                            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        )}
                        <button type="button" className="console-action" onClick={() => setEditEmail(null)} disabled={rowBusy}>Cancel</button>
                        <button type="button" className="console-action" onClick={() => saveEdit(r)} disabled={rowBusy}>{rowBusy ? "Saving…" : "Save"}</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="console-name">
                        <span className="console-name-text">{r.email}</span>
                        <span className={"macc-badge macc-" + r.access}>{detail}</span>
                        {locked && <span className="console-badge">you</span>}
                      </span>
                      {!locked && (
                        <div className="console-row-actions">
                          <button type="button" className="console-action" onClick={() => startEdit(r)}>Change role</button>
                          {r.access !== "none" && (
                            <button type="button" className="console-action danger" onClick={() => revoke(r)}>Revoke</button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </li>
              );
            })}
            </ul>
          </div>
          )}
        </>
      )}
    </section>
  );
}
