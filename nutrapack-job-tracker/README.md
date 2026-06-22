# NutraPack Job Tracker

A shared job tracker for the NutraPack team. Built with React + Vite, with
Supabase as the backend (database, login, and live updates). Every signed-in
employee sees and edits the same set of jobs, and changes appear for everyone in
real time.

This guide assumes you've never deployed a site before. Follow it top to bottom
once, and you'll have a live, password-protected app your team can use.

---

## The big picture (read this first)

There are three separate services, and they each do a different job:

- **GitHub** stores the *code* (this folder). It does not run the app.
- **Supabase** is the *backend* — it stores your jobs and handles employee logins.
- **Vercel** takes the code from GitHub and serves the live website, and it's
  where you plug in your Supabase keys.

You do **not** "connect Supabase to GitHub." The app code (in GitHub, deployed by
Vercel) talks to Supabase using two values: a URL and a key. That's the only
connection that matters.

---

## Part 1 — Set up Supabase (your backend)

1. Go to https://supabase.com and create a free account.
2. Click **New project**. Give it a name (e.g. `nutrapack`), set a database
   password (save it somewhere), pick a region near you, and create it.
3. When it finishes setting up, open **SQL Editor** in the left sidebar →
   **New query**.
4. Open the file `supabase/schema.sql` from this project, copy everything, paste
   it into the editor, and click **Run**. This creates your `jobs` table and the
   security rules. You should see "Success."
5. Now grab your keys: left sidebar → **Project Settings** (gear icon) → **API**.
   Copy these two values, you'll need them twice below:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (a long string)

> The anon key is *meant* to be public — it's safe in a browser app. Your data is
> protected by the security rules (Row Level Security) from the SQL file, which
> only let signed-in employees read or write.

---

## Part 2 — Run it on your own computer (optional but recommended)

This lets you confirm everything works before deploying.

1. Install [Node.js](https://nodejs.org) (the "LTS" version) if you don't have it.
2. Open a terminal in this project folder and run:
   ```
   npm install
   ```
3. Make your environment file: copy `.env.example` to a new file named `.env`,
   then paste in your two Supabase values:
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

---

## Part 3 — Put the code on GitHub (a new repo)

Use a **new, separate repo** — don't add this to your existing website. It's its
own app with its own deploys and its own list of people who can access it.

1. Create a free account at https://github.com if you don't have one.
2. Click **New repository**. Name it `nutrapack-job-tracker`, set it to
   **Private**, and create it (don't add a README — this project already has one).
3. GitHub shows you commands to push existing code. From a terminal in this
   folder, run them. They look like this (use the ones GitHub shows you):
   ```
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/nutrapack-job-tracker.git
   git push -u origin main
   ```

The `.gitignore` file already stops your `.env` (with your keys) from being
uploaded. Never commit your `.env`.

---

## Part 4 — Deploy with Vercel (the live site)

1. Go to https://vercel.com and sign up **with your GitHub account** (easiest).
2. Click **Add New → Project**, find your `nutrapack-job-tracker` repo, and click
   **Import**. Vercel auto-detects Vite, so you don't change the build settings.
3. Before clicking Deploy, open **Environment Variables** and add the same two
   values from Part 1:
   | Name | Value |
   |------|-------|
   | `VITE_SUPABASE_URL` | your Supabase project URL |
   | `VITE_SUPABASE_ANON_KEY` | your anon public key |
4. Click **Deploy**. After a minute you'll get a live URL like
   `https://nutrapack-job-tracker.vercel.app`. That's your app.

From now on, every time you `git push` to GitHub, Vercel rebuilds and updates the
live site automatically.

---

## Part 5 — Add your employees

How people get accounts depends on one Supabase setting:

- **Easiest for an internal tool:** in Supabase → **Authentication** →
  **Providers** → Email, you can turn **"Confirm email" off** so staff can sign
  up and use it immediately. Then just share the link and have them click
  "Create an account."
- **More controlled:** leave confirmation on, or in **Authentication → Users**
  click **Add user** to create each employee's login yourself.

Because of the security rules, only people with an account can see any data.

---

## Changing things later

- **Job statuses / board columns:** edit the `STATUSES` list in
  `src/supabaseClient.js`.
- **Printing facilities in the dropdown:** edit `FACILITIES` in the same file.
- **Add a new field to a job:** add the column in Supabase (SQL Editor:
  `alter table jobs add column my_field text;`), then add it to the form in
  `src/components/JobModal.jsx`.
- **Later: admin vs. staff roles:** the app code won't need to change much — you
  swap the policies in `supabase/schema.sql` for role-aware ones. Ask and I can
  write those when you're ready.

---

## Project structure

```
nutrapack-job-tracker/
├─ index.html                 page shell + fonts
├─ package.json               dependencies and scripts
├─ .env.example               template for your Supabase keys
├─ supabase/
│  └─ schema.sql              run this in Supabase to create the database
└─ src/
   ├─ main.jsx                app entry point
   ├─ supabaseClient.js       Supabase connection + status/facility lists
   ├─ App.jsx                 login gate, data loading, live updates
   ├─ index.css               all styling (NutraPack look)
   └─ components/
      ├─ Auth.jsx             sign in / sign up
      ├─ Header.jsx           top bar, view toggle, new job, sign out
      ├─ JobTable.jsx         table view
      ├─ JobBoard.jsx         board (kanban) view
      └─ JobModal.jsx         create / edit a job
```
