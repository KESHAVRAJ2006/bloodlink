import { isEligible } from "../compatibility.js";
import type { Donor, PublicDonor } from "../types.js";

/**
 * Donor privacy: lists and maps only ever show a masked number such as
 * 98xxxxxx12. The full number is served by a separate endpoint that a hospital
 * has to ask for explicitly, so a scraper cannot collect 500 phone numbers in
 * one request.
 */
export function maskPhone(phone: string): string {
  if (phone.length < 10) return "xxxxxxxxxx";
  return `${phone.slice(0, 2)}xxxxxx${phone.slice(-2)}`;
}

/** Strip the password hash and the raw phone number before sending a donor out. */
export function toPublicDonor(
  donor: Donor & { distanceMeters?: number },
  now: Date = new Date()
): PublicDonor {
  const publicDonor: PublicDonor = {
    _id: donor._id.toString(),
    name: donor.name,
    bloodGroup: donor.bloodGroup,
    age: donor.age,
    gender: donor.gender,
    city: donor.city,
    available: donor.available,
    donationCount: donor.donationCount,
    eligible: isEligible(donor, now),
    lastDonation: donor.lastDonation ?? null,
    phoneMasked: maskPhone(donor.phone),
    location: donor.location,
  };

  if (typeof donor.distanceMeters === "number") {
    publicDonor.distanceKm = Math.round((donor.distanceMeters / 1000) * 100) / 100;
  }

  return publicDonor;
}
