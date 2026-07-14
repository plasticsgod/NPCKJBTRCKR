import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { toast } from "./Toaster";

const money = (n) =>
  "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const initials = (name) =>
  (name || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");

// Statuses that count as money actually earned.
const EARNED = ["Shipped", "Delivered"];

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [plastics, setPlastics] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [clientLogins, setClientLogins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState(null);
  const [editing, setEditing] = useState(null); // customer object or {} for new

  const load = useCallback(async () => {
    const [c, j, p, q, cl] = await Promise.all([
      supabase.from("customers").select("*").order("name"),
      supabase.from("jobs").select("id,job_title,brand,customer_id,status,revenue,deposit,created_at"),
      supabase.from("plastic_jobs").select("id,job_title,brand,customer_id,status,revenue,created_at"),
      supabase.from("plastic_quotes").select("id,quote_no,customer,customer_id,total,quote_date,created_at"),
      supabase.from("client_users").select("id,member_email,customer_id").order("member_email"),
    ]);
    setCustomers(c.data || []);
    setJobs(j.data || []);
    setPlastics(p.data || []);
    setQuotes(q.data || []);
    setClientLogins(cl.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Roll up each customer's records into the numbers shown in the list.
  function statsFor(id) {
    const cj = jobs.filter((x) => x.customer_id === id);
    const cp = plastics.filter((x) => x.customer_id === id);
    const cq = quotes.filter((x) => x.customer_id === id);
    const revenue =
      cj.filter((x) => EARNED.includes(x.status)).reduce((a, x) => a + (Number(x.revenue) || 0), 0) +
      cp.filter((x) => EARNED.includes(x.status)).reduce((a, x) => a + (Number(x.revenue) || 0), 0);
    const owed = cj.filter((x) => x.deposit === "Owed").length;
    // Orders with no client charge entered — revenue can't count them.
    const noCharge = [...cj, ...cp].filter((x) => !Number(x.revenue)).length;
    return { jobs: cj, plastics: cp, quotes: cq, orders: cj.length + cp.length, revenue, owed, noCharge };
  }

  async function saveCustomer(form) {
    const payload = {
      name: form.name.trim(),
      contact_name: form.contact_name?.trim() || null,
      email: form.email?.trim() || null,
      phone: form.phone?.trim() || null,
      address: form.address?.trim() || null,
      notes: form.notes?.trim() || null,
    };
    if (!payload.name) { toast.error("Company name is required."); return; }
    const res = form.id
      ? await supabase.from("customers").update(payload).eq("id", form.id)
      : await supabase.from("customers").insert(payload);
    if (res.error) { toast.error("Could not save: " + res.error.message); return; }
    toast.success(form.id ? "Customer saved" : "Customer added");
    setEditing(null);
    load();
  }

  async function linkClient(clientId, customerId) {
    const { error } = await supabase.from("client_users")
      .update({ customer_id: customerId }).eq("id", clientId);
    if (error) { toast.error("Could not link: " + error.message); return; }
    toast.success(customerId ? "Client linked" : "Client unlinked");
    load();
  }

  if (loading) return <div className="muted pad">Loading customers…</div>;

  const shown = customers.filter((c) =>
    [c.name, c.contact_name, c.email].filter(Boolean).join(" ").toLowerCase().includes(query.trim().toLowerCase())
  );
  const open = customers.find((c) => c.id === openId);

  // ---- Detail view ---------------------------------------------------------
  if (open) {
    const s = statsFor(open.id);
    return (
      <div className="cust-detail">
        <button className="link cust-back" onClick={() => setOpenId(null)}>← All customers</button>

        <div className="cust-head">
          <div className="cust-id">
            <div className="cust-avatar">{initials(open.name)}</div>
            <div>
              <h1 className="cust-name">{open.name}</h1>
              <p className="cust-meta">
                {[open.contact_name, open.email, open.phone].filter(Boolean).join(" · ") || "No contact info yet"}
              </p>
              {open.address && <p className="cust-meta">{open.address}</p>}
            </div>
          </div>
          <button className="btn-ghost" onClick={() => setEditing(open)}>Edit</button>
        </div>

        <div className="cust-stats">
          <div className="stat-card">
            <span className="stat-label">Revenue</span>
            <span className="stat-value">{money(s.revenue)}</span>
            {s.noCharge > 0 && (
              <span className="stat-sub warn">
                {s.noCharge} order{s.noCharge > 1 ? "s" : ""} missing a client charge
              </span>
            )}
          </div>
          <div className="stat-card"><span className="stat-label">Orders</span><span className="stat-value">{s.orders}</span></div>
          <div className="stat-card"><span className="stat-label">Quotes</span><span className="stat-value">{s.quotes.length}</span></div>
          <div className={"stat-card" + (s.owed ? " accent" : "")}>
            <span className="stat-label">Deposits owed</span>
            <span className="stat-value">{s.owed || "—"}</span>
          </div>
        </div>

        <div className="cust-sec">Client logins</div>
        <div className="cust-clients">
          {clientLogins.filter((cl) => cl.customer_id === open.id).map((cl) => (
            <div className="cust-client-row" key={cl.id}>
              <span className="cc-email">{cl.member_email}</span>
              <span className="cc-tag">estimator access</span>
              <button className="link" onClick={() => linkClient(cl.id, null)}>Unlink</button>
            </div>
          ))}
          {clientLogins.filter((cl) => cl.customer_id === open.id).length === 0 && (
            <p className="muted cust-none">No client logins for this company yet.</p>
          )}

          {clientLogins.some((cl) => !cl.customer_id) && (
            <div className="cust-client-link">
              <span className="muted">Link an existing client login:</span>
              <select defaultValue="" onChange={(e) => { if (e.target.value) linkClient(e.target.value, open.id); }}>
                <option value="">Choose…</option>
                {clientLogins.filter((cl) => !cl.customer_id).map((cl) => (
                  <option key={cl.id} value={cl.id}>{cl.member_email}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {open.notes && <div className="cust-notes"><span className="cust-sec">Notes</span><p>{open.notes}</p></div>}

        <div className="cust-sec">Label work orders</div>
        {s.jobs.length === 0 ? <p className="muted cust-none">None yet.</p> : (
          <div className="cust-rows">
            {s.jobs.map((j) => (
              <div className="cust-row" key={j.id}>
                <span className="cr-name">{j.job_title || "Untitled"}</span>
                <span className="cr-date">{fmtDate(j.created_at)}</span>
                <span className={"pill " + "pill-" + (j.status || "").toLowerCase().replace(/\s+/g, "-")}>{j.status}</span>
                <span className={"cr-amt" + (Number(j.revenue) ? "" : " nocharge")}>{Number(j.revenue) ? money(j.revenue) : "no charge"}</span>
              </div>
            ))}
          </div>
        )}

        <div className="cust-sec">Plastics orders</div>
        {s.plastics.length === 0 ? <p className="muted cust-none">None yet.</p> : (
          <div className="cust-rows">
            {s.plastics.map((p) => (
              <div className="cust-row" key={p.id}>
                <span className="cr-name">{p.job_title || "Untitled"}</span>
                <span className="cr-date">{fmtDate(p.created_at)}</span>
                <span className={"pill " + "pill-" + (p.status || "").toLowerCase().replace(/\s+/g, "-")}>{p.status}</span>
                <span className={"cr-amt" + (Number(p.revenue) ? "" : " nocharge")}>{Number(p.revenue) ? money(p.revenue) : "no charge"}</span>
              </div>
            ))}
          </div>
        )}

        <div className="cust-sec">Quotes</div>
        {s.quotes.length === 0 ? <p className="muted cust-none">None yet.</p> : (
          <div className="cust-rows">
            {s.quotes.map((q) => (
              <div className="cust-row" key={q.id}>
                <span className="cr-name">Quote #{q.quote_no}</span>
                <span className="cr-date">{fmtDate(q.quote_date || q.created_at)}</span>
                <span />
                <span className="cr-amt">{money(q.total)}</span>
              </div>
            ))}
          </div>
        )}

        {editing && <CustomerModal customer={editing} onSave={saveCustomer} onClose={() => setEditing(null)} />}
      </div>
    );
  }

  // ---- List view -----------------------------------------------------------
  return (
    <div className="cust-page">
      <div className="toolbar">
        <input className="search-input" type="search" placeholder="Search customers…"
          value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn-accent push-right" onClick={() => setEditing({})}>+ New customer</button>
      </div>

      {customers.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No customers yet</p>
          <p className="muted">Customers appear here as you use them on jobs and quotes.</p>
        </div>
      ) : (
        <div className="cust-table">
          <div className="cust-thead">
            <span>Company</span><span>Contact</span>
            <span className="num">Orders</span><span className="num">Revenue</span><span className="num">Deposits owed</span>
          </div>
          {shown.map((c) => {
            const s = statsFor(c.id);
            return (
              <button className="cust-trow" key={c.id} onClick={() => setOpenId(c.id)}>
                <span className="ct-co">{c.name}</span>
                <span className="ct-contact">{c.email || c.contact_name || "—"}</span>
                <span className="num">{s.orders}</span>
                <span className="num">{money(s.revenue)}</span>
                <span className={"num" + (s.owed ? " owed" : "")}>{s.owed || "—"}</span>
              </button>
            );
          })}
          {shown.length === 0 && <p className="muted cust-none">No customers match “{query}”.</p>}
        </div>
      )}

      {editing && <CustomerModal customer={editing} onSave={saveCustomer} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CustomerModal({ customer, onSave, onClose }) {
  const [form, setForm] = useState({
    id: customer.id,
    name: customer.name || "",
    contact_name: customer.contact_name || "",
    email: customer.email || "",
    phone: customer.phone || "",
    address: customer.address || "",
    notes: customer.notes || "",
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{customer.id ? "Edit customer" : "New customer"}</h2>
          <button className="link" onClick={onClose}>Close</button>
        </div>
        <div className="modal-body">
          <label className="field"><span>Company name</span>
            <input value={form.name} autoFocus onChange={(e) => set("name", e.target.value)} />
          </label>
          <div className="field-row">
            <label className="field"><span>Contact name</span>
              <input value={form.contact_name} onChange={(e) => set("contact_name", e.target.value)} />
            </label>
            <label className="field"><span>Email</span>
              <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </label>
          </div>
          <div className="field-row">
            <label className="field"><span>Phone</span>
              <input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </label>
            <label className="field"><span>Address</span>
              <input value={form.address} onChange={(e) => set("address", e.target.value)} />
            </label>
          </div>
          <label className="field"><span>Notes</span>
            <textarea rows="3" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </label>
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-accent" onClick={() => onSave(form)}>Save</button>
        </div>
      </div>
    </div>
  );
}
