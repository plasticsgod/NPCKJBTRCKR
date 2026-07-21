// Supabase Edge Function: invite-user
// Emails an invite (creating the account) and grants access — either a
// full-access "member" (whole app), a "guest" scoped to one project, or a
// "client" who only ever sees the plastics estimator (final prices only).
//
// Deploy:  supabase functions deploy invite-user
// (No extra secrets needed — SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
//  provided to every Edge Function automatically.)
//
// Request body:
//   { email: "person@company.com", scope: "workspace" }                 // member, whole app
//   { email: "person@company.com", scope: "project", projectId: "uuid" } // guest, one project
//   { email: "person@company.com", scope: "client", customerId: "uuid"|null } // client (customer optional)
//
// Only existing internal users / members may call this; everyone else is 403.

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = "https://app.nutrapack.co";

// Hard-coded internal team — always allowed to invite (matches the SQL).
const INTERNAL = [
  "eduardonutramedia@gmail.com",
  "jeff.weisser@nutrapack.co",
  "taylor.knox@nutrapack.co",
  "cc@nutramedia.co",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    // --- Identify and authorize the caller ----------------------------------
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!token) return json({ error: "Not signed in." }, 401);

    const { data: ures, error: uerr } = await admin.auth.getUser(token);
    if (uerr || !ures?.user) return json({ error: "Not signed in." }, 401);
    const callerEmail = (ures.user.email ?? "").toLowerCase();

    let allowed = INTERNAL.includes(callerEmail);
    if (!allowed) {
      const { data: prof } = await admin
        .from("profiles").select("role").eq("id", ures.user.id).maybeSingle();
      allowed = prof?.role === "internal" || prof?.role === "member";
    }
    if (!allowed) {
      const { data: wm } = await admin
        .from("workspace_members").select("member_email").ilike("member_email", callerEmail).maybeSingle();
      allowed = !!wm;
    }
    if (!allowed) return json({ error: "Only members can invite people." }, 403);

    // --- Validate the request -----------------------------------------------
    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    const scope = body.scope;
    const projectId = body.projectId ?? null;
    const customerId = body.customerId ?? null;   // optional for clients

    if (!email || !email.includes("@")) return json({ error: "Enter a valid email address." }, 400);
    if (scope !== "workspace" && scope !== "project" && scope !== "client")
      return json({ error: "Invalid access type." }, 400);
    if (scope === "project" && !projectId) return json({ error: "Pick a project." }, 400);

    // --- Create the account + send the invite email -------------------------
    let invited = false;
    const { error: invErr } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: APP_URL });
    if (invErr) {
      const msg = (invErr.message ?? "").toLowerCase();
      const alreadyExists =
        msg.includes("already") || msg.includes("registered") || msg.includes("exists");
      if (!alreadyExists) return json({ error: invErr.message }, 400);
      // Account already exists — skip the email, just grant access below.
    } else {
      invited = true;
    }

    // --- Grant access --------------------------------------------------------
    if (scope === "client") {
      // Clients see ONLY the estimator. customer_id may be null (link later from
      // the Customers page).
      const { error } = await admin.from("client_users")
        .upsert({ member_email: email, customer_id: customerId, added_by: callerEmail },
                { onConflict: "member_email" });
      if (error) return json({ error: error.message }, 400);
    } else if (scope === "workspace") {
      const { error } = await admin.from("workspace_members")
        .upsert({ member_email: email, added_by: callerEmail }, { onConflict: "member_email" });
      if (error) return json({ error: error.message }, 400);
    } else {
      const { error } = await admin.from("project_members")
        .upsert({ project_id: projectId, member_email: email, added_by: callerEmail },
                { onConflict: "project_id,member_email" });
      if (error) return json({ error: error.message }, 400);
    }

    return json({ ok: true, invited, alreadyExisted: !invited });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
