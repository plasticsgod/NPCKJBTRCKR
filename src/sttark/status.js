import { supabase } from "../supabaseClient";

// Calls the read-only sttark-status Edge Function for a set of Sttark order ids.
// Returns { statuses } where statuses is { [id]: { status_label, ... } }.
// Fails soft: on any error it returns {} so Work Orders never breaks.
export async function fetchSttarkStatuses(ids) {
  const clean = [...new Set(ids.filter(Boolean).map(String))];
  if (clean.length === 0) return { statuses: {} };
  try {
    const { data, error } = await supabase.functions.invoke("sttark-status", {
      body: { ids: clean },
    });
    if (error) {
      console.warn("Sttark status fetch failed:", error.message);
      return { statuses: {} };
    }
    return { statuses: data?.statuses ?? {} };
  } catch (err) {
    console.warn("Sttark status fetch error:", err);
    return { statuses: {} };
  }
}
