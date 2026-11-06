import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BloodGroupTag } from "../components/Badges";
import { DonorList } from "../components/DonorList";
import {
  ClickToPick,
  DonorMarkers,
  MapView,
  RadiusCircle,
  RecenterMap,
  SearchPointMarker,
  ZoneOutlines,
} from "../components/MapView";
import { api } from "../lib/api";
import { toLatLng } from "../lib/format";
import { BLOOD_GROUPS, type BloodGroup, type CityZone, type Donor, type GeoPoint } from "../lib/types";

const DEFAULT_LNG = 76.6394;
const DEFAULT_LAT = 12.2958;

export function FindDonors() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [lng, setLng] = useState(Number(searchParams.get("lng") ?? DEFAULT_LNG));
  const [lat, setLat] = useState(Number(searchParams.get("lat") ?? DEFAULT_LAT));
  const [radiusKm, setRadiusKm] = useState(Number(searchParams.get("km") ?? 10));
  const [bloodGroup, setBloodGroup] = useState<BloodGroup | "">(
    (searchParams.get("bloodGroup") as BloodGroup | null) ?? ""
  );
  const [compatible, setCompatible] = useState(true);

  const [donors, setDonors] = useState<Donor[]>([]);
  const [compatibleGroups, setCompatibleGroups] = useState<BloodGroup[] | null>(null);
  const [zones, setZones] = useState<CityZone[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchPoint = useMemo<GeoPoint>(
    () => ({ type: "Point", coordinates: [lng, lat] }),
    [lng, lat]
  );

  useEffect(() => {
    api.zones().then((data) => setZones(data.zones)).catch(() => setZones([]));
  }, []);

  const runSearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.nearbyDonors({
        lng,
        lat,
        km: radiusKm,
        bloodGroup: bloodGroup || undefined,
        compatible,
        limit: 100,
      });
      setDonors(result.donors);
      setCompatibleGroups(result.compatibleGroups);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The search failed.");
      setDonors([]);
    } finally {
      setLoading(false);
    }
  }, [lng, lat, radiusKm, bloodGroup, compatible]);

  // Runs on the first render and again whenever a search input changes, so the
  // map and the list never disagree with the controls above them.
  useEffect(() => {
    void runSearch();
  }, [runSearch]);

  // Keep the address bar in step with the controls, so a search can be shared
  // as a link. setSearchParams is deliberately left out of the dependency list:
  // it changes identity on every navigation and would restart this effect.
  useEffect(() => {
    setSearchParams(
      {
        lng: String(lng),
        lat: String(lat),
        km: String(radiusKm),
        ...(bloodGroup ? { bloodGroup } : {}),
      },
      { replace: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lng, lat, radiusKm, bloodGroup]);

  function useMyLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLng(position.coords.longitude);
        setLat(position.coords.latitude);
      },
      () => setError("Location permission was refused, so the map stayed where it was.")
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl">Find donors</h1>
        <p className="muted mt-1">
          Click anywhere on the map to move the search point. The circle is the radius sent to
          MongoDB, and the list is sorted by the distance $geoNear returns.
        </p>
      </header>

      <section className="card">
        <div className="grid gap-4 md:grid-cols-5">
          <div>
            <label className="label" htmlFor="group">
              Patient blood group
            </label>
            <select
              id="group"
              className="input"
              value={bloodGroup}
              onChange={(event) => setBloodGroup(event.target.value as BloodGroup | "")}
            >
              <option value="">any group</option>
              {BLOOD_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="radius">
              Radius: {radiusKm} km
            </label>
            <input
              id="radius"
              type="range"
              min={1}
              max={60}
              step={1}
              value={radiusKm}
              onChange={(event) => setRadiusKm(Number(event.target.value))}
              className="w-full accent-blood-600"
            />
          </div>

          <div>
            <label className="label" htmlFor="lng">
              Longitude
            </label>
            <input
              id="lng"
              className="input"
              type="number"
              step="0.0001"
              value={lng}
              onChange={(event) => setLng(Number(event.target.value))}
            />
          </div>

          <div>
            <label className="label" htmlFor="lat">
              Latitude
            </label>
            <input
              id="lat"
              className="input"
              type="number"
              step="0.0001"
              value={lat}
              onChange={(event) => setLat(Number(event.target.value))}
            />
          </div>

          <div className="flex flex-col justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={useMyLocation}>
              Use my location
            </button>
            <label className="flex items-center gap-2 text-xs text-ink-700">
              <input
                type="checkbox"
                checked={compatible}
                onChange={(event) => setCompatible(event.target.checked)}
                className="accent-blood-600"
              />
              include compatible groups
            </label>
          </div>
        </div>

        {compatibleGroups ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-500/10 pt-4">
            <span className="muted">Searching donor groups:</span>
            {compatibleGroups.map((group) => (
              <BloodGroupTag key={group} group={group} size="sm" />
            ))}
          </div>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <MapView center={toLatLng(searchPoint)} zoom={12} className="h-[520px] overflow-hidden rounded-xl border border-ink-500/15">
            <RecenterMap center={toLatLng(searchPoint)} />
            <ClickToPick
              onPick={(pickedLng, pickedLat) => {
                setLng(Number(pickedLng.toFixed(6)));
                setLat(Number(pickedLat.toFixed(6)));
              }}
            />
            <ZoneOutlines zones={zones} />
            <RadiusCircle point={searchPoint} radiusKm={radiusKm} />
            <SearchPointMarker point={searchPoint} />
            <DonorMarkers donors={donors} />
          </MapView>
          <p className="muted mt-2">
            Pin colour is the blood group; faded pins are donors still inside the ninety day gap.
          </p>
        </div>

        <div className="lg:col-span-2">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="section-title">
              {loading ? "Searching" : `${donors.length} donor${donors.length === 1 ? "" : "s"}`}
            </h2>
            <button type="button" className="text-xs text-blood-700 hover:underline" onClick={() => void runSearch()}>
              refresh
            </button>
          </div>

          {error ? <p className="mb-3 text-sm text-blood-700">{error}</p> : null}

          <div className="max-h-[560px] overflow-y-auto pr-1">
            <DonorList
              donors={donors}
              emptyMessage="No eligible donor inside this radius. Try a larger radius or a different group."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
