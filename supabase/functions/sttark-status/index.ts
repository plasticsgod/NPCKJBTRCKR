// Supabase Edge Function: sttark-status
// READ-ONLY. Fetches current Sttark order statuses so the app can display
// them next to your own work-order status. Never writes anything to Sttark.
//
// Deploy:  supabase functions deploy sttark-status
// Secret:  supabase secrets set STTARK_API_KEY=sk_live_your_key_here
//
// Request body: { "ids": ["987971", "986331", ...] }
// Response:     { "statuses": { "987971": { "status_label": "Printing", ... }, ... } }

import { createClient } from "jsr:@supabase/supabase-js@2";

const STTARK_BASE = "https://www.sttark.com";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // 1. Require a signed-in NutraPack user.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Not signed in." }, 401);

    const { ids } = await req.json().catch(() => ({ ids: [] }));
    const wanted = new Set((ids ?? []).map((x: unknown) => String(x)));
    if (wanted.size === 0) return json({ statuses: {} });

    // 2. Call Sttark's read-only orders endpoint. The docs were inconsistent
    //    about the header prefix, so try Bearer first, then Token as a fallback.
    const apiKey = Deno.env.get("STTARK_API_KEY");
    if (!apiKey) return json({ error: "Sttark API key not configured." }, 500);

    const url = `${STTARK_BASE}/customer-api/orders?limit=200`;
    async function callSttark(prefix: string) {
      return await fetch(url, {
        headers: { "Authorization": `${prefix} ${apiKey}`, "Accept": "application/json" },
      });
    }

    let ordersRes = await callSttark("Bearer");
    if (ordersRes.status === 401 || ordersRes.status === 403) {
      ordersRes = await callSttark("Token"); // fallback to the other documented style
    }
    const ordersJson = await ordersRes.json().catch(() => null);
    if (!ordersRes.ok || !ordersJson?.data?.orders) {
      return json({ error: "Sttark request failed.", detail: ordersJson }, 502);
    }

    // 3. Index by id, return only the linked ones.
    const statuses: Record<string, unknown> = {};
    for (const o of ordersJson.data.orders) {
      const id = String(o.id);
      if (wanted.has(id)) {
        statuses[id] = {
          status_label: o.status_label ?? null,
          status_id: o.status_id ?? null,
          quoted_total: o.quoted_total ?? null,
          total_qty: o.total_qty ?? null,
          modified: o.modified ?? null,
        };
      }
    }
    return json({ statuses });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
