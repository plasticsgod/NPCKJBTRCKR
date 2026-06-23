// Supabase Edge Function: cleanup-files
// Runs daily via a cron schedule. Deletes storage files for jobs whose
// files_delete_after date has passed.
//
// Deploy:   supabase functions deploy cleanup-files
// Schedule: in Supabase dashboard -> Edge Functions -> cleanup-files -> Schedule
//           set cron to: 0 2 * * *  (runs at 2am UTC daily)

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const today = new Date().toISOString().slice(0, 10);

  // Find jobs whose files are due for deletion.
  const { data: jobs, error: jobErr } = await supabase
    .from("jobs")
    .select("id")
    .lte("files_delete_after", today)
    .not("files_delete_after", "is", null);

  if (jobErr) {
    return new Response(JSON.stringify({ error: jobErr.message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const results = [];
  for (const job of jobs ?? []) {
    // Get all file records for this job.
    const { data: files } = await supabase
      .from("job_files").select("id, storage_path").eq("job_id", job.id);

    if (!files?.length) continue;

    // Delete from storage.
    const paths = files.map((f) => f.storage_path);
    await supabase.storage.from("job-files").remove(paths);

    // Delete metadata records.
    await supabase.from("job_files").delete().eq("job_id", job.id);

    // Clear the deletion date so it doesn't run again.
    await supabase.from("jobs").update({ files_delete_after: null }).eq("id", job.id);

    results.push({ job_id: job.id, deleted: paths.length });
  }

  return new Response(JSON.stringify({ cleaned: results }), {
    status: 200, headers: { ...cors, "Content-Type": "application/json" },
  });
});
