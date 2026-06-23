import { supabase } from "../supabaseClient";

// Calls the read-only sttark-status Edge Function for a set of Sttark order ids.
// Returns { [id]: { status_label, quoted_total, ... } }. Fails soft: on any
// error it returns {} so the Work Orders page never breaks if Sttark is down.
export async function fetchSttarkStatuses(ids) {
  const clean = [...new Set(ids.filter(Boolean).map(String))];
  if (clean.length === 0) return {};
  try {
    const { data, error } = await supabase.functions.invoke("sttark-status", {
      body: { ids: clean },
    });
    if (error) {
      console.warn("Sttark status fetch failed:", error.message);
      return {};
    }
    return data?.statuses ?? {};
  } catch (err) {
    console.warn("Sttark status fetch error:", err);
    return {};
  }
}
