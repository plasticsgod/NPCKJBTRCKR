import { useState } from "react";
import { STATUSES, FACILITIES } from "../supabaseClient";

const EMPTY = {
  job_title: "",
  brand: "",
  facility: "",
  description: "",
  status: "New",
  ship_to: "",
  po_number: "",
  printing_facility: "",
  shipping_address: "",
};

export default function JobModal({ job, onSave, onClose }) {
  const isNew = !job.id;
  const [form, setForm] = useState({ ...EMPTY, ...job });

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function submit(e) {
    e.preventDefault();
    if (!form.job_title.trim()) return;
    onSave(form);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div className="modal-head">
          <h2>{isNew ? "New Job" : "Edit Job"}</h2>
          <button type="button" className="link" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="modal-body">
          <label className="field">
            <span>Job Title</span>
            <input
              value={form.job_title}
              onChange={(e) => set("job_title", e.target.value)}
              required
              autoFocus
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Brand</span>
              <input value={form.brand} onChange={(e) => set("brand", e.target.value)} />
            </label>
            <label className="field">
              <span>Status</span>
              <select value={form.status} onChange={(e) => set("status", e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Printing Facility</span>
              <input
                list="facilities"
                value={form.printing_facility}
                onChange={(e) => set("printing_facility", e.target.value)}
              />
              <datalist id="facilities">
                {FACILITIES.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </label>
            <label className="field">
              <span>PO Number</span>
              <input
                value={form.po_number}
                onChange={(e) => set("po_number", e.target.value)}
              />
            </label>
          </div>

          <label className="field">
            <span>Description</span>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Ship To</span>
              <input value={form.ship_to} onChange={(e) => set("ship_to", e.target.value)} />
            </label>
            <label className="field">
              <span>Facility</span>
              <input value={form.facility} onChange={(e) => set("facility", e.target.value)} />
            </label>
          </div>

          <label className="field">
            <span>Shipping Address</span>
            <textarea
              rows={2}
              value={form.shipping_address}
              onChange={(e) => set("shipping_address", e.target.value)}
            />
          </label>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-accent">
            {isNew ? "Create Job" : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
