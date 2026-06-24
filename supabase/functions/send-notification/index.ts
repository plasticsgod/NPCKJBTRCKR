// Supabase Edge Function: send-notification
// Sends email notifications via Resend for task assignments and @mentions.
//
// Deploy:  supabase functions deploy send-notification
// Secret:  supabase secrets set RESEND_API_KEY=re_your_key_here
//          supabase secrets set FROM_EMAIL=noreply@nutrapack.co
//
// Request body:
//   { type: "assignment", to: "user@email.com", task: "Task name",
//     project: "Project name", assignedBy: "someone@email.com" }
//   { type: "mention", to: "user@email.com", task: "Task name",
//     project: "Project name", mentionedBy: "someone@email.com", body: "post text" }

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}

const APP_URL = "https://app.nutrapack.co";
const FROM    = Deno.env.get("FROM_EMAIL") ?? "noreply@nutrapack.co";

function assignmentEmail(to: string, task: string, project: string, assignedBy: string) {
  return {
    from: `NutraPack App <${FROM}>`,
    to,
    subject: `You've been assigned to "${task}"`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#14110d">
        <div style="background:#14110d;padding:20px 28px;border-radius:10px 10px 0 0">
          <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:.04em">NUTRAPACK</span>
          <span style="color:#ff5b1f;font-size:12px;font-weight:700;margin-left:12px;background:#ff5b1f;color:#fff;padding:3px 10px;border-radius:999px">APP</span>
        </div>
        <div style="border:1px solid #e8e3db;border-top:none;border-radius:0 0 10px 10px;padding:28px">
          <p style="font-size:15px;margin:0 0 16px">Hi there,</p>
          <p style="font-size:15px;margin:0 0 20px">
            <strong>${assignedBy}</strong> assigned you to a task in <strong>${project}</strong>.
          </p>
          <div style="background:#faf9f5;border:1px solid #e8e3db;border-radius:8px;padding:16px 20px;margin-bottom:24px">
            <p style="margin:0;font-size:13px;color:#9b958a;letter-spacing:.06em;text-transform:uppercase">Task</p>
            <p style="margin:6px 0 0;font-size:17px;font-weight:700">${task}</p>
            <p style="margin:4px 0 0;font-size:13px;color:#9b958a">${project}</p>
          </div>
          <a href="${APP_URL}/#projects" style="display:inline-block;background:#ff5b1f;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:999px">
            Open in NutraPack App →
          </a>
          <p style="margin:24px 0 0;font-size:12px;color:#9b958a">
            You received this because you were assigned to a task in NutraPack App.
          </p>
        </div>
      </div>`,
  };
}

function mentionEmail(to: string, task: string, project: string, mentionedBy: string, body: string) {
  return {
    from: `NutraPack App <${FROM}>`,
    to,
    subject: `${mentionedBy} mentioned you in "${task}"`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#14110d">
        <div style="background:#14110d;padding:20px 28px;border-radius:10px 10px 0 0">
          <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:.04em">NUTRAPACK</span>
          <span style="color:#ff5b1f;font-size:12px;font-weight:700;margin-left:12px;background:#ff5b1f;color:#fff;padding:3px 10px;border-radius:999px">APP</span>
        </div>
        <div style="border:1px solid #e8e3db;border-top:none;border-radius:0 0 10px 10px;padding:28px">
          <p style="font-size:15px;margin:0 0 16px">Hi there,</p>
          <p style="font-size:15px;margin:0 0 20px">
            <strong>${mentionedBy}</strong> mentioned you in <strong>${project}</strong>.
          </p>
          <div style="background:#faf9f5;border:1px solid #e8e3db;border-radius:8px;padding:16px 20px;margin-bottom:24px">
            <p style="margin:0;font-size:13px;color:#9b958a;letter-spacing:.06em;text-transform:uppercase">Task · ${task}</p>
            <p style="margin:10px 0 0;font-size:15px;line-height:1.5;white-space:pre-wrap">${body}</p>
          </div>
          <a href="${APP_URL}/#projects" style="display:inline-block;background:#ff5b1f;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:999px">
            View in NutraPack App →
          </a>
          <p style="margin:24px 0 0;font-size:12px;color:#9b958a">
            You received this because you were mentioned in a NutraPack App post.
          </p>
        </div>
      </div>`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // Require signed-in user.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Not signed in." }, 401);

    const body = await req.json();
    const { type, to } = body;
    if (!to || !type) return json({ error: "Missing to or type." }, 400);

    // Don't email yourself.
    if (to === user.email) return json({ skipped: "self-notification" });

    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) return json({ error: "RESEND_API_KEY not configured." }, 500);

    const email = type === "assignment"
      ? assignmentEmail(to, body.task, body.project, body.assignedBy)
      : mentionEmail(to, body.task, body.project, body.mentionedBy, body.body);

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(email),
    });
    const result = await res.json();
    if (!res.ok) return json({ error: "Resend failed.", detail: result }, 502);
    return json({ sent: true, id: result.id });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
