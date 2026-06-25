# NutraPack App

An internal operations app for the NutraPack team. Built with React + Vite, with
Supabase as the backend (database, logins, file storage, live updates, and a few
serverless functions). Every signed-in employee shares the same data, and changes
appear for everyone in real time.

It's one app with four sections:

- **Dashboard** — year-to-date labels printed, top client, active order count, and
  a breakdown of orders by status.
- **Work Orders** — the job tracker. Create, edit, search, and bulk-delete print
  jobs. Jobs printed at Sttark can be linked to their Sttark order so their status
  updates automatically. Each job also has **Proofs** (uploaded files, stamped with
  a branded cover sheet) and **Artwork** (links to approved files).
- **Projects** — a Monday.com-style task tracker: projects, tasks, multiple
  assignees, due dates, and a per-task activity feed with posts, threaded replies,
  likes, image **and file attachments**, and `@mentions`. Tasks can be filtered to
  **My tasks**, **sorted** (due date / status / name), **dragged between projects**,
  and each project shows a **progress bar**.
- **Plastics Estimator** — a tub/lid pricing and quoting tool: signed, versioned
  pricing; freight-lane and tariff math; a live price list; a quote builder; and a
  branded PDF quote export.

Across every page: a **global search** palette (the header search button or
**⌘K / Ctrl+K**) that jumps to any task, project, or work order; an in-app
**notification bell** (assignments, mentions, and comments); and brief **toast**
confirmations for saves, moves, and deletes.

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

## Part 6 — Add your employees

How people get accounts depends on one Supabase setting:

- **Easiest for an internal tool:** in Supabase → **Authentication** → **Providers**
  → Email, turn **"Confirm email" off** so staff can sign up and use it immediately.
  Then share the link and have them click "Create an account."
- **More controlled:** leave confirmation on, or in **Authentication → Users** click
  **Add user** to create each employee's login yourself.

Because of the security rules, only people with an account can see any data.

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
   │  ├─ Dashboard.jsx          YTD stats + orders-by-status
   │  ├─ WorkOrders.jsx         job list, search, bulk delete, Sttark sync
   │  ├─ JobTable.jsx           the work-orders table
   │  ├─ JobBoard.jsx           kanban board view (see "Notes" below)
   │  ├─ JobModal.jsx           create/edit a job; Proofs + Artwork tabs
   │  ├─ DatePicker.jsx         shared calendar control
   │  ├─ PlasticsEstimator.jsx  pricing + quoting page
   │  ├─ PriceList.jsx          live price list table
   │  ├─ DraftQuote.jsx         quote basket + PDF export button
   │  └─ PricingEditor.jsx      edit + sign/publish a pricing version
   ├─ lib/
   │  ├─ pricing.js             pricing math (pure functions)
   │  ├─ quotePdf.js            branded draft-quote PDF (loads jsPDF from CDN)
   │  └─ proofCover.js          branded proof cover sheet (pdf-lib)
   ├─ sttark/
   │  ├─ status.js              calls the sttark-status function
   │  ├─ statusMap.js           Sttark status → NutraPack status
   │  └─ fields.js              Sttark label-spec reference (see "Notes")
   └─ projects/
      ├─ Projects.jsx           projects + tasks UI
      ├─ TaskDrawer.jsx         task detail + activity feed (posts/replies)
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
| `task_likes` | likes on posts/replies |
| `notifications` | in-app notification bell rows (assignments, mentions, comments) |

Plus two **storage buckets**: a private `job-files` bucket for proof files, and a
public `task-images` bucket for comment image **and file** attachments (files live
under a `files/` subpath).

---

## Notes & known loose ends

A few things worth being aware of (none block normal use):

- **`src/components/JobBoard.jsx`** is a kanban board view that isn't currently
  wired into any page — Work Orders renders the table only. It's kept in case the
  board view is brought back; you can ignore or delete it otherwise.
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
