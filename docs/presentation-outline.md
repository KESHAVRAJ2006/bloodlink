# BloodLink - 12 slide presentation outline

Plan for roughly 12 to 15 minutes, with a live demo in the middle. Two speakers: student A takes
slides 1-6, student B takes 7-12, and both answer questions. Keep text on slides short - the
sentences below are what you *say*, not what you print.

---

### Slide 1 - Title

BloodLink: Nearest Blood Donor Finder using MongoDB Geospatial Queries. Both names and USNs, guide,
department, date. Domain: Healthcare.

*Say:* one line on what the project does, so the room knows where this is going.

---

### Slide 2 - The problem

Three bullets: a critical requirement is handled by phone calls and group messages; nobody knows
which donors are close by *and* eligible today; donors who donated last month still get called.

*Say:* the 90 day rule is the detail most systems ignore, and it is the one that wastes everyone's
time.

---

### Slide 3 - Objectives

The five numbered objectives from the report: geospatial storage, nearest eligible donor in one
query, rules inside the query, live alerts, privacy of contact details.

---

### Slide 4 - Why MongoDB, not SQL

A two column table: *what BloodLink needs* against *what MongoDB gives*. Six rows - 2dsphere index,
`$geoNear`, GeoJSON as a value, flexible donor documents, TTL on requests, change streams.

*Say:* one sentence on each; mention that PostGIS could do the geospatial part, and that the
difference is that here it is part of the query language, not an extension.

---

### Slide 5 - Architecture

The architecture diagram, with the seven arrows numbered.

*Say:* walk the arrows in order - Python seeds the data, mongosh builds the indexes, Express queries
the cluster, the change stream pushes back, React calls REST and listens on a socket, Atlas Charts
is embedded directly.

---

### Slide 6 - Data model

The five collections as five small boxes with their key fields, plus an index table underneath:
`2dsphere` on `donors.location`, compound `{ bloodGroup, available }`, unique on `phone`, TTL on
`requests.expiresAt`, `2dsphere` on `cityZones.area`.

*Say:* highlight that `coordinates` is `[longitude, latitude]`, and that `$jsonSchema` enforces the
blood group enum and the 18-65 age range in the database itself.

---

### Slide 7 - The main query

One code block, large font:

```js
db.donors.aggregate([
  { $geoNear: {
      near: { type: "Point", coordinates: [lng, lat] },
      distanceField: "distanceMeters",
      maxDistance: km * 1000,
      spherical: true,
      query: { available: true,
               bloodGroup: { $in: compatibleGroups },
               $or: [{ lastDonation: { $lt: cutoff } }, { lastDonation: null }] } } },
  { $limit: 50 }
])
```

*Say:* four things in one stage - radius, eligibility, compatibility, sorted by real distance with
the distance returned. Point out the `$or` null case and why `$geoNear` has to be the first stage.

---

### Slide 8 - Business rules

Eligibility in one line. The compatibility table (patient against donor groups) as the slide's main
content, with O- and AB+ circled.

*Say:* the map lives in the server and goes into the query as `$in`, so compatibility costs one
index lookup rather than eight queries.

---

### Slide 9 - Live demo (no slide text, just a title)

Demo order, roughly four minutes:

1. Home, *Use my location*, blood group B+
2. Find Donors: drag the radius, click the map to move the search point, show the list re-sorting,
   press Contact on one donor to reveal the number
3. Hospitals: pick JSS Hospital, show eligible donors around it
4. Requests: open a second browser window side by side, raise a critical request in one, let the
   toast appear in the other - that is the change stream
5. Record a donation against that request, then show on the profile that `donationCount` went up
   and the donor is no longer eligible - that is the transaction
6. Dashboard: four charts plus the embedded Atlas chart
7. Queries page: run the `$geoNear` query and the `explain` query

Have a fallback: screenshots on the next hidden slide, in case the college Wi-Fi blocks Atlas.

---

### Slide 10 - Transactions, TTL and change streams

Three short blocks, one per feature, each with the single line of code and one line of why:

- `session.withTransaction(...)` - donation, donor update and request fulfilment land together
- `createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })` - expired requests delete themselves
- `requests.watch([{ $match: { operationType: "insert" } }])` - no polling anywhere

---

### Slide 11 - Testing and index proof

The `explain("executionStats")` output: `GEO_NEAR_2DSPHERE` as the winning stage, documents examined
against documents returned. Beside it, five rows of the test case table.

*Say:* this is the evidence the index is being used rather than a scan.

---

### Slide 12 - Conclusion and future work

What was achieved in one line. Limitations in one line - no hospital login, approximate coordinates,
no SMS. Future work as four bullets: SMS and WhatsApp alerts, hospital accounts with an audit log,
road distance via a routing API, a mobile app. Close with a thank you and *questions*.

---

### Preparation checklist

- Seed the database the night before, and again an hour before the viva if requests have expired
- Add the venue's IP address in Atlas Network Access before you present
- Open all four terminals in advance and leave the API and client running
- Two browser windows side by side, ready for the live request demo
- Keep `database/queries.js` output open in a terminal tab in case the examiner asks for raw mongosh
- Phone hotspot ready, since both Atlas and the map tiles need internet
