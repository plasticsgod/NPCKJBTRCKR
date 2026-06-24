import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Fetches all registered users from the profiles table.
// Also upserts the current user so they appear in the list.
export function useUsers() {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    async function load() {
      // Upsert current user into profiles so they show up.
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        await supabase.from("profiles").upsert(
          { id: user.id, email: user.email },
          { onConflict: "id" }
        );
      }
      // Fetch all registered users.
      const { data } = await supabase.from("profiles").select("email").order("email");
      setUsers((data ?? []).map((r) => r.email));
    }
    load();
  }, []);

  return users;
}
