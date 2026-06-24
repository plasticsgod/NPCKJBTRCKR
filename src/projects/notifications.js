import { supabase } from "../supabaseClient";

// Sends a notification email via the send-notification Edge Function.
// Fails silently — a notification failure should never block the user action.
async function notify(payload) {
  try {
    const { error } = await supabase.functions.invoke("send-notification", { body: payload });
    if (error) console.warn("Notification failed:", error.message);
  } catch (err) {
    console.warn("Notification error:", err);
  }
}

// Call when a task is assigned to someone.
export function notifyAssignment({ to, task, project, assignedBy }) {
  if (!to) return;
  notify({ type: "assignment", to, task, project, assignedBy });
}

// Call when someone is @mentioned in a post or reply.
export function notifyMentions({ mentions = [], task, project, mentionedBy, body }) {
  for (const to of mentions) {
    if (to !== mentionedBy) {
      notify({ type: "mention", to, task, project, mentionedBy, body });
    }
  }
}
