import { Link } from "react-router-dom";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import type { ChurchMapItem, EventSummary } from "../types";
import { formatAddress, formatMinutesToTime, titleCase } from "../utils";

const DAY_ORDER = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const EVENING_START_MINUTES = 16 * 60; // 4:00 PM

function getEventSortKey(event: EventSummary): number {
  let day: string;
  if (event.kind === "weekly" && event.day_of_week) {
    day = event.day_of_week.toLowerCase();
  } else if (event.date) {
    const d = new Date(event.date + "T12:00:00");
    day = DAY_ORDER[d.getDay()];
  } else {
    return 999;
  }
  const dayIdx = DAY_ORDER.indexOf(day);
  const isSaturdayEvening =
    day === "saturday" && event.start_time >= EVENING_START_MINUTES;
  if (day === "sunday") return event.start_time;
  if (isSaturdayEvening) return 1000 + event.start_time;
  return 2000 + dayIdx * 1000 + event.start_time;
}

function formatEventDay(event: EventSummary): string {
  if (event.kind === "weekly" && event.day_of_week) {
    return titleCase(event.day_of_week);
  }
  if (event.date) {
    const d = new Date(event.date + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "long" });
  }
  return "";
}

const defaultCenter: [number, number] = [43.1566, -77.6088];

const markerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
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
  const center = defaultCenter;

  return (
    <MapContainer
      center={center}
      zoom={11}
      className="map-container"
      scrollWheelZoom
    >
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
            <div className="map-popup">
              <h3>{church.name ?? "Unnamed church"}</h3>
              {formatAddress(church) ? (
                <p className="map-popup-address">{formatAddress(church)}</p>
              ) : null}
              <p className="map-popup-types">
                {church.event_types.length > 0
                  ? church.event_types.map(titleCase).join(", ")
                  : "No event types yet"}
              </p>
              <ul className="event-list compact">
                {church.upcoming_events.length > 0 ? (
                  <>
                    {[...church.upcoming_events]
                      .sort((a, b) => getEventSortKey(a) - getEventSortKey(b))
                      .slice(0, 3)
                      .map((eventItem) => {
                        const day = formatEventDay(eventItem);
                        const time = formatMinutesToTime(eventItem.start_time);
                        return (
                          <li key={eventItem.id}>
                            {day ? (
                              <>
                                <span className="map-popup-event-day">
                                  {day}
                                </span>{" "}
                                <span className="map-popup-event-time">
                                  {time}
                                </span>
                              </>
                            ) : (
                              <span className="map-popup-event-time">
                                {time}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    {church.upcoming_events.length > 3 ? (
                      <li className="map-popup-more">
                        {church.upcoming_events.length - 3} more…
                      </li>
                    ) : null}
                  </>
                ) : (
                  <li>No upcoming events found</li>
                )}
              </ul>
              <Link to={`/churches/${church.slug}`} className="map-popup__link">
                View church page
              </Link>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
