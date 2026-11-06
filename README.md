# BloodLink - Nearest Blood Donor Finder using MongoDB Geospatial Queries

A NoSQL mini project for the Healthcare domain. BloodLink stores every donor as a GeoJSON point and
answers the question a blood bank actually asks: *who can give B+ blood, is past the ninety day gap,
and is closest to this hospital right now?*

The answer comes from a single MongoDB aggregation built on a `2dsphere` index, and the system is
put together the way a real one would be: a Python seeder, a TypeScript REST API, a React map
dashboard, and a change stream that pushes urgent requests to the browser the moment they are saved.

**Team:** 2 students, CSE. **Database:** MongoDB Atlas free tier (M0).

**Deploying it?** This README covers running BloodLink on your laptop. For the live demo - React on
Vercel, the API on Render, Atlas in production - follow [DEPLOYMENT.md](DEPLOYMENT.md).

---

## 1. What it does

| Feature | MongoDB feature behind it |
| --- | --- |
| Find donors near a point, sorted by distance | `$geoNear` on a `2dsphere` index, `distanceField` |
| Count donors inside a radius | `$geoWithin` with `$centerSphere` |
| List donors inside a city boundary | `$geoWithin` with a stored `Polygon` |
| Which zone contains this hospital | `$geoIntersects` |
| Only eligible donors are returned | compound index, `$lt` on a date, `$or` for never-donated |
| Compatible blood groups, not just exact matches | compatibility map in the API plus `$in` |
| Urgent requests disappear by themselves | TTL index on `expiresAt` |
| New requests appear live, without polling | change stream on `requests` plus Socket.IO |
| Recording a donation updates three collections safely | multi-document transaction |
| Dashboard with six figures in two round trips | `$facet`, `$bucket`, `$group`, `$lookup` |
| Donor registration is validated by the database | `$jsonSchema` validation, unique index on `phone` |

---

## 2. Architecture

```
                        +---------------------------+
                        |   seeder/  (Python 3)     |
                        |   pymongo + Faker         |
                        +-------------+-------------+
                                      |
                                 (1) insert_many
                                      |
                                      v
  +-------------------+       +-------------------------------+
  |  database/        | (2)   |      MongoDB Atlas (M0)       |
  |  mongosh scripts  |------>|  database: bloodlink          |
  |  setup / queries  |       |  donors    (2dsphere, unique) |
  +-------------------+       |  hospitals (2dsphere)         |
                              |  requests  (TTL on expiresAt) |
                              |  donations                    |
                              |  cityZones (2dsphere Polygon) |
                              +----+---------------------+----+
                                   ^                     |
                            (3) driver queries    (4) change stream
                                   |                     v
                              +----+---------------------+----+
                              |   server/  Node + Express     |
                              |   TypeScript, mongodb driver  |
                              |   JWT auth, Socket.IO server  |
                              +----+----------------------+---+
                                   ^                      |
                           (5) REST over HTTP      (6) socket.emit
                                   |                      v
                              +----+----------------------+---+
                              |   client/  React + Vite       |
                              |   Leaflet map, Chart.js       |
                              +-------------------------------+
                                   |
                            (7) iframe embed
                                   v
                              +-------------------------------+
                              |   MongoDB Atlas Charts        |
                              +-------------------------------+
```

**Every arrow, explained**

1. **Python seeder to Atlas.** `seed.py` generates 500 donors with Faker (Indian names and mobile
   numbers), realistic Indian blood group shares, random points around Mysuru, Mandya and Bengaluru,
   a donation history and a set of open requests. It writes them with `insert_many`, then fixes up
   each donor with `bulk_write` so `lastDonation` and `donationCount` agree with the donations
   collection. It talks to MongoDB directly, not through the API, because seeding is a data job and
   has nothing to do with HTTP.
2. **mongosh to Atlas.** `database/setup.js` creates the collections with `$jsonSchema` validators,
   builds every index and inserts the reference data (hospitals, city zone polygons).
   `database/queries.js` is the viva script: 25 numbered demo queries that print their own output.
3. **Express to Atlas.** The API uses the official `mongodb` driver, no Mongoose. One `MongoClient`
   is created for the whole process and the driver keeps its connection pool, so a request never
   waits for a new connection.
4. **Change stream from Atlas to Express.** `watcher.ts` opens a change stream on the `requests`
   collection, filtered to `operationType: "insert"`. MongoDB pushes the new document to the server
   as soon as it is committed to the oplog, so the server never has to poll.
5. **React to Express.** Plain REST over `fetch`, JSON in and out, with a JWT in the
   `Authorization` header once a donor logs in. CORS allows only the Vite dev server origin.
6. **Express to React over Socket.IO.** The watcher looks up the hospital name and emits
   `new-request` to every connected browser. The Requests page inserts it into the list and a toast
   appears on whichever page the user is on.
7. **Atlas Charts to React.** One chart is built inside Atlas and embedded in the dashboard as an
   iframe, so it reads the cluster straight from Atlas without going through our API.

---

## 3. Folder structure

```
bloodlink/
  README.md                     this file
  .gitignore
  database/
    setup.js                    collections, validators, indexes, hospitals, city zones
    queries.js                  25 commented demo queries for the viva
  seeder/
    seed.py                     500 donors, donations, requests
    requirements.txt
    .env.example
  server/
    package.json
    tsconfig.json
    .env.example
    src/
      index.ts                  express app, routes, Socket.IO, error handler
      db.ts                     one MongoClient, typed collection accessors
      types.ts                  document interfaces and the enums
      compatibility.ts          blood compatibility map and the 90 day rule
      watcher.ts                change stream on requests
      middleware/auth.ts        JWT sign, requireAuth, optionalAuth
      utils/http.ts             ApiError and the async route wrapper
      utils/validate.ts         input validation with friendly messages
      utils/donor.ts            phone masking and the public donor shape
      routes/auth.ts            register, login
      routes/donors.ts          nearby, in-city, CRUD, availability, contact, history
      routes/hospitals.ts       CRUD plus nearby-donors
      routes/requests.ts        create, list with $lookup, cancel
      routes/donations.ts       the transaction
      routes/stats.ts           the $facet dashboard
      routes/zones.ts           city polygons and $geoIntersects
      routes/demoQueries.ts     the queries the Queries page runs
  client/
    package.json  vite.config.ts  tailwind.config.js  postcss.config.js  index.html
    .env.example
    src/
      main.tsx  App.tsx  index.css
      lib/      api.ts  auth.tsx  format.ts  socket.ts  types.ts
      components/  MapView.tsx  DonorList.tsx  Navbar.tsx  Badges.tsx  Toast.tsx
      pages/    Home  FindDonors  Register  Login  Profile  Requests  Hospitals
                Dashboard  Queries
  docs/
    why-mongodb.md              the six points, written out
    report-outline.md           report structure, chapter by chapter
    presentation-outline.md     12 slides
    viva-questions.md           20 questions with short answers
```

---

## 4. The data model

### donors

```js
{
  _id: ObjectId,
  name: "Keshav Raj",
  phone: "9812345678",          // unique index
  email: "keshav@example.com",
  passwordHash: "$2b$10$...",   // bcrypt, never sent to the client
  bloodGroup: "O+",             // enum of eight values
  age: 24,                      // 18 to 65, enforced by $jsonSchema
  gender: "male",
  city: "Mysuru",
  location: { type: "Point", coordinates: [76.6394, 12.2958] },  // [lng, lat]
  lastDonation: ISODate("2026-06-02T00:00:00Z"),  // null if never donated
  available: true,
  donationCount: 3,
  registeredOn: ISODate("2026-01-11T00:00:00Z")
}
```

Indexes: `{ location: "2dsphere" }`, `{ bloodGroup: 1, available: 1 }`, `{ phone: 1 }` unique.

### hospitals

`{ name, address, city, phone, location }` with a `2dsphere` index on `location` and a unique index
on `name`. Thirteen real hospitals in Mysuru, Mandya and Bengaluru are inserted by `setup.js`.

### requests

```js
{
  hospitalId: ObjectId, patientName: "...", bloodGroup: "B+", unitsNeeded: 2,
  urgency: "critical",          // normal | urgent | critical
  status: "open",               // open | fulfilled | cancelled
  createdAt: ISODate, expiresAt: ISODate, fulfilledAt: ISODate | null
}
```

Indexes: `{ expiresAt: 1 }` with `expireAfterSeconds: 0` (the TTL index), `{ status: 1, urgency: 1 }`,
`{ bloodGroup: 1, status: 1 }`.

### donations

`{ donorId, hospitalId, requestId, date, units }`, indexed on `{ donorId: 1, date: -1 }`.

### cityZones

`{ name, district, area: { type: "Polygon", coordinates: [[[lng, lat], ...]] } }` with a `2dsphere`
index on `area`. Three rectangles, one per city, used by `$geoWithin` and `$geoIntersects`.

---

## 5. Business rules

**Eligibility.** A donor is eligible when `available` is `true` **and** the last donation is more
than 90 days old. A donor who has never donated has `lastDonation: null`, and `$lt` skips nulls, so
the filter spells that case out:

```js
{
  available: true,
  $or: [{ lastDonation: { $lt: cutoff } }, { lastDonation: null }]
}
```

**Blood compatibility.** Searching for a patient returns every compatible donor group, not just the
exact match. The map lives in `server/src/compatibility.ts` and is used with `$in`:

| Patient | Can receive from |
| --- | --- |
| O- | O- |
| O+ | O-, O+ |
| A- | O-, A- |
| A+ | O-, O+, A-, A+ |
| B- | O-, B- |
| B+ | O-, O+, B-, B+ |
| AB- | O-, A-, B-, AB- |
| AB+ | all eight groups |

**Recording a donation.** Three writes have to happen together: insert the donation, `$set` the
donor's `lastDonation` and `$inc` the `donationCount`, and mark the request `fulfilled`. They run
inside `session.withTransaction`, so a crash halfway through cannot leave a donor who looks eligible
right after donating.

**Privacy.** No list or map ever contains a full phone number; the API masks it as `98xxxxxx78`. The
real number comes from `GET /api/donors/:id/contact`, one donor per call, triggered by the Contact
button. Exact addresses are never shown for donors, only the city and the approximate map pin.

---

## 6. Setup on Windows, step by step

### 6.1 Install the tools

| Tool | Version used | Where |
| --- | --- | --- |
| Node.js LTS | 20 or newer | <https://nodejs.org> (the .msi installer) |
| Python | 3.10 or newer | <https://www.python.org/downloads/windows/> - tick **Add python.exe to PATH** |
| MongoDB Shell (mongosh) | 2.x | <https://www.mongodb.com/try/download/shell> |
| VS Code | any | optional but recommended |

Check all three in a new PowerShell window:

```powershell
node -v
python --version
mongosh --version
```

### 6.2 Create the Atlas cluster

1. Sign up at <https://www.mongodb.com/cloud/atlas/register>.
2. **Create a deployment** and pick the free **M0** tier. Choose a region near you (Mumbai).
   Name the cluster `Cluster0`.
3. **Database user:** Security > Database Access > *Add New Database User*.
   Username `bloodlink_user`, password *Autogenerate* and copy it somewhere safe.
   Role: **Read and write to any database**.
4. **Network access:** Security > Network Access > *Add IP Address* > **Add Current IP Address**.
   On college Wi-Fi the IP changes, so if nothing connects later, come back and add the new one.
   `0.0.0.0/0` also works but leaves the cluster open to the internet; only use it if you must,
   and remove it afterwards.
5. **Connection string:** Deployment > Connect > *Drivers* and copy the string. It looks like
   `mongodb+srv://bloodlink_user:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`.
   Replace `<password>` with the real password. If the password has `@ : / ?` or `#` in it,
   percent-encode those characters or just generate a password without them.

The free tier is a three node replica set, which is why **transactions and change streams both work
on it**. A single local `mongod` would support neither.

### 6.3 Create the database

From the project root, in PowerShell:

```powershell
cd D:\bloodlink
mongosh "mongodb+srv://bloodlink_user:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/" database\setup.js
```

It prints every collection it creates, then a summary of documents and indexes per collection.

### 6.4 Seed the data

```powershell
cd D:\bloodlink\seeder
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
notepad .env          # paste MONGO_URI, save, close
python seed.py --reset
```

If PowerShell refuses to run the activate script, allow it once for your user:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

The seeder ends with a summary: documents per collection, donors per blood group, donors per city.

### 6.5 Start the API

```powershell
cd D:\bloodlink\server
npm install
copy .env.example .env
notepad .env          # paste MONGO_URI, set JWT_SECRET to any long random string
npm run dev
```

Expected output:

```
--- BloodLink API starting ---
environment   : development
port          : 5000
database      : bloodlink on cluster0.xxxxx.mongodb.net
allowed origins: http://localhost:5173
connected to MongoDB
change stream: watching the requests collection
BloodLink API listening on port 5000
try it: http://localhost:5000/api/health
```

Check it in the browser: <http://localhost:5000/api/health> and
<http://localhost:5000/api/stats>.

### 6.6 Start the React client

In a **second** PowerShell window:

```powershell
cd D:\bloodlink\client
npm install
copy .env.example .env
npm run dev
```

Open <http://localhost:5173>.

### 6.7 Optional: running without internet, on a local replica set

Atlas needs a working internet connection, which a viva room does not always have. If MongoDB
Community Server is installed locally, you can run the whole project offline - but it has to be
started as a **single node replica set**, otherwise transactions and change streams will not work.
Open a terminal and leave it running:

```powershell
mkdir D:\mongo-rs-data
& "C:\Program Files\MongoDB\Server\9.0\bin\mongod.exe" --port 27018 --dbpath D:\mongo-rs-data --replSet rstest
```

In a second terminal, once only:

```powershell
mongosh "mongodb://127.0.0.1:27018/admin" --eval "rs.initiate({_id:'rstest', members:[{_id:0, host:'127.0.0.1:27018'}]})"
```

Then put `MONGO_URI=mongodb://127.0.0.1:27018/` in `seeder\.env` and `server\.env` and follow the
same steps from 6.3 onwards. Use port 27018 and a separate data folder so this does not disturb the
default MongoDB service on port 27017, which is a standalone and cannot do change streams.

Keep Atlas as the main setup, since the Atlas Charts embed and the cloud deployment story need it.

### 6.8 Running order, for the demo

Four terminals, in this order:

| Terminal | Folder | Command | Keep running |
| --- | --- | --- | --- |
| 1 | `D:\bloodlink` | `mongosh "<uri>" database\setup.js` | no, runs once |
| 2 | `D:\bloodlink\seeder` | `python seed.py --reset` | no, runs once |
| 3 | `D:\bloodlink\server` | `npm run dev` | yes |
| 4 | `D:\bloodlink\client` | `npm run dev` | yes |

For the viva queries, a fifth terminal:

```powershell
cd D:\bloodlink
mongosh "mongodb+srv://..." database\queries.js
```

---

## 7. The Atlas Charts embed

1. In Atlas, open **Charts** from the left menu and click **Add Dashboard**. Call it `BloodLink`.
2. **Add Chart**. Data source: `bloodlink.donors`. If the collection is not offered, use
   *Data Sources* > *Add Data Source* and pick the cluster first.
3. Chart type: **Column - Vertical**.
4. Drag **bloodGroup** into the **X Axis**.
5. Drag **_id** into the **Y Axis** and set the aggregate to **Count**.
6. Sort the X axis by **Value, descending**, and title the chart
   *Donors per blood group*. Save it.
7. On the dashboard, open the chart's **...** menu > **Embed Chart**. Enable
   **Unauthenticated access** for the chart (it is read-only demo data), choose **iframe** and copy
   the `src` URL out of the snippet.
8. Paste it into `client\.env`:

   ```
   VITE_ATLAS_CHART_URL=https://charts.mongodb.com/charts-project-0-abcde/embed/charts?id=...&theme=light
   ```

   Restart `npm run dev` - Vite reads `.env` only at startup. The dashboard now shows the Atlas
   chart under the four Chart.js charts.

---

## 8. API reference

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/health` | is the API up |
| POST | `/api/auth/register` | donor sign up, returns a JWT |
| POST | `/api/auth/login` | login with phone and password |
| GET | `/api/donors/nearby?lng&lat&km&bloodGroup&compatible` | **the main query**, `$geoNear` with eligibility and compatibility |
| GET | `/api/donors/in-city/:cityName?bloodGroup&eligibleOnly` | `$geoWithin` with the stored polygon |
| GET | `/api/donors?city&bloodGroup&available&limit` | plain filtered list |
| GET | `/api/donors/:id` | one donor, no password hash |
| GET | `/api/donors/:id/contact` | full phone number, one donor at a time |
| GET | `/api/donors/:id/donations` | donation history, `$lookup` on hospitals |
| PUT | `/api/donors/:id` | update own profile (JWT) |
| PATCH | `/api/donors/:id/availability` | availability toggle (JWT) |
| DELETE | `/api/donors/:id` | remove own registration (JWT) |
| GET | `/api/hospitals` | list, optional `?city=` |
| GET | `/api/hospitals/:id` | one hospital |
| POST/PUT/DELETE | `/api/hospitals[/:id]` | hospital CRUD |
| GET | `/api/hospitals/:id/nearby-donors?bloodGroup&km` | `$geoNear` from the hospital point |
| GET | `/api/requests?status&bloodGroup&urgency` | list with `$lookup` on hospitals |
| POST | `/api/requests` | raise a request, sets `expiresAt` from the urgency |
| PATCH | `/api/requests/:id/cancel` | cancel an open request |
| POST | `/api/donations` | **the transaction**: donation + donor + request |
| GET | `/api/donations?hospitalId&limit` | recent donations |
| GET | `/api/stats` | the `$facet` dashboard |
| GET | `/api/zones` | city polygons |
| GET | `/api/zones/for-point?lng&lat` | `$geoIntersects` |
| GET | `/api/demo-queries` | the Queries page list |
| POST | `/api/demo-queries/:id/run` | run one fixed demo query |

Socket.IO event: `new-request`, emitted by the change stream watcher.

Quick test from PowerShell:

```powershell
curl "http://localhost:5000/api/donors/nearby?lng=76.6394&lat=12.2958&km=10&bloodGroup=B%2B"
```

(`%2B` is `+` - a bare `+` in a URL means a space.)

---

## 9. Common errors and fixes

| What you see | Why | Fix |
| --- | --- | --- |
| `MongoServerSelectionError: ... ETIMEOUT` or the seeder says *Could not reach MongoDB* | your current IP is not on the Atlas allow list, or college Wi-Fi changed it | Atlas > Network Access > Add Current IP Address |
| `Authentication failed` | wrong password, or the `<password>` placeholder is still in the URI, or a special character in the password is not encoded | regenerate a simple alphanumeric password for `bloodlink_user` |
| `MONGO_URI is missing` | `.env` was never created, or it sits in the wrong folder | each of `seeder`, `server` and `client` has its own `.env`; copy from `.env.example` |
| `MONGO_URI is not set` from the seeder while `.env` exists | you ran `python seed.py` from the project root instead of from `seeder\` | `cd seeder` first, `load_dotenv()` reads `.env` from the current folder |
| `No hospitals found. Run database/setup.js` | the seeder ran before the setup script | run `mongosh "<uri>" database\setup.js`, then seed again |
| `Document failed validation` (code 121) | a field broke the `$jsonSchema`, usually an age outside 18-65 or coordinates in the wrong order | check the request body; longitude comes first |
| `E11000 duplicate key error ... phone` | that mobile number is already registered | use another number, or `python seed.py --reset` to start clean |
| `error: 2dsphere index required` | the index is missing because `setup.js` did not run on this database | re-run `setup.js` and confirm `location_2dsphere` is listed in its summary |
| `Transaction numbers are only allowed on a replica set` | you pointed the API at a standalone local `mongod` | use the Atlas connection string; M0 is a replica set |
| `$changeStream is not supported` | same reason | same fix |
| The Requests page shows no live toast | the API restarted after the browser connected, or the server is not running | reload the page; the socket reconnects on load |
| `Access to fetch ... blocked by CORS policy` | `CLIENT_URL` in `server\.env` does not match the Vite URL | set it to `http://localhost:5173` exactly, no trailing slash, and restart the API |
| `Cannot reach the API at http://localhost:5000` | the API window was closed, or `VITE_API_URL` is wrong | start the API, check `client\.env`, restart Vite |
| Port 5000 or 5173 *already in use* | an earlier run is still alive | close that window, or `Get-Process -Id (Get-NetTCPConnection -LocalPort 5000).OwningProcess` then `Stop-Process -Id <id>` |
| Map tiles are blank | no internet, or an extension is blocking OpenStreetMap | tiles are fetched live from openstreetmap.org, so the demo machine needs internet |
| `.\.venv\Scripts\Activate.ps1 cannot be loaded` | PowerShell execution policy | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| Changing `.env` seems to do nothing | Vite and the API read `.env` once at startup | restart that terminal |
| Open requests vanished overnight | that is the TTL index doing its job | seed again; TTL deletion runs about once a minute |

---

## 10. Notes on choices

- **No Mongoose.** The official driver keeps the MongoDB query visible in the code, which is the
  point of a database subject project. Validation is done where it belongs: `$jsonSchema` in the
  database and small validators in the API.
- **`bcryptjs` instead of `bcrypt`.** The native `bcrypt` package needs a C++ build toolchain on
  Windows and fails on many college machines. `bcryptjs` is pure JavaScript, uses the same `$2b$`
  hash format, and the Python seeder's `bcrypt` hashes verify against it.
- **OpenStreetMap tiles.** Free and key-free, unlike Google Maps.
- **Known limitations.** Hospitals are not authenticated, so anyone can raise a request from the UI;
  in a deployed system that would sit behind a hospital login. Donor coordinates are approximate by
  design. The TTL index deletes expired requests rather than archiving them, which is deliberate for
  the demo but a real system would move them to a history collection first.

---

## 11. Further reading in this repo

- `DEPLOYMENT.md` - deploying to Vercel, Render and Atlas, with a troubleshooting table and a
  demo day plan
- `docs/why-mongodb.md` - why MongoDB instead of SQL, six points
- `docs/report-outline.md` - report structure
- `docs/presentation-outline.md` - 12 slides
- `docs/viva-questions.md` - 20 questions with answers
