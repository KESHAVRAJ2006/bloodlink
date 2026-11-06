import { Router } from "express";
import type { Filter } from "mongodb";
import { donorGroupsFor, eligibilityFilter } from "../compatibility.js";
import { donors, hospitals } from "../db.js";
import { toPublicDonor } from "../utils/donor.js";
import { asyncRoute, badRequest, conflict, notFound } from "../utils/http.js";
import {
  optionalString,
  requireBloodGroup,
  requireBoolean,
  requireGeoPoint,
  requireNumber,
  requireObjectId,
  requireRadiusKm,
  requireString,
} from "../utils/validate.js";
import type { BloodGroup, Donor, Hospital } from "../types.js";

const router = Router();

/** GET /api/hospitals?city= - every hospital, optionally filtered by city. */
router.get(
  "/",
  asyncRoute(async (request, response) => {
    const filter: Filter<Hospital> = {};
    if (request.query.city) filter.city = requireString(request.query.city, "city", 2);

    const found = await hospitals().find(filter).sort({ city: 1, name: 1 }).toArray();
    response.json({ count: found.length, hospitals: found });
  })
);

/** GET /api/hospitals/:id */
router.get(
  "/:id",
  asyncRoute(async (request, response) => {
    const id = requireObjectId(request.params.id, "hospital id");
    const hospital = await hospitals().findOne({ _id: id });
    if (!hospital) throw notFound("No hospital with that id.");
    response.json({ hospital });
  })
);

/**
 * GET /api/hospitals/:id/nearby-donors?bloodGroup=&km=&compatible=
 * The hospital page uses this: pick a hospital, see who can donate near it.
 * Same $geoNear idea as /api/donors/nearby, but the search point is the
 * hospital location that is already stored in the database.
 */
router.get(
  "/:id/nearby-donors",
  asyncRoute(async (request, response) => {
    const id = requireObjectId(request.params.id, "hospital id");
    const hospital = await hospitals().findOne({ _id: id });
    if (!hospital) throw notFound("No hospital with that id.");

    const radiusKm = requireRadiusKm(request.query.km, 15);
    const limit = requireNumber(request.query.limit ?? 50, "limit", 1, 200);
    const compatible =
      request.query.compatible === undefined
        ? true
        : requireBoolean(request.query.compatible, "compatible");

    const geoQuery: Filter<Donor> = { ...eligibilityFilter() };
    let compatibleGroups: BloodGroup[] | null = null;
    if (request.query.bloodGroup) {
      const patientGroup = requireBloodGroup(request.query.bloodGroup);
      compatibleGroups = donorGroupsFor(patientGroup, compatible);
      geoQuery.bloodGroup = { $in: compatibleGroups };
    }

    const found = await donors()
      .aggregate<Donor & { distanceMeters: number }>([
        {
          $geoNear: {
            near: hospital.location,
            distanceField: "distanceMeters",
            maxDistance: radiusKm * 1000,
            spherical: true,
            query: geoQuery,
          },
        },
        { $limit: limit },
        { $project: { passwordHash: 0 } },
      ])
      .toArray();

    response.json({
      hospital: { _id: hospital._id, name: hospital.name, city: hospital.city, location: hospital.location },
      radiusKm,
      compatibleGroups,
      count: found.length,
      donors: found.map((donor) => toPublicDonor(donor)),
    });
  })
);

/** POST /api/hospitals */
router.post(
  "/",
  asyncRoute(async (request, response) => {
    const body = request.body ?? {};
    const hospital: Omit<Hospital, "_id"> = {
      name: requireString(body.name, "name", 3),
      address: optionalString(body.address, "address"),
      city: requireString(body.city, "city", 2),
      phone: optionalString(body.phone, "phone"),
      location: requireGeoPoint(body.lng, body.lat),
    };

    const existing = await hospitals().findOne({ name: hospital.name });
    if (existing) throw conflict("A hospital with that name already exists.");

    const result = await hospitals().insertOne(hospital as Hospital);
    response.status(201).json({ hospital: { ...hospital, _id: result.insertedId } });
  })
);

/** PUT /api/hospitals/:id */
router.put(
  "/:id",
  asyncRoute(async (request, response) => {
    const id = requireObjectId(request.params.id, "hospital id");
    const body = request.body ?? {};
    const updates: Partial<Hospital> = {};

    if (body.name !== undefined) updates.name = requireString(body.name, "name", 3);
    if (body.address !== undefined) updates.address = optionalString(body.address, "address");
    if (body.city !== undefined) updates.city = requireString(body.city, "city", 2);
    if (body.phone !== undefined) updates.phone = optionalString(body.phone, "phone");
    if (body.lng !== undefined || body.lat !== undefined) {
      updates.location = requireGeoPoint(body.lng, body.lat);
    }
    if (Object.keys(updates).length === 0) {
      throw badRequest("Send at least one field to update.");
    }

    const updated = await hospitals().findOneAndUpdate(
      { _id: id },
      { $set: updates },
      { returnDocument: "after" }
    );
    if (!updated) throw notFound("No hospital with that id.");

    response.json({ hospital: updated });
  })
);

/** DELETE /api/hospitals/:id */
router.delete(
  "/:id",
  asyncRoute(async (request, response) => {
    const id = requireObjectId(request.params.id, "hospital id");
    const result = await hospitals().deleteOne({ _id: id });
    if (result.deletedCount === 0) throw notFound("No hospital with that id.");
    response.json({ deleted: true, id: id.toString() });
  })
);

export default router;
