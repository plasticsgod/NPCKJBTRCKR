import { useEffect, useState } from "react";
import { PORTS } from "../lib/pricing";

const STATUSES = ["Submitted", "In Production", "Shipped", "Delivered"];
const UNITS = ["pallets", "containers", "tubs"];
const ORIGINS = ["India", "China"];

const EMPTY = {
  job_title: "",
  brand: "",
  description: "",
  qty: 0,
  qty_unit: "tubs",
  cost: "",
  revenue: "",
  status: "Submitted",
  origin: "",
  port: "",
  po_number: "",
  ship_to: "",
  shipping_address: "",
};

export default function PlasticJobModal({ job, customers = [], onSave, onClose }) {
  const [form, setForm] = useState({ ...EMPTY, ...job });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const isNew = !job.id;

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit(e) {
    e.preventDefault();
    if (!form.job_title.trim()) return;
    onSave({
      ...form,
      qty: Number(form.qty) || 0,
      cost: form.cost === "" || form.cost == null ? null : Number(form.cost) || 0,
      revenue: form.revenue === "" || form.revenue == null ? null : Number(form.revenue) || 0,
    });
  }

  const profit = (Number(form.revenue) || 0) - (Number(form.cost) || 0);

  return (
    <div className="overlay">
      <form className="modal" onSubmit={submit}>
        <div className="modal-head">
          <h2>{isNew ? "New Plastics Order" : "Edit Plastics Order"}</h2>
          <button type="button" className="link" onClick={onClose}>Close</button>
        </div>

        <div className="modal-body">
          <label className="field">
            <span>Job Title</span>
            <input value={form.job_title} onChange={(e) => set("job_title", e.target.value)} required autoFocus />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Customer</span>
              <input list="plastic-customer-list" placeholder="Type or pick a customer"
                value={form.brand} onChange={(e) => set("brand", e.target.value)} />
              <datalist id="plastic-customer-list">
                {customers.map((c) => <option key={c} value={c} />)}
              </datalist>
            </label>
            <label className="field">
              <span>Quantity</span>
              <div className="qty-input">
                <input type="number" min="0" value={form.qty} onChange={(e) => set("qty", e.target.value)} />
                <select value={form.qty_unit} onChange={(e) => set("qty_unit", e.target.value)}>
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Total Cost <span className="field-hint">— what we paid</span></span>
              <input type="number" min="0" step="0.01" placeholder="0.00"
                value={form.cost} onChange={(e) => set("cost", e.target.value)} />
            </label>
            <label className="field">
              <span>Client Charge <span className="field-hint">— what we bill</span></span>
              <input type="number" min="0" step="0.01" placeholder="0.00"
                value={form.revenue} onChange={(e) => set("revenue", e.target.value)} />
            </label>
          </div>
          {(form.cost !== "" || form.revenue !== "") && (
            <p className="profit-hint">
              Profit: <b>${profit.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
            </p>
          )}

          <div className="field-row">
            <label className="field">
              <span>Status</span>
              <select value={form.status} onChange={(e) => set("status", e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Shipping From</span>
              <select value={form.origin} onChange={(e) => set("origin", e.target.value)}>
                <option value="">— Select origin —</option>
                {ORIGINS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          </div>

          <label className="field">
            <span>Port</span>
            <select value={form.port} onChange={(e) => set("port", e.target.value)}>
              <option value="">— Select port —</option>
              {PORTS.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </label>

          <label className="field">
            <span>Description</span>
            <textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </label>

          <div className="field-row">
            <label className="field">
              <span>PO Number</span>
              <input value={form.po_number} onChange={(e) => set("po_number", e.target.value)} />
            </label>
            <label className="field">
              <span>Ship To</span>
              <input value={form.ship_to} onChange={(e) => set("ship_to", e.target.value)} />
            </label>
          </div>

          <label className="field">
            <span>Shipping Address</span>
            <textarea rows={2} value={form.shipping_address} onChange={(e) => set("shipping_address", e.target.value)} />
          </label>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-accent">{isNew ? "Create order" : "Save changes"}</button>
        </div>
      </form>
    </div>
  );
}
