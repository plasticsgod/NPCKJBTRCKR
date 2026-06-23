import { supabase } from "../supabaseClient";

// Calls the read-only sttark-status Edge Function for a set of Sttark order ids.
// Returns { statuses, debug } where debug captures the raw result/error so the
// app can show what happened (temporary diagnostic aid).
export async function fetchSttarkStatuses(ids) {
  const clean = [...new Set(ids.filter(Boolean).map(String))];
  if (clean.length === 0) return { statuses: {}, debug: { note: "no linked ids" } };
  try {
    const { data, error } = await supabase.functions.invoke("sttark-status", {
      body: { ids: clean },
    });
    if (error) {
      // Try to read the function's error body for a useful message.
      let detail = error.message;
      try { detail = JSON.stringify(await error.context?.json?.()); } catch (_e) { /* ignore */ }
      return { statuses: {}, debug: { error: detail, asked: clean } };
    }
    return { statuses: data?.statuses ?? {}, debug: { ok: true, asked: clean, raw: data } };
  } catch (err) {
    return { statuses: {}, debug: { thrown: String(err), asked: clean } };
  }
}
