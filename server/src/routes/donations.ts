import { Router } from "express";
import { ObjectId } from "mongodb";
import { isEligible, daysUntilEligible, COMPATIBLE_DONORS } from "../compatibility.js";
import { client, donations, donors, hospitals, requests } from "../db.js";
import { asyncRoute, badRequest, notFound } from "../utils/http.js";
import { requireNumber, requireObjectId } from "../utils/validate.js";
import type { Donation } from "../types.js";

const router = Router();

/**
 * POST /api/donations
 * Recording a donation changes three collections at once:
 *   1. a new document in donations
 *   2. the donor gets a fresh lastDonation and donationCount + 1
 *   3. the request, if there was one, becomes fulfilled
 *
 * Those three writes have to happen together. If the server crashed between
 * step 1 and step 2 the donor would look eligible again straight away, which in
 * a blood bank is a real safety problem. So the whole thing runs inside a
 * multi-document transaction: either all three writes land, or none of them do.
 *
 * Transactions need a replica set, which is exactly what an Atlas cluster is.
 */
router.post(
  "/",
  asyncRoute(async (request, response) => {
    const body = request.body ?? {};
    const donorId = requireObjectId(body.donorId, "donorId");
    const hospitalId = requireObjectId(body.hospitalId, "hospitalId");
    const units = requireNumber(body.units ?? 1, "units", 1, 4);
    const requestId = body.requestId ? requireObjectId(body.requestId, "requestId") : null;
    const date = body.date ? new Date(body.date) : new Date();

    if (Number.isNaN(date.getTime())) {
      throw badRequest("date is not a valid date.");
    }

    const session = client.startSession();
    let donationId: ObjectId | null = null;
    let fulfilledRequest = false;

    try {
      await session.withTransaction(async () => {
        // Every read inside the transaction must pass the session as well,
        // otherwise it would not see the transaction snapshot.
        const donor = await donors().findOne({ _id: donorId }, { session });
        if (!donor) throw notFound("No donor with that id.");

        const hospital = await hospitals().findOne({ _id: hospitalId }, { session });
        if (!hospital) throw badRequest("hospitalId does not match any hospital.");

        if (!isEligible(donor, date)) {
          const wait = daysUntilEligible(donor.lastDonation, date);
          throw badRequest(
            donor.available
              ? `${donor.name} donated recently and can donate again in ${wait} day(s).`
              : `${donor.name} is marked as not available.`
          );
        }

        if (requestId) {
          const bloodRequest = await requests().findOne({ _id: requestId }, { session });
          if (!bloodRequest) throw notFound("No request with that id. It may have expired.");
          if (bloodRequest.status !== "open") {
            throw badRequest("That request is already closed.");
          }

          const allowed = COMPATIBLE_DONORS[bloodRequest.bloodGroup];
          if (!allowed.includes(donor.bloodGroup)) {
            throw badRequest(
              `${donor.bloodGroup} blood cannot be given to a ${bloodRequest.bloodGroup} patient.`
            );
          }

          await requests().updateOne(
            { _id: requestId },
            { $set: { status: "fulfilled", fulfilledAt: date } },
            { session }
          );
          fulfilledRequest = true;
        }

        const donation: Omit<Donation, "_id"> = {
          donorId,
          hospitalId,
          requestId,
          date,
          units,
        };
        const inserted = await donations().insertOne(donation as Donation, { session });
        donationId = inserted.insertedId;

        // $set stamps the new date, $inc adds one to the counter. Doing both in
        // one update means the donor document is never half updated.
        await donors().updateOne(
          { _id: donorId },
          { $set: { lastDonation: date }, $inc: { donationCount: 1 } },
          { session }
        );
      });
    } finally {
      await session.endSession();
    }

    const updatedDonor = await donors().findOne(
      { _id: donorId },
      { projection: { name: 1, bloodGroup: 1, donationCount: 1, lastDonation: 1, available: 1 } }
    );

    response.status(201).json({
      donationId: donationId ? String(donationId) : null,
      requestFulfilled: fulfilledRequest,
      donor: updatedDonor,
      message: "Donation recorded. Donor, request and history were updated together.",
    });
  })
);

/** GET /api/donations?hospitalId=&limit= - recent donations, newest first. */
router.get(
  "/",
  asyncRoute(async (request, response) => {
    const limit = requireNumber(request.query.limit ?? 20, "limit", 1, 100);
    const match: Record<string, unknown> = {};
    if (request.query.hospitalId) {
      match.hospitalId = requireObjectId(request.query.hospitalId, "hospitalId");
    }

    const recent = await donations()
      .aggregate([
        { $match: match },
        { $sort: { date: -1 } },
        { $limit: limit },
        { $lookup: { from: "donors", localField: "donorId", foreignField: "_id", as: "donor" } },
        { $lookup: { from: "hospitals", localField: "hospitalId", foreignField: "_id", as: "hospital" } },
        { $unwind: { path: "$donor", preserveNullAndEmptyArrays: true } },
        { $unwind: { path: "$hospital", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            date: 1,
            units: 1,
            donorName: "$donor.name",
            bloodGroup: "$donor.bloodGroup",
            hospitalName: "$hospital.name",
            city: "$hospital.city",
          },
        },
      ])
      .toArray();

    response.json({ count: recent.length, donations: recent });
  })
);

export default router;
