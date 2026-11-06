import { Router } from "express";
import type { Filter } from "mongodb";
import { hospitals, requests } from "../db.js";
import { asyncRoute, badRequest, notFound } from "../utils/http.js";
import {
  optionalString,
  requireBloodGroup,
  requireNumber,
  requireObjectId,
  requireString,
  requireUrgency,
} from "../utils/validate.js";
import type { BloodRequest, RequestStatus } from "../types.js";
import { REQUEST_STATUSES } from "../types.js";

const router = Router();

// How long a request stays in the database before the TTL index deletes it.
// Critical cases are short lived by nature, a normal request can wait longer.
const LIFETIME_HOURS: Record<string, number> = {
  critical: 12,
  urgent: 24,
  normal: 72,
};

/**
 * GET /api/requests?status=open&bloodGroup=&urgency=
 * Each request is joined to its hospital with $lookup, because the list has to
 * show the hospital name and city next to the patient.
 */
router.get(
  "/",
  asyncRoute(async (request, response) => {
    const match: Filter<BloodRequest> = {};

    if (request.query.status) {
      const status = requireString(request.query.status, "status", 4) as RequestStatus;
      if (!REQUEST_STATUSES.includes(status)) {
        throw badRequest(`status must be one of ${REQUEST_STATUSES.join(", ")}.`);
      }
      match.status = status;
    }
    if (request.query.bloodGroup) {
      match.bloodGroup = requireBloodGroup(request.query.bloodGroup);
    }
    if (request.query.urgency) {
      match.urgency = requireUrgency(request.query.urgency);
    }

    const found = await requests()
      .aggregate([
        { $match: match },
        {
          $lookup: {
            from: "hospitals",
            localField: "hospitalId",
            foreignField: "_id",
            as: "hospital",
          },
        },
        { $unwind: { path: "$hospital", preserveNullAndEmptyArrays: true } },
        // critical first, then urgent, then normal; newest first inside a level
        {
          $addFields: {
            urgencyRank: {
              $switch: {
                branches: [
                  { case: { $eq: ["$urgency", "critical"] }, then: 0 },
                  { case: { $eq: ["$urgency", "urgent"] }, then: 1 },
                ],
                default: 2,
              },
            },
          },
        },
        { $sort: { urgencyRank: 1, createdAt: -1 } },
        { $limit: 100 },
        {
          $project: {
            urgencyRank: 0,
            "hospital.address": 0,
          },
        },
      ])
      .toArray();

    response.json({ count: found.length, requests: found });
  })
);

/** GET /api/requests/:id */
router.get(
  "/:id",
  asyncRoute(async (request, response) => {
    const id = requireObjectId(request.params.id, "request id");
    const found = await requests().findOne({ _id: id });
    if (!found) throw notFound("No request with that id. It may have expired.");
    response.json({ request: found });
  })
);

/**
 * POST /api/requests
 * A hospital raises a blood request. expiresAt is set from the urgency, and the
 * TTL index on that field removes the document once the deadline passes.
 * Inserting here is also what triggers the change stream in watcher.ts, which
 * pushes the request to every open browser over Socket.IO.
 */
router.post(
  "/",
  asyncRoute(async (request, response) => {
    const body = request.body ?? {};

    const hospitalId = requireObjectId(body.hospitalId, "hospitalId");
    const hospital = await hospitals().findOne({ _id: hospitalId });
    if (!hospital) throw badRequest("hospitalId does not match any hospital.");

    const urgency = requireUrgency(body.urgency);
    const now = new Date();
    const lifetimeHours = LIFETIME_HOURS[urgency] ?? 72;

    const bloodRequest: Omit<BloodRequest, "_id"> = {
      hospitalId,
      patientName: requireString(body.patientName, "patientName", 2),
      bloodGroup: requireBloodGroup(body.bloodGroup),
      unitsNeeded: requireNumber(body.unitsNeeded, "unitsNeeded", 1, 20),
      urgency,
      status: "open",
      createdAt: now,
      expiresAt: new Date(now.getTime() + lifetimeHours * 60 * 60 * 1000),
      note: optionalString(body.note, "note"),
    };

    const result = await requests().insertOne(bloodRequest as BloodRequest);

    response.status(201).json({
      request: { ...bloodRequest, _id: result.insertedId },
      hospitalName: hospital.name,
      expiresInHours: lifetimeHours,
    });
  })
);

/** PATCH /api/requests/:id/cancel */
router.patch(
  "/:id/cancel",
  asyncRoute(async (request, response) => {
    const id = requireObjectId(request.params.id, "request id");

    // The filter includes status: open, so cancelling twice is not possible and
    // a fulfilled request cannot be reopened as cancelled.
    const updated = await requests().findOneAndUpdate(
      { _id: id, status: "open" },
      { $set: { status: "cancelled" } },
      { returnDocument: "after" }
    );

    if (!updated) {
      throw badRequest("That request is not open, so it cannot be cancelled.");
    }

    response.json({ request: updated });
  })
);

export default router;
