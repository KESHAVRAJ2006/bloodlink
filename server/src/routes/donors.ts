import { Router } from "express";
import type { Filter } from "mongodb";
import { donorGroupsFor, eligibilityFilter } from "../compatibility.js";
import { cityZones, donations, donors } from "../db.js";
import { requireAuth, requireSelf } from "../middleware/auth.js";
import { toPublicDonor } from "../utils/donor.js";
import { asyncRoute, badRequest, notFound } from "../utils/http.js";
import {
  optionalString,
  requireAge,
  requireBloodGroup,
  requireBoolean,
  requireCoordinates,
  requireGeoPoint,
  requireNumber,
  requireObjectId,
  requireRadiusKm,
  requireString,
} from "../utils/validate.js";
import type { BloodGroup, Donor } from "../types.js";

const router = Router();

/**
 * Routes with a fixed path must be declared before /:id, otherwise Express
 * would read "nearby" as an id and the validator would reject it.
 */

/**
 * GET /api/donors/nearby?lng=&lat=&km=&bloodGroup=&compatible=true&limit=
 *
 * The heart of the project. One aggregation does all of it:
 *   $geoNear  - sorts by real distance on the sphere and reports the distance
 *   query     - eligibility and blood group compatibility, evaluated inside the
 *               geo stage so no extra pass over the data is needed
 *   $limit    - keeps the response small
 */
router.get(
  "/nearby",
  asyncRoute(async (request, response) => {
    const [lng, lat] = requireCoordinates(request.query.lng, request.query.lat);
    const radiusKm = requireRadiusKm(request.query.km, 10);
    const limit = requireNumber(request.query.limit ?? 50, "limit", 1, 200);
    const compatible =
      request.query.compatible === undefined
        ? true
        : requireBoolean(request.query.compatible, "compatible");

    const geoQuery: Filter<Donor> = { ...eligibilityFilter() };

    let searchedGroups: BloodGroup[] | null = null;
    if (request.query.bloodGroup) {
      const patientGroup = requireBloodGroup(request.query.bloodGroup);
      searchedGroups = donorGroupsFor(patientGroup, compatible);
      geoQuery.bloodGroup = { $in: searchedGroups };
    }

    const results = await donors()
      .aggregate<Donor & { distanceMeters: number }>([
        {
          $geoNear: {
            near: { type: "Point", coordinates: [lng, lat] },
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
      searchPoint: { lng, lat },
      radiusKm,
      bloodGroup: request.query.bloodGroup ?? null,
      compatibleGroups: searchedGroups,
      count: results.length,
      donors: results.map((donor) => toPublicDonor(donor)),
    });
  })
);

/**
 * GET /api/donors/in-city/:cityName?bloodGroup=&eligibleOnly=
 *
 * Uses the polygon stored in cityZones instead of matching the city string, so
 * a donor who typed a different city name is still found if they live inside
 * the zone. This is $geoWithin with a polygon read from the database.
 */
router.get(
  "/in-city/:cityName",
  asyncRoute(async (request, response) => {
    const cityName = requireString(request.params.cityName, "cityName", 2);

    // The zone name is matched case insensitively, so "mysuru" works as well as
    // "Mysuru". Regex characters in the input are escaped first, otherwise a
    // name like ".*" would match every zone.
    const escapedName = cityName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const zone = await cityZones().findOne({
      name: { $regex: `^${escapedName}$`, $options: "i" },
    });
    if (!zone) {
      throw notFound(`No city zone called ${cityName}. Known zones: Mysuru, Mandya, Bengaluru.`);
    }

    const filter: Filter<Donor> = {
      location: { $geoWithin: { $geometry: zone.area } },
    };

    if (request.query.bloodGroup) {
      filter.bloodGroup = requireBloodGroup(request.query.bloodGroup);
    }
    if (request.query.eligibleOnly === "true") {
      Object.assign(filter, eligibilityFilter());
    }

    const found = await donors()
      .find(filter, { projection: { passwordHash: 0 } })
      .sort({ donationCount: -1 })
      .limit(200)
      .toArray();

    response.json({
      zone: { name: zone.name, district: zone.district ?? null, area: zone.area },
      count: found.length,
      donors: found.map((donor) => toPublicDonor(donor)),
    });
  })
);

/**
 * GET /api/donors?city=&bloodGroup=&available=&limit=
 * Plain list with optional filters, used by the Queries demo page.
 */
router.get(
  "/",
  asyncRoute(async (request, response) => {
    const filter: Filter<Donor> = {};
    if (request.query.city) filter.city = requireString(request.query.city, "city", 2);
    if (request.query.bloodGroup) filter.bloodGroup = requireBloodGroup(request.query.bloodGroup);
    if (request.query.available !== undefined) {
      filter.available = requireBoolean(request.query.available, "available");
    }
    const limit = requireNumber(request.query.limit ?? 25, "limit", 1, 200);

    const found = await donors()
      .find(filter, { projection: { passwordHash: 0 } })
      .sort({ registeredOn: -1 })
      .limit(limit)
      .toArray();

    response.json({ count: found.length, donors: found.map((donor) => toPublicDonor(donor)) });
  })
);

/** GET /api/donors/:id - one donor, without the password hash. */
router.get(
  "/:id",
  asyncRoute(async (request, response) => {
    const id = requireObjectId(request.params.id, "donor id");
    const donor = await donors().findOne({ _id: id }, { projection: { passwordHash: 0 } });
    if (!donor) throw notFound("No donor with that id.");
    response.json({ donor: toPublicDonor(donor) });
  })
);

/**
 * GET /api/donors/:id/contact
 * The only route that returns a full phone number, and only one at a time.
 * The UI calls it when the user presses Contact.
 */
router.get(
  "/:id/contact",
  asyncRoute(async (request, response) => {
    const id = requireObjectId(request.params.id, "donor id");
    const donor = await donors().findOne(
      { _id: id },
      { projection: { name: 1, phone: 1, available: 1 } }
    );
    if (!donor) throw notFound("No donor with that id.");
    response.json({ name: donor.name, phone: donor.phone });
  })
);

/**
 * GET /api/donors/:id/donations
 * Donation history joined with the hospital where each donation happened.
 */
router.get(
  "/:id/donations",
  asyncRoute(async (request, response) => {
    const id = requireObjectId(request.params.id, "donor id");

    const history = await donations()
      .aggregate([
        { $match: { donorId: id } },
        {
          $lookup: {
            from: "hospitals",
            localField: "hospitalId",
            foreignField: "_id",
            as: "hospital",
          },
        },
        { $unwind: { path: "$hospital", preserveNullAndEmptyArrays: true } },
        { $sort: { date: -1 } },
        {
          $project: {
            date: 1,
            units: 1,
            requestId: 1,
            hospitalName: "$hospital.name",
            hospitalCity: "$hospital.city",
          },
        },
      ])
      .toArray();

    response.json({ count: history.length, donations: history });
  })
);

/** PUT /api/donors/:id - update own profile. */
router.put(
  "/:id",
  requireAuth,
  asyncRoute(async (request, response) => {
    const id = requireObjectId(request.params.id, "donor id");
    requireSelf(request, id.toString());

    const body = request.body ?? {};
    const updates: Partial<Donor> = {};

    if (body.name !== undefined) updates.name = requireString(body.name, "name", 2);
    if (body.email !== undefined) updates.email = optionalString(body.email, "email");
    if (body.age !== undefined) updates.age = requireAge(body.age);
    if (body.city !== undefined) updates.city = requireString(body.city, "city", 2);
    if (body.bloodGroup !== undefined) updates.bloodGroup = requireBloodGroup(body.bloodGroup);
    if (body.available !== undefined) updates.available = requireBoolean(body.available, "available");
    if (body.lng !== undefined || body.lat !== undefined) {
      updates.location = requireGeoPoint(body.lng, body.lat);
    }

    // MongoDB rejects an empty $set, so say so with a clearer message.
    if (Object.keys(updates).length === 0) {
      throw badRequest("Send at least one field to update.");
    }

    const updated = await donors().findOneAndUpdate(
      { _id: id },
      { $set: updates },
      { returnDocument: "after", projection: { passwordHash: 0 } }
    );
    if (!updated) throw notFound("No donor with that id.");

    response.json({ donor: toPublicDonor(updated), updatedFields: Object.keys(updates) });
  })
);

/**
 * PATCH /api/donors/:id/availability
 * The toggle on the profile page. Separate from PUT because it is the one
 * change a donor makes often, and the UI should not have to send the rest.
 */
router.patch(
  "/:id/availability",
  requireAuth,
  asyncRoute(async (request, response) => {
    const id = requireObjectId(request.params.id, "donor id");
    requireSelf(request, id.toString());
    const available = requireBoolean(request.body?.available, "available");

    const updated = await donors().findOneAndUpdate(
      { _id: id },
      { $set: { available } },
      { returnDocument: "after", projection: { passwordHash: 0 } }
    );
    if (!updated) throw notFound("No donor with that id.");

    response.json({ donor: toPublicDonor(updated) });
  })
);

/** DELETE /api/donors/:id - a donor removing their own registration. */
router.delete(
  "/:id",
  requireAuth,
  asyncRoute(async (request, response) => {
    const id = requireObjectId(request.params.id, "donor id");
    requireSelf(request, id.toString());

    const result = await donors().deleteOne({ _id: id });
    if (result.deletedCount === 0) throw notFound("No donor with that id.");

    // The donation records stay, they are history and no longer point at a
    // donor who can be identified from the UI.
    response.json({ deleted: true, id: id.toString() });
  })
);

export default router;
