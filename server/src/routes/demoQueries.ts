import { Router } from "express";
import { eligibilityCutoff } from "../compatibility.js";
import { cityZones, donors, hospitals, requests } from "../db.js";
import { asyncRoute, notFound } from "../utils/http.js";

const router = Router();

/**
 * The Queries page in the client shows the MongoDB query on the left and its
 * live result on the right, which is the part the examiners usually ask about.
 *
 * The query text is written out as a string instead of being generated from the
 * code, so what is displayed is readable mongosh syntax rather than a dump of
 * the driver call. The run function next to it executes the same thing.
 */

interface DemoQuery {
  id: string;
  title: string;
  feature: string;
  explanation: string;
  code: string;
  run: () => Promise<unknown>;
}

const MYSURU: [number, number] = [76.6394, 12.2958];

const demoQueries: DemoQuery[] = [
  {
    id: "find-projection",
    title: "Available O+ donors with a projection",
    feature: "find, projection, limit",
    explanation:
      "Equality match on two fields, served by the compound index { bloodGroup: 1, available: 1 }. The projection keeps the response small and leaves out passwordHash completely.",
    code: `db.donors.find(
  { bloodGroup: "O+", available: true },
  { name: 1, city: 1, donationCount: 1, _id: 0 }
).limit(5)`,
    run: () =>
      donors()
        .find({ bloodGroup: "O+", available: true }, { projection: { name: 1, city: 1, donationCount: 1, _id: 0 } })
        .limit(5)
        .toArray(),
  },
  {
    id: "sort-limit",
    title: "Top five donors by donation count",
    feature: "sort, limit",
    explanation: "sort takes -1 for descending. Together with limit this is how any leaderboard is built.",
    code: `db.donors.find({}, { name: 1, bloodGroup: 1, donationCount: 1, _id: 0 })
  .sort({ donationCount: -1 })
  .limit(5)`,
    run: () =>
      donors()
        .find({}, { projection: { name: 1, bloodGroup: 1, donationCount: 1, _id: 0 } })
        .sort({ donationCount: -1 })
        .limit(5)
        .toArray(),
  },
  {
    id: "distinct",
    title: "Distinct cities and blood groups",
    feature: "distinct",
    explanation: "Returns the unique values of a single field, which the filter dropdowns use.",
    code: `db.donors.distinct("city")
db.donors.distinct("bloodGroup")`,
    run: async () => ({
      cities: await donors().distinct("city"),
      bloodGroups: await donors().distinct("bloodGroup"),
    }),
  },
  {
    id: "near",
    title: "$near - nearest available donors",
    feature: "$near, 2dsphere",
    explanation:
      "$near needs the 2dsphere index and returns documents already sorted by distance, nearest first. $maxDistance is in metres.",
    code: `db.donors.find({
  available: true,
  location: {
    $near: {
      $geometry: { type: "Point", coordinates: [76.6394, 12.2958] },
      $maxDistance: 10000
    }
  }
}).limit(5)`,
    run: () =>
      donors()
        .find(
          {
            available: true,
            location: { $near: { $geometry: { type: "Point", coordinates: MYSURU }, $maxDistance: 10000 } },
          },
          { projection: { name: 1, bloodGroup: 1, city: 1, _id: 0 } }
        )
        .limit(5)
        .toArray(),
  },
  {
    id: "geonear",
    title: "$geoNear - nearest eligible donors with distance",
    feature: "$geoNear, distanceField",
    explanation:
      "The aggregation version of $near. It is the only way to get the computed distance back, which is what the donor list shows in kilometres. $geoNear must be the first stage of the pipeline.",
    code: `db.donors.aggregate([
  {
    $geoNear: {
      near: { type: "Point", coordinates: [76.6394, 12.2958] },
      distanceField: "distanceMeters",
      maxDistance: 20000,
      spherical: true,
      query: {
        available: true,
        bloodGroup: { $in: ["O-", "O+"] },
        $or: [{ lastDonation: { $lt: cutoff } }, { lastDonation: null }]
      }
    }
  },
  { $limit: 5 },
  { $project: { name: 1, bloodGroup: 1, distanceKm: { $round: [{ $divide: ["$distanceMeters", 1000] }, 2] }, _id: 0 } }
])`,
    run: () =>
      donors()
        .aggregate([
          {
            $geoNear: {
              near: { type: "Point", coordinates: MYSURU },
              distanceField: "distanceMeters",
              maxDistance: 20000,
              spherical: true,
              query: {
                available: true,
                bloodGroup: { $in: ["O-", "O+"] },
                $or: [{ lastDonation: { $lt: eligibilityCutoff() } }, { lastDonation: null }],
              },
            },
          },
          { $limit: 5 },
          {
            $project: {
              _id: 0,
              name: 1,
              bloodGroup: 1,
              distanceKm: { $round: [{ $divide: ["$distanceMeters", 1000] }, 2] },
            },
          },
        ])
        .toArray(),
  },
  {
    id: "centersphere",
    title: "$geoWithin with $centerSphere - count inside a radius",
    feature: "$geoWithin, $centerSphere",
    explanation:
      "A circle on the sphere. The radius is given in radians, so kilometres are divided by the earth radius 6378.1 km. $geoWithin does not sort, which makes it cheaper than $near when only the count matters.",
    code: `db.donors.countDocuments({
  location: { $geoWithin: { $centerSphere: [[76.6394, 12.2958], 10 / 6378.1] } }
})`,
    run: async () => ({
      radiusKm: 10,
      donorsInside: await donors().countDocuments({
        location: { $geoWithin: { $centerSphere: [MYSURU, 10 / 6378.1] } },
      }),
    }),
  },
  {
    id: "geowithin-polygon",
    title: "$geoWithin with a stored city polygon",
    feature: "$geoWithin, Polygon",
    explanation:
      "The polygon is read from the cityZones collection and passed into the donors query, so the zone can be edited in the database without touching any code.",
    code: `const zone = db.cityZones.findOne({ name: "Mysuru" })
db.donors.find({
  location: { $geoWithin: { $geometry: zone.area } }
}).limit(5)`,
    run: async () => {
      const zone = await cityZones().findOne({ name: "Mysuru" });
      if (!zone) throw notFound("Run database/setup.js first, cityZones is empty.");
      return {
        zone: zone.name,
        donorsInside: await donors().countDocuments({
          location: { $geoWithin: { $geometry: zone.area } },
        }),
        sample: await donors()
          .find(
            { location: { $geoWithin: { $geometry: zone.area } } },
            { projection: { name: 1, bloodGroup: 1, city: 1, _id: 0 } }
          )
          .limit(5)
          .toArray(),
      };
    },
  },
  {
    id: "geointersects",
    title: "$geoIntersects - which zone holds a hospital",
    feature: "$geoIntersects",
    explanation:
      "$geoIntersects asks whether two shapes share at least one point. Here a single hospital point is tested against every city polygon.",
    code: `const hospital = db.hospitals.findOne({ name: "JSS Hospital" })
db.cityZones.find({
  area: { $geoIntersects: { $geometry: hospital.location } }
}, { name: 1, district: 1 })`,
    run: async () => {
      const hospital = await hospitals().findOne({ name: "JSS Hospital" });
      if (!hospital) throw notFound("Run database/setup.js first, hospitals is empty.");
      return {
        hospital: hospital.name,
        zones: await cityZones()
          .find({ area: { $geoIntersects: { $geometry: hospital.location } } })
          .project({ name: 1, district: 1, _id: 0 })
          .toArray(),
      };
    },
  },
  {
    id: "group",
    title: "$group - donors per blood group",
    feature: "aggregation, $group",
    explanation: "The bar chart on the dashboard is this query. $cond counts only the available donors inside the same pass.",
    code: `db.donors.aggregate([
  { $group: { _id: "$bloodGroup", total: { $sum: 1 }, available: { $sum: { $cond: ["$available", 1, 0] } } } },
  { $sort: { total: -1 } }
])`,
    run: () =>
      donors()
        .aggregate([
          {
            $group: {
              _id: "$bloodGroup",
              total: { $sum: 1 },
              available: { $sum: { $cond: ["$available", 1, 0] } },
            },
          },
          { $sort: { total: -1 } },
        ])
        .toArray(),
  },
  {
    id: "lookup",
    title: "$lookup - open requests joined with hospitals",
    feature: "$lookup, $unwind",
    explanation:
      "MongoDB has no foreign keys, so the join is written in the query. $lookup is a left outer join and $unwind turns the one element array it produces into an object.",
    code: `db.requests.aggregate([
  { $match: { status: "open" } },
  { $lookup: { from: "hospitals", localField: "hospitalId", foreignField: "_id", as: "hospital" } },
  { $unwind: "$hospital" },
  { $limit: 5 },
  { $project: { patientName: 1, bloodGroup: 1, urgency: 1, hospital: "$hospital.name", _id: 0 } }
])`,
    run: () =>
      requests()
        .aggregate([
          { $match: { status: "open" } },
          { $lookup: { from: "hospitals", localField: "hospitalId", foreignField: "_id", as: "hospital" } },
          { $unwind: "$hospital" },
          { $limit: 5 },
          { $project: { _id: 0, patientName: 1, bloodGroup: 1, urgency: 1, hospital: "$hospital.name" } },
        ])
        .toArray(),
  },
  {
    id: "bucket",
    title: "$bucket - donors by age group",
    feature: "$bucket",
    explanation:
      "Boundaries are inclusive at the lower end and exclusive at the upper end, so [18, 26] means ages 18 to 25.",
    code: `db.donors.aggregate([
  {
    $bucket: {
      groupBy: "$age",
      boundaries: [18, 26, 36, 46, 56, 66],
      default: "other",
      output: { donors: { $sum: 1 }, averageDonations: { $avg: "$donationCount" } }
    }
  }
])`,
    run: () =>
      donors()
        .aggregate([
          {
            $bucket: {
              groupBy: "$age",
              boundaries: [18, 26, 36, 46, 56, 66],
              default: "other",
              output: { donors: { $sum: 1 }, averageDonations: { $avg: "$donationCount" } },
            },
          },
        ])
        .toArray(),
  },
  {
    id: "explain",
    title: "explain(executionStats) on the $near query",
    feature: "explain, index usage",
    explanation:
      "Proof that the 2dsphere index is used: the winning plan contains GEO_NEAR_2DSPHERE, and the number of documents examined stays close to the number returned instead of 500.",
    code: `db.donors.find({
  available: true,
  location: { $near: { $geometry: { type: "Point", coordinates: [76.6394, 12.2958] }, $maxDistance: 10000 } }
}).explain("executionStats")`,
    run: async () => {
      const explained = (await donors()
        .find({
          available: true,
          location: { $near: { $geometry: { type: "Point", coordinates: MYSURU }, $maxDistance: 10000 } },
        })
        .explain("executionStats")) as {
        queryPlanner: { winningPlan: { inputStage?: { stage?: string }; stage?: string } };
        executionStats: {
          nReturned: number;
          totalDocsExamined: number;
          totalKeysExamined: number;
          executionTimeMillis: number;
        };
      };

      return {
        winningPlanStage:
          explained.queryPlanner.winningPlan.inputStage?.stage ?? explained.queryPlanner.winningPlan.stage,
        documentsReturned: explained.executionStats.nReturned,
        documentsExamined: explained.executionStats.totalDocsExamined,
        keysExamined: explained.executionStats.totalKeysExamined,
        executionTimeMillis: explained.executionStats.executionTimeMillis,
      };
    },
  },
];

/** GET /api/demo-queries - the list, without running anything. */
router.get(
  "/",
  asyncRoute(async (_request, response) => {
    response.json({
      count: demoQueries.length,
      queries: demoQueries.map(({ id, title, feature, explanation, code }) => ({
        id,
        title,
        feature,
        explanation,
        code,
      })),
    });
  })
);

/**
 * POST /api/demo-queries/:id/run - run one of the queries above.
 * Only these fixed queries can run. Nothing from the request body is ever
 * passed to MongoDB, so the page cannot be used to run arbitrary queries.
 */
router.post(
  "/:id/run",
  asyncRoute(async (request, response) => {
    const demo = demoQueries.find((query) => query.id === request.params.id);
    if (!demo) throw notFound("No demo query with that id.");

    const startedAt = Date.now();
    const result = await demo.run();

    response.json({
      id: demo.id,
      title: demo.title,
      code: demo.code,
      tookMs: Date.now() - startedAt,
      result,
    });
  })
);

export default router;
