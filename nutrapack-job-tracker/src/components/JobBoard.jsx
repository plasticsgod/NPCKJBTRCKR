import { STATUSES } from "../supabaseClient";

export default function JobBoard({ jobs, onEdit, onStatus }) {
  return (
    <div className="board">
      {STATUSES.map((status) => {
        const column = jobs.filter((j) => j.status === status);
        return (
          <section className="board-col" key={status}>
            <div className="board-head">
              <span className="board-title">{status}</span>
              <span className="board-count">{column.length}</span>
            </div>

            <div className="board-cards">
              {column.length === 0 && <div className="board-empty">Empty</div>}

              {column.map((j) => (
                <article
                  key={j.id}
                  className="card"
                  onClick={() => onEdit(j)}
                >
                  <p className="card-title">{j.job_title}</p>
                  {j.brand && <p className="card-sub">{j.brand}</p>}
                  {j.printing_facility && (
                    <p className="card-meta">{j.printing_facility}</p>
                  )}

                  {/* Quick status change without opening the full editor */}
                  <select
                    className="card-status"
                    value={j.status}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onStatus(j.id, e.target.value)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
