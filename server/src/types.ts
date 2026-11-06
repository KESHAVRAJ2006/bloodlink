import type { ObjectId } from "mongodb";

/** The eight blood groups, used as a type and as a runtime list. */
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export const URGENCY_LEVELS = ["normal", "urgent", "critical"] as const;
export type Urgency = (typeof URGENCY_LEVELS)[number];

export const REQUEST_STATUSES = ["open", "fulfilled", "cancelled"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const GENDERS = ["male", "female", "other"] as const;
export type Gender = (typeof GENDERS)[number];

/**
 * GeoJSON point. MongoDB always expects [longitude, latitude] in that order,
 * which is the opposite of how maps and phones usually print coordinates.
 */
export interface GeoPoint {
  type: "Point";
  coordinates: [number, number];
}

export interface GeoPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface Donor {
  _id: ObjectId;
  name: string;
  phone: string;
  email?: string;
  passwordHash?: string;
  bloodGroup: BloodGroup;
  age: number;
  gender: Gender;
  city: string;
  location: GeoPoint;
  lastDonation: Date | null;
  available: boolean;
  donationCount: number;
  registeredOn: Date;
}

export interface Hospital {
  _id: ObjectId;
  name: string;
  address?: string;
  city: string;
  phone?: string;
  location: GeoPoint;
}

export interface BloodRequest {
  _id: ObjectId;
  hospitalId: ObjectId;
  patientName: string;
  bloodGroup: BloodGroup;
  unitsNeeded: number;
  urgency: Urgency;
  status: RequestStatus;
  createdAt: Date;
  expiresAt: Date;
  fulfilledAt?: Date | null;
  note?: string;
}

export interface Donation {
  _id: ObjectId;
  donorId: ObjectId;
  hospitalId: ObjectId;
  requestId: ObjectId | null;
  date: Date;
  units: number;
}

export interface CityZone {
  _id: ObjectId;
  name: string;
  district?: string;
  area: GeoPolygon;
}

/** What the API sends back for a donor. Never includes passwordHash. */
export interface PublicDonor {
  _id: string;
  name: string;
  bloodGroup: BloodGroup;
  age: number;
  gender: Gender;
  city: string;
  available: boolean;
  donationCount: number;
  eligible: boolean;
  lastDonation: Date | null;
  phoneMasked: string;
  location: GeoPoint;
  distanceKm?: number;
}
