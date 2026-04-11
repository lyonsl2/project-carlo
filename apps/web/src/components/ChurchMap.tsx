import { memo, useEffect, useMemo, useRef } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
    return formatEventDate(event.date);
  }
  return "";
}

const defaultCenter: [number, number] = [43.1566, -77.6088];

// Themed SVG pin using CSS variables so it follows the site palette.
// Rendered as a divIcon so nothing is fetched from a CDN at runtime.
const markerSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40" fill="none" aria-hidden="true">
  <path d="M15 1C7.82 1 2 6.82 2 14c0 9.5 11.5 23.2 12.08 23.88a1.2 1.2 0 0 0 1.84 0C16.5 37.2 28 23.5 28 14 28 6.82 22.18 1 15 1Z"
        fill="var(--primary)" stroke="var(--primary-foreground)" stroke-width="1.6" />
  <g transform="translate(15 14)" fill="none" stroke="var(--primary-foreground)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M0 -6 V 2" />
    <path d="M-3 -3 H 3" />
    <path d="M-5 6 V -1 L 0 -5 L 5 -1 V 6 Z" />
  </g>
</svg>`;

const markerIcon = L.divIcon({
  html: markerSvg,
  className: "church-map-marker",
  iconSize: [30, 40],
  iconAnchor: [15, 38],
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
  return (
    <Marker
      ref={markerRef}
      icon={markerIcon}
      position={[church.latitude as number, church.longitude as number]}
    >
      <Popup minWidth={220}>
        <div className="w-full space-y-3 text-sm">
          <div className="space-y-1">
            <h3 className="font-heading font-medium text-foreground">
              {church.name ?? "Unnamed parish"}
            </h3>
            {formatAddress(church) ? (
              <p className="text-xs leading-5 text-muted-foreground">
                {formatAddress(church)}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {church.event_types.length > 0 ? (
              church.event_types.map((eventType) => (
                <Badge key={eventType} variant="outline" className="capitalize">
                  {titleCase(eventType)}
                </Badge>
              ))
            ) : (
              <Badge variant="outline">No services listed</Badge>
            )}
          </div>
          <ul role="list" className="space-y-2 pl-0">
            {church.upcoming_events.length > 0 ? (
              <>
                {[...church.upcoming_events]
                  .sort(compareEvents)
                  .slice(0, 3)
                  .map((eventItem) => {
                    const day = formatEventDay(eventItem);
                    const time = formatMinutesToTime(eventItem.start_time);
                    return (
                      <li
                        key={eventItem.id}
                        className="flex items-start justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2"
                      >
                        <span className="font-medium text-foreground">
                          {day || "Upcoming"}
                        </span>
                        <span className="text-muted-foreground">{time}</span>
                      </li>
                    );
                  })}
                {church.upcoming_events.length > 3 ? (
                  <li className="text-xs italic text-muted-foreground">
                    {church.upcoming_events.length - 3} more
                  </li>
                ) : null}
              </>
            ) : (
              <li className="text-sm text-muted-foreground">
                No services listed yet.
              </li>
            )}
          </ul>
          <Button
            asChild
            size="sm"
            className="w-full !text-primary-foreground hover:!text-primary-foreground"
          >
            <Link to={`/churches/${church.slug}`}>View church page</Link>
          </Button>
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
      className="h-full min-h-[calc(100vh-5rem)] w-full"
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
});
