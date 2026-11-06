import bcrypt from "bcryptjs";
import { Router } from "express";
import { donors } from "../db.js";
import { signToken } from "../middleware/auth.js";
import { toPublicDonor } from "../utils/donor.js";
import { asyncRoute, conflict, unauthorized } from "../utils/http.js";
import {
  optionalString,
  requireAge,
  requireBloodGroup,
  requireGender,
  requireGeoPoint,
  requirePhone,
  requireString,
} from "../utils/validate.js";
import type { Donor } from "../types.js";

const router = Router();

const PASSWORD_ROUNDS = 10;

/**
 * POST /api/auth/register
 * Donor sign up. The location comes from the map on the register page, so the
 * body carries lng and lat separately and we build the GeoJSON point here.
 */
router.post(
  "/register",
  asyncRoute(async (request, response) => {
    const body = request.body ?? {};

    const donor: Omit<Donor, "_id"> = {
      name: requireString(body.name, "name", 2),
      phone: requirePhone(body.phone),
      email: optionalString(body.email, "email"),
      passwordHash: await bcrypt.hash(requireString(body.password, "password", 6), PASSWORD_ROUNDS),
      bloodGroup: requireBloodGroup(body.bloodGroup),
      age: requireAge(body.age),
      gender: requireGender(body.gender),
      city: requireString(body.city, "city", 2),
      location: requireGeoPoint(body.lng, body.lat),
      lastDonation: body.lastDonation ? new Date(body.lastDonation) : null,
      available: true,
      donationCount: 0,
      registeredOn: new Date(),
    };

    const existing = await donors().findOne({ phone: donor.phone });
    if (existing) {
      throw conflict("That mobile number is already registered. Try logging in instead.");
    }

    const result = await donors().insertOne(donor as Donor);
    const saved = { ...donor, _id: result.insertedId } as Donor;

    response.status(201).json({
      token: signToken({ donorId: saved._id.toString(), phone: saved.phone }),
      donor: toPublicDonor(saved),
    });
  })
);

/**
 * POST /api/auth/login
 * Login with mobile number and password. The same error is returned whether the
 * number or the password was wrong, so the endpoint cannot be used to find out
 * which numbers are registered.
 */
router.post(
  "/login",
  asyncRoute(async (request, response) => {
    const phone = requirePhone(request.body?.phone);
    const password = requireString(request.body?.password, "password", 1);

    const donor = await donors().findOne({ phone });
    if (!donor || !donor.passwordHash) {
      throw unauthorized("Mobile number or password is incorrect.");
    }

    const passwordMatches = await bcrypt.compare(password, donor.passwordHash);
    if (!passwordMatches) {
      throw unauthorized("Mobile number or password is incorrect.");
    }

    response.json({
      token: signToken({ donorId: donor._id.toString(), phone: donor.phone }),
      donor: toPublicDonor(donor),
    });
  })
);

export default router;
