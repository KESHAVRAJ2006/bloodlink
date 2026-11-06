# BloodLink - project report outline

A structure for a 35 to 45 page report. Page counts are a guide, not a rule. Anything marked
**[figure]** is a screenshot or diagram you can take straight from the running project.

---

### Front matter

- Title page: project title, course and subject code, both student names and USNs, guide name,
  department, institution, academic year 2026-27
- Certificate page (as per your department format)
- Declaration
- Acknowledgement
- Abstract - 150 to 200 words. One paragraph: the problem, what BloodLink does, the MongoDB
  features used, the measurable result (500 donors, nearest eligible donor in one aggregation).
- Table of contents, list of figures, list of tables

---

### Chapter 1 - Introduction (3-4 pages)

1.1 Background: how blood requirement is handled today - phone trees, WhatsApp groups, notice
boards - and why that is slow
1.2 Problem statement: a hospital with a critical B+ requirement has no way to see, in order of
distance, which registered donors may donate today
1.3 Objectives, as a numbered list:
  1. store donors as geospatial points and index them
  2. return the nearest eligible donors for a patient blood group in one query
  3. apply the 90 day rule and blood group compatibility inside the query
  4. push urgent requests to connected clients live
  5. keep donor contact details private until a hospital asks for one
1.4 Scope: three cities in Karnataka, 500 seeded donors, demo-level authentication
1.5 Organisation of the report

### Chapter 2 - Literature survey / existing systems (3-4 pages)

2.1 e-RaktKosh and state blood bank portals - inventory focused, not donor proximity
2.2 Blood donor apps and social media groups - reach without structure
2.3 Comparison table: proximity search, eligibility rule, live alerts, privacy
2.4 Gap identified, and how BloodLink addresses it

### Chapter 3 - System requirements (2-3 pages)

3.1 Functional requirements, as FR-1 to FR-12 (register, login, nearby search, city search,
raise request, cancel request, record donation, availability toggle, dashboard, live alert,
contact reveal, hospital CRUD)
3.2 Non-functional requirements: response under one second for a nearby search, privacy of contact
numbers, works on a free tier cluster, runs on Windows with Node and Python only
3.3 Hardware and software requirements, with the versions you actually used

### Chapter 4 - System design (6-8 pages)

4.1 Architecture diagram and the seven data flows **[figure: the ASCII diagram from the README,
redrawn]**
4.2 Technology stack and why each piece is there: Python seeder, mongosh scripts, Express and
TypeScript API, React and Leaflet client, Atlas Charts
4.3 Collection design: the five collections, their fields and types, with a sample document each
4.4 Index design table: index, type, which query uses it, why
4.5 Schema validation with `$jsonSchema`
4.6 Relationships without foreign keys: `hospitalId` and `donorId` references, resolved with
`$lookup`, and why requests are not embedded in hospitals
4.7 Why MongoDB instead of SQL - the six points from `docs/why-mongodb.md`
4.8 Sequence diagram for the nearby search: browser, API, MongoDB **[figure]**
4.9 Sequence diagram for the live request: insert, change stream, Socket.IO, browser **[figure]**

### Chapter 5 - Implementation (10-12 pages)

5.1 Database setup script: collections, validators, indexes, reference data
5.2 Data seeding: Faker with the Indian locale, the Indian blood group distribution, coordinate
jitter per city, how `lastDonation` and `donationCount` are kept consistent with the donations
collection
5.3 The REST API: folder layout, one `MongoClient` for the process, typed collection accessors
5.4 The main query, with the code listing and a line by line explanation of `$geoNear`
5.5 Eligibility and compatibility: the `$or` null case and the compatibility map used with `$in`
5.6 `$geoWithin` with `$centerSphere` and with a stored polygon; `$geoIntersects` for zone lookup
5.7 The donation transaction: `session.withTransaction`, the three writes, what happens on abort
5.8 TTL index behaviour, with a before and after screenshot of an expiring request
5.9 The change stream watcher and the Socket.IO event
5.10 Authentication: bcrypt hashing, JWT issue and verification, which routes are protected
5.11 Privacy: phone masking in the API, the single-donor contact endpoint
5.12 The dashboard aggregation: `$facet`, `$bucket`, `$group`
5.13 The React client: routing, the Leaflet map with pins, circle and polygons, the charts
5.14 Code listings of the important files (keep each listing short, put full files in the appendix)

### Chapter 6 - Testing (4-5 pages)

6.1 Test strategy: manual functional testing plus query verification in mongosh
6.2 Test case table: ID, description, input, expected, actual, pass or fail. Include at least
  - nearby search returns donors sorted by increasing distance
  - a donor who donated 30 days ago is excluded
  - a donor who never donated is included
  - searching for AB+ returns all eight groups, searching O- returns only O-
  - registering with age 17 is rejected by the database validator
  - registering a duplicate phone number is rejected with 409
  - coordinates swapped by mistake are rejected with a clear message
  - cancelling an already cancelled request fails cleanly
  - recording a donation increments `donationCount` by exactly one and fulfils the request
  - a request inserted in one browser appears in a second browser without a refresh
6.3 Index verification with `explain("executionStats")`: documents examined versus returned,
with and without the 2dsphere index **[figure]**
6.4 Observations on performance with 500 donors

### Chapter 7 - Results and screenshots (4-6 pages)

One screenshot per page with a caption and two or three lines of explanation: Home, Find Donors with
the radius circle, the donor list with masked numbers, Register with the map picker, My Profile,
Requests with the live toast, Hospitals with nearby donors, Dashboard with the four charts and the
Atlas chart, the Queries page showing a query and its result, mongosh output of `queries.js`,
Atlas collections view, Atlas index view.

### Chapter 8 - Conclusion and future work (2 pages)

8.1 Conclusion: what was built and what the geospatial index made possible
8.2 Limitations, stated honestly: no hospital authentication, approximate coordinates, no SMS
8.3 Future work: SMS and WhatsApp alerts, hospital accounts and an audit log, blood bank stock in
the same model, donor reward points, `$geoNear` with road distance through a routing service,
Atlas Search for name lookup, a React Native app

---

### References

MongoDB manual pages for geospatial queries, `$geoNear`, TTL indexes, change streams, transactions
and `$jsonSchema`; the Leaflet and OpenStreetMap documentation; the Chart.js documentation; WHO or
NBTC guidance on the 90 day donation interval; any blood group compatibility reference you cite.
Use one consistent style (IEEE) and number them in order of first appearance.

### Appendix

A. Full source listings per folder
B. The complete `database/queries.js` output from one run
C. `.env.example` files, with no real passwords
