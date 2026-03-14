import { Link } from "react-router-dom";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import type { ChurchMapItem } from "../types";
import { formatAddress, titleCase } from "../utils";

const defaultCenter: [number, number] = [43.1566, -77.6088];

const markerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

interface ChurchMapProps {
  churches: ChurchMapItem[];
}

export function ChurchMap({ churches }: ChurchMapProps) {
  const withCoords = churches.filter(
    (church) => church.latitude !== null && church.longitude !== null,
  );
  const center = withCoords[0]
    ? ([withCoords[0].latitude, withCoords[0].longitude] as [number, number])
    : defaultCenter;

  return (
    <MapContainer center={center} zoom={11} className="map-container" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {withCoords.map((church) => (
        <Marker
          key={church.id}
          icon={markerIcon}
          position={[church.latitude as number, church.longitude as number]}
        >
          <Popup minWidth={220}>
            <h3>{church.name ?? "Unnamed church"}</h3>
            {formatAddress(church) ? <p>{formatAddress(church)}</p> : null}
            <p className="map-popup-types">
              {church.event_types.length > 0
                ? church.event_types.map(titleCase).join(", ")
                : "No event types yet"}
            </p>
            <ul className="event-list compact">
              {church.upcoming_events.length > 0 ? (
                church.upcoming_events.map((eventItem) => (
                  <li key={eventItem.id}>
                    <strong>{titleCase(eventItem.type)}:</strong> {eventItem.start_time}
                  </li>
                ))
              ) : (
                <li>No upcoming events found</li>
              )}
            </ul>
            <Link to={`/churches/${church.id}`}>View church page</Link>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
