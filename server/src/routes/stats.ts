import { Router } from "express";
import { eligibilityCutoff } from "../compatibility.js";
import { donors, hospitals, requests } from "../db.js";
import { asyncRoute } from "../utils/http.js";

const router = Router();

/**
 * GET /api/stats
 * Everything the dashboard needs. $facet runs several pipelines over the same
 * donors collection in one round trip, which is much better than firing five
 * separate queries from the browser.
 */
router.get(
  "/",
  asyncRoute(async (_request, response) => {
    const cutoff = eligibilityCutoff();

    const [donorFacets] = await donors()
      .aggregate([
        {
          $facet: {
            perBloodGroup: [
              { $group: { _id: "$bloodGroup", count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $project: { _id: 0, bloodGroup: "$_id", count: 1 } },
            ],
            perCity: [
              {
                $group: {
                  _id: "$city",
                  count: { $sum: 1 },
                  available: { $sum: { $cond: ["$available", 1, 0] } },
                },
              },
              { $sort: { count: -1 } },
              { $project: { _id: 0, city: "$_id", count: 1, available: 1 } },
            ],
            ageBuckets: [
              {
                $bucket: {
                  groupBy: "$age",
                  boundaries: [18, 26, 36, 46, 56, 66],
                  default: "other",
                  output: { count: { $sum: 1 } },
                },
              },
            ],
            eligible: [
              {
                $match: {
                  available: true,
                  $or: [{ lastDonation: { $lt: cutoff } }, { lastDonation: null }],
                },
              },
              { $count: "count" },
            ],
            totals: [
              {
                $group: {
                  _id: null,
                  donors: { $sum: 1 },
                  available: { $sum: { $cond: ["$available", 1, 0] } },
                  donations: { $sum: "$donationCount" },
                },
              },
            ],
          },
        },
      ])
      .toArray();

    const requestFacets = await requests()
      .aggregate([
        {
          $facet: {
            byUrgency: [
              { $match: { status: "open" } },
              {
                $group: {
                  _id: "$urgency",
                  count: { $sum: 1 },
                  units: { $sum: "$unitsNeeded" },
                },
              },
              { $project: { _id: 0, urgency: "$_id", count: 1, units: 1 } },
            ],
            byStatus: [
              { $group: { _id: "$status", count: { $sum: 1 } } },
              { $project: { _id: 0, status: "$_id", count: 1 } },
            ],
            byBloodGroup: [
              { $match: { status: "open" } },
              { $group: { _id: "$bloodGroup", units: { $sum: "$unitsNeeded" } } },
              { $sort: { units: -1 } },
              { $project: { _id: 0, bloodGroup: "$_id", units: 1 } },
            ],
          },
        },
      ])
      .toArray();

    const totals = donorFacets?.totals?.[0] ?? { donors: 0, available: 0, donations: 0 };
    const eligibleCount = donorFacets?.eligible?.[0]?.count ?? 0;

    // $bucket labels each bucket with its lower boundary, so turn 18 into "18-25".
    const ageBucketLabels: Record<string, string> = {
      "18": "18-25",
      "26": "26-35",
      "36": "36-45",
      "46": "46-55",
      "56": "56-65",
    };

    response.json({
      totals: {
        donors: totals.donors,
        availableDonors: totals.available,
        eligibleDonors: eligibleCount,
        recordedDonations: totals.donations,
        hospitals: await hospitals().countDocuments(),
        openRequests: await requests().countDocuments({ status: "open" }),
      },
      donorsPerBloodGroup: donorFacets?.perBloodGroup ?? [],
      donorsPerCity: donorFacets?.perCity ?? [],
      donorsPerAgeGroup: (donorFacets?.ageBuckets ?? []).map(
        (bucket: { _id: number | string; count: number }) => ({
          group: ageBucketLabels[String(bucket._id)] ?? String(bucket._id),
          count: bucket.count,
        })
      ),
      requestsByUrgency: requestFacets[0]?.byUrgency ?? [],
      requestsByStatus: requestFacets[0]?.byStatus ?? [],
      openUnitsByBloodGroup: requestFacets[0]?.byBloodGroup ?? [],
    });
  })
);

export default router;
