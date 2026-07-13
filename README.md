# NutraPack App

*Last updated: July 13, 2026*

An internal operations app for the NutraPack team. Built with React + Vite, with
Supabase as the backend (database, logins, file storage, live updates, and a few
serverless functions). Every signed-in employee shares the same data, and changes
appear for everyone in real time.

It's one app with seven sections:

- **Dashboard** — YTD labels printed, **revenue and Label Profit** (from per-job
  cost/charge), active orders, top clients, open tasks, and SVG charts (monthly
  trend, orders by status, top clients, tasks donut).
- **Projects** — a Monday.com-style task tracker: projects, tasks, multiple
  assignees, due dates, and a per-task activity feed with posts, threaded replies,
  **emoji reactions**, image **and file attachments**, and name-based `@mentions`.
  Tasks filter/sort, drag between projects, and each project has a **Members**
  button for guest access.
- **Label Work Orders** — the print-job tracker. Create, edit, search, bulk-delete.
  Jobs printed at Sttark link to their Sttark order for automatic status. Each job
  has **cost / client charge / deposit** fields plus **Proofs** (branded cover
  sheets) and **Artwork** links, available immediately on create.
- **Plastics Work Orders** — a parallel tracker for plastics (no Sttark): qty in
  tubs/pallets/containers, origin/port shipping tab, and a **Pricing tab** that
  pulls estimator products and snapshots cost/charge onto the order.
- **Plastics Estimator** — a store-style quote builder: search or browse the
  tabbed catalog (Tubs / Lids / Sets) and "Add to estimate"; each line gets
  unit + quantity + a required per-line margin; manual shipping strip; grouped
  Factory → Tariff → Landed **Edit pricing** (append-only signed versions);
  Save quote + branded PDF export.
- **Plastic Quotes** — history of every saved quote (with customer + quote date):
  search, expand line items, re-download the PDF, or **"Send to plastics work
  orders"** (creates a pre-filled order with cost & charge).
- **Customers** — one record per company (contact name, email, phone, address,
  notes). The list shows each customer's orders, revenue, and deposits owed; the
  detail view pulls together **all** their label orders, plastics orders, and
  quotes in one place. Jobs and quotes link to a customer automatically, and a new
  company is created the first time you use its name.

Across every page: **global search** (⌘K / Ctrl+K), a **notification bell** whose
entries open the exact task, **toasts**, loading **skeletons**, a consistent
**motion system**, and optimistic updates. **Access is role-based:** the internal
team and invited *members* see everything; invited *guests* see only the projects
they're added to (view + comment).

This guide assumes you've never deployed a site before. Follow it top to bottom
once and you'll have a live, password-protected app your team can use.

---

## The big picture (read this first)

There are three core services, each with a different job:

- **GitHub** stores the *code* (this folder). It does not run the app.
- **Supabase** is the *backend* — database, employee logins, file storage, the
  serverless ("Edge") functions, and live updates.
- **Vercel** takes the code from GitHub, serves the live website, and is where you
  plug in your Supabase keys.

Two optional outside services power specific features:

- **Resend** sends the Projects notification emails (assignments and `@mentions`).
- **Sttark** (a print vendor) provides live order statuses for jobs printed there.

You do **not** "connect Supabase to GitHub." The app code (in GitHub, deployed by
Vercel) talks to Supabase using two values: a URL and a key. That's the only
connection that matters for the website itself.

---

## Part 1 — Set up Supabase (your backend)

### 1a. Create the project

1. Go to https://supabase.com and create a free account.
2. Click **New project**. Give it a name (e.g. `nutrapack`), set a database
   password (save it somewhere), pick a region near you, and create it.

### 1b. Create the database tables

The database is defined by a set of SQL files in the `supabase/` folder. For a
brand-new project, run them **in this order** — each builds on the one before, and
running them out of order will error. For each file: open **SQL Editor** → **New
query**, paste the whole file, click **Run**, wait for "Success," then move to the
next.

1. `schema.sql` — the base `jobs` table and its security rules.
2. `add_print_qty.sql` — adds the print-quantity column to jobs.
3. `add_sttark_order_id.sql` — adds the Sttark order link column to jobs.
4. `add_file_storage.sql` — proof-file table, the auto-delete date column, and the
   `job-files` storage bucket. (See the note about the bucket below.)
5. `add_artwork_links.sql` — the artwork-links table.
6. `add_pricing.sql` — the pricing-versions table (and seeds the current pricing).
7. `add_profiles.sql` — the user roster used by Projects.
8. `add_projects.sql` — projects and tasks.
9. `add_multi_assignee.sql` — upgrades tasks to support multiple assignees.
10. `add_projects_v2.sql` — adds the posts/replies activity feed.
11. `add_notifications.sql` — the in-app notification bell table.
12. `add_task_reads.sql` — per-user read tracking for task updates.
13. `add_task_images.sql` — image attachments: the **`task-images`** storage bucket
    (public) and `images` columns on posts/replies.
14. `add_task_likes.sql` — likes on posts/replies.
15. `add_task_files.sql` — file attachments (`files` columns; reuses the
    `task-images` bucket under a `files/` subpath).
16. `add_task_reactions.sql` — emoji reactions on posts/replies (replaces likes).
17. `add_job_financials.sql` — `cost` + `revenue` columns on jobs (profit tracking).
18. `add_job_deposit.sql` — deposit status on jobs (Not Applicable / Paid / Owed).
19. `add_plastic_quotes.sql` — saved estimator quotes (auto quote numbers).
20. `add_plastic_jobs.sql` — the Plastics Work Orders table (separate from jobs).
21. `add_plastic_job_pricing.sql` — pricing snapshot columns on plastic jobs.
22. `add_notification_task_link.sql` — `task_id` on notifications (click-to-open).
23. `add_guest_access.sql` — **the access-control rewrite**: roles, `project_members`,
    and row-level rules (internal team hard-coded; guests see only their projects).
24. `add_workspace_members.sql` — invited full-access "members."
25. `add_client_access.sql` — client role + `client_prices` foundation (client UI
    not built yet).
26. `add_quote_date.sql` — `quote_date` on saved quotes.
27. `add_customers.sql` — **customer records**: the `customers` table, `customer_id`
    links on jobs / plastic_jobs / plastic_quotes, and a one-time backfill from the
    company names already in use. Additive — the old text columns are kept.

> **Why so many files?** These are the database changes as they were built up over
> time. Steps 8 → 9 → 10 in particular *must* run in order: step 10 removes things
> step 8 created. Steps 11–15 are additive and can be run in the order shown.
> A consolidated `schema-consolidated.sql` exists as a from-scratch reference, but
> the live database was built from these individual files.

### 1c. Create the storage bucket (for proof files)

`add_file_storage.sql` tries to create a private bucket named **`job-files`** and
its access rules. If your Supabase project doesn't allow creating buckets from SQL,
create it by hand first: **Storage** → **New bucket** → name it exactly
`job-files` → set it **Private** → **Create**, then re-run `add_file_storage.sql`
so the access policies are applied. Without this bucket, proof uploads will fail.

### 1d. Grab your keys

Left sidebar → **Project Settings** (gear icon) → **API**. Copy these two values —
you'll need them for local development and again for Vercel:

- **Project URL** (looks like `https://abcd1234.supabase.co`)
- **anon public** key (a long string)

> The anon key is *meant* to be public — it's safe in a browser app. Your data is
> protected by the Row Level Security rules from the SQL files, which only let
> signed-in employees read or write.

---

## Part 2 — Run it on your own computer (optional but recommended)

This lets you confirm everything works before deploying.

1. Install [Node.js](https://nodejs.org) (the "LTS" version) if you don't have it.
2. Open a terminal in this project folder and run:
   ```
   npm install
   ```
3. Make your environment file: copy `.env.example` to a new file named `.env`, then
   paste in your two Supabase values:
   ```
   VITE_SUPABASE_URL=https://abcd1234.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```
4. Start it:
   ```
   npm run dev
   ```
5. Open the address it prints (usually http://localhost:5173). Create an account,
   sign in, and add a test job. If it saves and shows up, you're ready to deploy.

> Email notifications and live Sttark statuses depend on the Edge Functions in
> Part 5. The core app works without them; those two features just stay quiet until
> the functions are deployed.

---

## Part 3 — Put the code on GitHub (a new repo)

Use a **new, separate repo** — don't add this to your existing website. It's its own
app with its own deploys and its own list of people who can access it.

1. Create a free account at https://github.com if you don't have one.
2. Click **New repository**. Name it `nutrapack-app`, set it to **Private**, and
   create it (don't add a README — this project already has one).
3. GitHub shows you commands to push existing code. From a terminal in this folder,
   run them. They look like this (use the ones GitHub shows you):
   ```
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/nutrapack-app.git
   git push -u origin main
   ```

The `.gitignore` file already stops your `.env` (with your keys) and the Supabase
CLI's `supabase/.temp/` cache from being uploaded. **Never commit your `.env`.**

---

## Part 4 — Deploy with Vercel (the live site)

1. Go to https://vercel.com and sign up **with your GitHub account** (easiest).
2. Click **Add New → Project**, find your repo, and click **Import**. Vercel
   auto-detects Vite, so you don't change the build settings.
3. Before clicking Deploy, open **Environment Variables** and add the same two
   values from Part 1:

   | Name | Value |
   |------|-------|
   | `VITE_SUPABASE_URL` | your Supabase project URL |
   | `VITE_SUPABASE_ANON_KEY` | your anon public key |

4. Click **Deploy**. After a minute you'll get a live URL like
   `https://your-app.vercel.app`. That's your app.

From now on, every time you `git push` to GitHub, Vercel rebuilds and updates the
live site automatically.

> The notification emails link to `https://app.nutrapack.co`. If your live site has
> a different address, update `APP_URL` in
> `supabase/functions/send-notification/index.ts` so the email buttons point to the
> right place.

---

## Part 5 — Edge Functions (for emails, Sttark, and cleanup)

The app uses three serverless functions that live in `supabase/functions/`. They're
optional in the sense that the core app runs without them, but each one powers a
feature, so deploy them to get the full app.

You deploy these with the **Supabase CLI** from your computer. Install it once
(`brew install supabase/tap/supabase` on Mac), then `supabase login` and
`supabase link --project-ref YOUR-PROJECT-REF`. (Your project ref is the `abcd1234`
part of your Supabase URL.)

### `send-notification` — assignment & mention emails (via Resend)

Sends an email when someone is assigned to a task or `@mentioned` in the Projects
feed. It uses [Resend](https://resend.com) to send mail.

```
supabase secrets set RESEND_API_KEY=re_your_key_here
supabase secrets set FROM_EMAIL=noreply@nutrapack.co
supabase functions deploy send-notification
```

Get the `RESEND_API_KEY` from your Resend account, and set `FROM_EMAIL` to an
address on a domain you've verified in Resend. Notifications fail silently if this
isn't set up — they'll never block someone from posting or assigning.

### `cleanup-files` — auto-delete old proof files

When a job is marked **Delivered**, its proof files are scheduled to delete 30 days
later (you can extend this date on the job). This function does the deleting. It's
meant to run on a daily schedule.

```
supabase functions deploy cleanup-files
```

Then set its schedule: Supabase dashboard → **Edge Functions** → `cleanup-files` →
**Schedule**, cron `0 2 * * *` (runs at 2am UTC daily). It uses Supabase's built-in
service-role key, so there's no extra secret to set.

### `sttark-status` — live order status from Sttark

A read-only function that the Work Orders page calls to fetch the current status of
linked Sttark orders; statuses are mapped onto NutraPack's own statuses and a linked
job updates itself automatically. There's a helper script, `setup-sttark.sh`, that
installs the CLI, links the project, stores your Sttark key, and deploys the
function:

```
bash setup-sttark.sh
```

It will prompt for your **Sttark API key** (`sk_live_...`) and store it as the
`STTARK_API_KEY` secret. You can also do the steps by hand:

```
supabase secrets set STTARK_API_KEY=sk_live_your_key_here
supabase functions deploy sttark-status
```

> Note: `setup-sttark.sh` has a specific project ref hard-coded in its
> `supabase link` line. If you're deploying to a *different* Supabase project than
> the original, edit that line (or run the manual steps above) so it links to yours.

---

## Part 6 — Add people (invite-only)

**Self sign-up is disabled** (Supabase → Authentication → "Allow new users to sign
up" is off) and the login screen has no create-account form. People are added from
inside the app: **avatar menu → "Invite member or guest"** — enter their email and
pick the access level. The `invite-user` Edge Function creates the account, emails
them a set-password link, and grants access.

- **Member** — full app, like the core team.
- **Guest** — only the projects they're added to (view + comment). Manage per-project
  guests via the **Members** button on each project header.

The four core-team emails are hard-coded as always-internal in `add_guest_access.sql`
(and mirrored in `App.jsx` / the Edge Function), so the team can never be locked out.
Because of the row-level rules, an account with no grants sees nothing.

**Display names:** the app shows friendly names (and avatar initials) instead of raw
emails in Projects. Those are mapped in `src/projects/userMap.js`. When someone new
joins, add their `email: "Name"` line there so they show up nicely.

---

## Changing things later

- **Job statuses / board columns:** edit the `STATUSES` list in
  `src/supabaseClient.js`.
- **Printing facilities in the dropdown:** edit `FACILITIES` in the same file. The
  value `"Sttark"` is special — picking it reveals the Sttark Order ID field on a job.
- **Task statuses (To do / In progress / Stuck / Done):** edit `TASK_STATUSES` in
  `src/projects/constants.js`.
- **Team display names:** edit `src/projects/userMap.js` (see above).
- **Add a new field to a job:** add the column in Supabase
  (`alter table public.jobs add column my_field text;`), then add it to the form in
  `src/components/JobModal.jsx`.
- **Sttark status mapping:** how Sttark's statuses translate to yours lives in
  `src/sttark/statusMap.js`.
- **Pricing:** edit pricing in-app via the Plastics Estimator's "Edit pricing"
  button — it publishes a new signed version rather than overwriting history. The
  starting data was seeded by `add_pricing.sql`.
- **Later: admin vs. staff roles:** the app code won't need to change much — you
  swap the `using (true)` policies in the SQL files for role-aware ones.

---

## Project structure

```
nutrapack-app/
├─ index.html                  page shell + fonts
├─ package.json                dependencies and scripts
├─ vite.config.js              build config (Vite + React)
├─ .env.example                template for your Supabase keys
├─ setup-sttark.sh             one-time Sttark function setup (Mac)
├─ supabase/
│  ├─ schema.sql               base jobs table  ─┐
│  ├─ add_print_qty.sql                          │
│  ├─ add_sttark_order_id.sql                    │  run in the order
│  ├─ add_file_storage.sql      proofs + bucket  │  listed in Part 1b
│  ├─ add_artwork_links.sql                      │
│  ├─ add_pricing.sql                            │
│  ├─ add_profiles.sql                           │
│  ├─ add_projects.sql                           │
│  ├─ add_multi_assignee.sql                     │
│  ├─ add_projects_v2.sql       posts + replies ─┘
│  ├─ add_notifications.sql     in-app bell
│  ├─ add_task_reads.sql        read tracking
│  ├─ add_task_images.sql       image attach + task-images bucket
│  ├─ add_task_likes.sql        likes
│  ├─ add_task_files.sql        file attach
│  └─ functions/
│     ├─ send-notification/     assignment & mention emails (Resend)
│     ├─ cleanup-files/         daily proof-file cleanup (cron)
│     └─ sttark-status/         live Sttark order status (read-only)
└─ src/
   ├─ main.jsx                  app entry point
   ├─ supabaseClient.js         Supabase connection + STATUSES / FACILITIES
   ├─ App.jsx                   auth gate, page routing, jobs data + live updates
   ├─ index.css                 all styling (NutraPack look)
   ├─ components/
   │  ├─ Auth.jsx               sign in / sign up
   │  ├─ Header.jsx             top bar (brand, search, notifications, account menu)
   │  ├─ Sidebar.jsx            slide-out navigation between the four pages
   │  ├─ SearchOverlay.jsx      global ⌘K search (tasks, projects, work orders)
   │  ├─ NotificationBell.jsx   in-app notifications dropdown
   │  ├─ Toaster.jsx            global toast() messages (mounted once in App)
   │  ├─ Dashboard.jsx          KPI cards (incl. revenue/profit) + SVG charts
   │  ├─ Skeletons.jsx           loading placeholders (dashboard/work orders/projects)
   │  ├─ WorkOrders.jsx         label job list, search, bulk delete, Sttark sync
   │  ├─ JobTable.jsx           the label work-orders table
   │  ├─ JobBoard.jsx           kanban board view (unused; see "Notes")
   │  ├─ JobModal.jsx           create/edit a label job; cost/charge/deposit; Proofs + Artwork
   │  ├─ PlasticWorkOrders.jsx  plastics order list (no Sttark)
   │  ├─ PlasticJobTable.jsx    the plastics orders table
   │  ├─ PlasticJobModal.jsx    plastics order modal: Details / Pricing / Shipping tabs
   │  ├─ PlasticQuotes.jsx      saved-quote history + send-to-work-orders
   │  ├─ Customers.jsx         customer list + detail (orders, quotes, revenue)
   │  ├─ DatePicker.jsx         shared calendar control
   │  ├─ PlasticsEstimator.jsx  store-style quote builder + tabbed catalog
   │  ├─ PriceList.jsx          (unused — superseded by the builder's catalog)
   │  ├─ DraftQuote.jsx         (unused — superseded by the builder)
   │  └─ PricingEditor.jsx      grouped Factory→Tariff→Landed editor; signed versions
   ├─ lib/
   │  ├─ pricing.js             pricing math (pure functions)
   │  ├─ time.js                relative timestamps ("2h ago") + exact tooltip
   │  ├─ quotePdf.js            branded draft-quote PDF (loads jsPDF from CDN)
   │  └─ proofCover.js          branded proof cover sheet (pdf-lib)
   ├─ sttark/
   │  ├─ status.js              calls the sttark-status function
   │  ├─ statusMap.js           Sttark status → NutraPack status
   │  └─ fields.js              Sttark label-spec reference (see "Notes")
   └─ projects/
      ├─ Projects.jsx           projects + tasks UI (role-aware; Members button)
      ├─ Avatar.jsx             avatar + portal hover card
      ├─ TaskDrawer.jsx         task detail + activity feed (reactions, attachments)
      ├─ constants.js           task statuses
      ├─ useUsers.js            loads the user roster from profiles
      ├─ userMap.js             email → display name / initials
      └─ notifications.js       calls the send-notification function
```

---

## Database reference

The tables the app uses, and what each is for:

| Table | Purpose |
|-------|---------|
| `jobs` | every work order (incl. `print_qty`, `sttark_order_id`, `files_delete_after`) |
| `job_files` | proof-file metadata; the files live in the `job-files` storage bucket |
| `job_artwork` | links to approved artwork (URLs, not files) |
| `pricing_versions` | append-only signed pricing snapshots (Plastics Estimator) |
| `profiles` | registered users, so Projects can list and `@mention` people |
| `projects` | project groups in the Projects page |
| `tasks` | tasks within a project (multiple assignees via `owners`) |
| `task_posts` | activity-feed posts on a task (incl. `images` text[] + `files` jsonb) |
| `task_replies` | threaded replies to a post (incl. `images` text[] + `files` jsonb) |
| `task_reads` | per-user "last read" time per task (drives unread indicators) |
| `task_likes` | legacy likes (superseded by `task_reactions`) |
| `task_reactions` | emoji reactions on posts/replies |
| `notifications` | in-app bell rows (assignments, mentions, comments; `task_id` opens the task) |
| `plastic_quotes` | saved estimator quotes (lines, total, customer, quote date) |
| `customers` | one row per company (contact name, email, phone, address, notes) |
| `plastic_jobs` | plastics work orders (qty/unit, cost/revenue, origin/port, pricing snapshot) |
| `project_members` | guest access grants: email ↔ project |
| `workspace_members` | invited full-access members |
| `client_users` / `client_prices` | client-role foundation (UI not built yet) |

Plus two **storage buckets**: a private `job-files` bucket for proof files, and a
public `task-images` bucket for comment image **and file** attachments (files live
under a `files/` subpath).

---

## Design & UI systems

- **Theme:** warm off-white (`--bg`) with a **two-tone** system — near-black
  (`--primary`) carries the weight (primary buttons, active tabs/toggles, the
  selected project), and the brand orange (`--accent`, `#ff5b1f`) is the highlight
  (badges, counts, focus rings, "Add to estimate", overdue). Status pills keep their
  own colors (green = delivered/paid, yellow = waiting, red = in production,
  blue = shipped).
- **Motion:** `--ease` / `--dur` / `--dur-fast` variables; transform + opacity only
  (GPU-cheap on phones). Modals, the task drawer, dropdowns, and pickers animate
  from their anchor; buttons have a press state. All of it is disabled automatically
  for anyone with "reduce motion" turned on.
- **Loading:** `Skeletons.jsx` renders layout-matched placeholders on the Dashboard,
  Work Orders, and Projects while data loads.
- **Optimistic updates:** task fields and work-order status/facility change in the UI
  instantly and revert if the save fails.
- **Projects navigation:** the burger menu switches **app section**; inside Projects a
  left **rail** (searchable, alphabetical) switches **project**. On phones the rail
  becomes a "current project" dropdown.

## Notes & known loose ends

A few things worth being aware of (none block normal use):

- **`src/components/JobBoard.jsx`** is a kanban board view that isn't currently
  wired into any page — Work Orders renders the table only. It's kept in case the
  board view is brought back; you can ignore or delete it otherwise.
- **`PriceList.jsx` and `DraftQuote.jsx`** are no longer rendered — the estimator's
  store-style builder replaced both. Kept as harmless dead files.
- **`task_likes`** (table + old CSS) was superseded by emoji reactions
  (`task_reactions`); the old table is unused but left in place.
- **`src/sttark/fields.js`** is a reference list of Sttark label specs (substrates,
  laminates, etc.). It isn't imported anywhere yet — it looks staged for a future
  job-spec form.
- **The base `jobs` table** (in `schema.sql`) has an unused `facility` column and a
  default status of `'New'` that isn't in the app's status list. Neither causes
  problems (the app always sets a real status when creating a job), but they can be
  cleaned up if you ever consolidate the schema.
- **`supabase/.temp/`** is the Supabase CLI's local cache (which project you're
  linked to, tool versions, etc.). It's machine state, not source, and is
  git-ignored — don't commit it.

### Maintenance ideas

- **Consolidate the SQL.** The ten migration files can be merged into a single,
  clean `schema.sql` for future from-scratch setups. The current files are kept
  as-is because they reflect what's already been run on the live database.
- **Document `sttark-status` internals.** This README describes that function from
  the outside (what calls it, what it returns, how it's deployed). If you add its
  source under `supabase/functions/sttark-status/`, this section can be expanded.
