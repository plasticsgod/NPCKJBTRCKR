import { useState, useEffect } from "react";
import { STATUSES, FACILITIES } from "../supabaseClient";

const EMPTY = {
  job_title: "",
  brand: "",
  description: "",
  print_qty: 0,
  status: "Not Submitted",
  ship_to: "",
  po_number: "",
  printing_facility: "",
  facility: "",
  shipping_address: "",
};

export default function JobModal({ job, customers = [], onSave, onClose }) {
  const isNew = !job.id;
  const [form, setForm] = useState({ ...EMPTY, ...job });

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function submit(e) {
    e.preventDefault();
    if (!form.job_title.trim()) return;
    onSave({ ...form, print_qty: Number(form.print_qty) || 0 });
  }

  // Close on Escape only — never on an accidental click outside the box.
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay">
      <form className="modal" onSubmit={submit}>
        <div className="modal-head">
          <h2>{isNew ? "New Job" : "Edit Job"}</h2>
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
              <input
                list="customer-list"
                placeholder="Type or pick a customer"
                value={form.brand}
                onChange={(e) => set("brand", e.target.value)}
              />
              <datalist id="customer-list">
                {customers.map((c) => <option key={c} value={c} />)}
              </datalist>
            </label>
            <label className="field">
              <span>Print Qty</span>
              <input
                type="number"
                min="0"
                value={form.print_qty}
                onChange={(e) => set("print_qty", e.target.value)}
              />
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Status</span>
              <select value={form.status} onChange={(e) => set("status", e.target.value)}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Printing Facility</span>
              <select value={form.printing_facility} onChange={(e) => set("printing_facility", e.target.value)}>
                <option value="">— Select facility —</option>
                {FACILITIES.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
          </div>

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
          <button type="submit" className="btn-accent">{isNew ? "Create Job" : "Save Changes"}</button>
        </div>
      </form>
    </div>
  );
}
