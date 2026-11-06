export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export type Urgency = "normal" | "urgent" | "critical";
export type RequestStatus = "open" | "fulfilled" | "cancelled";

export interface GeoPoint {
  type: "Point";
  coordinates: [number, number];
}

export interface GeoPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface Donor {
  _id: string;
  name: string;
  bloodGroup: BloodGroup;
  age: number;
  gender: "male" | "female" | "other";
  city: string;
  available: boolean;
  donationCount: number;
  eligible: boolean;
  lastDonation: string | null;
  phoneMasked: string;
  location: GeoPoint;
  distanceKm?: number;
}

export interface Hospital {
  _id: string;
  name: string;
  address?: string;
  city: string;
  phone?: string;
  location: GeoPoint;
}

export interface BloodRequest {
  _id: string;
  hospitalId: string;
  patientName: string;
  bloodGroup: BloodGroup;
  unitsNeeded: number;
  urgency: Urgency;
  status: RequestStatus;
  createdAt: string;
  expiresAt: string;
  note?: string;
  hospital?: { _id: string; name: string; city: string; location: GeoPoint } | null;
}

export interface DonationRecord {
  _id: string;
  date: string;
  units: number;
  hospitalName?: string;
  hospitalCity?: string;
}

export interface CityZone {
  _id: string;
  name: string;
  district?: string;
  area: GeoPolygon;
}

export interface Stats {
  totals: {
    donors: number;
    availableDonors: number;
    eligibleDonors: number;
    recordedDonations: number;
    hospitals: number;
    openRequests: number;
  };
  donorsPerBloodGroup: { bloodGroup: BloodGroup; count: number }[];
  donorsPerCity: { city: string; count: number; available: number }[];
  donorsPerAgeGroup: { group: string; count: number }[];
  requestsByUrgency: { urgency: Urgency; count: number; units: number }[];
  requestsByStatus: { status: RequestStatus; count: number }[];
  openUnitsByBloodGroup: { bloodGroup: BloodGroup; units: number }[];
}

export interface NearbyResponse {
  searchPoint: { lng: number; lat: number };
  radiusKm: number;
  bloodGroup: BloodGroup | null;
  compatibleGroups: BloodGroup[] | null;
  count: number;
  donors: Donor[];
}

export interface DemoQuery {
  id: string;
  title: string;
  feature: string;
  explanation: string;
  code: string;
}

export interface DemoQueryResult {
  id: string;
  title: string;
  code: string;
  tookMs: number;
  result: unknown;
}
