import type { BloodGroup } from "./types.js";

/**
 * Which donor groups a patient of a given group can safely receive.
 *
 * Read it as: key = the patient, value = the groups we are allowed to search
 * for. O- is the universal donor, so it appears in every list. AB+ is the
 * universal recipient, so its list contains all eight groups.
 *
 * The query uses this with $in, which means one index lookup instead of eight
 * separate searches.
 */
export const COMPATIBLE_DONORS: Record<BloodGroup, BloodGroup[]> = {
  "O-": ["O-"],
  "O+": ["O-", "O+"],
  "A-": ["O-", "A-"],
  "A+": ["O-", "O+", "A-", "A+"],
  "B-": ["O-", "B-"],
  "B+": ["O-", "O+", "B-", "B+"],
  "AB-": ["O-", "A-", "B-", "AB-"],
  "AB+": ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"],
};

/** Donor groups to search for a patient, or just the exact group. */
export function donorGroupsFor(patientGroup: BloodGroup, compatible: boolean): BloodGroup[] {
  return compatible ? COMPATIBLE_DONORS[patientGroup] : [patientGroup];
}

/** A donor must wait 90 days between two donations. */
export const DONATION_GAP_DAYS = 90;

/**
 * The oldest lastDonation date that still counts as eligible. A donor whose
 * last donation is before this moment may donate again.
 */
export function eligibilityCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - DONATION_GAP_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Filter fragment for eligible donors, mixed into the geospatial queries.
 * A donor who has never donated has lastDonation null, which $lt would skip,
 * so the null case is spelled out with $or.
 */
export function eligibilityFilter(now: Date = new Date()) {
  return {
    available: true,
    $or: [{ lastDonation: { $lt: eligibilityCutoff(now) } }, { lastDonation: null }],
  };
}

/** Same rule applied to one donor document, for display purposes. */
export function isEligible(
  donor: { available: boolean; lastDonation: Date | null },
  now: Date = new Date()
): boolean {
  if (!donor.available) return false;
  if (!donor.lastDonation) return true;
  return new Date(donor.lastDonation).getTime() < eligibilityCutoff(now).getTime();
}

/** Days a donor still has to wait, 0 when they can donate now. */
export function daysUntilEligible(lastDonation: Date | null, now: Date = new Date()): number {
  if (!lastDonation) return 0;
  const elapsedDays = (now.getTime() - new Date(lastDonation).getTime()) / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil(DONATION_GAP_DAYS - elapsedDays));
}
