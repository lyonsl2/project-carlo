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

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

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

const placeMarkerSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42" fill="none" aria-hidden="true">
  <defs>
    <filter id="place-marker-shadow" x="-30%" y="-10%" width="160%" height="130%">
      <feDropShadow dx="0" dy="2" stdDeviation="1.8" flood-color="#161210" flood-opacity="0.32"/>
    </filter>
  </defs>
  <g filter="url(#place-marker-shadow)">
    <path d="M16 2C8.82 2 3 7.82 3 15c0 4.02 2.22 7.95 4.87 11.4 2.35 3.06 5.38 6.18 6.92 10.9a1.27 1.27 0 0 0 2.42 0c1.54-4.72 4.57-7.84 6.92-10.9C26.78 22.95 29 19.02 29 15 29 7.82 23.18 2 16 2Z"
          fill="var(--rubric)" stroke="var(--paper)" stroke-width="1.6" />
    <circle cx="16" cy="15" r="5.2" fill="var(--paper)" stroke="var(--brass)" stroke-width="1.2" />
  </g>
</svg>`;

const placeMarkerIcon = L.divIcon({
  html: placeMarkerSvg,
  className: "searched-place-marker",
  iconSize: [32, 42],
  iconAnchor: [16, 40],
  popupAnchor: [0, -34],
});

interface ChurchMapProps {
  churches: ChurchMapItem[];
  centerOn?: {
    lat: number;
    lng: number;
    churchId?: number;
    placeTitle?: string;
    placeSubtitle?: string | null;
    zoom?: number;
    requestId?: number;
  } | null;
}

/**
 * Relocate the popup pane from inside `.leaflet-map-pane` (whose `transform`
 * creates a stacking context that traps child z-indexes) to the container
 * root. The pane's transform is kept in sync via MutationObserver so popups
 * stay geo-anchored, but its z-index now participates in the page-level
 * stacking context — letting popups render above the header overlay.
 */
function PopupPaneElevator() {
  const map = useMap();
  useEffect(() => {
    const mapPane = map.getPane("mapPane");
    const popupPane = map.getPane("popupPane");
    const container = map.getContainer();
    if (!mapPane || !popupPane) return;

    container.appendChild(popupPane);
    popupPane.style.zIndex = "1100";

    const sync = () => {
      popupPane.style.transform = mapPane.style.transform;
    };
    const observer = new MutationObserver(sync);
    observer.observe(mapPane, {
      attributes: true,
      attributeFilter: ["style"],
    });
    sync();

    return () => {
      observer.disconnect();
      mapPane.appendChild(popupPane);
    };
  }, [map]);
  return null;
}

function ChangeView({
  center,
}: {
  center: { lat: number; lng: number; zoom?: number; requestId?: number };
}) {
  const map = useMap();
  useEffect(() => {
    if (center.zoom != null) {
      map.flyTo([center.lat, center.lng], center.zoom, { duration: 0.8 });
    } else {
      map.panTo([center.lat, center.lng]);
    }
  }, [map, center.lat, center.lng, center.zoom, center.requestId]);
  return null;
}

const ChurchMarker = memo(function ChurchMarker({
  church,
  openPopupForChurchId,
  openPopupRequestId,
}: {
  church: ChurchMapItem;
  openPopupForChurchId: number | undefined;
  openPopupRequestId: number | undefined;
}) {
  const markerRef = useRef<LeafletMarker | null>(null);
  useEffect(() => {
    if (openPopupForChurchId === church.id && markerRef.current) {
      markerRef.current.openPopup();
    }
  }, [church.id, openPopupForChurchId, openPopupRequestId]);

  // upcoming_events arrives pre-sorted from fetchChurches, so just take the head.
  const topEvents = church.upcoming_events.slice(0, 3);
  const addressLine = formatAddress(church);

  return (
    <Marker
      ref={markerRef}
      icon={markerIcon}
      position={[church.latitude as number, church.longitude as number]}
    >
      <Popup minWidth={225} maxWidth={275}>
        <div className="w-full">
          <div className="space-y-2">
            <h3 className="font-display text-[1.35rem] leading-[1.1] font-normal text-ink">
              {church.name ?? "Unnamed parish"}
            </h3>
            {addressLine ? (
              <p className="font-serif text-[0.875rem] leading-snug text-ink-soft">
                {addressLine}
              </p>
            ) : null}
          </div>

          <div
            className="my-3.5 flex items-center justify-center gap-2 text-brass"
            aria-hidden
          >
            <span className="h-px flex-1 bg-rule-strong" />
            <FleuronIcon className="h-3 w-8" />
            <span className="h-px flex-1 bg-rule-strong" />
          </div>

          <div className="smallcaps mb-2 text-[0.75rem] text-ink-faint">
            Upcoming
          </div>
          <ul role="list" className="m-0 space-y-1.5 p-0 list-none">
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

          <div className="mt-4 border-t border-rule-strong pt-3">
            <Link
              to={`/churches/${church.slug}/`}
              className="rubric-link smallcaps text-[0.8125rem]"
            >
              Full schedule →
            </Link>
          </div>
        </div>
      </Popup>
    </Marker>
  );
});

const SearchPlaceMarker = memo(function SearchPlaceMarker({
  place,
}: {
  place: {
    lat: number;
    lng: number;
    title: string;
    subtitle?: string | null;
    requestId?: number;
  };
}) {
  const markerRef = useRef<LeafletMarker | null>(null);
  useEffect(() => {
    markerRef.current?.openPopup();
  }, [place.requestId]);

  return (
    <Marker
      ref={markerRef}
      icon={placeMarkerIcon}
      position={[place.lat, place.lng]}
      zIndexOffset={1000}
    >
      <Popup minWidth={210} maxWidth={260}>
        <div className="space-y-1.5">
          <div className="smallcaps text-[0.75rem] text-ink-faint">
            Searched place
          </div>
          <h3 className="font-display text-[1.25rem] leading-[1.1] font-normal text-ink">
            {place.title}
          </h3>
          {place.subtitle ? (
            <p className="font-serif text-[0.875rem] leading-snug text-ink-soft">
              {place.subtitle}
            </p>
          ) : null}
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
      className="church-map h-full w-full"
      scrollWheelZoom
      zoomControl={false}
    >
      {centerOn && <ChangeView center={centerOn} />}
      <PopupPaneElevator />
      <TileLayer
        attribution={OSM_ATTRIBUTION}
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      {withCoords.map((church) => (
        <ChurchMarker
          key={church.id}
          church={church}
          openPopupForChurchId={centerOn?.churchId}
          openPopupRequestId={centerOn?.requestId}
        />
      ))}
      {centerOn?.placeTitle ? (
        <SearchPlaceMarker
          place={{
            lat: centerOn.lat,
            lng: centerOn.lng,
            title: centerOn.placeTitle,
            subtitle: centerOn.placeSubtitle,
            requestId: centerOn.requestId,
          }}
        />
      ) : null}
    </MapContainer>
  );
});
