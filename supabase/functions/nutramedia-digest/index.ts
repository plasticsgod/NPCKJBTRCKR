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
  const guests = new Map<string, any>((d.guests || []).map((u: any) => [String(u.id), u]));
  const focus = new Set<string>((d.focusEmails || []).map((e: string) => e.trim().toLowerCase()));
  const isFocus = (id: string) => {
    const u = team.get(id) || {};
    return focus.has(String(u.email || "").toLowerCase()) || focus.has(String(u.name || "").toLowerCase());
  };
  // Item status from the board's Status column (label, lowercased).
  const statusOf = (item: any) => {
    const vals = (item?.column_values || []).filter((cv: any) => cv && typeof cv.label !== "undefined");
    const main = vals.find((cv: any) => /status/i.test(cv.column?.title || "")) || vals[0];
    return String(main?.label || "").trim().toLowerCase();
  };
  const isDone = (item: any) => statusOf(item) === "done";
  const isPendingReview = (item: any) => statusOf(item) === "pending review";
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
  // cat: "client" = a client is waiting on us · "internal" = teammate → teammate handoff
  const open = new Map<string, { item: any; who: string; t: number; cat: string; from: string }>();
  const add = (item: any, who: string, t: number, cat: string, from: string) => {
    const k = item.id + "|" + who + "|" + cat, prev = open.get(k);
    if (!prev || t < prev.t) open.set(k, { item, who, t, cat, from });
  };
  for (const u of d.updates || []) {
    if (!u?.item) continue;
    for (const post of [u, ...(u.replies || [])]) {
      const t = new Date(post.created_at).getTime(), by = String(post.creator?.id || "");
      if (t < cutoff) continue;
      const answered = (itemPosts.get(u.item.id) || []).some((p) => p.t > t && p.by !== by && team.has(p.by));
      if (answered) continue;
      const allTagged = mentionedIds(post.body).filter((id) => id !== by);
      if (team.has(by) && allTagged.some((id) => !team.has(id))) continue;   // tags a client → waiting on client only
      const tagged = allTagged.filter((id) => team.has(id));
      const cat = team.has(by) ? "internal" : "client";
      if (tagged.length) { for (const who of tagged) add(u.item, who, t, cat, by); continue; }
      // No @mention: only client/guest messages need an answer → the item's assigned person(s).
      if (!team.has(by)) {
        const owners = assignees(u.item);
        if (owners.length) for (const who of owners) add(u.item, who, t, "client", by); else add(u.item, "unassigned", t, "client", by);
      }
    }
  }
  // Team tagged a client (anyone not on the team) → waiting on the client until
  // someone from the client side writes on the item afterwards.
  const waitClient = new Map<string, { item: any; who: string; asker: string; t: number }>();
  for (const u of d.updates || []) {
    if (!u?.item) continue;
    for (const post of [u, ...(u.replies || [])]) {
      const t = new Date(post.created_at).getTime(), by = String(post.creator?.id || "");
      if (t < cutoff || !team.has(by)) continue;
      for (const who of mentionedIds(post.body).filter((id) => !team.has(id))) {
        const replied = (itemPosts.get(u.item.id) || []).some((p) => p.t > t && !team.has(p.by));
        if (replied) continue;
        const k = u.item.id + "|" + who, prev = waitClient.get(k);
        if (!prev || t < prev.t) waitClient.set(k, { item: u.item, who, asker: by, t });
      }
    }
  }
  // Status overrides (messages win when a client wrote something newer):
  //  • Done           → hide internal handoffs + waiting-on-client; a newer unanswered client message still shows (💬).
  //  • Pending Review → waiting on client, unless a client wrote after us (then it's already 💬 on our side).
  //  • In Queue / anything else → normal rules.
  for (const [k, o] of open) if (o.cat === "internal" && isDone(o.item)) open.delete(k);
  for (const [k, w] of waitClient) if (isDone(w.item)) waitClient.delete(k);
  const seenItems = new Map<string, any>();
  for (const u of d.updates || []) if (u?.item) seenItems.set(u.item.id, u.item);
  for (const [id, item] of seenItems) {
    if (!isPendingReview(item)) continue;
    const clientWaitingOnUs = [...open.values()].some((o) => o.item.id === id && o.cat === "client");
    if (clientWaitingOnUs) continue;
    const alreadyWaiting = [...waitClient.values()].some((w) => w.item.id === id);
    if (alreadyWaiting) continue;
    const teamPosts = (itemPosts.get(id) || []).filter((p) => team.has(p.by) && p.t >= cutoff).sort((a, b) => b.t - a.t);
    if (!teamPosts.length) continue;                              // no team activity in the last 14 days → ignore
    const owners = assignees(item);
    waitClient.set(id + "|pending", { item, who: "pending", asker: owners[0] || teamPosts[0].by, t: teamPosts[0].t });
  }
  if (!open.size && !waitClient.size) return null;

  const first = (id: string) => id === "unassigned" ? "Unassigned" : String(team.get(id)?.name || "Unknown").split(" ")[0];
  const days = (t: number) => Math.floor((now.getTime() - t) / 864e5);
  const clientName = (id: string) => id === "pending" ? "Client (Pending Review)" : String(guests.get(id)?.name || guests.get(id)?.email || "Client");

  // One row per item per category: everyone it's waiting on + the longest wait.
  const rowsFor = (cat: string) => {
    const m = new Map<string, { item: any; whos: string[]; froms: string[]; t: number }>();
    for (const o of open.values()) {
      if (o.cat !== cat) continue;
      const r = m.get(o.item.id) || m.set(o.item.id, { item: o.item, whos: [], froms: [], t: o.t }).get(o.item.id)!;
      if (!r.whos.includes(o.who)) r.whos.push(o.who);
      if (!r.froms.includes(o.from)) r.froms.push(o.from);
      r.t = Math.min(r.t, o.t);
    }
    return [...m.values()].sort((a, b) => a.t - b.t);
  };
  const clientRows = rowsFor("client"), internalRows = rowsFor("internal");
  const rows = [...clientRows, ...internalRows];
  const late = rows.filter((r) => days(r.t) >= LATE_DAYS);
  const fromName = (id: string) => team.has(id) ? first(id) : clientName(id);

  const slug = d.slug;
  const itemUrl = (it: any) => slug && it.board?.id ? `https://${slug}.monday.com/boards/${it.board.id}/pulses/${it.id}` : (slug ? `https://${slug}.monday.com` : "https://monday.com");
  const age = (r: any) => { const n = days(r.t); return `${n >= LATE_DAYS ? "🔴" : "🟡"} *${n}d*`; };
  const base = (r: any) => `<${itemUrl(r.item)}|${esc(clip(r.item.name, 48))}>  ·  _${esc(clip(r.item.board?.name || "", 28))}_`;
  const clientLine = (r: any) => `${age(r)}   ${base(r)}  ·  ${esc(r.whos.map(first).join(", "))}  _(from ${esc(r.froms.map(fromName).join(", "))})_`;
  const internalLine = (r: any) => `${age(r)}   ${base(r)}  ·  due by *${esc(r.whos.map(first).join(", "))}*  _(from ${esc(r.froms.map(fromName).join(", "))})_`;

  // Counts per person (distinct items), you three first.
  const perPerson = new Map<string, { c: number; i: number }>();
  for (const o of open.values()) {
    const x = perPerson.get(o.who) || perPerson.set(o.who, { c: 0, i: 0 }).get(o.who)!;
    if (o.cat === "client") x.c++; else x.i++;
  }
  const total = (id: string) => perPerson.get(id)!.c + perPerson.get(id)!.i;
  const itemsOf = new Map<string, Map<string, { item: any; t: number }>>();
  for (const o of open.values()) {
    const m = itemsOf.get(o.who) || itemsOf.set(o.who, new Map()).get(o.who)!;
    const prev = m.get(o.item.id);
    if (!prev || o.t < prev.t) m.set(o.item.id, { item: o.item, t: o.t });
  }
  // One row per person with a "⋯" menu: their 4 oldest items + "See all in Monday"
  // (Slack allows 5 options max in an overflow menu; each option opens the link).
  const personBlock = (id: string, icon: string) => {
    const x = perPerson.get(id)!;
    const split = [x.c ? `${x.c} 💬` : "", x.i ? `${x.i} 🛠️` : ""].filter(Boolean).join(" · ");
    const list = [...(itemsOf.get(id)?.values() || [])].sort((a, b) => a.t - b.t).slice(0, 4);
    const options = list.map((r, n) => {
      const dd = days(r.t);
      return { text: { type: "plain_text", text: clip(`${dd >= LATE_DAYS ? "🔴" : "🟡"} ${dd}d · ${r.item.name}`, 74), emoji: true }, value: `i${n}-${r.item.id}`.slice(0, 150), url: itemUrl(r.item) };
    });
    options.push({ text: { type: "plain_text", text: "See all in Monday →", emoji: true }, value: "all", url: slug ? `https://${slug}.monday.com` : "https://monday.com" });
    return {
      type: "section",
      text: { type: "mrkdwn", text: `${icon} *${esc(first(id))}* — ${total(id)}  _(${split})_` },
      accessory: { type: "overflow", action_id: `person-${id}`.slice(0, 255), options },
    };
  };
  const tally = (ids: string[]) => ids.sort((a, b) => total(b) - total(a)).map((id) => {
    const x = perPerson.get(id)!;
    const split = [x.c ? `${x.c} 💬` : "", x.i ? `${x.i} 🛠️` : ""].filter(Boolean).join(" · ");
    return `${esc(first(id))} *${total(id)}* (${split})`;
  }).join("   ");
  const mineIds = [...perPerson.keys()].filter((id) => id !== "unassigned" && isFocus(id));
  const teamIds = [...perPerson.keys()].filter((id) => !mineIds.includes(id));

  // Waiting on client: one row per item, oldest first.
  const cItems = new Map<string, { item: any; whos: string[]; askers: string[]; t: number }>();
  for (const w of waitClient.values()) {
    const r = cItems.get(w.item.id) || cItems.set(w.item.id, { item: w.item, whos: [], askers: [], t: w.t }).get(w.item.id)!;
    if (!r.whos.includes(w.who)) r.whos.push(w.who);
    if (!r.askers.includes(w.asker)) r.askers.push(w.asker);
    r.t = Math.min(r.t, w.t);
  }
  const cRows = [...cItems.values()].sort((a, b) => a.t - b.t);
  const cLine = (r: any) => `⌛ *${days(r.t)}d*   <${itemUrl(r.item)}|${esc(clip(r.item.name, 48))}>  ·  _${esc(clip(r.item.board?.name || "", 28))}_  ·  ${esc(r.whos.map(clientName).join(", "))}  _(asked by ${esc(r.askers.map(first).join(", "))})_`;
  const perClient = new Map<string, number>();
  for (const w of waitClient.values()) if (w.who !== "pending") perClient.set(w.who, (perClient.get(w.who) || 0) + 1);
  const clientTally = [...perClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, n]) => `${esc(clientName(id))} *${n}*`).join("  ·  ");

  const today = now.toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "short", day: "numeric" });
  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: `🦄 ${clientRows.length} for clients · ${internalRows.length} internal · ${cRows.length} waiting on clients`, emoji: true } },
    { type: "context", elements: [{ type: "mrkdwn", text: `<!channel>  ·  ${today}  ·  ${late.length} late (${LATE_DAYS}+ days)  ·  last ${LOOKBACK_DAYS} days, all workspaces` }] },
    { type: "divider" },
    ...(clientRows.length ? [
      { type: "section", text: { type: "mrkdwn", text: [`*💬 CLIENTS WAITING ON US*  —  oldest first, ${Math.min(10, clientRows.length)} of ${clientRows.length}`, ...clientRows.slice(0, 10).map(clientLine)].join("\n") } },
      { type: "divider" },
    ] : []),
    ...(internalRows.length ? [
      { type: "section", text: { type: "mrkdwn", text: [`*🛠️ INTERNAL HANDOFFS*  —  oldest first, ${Math.min(10, internalRows.length)} of ${internalRows.length}`, ...internalRows.slice(0, 10).map(internalLine)].join("\n") } },
      { type: "divider" },
    ] : []),
    ...(cRows.length ? [
      { type: "section", text: { type: "mrkdwn", text: [`*⌛ WAITING ON CLIENT*  —  showing ${Math.min(10, cRows.length)} of ${cRows.length}`, ...cRows.slice(0, 10).map(cLine)].join("\n") } },
      { type: "divider" },
    ] : []),
    { type: "section", text: { type: "mrkdwn", text: "*📊 BY PERSON*  —  tap ⋯ to see their oldest items" } },
    ...mineIds.sort((a, b) => total(b) - total(a)).map((id) => personBlock(id, "🎯")),
    ...teamIds.sort((a, b) => total(b) - total(a)).slice(0, 15).map((id) => personBlock(id, "👥")),
    ...(mineIds.length ? [] : [{ type: "context", elements: [{ type: "mrkdwn", text: "🎯 You three — nothing waiting 🎉" }] }]),
    ...(clientTally ? [{ type: "context", elements: [{ type: "mrkdwn", text: `🤝 *Clients* —  ${clientTally}` }] }] : []),
    { type: "divider" },
    { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open Monday.com" }, url: slug ? `https://${slug}.monday.com` : "https://monday.com" }] },
    { type: "context", elements: [{ type: "mrkdwn", text: `Clears once anyone on the team writes on the item (comment or new update). Reactions don't count. Untagged client messages count toward whoever is assigned. Waiting on client clears when anyone on the client side writes on the item. Status: Done hides it, Pending Review = waiting on client — unless a client wrote something newer. 🔴 = ${LATE_DAYS}+ days.` }] },
  ];
  return { text: `<!channel> 🦄 ${clientRows.length} for clients, ${internalRows.length} internal, ${cRows.length} waiting on clients`, blocks };
}

async function monday(query: string, token: string) {
  const res = await fetch("https://api.monday.com/v2", { method: "POST", headers: { "Content-Type": "application/json", Authorization: token }, body: JSON.stringify({ query }) });
  const out = await res.json();
  if (out.errors || out.error_message) throw new Error(JSON.stringify(out.errors || out.error_message));
  return out.data;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if ((req.headers.get("content-type") || "").includes("application/x-www-form-urlencoded")) return new Response("", { status: 200 });
  if (req.headers.get("x-digest-secret") !== Deno.env.get("DIGEST_SECRET")) return json({ error: "Unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  const token = Deno.env.get("MONDAY_API_TOKEN");
  if (!token) return json({ error: "MONDAY_API_TOKEN is not set" }, 500);

  try {
    const now = new Date();
    const cutoff = now.getTime() - LOOKBACK_DAYS * 864e5;
    const meta = await monday(`query { me { account { slug } } users(kind: non_guests, limit: 500) { id name email } guests: users(kind: guests, limit: 500) { id name email } }`, token);

    // Newest updates first, page until we're past the look-back window.
    const updates: any[] = [];
    for (let page = 1; page <= 30; page++) {
      const d = await monday(`query { updates(limit: 100, page: ${page}) {
        id body text_body created_at creator { id name }
        item { id name board { id name } column_values(types: [people, status]) { column { title } ... on PeopleValue { persons_and_teams { id kind } } ... on StatusValue { label } } }
        replies { id body text_body created_at creator { id name } }
      } }`, token);
      const batch = d.updates || [];
      updates.push(...batch);
      const newestInBatch = Math.max(...batch.map((u: any) => new Date(u.created_at).getTime()), 0);
      if (batch.length < 100 || newestInBatch < cutoff) break;
    }

    const focusEmails = (Deno.env.get("NUTRAMEDIA_FOCUS_EMAILS") || DEFAULT_FOCUS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
    const msg = buildMondayDigest({ updates, users: meta.users, guests: meta.guests, focusEmails, slug: meta.me?.account?.slug }, now);

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
