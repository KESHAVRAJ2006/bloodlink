# Deploying BloodLink

A complete walkthrough from a working local project to a live demo you can open on a phone.

Three free services, each doing the thing it is good at:

```
   your phone / any browser
            |
            |  https
            v
   +---------------------------+
   |  Vercel                   |   static files only: index.html, JS, CSS
   |  the built React app      |   no Node process, nothing secret here
   +---------------------------+
            |
            |  (1) HTTPS REST calls to /api/...
            |  (2) WebSocket for live requests
            v
   +---------------------------+
   |  Render (free Web Service)|   Express + Socket.IO, Node process
   |  holds MONGO_URI,         |   the only place secrets exist
   |  JWT_SECRET               |
   +---------------------------+
            |
            |  (3) MongoDB driver over TLS, port 27017
            |  (4) change stream pushes new requests back
            v
   +---------------------------+
   |  MongoDB Atlas M0         |   the bloodlink database
   +---------------------------+
```

Why it is split this way: a React build is just files, so a CDN serves it for free and instantly.
The API has to keep a Node process alive to hold the change stream open, which is what Render does.
The database is managed by Atlas because change streams and transactions need a replica set.

**Time needed:** about 45 minutes the first time. Nothing here costs money.

---

## Part 0 - what already changed in the code

These edits are **already applied** in your project. Read this section so you can explain them;
nothing here needs doing.

| File | Change | Why it matters for deployment |
| --- | --- | --- |
| `server/src/config.ts` | **new** - every environment variable is read here once | The process fails at startup with a clear message instead of a confusing error on the first request |
| `server/src/index.ts` | `PORT` from the environment, CORS allow-list, `/api/health`, graceful shutdown | Render injects `PORT` and stops services with `SIGTERM` |
| `server/src/db.ts` | reads `MONGO_URI` from config, adds `isDatabaseReachable()` | Lets the health check answer "can this API actually serve data?" |
| `server/src/middleware/auth.ts` | `JWT_SECRET` from config | No secret in code, ever |
| `server/package.json` | `build: tsc`, `start: node dist/index.js`, `engines.node >=20` | Render builds once, then runs plain Node - faster and smaller than `tsx` |
| `server/tsconfig.json` | `rootDir: src`, `outDir: dist`, `module: NodeNext` | `src/index.ts` compiles to `dist/index.js`, which is what `npm start` runs |
| `server/.env.example` | new variable names, `PORT=5000` | Matches the names you will type into Render |
| `client/src/lib/config.ts` | **new** - the only place `VITE_API_URL` is read | No `localhost` left anywhere in the client |
| `client/src/lib/api.ts`, `socket.ts` | use `API_URL` from config | One variable switches the whole app between local and deployed |
| `client/.env.development` | **new, committed** | A fresh `git clone` runs locally with no setup |
| `client/.env.example` | reference copy for the deployed site | Tells you what to put in Vercel |
| `client/vercel.json` | **new** - rewrite everything to `/index.html` | Stops `/find` returning 404 on refresh |
| `.gitignore` | ignores `.env` and every `.env.*` except the two safe ones | A committed password is the one mistake that is hard to undo |
| `seeder/seed.py` | accepts `MONGO_URI` (still accepts `MONGODB_URI`) | One variable name across the whole project |

**The local port is now 5000** (it was 4000), to match `client/.env.development`. After pulling these
changes, locally you run exactly as before:

```powershell
cd D:\bloodlink\server
npm install
npm run dev          # http://localhost:5000
```

```powershell
cd D:\bloodlink\client
npm run dev          # http://localhost:5173
```

### Environment variables, all of them

| Variable | Where it lives | Example | Secret? |
| --- | --- | --- | --- |
| `MONGO_URI` | `server/.env` locally, Render in production | `mongodb+srv://bloodlink_app:...@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority` | **yes** |
| `DB_NAME` | same | `bloodlink` | no |
| `JWT_SECRET` | same | a 96-character random hex string | **yes** |
| `JWT_EXPIRES_IN` | same, optional | `7d` | no |
| `PORT` | `server/.env` locally; Render sets its own | `5000` | no |
| `CLIENT_URL` | same | `http://localhost:5173,https://bloodlink-xyz.vercel.app` | no |
| `NODE_VERSION` | Render only | `22.17.0` | no |
| `VITE_API_URL` | `client/.env.development` locally, Vercel in production | `https://bloodlink-api.onrender.com` | no (public) |
| `VITE_ATLAS_CHART_URL` | same, optional | the Atlas Charts embed URL | no (public) |

Generate a `JWT_SECRET` now, you will need it twice:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**You should see** a long line of hex characters. Copy it into a scratch file for the next few
minutes. Anyone who knows this string can forge a login token, so it never goes into GitHub.

---

## Part 1 - MongoDB Atlas, ready for production

Two jobs here: a database user that the deployed API will use, and an IP rule that lets Render
connect at all.

### 1.1 Create a separate application user

Right now you probably have one user with "read and write to any database". The deployed API should
have its own user, limited to the one database it needs. If that password ever leaks, the damage is
limited to `bloodlink`, and you can rotate it without breaking your laptop setup.

1. Open <https://cloud.mongodb.com> and select your project.
2. Left sidebar, under **Security**, click **Database Access**.
3. Click **+ ADD NEW DATABASE USER** (top right).
4. **Authentication Method:** leave it on **Password**.
5. **Username:** `bloodlink_app`
6. **Password:** click **Autogenerate Secure Password**, then **Copy**. Paste it in your scratch
   file next to the JWT secret.
   - If you type your own password, avoid `@ : / ? # [ ] %`. Those characters have meaning inside a
     connection string and have to be percent-encoded, which is a classic hour-long bug.
7. **Database User Privileges:** click **Specific Privileges** (not "Built-in Role").
   - **Role:** `readWrite`
   - **Database:** `bloodlink`
   - leave **Collection** empty, which means all collections in that database
8. Click **Add User**.

**You should see** `bloodlink_app` in the user list with privileges shown as
`readWrite@bloodlink`. It takes about 30 seconds to become active.

Why `readWrite` and not `dbAdmin` or `atlasAdmin`: the API only reads and writes documents. It never
creates collections or indexes - `database/setup.js` does that, and you run that from your laptop
with your own admin user. Giving the deployed service the smallest set of permissions that works is
the whole idea of least privilege, and it is a good viva answer.

### 1.2 Build the production connection string

Take the string from **Database** > **Connect** > **Drivers**, and edit it:

```
mongodb+srv://bloodlink_app:THE_AUTOGENERATED_PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

- username `bloodlink_app`, not your old user
- the password pasted in place of `<db_password>`, with no angle brackets left behind
- no database name between `.net/` and `?` - the code uses `DB_NAME` for that

### 1.3 Network Access: allow 0.0.0.0/0

1. Left sidebar, **Security** > **Network Access**.
2. Click **+ ADD IP ADDRESS**.
3. Click **ALLOW ACCESS FROM ANYWHERE**. The box fills with `0.0.0.0/0`.
4. **Comment:** `Render free tier - no fixed outbound IP`
5. Click **Confirm**.

**You should see** two entries in the list: your laptop's IP and `0.0.0.0/0`, both **Active**.

**Why this is necessary.** Atlas rejects connections from any IP that is not on this list. A Render
free Web Service runs on shared infrastructure and its outbound IP address changes - between
deploys, and when the instance wakes from sleep. There is no IP to add. (Render does offer static
outbound IPs, but only on paid instance types.) So the choices are `0.0.0.0/0` or a paid plan.

**What the trade-off actually is.** `0.0.0.0/0` means *any computer on the internet may attempt to
connect*. It does **not** mean the data is public: every connection still has to authenticate with a
username and password, and the traffic is TLS encrypted. What you have given up is the outer wall,
so the password is now the only thing standing between the internet and your database. That is why
steps 1.1 and 1.2 matter so much:

- a long autogenerated password, used **only** by this app
- `readWrite` on `bloodlink` only, so a leak cannot touch anything else
- the password never in GitHub, only in the Render dashboard
- after the demo, delete the `0.0.0.0/0` rule - it is one click, and the project is marked by then

Say exactly this if an examiner asks. "We opened it because the free host has no fixed IP, and we
compensated with a dedicated least-privilege user and a strong password" is a much better answer
than not knowing there was a trade-off.

### 1.4 Create and seed the production database from your laptop

The seeder never runs on Render - it is a one-off data job, and Render's free filesystem is wiped on
every deploy anyway. Run it from Windows against Atlas.

**Step 1: create collections, validators and indexes.**

```powershell
cd D:\bloodlink
mongosh "mongodb+srv://bloodlink_app:THE_PASSWORD@cluster0.xxxxx.mongodb.net/" database\setup.js
```

**You should see** the summary ending with:

```
cityZones  docs=3  indexes=[_id_, area_2dsphere, name_unique]
donations  docs=0  indexes=[_id_, donorId_date, hospitalId]
donors     docs=0  indexes=[_id_, location_2dsphere, bloodGroup_available, phone_unique]
hospitals  docs=13 indexes=[_id_, location_2dsphere, name_unique]
requests   docs=0  indexes=[_id_, expiresAt_ttl, status_urgency, bloodGroup_status]
```

If instead you see `not authorized on bloodlink to execute command { create: ... }`, the
`bloodlink_app` user cannot create collections. That is expected with `readWrite` in some Atlas
configurations - run `setup.js` with your original admin user instead, then use `bloodlink_app` for
everything else.

**Step 2: seed 500 donors.**

```powershell
cd D:\bloodlink\seeder
copy .env.example .env
notepad .env
```

Put the production URI in it and save:

```
MONGO_URI=mongodb+srv://bloodlink_app:THE_PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
DB_NAME=bloodlink
```

Then:

```powershell
.\.venv\Scripts\Activate.ps1
python seed.py --reset
```

**You should see** it finish with a summary (`donors 500`, `hospitals 13`, `requests 23`,
`donations` around 700) and the line `Every seeded donor can log in with the password: demo1234`.

**Step 3: confirm in the Atlas UI.** **Database** > **Browse Collections** > `bloodlink`. Click
`donors` and check a document has a `location` field shaped
`{ type: "Point", coordinates: [76.63, 12.29] }`.

> Note: `seeder/.env` holds the production password. It is gitignored, so it stays on your laptop.
> Never paste it into a chat, a report appendix or a screenshot.

---

## Part 2 - push to GitHub

One repository, with `server/` and `client/` as folders inside it. This is called a monorepo, and
both Render and Vercel support it by letting you set a **Root Directory** per service.

### 2.1 First, prove no secret is about to be committed

```powershell
cd D:\bloodlink
git init
git add .
git status --short
```

**You should see** a list of files to be added. Now check for `.env` files in that list:

```powershell
git ls-files | Select-String "\.env"
```

**You should see exactly these three, and nothing else:**

```
client/.env.development
client/.env.example
seeder/.env.example
server/.env.example
```

(Four lines - the three examples plus `.env.development`, which holds only a localhost URL.)

If `server/.env` or `seeder/.env` appears in that list, **stop**. Fix it before committing:

```powershell
git rm --cached server/.env seeder/.env
```

Then re-run the check. Also open `.gitignore` and confirm it contains `.env` and `.env.*`.

### 2.2 Commit

```powershell
git branch -M main
git config user.name "KESHAVRAJ2006"
git config user.email "kgoutam12504@gmail.com"
git add .
git commit -m "BloodLink: MongoDB geospatial donor finder, ready for deployment"
```

**You should see** something like `62 files changed, ... insertions(+)`. If it says
`nothing to commit`, the `git add .` did not run - repeat it.

### 2.3 Create the repository and push

You already have the GitHub CLI installed, which is the shortest path:

```powershell
gh auth login
```

Answer: **GitHub.com** > **HTTPS** > **Y** (authenticate Git with GitHub credentials) >
**Login with a web browser**. Copy the one-time code, press Enter, paste it in the browser, click
**Authorize**.

**You should see** `Logged in as KESHAVRAJ2006`.

```powershell
gh repo create bloodlink --public --source=. --remote=origin --push
```

**You should see** `Created repository KESHAVRAJ2006/bloodlink on GitHub` followed by push output
ending in `branch 'main' set up to track 'origin/main'`.

Prefer the website instead? Go to <https://github.com/new>, name it `bloodlink`, leave it **empty**
(no README, no .gitignore, no licence), click **Create repository**, then:

```powershell
git remote add origin https://github.com/KESHAVRAJ2006/bloodlink.git
git push -u origin main
```

### 2.4 Verify on github.com

Open the repository and check:

- `server/`, `client/`, `database/`, `seeder/`, `docs/` are all there
- there is **no** `server/.env` and **no** `seeder/.env`
- `node_modules` and `dist` are absent
- `client/.env.development` contains only `VITE_API_URL=http://localhost:5000`

### 2.5 If you ever committed a secret

Assume a committed secret is public the moment it is pushed - GitHub is continuously scraped by
bots, and deleting the file does not help because git keeps the old content in its history forever.
Deleting is not the fix; **rotating** is. In this order:

1. **Rotate the database password.** Atlas > **Database Access** > the user > **Edit** >
   **Edit Password** > **Autogenerate Secure Password** > **Update User**. The old password stops
   working immediately.
2. **Rotate the JWT secret.** Generate a new one with the `node -e` command from Part 0. Every
   existing login token becomes invalid, so users just log in again - harmless here.
3. **Update both in Render** (Environment tab) and in your local `.env`.
4. **Clean the history, or start fresh.** For a student project the simplest honest option is to
   delete the GitHub repository (**Settings** > scroll to the bottom > **Delete this repository**),
   then `Remove-Item -Recurse -Force .git`, `git init` again and push a clean first commit. The
   thorough option is `git filter-repo --invert-paths --path server/.env` followed by a force push.
5. **Check Atlas for anything unexpected** while the old password was live: **Database** >
   **Browse Collections** for strange documents, and the project **Activity Feed** for logins you
   do not recognise.

---

## Part 3 - deploy the backend on Render

### 3.1 Create the service

1. Sign up at <https://render.com> with **GitHub** (easiest, it links the accounts in one step).
2. Top right: **+ New** > **Web Service**.
3. Choose **Build and deploy from a Git repository**, then **Next**.
4. Find `bloodlink` in the list and click **Connect**. If no repositories appear, click
   **Configure account** / **Install Render**, pick **All repositories** or just `bloodlink`, then
   **Install**.

### 3.2 Settings

Fill the form exactly like this:

| Field | Value | Note |
| --- | --- | --- |
| **Name** | `bloodlink-api` | becomes `https://bloodlink-api.onrender.com`; must be globally unique, so add initials if taken |
| **Language** | `Node` | usually auto-detected |
| **Branch** | `main` | |
| **Region** | `Singapore` | closest to India; **pick the same region as your Atlas cluster if it is on AWS Mumbai/Singapore** - a far region adds latency to every query |
| **Root Directory** | `server` | **this is the important one.** Render then treats `server/` as the project root, so `npm install` finds `server/package.json` |
| **Build Command** | `npm install --include=dev && npm run build` | see the warning below |
| **Start Command** | `npm start` | runs `node dist/index.js` |
| **Instance Type** | **Free** | scroll down; it is selected by default |

> **Why `--include=dev` and not plain `npm install`.** `typescript` and the `@types/*` packages are
> in `devDependencies`, and npm skips devDependencies when `NODE_ENV=production` - which is exactly
> what a production host sets. The build would then fail with `tsc: not found` or hundreds of
> "Cannot find module 'express'" type errors. `--include=dev` forces them to install. (The other fix
> is moving `typescript` into `dependencies`; this way is cleaner, because the compiler is a build
> tool, not something the running server needs.)

### 3.3 Environment variables

Still on the create form, find **Environment Variables** and click **+ Add Environment Variable**
for each row. Type the names exactly - they are case sensitive.

| Key | Value |
| --- | --- |
| `MONGO_URI` | the full `mongodb+srv://bloodlink_app:...` string from Part 1.2 |
| `DB_NAME` | `bloodlink` |
| `JWT_SECRET` | the long hex string you generated |
| `CLIENT_URL` | `http://localhost:5173` *(temporary - the Vercel URL does not exist yet; you will come back in Part 4.4)* |
| `NODE_VERSION` | `22.17.0` |

`PORT` is **not** in that list, deliberately. Render sets it itself and the code reads
`process.env.PORT`. Setting your own `PORT` here is a common way to break the deploy, because Render
then routes traffic to a port nothing is listening on.

`NODE_VERSION` pins the Node version so a future change to Render's default cannot break your build
during demo week. Node 22 is the current LTS.

### 3.4 Optional: health check path

Under **Advanced**, there is a **Health Check Path** field. You can leave it **empty** for now, and
I would recommend that on the free tier.

Why: if you set it to `/api/health`, Render will restart the service whenever that endpoint stops
returning 200 - and our endpoint deliberately returns **503** when MongoDB is unreachable. A
temporary Atlas hiccup would then put the service into a restart loop instead of simply recovering.
With the field empty, Render checks that your port is open, which is enough. You still use
`/api/health` yourself to check things.

If you do want it, set it to `/` - that route always returns 200.

### 3.5 Deploy

Click **Deploy Web Service** at the bottom. The log view opens by itself.

**You should see**, over about two to four minutes:

```
==> Cloning from https://github.com/KESHAVRAJ2006/bloodlink
==> Checking out commit ... in branch main
==> Using Node.js version 22.17.0
==> Running build command 'npm install --include=dev && npm run build'...
added 180 packages in 25s
> bloodlink-server@1.0.0 build
> tsc
==> Build successful
==> Deploying...
==> Running 'npm start'
--- BloodLink API starting ---
environment   : production
port          : 10000
database      : bloodlink on cluster0.xxxxx.mongodb.net
allowed origins: http://localhost:5173
connected to MongoDB
change stream: watching the requests collection
BloodLink API listening on port 10000
==> Your service is live 🎉
```

Port 10000 is normal - that is the port Render chose and injected.

The two lines that prove the hard parts work are **`connected to MongoDB`** (Atlas user + IP rule
are right) and **`change stream: watching the requests collection`** (the cluster is a replica set).

### 3.6 Reading the logs later

Your service page has these tabs:

- **Logs** - live output. This is where `console.log` and crashes appear. Use the search box to
  filter, e.g. type `CORS` to see refused origins. Free-tier logs are kept for 7 days.
- **Events** - the history of deploys, restarts and "instance spun down" / "spun up" entries.
- **Environment** - edit variables here. **Saving restarts the service** (about a minute).
- **Settings** - change build/start commands, root directory, or delete the service.
- **Manual Deploy** (top right) - `Deploy latest commit`, or **Clear build cache & deploy** when a
  build behaves strangely.

### 3.7 Test it

In a browser, open:

```
https://bloodlink-api.onrender.com/api/health
```

**You should see:**

```json
{ "status": "ok", "db": "connected", "uptimeSeconds": 42, "time": "2026-11-06T..." }
```

`"db": "connected"` means the API pinged Atlas successfully just now.

Then check real data:

```
https://bloodlink-api.onrender.com/api/stats
```

**You should see** JSON with `"donors": 500`. And the main query:

```
https://bloodlink-api.onrender.com/api/donors/nearby?lng=76.6394&lat=12.2958&km=10&bloodGroup=B%2B
```

**You should see** a `donors` array where each entry has a `distanceKm` and the numbers increase
down the list. (`%2B` is `+`; a bare `+` in a URL means a space.)

From PowerShell, if you prefer:

```powershell
curl.exe https://bloodlink-api.onrender.com/api/health
```

### 3.8 Do WebSockets work on Render?

Yes. Render's free Web Services support WebSockets with no extra configuration, which is exactly
why this project can be deployed there - the Socket.IO connection that carries change stream events
needs a connection that stays open.

Two things to know:

- Socket.IO connects with HTTP long polling first, then **upgrades** to a WebSocket. Both steps go
  through the same `https://bloodlink-api.onrender.com` URL, so nothing extra to configure.
- A free instance that has gone to sleep will refuse the first connection attempt while it wakes.
  The client is configured to retry ten times with a growing delay, so it connects on its own after
  a few seconds.

You will verify it for real in Part 5. Proof, once the site is live:

- In the Render **Logs** you see `socket connected: <id> (websocket)`, and if it started on polling,
  a follow-up `socket <id> upgraded to websocket`.
- In the browser press **F12** > **Network** > **WS** filter. You should see one entry with status
  **101 Switching Protocols** - that status code *is* the WebSocket handshake. Click it and open
  **Messages** to watch frames arrive when a request is raised.

---

## Part 4 - deploy the frontend on Vercel

### 4.1 Import the project

1. Sign up at <https://vercel.com> with **GitHub**.
2. On the dashboard click **Add New...** > **Project**.
3. Under **Import Git Repository**, find `bloodlink` and click **Import**. If it is not listed,
   click **Adjust GitHub App Permissions** and grant access to the repository.

### 4.2 Configure

| Field | Value |
| --- | --- |
| **Project Name** | `bloodlink` (becomes `bloodlink.vercel.app`, or `bloodlink-<something>` if taken) |
| **Framework Preset** | **Vite** - detected automatically once the root directory is set |
| **Root Directory** | click **Edit**, choose the `client` folder, **Continue** |
| **Build Command** | `npm run build` |
| **Output Directory** | `dist` |
| **Install Command** | leave as default (`npm install`) |

Vercel installs devDependencies by default, so no `--include=dev` is needed here.

### 4.3 Environment variable, then deploy

Expand **Environment Variables** and add:

| Key | Value |
| --- | --- |
| `VITE_API_URL` | `https://bloodlink-api.onrender.com` |

Rules for that value, all three of which cause real bugs:

- **`https`, not `http`.** The Vercel site is served over HTTPS, and a browser refuses to let an
  HTTPS page call an HTTP address. That block is called mixed content, and in the console it reads
  `Mixed Content: The page at 'https://...' was loaded over HTTPS, but requested an insecure
  resource`.
- **No trailing slash.** `https://bloodlink-api.onrender.com/` would produce `//api/health`.
- **No `/api` at the end.** The code appends `/api/...` itself.

Optionally also add `VITE_ATLAS_CHART_URL` with your Atlas Charts embed URL.

Click **Deploy**.

**You should see** a build log, then a confetti screen with a screenshot of your site and the URL
`https://bloodlink.vercel.app`. The build takes about a minute.

### 4.4 Why a changed VITE_ variable needs a redeploy

This catches everybody once, so it is worth understanding rather than memorising.

Vite does not read environment variables in the browser - the browser has no environment. At **build
time**, Vite performs a find-and-replace: every `import.meta.env.VITE_API_URL` in your source is
substituted with the literal string. The built file contains:

```js
fetch("https://bloodlink-api.onrender.com/api/stats")
```

The variable no longer exists at runtime; its value is **baked in**. So changing `VITE_API_URL` in
the Vercel dashboard changes nothing about the site that is already built. You must rebuild:

> **Deployments** tab > the three dots on the latest deployment > **Redeploy** > **Redeploy**.

Two consequences:

1. Any time you change a `VITE_` variable, redeploy.
2. **Never put a secret in a `VITE_` variable.** It ends up in a JavaScript file that anyone can
   read with View Source. That is why `MONGO_URI` and `JWT_SECRET` live on Render, where only the
   server can see them. This is also a frequently asked viva question.

Related: only names starting with `VITE_` are exposed at all. If you name it `API_URL`, Vite hides
it on purpose, and `import.meta.env.API_URL` is `undefined`.

### 4.5 Go back to Render and allow the Vercel URL

Right now Render's `CLIENT_URL` still says `http://localhost:5173`, so the live site's API calls will
be blocked by CORS. Fix that now:

1. Copy your Vercel production URL, e.g. `https://bloodlink.vercel.app`.
2. Render > your service > **Environment** > the pencil icon on `CLIENT_URL`.
3. Set it to, all on one line, comma separated, **no spaces, no trailing slashes**:

   ```
   http://localhost:5173,https://bloodlink.vercel.app,*.vercel.app
   ```

4. **Save Changes**.

What the three entries do: your laptop keeps working against the deployed API; the production site
is allowed; and `*.vercel.app` allows Vercel's preview deployments, which get a different hostname
on every branch and would otherwise fail CORS. Drop that third entry if you would rather be strict -
the code supports any combination.

**You should see** an automatic restart in **Events**, and in **Logs**:

```
allowed origins: http://localhost:5173, https://bloodlink.vercel.app, *.vercel.app
```

Wait for `Your service is live` before testing, about a minute.

---

## Part 5 - test the live demo

Open your Vercel URL on a laptop. Work down this list; each row says what to look for.

| # | Check | What you should see | If it fails |
| --- | --- | --- | --- |
| 1 | **Home page loads** | the deep red hero, and under "Live numbers" real figures (500 donors, 13 hospitals) rather than the "Numbers load once the API is reachable" note | numbers missing = the API call failed; open F12 > Console. Row 1 of the troubleshooting table |
| 2 | **First load may be slow** | if Render was asleep, the counters appear after 30-60 seconds | normal on the free tier, see Part 7 |
| 3 | **Map tiles show** | go to **Find donors**; streets and place names, not a grey box | grey = no internet, or an extension blocking openstreetmap.org |
| 4 | **Use my location works** | the browser asks "Allow bloodlink.vercel.app to know your location?"; after Allow, the map jumps to you | must be HTTPS - see the note below |
| 5 | **Nearby search returns results** | donor pins coloured by blood group, a red radius circle, and a side list where distances increase downwards | empty list = widen the radius; you are probably not near Mysuru/Mandya/Bengaluru |
| 6 | **Radius slider re-queries** | dragging to 40 km adds pins and more list entries | |
| 7 | **Click the map moves the search** | the circle and the pins follow the click | |
| 8 | **Contact reveals one number** | the button shows `92xxxxxx83`; after clicking, the full 10-digit number | |
| 9 | **Register works** | fill the form, pick a spot on the map, submit; you land on **My Profile** with your name | 409 = that phone number already exists; 400 = check age 18-65 |
| 10 | **Login works** | log out, then log in with any seeded donor's number and `demo1234` | get a number from check 8 |
| 11 | **Availability toggle persists** | switch it off, refresh the page, it is still off | 401 = token problem; log in again |
| 12 | **Live request toast** | **the headline demo** - see below | Part 7, Socket.IO rows |
| 13 | **Refresh on a sub-page** | with `/find` in the address bar press F5; the page reloads normally | a 404 means `client/vercel.json` was not deployed |
| 14 | **Works on your phone** | open the same URL on mobile data, not college Wi-Fi | |
| 15 | **Dashboard charts** | four charts with data, plus the Atlas chart if you set that variable | |
| 16 | **Queries page** | pick `$geoNear`, press **Run query**, see JSON with `distanceKm` | |

### Check 12 in detail - the change stream demo

1. Open your Vercel URL in **two** browser windows, side by side. Put window A on **Requests**.
2. Window B: **Requests** > the **Raise a request** form on the right. Hospital: any. Patient: a
   name. Blood group: `O+`. Units: 2. Urgency: **critical**. Click **Save request**.
3. **You should see**, within a second and **without any refresh**:
   - window A: a toast slides in at the top right reading `CRITICAL request: O+`
   - window A: the request appears at the top of the list with a red **critical** badge
   - Render **Logs**: `change stream: new critical request for O+`

That chain is the whole point of the architecture: MongoDB noticed the insert (change stream), told
the Express process, which pushed it to every browser (Socket.IO). Nothing polled.

Then press **Find donors** on that request, pick a donor, and **Record donation**. You should get a
toast saying the donation was recorded in one transaction, the request should become **fulfilled**,
and that donor is no longer eligible.

### Why "use my location" needs HTTPS

The browser geolocation API is a **secure context** feature: Chrome, Edge, Firefox and Safari only
expose `navigator.geolocation` on `https://` pages (plus `http://localhost`, which is treated as
secure for development). On a plain `http://` page the call is blocked outright or silently returns
an error, which is why this feature cannot be demonstrated from, say, `http://192.168.1.5:5173` on
your phone.

You get HTTPS automatically on Vercel, with a certificate issued and renewed for you - nothing to
configure. Good viva material: *"geolocation is gated behind a secure context, so the deployment
had to be HTTPS; Vercel provides that by default."*

Note it is still only as accurate as the device: on a laptop without GPS the position comes from
Wi-Fi and can be off by a kilometre or land in the wrong city. That is why the app also lets you
click the map and type coordinates.

---

## Part 6 - troubleshooting

| Symptom | What it means | Fix |
| --- | --- | --- |
| Console: `Access to fetch at 'https://...onrender.com/api/stats' from origin 'https://bloodlink.vercel.app' has been blocked by CORS policy` | The API did not include your origin in `Access-Control-Allow-Origin`, so the browser discarded the response | Render > Environment > `CLIENT_URL` must contain the Vercel URL **exactly**: `https`, no trailing slash, no path. Save, wait for the restart. Confirm in Render Logs: `allowed origins: ...`, and look for a `CORS: refused origin ...` line naming the exact origin it saw |
| CORS error only on a preview URL like `bloodlink-git-main-you.vercel.app` | Preview deployments get their own hostname | Add `*.vercel.app` to `CLIENT_URL`, or demo from the production URL only |
| `404: NOT_FOUND` after refreshing `/find` or `/dashboard` | The browser asked Vercel for a file called `/find`, which does not exist - React Router creates those paths in the browser | `client/vercel.json` with the rewrite to `/index.html` must be committed and deployed. Check it exists in GitHub under `client/`, then redeploy. Clicking links works while refresh fails is the signature of this bug |
| Console: `Mixed Content: ... requested an insecure resource 'http://...'` and nothing loads | `VITE_API_URL` starts with `http://` while the page is HTTPS | Change it to `https://...` in Vercel **and redeploy** - the old value is baked into the previous build |
| `Cannot reach the API at https://... Is it running, and is VITE_API_URL correct?` | `fetch` got no response at all: wrong URL, service down, or still waking | Open `<render-url>/api/health` directly in a tab. If that works but the site does not, the URL in Vercel is wrong (typo, trailing slash, `/api` appended). If it does not, check Render Logs |
| Vercel build fails with `VITE_API_URL is not set, so this build would not know where the API is` | The variable was never added in Vercel. The build stops on purpose, because the alternative is a deployed blank page | Vercel > Settings > Environment Variables > add `VITE_API_URL` > **Deployments > Redeploy** |
| Site shows a blank white page, console says `VITE_API_URL is not set` | An older build was deployed before the variable existed | Same fix, then **Redeploy** - the value is baked in at build time |
| Vercel build fails: `error TS2304: Cannot find name ...` | `npm run build` runs `tsc --noEmit` first, so a type error fails the deploy | Run `npm run build` in `client/` locally and fix what it reports. The same code must build on your laptop |
| Render Logs: `MongoServerSelectionError: ... ETIMEOUT` or `Could not connect to any servers in your MongoDB Atlas cluster` | Atlas is refusing the connection, almost always the IP rule | Atlas > Network Access > confirm `0.0.0.0/0` is listed and **Active** (not "Pending"). Then confirm the username and password in `MONGO_URI` |
| Render Logs: `bad auth : Authentication failed` | Wrong password, `<db_password>` placeholder still in the string, or a special character not encoded | Regenerate the `bloodlink_app` password as plain alphanumeric, update `MONGO_URI`, save |
| Render build fails: `tsc: not found` or hundreds of `Cannot find module 'express'` type errors | devDependencies were skipped because the host sets `NODE_ENV=production` | Build Command must be `npm install --include=dev && npm run build` |
| Render build fails: `npm error enoent Could not read package.json` | Root Directory is not set | Settings > **Root Directory** = `server` |
| Render: `==> Application exited early` | The process started and then stopped. Nine times out of ten an environment variable is missing - our config throws on purpose | Scroll **up** in the log to the real message: `MONGO_URI is missing` or `JWT_SECRET is missing` tells you exactly which one to add. Also possible: Start Command wrong, or `dist/index.js` missing because the build failed |
| Render: `No open ports detected` then a failed deploy | The app is not listening on the injected `PORT` | Do not set your own `PORT` variable on Render; delete it if present. The code already uses `process.env.PORT` |
| Live requests never arrive, Console: `socket connect error: xhr poll error` | The socket could not reach the API: service asleep, URL wrong, or CORS | Load `/api/health` first to wake it, then reload the page. The client retries ten times by itself |
| F12 > Network > WS shows repeated polling requests and no `101 Switching Protocols` | The WebSocket upgrade is being blocked - often a school or corporate network, not Render | It still works over polling, just with a delay. Try a phone hotspot. Render itself supports WebSockets |
| `socket disconnected: transport close` every few minutes | The free instance went to sleep, or the network dropped | Expected; the client reconnects automatically |
| The first request of the day takes 50 seconds, then everything is fast | The free instance was asleep and had to cold start | Part 7. Wake it before you demo |
| Atlas: `user is not allowed to do action [find] on bloodlink.donors` | The `bloodlink_app` user has the wrong privileges or the wrong database | Database Access > Edit the user > Specific Privileges > `readWrite` on `bloodlink` |
| Open requests disappeared overnight | The TTL index deleted them at `expiresAt` - working as designed | Re-run `python seed.py --reset`, or raise fresh requests during the demo |
| A code change does not appear on the live site | Nothing was pushed, or auto-deploy is off | `git add . ; git commit -m "..." ; git push`. Both Render and Vercel deploy on push to `main`; watch their dashboards |

---

## Part 7 - demo day plan

### The one thing that can embarrass you

A Render free Web Service **spins down after about 15 minutes with no incoming traffic**. The next
request has to start a fresh container, which takes roughly **30 to 60 seconds**. If the examiner
opens your link cold, the page loads (Vercel is always instant) but the counters sit empty for a
minute, which looks broken.

### Wake it up, five minutes before

Open this in a browser tab and wait for the JSON:

```
https://bloodlink-api.onrender.com/api/health
```

**You should see** `{"status":"ok","db":"connected","uptimeSeconds":3,...}`. A small
`uptimeSeconds` tells you it just woke; anything large means it was already running.

Then open the Vercel site itself and click through Find donors, Requests and Dashboard once. Now
everything is warm: Render is up, Atlas connections are established, and the map tiles are cached.

### Optional: keep it awake with a free pinger

Use this only on demo day. Hitting a free instance every five minutes all month will burn through
the 750 free instance-hours and can get the service suspended near the end of the month.

1. Sign up at <https://cron-job.org> (free, no card).
2. **Create cronjob**.
3. **URL:** `https://bloodlink-api.onrender.com/api/health`
4. **Schedule:** every 10 minutes.
5. **Save**, then click **TEST RUN** - you should get a `200` with the health JSON.
6. **Disable or delete it after the demo.**

`/api/health` is the right endpoint for this: it is cheap, it has no side effects, and its MongoDB
ping also keeps the Atlas connection warm.

### Backup plan, in order of preference

Have all three ready; college Wi-Fi fails more often than Render does.

1. **Phone hotspot.** The single most useful backup. Vercel, Render, Atlas and the map tiles all
   need internet; the college network may block some of them.
2. **Run it locally against Atlas.** Two terminals, `npm run dev` in `server` and `client`, open
   `http://localhost:5173`. Needs internet for Atlas, but nothing from Render or Vercel.
   `localhost` counts as a secure context, so "use my location" still works.
3. **Fully offline.** README section 6.7 - a local single-node replica set on port 27018, seeded
   beforehand. Change streams and transactions still work. Only the map tiles need internet, so
   load the map pages once beforehand and leave the tab open.
4. **A screen recording.** Record a clean 3-minute run-through the night before: nearby search,
   the live toast in two windows, the transaction, the dashboard. Keep the file on your laptop, not
   in the cloud. If everything fails, you still show a working system instead of a stack trace.

Also keep a terminal tab with `mongosh "<uri>" database/queries.js` output. If the web app cannot
run at all, you can still demonstrate every geospatial query directly against the database, which
is what the subject is actually marked on.

### Explaining the architecture in the viva

Say it as a request travelling through the system:

> "The browser loads the React app from **Vercel**, which is a CDN serving only static files - no
> server code and nothing secret, because anything in the frontend bundle is readable by the user.
>
> That app then calls our **Express API on Render** over HTTPS. Render runs the compiled TypeScript
> as a normal Node process, and it is the only place our secrets exist: the Atlas connection string
> and the JWT secret are environment variables in the Render dashboard, never in GitHub.
>
> The API talks to **MongoDB Atlas**, which is a managed three-node replica set. We need a replica
> set rather than a standalone for two features: multi-document transactions, used when recording a
> donation, and change streams.
>
> The change stream is what makes the last arrow interesting. When a hospital inserts an urgent
> request, MongoDB pushes that change to the Express process, which forwards it to every connected
> browser over a **Socket.IO WebSocket**. So the live alert is pushed from the database outwards -
> nothing is polling."

Have answers ready for the four follow-ups that usually come:

- **"Why two hosts instead of one?"** Different workloads. The frontend is static files, best served
  from a CDN edge; the API must hold a long-lived process for the change stream. Splitting them also
  means a frontend redeploy cannot take the API down.
- **"Why is Atlas open to 0.0.0.0/0?"** Render's free instances have no fixed outbound IP, so there
  is no address to allow-list. We compensated with a dedicated user restricted to `readWrite` on the
  `bloodlink` database, a long autogenerated password kept out of the repository, and TLS on every
  connection. On a paid plan we would use a static outbound IP or VPC peering instead.
- **"How do the secrets stay secret?"** They only ever exist as environment variables on Render.
  `.gitignore` excludes every `.env` file, the frontend never receives them, and `VITE_` variables
  are deliberately limited to public values because Vite inlines them into the bundle at build time.
- **"What happens when the free instance sleeps?"** The first request takes up to a minute to cold
  start. The Socket.IO client retries with a growing delay so it reconnects by itself, and we warm
  the service with a health check before any demo.

---

## Appendix - what is free, and what the limits are

| Service | Plan | Limits worth knowing |
| --- | --- | --- |
| MongoDB Atlas | M0 | 512 MB storage, shared CPU, max 500 connections. Our seed data uses a few MB. Replica set, so transactions and change streams work |
| Render | Free Web Service | Sleeps after ~15 min idle, ~30-60 s cold start, 750 instance-hours/month, ephemeral filesystem (anything written is lost on redeploy), logs kept 7 days. WebSockets supported |
| Vercel | Hobby | Plenty of bandwidth for a demo, automatic HTTPS, deploys on every push. For personal/non-commercial use, which a college project is |

Nothing in this setup asks for a card, and nothing can start charging you by accident.

### Keeping it deployed after submission

Both hosts redeploy automatically on `git push` to `main`, so the live URLs keep working as long as
the free plans exist. Two tidy-up items once the project is marked:

1. Remove the `0.0.0.0/0` rule in Atlas Network Access.
2. Delete the cron-job.org pinger if you created one.
