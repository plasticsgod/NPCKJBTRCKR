// Supabase Edge Function: notify-quote-decision
// Emails a CLIENT when their quote is approved or rejected. Called by a member
// from the Plastic Quotes page after they approve/reject.
//
// Requires a Resend API key as a secret:
//   supabase secrets set RESEND_API_KEY=<your_resend_key>
// Deploy:
//   supabase functions deploy notify-quote-decision
//
// Request body:
//   { email, status: "approved"|"rejected", customer?, note?, total? }

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM = "NutraPack <noreply@nutrapack.co>";
const APP_URL = "https://app.nutrapack.co";

const INTERNAL = [
  "eduardonutramedia@gmail.com",
  "jeff.weisser@nutrapack.co",
  "taylor.knox@nutrapack.co",
  "cc@nutramedia.co",
];

function esc(s: string) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] || c));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    // Only a signed-in internal member may trigger a decision email.
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!token) return json({ error: "Not signed in." }, 401);
    const { data: ures, error: uerr } = await admin.auth.getUser(token);
    if (uerr || !ures?.user) return json({ error: "Not signed in." }, 401);
    const callerEmail = (ures.user.email ?? "").toLowerCase();

    let allowed = INTERNAL.includes(callerEmail);
    if (!allowed) {
      const { data: prof } = await admin.from("profiles").select("role").eq("id", ures.user.id).maybeSingle();
      allowed = prof?.role === "internal" || prof?.role === "member";
    }
    if (!allowed) {
      const { data: wm } = await admin.from("workspace_members").select("member_email").ilike("member_email", callerEmail).maybeSingle();
      allowed = !!wm;
    }
    if (!allowed) return json({ error: "Only members can send decision emails." }, 403);

    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim();
    const status = body.status === "approved" ? "approved" : body.status === "rejected" ? "rejected" : null;
    if (!email || !email.includes("@")) return json({ error: "Invalid recipient email." }, 400);
    if (!status) return json({ error: "Invalid status." }, 400);

    const approved = status === "approved";
    const note = String(body.note ?? "").trim();
    const customer = String(body.customer ?? "").trim();
    const total = body.total != null ? Number(body.total) : null;
    const totalStr = total != null ? "$" + total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";

    const subject = approved ? "Your NutraPack quote was approved" : "Update on your NutraPack quote";
    const heading = approved ? "Your quote was approved" : "Your quote was not approved";
    const lead = approved
      ? "Good news — we've approved your quote. Here are the details:"
      : "Thanks for your quote. After review, we're not able to move forward with it as submitted.";

    const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;">
      <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
        <div style="background:#1d1d1f;color:#fff;border-radius:16px 16px 0 0;padding:20px 24px;font-weight:700;font-size:18px;letter-spacing:-0.02em;">NUTRAPACK</div>
        <div style="background:#fff;border:1px solid #ececec;border-top:none;border-radius:0 0 16px 16px;padding:26px 24px;">
          <h1 style="margin:0 0 10px;font-size:20px;letter-spacing:-0.02em;color:${approved ? "#0f7a4d" : "#c2261f"};">${esc(heading)}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#3a3a3c;">${esc(lead)}</p>
          ${customer ? `<p style="margin:0 0 4px;font-size:13px;color:#6e6e73;">Company</p><p style="margin:0 0 14px;font-size:15px;font-weight:600;">${esc(customer)}</p>` : ""}
          ${totalStr ? `<p style="margin:0 0 4px;font-size:13px;color:#6e6e73;">Quote total</p><p style="margin:0 0 14px;font-size:15px;font-weight:600;">${esc(totalStr)}</p>` : ""}
          ${note ? `<div style="background:#f5f5f7;border-radius:12px;padding:14px 16px;margin:6px 0 18px;"><p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.04em;color:#6e6e73;">NOTE FROM NUTRAPACK</p><p style="margin:0;font-size:14px;line-height:1.5;">${esc(note)}</p></div>` : ""}
          <a href="${APP_URL}" style="display:inline-block;background:#1d1d1f;color:#fff;text-decoration:none;font-size:14px;font-weight:500;padding:11px 20px;border-radius:999px;">View in the portal</a>
          <p style="margin:20px 0 0;font-size:12px;color:#a1a1a6;">${approved ? "We'll be in touch about next steps." : "You're welcome to build a new quote anytime in the portal."}</p>
        </div>
      </div></body></html>`;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [email], subject, html }),
    });
    if (!r.ok) {
      const t = await r.text();
      return json({ error: "Email failed: " + t }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

