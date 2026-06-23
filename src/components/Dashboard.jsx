import { STATUSES } from "../supabaseClient";

const DONE = ["Shipped", "Delivered"]; // counts as "printed"

export default function Dashboard({ jobs }) {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  // Jobs that count toward "labels printed": Shipped/Delivered, created this year.
  const ytdDone = jobs.filter(
    (j) => DONE.includes(j.status) && new Date(j.created_at) >= startOfYear
  );

  const labelsYTD = ytdDone.reduce((sum, j) => sum + (j.print_qty || 0), 0);

  // Top client by total labels (print_qty) among those YTD done jobs.
  const byClient = {};
  for (const j of ytdDone) {
    const name = j.brand || "Unknown";
    byClient[name] = (byClient[name] || 0) + (j.print_qty || 0);
  }
  const top = Object.entries(byClient).sort((a, b) => b[1] - a[1])[0];
  const topClient = top ? top[0] : "—";
  const topClientQty = top ? top[1] : 0;

  // Small breakdown: how many active orders sit in each status.
  const breakdown = STATUSES.map((s) => ({
    status: s,
    count: jobs.filter((j) => j.status === s).length,
  }));

  const activeCount = jobs.filter((j) => !DONE.includes(j.status)).length;

  return (
    <div className="dashboard">
      <div className="stat-grid">
        <div className="stat-card accent">
          <span className="stat-label">Labels Printed · Year to Date</span>
          <span className="stat-value">{labelsYTD.toLocaleString()}</span>
          <span className="stat-foot">Shipped &amp; delivered in {now.getFullYear()}</span>
        </div>

        <div className="stat-card">
          <span className="stat-label">Top Client</span>
          <span className="stat-value">{topClient}</span>
          <span className="stat-foot">{topClientQty.toLocaleString()} labels YTD</span>
        </div>

        <div className="stat-card">
          <span className="stat-label">Active Work Orders</span>
          <span className="stat-value">{activeCount}</span>
          <span className="stat-foot">Not yet shipped</span>
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title">Orders by Status</h2>
        <ul className="breakdown">
          {breakdown.map((b) => (
            <li key={b.status}>
              <span>{b.status}</span>
              <span className="breakdown-count">{b.count}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
