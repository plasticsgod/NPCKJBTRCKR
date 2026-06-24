import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Returns the list of users who have signed up, for the person picker.
// Uses the public profiles approach: reads from auth.users via a safe RPC or
// falls back to tracking users who have created posts/tasks.
export function useUsers() {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    // Collect unique authors from tasks and posts as a lightweight user roster.
    // This avoids needing admin access to auth.users.
    async function load() {
      const [{ data: tasks }, { data: posts }] = await Promise.all([
        supabase.from("tasks").select("owner").not("owner", "is", null),
        supabase.from("task_posts").select("author"),
      ]);
      const { data: { user } } = await supabase.auth.getUser();
      const all = new Set();
      if (user?.email) all.add(user.email);
      (tasks ?? []).forEach((t) => t.owner && all.add(t.owner));
      (posts ?? []).forEach((p) => p.author && all.add(p.author));
      setUsers([...all].sort());
    }
    load();
  }, []);

  return users;
}
