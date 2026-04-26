# How to put the SE Grader online (no terminal required)

Written for Reid. About 30–45 minutes of clicking through web forms — no command line, no code editor. If anything looks different from what's described, message me and we'll figure it out.

## What you'll end up with

A live website at a URL like `se-grader.vercel.app` (or a custom domain you pick) that the SE community can use to grade YouTube conversations against the rubric.

## What you need before starting

1. The unzipped `se-grader-vercel/` folder on your computer (from the zip I gave you).
2. SEI's GitHub account, signed in.
3. About $5 to prepay for the AI service (Anthropic). This covers roughly 50–100 graded conversations. You add money only when you choose to.
4. ~30 minutes.

We'll do three things, in this order:

- **Step 1.** Get an Anthropic API key (the AI's password). 5–10 min.
- **Step 2.** Upload the project to GitHub. 10 min.
- **Step 3.** Connect Vercel to that repo and deploy. 10–15 min.

---

## Step 1 — Get an Anthropic API key

This is the key the website uses to talk to Claude. It's secret — don't share it publicly.

1. Open <https://console.anthropic.com/> in a new tab.
2. Click **Sign Up** (top right). Use SEI's preferred email — you might want to make this a shared organizational email rather than a personal one.
3. Confirm the email link you receive.
4. After signing in, you'll see a dashboard. In the left sidebar, click **API Keys**.
5. Click **Create Key**. Give it a name like "SE Grader". Choose your "default" workspace if asked.
6. **Copy the key it shows you.** It starts with `sk-ant-`. Paste it somewhere safe (like a password manager or a sticky note for the next 30 minutes). **You won't be able to see it again** — if you lose it, you can always create a new one.
7. In the left sidebar, go to **Plans & Billing** → **Buy Credits**. Add $5 to start. (You can always add more later.)
8. *Optional but recommended*: under **Plans & Billing → Usage Limits**, set a monthly cap of $20 or whatever you're comfortable with. This protects you from a bug or abuse running up a big bill.

**Done with step 1.** Keep that `sk-ant-...` key handy — you'll paste it into Vercel in step 3.

---

## Step 2 — Upload the project to GitHub

We need the code on GitHub so Vercel can read it.

1. Open <https://github.com/new> (you should already be signed in as SEI).
2. Fill in the form:
   - **Owner**: pick the SEI organization if you have one, otherwise your personal account.
   - **Repository name**: `se-grader` (or anything you like; lowercase, no spaces).
   - **Description**: `Street Epistemology conversation grader.`
   - **Public** vs **Private**: either is fine. Public means anyone can read the code (not the API key); private keeps the code internal.
   - **Initialize this repository with**: leave all checkboxes UNCHECKED. We'll upload our own files.
3. Click **Create repository** (green button at the bottom).
4. You'll land on a mostly empty repo page. Look for the link near the top that says **"uploading an existing file"** (it's in a sentence like "or upload an existing file"). Click it.
5. Now: **open the unzipped `se-grader-vercel` folder in your file browser** (Finder on Mac, Explorer on Windows). Select **everything inside it** — `index.html`, `app.js`, `styles.css`, `rubric.js`, `rubric.json`, `package.json`, `vercel.json`, the `api` folder, this `DEPLOY.md`, and `README.md`. **Don't select the parent `se-grader-vercel` folder itself — select the contents.**
6. Drag the selection into the GitHub upload area. The web page will show each file uploading. The `api` folder will become an `api/analyze.js` entry — that's correct.
7. Wait until all files show up in the list with green checkmarks.
8. Scroll to the bottom of the page. In the **Commit changes** box, leave the default message. Click the green **Commit changes** button.
9. The page reloads and you'll see all the files in your repo. You should see folders/files: `api/`, `app.js`, `index.html`, `package.json`, `rubric.js`, `rubric.json`, `styles.css`, `vercel.json`, `README.md`, `DEPLOY.md`.

**Done with step 2.** The code is now on GitHub.

> **Trouble:** If the drag-drop doesn't work for the `api` folder, you can instead click "Add file → Create new file", type `api/analyze.js` as the filename (the slash creates the folder), and paste in the contents of `api/analyze.js`. Then commit and repeat as needed.

---

## Step 3 — Deploy on Vercel

Now we make the GitHub repo into a live website.

1. Open <https://vercel.com/signup>.
2. Click **Continue with GitHub**. Sign in with the same GitHub account you just used.
3. When Vercel asks how you want to install — pick the SEI GitHub organization (if you used one) or your personal account. Allow Vercel access to either *all* repos or just the `se-grader` repo (either is fine; "just this one" is more conservative).
4. After signup, you land on Vercel's dashboard. Click **Add New…** → **Project**.
5. You'll see a list of your GitHub repos. Find **se-grader** and click **Import**.
6. The project setup screen appears. Most defaults are right:
   - **Project Name**: leave as `se-grader` (or change it — this becomes part of your URL).
   - **Framework Preset**: it should auto-detect "Other" — that's correct (we're not using a framework).
   - **Root Directory**: leave as `./`.
   - **Build & Output Settings**: leave the defaults; don't toggle anything.
7. **Important step — Environment Variables.** Expand the "Environment Variables" section if it isn't already.
   - **Name**: `ANTHROPIC_API_KEY`
   - **Value**: paste the `sk-ant-...` key you got in Step 1.
   - Click **Add**.
8. Click the big **Deploy** button at the bottom.
9. Wait 30–90 seconds. You'll see a build log scroll by, then a celebratory screen with confetti. The site is live.
10. Click **Continue to Dashboard**, then click your project name. You'll see a "Domains" panel listing your URL — something like `se-grader-abc123.vercel.app`. Click it. Your site loads.

**Done.** The SE Grader is live on the internet.

---

## Step 4 — Test it

1. On the live site, click **Try sample data** to confirm the UI works.
2. Now try a real video. Paste a short SE conversation (5–10 minutes is a good first test) into the YouTube URL field. **Leave the Backend URL field empty** — the site automatically uses `/api/analyze` on Vercel, so you don't have to set it.
3. Click **Grade conversation**.
4. Wait 20–60 seconds. You should see a graded result.

If it errors:
- "No transcript available" → the video has no captions. Pick another video, or paste the transcript directly under "Advanced".
- "Server misconfigured" → the API key didn't make it into Vercel. Go back to Vercel project → Settings → Environment Variables and check `ANTHROPIC_API_KEY` is there. After fixing, click "Redeploy" on the latest deployment.
- Anything else → screenshot the error and send it to me.

---

## Things you might want to do later (all optional)

**Custom domain.** In Vercel project → Settings → Domains → add `se-grader.streetepistemologyinternational.org` (or whatever subdomain you want). Vercel will give you a DNS record to add at your domain registrar.

**Lock down the backend** so only your live site can call it (preventing other people from using your API budget). In Vercel → Settings → Environment Variables, add `ALLOWED_ORIGINS` set to your Vercel URL (e.g. `https://se-grader.vercel.app`). Save and redeploy.

**Update the site.** Edit any file in the GitHub repo via the web UI (click the file → pencil icon → edit → commit). Vercel detects the change and redeploys automatically within ~60 seconds.

**Monitor cost.** Anthropic dashboard → Usage. Each grade costs roughly $0.05–0.10. Vercel hosting itself is free up to generous limits.

**Roll back a bad change.** Vercel project → Deployments → click an older one → "Promote to Production".

---

## Costs (running totals)

- **Vercel hosting**: free for SEI's level of use (Hobby plan: 100 GB bandwidth/month, 100 hours of function time/month).
- **GitHub**: free.
- **Anthropic API**: pay-as-you-go. ~$0.05 per graded conversation. The $5 you prepaid covers ~50–100 grades.
- **Domain (if you want one)**: $10–15/year, charged by your registrar.

Total ongoing cost for moderate use: under $5/month, often $0.

---

## When something breaks

- The **GitHub repo** is the source of truth. Vercel reads from it.
- If the **site goes down**, check Vercel → Deployments. The most recent deployment shows status (Ready, Building, Failed). A failed build keeps the previous version live.
- If a **grade fails**, check Vercel → project → Logs → click the most recent function invocation. The error usually explains itself ("Anthropic API error 401" = wrong API key, etc.).
- Worst case, **delete the Vercel project** and re-import the GitHub repo (re-add the API key). Five minutes to recover.
