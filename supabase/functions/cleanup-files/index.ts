import { createClient } from "jsr:@supabase/supabase-js@2";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const today = new Date().toISOString().slice(0,10);
  const { data: jobs } = await supabase.from("jobs").select("id").lte("files_delete_after",today).not("files_delete_after","is",null);
  const results = [];
  for (const job of jobs ?? []) {
    const { data: files } = await supabase.from("job_files").select("id,storage_path").eq("job_id",job.id);
    if (!files?.length) continue;
    await supabase.storage.from("job-files").remove(files.map((f:any)=>f.storage_path));
    await supabase.from("job_files").delete().eq("job_id",job.id);
    await supabase.from("jobs").update({files_delete_after:null}).eq("id",job.id);
    results.push({job_id:job.id,deleted:files.length});
  }
  return new Response(JSON.stringify({cleaned:results}),{status:200,headers:{...cors,"Content-Type":"application/json"}});
});
