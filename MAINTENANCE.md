# NutraPack App — Maintenance Guide

How to keep this app healthy, deploy changes safely, and recover when something
breaks. Written for how this project is actually run (GitHub web edits → Vercel,
Supabase backend, no local git). Skim the **Routine cadence** first; everything
else is reference for when you need it.

---

## The app at a glance

| Piece | What it is | Where it lives |
| --- | --- | --- |
| Frontend | React + Vite app | GitHub repo `plasticsgod/NPCKJBTRCKR` (branch `main`) → auto-deploys to Vercel |
| Live site | What the team uses | https://app.nutrapack.co |
| Backend | Database, auth, file storage, realtime, edge functions | Supabase project `NPCKJBTRCKR` (ref `pghtqeftxcfonoqbmyhg`) |
| Email | Assignment / mention notifications | Resend, sending from the verified `nutrapack.co` domain |

**How deploys work:** editing files on GitHub (or uploading them) commits to
`main`, and Vercel automatically rebuilds and publishes the site. The one
exception is **edge functions**, which deploy separately (see below).

---

## Routine cadence

A light, realistic schedule. The point is to catch problems early, not to create busywork.

**After every change you deploy**
- [ ] Check Vercel → Deployments shows the new build as **Ready** (not Error).
- [ ] Open the live site and confirm the thing you changed works. Hard-refresh (Cmd/Ctrl+Shift+R).

**Monthly**
- [ ] Confirm a recent database backup exists (Supabase → Database → Backups). If your plan has no automatic backups, export manually now.
- [ ] Glance at Supabase → Reports for usage (storage, bandwidth, active users) — make sure you're not near a limit.
- [ ] Clear or act on any GitHub security alerts (Settings → Code security).

**Quarterly**
- [ ] Re-confirm who can access each system (table below) and that backups are still happening.
- [ ] Skim this file and the README; update anything that's drifted.

---

## Deploying safely

A bad edit is rarely catastrophic here — but these habits remove almost all the risk.

1. **A failed build can't take the site down.** If a commit doesn't build, Vercel
   keeps the last working version live and marks the new deploy as *Error*. Worst
   case is "nothing changed," not "site down."
2. **Deploy multi-file changes together.** When a change spans more than one file
   (e.g. a `.jsx` + `index.css` pair), use GitHub's **Add file → Upload files** to
   commit them in one go, so the live site never sees a half-updated state.
3. **Test risky changes on a preview first.** Make a branch, edit there, and Vercel
   gives you a temporary preview URL to check on phone/desktop before it touches
   the live site. Merge the branch into `main` when it looks right.
4. **Know your undo.** Vercel → Deployments can instantly roll back: promote any
   previous working deploy. On GitHub you can also revert a commit.

---

## Backups — the thing you can't undo

Code is always recoverable from GitHub. Your **data** (jobs, projects, updates,
uploaded files) lives only in Supabase — losing it is the one truly bad outcome,
so this is the highest priority.

- Check what your Supabase plan covers in **Database → Backups**. Paid plans
  include automatic daily backups and point-in-time recovery; the free plan
  generally does not.
- If you don't have automatic backups, set a recurring reminder (monthly at the
  very least) to **export the database** from that screen.
- Periodically download anything critical from the **`job-files` storage bucket**;
  storage is separate from the database backup.

---

## Keeping the backend online

- **Free Supabase projects pause after inactivity** — the app stops working until
  someone un-pauses it. Confirm your project's plan and pause policy so this never
  surprises the team. If this app is load-bearing, a paid tier removes pausing
  *and* gives you backups.
- Watch usage in **Supabase → Reports** so you're not blindsided by a limit.

---

## Secrets & access (don't skip this)

- **Never commit API keys.** The frontend only uses the Supabase **anon** key,
  which is safe to expose. The **service-role** key and the **Resend** key must
  live only in Supabase secrets / Vercel environment variables — never in the
  React code or the repo.
- **Bus factor:** make sure at least one other trusted person can get into every
  system, so the app isn't unrecoverable if you're unavailable. Fill this in and
  keep it somewhere safe (a password manager, **not** this repo):

| System | URL | Who has access |
| --- | --- | --- |
| GitHub | github.com/plasticsgod/NPCKJBTRCKR | _fill in_ |
| Vercel | vercel.com | _fill in_ |
| Supabase | supabase.com | _fill in_ |
| Domain registrar (nutrapack.co) | _fill in_ | _fill in_ |
| Resend | resend.com | _fill in_ |

---

## Dependencies & updates

For an internal tool, the right instinct is **"if it works, don't churn it."**

- Don't update packages just because newer versions exist.
- **Do** turn on GitHub's **Dependabot security alerts** (Settings → Code
  security) so you're notified only when something genuinely needs attention.
  Act on the critical ones.
- Routine "version update" PRs are optional and tend toward noise — fine to skip.
- Whenever you *do* update anything (a dependency, or Node / Vite / React), do it
  on a **branch with a preview build first**, never straight to `main`. Don't
  merge a Dependabot PR blind — confirm the preview builds and the app still works.

---

## When something breaks — where to look

Three places cover almost everything:

| Symptom | Look here |
| --- | --- |
| Build failed / blank page after deploy | Vercel → Deployments → click the failed build → logs |
| Data not loading, login issues, notifications | Supabase → Logs (database / auth / edge functions) |
| Something visually or behaviorally off in the browser | Browser DevTools → Console (right-click → Inspect) |

Turn on **email notifications in Vercel** (and Supabase where available) so
problems find you instead of the other way around.

**Fastest recovery if a deploy broke the site:** Vercel → Deployments → promote
the last known-good deploy. Then diagnose calmly.

---

## Repo-specific notes

- **Edge functions deploy separately.** Functions like `send-notification`,
  `cleanup-files`, and `sttark-status` do **not** go out through GitHub/Vercel.
  They deploy from the project root in a terminal:
  ```
  supabase functions deploy <function-name>
  ```
  (A "Docker is not running" warning during deploy is harmless.) Keep their
  source in the repo anyway so they're versioned with everything else. Their
  secrets — `RESEND_API_KEY`, `FROM_EMAIL`, etc. — live in Supabase, not in code.
- **Auth redirect URLs:** password-reset links require `https://app.nutrapack.co`
  to be listed in Supabase → Authentication → URL Configuration → Redirect URLs
  (add `http://localhost:5173` too if you ever run it locally).
- **Email delivery (Resend):** the sending domain must stay verified to email
  anyone beyond the account's own address; the `FROM` address must be on that
  verified domain.
- **Keep notes current.** When features change, update the README and add a
  one-line "what changed and when" entry. It saves the next person — possibly
  future-you — hours.

---

## Change log (keep this going)

A running, one-line-per-change log. Newest at top.

| Date | What changed |
| --- | --- |
| _e.g. 2026-06-25_ | _Per-person avatar colors; mobile card layout for Projects; edit/delete menu on task updates_ |
