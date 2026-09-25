// slack-panels — Slack → Panel Builder bot.
//
// Someone drops a co-man spec PDF in #panel-builder → the bot reads it with the
// Panel Builder's own code, saves the panel (panel_projects + the spec in the
// panel-files bucket) and replies in the thread with the panel PDF + SVG, a check
// summary and an "Open in NutraPack" link. A revised spec posted in the same thread
// updates that panel with the same rules as "Update from spec…".
//
// Deploy: supabase functions deploy slack-panels --no-verify-jwt
// Secrets: SLACK_BOT_TOKEN (xoxb-…), SLACK_SIGNING_SECRET
// Optional: SLACK_PANEL_CHANNEL (channel name or ID, default "panel-builder"), APP_URL
import { createClient } from "npm:@supabase/supabase-js@2";
import { importSpec, mergeSpec, renderPanel, diffRows, SpecError } from "../_shared/panel-convert.js";
import { loadPdfjs, loadFonts } from "../_shared/panel-runtime.ts";

const BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN") ?? "";
const SIGNING_SECRET = Deno.env.get("SLACK_SIGNING_SECRET") ?? "";
const PANEL_CHANNEL = (Deno.env.get("SLACK_PANEL_CHANNEL") ?? "panel-builder").replace(/^#/, "");
const APP_URL = (Deno.env.get("APP_URL") ?? "https://app.nutrapack.co").replace(/\/$/, "");
const BUCKET = "panel-files";
const MAX_BYTES = 20 * 1024 * 1024;

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const panelLink = (id?: string) => `${APP_URL}/#panel_builder${id ? `?panel=${id}` : ""}`;
const safeName = (n: string) => String(n || "spec").replace(/[^\w.\-]+/g, "_").slice(-120);   // same as PanelBuilder.jsx
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, " ").trim();
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const escSlack = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------------------------------------------------------------------------
// HTTP entry: verify, answer fast, work in the background.
Deno.serve(async (req) => {
  // Open the function URL in a browser to see whether it's deployed and configured.
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      ok: true, function: "slack-panels",
      signing_secret_set: !!SIGNING_SECRET, bot_token_set: BOT_TOKEN.startsWith("xoxb-"),
      channel: PANEL_CHANNEL,
    }, null, 2), { headers: { "Content-Type": "application/json" } });
  }
  const raw = await req.text();
  let body: any = null;
  try { body = JSON.parse(raw); } catch { /* not JSON */ }

  // Slack's Request URL check. Echoing the challenge reveals nothing, so answer it even
  // before the signing secret is set up; just log when the signature doesn't check out.
  if (body?.type === "url_verification") {
    if (!(await verifySlack(req, raw))) console.warn("[slack-panels] url_verification: signature not verified — check SLACK_SIGNING_SECRET");
    return new Response(JSON.stringify({ challenge: body.challenge }), { headers: { "Content-Type": "application/json" } });
  }

  if (!(await verifySlack(req, raw))) {
    console.error("[slack-panels] rejected request: bad or missing signature", SIGNING_SECRET ? "(secret is set — does it match the app's Signing Secret?)" : "(SLACK_SIGNING_SECRET is not set)");
    return new Response("invalid signature", { status: 401 });
  }
  if (body?.type === "event_callback") background(handleEvent(body));
  return new Response("ok");                                            // Slack wants a 200 within 3 s
});

function background(p: Promise<unknown>) {
  const task = p.catch((e) => console.error("[slack-panels]", e));
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(task);
}

async function verifySlack(req: Request, raw: string) {
  const ts = req.headers.get("x-slack-request-timestamp") ?? "";
  const sig = req.headers.get("x-slack-signature") ?? "";
  if (!SIGNING_SECRET || !ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 60 * 5) return false;   // replay guard
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SIGNING_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v0:${ts}:${raw}`)));
  const want = "v0=" + [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (want.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Slack Web API (form-encoded works for every method)
async function slack(method: string, args: Record<string, unknown> = {}) {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) if (v !== undefined && v !== null) form.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${BOT_TOKEN}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const j = await res.json().catch(() => ({ ok: false, error: `http_${res.status}` }));
  if (!j.ok) console.error(`[slack-panels] ${method}:`, j.error, j.response_metadata?.messages ?? "");
  return j;
}

let botUserP: Promise<string | null> | null = null;
const botUserId = () => (botUserP ??= slack("auth.test").then((j) => j.user_id ?? null));

const channelNames = new Map<string, string>();
async function isPanelChannel(id: string) {
  if (/^[CG][A-Z0-9]+$/.test(PANEL_CHANNEL)) return id === PANEL_CHANNEL;
  if (!channelNames.has(id)) {
    const j = await slack("conversations.info", { channel: id });
    channelNames.set(id, j.channel?.name ?? "");
  }
  return channelNames.get(id) === PANEL_CHANNEL;
}

const emails = new Map<string, string>();
async function whoIs(user: string) {                 // the app shows people by email
  if (!user) return "slack";
  if (!emails.has(user)) {
    const j = await slack("users.info", { user });
    emails.set(user, j.user?.profile?.email || j.user?.real_name || "slack");
  }
  return emails.get(user)!;
}

async function reply(channel: string, thread_ts: string, text: string) {
  return slack("chat.postMessage", { channel, thread_ts, text, unfurl_links: false, unfurl_media: false });
}

async function uploadToThread(channel: string, thread_ts: string, files: { name: string; data: Uint8Array; title: string }[], comment: string) {
  const ids: { id: string; title: string }[] = [];
  for (const f of files) {
    const u = await slack("files.getUploadURLExternal", { filename: f.name, length: f.data.length });
    if (!u.ok) throw new Error(`files.getUploadURLExternal: ${u.error}`);
    const put = await fetch(u.upload_url, { method: "POST", body: f.data });
    if (!put.ok) throw new Error(`file upload: HTTP ${put.status}`);
    ids.push({ id: u.file_id, title: f.title });
  }
  const done = await slack("files.completeUploadExternal", { files: ids, channel_id: channel, thread_ts, initial_comment: comment });
  if (!done.ok) throw new Error(`files.completeUploadExternal: ${done.error}`);
}

// ---------------------------------------------------------------------------
async function claimEvent(eventId: string) {        // Slack retries deliveries; handle each event once
  if (!eventId) return true;
  const { error } = await db.from("slack_panel_events").insert({ event_id: eventId });
  if (!error) {
    if (Math.random() < 0.02) await db.from("slack_panel_events").delete().lt("created_at", new Date(Date.now() - 30 * 864e5).toISOString());
    return true;
  }
  if (error.code === "23505") return false;         // already handled
  console.error("[slack-panels] event log:", error.message);
  return true;                                      // table problem: better to answer than to drop
}

async function handleEvent(body: any) {
  const ev = body.event;
  if (!ev || ev.type !== "message" || !Array.isArray(ev.files) || !ev.files.length) return;
  if (ev.bot_id || (ev.subtype && !["file_share", "thread_broadcast"].includes(ev.subtype))) return;
  if (ev.user && ev.user === (await botUserId())) return;             // our own uploads
  if (!(await isPanelChannel(ev.channel))) return;
  if (!(await claimEvent(body.event_id))) return;

  const root = ev.thread_ts || ev.ts;                                 // the thread this spec belongs to
  const inThread = !!ev.thread_ts && ev.thread_ts !== ev.ts;
  await slack("reactions.add", { channel: ev.channel, timestamp: ev.ts, name: "eyes" });
  const who = await whoIs(ev.user);
  try {
    for (const f of ev.files) await handleFile(ev.channel, root, inThread, f, who);
  } finally {
    await slack("reactions.remove", { channel: ev.channel, timestamp: ev.ts, name: "eyes" });
  }
}

async function handleFile(channel: string, root: string, inThread: boolean, file: any, who: string) {
  if (!(file.url_private_download || file.url_private) || file.file_access === "check_file_info") {
    const j = await slack("files.info", { file: file.id });
    if (j.ok) file = j.file;
  }
  const name: string = file.name || file.title || "file";
  const type = String(file.filetype || "").toLowerCase();
  const mime = String(file.mimetype || "");
  const builder = `<${panelLink()}|Panel Builder>`;

  if (mime.startsWith("image/") || ["heic", "jpg", "jpeg", "png", "gif", "webp"].includes(type)) {
    return reply(channel, root, `I can't read photos of a spec. Post the co-man's PDF here, or build the panel in ${builder}.`);
  }
  if (["xlsx", "xls", "xlsm", "csv"].includes(type)) {
    return reply(channel, root, `I can't read Excel specs yet. Use *New from spec…* in ${builder} — it maps the columns for you.`);
  }
  if (!(type === "pdf" || mime === "application/pdf" || /\.pdf$/i.test(name))) {
    return reply(channel, root, `I couldn't read *${escSlack(name)}*. I read co-man spec PDFs (Veritacor, ACB, or any PDF with an ingredient table). You can also start in ${builder}.`);
  }
  if ((file.size ?? 0) > MAX_BYTES) {
    return reply(channel, root, `*${escSlack(name)}* is over 20 MB — too big for me. Try *New from spec…* in ${builder}.`);
  }

  try {
    // 1. download (bot token + files:read)
    const res = await fetch(file.url_private_download || file.url_private, { headers: { Authorization: `Bearer ${BOT_TOKEN}` } });
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!res.ok || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
      console.error("[slack-panels] download", res.status, res.headers.get("content-type"));
      return reply(channel, root, `I couldn't download *${escSlack(name)}* from Slack. (Check that the NutraPack app has the \`files:read\` scope.)`);
    }

    // 2. read it with the builder's import
    const [pdfjs] = await Promise.all([loadPdfjs(), loadFonts(db, BUCKET)]);
    const imp = await importSpec({ bytes, filename: name, pdfjs });

    // 3. new panel, or update the one this thread is about
    let target: any = null, ambiguous = false;
    if (inThread) {
      const { data: panels, error } = await db.from("panel_projects")
        .select("id, name, data, files").eq("slack_channel", channel).eq("slack_thread_ts", root).order("created_at");
      if (error) throw error;
      if (panels?.length === 1) target = panels[0];
      else if (panels?.length > 1) {
        const want = norm(imp.header.product || imp.project.name);
        target = panels.find((p: any) => norm(p.name) === want || norm(p.data?.name) === want)
          ?? panels.find((p: any) => (p.files || []).some((f: any) => want && norm(f.name).includes(want)))
          ?? null;
        ambiguous = !target;
      }
    }
    const before = target?.data ?? null;
    const project = target ? mergeSpec(target.data, imp.project) : imp.project;
    const out = renderPanel(project);

    // 4. save (same fields as the app's autosave) + keep the spec with the panel
    const fields = {
      name: String(project.name || "").trim() || "Untitled product",
      customer: String(project.client || "").trim() || null,
      coman: String(project.coman || "").trim() || null,
      data: project,
      updated_by: who,
    };
    let id: string, files: any[];
    if (target) {
      id = target.id; files = target.files || [];
    } else {
      const { data: row, error } = await db.from("panel_projects")
        .insert({ ...fields, panel_type: "supplement", created_by: who, files: [], slack_channel: channel, slack_thread_ts: root })
        .select("id").single();
      if (error) throw error;
      id = row.id; files = [];
    }
    const path = `${id}/${Date.now()}-${safeName(name)}`;
    const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf" });
    if (up.error) console.error("[slack-panels] spec upload", up.error.message);
    const nextFiles = up.error ? files : [
      { name, path, size: bytes.length, kind: target ? "update" : "import", uploaded_by: who, uploaded_at: new Date().toISOString() },
      ...files,
    ];
    const { error: saveErr } = await db.from("panel_projects").update(target ? { ...fields, files: nextFiles } : { files: nextFiles }).eq("id", id);
    if (saveErr) throw saveErr;

    // 5. reply in the thread: PDF + SVG + summary
    const c = out.counts;
    const lines = [
      `*${escSlack(fields.name)}*${fields.customer ? ` · ${escSlack(fields.customer)}` : ""}${fields.coman ? ` · ${escSlack(fields.coman)}` : ""} — ${target ? "updated from the revised spec" : "new panel"}`,
      `*Draft* · ${c.block} blocking · ${plural(c.warn, "warning")} — review before print`,
    ];
    const blocking = out.flags.filter((f: any) => f.sev === "block");
    if (blocking.length) {
      lines.push("", "*Blocking*");
      blocking.slice(0, 6).forEach((f: any) => lines.push(`• ${escSlack(f.msg)}${f.det ? ` — ${escSlack(f.det)}` : ""}`));
      if (blocking.length > 6) lines.push(`• …and ${blocking.length - 6} more`);
    }
    if (target) {
      const changes = diffRows(before, project);
      lines.push("", "*Changes from the previous spec*");
      if (changes.length) { changes.slice(0, 10).forEach((d: string) => lines.push(`• ${escSlack(d)}`)); if (changes.length > 10) lines.push(`• …and ${changes.length - 10} more`); }
      else lines.push("• No formula changes");
    }
    if (ambiguous) lines.push("", "_This thread has several panels and I couldn't tell which one this spec revises, so I made a new one._");
    if (imp.template === "generic") lines.push("", "_Read with the generic table reader — check every row against the spec._");
    lines.push("", `<${panelLink(id)}|Open in NutraPack>`);
    lines.push(`_Read as ${escSlack(imp.templateLabel)} · ${plural(imp.rowCount, "row")} · ${escSlack(out.metrics)}_`);

    await uploadToThread(channel, root, [
      { name: `${out.fileBase}_SFP.pdf`, data: out.pdf, title: `${fields.name} — Supplement Facts (draft PDF)` },
      { name: `${out.fileBase}_SFP.svg`, data: new TextEncoder().encode(out.svg), title: `${fields.name} — Supplement Facts (draft SVG)` },
    ], lines.join("\n"));
  } catch (e) {
    if (e instanceof SpecError) {
      const why = e.code === "no-text" ? "it has no text layer (it looks like a scan)"
        : e.code === "no-rows" ? "I opened it but didn't find an ingredient table"
        : "the PDF wouldn't open";
      return reply(channel, root, `I couldn't read *${escSlack(name)}*: ${why}. You can build it in ${builder} with *New from spec…* or by hand.`);
    }
    console.error("[slack-panels] failed on", name, e);
    return reply(channel, root, `Something went wrong with *${escSlack(name)}*. Try *New from spec…* in ${builder}.`);
  }
}
