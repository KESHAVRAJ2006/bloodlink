import { useEffect, useState } from "react";
import { BloodGroupTag } from "../components/Badges";
import { DonorList } from "../components/DonorList";
import {
  DonorMarkers,
  HospitalMarkers,
  MapView,
  RadiusCircle,
  RecenterMap,
} from "../components/MapView";
import { api } from "../lib/api";
import { toLatLng } from "../lib/format";
import { BLOOD_GROUPS, type BloodGroup, type Donor, type Hospital } from "../lib/types";

const KARNATAKA_CENTRE: [number, number] = [12.62, 77.1];

export function Hospitals() {
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [selected, setSelected] = useState<Hospital | null>(null);
  const [bloodGroup, setBloodGroup] = useState<BloodGroup | "">("");
  const [radiusKm, setRadiusKm] = useState(15);

  const [donors, setDonors] = useState<Donor[]>([]);
  const [compatibleGroups, setCompatibleGroups] = useState<BloodGroup[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .hospitals()
      .then((data) => setHospitals(data.hospitals))
      .catch((problem) =>
        setError(problem instanceof Error ? problem.message : "Could not load hospitals.")
      );
  }, []);

  // Whenever the hospital or the filters change, ask the server for the donors
  // around that hospital. The search point is the hospital document itself.
  useEffect(() => {
    if (!selected) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .hospitalNearbyDonors(selected._id, { bloodGroup: bloodGroup || undefined, km: radiusKm })
      .then((data) => {
        if (cancelled) return;
        setDonors(data.donors);
        setCompatibleGroups(data.compatibleGroups);
      })
      .catch((problem) => {
        if (cancelled) return;
        setError(problem instanceof Error ? problem.message : "Could not load donors.");
        setDonors([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected, bloodGroup, radiusKm]);

  const centre = selected ? toLatLng(selected.location) : KARNATAKA_CENTRE;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl">Hospitals</h1>
        <p className="muted mt-1">
          Pick a hospital on the map or in the list to see the eligible donors around it. The search
          point comes from the hospital document, so no address lookup is needed.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <MapView center={centre} zoom={selected ? 12 : 9} className="h-[520px] overflow-hidden rounded-xl border border-ink-500/15">
            <RecenterMap center={centre} zoom={selected ? 12 : 9} />
            <HospitalMarkers hospitals={hospitals} onSelect={setSelected} />
            {selected ? (
              <>
                <RadiusCircle point={selected.location} radiusKm={radiusKm} />
                <DonorMarkers donors={donors} />
              </>
            ) : null}
          </MapView>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <section className="card">
            <label className="label" htmlFor="hospital-select">
              Hospital
            </label>
            <select
              id="hospital-select"
              className="input"
              value={selected?._id ?? ""}
              onChange={(event) =>
                setSelected(hospitals.find((hospital) => hospital._id === event.target.value) ?? null)
              }
            >
              <option value="">choose a hospital</option>
              {hospitals.map((hospital) => (
                <option key={hospital._id} value={hospital._id}>
                  {hospital.name} ({hospital.city})
                </option>
              ))}
            </select>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="hospital-group">
                  Patient group
                </label>
                <select
                  id="hospital-group"
                  className="input"
                  value={bloodGroup}
                  onChange={(event) => setBloodGroup(event.target.value as BloodGroup | "")}
                >
                  <option value="">any</option>
                  {BLOOD_GROUPS.map((group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label" htmlFor="hospital-radius">
                  Radius: {radiusKm} km
                </label>
                <input
                  id="hospital-radius"
                  type="range"
                  min={2}
                  max={60}
                  value={radiusKm}
                  onChange={(event) => setRadiusKm(Number(event.target.value))}
                  className="w-full accent-blood-600"
                />
              </div>
            </div>

            {selected ? (
              <p className="muted mt-3">
                {selected.address ?? selected.city}
                {selected.phone ? ` - ${selected.phone}` : ""}
              </p>
            ) : null}

            {compatibleGroups ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="muted">Compatible donor groups:</span>
                {compatibleGroups.map((group) => (
                  <BloodGroupTag key={group} group={group} size="sm" />
                ))}
              </div>
            ) : null}
          </section>

          <section>
            <h2 className="section-title mb-2">
              {selected
                ? loading
                  ? "Searching"
                  : `${donors.length} eligible donor${donors.length === 1 ? "" : "s"} nearby`
                : "Donors"}
            </h2>
            {error ? <p className="mb-2 text-sm text-blood-700">{error}</p> : null}
            <div className="max-h-[420px] overflow-y-auto pr-1">
              <DonorList
                donors={donors}
                emptyMessage={
                  selected
                    ? "No eligible donor in this radius. Widen the radius or clear the group filter."
                    : "Choose a hospital to see donors around it."
                }
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
