// Supabase Edge Function: slack-digest
// Posts the NutraPack 🐋 daily digest to Slack (#nutrapack-updates) through an
// Incoming Webhook. Read-only: it only summarizes data already in the app.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   SLACK_DIGEST_WEBHOOK_URL  the Slack incoming-webhook URL for the channel
//   DIGEST_SECRET             any long random string; callers must send it
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
//
// Call:  POST .../functions/v1/slack-digest   header  x-digest-secret: <DIGEST_SECRET>
//        body {"force": true} posts even on a quiet day (for testing)
//        body {"preview": true} returns the message without posting

import { createClient } from "jsr:@supabase/supabase-js@2";

const APP_URL = "https://app.nutrapack.co";
const TZ = "America/Chicago";
const NAMES: Record<string, string> = {
  "eduardonutramedia@gmail.com": "Eduardo",
  "jeff.weisser@nutrapack.co": "Jeff",
  "taylor.know@nutrapack.co": "TK",
  "taylor.knox@nutrapack.co": "TK",
  "cc@nutramedia.co": "Christina",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

// YYYY-MM-DD for "today" in Central time.
function todayISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(iso: string, n: number) {
  const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
function niceDate(iso: string) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}
function weekday(iso: string) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" });
}
const who = (t: any) => {
  const list: string[] = (t.owners && t.owners.length ? t.owners : t.owner ? [t.owner] : []);
  return list.map((e) => NAMES[e?.toLowerCase()] || (e || "").split("@")[0]).join(", ");
};
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Pure: data in, Slack Block Kit message out. Returns null on a quiet day.
export function buildDigest(d: any, today: string) {
  const weekEnd = addDays(today, 6);
  const open = (d.tasks || []).filter((t: any) => t.status !== "Done" && t.due_date);
  const overdue = open.filter((t: any) => t.due_date < today).sort((a: any, b: any) => a.due_date.localeCompare(b.due_date));
  const dueWeek = open.filter((t: any) => t.due_date >= today && t.due_date <= weekEnd).sort((a: any, b: any) => a.due_date.localeCompare(b.due_date));
  const proj = (id: string) => d.projectNames?.[id] || "";

  const labelOpen = (d.jobs || []).filter((j: any) => j.status && j.status !== "Delivered");
  const plasticBoard = (d.plastic || []).filter((j: any) => (j.approval == null || j.approval === "approved") && j.status !== "Delivered");
  const pendingOrders = (d.plastic || []).filter((j: any) => j.approval === "pending");
  const sentQuotes = (d.quotes || []).filter((q: any) => q.status === "sent");

  const inProduction = labelOpen.filter((j: any) => ["In Queue", "Printing"].includes(j.status)).length
    + plasticBoard.filter((j: any) => j.status === "In Production").length;
  const waiting = pendingOrders.length + sentQuotes.length;

  const quiet = !overdue.length && !dueWeek.length && !labelOpen.length && !plasticBoard.length && !waiting;
  if (quiet) return null;

  const count = (arr: any[], s: string) => arr.filter((j) => j.status === s).length;
  const statusLine = (label: string, arr: any[], statuses: [string, string][]) => {
    const parts = statuses.map(([s, lab]) => [lab, count(arr, s)] as [string, number]).filter(([, n]) => n > 0).map(([lab, n]) => `${lab} *${n}*`);
    return parts.length ? `*${label}*  ·  ${parts.join("  ·  ")}` : `*${label}*  ·  _nothing open_`;
  };
  const taskLine = (t: any, overdueStyle: boolean) =>
    `• <${APP_URL}/#projects|${esc(t.title)}>${proj(t.project_id) ? `  _— ${esc(proj(t.project_id))}_` : ""}  ·  ${overdueStyle ? "due " + niceDate(t.due_date) : weekday(t.due_date)}${who(t) ? `  ·  ${esc(who(t))}` : ""}`;
  const cap = (lines: string[], max = 10) => lines.length > max ? [...lines.slice(0, max), `_…and ${lines.length - max} more in the app_`] : lines;

  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: "🐋 Good morning — here's what's due", emoji: true } },
    { type: "context", elements: [{ type: "mrkdwn", text: `${new Date(today + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" })}  ·  NutraPack daily digest` }] },
    { type: "section", fields: [
      { type: "mrkdwn", text: `*${overdue.length}*\nOverdue` },
      { type: "mrkdwn", text: `*${dueWeek.length}*\nDue this week` },
      { type: "mrkdwn", text: `*${inProduction}*\nOrders in production` },
      { type: "mrkdwn", text: `*${waiting}*\nWaiting on approval` },
    ] },
    { type: "divider" },
  ];
  if (overdue.length) blocks.push({ type: "section", text: { type: "mrkdwn", text: ["🔴 *Overdue*", ...cap(overdue.map((t: any) => taskLine(t, true)))].join("\n") } });
  if (dueWeek.length) blocks.push({ type: "section", text: { type: "mrkdwn", text: ["🟡 *Due this week*", ...cap(dueWeek.map((t: any) => taskLine(t, false)))].join("\n") } });
  // Label work orders — each job listed under its status (line by line).
  const jobLine = (j: any) => {
    const bits = [j.brand, j.printing_facility, j.print_qty ? `${Number(j.print_qty).toLocaleString("en-US")} labels` : ""].filter(Boolean).map(esc);
    return `• <${APP_URL}/#work_orders|${esc(j.job_title || "Untitled job")}>${bits.length ? "  ·  " + bits.join("  ·  ") : ""}`;
  };
  const LABEL_GROUPS: [string, string][] = [
    ["Not Submitted", "📝 Not submitted"],
    ["Waiting for proofs and approval", "🎨 Waiting on proofs"],
    ["In Queue", "⏳ In queue"],
    ["Printing", "🖨️ Printing"],
  ];
  const labelLines = [`🏭 *Label work orders*  ·  <${APP_URL}/#work_orders|open>`];
  for (const [status, title] of LABEL_GROUPS) {
    const list = labelOpen.filter((j: any) => j.status === status);
    if (!list.length) continue;
    labelLines.push(`*${title}* (${list.length})`, ...cap(list.map(jobLine), 8));
  }
  const shippedN = count(labelOpen, "Shipped");
  if (shippedN) labelLines.push(`🚚 Shipped, not yet delivered: *${shippedN}*`);
  if (labelLines.length === 1) labelLines.push("_Nothing open_");
  blocks.push({ type: "section", text: { type: "mrkdwn", text: labelLines.join("\n") } });

  // Plastics — status counts.
  blocks.push({ type: "section", text: { type: "mrkdwn", text: [
    `📦 *Plastics work orders*  ·  <${APP_URL}/#plastic_work_orders|open>`,
    statusLine("Plastics", plasticBoard, [["Submitted", "Submitted"], ["In Production", "In production"], ["Shipped", "Shipped"]]),
  ].join("\n") } });
  if (waiting) {
    const lines = [
      ...pendingOrders.map((j: any) => `• <${APP_URL}/#plastic_work_orders|${esc(j.brand || j.job_title || "Client order")}>  ·  client order awaiting your approval${j.revenue ? `  ·  ${money(j.revenue)}` : ""}`),
      ...sentQuotes.map((q: any) => `• <${APP_URL}/#quick_quote|${esc(q.quote_number)}${q.customer ? " — " + esc(q.customer) : ""}>  ·  quote sent, waiting on customer${q.total != null ? `  ·  ${money(q.total)}` : ""}`),
    ];
    blocks.push({ type: "section", text: { type: "mrkdwn", text: ["💬 *Waiting on approval*", ...cap(lines)].join("\n") } });
  }
  blocks.push({ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open NutraPack app" }, url: APP_URL }] });
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "Posted every weekday at 8 AM. Reply in a thread to discuss." }] });

  return { text: `NutraPack digest: ${overdue.length} overdue, ${dueWeek.length} due this week`, blocks };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (req.headers.get("x-digest-secret") !== Deno.env.get("DIGEST_SECRET")) return json({ error: "Unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const [tasks, projects, jobs, plastic, quotes] = await Promise.all([
    db.from("tasks").select("title,status,due_date,owner,owners,project_id").neq("status", "Done").not("due_date", "is", null),
    db.from("projects").select("id,name"),
    db.from("jobs").select("job_title,brand,status,printing_facility,print_qty").order("created_at", { ascending: true }),
    db.from("plastic_jobs").select("status,approval,brand,job_title,revenue"),
    db.from("quick_quotes").select("quote_number,customer,status,total"),
  ]);
  const err = [tasks, projects, jobs, plastic].find((r) => r.error);
  if (err) return json({ error: err.error!.message }, 500);

  const projectNames = Object.fromEntries((projects.data || []).map((p: any) => [p.id, p.name]));
  const today = todayISO();
  const msg = buildDigest({ tasks: tasks.data, projectNames, jobs: jobs.data, plastic: plastic.data, quotes: quotes.error ? [] : quotes.data }, today);

  if (!msg && !body.force) return json({ ok: true, posted: false, reason: "quiet day" });
  const payload = msg || { text: "🐋 All clear — nothing overdue or due this week.", blocks: [{ type: "section", text: { type: "mrkdwn", text: "🐋 *All clear* — nothing overdue or due this week." } }] };
  if (body.preview) return json({ ok: true, preview: payload });

  const hook = Deno.env.get("SLACK_DIGEST_WEBHOOK_URL");
  if (!hook) return json({ error: "SLACK_DIGEST_WEBHOOK_URL is not set" }, 500);
  const res = await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) return json({ error: `Slack said ${res.status}: ${await res.text()}` }, 502);
  return json({ ok: true, posted: true });
});
