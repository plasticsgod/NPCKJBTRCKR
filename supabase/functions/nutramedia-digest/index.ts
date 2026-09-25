// Supabase Edge Function: nutramedia-digest
// Posts the NutraMedia 🦄 morning digest to a private Slack channel: Monday.com
// mentions that haven't been answered yet, across all workspaces and boards the
// token can see. Read-only on Monday — it never changes anything there.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   MONDAY_API_TOKEN          Monday personal API token (avatar → Developers → API token)
//   NUTRAMEDIA_WEBHOOK_URL    Slack incoming-webhook URL for #nutramedia-updates
//   DIGEST_SECRET             same secret the NutraPack digest uses
//   NUTRAMEDIA_FOCUS_EMAILS   optional: comma-separated Monday emails of "you three"
//
// Call: POST .../functions/v1/nutramedia-digest   header x-digest-secret: <DIGEST_SECRET>
//       body {"force": true} posts even on a quiet day · {"preview": true} returns without posting

const LOOKBACK_DAYS = 14;
const LATE_DAYS = 3;
const TZ = "America/Chicago";
const DEFAULT_FOCUS = ["eduardonutramedia@gmail.com", "cc@nutramedia.co", "taylor.knox@nutrapack.co", "tk@nutramedia.co"];

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clip = (s: string, n = 90) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

// Monday stores mentions inside the HTML body: data-mention-type="User" data-mention-id="123"
export function mentionedIds(html: string): string[] {
  const ids = new Set<string>();
  const re = /<a[^>]*data-mention-type="User"[^>]*data-mention-id="(\d+)"[^>]*>|<a[^>]*data-mention-id="(\d+)"[^>]*data-mention-type="User"[^>]*>/g;
  let m; while ((m = re.exec(String(html || "")))) ids.add(m[1] || m[2]);
  return [...ids];
}

// Pure: Monday data in → Slack message out (null on a quiet day).
// updates: [{ id, body, text_body, created_at, creator:{id,name}, item:{id,name,board:{id,name}}, replies:[...] }]
// users:   [{ id, name, email }] non-guest team members
export function buildMondayDigest(d: any, now: Date) {
  const cutoff = now.getTime() - LOOKBACK_DAYS * 864e5;
  const team = new Map<string, any>((d.users || []).map((u: any) => [String(u.id), u]));
  const focus = new Set<string>((d.focusEmails || []).map((e: string) => e.toLowerCase()));
  const isFocus = (id: string) => focus.has(String(team.get(id)?.email || "").toLowerCase());

  const open: any[] = [];
  for (const u of d.updates || []) {
    if (!u?.item) continue;
    const thread = [u, ...(u.replies || [])].map((p: any) => ({ ...p, t: new Date(p.created_at).getTime(), by: String(p.creator?.id || "") }))
      .sort((a: any, b: any) => a.t - b.t);
    for (const post of thread) {
      if (post.t < cutoff) continue;
      for (const who of mentionedIds(post.body)) {
        if (who === post.by || !team.has(who)) continue;              // self-mentions and guests/clients skipped
        // Handled once ANYONE on the team (other than whoever did the tagging)
        // replies later in the same update thread.
        const answered = thread.some((p: any) => p.t > post.t && p.by !== post.by && team.has(p.by));
        if (answered) continue;
        if (open.some((o) => o.who === who && o.item.id === u.item.id)) continue;   // one line per person per item
        const tagged = mentionedIds(post.body).filter((id) => team.has(id)).map((id) => team.get(id).name);
        open.push({ who, focus: isFocus(who), item: u.item, from: post.creator?.name || "Someone", tagged, text: post.text_body, days: Math.floor((now.getTime() - post.t) / 864e5) });
      }
    }
  }
  if (!open.length) return null;

  const slug = d.slug;
  const itemUrl = (it: any) => slug && it.board?.id ? `https://${slug}.monday.com/boards/${it.board.id}/pulses/${it.id}` : (slug ? `https://${slug}.monday.com` : "https://monday.com");
  const line = (o: any) => `• <${itemUrl(o.item)}|${esc(o.item.name)}>  _· ${esc(o.item.board?.name || "")}_\n      ${esc(o.from)} → *${esc(o.tagged.join(", "))}*: “${esc(clip(o.text))}”  ·  ${o.days >= LATE_DAYS ? `*${o.days}d* 🔴` : o.days + "d"}`;

  const sections = (title: string, list: any[]) => {
    if (!list.length) return [];
    const byPerson = new Map<string, any[]>();
    for (const o of list.sort((a, b) => b.days - a.days)) (byPerson.get(o.who) || byPerson.set(o.who, []).get(o.who))!.push(o);
    const chunks: string[] = []; let cur = title;
    for (const [id, items] of byPerson) {
      const shown = items.slice(0, 6).map(line);
      if (items.length > 6) shown.push(`_…and ${items.length - 6} more_`);
      const part = `\n*${esc(team.get(id)?.name || "Unknown")}* (${items.length})\n` + shown.join("\n");
      if ((cur + part).length > 2800) { chunks.push(cur); cur = part.trimStart(); } else cur += part;
    }
    chunks.push(cur);
    return chunks;
  };

  const mine = open.filter((o) => o.focus), rest = open.filter((o) => !o.focus);
  const late = open.filter((o) => o.days >= LATE_DAYS).length;
  const today = now.toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "short", day: "numeric" });

  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: "🦄 Unanswered on Monday", emoji: true } },
    { type: "context", elements: [{ type: "mrkdwn", text: `<!channel>  ·  ${today}  ·  Mentions nobody on the team has replied to, last ${LOOKBACK_DAYS} days, all workspaces` }] },
    { type: "section", fields: [
      { type: "mrkdwn", text: `*${mine.length}*\nWaiting on you three` },
      { type: "mrkdwn", text: `*${rest.length}*\nWaiting on the team` },
      { type: "mrkdwn", text: `*${late}*\nOlder than ${LATE_DAYS} days` },
    ] },
  ];
  for (const t of [...sections("🎯 *TAGGED — YOU THREE*", mine), ...sections("👥 *TAGGED — REST OF TEAM*", rest)]) {
    blocks.push({ type: "divider" }, { type: "section", text: { type: "mrkdwn", text: t } });
  }
  blocks.push({ type: "divider" });
  blocks.push({ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open Monday.com" }, url: slug ? `https://${slug}.monday.com` : "https://monday.com" }] });
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "A mention drops off once anyone on the team replies in that update." }] });
  return { text: `<!channel> 🦄 ${mine.length} waiting on you three, ${rest.length} on the team`, blocks: blocks.slice(0, 50) };
}

async function monday(query: string, token: string) {
  const res = await fetch("https://api.monday.com/v2", { method: "POST", headers: { "Content-Type": "application/json", Authorization: token }, body: JSON.stringify({ query }) });
  const out = await res.json();
  if (out.errors || out.error_message) throw new Error(JSON.stringify(out.errors || out.error_message));
  return out.data;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (req.headers.get("x-digest-secret") !== Deno.env.get("DIGEST_SECRET")) return json({ error: "Unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  const token = Deno.env.get("MONDAY_API_TOKEN");
  if (!token) return json({ error: "MONDAY_API_TOKEN is not set" }, 500);

  try {
    const now = new Date();
    const cutoff = now.getTime() - LOOKBACK_DAYS * 864e5;
    const meta = await monday(`query { me { account { slug } } users(kind: non_guests, limit: 500) { id name email } }`, token);

    // Newest updates first, page until we're past the look-back window.
    const updates: any[] = [];
    for (let page = 1; page <= 30; page++) {
      const d = await monday(`query { updates(limit: 100, page: ${page}) {
        id body text_body created_at creator { id name }
        item { id name board { id name } }
        replies { id body text_body created_at creator { id name } }
      } }`, token);
      const batch = d.updates || [];
      updates.push(...batch);
      const newestInBatch = Math.max(...batch.map((u: any) => new Date(u.created_at).getTime()), 0);
      if (batch.length < 100 || newestInBatch < cutoff) break;
    }

    const focusEmails = (Deno.env.get("NUTRAMEDIA_FOCUS_EMAILS") || DEFAULT_FOCUS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
    const msg = buildMondayDigest({ updates, users: meta.users, focusEmails, slug: meta.me?.account?.slug }, now);

    if (!msg && !body.force) return json({ ok: true, posted: false, reason: "quiet day", scanned: updates.length });
    const payload = msg || { text: "🦄 All clear — no unanswered mentions.", blocks: [{ type: "section", text: { type: "mrkdwn", text: "🦄 *All clear* — no unanswered mentions on Monday." } }] };
    if (body.preview) return json({ ok: true, scanned: updates.length, team: meta.users.length, preview: payload });

    const hook = Deno.env.get("NUTRAMEDIA_WEBHOOK_URL");
    if (!hook) return json({ error: "NUTRAMEDIA_WEBHOOK_URL is not set" }, 500);
    const res = await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) return json({ error: `Slack said ${res.status}: ${await res.text()}` }, 502);
    return json({ ok: true, posted: true, scanned: updates.length });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
