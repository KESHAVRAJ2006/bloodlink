import { useState } from "react";
import { api } from "../lib/api";
import { formatDate, formatDistance } from "../lib/format";
import type { Donor } from "../lib/types";
import { BloodGroupTag, EligibilityTag } from "./Badges";

/**
 * The donor list beside the map. Phone numbers arrive masked from the API; the
 * full number is fetched one donor at a time when Contact is pressed, so the
 * list itself never contains 50 real phone numbers.
 */
export function DonorList({ donors, emptyMessage }: { donors: Donor[]; emptyMessage: string }) {
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reveal(donor: Donor) {
    setLoadingId(donor._id);
    setError(null);
    try {
      const contact = await api.donorContact(donor._id);
      setRevealed((current) => ({ ...current, [donor._id]: contact.phone }));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not load the number.");
    } finally {
      setLoadingId(null);
    }
  }

  if (donors.length === 0) {
    return <p className="muted py-6 text-center">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-2">
      {error ? <p className="text-sm text-blood-700">{error}</p> : null}

      {donors.map((donor) => (
        <article
          key={donor._id}
          className="flex items-center gap-3 rounded-lg border border-ink-500/15 p-3"
        >
          <BloodGroupTag group={donor.bloodGroup} size="sm" />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold">{donor.name}</p>
              <EligibilityTag eligible={donor.eligible} />
            </div>
            <p className="text-xs text-ink-500">
              {donor.city} - age {donor.age} - {donor.donationCount} donation
              {donor.donationCount === 1 ? "" : "s"} - last {formatDate(donor.lastDonation)}
            </p>
          </div>

          <div className="shrink-0 text-right">
            {donor.distanceKm !== undefined ? (
              <p className="text-sm font-semibold text-blood-700">
                {formatDistance(donor.distanceKm)}
              </p>
            ) : null}

            {revealed[donor._id] ? (
              <a href={`tel:${revealed[donor._id]}`} className="text-xs font-medium text-ink-900">
                {revealed[donor._id]}
              </a>
            ) : (
              <button
                type="button"
                className="text-xs font-medium text-blood-700 hover:underline disabled:opacity-50"
                onClick={() => reveal(donor)}
                disabled={loadingId === donor._id}
              >
                {loadingId === donor._id ? "loading" : `Contact ${donor.phoneMasked}`}
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
