import { useState } from "react";
import JobTable from "./JobTable";
import JobBoard from "./JobBoard";

export default function WorkOrders({
  jobs, customers, onNew, onEdit, onDelete, onStatus, onFacility,
}) {
  const [view, setView] = useState("table");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = q
    ? jobs.filter((j) => (j.brand || "").toLowerCase().includes(q))
    : jobs;

  return (
    <>
      <div className="toolbar">
        <div className="toggle">
          <button className={view === "table" ? "toggle-on" : ""} onClick={() => setView("table")}>Table</button>
          <button className={view === "board" ? "toggle-on" : ""} onClick={() => setView("board")}>Board</button>
        </div>

        <input
          className="search-input"
          type="search"
          placeholder="Search by customer…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          list="customers"
        />
        <datalist id="customers">
          {customers.map((c) => <option key={c} value={c} />)}
        </datalist>

        <span className="count">{filtered.length} {filtered.length === 1 ? "order" : "orders"}</span>

        <button className="btn-accent push-right" onClick={onNew}>+ New Job</button>
      </div>

      {jobs.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No work orders yet</p>
          <p className="muted">Add your first job to get started.</p>
          <button className="btn-accent" onClick={onNew}>+ New Job</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No matches</p>
          <p className="muted">No orders have a customer matching “{query}”.</p>
        </div>
      ) : view === "table" ? (
        <JobTable jobs={filtered} onEdit={onEdit} onDelete={onDelete} />
      ) : (
        <JobBoard jobs={filtered} onEdit={onEdit} onStatus={onStatus} onFacility={onFacility} />
      )}
    </>
  );
}
