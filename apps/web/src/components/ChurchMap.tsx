import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import type { Marker as LeafletMarker } from "leaflet";
import L from "leaflet";
import type { ChurchMapItem, EventSummary } from "../types";
import {
  formatAddress,
  formatEventDate,
  formatMinutesToTime,
  titleCase,
} from "../utils";

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

function compareEvents(a: EventSummary, b: EventSummary): number {
  const aIsSpecific = a.kind === "specific_date" && a.date;
  const bIsSpecific = b.kind === "specific_date" && b.date;

  if (aIsSpecific && bIsSpecific) {
    const dateCompare = (a.date ?? "").localeCompare(b.date ?? "");
    if (dateCompare !== 0) return dateCompare;
    return a.start_time - b.start_time;
  }
  if (aIsSpecific && !bIsSpecific) return 1;
  if (!aIsSpecific && bIsSpecific) return -1;

  let dayA: string;
  let dayB: string;
  if (a.kind === "weekly" && a.day_of_week) {
    dayA = a.day_of_week.toLowerCase();
  } else if (a.date) {
    const d = new Date(a.date + "T12:00:00");
    dayA = DAY_ORDER[d.getDay()];
  } else return 1;
  if (b.kind === "weekly" && b.day_of_week) {
    dayB = b.day_of_week.toLowerCase();
  } else if (b.date) {
    const d = new Date(b.date + "T12:00:00");
    dayB = DAY_ORDER[d.getDay()];
  } else return -1;

  const dayIdxA = DAY_ORDER.indexOf(dayA);
  const dayIdxB = DAY_ORDER.indexOf(dayB);
  const isSatEveA =
    dayA === "saturday" && a.start_time >= EVENING_START_MINUTES;
  const isSatEveB =
    dayB === "saturday" && b.start_time >= EVENING_START_MINUTES;

  const keyA =
    dayA === "sunday"
      ? a.start_time
      : isSatEveA
        ? 1000 + a.start_time
        : 2000 + dayIdxA * 1000 + a.start_time;
  const keyB =
    dayB === "sunday"
      ? b.start_time
      : isSatEveB
        ? 1000 + b.start_time
        : 2000 + dayIdxB * 1000 + b.start_time;
  return keyA - keyB;
}

function formatEventDay(event: EventSummary): string {
  if (event.kind === "weekly" && event.day_of_week) {
    return titleCase(event.day_of_week);
  }
  if (event.date) {
    const d = new Date(event.date + "T12:00:00");
    const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
    return `${weekday}, ${formatEventDate(event.date)}`;
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
  centerOn?: { lat: number; lng: number; churchId?: number } | null;
}

function ChangeView({ center }: { center: { lat: number; lng: number } }) {
  const map = useMap();
  useEffect(() => {
    map.panTo([center.lat, center.lng]);
  }, [map, center.lat, center.lng]);
  return null;
}

function ChurchMarker({
  church,
  openPopupForChurchId,
}: {
  church: ChurchMapItem;
  openPopupForChurchId: number | undefined;
}) {
  const markerRef = useRef<LeafletMarker | null>(null);
  useEffect(() => {
    if (openPopupForChurchId === church.id && markerRef.current) {
      markerRef.current.openPopup();
    }
  }, [church.id, openPopupForChurchId]);
  return (
    <Marker
      ref={markerRef}
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
                  .sort(compareEvents)
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
  );
}

export function ChurchMap({ churches, centerOn }: ChurchMapProps) {
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
      {centerOn && <ChangeView center={centerOn} />}
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {withCoords.map((church) => (
        <ChurchMarker
          key={church.id}
          church={church}
          openPopupForChurchId={centerOn?.churchId}
        />
      ))}
    </MapContainer>
  );
}
