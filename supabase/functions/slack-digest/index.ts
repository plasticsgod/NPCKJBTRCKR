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
  const noon = Date.parse(today + "T12:00:00Z");
  const daysSince = (iso: string) => Math.max(0, Math.floor((noon - Date.parse(iso)) / 864e5));
  const STUCK_DAYS = 7;   // an order sitting this long in one status gets a 🔴

  // Links that open the exact item in the app.
  const taskUrl = (t: any) => `${APP_URL}/#projects?task=${t.id}`;
  const jobUrl = (j: any) => `${APP_URL}/#work_orders?job=${j.id}`;
  const plasticUrl = (j: any) => `${APP_URL}/#plastic_work_orders?plastic=${j.id}`;

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

  const cap = (lines: string[], max = 10) => lines.length > max ? [...lines.slice(0, max), `_…and ${lines.length - max} more in the app_`] : lines;
  const inStatus = (j: any) => {
    if (!j.status_changed_at) return "";
    const n = daysSince(j.status_changed_at);
    return n >= STUCK_DAYS ? `  ·  🔴 *${n}d*` : `  ·  ${n}d`;
  };

  // Tasks — oldest first, with how late they are.
  const overdueLine = (t: any) => `🔴 *${daysSince(t.due_date + "T12:00:00Z")}d*   <${taskUrl(t)}|${esc(t.title)}>${proj(t.project_id) ? `  _— ${esc(proj(t.project_id))}_` : ""}  ·  due ${niceDate(t.due_date)}${who(t) ? `  ·  ${esc(who(t))}` : ""}`;
  const weekLine = (t: any) => `🟡 *${weekday(t.due_date)}*   <${taskUrl(t)}|${esc(t.title)}>${proj(t.project_id) ? `  _— ${esc(proj(t.project_id))}_` : ""}${who(t) ? `  ·  ${esc(who(t))}` : ""}`;

  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: "🐋 Good morning — here's what's due", emoji: true } },
    { type: "context", elements: [{ type: "mrkdwn", text: `<!channel>  ·  ${new Date(today + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" })}  ·  NutraPack daily digest` }] },
    { type: "section", fields: [
      { type: "mrkdwn", text: `*${overdue.length}*\nOverdue` },
      { type: "mrkdwn", text: `*${dueWeek.length}*\nDue this week` },
      { type: "mrkdwn", text: `*${inProduction}*\nOrders in production` },
      { type: "mrkdwn", text: `*${waiting}*\nWaiting on approval` },
    ] },
    { type: "divider" },
  ];
  const addSection = (text: string) => {
    if (blocks[blocks.length - 1].type !== "divider") blocks.push({ type: "divider" });
    blocks.push({ type: "section", text: { type: "mrkdwn", text } });
  };
  if (overdue.length) addSection([`🔴 *OVERDUE*  —  oldest first`, ...cap(overdue.map(overdueLine))].join("\n"));
  if (dueWeek.length) addSection([`🟡 *DUE THIS WEEK*`, ...cap(dueWeek.map(weekLine))].join("\n"));

  // Label work orders — each job under its status, with days in that status.
  const jobLine = (j: any) => {
    const bits = [j.brand, j.printing_facility, j.print_qty ? `${Number(j.print_qty).toLocaleString("en-US")} labels` : ""].filter(Boolean).map(esc);
    return `• <${jobUrl(j)}|${esc(j.job_title || "Untitled job")}>${bits.length ? "  ·  " + bits.join("  ·  ") : ""}${inStatus(j)}`;
  };
  const byAge = (a: any, b: any) => String(a.status_changed_at || "").localeCompare(String(b.status_changed_at || ""));
  const LABEL_GROUPS: [string, string][] = [
    ["Not Submitted", "📝 Not submitted"],
    ["Waiting for proofs and approval", "🎨 Waiting on proofs"],
    ["In Queue", "⏳ In queue"],
    ["Printing", "🖨️ Printing"],
  ];
  const labelLines = [`🏭 *LABEL WORK ORDERS*  ·  <${APP_URL}/#work_orders|open>`];
  for (const [status, title] of LABEL_GROUPS) {
    const list = labelOpen.filter((j: any) => j.status === status).sort(byAge);
    if (!list.length) continue;
    labelLines.push(`*${title}* (${list.length})`, ...cap(list.map(jobLine), 8));
  }
  const shippedN = labelOpen.filter((j: any) => j.status === "Shipped").length;
  if (shippedN) labelLines.push(`🚚 Shipped, not yet delivered: *${shippedN}*`);
  if (labelLines.length === 1) labelLines.push("_Nothing open_");
  addSection(labelLines.join("\n"));

  // Plastics — line by line, same as labels.
  const plasticLine = (j: any) => {
    const qty = j.qty ? `${Number(j.qty).toLocaleString("en-US")} ${j.qty_unit || "units"}` : "";
    const bits = [j.job_title && j.brand ? j.brand : "", qty].filter(Boolean).map(esc);
    return `• <${plasticUrl(j)}|${esc(j.job_title || j.brand || "Untitled order")}>${bits.length ? "  ·  " + bits.join("  ·  ") : ""}${inStatus(j)}`;
  };
  const PLASTIC_GROUPS: [string, string][] = [
    ["Submitted", "📝 Submitted"],
    ["In Production", "🏗️ In production"],
  ];
  const plasticLines = [`📦 *PLASTIC WORK ORDERS*  ·  <${APP_URL}/#plastic_work_orders|open>`];
  for (const [status, title] of PLASTIC_GROUPS) {
    const list = plasticBoard.filter((j: any) => j.status === status).sort(byAge);
    if (!list.length) continue;
    plasticLines.push(`*${title}* (${list.length})`, ...cap(list.map(plasticLine), 8));
  }
  const pShipped = plasticBoard.filter((j: any) => j.status === "Shipped").length;
  if (pShipped) plasticLines.push(`🚚 Shipped, not yet delivered: *${pShipped}*`);
  if (plasticLines.length === 1) plasticLines.push("_Nothing open_");
  addSection(plasticLines.join("\n"));

  if (waiting) {
    const lines = [
      ...pendingOrders.map((j: any) => `• <${plasticUrl(j)}|${esc(j.brand || j.job_title || "Client order")}>  ·  client order awaiting your approval${j.revenue ? `  ·  ${money(j.revenue)}` : ""}`),
      ...sentQuotes.map((q: any) => `• <${APP_URL}/#quick_quote|${esc(q.quote_number)}${q.customer ? " — " + esc(q.customer) : ""}>  ·  quote sent, waiting on customer${q.total != null ? `  ·  ${money(q.total)}` : ""}`),
    ];
    addSection(["💬 *WAITING ON APPROVAL*", ...cap(lines)].join("\n"));
  }

  // By person — each person's tasks behind a "⋯" menu (4 oldest + a link to all).
  const people = new Map<string, any[]>();
  for (const t of [...overdue, ...dueWeek]) {
    const list: string[] = (t.owners && t.owners.length ? t.owners : t.owner ? [t.owner] : []);
    for (const e of list) { const k = String(e || "").toLowerCase(); if (k) (people.get(k) || people.set(k, []).get(k)!).push(t); }
  }
  if (people.size) {
    blocks.push({ type: "divider" });
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "*📊 BY PERSON*  —  tap ⋯ to see their tasks" } });
    const sorted = [...people.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 15);
    for (const [email, tasks] of sorted) {
      const name = NAMES[email] || email.split("@")[0];
      const od = tasks.filter((t: any) => t.due_date < today).length, wk = tasks.length - od;
      const split = [od ? `${od} overdue` : "", wk ? `${wk} this week` : ""].filter(Boolean).join(" · ");
      const options = tasks.slice(0, 4).map((t: any, n: number) => {
        const label = t.due_date < today ? `🔴 ${daysSince(t.due_date + "T12:00:00Z")}d · ${t.title}` : `🟡 ${weekday(t.due_date)} · ${t.title}`;
        return { text: { type: "plain_text", text: label.length > 74 ? label.slice(0, 73) + "…" : label, emoji: true }, value: `t${n}-${t.id}`.slice(0, 150), url: taskUrl(t) };
      });
      options.push({ text: { type: "plain_text", text: "Open Projects →", emoji: true }, value: "all", url: `${APP_URL}/#projects` });
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `👤 *${esc(name)}* — ${tasks.length}  _(${split})_` },
        accessory: { type: "overflow", action_id: `person-${email}`.slice(0, 255), options },
      });
    }
  }

  blocks.push({ type: "divider" });
  blocks.push({ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open NutraPack app" }, url: APP_URL }] });
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `Posted every weekday at 8 AM. Days on orders = time in current status (🔴 = ${STUCK_DAYS}+ days). Reply in a thread to discuss.` }] });

  return { text: `<!channel> NutraPack digest: ${overdue.length} overdue, ${dueWeek.length} due this week`, blocks: blocks.slice(0, 50) };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if ((req.headers.get("content-type") || "").includes("application/x-www-form-urlencoded")) return new Response("", { status: 200 });
  if (req.headers.get("x-digest-secret") !== Deno.env.get("DIGEST_SECRET")) return json({ error: "Unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const [tasks, projects, jobs, plastic, quotes] = await Promise.all([
    db.from("tasks").select("id,title,status,due_date,owner,owners,project_id").neq("status", "Done").not("due_date", "is", null),
    db.from("projects").select("id,name"),
    db.from("jobs").select("id,job_title,brand,status,printing_facility,print_qty,status_changed_at").order("created_at", { ascending: true }),
    db.from("plastic_jobs").select("id,status,approval,brand,job_title,revenue,qty,qty_unit,status_changed_at"),
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
