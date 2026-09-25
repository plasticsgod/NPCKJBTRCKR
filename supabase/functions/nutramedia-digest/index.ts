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
const DEFAULT_FOCUS = ["Eduardo Trevino", "Christina Carpenter", "Taylor Knox"];   // Monday names or emails

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
// updates: [{ body, text_body, created_at, creator:{id,name},
//             item:{ id, name, board:{id,name}, column_values:[{ persons_and_teams:[{id,kind}] }] },
//             replies:[...] }]
// users:   [{ id, name, email }] non-guest team members (everyone else = client/guest)
export function buildMondayDigest(d: any, now: Date) {
  const cutoff = now.getTime() - LOOKBACK_DAYS * 864e5;
  const team = new Map<string, any>((d.users || []).map((u: any) => [String(u.id), u]));
  const focus = new Set<string>((d.focusEmails || []).map((e: string) => e.trim().toLowerCase()));
  const isFocus = (id: string) => {
    const u = team.get(id) || {};
    return focus.has(String(u.email || "").toLowerCase()) || focus.has(String(u.name || "").toLowerCase());
  };
  const assignees = (item: any) => {
    const ids = new Set<string>();
    for (const cv of item?.column_values || []) for (const p of cv?.persons_and_teams || []) if (p.kind !== "team" && team.has(String(p.id))) ids.add(String(p.id));
    return [...ids];
  };

  // Every post on each item (updates + comments). A later written post by a
  // teammate other than the asker = answered. Reactions are never read.
  const itemPosts = new Map<string, { t: number; by: string }[]>();
  for (const u of d.updates || []) {
    if (!u?.item) continue;
    const list = itemPosts.get(u.item.id) || itemPosts.set(u.item.id, []).get(u.item.id)!;
    for (const p of [u, ...(u.replies || [])]) list.push({ t: new Date(p.created_at).getTime(), by: String(p.creator?.id || "") });
  }

  // Open (item, person) pairs — keep the oldest wait per pair.
  const open = new Map<string, { item: any; who: string; t: number }>();
  const add = (item: any, who: string, t: number) => {
    const k = item.id + "|" + who, prev = open.get(k);
    if (!prev || t < prev.t) open.set(k, { item, who, t });
  };
  for (const u of d.updates || []) {
    if (!u?.item) continue;
    for (const post of [u, ...(u.replies || [])]) {
      const t = new Date(post.created_at).getTime(), by = String(post.creator?.id || "");
      if (t < cutoff) continue;
      const answered = (itemPosts.get(u.item.id) || []).some((p) => p.t > t && p.by !== by && team.has(p.by));
      if (answered) continue;
      const tagged = mentionedIds(post.body).filter((id) => team.has(id) && id !== by);
      if (tagged.length) { for (const who of tagged) add(u.item, who, t); continue; }
      // No @mention: only client/guest messages need an answer → the item's assigned person(s).
      if (!team.has(by)) {
        const owners = assignees(u.item);
        if (owners.length) for (const who of owners) add(u.item, who, t); else add(u.item, "unassigned", t);
      }
    }
  }
  if (!open.size) return null;

  const first = (id: string) => id === "unassigned" ? "Unassigned" : String(team.get(id)?.name || "Unknown").split(" ")[0];
  const days = (t: number) => Math.floor((now.getTime() - t) / 864e5);

  // One row per item: everyone it's waiting on + the longest wait.
  const byItem = new Map<string, { item: any; whos: string[]; t: number }>();
  for (const o of open.values()) {
    const r = byItem.get(o.item.id) || byItem.set(o.item.id, { item: o.item, whos: [], t: o.t }).get(o.item.id)!;
    if (!r.whos.includes(o.who)) r.whos.push(o.who);
    r.t = Math.min(r.t, o.t);
  }
  const rows = [...byItem.values()].sort((a, b) => a.t - b.t);
  const late = rows.filter((r) => days(r.t) >= LATE_DAYS);

  const slug = d.slug;
  const itemUrl = (it: any) => slug && it.board?.id ? `https://${slug}.monday.com/boards/${it.board.id}/pulses/${it.id}` : (slug ? `https://${slug}.monday.com` : "https://monday.com");
  const rowLine = (r: any) => {
    const n = days(r.t);
    return `${n >= LATE_DAYS ? "🔴" : "🟡"} *${n}d*   <${itemUrl(r.item)}|${esc(clip(r.item.name, 48))}>  ·  _${esc(clip(r.item.board?.name || "", 28))}_  ·  ${esc(r.whos.map(first).join(", "))}`;
  };

  // Counts per person (distinct items), you three first.
  const perPerson = new Map<string, number>();
  for (const o of open.values()) perPerson.set(o.who, (perPerson.get(o.who) || 0) + 1);
  const tally = (ids: string[]) => ids.sort((a, b) => (perPerson.get(b)! - perPerson.get(a)!)).map((id) => `${esc(first(id))} *${perPerson.get(id)}*`).join("  ·  ");
  const mineIds = [...perPerson.keys()].filter((id) => id !== "unassigned" && isFocus(id));
  const teamIds = [...perPerson.keys()].filter((id) => !mineIds.includes(id));

  const today = now.toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "short", day: "numeric" });
  const top = rows.slice(0, 10);
  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: `🦄 ${rows.length} unanswered on Monday · ${late.length} late`, emoji: true } },
    { type: "context", elements: [{ type: "mrkdwn", text: `<!channel>  ·  ${today}  ·  last ${LOOKBACK_DAYS} days, all workspaces` }] },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: [`*⏳ OLDEST FIRST*  —  showing ${top.length} of ${rows.length}`, ...top.map(rowLine)].join("\n") } },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: [
      "*📊 BY PERSON*",
      mineIds.length ? `🎯 *You three* —  ${tally(mineIds)}` : "🎯 *You three* —  nothing waiting 🎉",
      teamIds.length ? `👥 *Team* —  ${tally(teamIds)}` : "",
    ].filter(Boolean).join("\n") } },
    { type: "divider" },
    { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open Monday.com" }, url: slug ? `https://${slug}.monday.com` : "https://monday.com" }] },
    { type: "context", elements: [{ type: "mrkdwn", text: `Clears once anyone on the team writes on the item (comment or new update). Reactions don't count. Untagged client messages count toward whoever is assigned. 🔴 = ${LATE_DAYS}+ days.` }] },
  ];
  return { text: `<!channel> 🦄 ${rows.length} unanswered on Monday, ${late.length} late`, blocks };
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
        item { id name board { id name } column_values(types: [people]) { ... on PeopleValue { persons_and_teams { id kind } } } }
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
