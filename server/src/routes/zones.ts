import { Router } from "express";
import { cityZones } from "../db.js";
import { asyncRoute } from "../utils/http.js";
import { requireCoordinates } from "../utils/validate.js";

const router = Router();

/** GET /api/zones - the city polygons, drawn as outlines on the maps. */
router.get(
  "/",
  asyncRoute(async (_request, response) => {
    const zones = await cityZones().find().sort({ name: 1 }).toArray();
    response.json({ count: zones.length, zones });
  })
);

/**
 * GET /api/zones/for-point?lng=&lat=
 * Which zone contains this point? $geoIntersects compares the stored polygons
 * against the point and returns the ones that share any area with it.
 */
router.get(
  "/for-point",
  asyncRoute(async (request, response) => {
    const [lng, lat] = requireCoordinates(request.query.lng, request.query.lat);

    const matching = await cityZones()
      .find({
        area: { $geoIntersects: { $geometry: { type: "Point", coordinates: [lng, lat] } } },
      })
      .project({ name: 1, district: 1 })
      .toArray();

    response.json({ point: { lng, lat }, zones: matching });
  })
);

export default router;
