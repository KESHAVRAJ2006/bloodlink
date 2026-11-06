import { ObjectId } from "mongodb";
import { badRequest } from "./http.js";
import {
  BLOOD_GROUPS,
  GENDERS,
  URGENCY_LEVELS,
  type BloodGroup,
  type Gender,
  type GeoPoint,
  type Urgency,
} from "../types.js";

/**
 * Small validators that either return a clean value or throw a 400 with a
 * message a human can act on. Doing the checks here keeps the routes short and
 * makes sure nothing reaches MongoDB in a shape the schema validator rejects.
 */

export function requireString(value: unknown, field: string, minLength = 1): string {
  if (typeof value !== "string" || value.trim().length < minLength) {
    throw badRequest(`${field} is required and must be at least ${minLength} characters.`);
  }
  return value.trim();
}

export function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requireString(value, field);
}

export function requireBloodGroup(value: unknown, field = "bloodGroup"): BloodGroup {
  if (typeof value !== "string" || !BLOOD_GROUPS.includes(value as BloodGroup)) {
    throw badRequest(`${field} must be one of ${BLOOD_GROUPS.join(", ")}.`);
  }
  return value as BloodGroup;
}

export function requireGender(value: unknown): Gender {
  if (typeof value !== "string" || !GENDERS.includes(value as Gender)) {
    throw badRequest(`gender must be one of ${GENDERS.join(", ")}.`);
  }
  return value as Gender;
}

export function requireUrgency(value: unknown): Urgency {
  if (typeof value !== "string" || !URGENCY_LEVELS.includes(value as Urgency)) {
    throw badRequest(`urgency must be one of ${URGENCY_LEVELS.join(", ")}.`);
  }
  return value as Urgency;
}

export function requirePhone(value: unknown): string {
  const phone = String(value ?? "").replace(/\s|-/g, "");
  if (!/^[6-9][0-9]{9}$/.test(phone)) {
    throw badRequest("phone must be a 10 digit Indian mobile number.");
  }
  return phone;
}

export function requireAge(value: unknown): number {
  const age = Number(value);
  if (!Number.isInteger(age) || age < 18 || age > 65) {
    throw badRequest("age must be a whole number between 18 and 65.");
  }
  return age;
}

export function requireNumber(
  value: unknown,
  field: string,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw badRequest(`${field} must be a number between ${min} and ${max}.`);
  }
  return parsed;
}

export function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw badRequest(`${field} must be true or false.`);
}

/**
 * Longitude is -180..180 and latitude is -90..90. Mixing them up is the single
 * most common GeoJSON mistake, and these ranges catch most of those cases.
 */
export function requireCoordinates(longitude: unknown, latitude: unknown): [number, number] {
  const lng = Number(longitude);
  const lat = Number(latitude);
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw badRequest("lng must be a number between -180 and 180.");
  }
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw badRequest("lat must be a number between -90 and 90. Check you did not swap lng and lat.");
  }
  return [lng, lat];
}

export function requireGeoPoint(longitude: unknown, latitude: unknown): GeoPoint {
  return { type: "Point", coordinates: requireCoordinates(longitude, latitude) };
}

export function requireObjectId(value: unknown, field = "id"): ObjectId {
  if (typeof value !== "string" || !ObjectId.isValid(value)) {
    throw badRequest(`${field} must be a valid MongoDB id (24 hex characters).`);
  }
  return new ObjectId(value);
}

/** Search radius in kilometres, with a sensible default and an upper bound. */
export function requireRadiusKm(value: unknown, fallback = 10): number {
  if (value === undefined || value === "") return fallback;
  return requireNumber(value, "km", 0.5, 500);
}
