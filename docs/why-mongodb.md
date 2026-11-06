# Why MongoDB instead of SQL for this project

Six reasons, in the order they matter to BloodLink.

### 1. A `2dsphere` index makes "who is nearby" a cheap query

MongoDB indexes a GeoJSON point on a sphere using S2 cell IDs. One index declaration:

```js
db.donors.createIndex({ location: "2dsphere" })
```

and every nearest-donor search then examines only the cells around the search point instead of all
500 donors. `explain("executionStats")` on our `$near` query shows the `GEO_NEAR_2DSPHERE` stage and
a number of documents examined close to the number returned.

In plain SQL without an extension there is no spatial index, so the same search becomes a full table
scan with a Haversine formula in the `WHERE` clause, and the distance cannot be indexed because it is
computed per row. PostgreSQL can do this properly, but only after installing PostGIS and learning a
second query language on top of SQL - geospatial support is bolted on, where in MongoDB it is part
of the query language.

### 2. `$geoNear` returns the distance, sorted, in one stage

```js
{ $geoNear: { near: point, distanceField: "distanceMeters", maxDistance: 10000, spherical: true,
              query: { available: true, bloodGroup: { $in: [...] } } } }
```

That single stage does four things: filters by radius, filters by eligibility and blood group, sorts
by true spherical distance and adds the computed distance to each document. The UI shows "4.2 km
away" with no post-processing. The SQL equivalent is a subquery computing distance for every row,
wrapped in an outer query that filters and sorts on that computed column.

### 3. GeoJSON is a first class value, not three columns

A donor's location is stored exactly as the mapping world defines it:

```js
location: { type: "Point", coordinates: [76.6394, 12.2958] }
```

The same shape travels unchanged from MongoDB to the Express response to Leaflet in the browser, and
the city zones are stored the same way as `Polygon` documents. In a relational schema this becomes
`latitude` and `longitude` columns which the application has to reassemble, and a polygon needs a
separate `zone_points` table with a sequence column to remember the ring order.

### 4. Flexible donor profiles without migrations

Donor documents are not uniform: some donors have an email, some do not; `lastDonation` is `null`
for a first-time donor; a `requestId` on a donation is absent for a walk-in donation. Adding a field
later - a medical note, a preferred donation centre, a second contact number - means writing it on
new documents, with no `ALTER TABLE` and no downtime on a shared cluster.

Flexible does not mean unchecked. `$jsonSchema` validation in `database/setup.js` still enforces the
rules that matter: the eight blood groups, age between 18 and 65, and a `location` that must be a
GeoJSON `Point` with two numbers. That is schema where it is useful, without a migration for every
optional field.

### 5. A TTL index expires urgent requests without a cleanup job

```js
db.requests.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
```

A critical request is only meaningful for a few hours. MongoDB deletes the document itself once
`expiresAt` passes, through a background task that runs about once a minute. In SQL this is either a
cron job, a scheduled stored procedure, or an `expires_at > NOW()` condition repeated in every query
and a table that grows forever.

### 6. Change streams give live updates without polling

```js
requests().watch([{ $match: { operationType: "insert" } }])
```

The server subscribes to the oplog and MongoDB pushes each new request to it the moment the write
commits. The server forwards it over Socket.IO, so a critical request appears in the browser in well
under a second. Nothing polls.

A relational version means either the browser asking "anything new?" every few seconds - most of
those requests returning nothing - or adding a trigger plus a message queue, which is two more
pieces of infrastructure. MongoDB already keeps the oplog for replication, so the change stream is
built on something that was there anyway.

### Where SQL would be the better choice

Worth saying in the viva, because it shows judgement rather than loyalty: if BloodLink grew into a
blood bank's billing and inventory system - fixed schema, many-to-many joins across units, bags,
tests and invoices, and strict accounting integrity - a relational database would fit that part
better. BloodLink needs geospatial search, flexible documents and live updates, and those are the
three things MongoDB does natively. Note also that MongoDB does support multi-document ACID
transactions, which this project uses when recording a donation, so "no transactions" is no longer a
reason to reach for SQL.
