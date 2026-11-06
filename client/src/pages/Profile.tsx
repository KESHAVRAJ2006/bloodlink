import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BloodGroupTag, EligibilityTag } from "../components/Badges";
import { MapView, SearchPointMarker } from "../components/MapView";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDate, toLatLng } from "../lib/format";
import type { DonationRecord } from "../lib/types";

export function Profile() {
  const { donor, loading, setDonor } = useAuth();
  const toast = useToast();

  const [history, setHistory] = useState<DonationRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!donor) return;
    api
      .donorDonations(donor._id)
      .then((data) => setHistory(data.donations))
      .catch(() => setHistory([]));
  }, [donor]);

  if (loading) return <p className="muted">Loading your profile.</p>;

  if (!donor) {
    return (
      <div className="mx-auto max-w-md card text-center">
        <h1 className="text-xl">You are not logged in</h1>
        <p className="muted mt-2">
          The profile page shows your availability switch and your donation history, so it needs a
          login.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Link to="/login" className="btn-primary">
            Log in
          </Link>
          <Link to="/register" className="btn-secondary">
            Register
          </Link>
        </div>
      </div>
    );
  }

  async function toggleAvailability() {
    if (!donor) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.setAvailability(donor._id, !donor.available);
      setDonor(result.donor);
      toast.show(
        result.donor.available ? "You are available again" : "Marked as not available",
        result.donor.available
          ? "You will appear in nearby searches."
          : "You will be left out of nearby searches until you switch this back on.",
        "success"
      );
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save the change.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-4">
        <BloodGroupTag group={donor.bloodGroup} />
        <div>
          <h1 className="text-2xl">{donor.name}</h1>
          <p className="muted">
            {donor.city} - age {donor.age} - {donor.phoneMasked}
          </p>
        </div>
        <div className="ml-auto">
          <EligibilityTag eligible={donor.eligible} />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card lg:col-span-1">
          <h2 className="section-title">Availability</h2>
          <p className="muted mt-1">
            The nearby search only returns donors who are available and whose last donation is more
            than ninety days old.
          </p>

          <div className="mt-4 flex items-center justify-between rounded-lg border border-ink-500/15 p-3">
            <div>
              <p className="text-sm font-medium">
                {donor.available ? "Available to donate" : "Not available"}
              </p>
              <p className="text-xs text-ink-500">Last donation: {formatDate(donor.lastDonation)}</p>
            </div>
            <button
              type="button"
              className={donor.available ? "btn-quiet" : "btn-primary"}
              onClick={() => void toggleAvailability()}
              disabled={saving}
            >
              {donor.available ? "Switch off" : "Switch on"}
            </button>
          </div>

          {error ? <p className="mt-3 text-sm text-blood-700">{error}</p> : null}

          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-500">Donations</dt>
              <dd className="text-lg font-semibold">{donor.donationCount}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-500">Status</dt>
              <dd className="text-lg font-semibold">
                {donor.eligible ? "can donate" : "in 90 day gap"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="card lg:col-span-2">
          <h2 className="section-title">Donation history</h2>
          <p className="muted mt-1">
            Joined to the hospitals collection with $lookup, newest first.
          </p>

          {history.length === 0 ? (
            <p className="muted mt-4">No donations recorded yet.</p>
          ) : (
            <table className="table-plain mt-4">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Hospital</th>
                  <th>City</th>
                  <th>Units</th>
                </tr>
              </thead>
              <tbody>
                {history.map((record) => (
                  <tr key={record._id}>
                    <td>{formatDate(record.date)}</td>
                    <td>{record.hospitalName ?? "unknown"}</td>
                    <td>{record.hospitalCity ?? "-"}</td>
                    <td>{record.units}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section>
        <h2 className="section-title mb-3">Your stored location</h2>
        <MapView center={toLatLng(donor.location)} zoom={13} className="h-80 overflow-hidden rounded-xl border border-ink-500/15">
          <SearchPointMarker point={donor.location} label="me" />
        </MapView>
      </section>
    </div>
  );
}
