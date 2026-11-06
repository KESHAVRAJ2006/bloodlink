import L from "leaflet";
import { useEffect, type ReactNode } from "react";
import {
  Circle,
  MapContainer,
  Marker,
  Polygon,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { BLOOD_GROUP_COLORS, formatDistance, toLatLng } from "../lib/format";
import type { CityZone, Donor, GeoPoint, Hospital } from "../lib/types";

/**
 * Everything Leaflet related lives in this file.
 *
 * Tiles come from OpenStreetMap, which needs no API key but does require the
 * attribution shown at the bottom right of every map.
 *
 * Markers are built with L.divIcon instead of the default image icon. That
 * avoids the broken-marker problem bundlers have with Leaflet image assets, and
 * it lets each donor pin carry its blood group colour.
 */

const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function donorIcon(donor: Donor): L.DivIcon {
  const color = BLOOD_GROUP_COLORS[donor.bloodGroup];
  const opacity = donor.eligible ? 1 : 0.45;
  return L.divIcon({
    className: "",
    html: `<div class="donor-pin" style="background:${color};opacity:${opacity};width:26px;height:26px">${donor.bloodGroup}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function pointIcon(label: string, color: string, size = 30): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div class="donor-pin" style="background:${color};width:${size}px;height:${size}px">${label}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

interface MapViewProps {
  center: [number, number];
  zoom?: number;
  children?: ReactNode;
  className?: string;
}

export function MapView({ center, zoom = 12, children, className }: MapViewProps) {
  return (
    <div className={className ?? "h-[480px] overflow-hidden rounded-xl border border-ink-500/15"}>
      <MapContainer center={center} zoom={zoom} scrollWheelZoom>
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        {children}
      </MapContainer>
    </div>
  );
}

/**
 * MapContainer only reads its center prop once, so moving the map later needs
 * this helper. It runs inside the map context and calls setView when the
 * coordinates change.
 */
export function RecenterMap({ center, zoom }: { center: [number, number]; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom ?? map.getZoom());
  }, [map, center, zoom]);
  return null;
}

/** Turns a click anywhere on the map into a coordinate pair. */
export function ClickToPick({ onPick }: { onPick: (lng: number, lat: number) => void }) {
  useMapEvents({
    click: (event) => onPick(event.latlng.lng, event.latlng.lat),
  });
  return null;
}

export function SearchPointMarker({ point, label = "you" }: { point: GeoPoint; label?: string }) {
  return (
    <Marker position={toLatLng(point)} icon={pointIcon(label, "#111827", 34)}>
      <Popup>Search point</Popup>
    </Marker>
  );
}

/** The circle that shows the search radius. Leaflet takes the radius in metres. */
export function RadiusCircle({ point, radiusKm }: { point: GeoPoint; radiusKm: number }) {
  return (
    <Circle
      center={toLatLng(point)}
      radius={radiusKm * 1000}
      pathOptions={{ color: "#a81f2c", weight: 1, fillColor: "#c62f3d", fillOpacity: 0.07 }}
    />
  );
}

export function DonorMarkers({
  donors,
  onContact,
}: {
  donors: Donor[];
  onContact?: (donor: Donor) => void;
}) {
  return (
    <>
      {donors.map((donor) => (
        <Marker key={donor._id} position={toLatLng(donor.location)} icon={donorIcon(donor)}>
          <Popup>
            <div className="space-y-1">
              <p className="font-semibold">{donor.name}</p>
              <p className="text-xs">
                {donor.bloodGroup} - {donor.city}
                {donor.distanceKm !== undefined ? ` - ${formatDistance(donor.distanceKm)} away` : ""}
              </p>
              <p className="text-xs">
                {donor.eligible ? "can donate now" : "inside the 90 day gap"}
              </p>
              {onContact ? (
                <button
                  type="button"
                  className="text-xs font-semibold text-blood-700 underline"
                  onClick={() => onContact(donor)}
                >
                  Show contact number
                </button>
              ) : null}
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
}

export function HospitalMarkers({
  hospitals,
  onSelect,
}: {
  hospitals: Hospital[];
  onSelect?: (hospital: Hospital) => void;
}) {
  return (
    <>
      {hospitals.map((hospital) => (
        <Marker
          key={hospital._id}
          position={toLatLng(hospital.location)}
          icon={pointIcon("H", "#1f2937", 28)}
          eventHandlers={onSelect ? { click: () => onSelect(hospital) } : undefined}
        >
          <Popup>
            <p className="font-semibold">{hospital.name}</p>
            <p className="text-xs">{hospital.address ?? hospital.city}</p>
          </Popup>
        </Marker>
      ))}
    </>
  );
}

/** Draws the stored city polygons so the $geoWithin zone is visible. */
export function ZoneOutlines({ zones }: { zones: CityZone[] }) {
  return (
    <>
      {zones.map((zone) => {
        const ring = zone.area.coordinates[0] ?? [];
        const positions = ring.map(([lng, lat]) => [lat, lng] as [number, number]);
        return (
          <Polygon
            key={zone._id}
            positions={positions}
            pathOptions={{ color: "#6b7280", weight: 1, dashArray: "4 4", fillOpacity: 0.03 }}
          >
            <Popup>{zone.name} zone</Popup>
          </Polygon>
        );
      })}
    </>
  );
}
