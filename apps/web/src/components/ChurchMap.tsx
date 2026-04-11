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

/* A stained-glass lancet pin: jewel-tone panes held together by lead lines.
 * Rendered via divIcon so nothing is fetched from a CDN at runtime. */
const markerSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="38" height="48" viewBox="0 0 38 48" fill="none" aria-hidden="true">
  <defs>
    <filter id="marker-shadow" x="-40%" y="-20%" width="180%" height="160%">
      <feDropShadow dx="0" dy="5" stdDeviation="2.8" flood-color="#02040A" flood-opacity="0.5"/>
    </filter>
    <linearGradient id="marker-body" x1="19" y1="4" x2="19" y2="42" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="var(--sapphire)" />
      <stop offset="1" stop-color="var(--amethyst)" />
    </linearGradient>
  </defs>
  <g filter="url(#marker-shadow)">
    <path d="M19 3C10.16 3 3 10.16 3 19c0 4.4 2.01 8.42 4.77 12.14 2.67 3.58 6.3 7.53 9.39 12.91.68 1.18 2.38 1.18 3.06 0 3.09-5.38 6.72-9.33 9.39-12.91C32.99 27.42 35 23.4 35 19 35 10.16 27.84 3 19 3Z"
          fill="url(#marker-body)" stroke="var(--brass)" stroke-width="1.4" />
    <path d="M19 8.5 27.5 19 19 29.5 10.5 19 19 8.5Z" fill="var(--ruby)" fill-opacity="0.92" stroke="var(--brass)" stroke-width="0.9" />
    <path d="M19 8.5V29.5M10.5 19H27.5" stroke="var(--lead)" stroke-width="1.1" />
    <circle cx="19" cy="19" r="3.3" fill="var(--paper)" fill-opacity="0.96" />
    <g stroke="var(--brass)" stroke-width="1.8" stroke-linecap="round">
      <path d="M19 15.8v6.3" />
      <path d="M15.9 18.9h6.2" />
    </g>
  </g>
</svg>`;

const markerIcon = L.divIcon({
  html: markerSvg,
  className: "church-map-marker",
  iconSize: [38, 48],
  iconAnchor: [19, 45],
  popupAnchor: [0, -40],
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
            <div className="smallcaps text-[0.72rem] text-ink-faint">
              Parish of
            </div>
            <h3 className="halo-title font-display text-[1.18rem] leading-[1.15] font-normal tracking-[0.03em] text-paper">
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
            <span className="window-divider flex-1" />
            <FleuronIcon className="h-3 w-8" />
            <span className="window-divider flex-1" />
          </div>

          <div className="smallcaps mb-1.5 text-[0.72rem] text-ink-faint">
            Next light
          </div>
          <ul role="list" className="m-0 space-y-1 p-0 list-none">
            {topEvents.length > 0 ? (
              topEvents.map((eventItem) => {
                const day = formatEventDay(eventItem);
                const time = formatMinutesMissal(eventItem.start_time);
                return (
                  <li
                    key={eventItem.id}
                    className="flex items-baseline justify-between gap-3 font-serif text-[0.92rem]"
                  >
                    <span className="text-paper">{day || "Upcoming"}</span>
                    <span className="flex-1 border-b border-dotted border-brass/20 translate-y-[-3px]" />
                    <span className="tabular-nums text-brass">{time}</span>
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

          <div className="mt-3.5 border-t border-brass/15 pt-2.5">
            <Link
              to={`/churches/${church.slug}`}
              className="rubric-link smallcaps text-[0.78rem]"
            >
              Enter the chapel
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
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
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
