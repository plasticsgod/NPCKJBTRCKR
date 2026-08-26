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
    </div>
  );
}
