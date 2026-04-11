import { memo, useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import type { Marker as LeafletMarker } from "leaflet";
import L from "leaflet";
import type { ChurchMapItem, EventSummary } from "../types";
import {
  formatAddress,
  formatEventDate,
  formatMinutesMissal,
  titleCase,
} from "../utils";
import { FleuronIcon } from "@/components/icons";

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
    return titleCase(event.day_of_week) + "s";
  }
  if (event.date) {
    return formatEventDate(event.date);
  }
  return "";
}

const defaultCenter: [number, number] = [43.1566, -77.6088];

/* A cross-in-roundel pin: cream disc with a brass ring, a rubric-red Latin
 * cross at the center, and a subtle drop-shadow. Rendered via divIcon so
 * nothing is fetched from a CDN at runtime. */
const markerSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42" fill="none" aria-hidden="true">
  <defs>
    <filter id="marker-shadow" x="-30%" y="-10%" width="160%" height="130%">
      <feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="#161210" flood-opacity="0.3"/>
    </filter>
  </defs>
  <g filter="url(#marker-shadow)">
    <path d="M17 2C9.27 2 3 8.27 3 16c0 3.7 1.73 7.3 4 10.5C9.5 30 13.5 34.4 15.8 38.6a1.35 1.35 0 0 0 2.4 0C20.5 34.4 24.5 30 27 26.5 29.27 23.3 31 19.7 31 16 31 8.27 24.73 2 17 2Z"
          fill="var(--paper)" stroke="var(--brass)" stroke-width="1.3" />
    <circle cx="17" cy="16" r="9.5" fill="none" stroke="var(--rule-strong)" stroke-width="0.8" />
    <g stroke="var(--rubric)" stroke-width="2" stroke-linecap="round">
      <path d="M17 9.5 V 21.5" />
      <path d="M12.5 13.5 H 21.5" />
    </g>
  </g>
</svg>`;

const markerIcon = L.divIcon({
  html: markerSvg,
  className: "church-map-marker",
  iconSize: [34, 42],
  iconAnchor: [17, 40],
  popupAnchor: [0, -34],
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

const ChurchMarker = memo(function ChurchMarker({
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

  const topEvents = useMemo(
    () => [...church.upcoming_events].sort(compareEvents).slice(0, 3),
    [church.upcoming_events],
  );

  return (
    <Marker
      ref={markerRef}
      icon={markerIcon}
      position={[church.latitude as number, church.longitude as number]}
    >
      <Popup minWidth={240} maxWidth={300}>
        <div className="w-full">
          <div className="space-y-1.5">
            <div className="smallcaps text-[0.75rem] text-ink-faint">
              Parish of
            </div>
            <h3 className="font-display text-[1.35rem] leading-[1.1] font-normal text-ink">
              {church.name ?? "Unnamed parish"}
            </h3>
            {formatAddress(church) ? (
              <p className="font-serif text-[0.875rem] italic leading-snug text-ink-soft">
                {formatAddress(church)}
              </p>
            ) : null}
          </div>

          <div
            className="my-3 flex items-center justify-center gap-2 text-brass"
            aria-hidden
          >
            <span className="h-px flex-1 bg-rule-strong" />
            <FleuronIcon className="h-3 w-8" />
            <span className="h-px flex-1 bg-rule-strong" />
          </div>

          <div className="smallcaps mb-1.5 text-[0.75rem] text-ink-faint">
            Upcoming
          </div>
          <ul role="list" className="m-0 space-y-1 p-0 list-none">
            {topEvents.length > 0 ? (
              topEvents.map((eventItem) => {
                const day = formatEventDay(eventItem);
                const time = formatMinutesMissal(eventItem.start_time);
                return (
                  <li
                    key={eventItem.id}
                    className="flex items-baseline justify-between gap-3 font-serif text-[0.9rem]"
                  >
                    <span className="text-ink">{day || "Upcoming"}</span>
                    <span className="flex-1 border-b border-dotted border-rule-strong translate-y-[-3px]" />
                    <span className="tabular-nums text-rubric">{time}</span>
                  </li>
                );
              })
            ) : (
              <li className="font-serif text-[0.9rem] italic text-ink-faint">
                No services listed yet.
              </li>
            )}
            {church.upcoming_events.length > 3 ? (
              <li className="pt-1 font-serif text-[0.8125rem] italic text-ink-faint">
                …and {church.upcoming_events.length - 3} more
              </li>
            ) : null}
          </ul>

          <div className="mt-3.5 border-t border-rule-strong pt-2.5">
            <Link
              to={`/churches/${church.slug}`}
              className="rubric-link smallcaps text-[0.8125rem]"
            >
              Read the full leaflet →
            </Link>
          </div>
        </div>
      </Popup>
    </Marker>
  );
});

export const ChurchMap = memo(function ChurchMap({
  churches,
  centerOn,
}: ChurchMapProps) {
  const withCoords = useMemo(
    () =>
      churches.filter(
        (church) => church.latitude !== null && church.longitude !== null,
      ),
    [churches],
  );
  const center = defaultCenter;

  return (
    <MapContainer
      center={center}
      zoom={11}
      className="h-full w-full"
      scrollWheelZoom
      zoomControl={false}
    >
      {centerOn && <ChangeView center={centerOn} />}
      {/* CartoDB Positron — a clean, low-saturation base that takes the
       * warm sepia CSS filter (set in app.css) gracefully. Free, no API key. */}
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        subdomains={["a", "b", "c", "d"]}
        maxZoom={19}
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
});
