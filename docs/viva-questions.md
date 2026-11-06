# 20 likely viva questions, with short answers

Answers are kept to what you can say out loud in about thirty seconds. Where a question has a
follow-up the examiner usually asks next, it is marked *Follow-up*.

---

**1. Why is the order `[longitude, latitude]` and not latitude first?**

Because GeoJSON, which MongoDB follows, orders coordinates as `[x, y]` and on a map x is longitude.
Maps, phones and Google Maps print `lat, lng`, so the two conventions are reversed and swapping them
is the most common geospatial bug. Our API takes `lng` and `lat` as separate named parameters so
they cannot be mixed up by position, and the validator rejects a latitude outside -90 to 90.

---

**2. What is a 2dsphere index, and how is it different from a 2d index?**

`2dsphere` indexes points on a sphere, so distances are computed on the earth's surface in metres
and it supports GeoJSON points, lines and polygons. `2d` is the older index for a flat plane with
legacy coordinate pairs; it does not understand GeoJSON and cannot answer `$geoIntersects`. For real
world latitude and longitude the answer is always `2dsphere` - a flat index would be wrong near the
poles and across the date line.

---

**3. Difference between `$near`, `$geoNear` and `$geoWithin`?**

- `$near` is a query operator used in `find()`. It returns documents sorted by distance, nearest
  first, and requires a geospatial index.
- `$geoNear` is an aggregation stage. It does what `$near` does and can also write the computed
  distance into a field through `distanceField`, which is how we show "4.2 km away". It must be the
  first stage in the pipeline, and only one is allowed per pipeline.
- `$geoWithin` returns everything inside a shape with **no sorting**, so it is cheaper when the
  order does not matter - counting donors in a radius, or listing everyone inside a city polygon.

*Follow-up: why must `$geoNear` be first?* It uses the geospatial index to produce the documents in
distance order, so it has to be the stage that reads the collection. Nothing can come before it.

---

**4. Why is `maxDistance` in metres but `$centerSphere` in radians?**

`$geoNear` and `$near` on a `2dsphere` index work with GeoJSON, where distances are metres.
`$centerSphere` takes a legacy centre and a radius in radians, so kilometres have to be divided by
the earth's radius, 6378.1 km. In our code: `{ $centerSphere: [[lng, lat], km / 6378.1] }`.

---

**5. How does the search know a donor is eligible?**

A donor is eligible when `available` is `true` and the last donation is older than 90 days. The
filter is `{ available: true, $or: [{ lastDonation: { $lt: cutoff } }, { lastDonation: null }] }`.
The `$or` is needed because `$lt` does not match `null`, and a donor who has never donated has
`lastDonation: null` - without the `$or`, every first-time donor would silently disappear from
results.

---

**6. How is blood group compatibility handled?**

A map in `server/src/compatibility.ts` lists the donor groups each patient group can receive, for
example AB+ can receive from all eight and O- only from O-. The query uses the matching array with
`$in`, so the eight possibilities are one index lookup, not eight queries. The compound index
`{ bloodGroup: 1, available: 1 }` serves it.

---

**7. Why a compound index on `{ bloodGroup: 1, available: 1 }` and not two separate indexes?**

Because the two fields are always queried together. MongoDB normally uses one index per query, so a
compound index lets it jump straight to, say, O+ and available, while two single-field indexes would
mean using one and filtering the rest in memory. Order matters: this index can also serve a query on
`bloodGroup` alone - the prefix rule - but not one on `available` alone.

---

**8. What is a TTL index and how is it used here?**

`db.requests.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })`. MongoDB runs a background
task about once a minute that deletes documents whose `expiresAt` is in the past.
`expireAfterSeconds: 0` means "expire exactly at the stored date" rather than a fixed number of
seconds after it. Our critical requests get 12 hours, urgent 24, normal 72, so stale requests clean
themselves up with no cron job.

*Follow-up: is deletion instant?* No - it happens on the next sweep, so a document can live up to a
minute past its deadline. The field must also be a BSON date, not a string.

---

**9. What is a change stream, and why not just poll?**

A change stream subscribes to the oplog and MongoDB pushes each matching change to the application
as it commits. We watch `requests` for `operationType: "insert"` and forward the document over
Socket.IO, so a new critical request shows up in the browser in under a second. Polling would mean
every browser asking every few seconds, with most of those requests returning nothing, and the alert
would still be a few seconds late.

*Follow-up: what does it need?* A replica set, because the oplog is a replication feature. Atlas is
a replica set even on the free tier; a single standalone `mongod` cannot do it.

---

**10. Do transactions work in MongoDB, and where do you use one?**

Yes, multi-document ACID transactions have been available since version 4.0 on replica sets.
Recording a donation uses one: `session.withTransaction` inserts the donation, updates the donor
with `$set` on `lastDonation` and `$inc` on `donationCount`, and sets the request to `fulfilled`.
Either all three writes commit or none do. Without it, a failure after the first write would leave a
donor who looks eligible immediately after donating - a safety problem in a blood system.

*Follow-up: why not use one everywhere?* A transaction holds a snapshot and costs more than a plain
write. A single document update is already atomic in MongoDB, so a transaction is only needed when
two or more documents must change together.

---

**11. A single document update is atomic - so what does that mean for `$set` and `$inc`?**

Any update of one document, however many operators it contains, is applied atomically; no reader
ever sees half of it. That is why `{ $set: { lastDonation: date }, $inc: { donationCount: 1 } }` is
safe on its own, and also why `$inc` is better than reading the count, adding one and writing it
back - the read-modify-write version loses an update if two donations are recorded at the same
moment.

---

**12. What does `$jsonSchema` validation do, and is MongoDB not schema-less?**

MongoDB does not require a schema, but you can choose to enforce one per collection. Our donors
validator requires the main fields, restricts `bloodGroup` to eight values, limits `age` to 18-65
and insists `location` is a `Point` with exactly two numbers. A document that breaks it is rejected
with error code 121. So the flexibility is a choice: optional fields stay optional, while the rules
that matter are enforced by the database rather than trusted to the application.

---

**13. How do you join collections without foreign keys?**

With `$lookup` in an aggregation, which is a left outer join. Requests store a `hospitalId`, and the
list query looks the hospital up and `$unwind`s the resulting one-element array. There is no
referential integrity, so the application has to check that the `hospitalId` exists - our POST
`/api/requests` does exactly that before inserting.

*Follow-up: embed or reference?* Embed data that is read with its parent and does not grow without
limit; reference data that is shared or unbounded. A hospital is shared by many requests, so it is
referenced. A donor's location belongs only to that donor, so it is embedded.

---

**14. What does `$facet` do on the dashboard?**

`$facet` runs several independent sub-pipelines over the same input documents in one pass. Our
`/api/stats` gets donors per blood group, donors per city, age buckets, the eligible count and the
totals from one trip to the server instead of five. The cost is that each sub-pipeline sees the same
input, so a `$facet` cannot be combined with a stage that needs an index after it.

---

**15. Difference between `$group` and `$bucket`?**

`$group` groups by an exact value - one group per blood group. `$bucket` groups by *ranges* of a
numeric field - ages 18-25, 26-35 and so on - with boundaries that include the lower bound and
exclude the upper one, plus a `default` bucket for anything outside. We use `$group` for blood
groups and cities and `$bucket` for ages.

---

**16. What does `$geoIntersects` do that `$geoWithin` does not?**

`$geoWithin` asks whether a shape is completely inside another. `$geoIntersects` asks whether two
shapes share at least one point, so it also matches shapes that only overlap or touch. We use it to
answer "which city zone contains this hospital point", and it would be the right operator for "which
zones does this ambulance route cross".

---

**17. How do you prove the index is actually being used?**

`db.donors.find({ ... $near ... }).explain("executionStats")`. The winning plan shows the
`GEO_NEAR_2DSPHERE` stage, and `totalDocsExamined` stays close to `nReturned` instead of 500, which
is what a `COLLSCAN` would look like. The Queries page in the app runs this and prints the numbers,
and `database/queries.js` prints them in mongosh.

---

**18. How are passwords and donor privacy handled?**

Passwords are hashed with bcrypt at cost 10 and only the hash is stored; the plain password is never
saved and never logged. Every donor response goes through one function that drops `passwordHash` and
replaces the phone number with a masked version like `98xxxxxx78`. The real number comes from a
separate endpoint that returns one donor at a time, so a list request cannot harvest 500 numbers.
Login returns the same error for an unknown number and a wrong password, so the endpoint cannot be
used to discover which numbers are registered.

---

**19. Why the official driver instead of Mongoose?**

Because the subject is the database. With the driver the MongoDB query appears in the code exactly as
it would in mongosh, which is also what makes the Queries page honest - the text shown next to each
result is the query that ran. Mongoose would add a second schema layer in JavaScript on top of the
`$jsonSchema` already in the database, and would hide the aggregation behind its own API.

---

**20. What are the limitations, and what would you do next?**

Hospitals are not authenticated, so in the demo anyone can raise a request; that belongs behind a
hospital login with an audit trail. Distance is straight-line, not road distance, which a routing
API would fix. There is no SMS or WhatsApp alert, so a donor has to be looking at the site. Donor
coordinates are deliberately approximate, which is good for privacy but means the distance is
approximate too. Next steps would be hospital accounts, SMS alerts, blood stock in the same data
model, and sharding or a paid tier if the donor count grew past what an M0 cluster is sized for.

---

### Three questions worth preparing for, just in case

**Why not store distance in the database?** Because it depends on the search point, which is
different for every query. It has to be computed per query, which is what `$geoNear` does.

**What happens if two hospitals record a donation from the same donor at the same moment?** Both
transactions run, but the second one re-reads the donor inside its own transaction and the
eligibility check fails, so it aborts with a clear message. The donation collection cannot end up
with two same-day donations by the same donor.

**How large can this grow before it breaks?** An M0 cluster gives 512 MB, which is tens of thousands
of donor documents. The nearby query stays fast because the 2dsphere index limits the work to the
cells near the search point; beyond that the next steps would be a larger tier and then sharding on
a geographic key.
