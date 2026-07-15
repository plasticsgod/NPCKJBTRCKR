import { useEffect, useState } from "react";
import { STATUSES, supabase } from "../supabaseClient";
import { TASK_STATUSES } from "../projects/constants";

const DONE = ["Shipped", "Delivered"]; // counts as "printed"
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const JOB_STATUS_COLOR = {
  "Not Submitted": "#b8b8b8",
  "Waiting for proofs and approval": "#f0b429",
  "In Queue": "#e85aa0",
  "Printing": "#e2445c",
  "Shipped": "#3f8ae0",
  "Delivered": "#00c875",
};
const TASK_STATUS_COLOR = {
  "To do": "#8e8e93",
  "In progress": "#0a84ff",
  "Stuck": "#e2445c",
  "Done": "#00c875",
};

export default function Dashboard({ jobs = [] }) {
  const now = new Date();
  const year = now.getFullYear();
  const startOfYear = new Date(year, 0, 1);

  // --- Projects/tasks side (not in the jobs prop — fetch it here) -------------
  const [tasks, setTasks] = useState(null); // null = loading

  useEffect(() => {
    let on = true;
    (async () => {
      const { data } = await supabase.from("tasks").select("id, status, due_date");
      if (on) setTasks(data || []);
    })();
    return () => { on = false; };
  }, []);

  // --- Work-order metrics -----------------------------------------------------
  const ytdDone = jobs.filter((j) => DONE.includes(j.status) && new Date(j.created_at) >= startOfYear);
  const labelsYTD = ytdDone.reduce((sum, j) => sum + (j.print_qty || 0), 0);
  const activeCount = jobs.filter((j) => !DONE.includes(j.status)).length;

  // Money (realized on shipped/delivered jobs this year).
  const revenueYTD = ytdDone.reduce((s, j) => s + (Number(j.revenue) || 0), 0);
  const costYTD = ytdDone.reduce((s, j) => s + (Number(j.cost) || 0), 0);
  const profitYTD = revenueYTD - costYTD;
  const marginPct = revenueYTD > 0 ? Math.round((profitYTD / revenueYTD) * 100) : null;
  const usd = (n) => "$" + Math.round(n).toLocaleString();

  // Top client by total labels YTD.
  const byClient = {};
  for (const j of ytdDone) {
    const name = j.brand || "Unknown";
    byClient[name] = (byClient[name] || 0) + (j.print_qty || 0);
  }
  const clientsSorted = Object.entries(byClient).sort((a, b) => b[1] - a[1]);
  const topClient = clientsSorted[0]?.[0] || "—";
  const topClientQty = clientsSorted[0]?.[1] || 0;
  const topClients = clientsSorted.slice(0, 5).map(([label, value]) => ({ label, value, color: "var(--accent)" }));

  // Labels printed per month (Jan → current month).
  const monthly = [];
  for (let m = 0; m <= now.getMonth(); m++) monthly.push({ label: MONTHS[m], value: 0 });
  ytdDone.forEach((j) => {
    const d = new Date(j.created_at);
    if (d.getFullYear() === year && monthly[d.getMonth()]) monthly[d.getMonth()].value += (j.print_qty || 0);
  });

  // Work orders by status (all jobs).
  const ordersByStatus = STATUSES.map((s) => ({
    label: s,
    value: jobs.filter((j) => j.status === s).length,
    color: JOB_STATUS_COLOR[s] || "var(--accent)",
  }));

  // --- Task metrics -----------------------------------------------------------
  const taskList = tasks || [];
  const openTasks = taskList.filter((t) => (t.status || "To do") !== "Done").length;
  const overdueTasks = taskList.filter((t) => {
    if ((t.status || "To do") === "Done" || !t.due_date) return false;
    return new Date(t.due_date) < new Date(now.toDateString());
  }).length;
  const tasksByStatus = TASK_STATUSES.map((s) => ({
    label: s,
    value: taskList.filter((t) => (t.status || "To do") === s).length,
    color: TASK_STATUS_COLOR[s],
  }));

  return (
    <div className="dashboard">
      <div className="stat-grid">
        <div className="stat-card accent">
          <span className="stat-label">Labels Printed · Year to Date</span>
          <span className="stat-value">{labelsYTD.toLocaleString()}</span>
          <span className="stat-foot">Shipped &amp; delivered in {year}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Revenue · Year to Date</span>
          <span className="stat-value money">{usd(revenueYTD)}</span>
          <span className="stat-foot">Billed on shipped &amp; delivered</span>
        </div>
        <div className="stat-card accent">
          <span className="stat-label">Label Profit · YTD</span>
          <span className="stat-value money">{usd(profitYTD)}</span>
          <span className="stat-foot">{marginPct !== null ? `${marginPct}% margin` : "Charge minus cost"}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Active Work Orders</span>
          <span className="stat-value">{activeCount}</span>
          <span className="stat-foot">Not yet shipped</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Top Client</span>
          <span className="stat-value">{topClient}</span>
          <span className="stat-foot">{topClientQty.toLocaleString()} labels YTD</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Open Tasks</span>
          <span className="stat-value">{tasks === null ? "—" : openTasks}</span>
          <span className="stat-foot">{overdueTasks > 0 ? `${overdueTasks} overdue` : "Across all projects"}</span>
        </div>
      </div>

      <div className="dash-charts">
        <div className="panel chart-panel">
          <h2 className="panel-title">Labels Printed · {year}</h2>
          {monthly.some((m) => m.value > 0)
            ? <ColumnChart data={monthly} />
            : <p className="chart-empty">No shipped or delivered labels yet this year.</p>}
        </div>

        <div className="panel chart-panel">
          <h2 className="panel-title">Work Orders by Status</h2>
          <BarRows data={ordersByStatus} />
        </div>

        <div className="panel chart-panel">
          <h2 className="panel-title">Top Clients · YTD Labels</h2>
          {topClients.length > 0
            ? <BarRows data={topClients} format={(v) => v.toLocaleString()} />
            : <p className="chart-empty">No labels printed yet this year.</p>}
        </div>

        <div className="panel chart-panel">
          <h2 className="panel-title">Tasks by Status</h2>
          {tasks === null
            ? <p className="chart-empty">Loading tasks…</p>
            : taskList.length === 0
              ? <p className="chart-empty">No tasks yet.</p>
              : <Donut segments={tasksByStatus} />}
        </div>
      </div>
    </div>
  );
}

// --- Tiny dependency-free charts ---------------------------------------------

// Horizontal labelled bars.
function BarRows({ data, format = (v) => v }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="bar-rows">
      {data.map((d) => (
        <div className="bar-row" key={d.label}>
          <span className="bar-label" title={d.label}>{d.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: (d.value / max) * 100 + "%", background: d.color || "var(--accent)" }} />
          </span>
          <span className="bar-value">{format(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

// Vertical columns (monthly trend).
function ColumnChart({ data, format = (v) => v.toLocaleString() }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const W = 540, H = 180, padX = 14, baseY = H - 22, top = 14;
  const n = data.length;
  const gap = 8;
  const bw = (W - padX * 2 - gap * (n - 1)) / n;
  return (
    <svg className="col-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Monthly labels printed">
      <line x1={padX} y1={baseY} x2={W - padX} y2={baseY} stroke="var(--hairline)" strokeWidth="1" />
      {data.map((d, i) => {
        const h = d.value > 0 ? Math.max((d.value / max) * (baseY - top), 2) : 0;
        const x = padX + i * (bw + gap);
        const y = baseY - h;
        return (
          <g key={d.label}>
            {h > 0 && <rect x={x} y={y} width={bw} height={h} rx="3" fill="var(--accent)">
              <title>{d.label}: {format(d.value)}</title>
            </rect>}
            <text x={x + bw / 2} y={H - 6} textAnchor="middle" className="col-x">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Donut with legend.
function Donut({ segments }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = 52, C = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 140 140" className="donut" role="img" aria-label="Tasks by status">
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--hairline)" strokeWidth="16" />
        {total > 0 && segments.filter((s) => s.value > 0).map((s) => {
          const len = (s.value / total) * C;
          const el = (
            <circle key={s.label} cx="70" cy="70" r={r} fill="none" stroke={s.color} strokeWidth="16"
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset}
              transform="rotate(-90 70 70)" strokeLinecap="butt" />
          );
          offset += len;
          return el;
        })}
        <text x="70" y="67" textAnchor="middle" className="donut-total">{total}</text>
        <text x="70" y="85" textAnchor="middle" className="donut-sub">tasks</text>
      </svg>
      <div className="donut-legend">
        {segments.map((s) => (
          <div className="donut-leg" key={s.label}>
            <span className="donut-dot" style={{ background: s.color }} />
            <span className="donut-leg-label">{s.label}</span>
            <span className="donut-leg-val">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
