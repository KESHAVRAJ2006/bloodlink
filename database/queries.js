/*
 * BloodLink - demo queries for the viva
 * Run with:  mongosh "<ATLAS_URI>" database/queries.js
 *
 * Every query prints a heading first, so the output can be read top to bottom
 * while explaining the project. Run database/setup.js and seeder/seed.py before
 * this file, otherwise most queries return nothing.
 *
 * The two write examples (update and delete) work on a temporary donor that is
 * inserted and removed by this script, so running it never damages seeded data.
 */

const bloodlink = db.getSiblingDB("bloodlink");

function heading(number, title) {
  print("");
  print("=== " + number + ". " + title + " ===");
}

// Mysuru city centre, used as the search point in the geospatial examples.
const MYSURU = [76.6394, 12.2958];

// A donor may give blood again only after 90 days.
const ELIGIBILITY_CUTOFF = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

/* ------------------------------------------------------ 1. basic find */
// Plain equality match on two fields - the compound index
// { bloodGroup: 1, available: 1 } is used here.
heading(1, "All available O+ donors (first 5)");
printjson(
  bloodlink.donors.find({ bloodGroup: "O+", available: true }).limit(5).toArray()
);

/* ------------------------------------------------------ 2. projection */
// The second argument of find() is the projection: 1 keeps a field, 0 drops it.
// passwordHash and the raw phone number are never sent to the UI.
heading(2, "Projection - only the fields the donor list needs");
printjson(
  bloodlink.donors
    .find(
      { city: "Mysuru", available: true },
      { name: 1, bloodGroup: 1, city: 1, donationCount: 1, _id: 0 }
    )
    .limit(5)
    .toArray()
);

/* ------------------------------------------------- 3. sort and limit */
// -1 means descending. Useful for a "top donors" board.
heading(3, "Top 5 donors by number of donations");
printjson(
  bloodlink.donors
    .find({}, { name: 1, bloodGroup: 1, donationCount: 1, _id: 0 })
    .sort({ donationCount: -1 })
    .limit(5)
    .toArray()
);

/* ------------------------------------------- 4. comparison operators */
// $lt on a date implements the 90 day eligibility rule.
// $or lets a donor who never donated count as eligible.
heading(4, "Eligible donors - available and last donation older than 90 days");
print(
  "eligible donors: " +
    bloodlink.donors.countDocuments({
      available: true,
      $or: [{ lastDonation: { $lt: ELIGIBILITY_CUTOFF } }, { lastDonation: null }]
    })
);

/* ------------------------------------------------- 5. countDocuments */
heading(5, "countDocuments on different filters");
print("total donors        : " + bloodlink.donors.countDocuments());
print("available donors    : " + bloodlink.donors.countDocuments({ available: true }));
print("donors in Bengaluru : " + bloodlink.donors.countDocuments({ city: "Bengaluru" }));
print("open requests       : " + bloodlink.requests.countDocuments({ status: "open" }));

/* ------------------------------------------------------- 6. distinct */
// Returns the distinct values of one field, without duplicates.
heading(6, "distinct cities and blood groups");
printjson(bloodlink.donors.distinct("city"));
printjson(bloodlink.donors.distinct("bloodGroup"));

/* --------------------------------------------- 7. insertOne (temp doc) */
// This donor only exists so the update and delete examples below have a
// harmless target. It is removed again in query 10.
heading(7, "insertOne - temporary demo donor");
const demoDonor = {
  name: "Demo Donor",
  phone: "9000000001",
  email: "demo.donor@bloodlink.test",
  bloodGroup: "O+",
  age: 24,
  gender: "male",
  city: "Mysuru",
  location: { type: "Point", coordinates: MYSURU },
  lastDonation: null,
  available: true,
  donationCount: 0,
  registeredOn: new Date()
};
bloodlink.donors.deleteOne({ phone: "9000000001" }); // in case an earlier run left it behind
printjson(bloodlink.donors.insertOne(demoDonor));

/* ------------------------------------------- 8. updateOne with $set */
// $set replaces the value of a field. This is what the availability toggle does.
heading(8, "updateOne with $set - switch availability off");
printjson(
  bloodlink.donors.updateOne({ phone: "9000000001" }, { $set: { available: false } })
);

/* ----------------------------------- 9. updateOne with $set and $inc */
// Exactly what recording a donation does: stamp the date and add one to the
// counter in a single atomic update of one document.
heading(9, "updateOne with $set and $inc - record a donation");
printjson(
  bloodlink.donors.updateOne(
    { phone: "9000000001" },
    { $set: { lastDonation: new Date(), available: true }, $inc: { donationCount: 1 } }
  )
);
printjson(bloodlink.donors.findOne({ phone: "9000000001" }, { name: 1, donationCount: 1, lastDonation: 1 }));

/* ----------------------------------------------------- 10. deleteOne */
// deleteOne removes the first document that matches the filter.
heading(10, "deleteOne - remove the temporary donor");
printjson(bloodlink.donors.deleteOne({ phone: "9000000001" }));

/* ---------------------------------------------------------- 11. $near */
// $near needs the 2dsphere index and returns documents sorted by distance,
// nearest first. $maxDistance is in metres.
heading(11, "$near - 10 nearest available donors to Mysuru centre");
printjson(
  bloodlink.donors
    .find(
      {
        available: true,
        location: {
          $near: {
            $geometry: { type: "Point", coordinates: MYSURU },
            $maxDistance: 15000
          }
        }
      },
      { name: 1, bloodGroup: 1, city: 1, _id: 0 }
    )
    .limit(10)
    .toArray()
);

/* ------------------------------------- 12. $geoNear with distanceField */
// The aggregation version of $near. Unlike $near it can return the computed
// distance, which is what the UI shows as "4.2 km away".
// $geoNear must be the first stage of the pipeline.
heading(12, "$geoNear - nearest eligible O+/O- donors with distance in km");
printjson(
  bloodlink.donors
    .aggregate([
      {
        $geoNear: {
          near: { type: "Point", coordinates: MYSURU },
          distanceField: "distanceMeters",
          maxDistance: 25000,
          spherical: true,
          // query runs inside the geo stage, so filtering costs nothing extra
          query: {
            available: true,
            bloodGroup: { $in: ["O+", "O-"] },
            $or: [{ lastDonation: { $lt: ELIGIBILITY_CUTOFF } }, { lastDonation: null }]
          }
        }
      },
      { $limit: 8 },
      {
        $project: {
          _id: 0,
          name: 1,
          bloodGroup: 1,
          city: 1,
          distanceKm: { $round: [{ $divide: ["$distanceMeters", 1000] }, 2] }
        }
      }
    ])
    .toArray()
);

/* ------------------------------- 13. $geoWithin with $centerSphere */
// A circle on the sphere: [[lng, lat], radiusInRadians].
// Radians = kilometres / 6378.1 (the equatorial radius of the earth in km).
// $geoWithin does not sort by distance, so it is cheaper than $near when the
// order does not matter - for example to count donors inside a radius.
heading(13, "$geoWithin with $centerSphere - donors inside a 10 km circle");
const radiusKm = 10;
print(
  "donors within " + radiusKm + " km of Mysuru centre: " +
    bloodlink.donors.countDocuments({
      location: { $geoWithin: { $centerSphere: [MYSURU, radiusKm / 6378.1] } }
    })
);

/* ---------------------------- 14. $geoWithin with a stored polygon */
// The polygon is not hard coded: it is read from the cityZones collection and
// passed into the donors query, which is how the /api/donors/in-city route works.
heading(14, "$geoWithin with the Mandya city polygon");
const mandyaZone = bloodlink.cityZones.findOne({ name: "Mandya" });
print(
  "donors inside the Mandya zone: " +
    bloodlink.donors.countDocuments({
      location: { $geoWithin: { $geometry: mandyaZone.area } }
    })
);
printjson(
  bloodlink.donors
    .find(
      { location: { $geoWithin: { $geometry: mandyaZone.area } } },
      { name: 1, bloodGroup: 1, city: 1, _id: 0 }
    )
    .limit(5)
    .toArray()
);

/* -------------------------------------------------- 15. $geoIntersects */
// $geoIntersects asks whether two shapes share any point. Here it answers
// "which city zone does this hospital fall in?" by intersecting the stored
// polygons with a single point.
heading(15, "$geoIntersects - which zone contains Victoria Hospital");
const victoria = bloodlink.hospitals.findOne({ name: "Victoria Hospital" });
printjson(
  bloodlink.cityZones
    .find(
      { area: { $geoIntersects: { $geometry: victoria.location } } },
      { name: 1, district: 1, _id: 0 }
    )
    .toArray()
);

/* ------------------------------------------------------- 16. $group */
// The classic grouping pipeline: donors per blood group, most common first.
heading(16, "$group - donors per blood group");
printjson(
  bloodlink.donors
    .aggregate([
      { $group: { _id: "$bloodGroup", total: { $sum: 1 }, available: { $sum: { $cond: ["$available", 1, 0] } } } },
      { $sort: { total: -1 } },
      { $project: { _id: 0, bloodGroup: "$_id", total: 1, available: 1 } }
    ])
    .toArray()
);

/* ---------------------------------------------- 17. $group with $avg */
heading(17, "$group - average age and donation count per city");
printjson(
  bloodlink.donors
    .aggregate([
      {
        $group: {
          _id: "$city",
          donors: { $sum: 1 },
          averageAge: { $avg: "$age" },
          totalDonations: { $sum: "$donationCount" }
        }
      },
      { $project: { _id: 0, city: "$_id", donors: 1, averageAge: { $round: ["$averageAge", 1] }, totalDonations: 1 } },
      { $sort: { donors: -1 } }
    ])
    .toArray()
);

/* ------------------------------------------------------ 18. $lookup */
// A left outer join: each request is joined to its hospital document.
// MongoDB has no foreign keys, so the join is written in the query instead.
heading(18, "$lookup - open requests joined with their hospital");
printjson(
  bloodlink.requests
    .aggregate([
      { $match: { status: "open" } },
      {
        $lookup: {
          from: "hospitals",
          localField: "hospitalId",
          foreignField: "_id",
          as: "hospital"
        }
      },
      { $unwind: "$hospital" },
      { $sort: { createdAt: -1 } },
      { $limit: 5 },
      {
        $project: {
          _id: 0,
          patientName: 1,
          bloodGroup: 1,
          unitsNeeded: 1,
          urgency: 1,
          hospitalName: "$hospital.name",
          city: "$hospital.city"
        }
      }
    ])
    .toArray()
);

/* ------------------------------------------- 19. $lookup on donations */
heading(19, "$lookup - donation history of the most active donor");
const topDonor = bloodlink.donors.find().sort({ donationCount: -1 }).limit(1).next();
printjson(
  bloodlink.donations
    .aggregate([
      { $match: { donorId: topDonor._id } },
      { $lookup: { from: "hospitals", localField: "hospitalId", foreignField: "_id", as: "hospital" } },
      { $unwind: "$hospital" },
      { $sort: { date: -1 } },
      { $project: { _id: 0, date: 1, units: 1, hospital: "$hospital.name" } }
    ])
    .toArray()
);

/* ------------------------------------------------------- 20. $facet */
// $facet runs several independent pipelines over the same input in one pass.
// The whole dashboard is built from this single query.
heading(20, "$facet - complete dashboard in one query");
printjson(
  bloodlink.donors
    .aggregate([
      {
        $facet: {
          perBloodGroup: [
            { $group: { _id: "$bloodGroup", count: { $sum: 1 } } },
            { $sort: { count: -1 } }
          ],
          perCity: [
            { $group: { _id: "$city", count: { $sum: 1 } } },
            { $sort: { count: -1 } }
          ],
          eligible: [
            {
              $match: {
                available: true,
                $or: [{ lastDonation: { $lt: ELIGIBILITY_CUTOFF } }, { lastDonation: null }]
              }
            },
            { $count: "count" }
          ],
          totals: [{ $count: "donors" }]
        }
      }
    ])
    .toArray()
);

/* ------------------------------------------------------- 21. $bucket */
// $bucket sorts documents into ranges. Boundaries are lower bound inclusive,
// upper bound exclusive, so 18-25 means 18 to 24.
heading(21, "$bucket - donors by age group");
printjson(
  bloodlink.donors
    .aggregate([
      {
        $bucket: {
          groupBy: "$age",
          boundaries: [18, 26, 36, 46, 56, 66],
          default: "other",
          output: { donors: { $sum: 1 }, averageDonations: { $avg: "$donationCount" } }
        }
      }
    ])
    .toArray()
);

/* ------------------------------------- 22. requests grouped by urgency */
heading(22, "$group - open requests by urgency and units still needed");
printjson(
  bloodlink.requests
    .aggregate([
      { $match: { status: "open" } },
      { $group: { _id: "$urgency", requests: { $sum: 1 }, units: { $sum: "$unitsNeeded" } } },
      { $sort: { units: -1 } }
    ])
    .toArray()
);

/* ---------------------------------------- 23. explain executionStats */
// Proof for the viva that the 2dsphere index is actually used: look for
// "GEO_NEAR_2DSPHERE" as the winning plan stage and compare totalDocsExamined
// with nReturned.
heading(23, "explain(executionStats) on the $near query");
const explained = bloodlink.donors
  .find({
    available: true,
    location: { $near: { $geometry: { type: "Point", coordinates: MYSURU }, $maxDistance: 15000 } }
  })
  .explain("executionStats");
print("winning plan stage : " + explained.queryPlanner.winningPlan.inputStage.stage);
print("documents returned : " + explained.executionStats.nReturned);
print("documents examined : " + explained.executionStats.totalDocsExamined);
print("keys examined      : " + explained.executionStats.totalKeysExamined);
print("execution time (ms): " + explained.executionStats.executionTimeMillis);

/* ------------------------- 24. explain on the compound index query */
heading(24, "explain(executionStats) on the compound index query");
const explainedCompound = bloodlink.donors
  .find({ bloodGroup: "O+", available: true })
  .explain("executionStats");
print("winning plan stage : " + explainedCompound.queryPlanner.winningPlan.stage);
print("index used         : " + JSON.stringify(explainedCompound.queryPlanner.winningPlan.inputStage.keyPattern));
print("documents returned : " + explainedCompound.executionStats.nReturned);
print("documents examined : " + explainedCompound.executionStats.totalDocsExamined);

/* ----------------------------------------------- 25. index inventory */
heading(25, "Indexes on every collection");
["donors", "hospitals", "requests", "donations", "cityZones"].forEach(function (name) {
  print("");
  print(name + ":");
  bloodlink.getCollection(name).getIndexes().forEach(function (index) {
    print("  " + index.name + "  " + JSON.stringify(index.key) +
      (index.unique ? "  [unique]" : "") +
      (index.expireAfterSeconds !== undefined ? "  [TTL " + index.expireAfterSeconds + "s]" : ""));
  });
});

print("");
print("--- end of demo queries ---");
