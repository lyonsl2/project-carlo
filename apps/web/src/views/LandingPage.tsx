import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { ChurchSearchResult } from "../api";
import { useAuth } from "@/auth/AuthContext";
import { safeNextPath } from "@/lib/nextPath";
import { isPaywallEnabled } from "@/lib/supabaseEnv";
import { Fleuron } from "../components/Fleuron";
import { SearchTypeahead } from "../components/SearchTypeahead";
import { TimeRangeSlider } from "../components/TimeRangeSlider";
import {
  ArrowRightIcon,
  CrosshairIcon,
  HandshakeIcon,
  LatinCrossIcon,
  MonstranceIcon,
  SlidersHorizontalIcon,
} from "../components/icons";
import {
  DEFAULT_FILTER_STATE,
  MINUTES_PER_DAY,
  encodeFiltersToParams,
  type FilterState,
} from "../components/filterState";
import { FILTER_DAY_LABELS } from "../constants/days";
import { EVENT_TYPE_OPTIONS } from "../constants/eventTypes";
import { useMinWidth } from "../hooks/useMinWidth";
import { useDocumentMeta } from "../hooks/useDocumentMeta";
import { canonicalForPath } from "../lib/seo";
import { cn } from "@/lib/utils";
import {
  PLACE_SEARCH_ZOOM,
  type PlaceSearchResult,
} from "../placeSearch";
import type { HomeMapCenter } from "./HomePage";
import type { EventType } from "../types";

const TIME_STEP_MINUTES = 15;

const SERVICE_ICONS: Record<EventType, typeof LatinCrossIcon> = {
  mass: LatinCrossIcon,
  confession: HandshakeIcon,
  adoration: MonstranceIcon,
};

export function LandingPage() {
  useDocumentMeta({
    title: "Search Mass, Confession & Adoration Times · Project Carlo",
    description:
      "Search Catholic parishes by location, service, day, and time to find Mass, Confession, and Adoration times near you.",
    canonicalUrl: canonicalForPath("/landing"),
  });

  const navigate = useNavigate();
  const isDesktop = useMinWidth(768);
  const { status } = useAuth();
  const [searchParams] = useSearchParams();
  // With the paywall on, this is the one page a stranger can reach, so it
  // offers the trial instead of a search over parishes they cannot open yet.
  const pitchTrial = isPaywallEnabled() && status !== "signedIn";
  const nextPath = safeNextPath(searchParams.get("next"), "/");
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTER_STATE);
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "requesting" | "error"
  >("idle");
  const [locationError, setLocationError] = useState<string | null>(null);

  const filterSearch = useMemo(() => {
    const params = encodeFiltersToParams(filters, new URLSearchParams());
    const str = params.toString();
    return str ? `?${str}` : "";
  }, [filters]);

  const goToMap = useCallback(
    (centerOn?: HomeMapCenter) => {
      navigate(
        { pathname: "/", search: filterSearch },
        centerOn ? { state: { centerOn } } : undefined,
      );
    },
    [filterSearch, navigate],
  );

  const handleChurchSelect = useCallback(
    (church: ChurchSearchResult) => {
      if (church.latitude != null && church.longitude != null) {
        goToMap({
          lat: church.latitude,
          lng: church.longitude,
          churchId: church.id,
        });
      } else {
        goToMap();
      }
    },
    [goToMap],
  );

  const handlePlaceSelect = useCallback(
    (place: PlaceSearchResult) => {
      goToMap({
        lat: place.lat,
        lng: place.lng,
        placeTitle: place.title,
        placeSubtitle: place.subtitle,
        zoom: PLACE_SEARCH_ZOOM,
      });
    },
    [goToMap],
  );

  const handleCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationStatus("error");
      setLocationError("Location is not available in this browser.");
      return;
    }
    setLocationStatus("requesting");
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocationStatus("idle");
        goToMap({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          placeTitle: "Your current location",
          placeSubtitle: "From your browser",
          zoom: PLACE_SEARCH_ZOOM,
        });
      },
      (error) => {
        setLocationStatus("error");
        setLocationError(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied."
            : "Couldn't get your current location.",
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, [goToMap]);

  const headingFontSize = open
    ? isDesktop
      ? 64
      : 40
    : isDesktop
      ? 88
      : 56;

  return (
    <main
      className={cn(
        "flex min-h-svh flex-col items-center bg-paper px-7 md:px-24 md:justify-center md:py-16",
        open ? "justify-start pt-9 pb-7" : "justify-center py-0",
      )}
    >
      <div
        className={cn(
          "flex w-full max-w-[720px] flex-col items-center",
          open ? "gap-6 md:gap-10" : "gap-10 md:gap-14",
        )}
      >
        <Fleuron solo size={open ? 28 : 36} className="md:hidden" />
        <Fleuron solo size={48} className="hidden md:flex" />

        <div
          className={cn(
            "flex flex-col items-center text-center",
            open ? "gap-2 md:gap-[18px]" : "gap-[14px] md:gap-[18px]",
          )}
        >
          <h1
            className="m-0 font-display font-normal text-ink leading-none tracking-[-0.02em] ease-[cubic-bezier(.22,1,.36,1)]"
            style={{
              fontSize: headingFontSize,
              transitionProperty: "font-size",
              transitionDuration: isDesktop ? "360ms" : "320ms",
            }}
          >
            Project <em className="italic text-rubric">Carlo</em>
          </h1>
          <p
            className={cn(
              "smallcaps m-0 text-ink-soft leading-[1.4]",
              open
                ? "text-[12px] md:text-[15px]"
                : "text-[13px] md:text-[15px]",
            )}
          >
            Mass, Confession &amp; Adoration{" "}
            <br className="md:hidden" />
            times near you
          </p>
        </div>

        {/* The search block is left out rather than hidden when pitching the
         *  trial: mounting the typeahead downloads the parish snapshot, which
         *  is the very thing behind the paywall. */}
        {pitchTrial ? <TrialPitch nextPath={nextPath} /> : (
        <div
          className={cn(
            "flex w-full flex-col",
            "gap-4 md:gap-[18px]",
          )}
        >
          <SearchTypeahead
            hideModeToggle
            size="lg"
            filterButton={null}
            onChurchSelect={handleChurchSelect}
            onPlaceSelect={handlePlaceSelect}
          />

          {/* Mobile: stacked rows. Desktop: location-left / refine-right. */}
          <div className="flex flex-col gap-[14px] md:flex-row md:items-center md:justify-between md:gap-6">
            <button
              type="button"
              onClick={handleCurrentLocation}
              disabled={locationStatus === "requesting"}
              className="rubric-link inline-flex items-center gap-2 self-start font-serif text-[15px] text-rubric disabled:opacity-60"
            >
              <CrosshairIcon className="size-4 shrink-0" />
              <span>
                {locationStatus === "requesting"
                  ? "Requesting your location…"
                  : "Or use my current location"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setOpen((prev) => !prev)}
              data-active={open ? "true" : undefined}
              className={cn(
                "rubric-link smallcaps flex items-center md:inline-flex md:w-auto md:gap-2 md:text-[13px]",
                "w-full justify-between text-[13px]",
                open ? "text-rubric" : "text-ink-soft",
              )}
              aria-expanded={open}
            >
              <span className="inline-flex items-center gap-[10px] md:gap-2">
                <SlidersHorizontalIcon className="size-[14px] shrink-0" />
                <span>{open ? "Hide refinements" : "Refine your search"}</span>
              </span>
              <span
                aria-hidden
                className={cn(
                  "inline-flex text-[12px] transition-transform duration-[240ms] ease-[cubic-bezier(.22,1,.36,1)] md:hidden",
                  open ? "text-rubric" : "text-ink-faint",
                )}
                style={{
                  transform: open ? "rotate(0deg)" : "rotate(180deg)",
                }}
              >
                ⌃
              </span>
            </button>
          </div>

          {locationStatus === "error" && locationError ? (
            <p className="font-serif text-[13px] italic text-ink-faint">
              {locationError}
            </p>
          ) : null}
        </div>
        )}

        {open && !pitchTrial ? (
          <RefineSection
            filters={filters}
            onChange={setFilters}
            isDesktop={isDesktop}
            onSubmit={() => goToMap()}
          />
        ) : (
          <>
            <Fleuron size={isDesktop ? 40 : 28} className="w-full opacity-85" />
            <p className="m-0 text-center font-serif italic text-[12.5px] text-ink-faint">
              {isDesktop
                ? "A directory of Catholic parishes — schedules parsed from each parish’s weekly bulletin."
                : "Schedules parsed from each parish’s weekly bulletin."}
            </p>
          </>
        )}
      </div>
    </main>
  );
}

/** What a stranger sees when the site is behind the paywall. */
function TrialPitch({ nextPath }: { nextPath: string }) {
  const signInHref = `/signin?next=${encodeURIComponent(nextPath)}`;
  return (
    <div className="flex w-full flex-col items-center gap-5">
      <p className="m-0 max-w-[34rem] text-center font-serif text-[16px] leading-relaxed text-ink-soft">
        Every Mass, Confession, and Adoration time from the parishes we follow,
        read out of their weekly bulletins and kept on one map.
      </p>

      <Link
        to={signInHref}
        className="missal-focus smallcaps inline-flex w-full items-center justify-center gap-[10px] bg-rubric px-6 py-[14px] text-[14px] tracking-[0.14em] text-paper transition-colors hover:bg-rubric-deep active:translate-y-px md:w-auto"
      >
        <span>Start your free 7-day trial</span>
        <ArrowRightIcon className="size-[14px]" />
      </Link>

      <p className="m-0 text-center font-serif italic text-[13px] text-ink-faint">
        No credit card required.
      </p>

      <p className="m-0 text-center font-serif text-[14px] text-ink-soft">
        Already have an account?{" "}
        <Link to={signInHref} className="rubric-link">
          Sign in
        </Link>
      </p>
    </div>
  );
}

interface RefineSectionProps {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  isDesktop: boolean;
  onSubmit: () => void;
}

function RefineSection({
  filters,
  onChange,
  isDesktop,
  onSubmit,
}: RefineSectionProps) {
  const fleuronSize = isDesktop ? 36 : 28;
  return (
    <div
      className="rise-in flex w-full flex-col gap-[22px] md:gap-7"
      style={{ animationDuration: isDesktop ? "360ms" : "320ms" }}
    >
      <Fleuron size={fleuronSize} className="w-full" />

      <section className="flex flex-col gap-[10px] md:gap-[14px]">
        <h3 className="smallcaps m-0 text-[12px] text-ink-soft md:text-center md:text-[13px]">
          Service type
        </h3>
        {isDesktop ? (
          <ServiceSegmented
            value={filters.eventType}
            onChange={(eventType) => onChange({ ...filters, eventType })}
          />
        ) : (
          <ServiceChips
            value={filters.eventType}
            onChange={(eventType) => onChange({ ...filters, eventType })}
          />
        )}
      </section>

      <section className="flex flex-col gap-[10px] md:gap-[14px]">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="smallcaps m-0 text-[12px] text-ink-soft md:text-[13px]">
            Day of week
          </h3>
          <button
            type="button"
            onClick={() => onChange({ ...filters, daysOfWeek: [] })}
            className={cn(
              "smallcaps cursor-pointer border-0 bg-transparent",
              "text-[12px]",
              filters.daysOfWeek.length === 0
                ? "text-rubric"
                : "text-ink-soft hover:text-rubric-deep",
            )}
          >
            {filters.daysOfWeek.length === 0
              ? "All days"
              : isDesktop
                ? "Show every day"
                : "Reset"}
          </button>
        </div>
        <DayPills
          value={filters.daysOfWeek}
          onChange={(daysOfWeek) => onChange({ ...filters, daysOfWeek })}
        />
      </section>

      <section className="flex flex-col gap-[10px] md:gap-[14px]">
        <h3 className="smallcaps m-0 text-[12px] text-ink-soft md:text-[13px]">
          Time of day
        </h3>
        <TimeRangeSlider
          min={0}
          max={MINUTES_PER_DAY}
          step={TIME_STEP_MINUTES}
          value={[
            filters.timeFrom,
            filters.timeTo >= MINUTES_PER_DAY - 1
              ? MINUTES_PER_DAY
              : filters.timeTo,
          ]}
          onValueChange={([timeFrom, timeTo]) =>
            onChange({
              ...filters,
              timeFrom,
              timeTo:
                timeTo >= MINUTES_PER_DAY ? MINUTES_PER_DAY - 1 : timeTo,
            })
          }
          compact={!isDesktop}
        />
      </section>

      <Fleuron size={fleuronSize} className="w-full" />

      <div className="flex md:justify-center">
        <button
          type="button"
          onClick={onSubmit}
          className="missal-focus smallcaps inline-flex w-full items-center justify-center gap-[10px] bg-rubric px-6 py-[14px] text-[14px] tracking-[0.14em] text-paper transition-colors hover:bg-rubric-deep active:translate-y-px md:w-auto md:px-6"
        >
          <span>Show on map</span>
          <ArrowRightIcon className="size-[14px]" />
        </button>
      </div>
    </div>
  );
}

interface ServiceSegmentedProps {
  value: EventType;
  onChange: (value: EventType) => void;
}

function ServiceSegmented({ value, onChange }: ServiceSegmentedProps) {
  return (
    <div className="flex divide-x divide-rule overflow-hidden rounded-sm border border-rule-strong">
      {EVENT_TYPE_OPTIONS.map((option) => {
        const isActive = value === option.id;
        const Icon = SERVICE_ICONS[option.id];
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.id)}
            className={cn(
              "missal-focus flex min-w-0 flex-1 basis-0 flex-col items-center gap-[6px] px-2 py-3 text-center transition-colors",
              isActive ? "bg-paper-deep/80" : "hover:bg-paper-deep/40",
            )}
          >
            <Icon
              className={cn(
                "size-[22px] shrink-0 transition-colors",
                isActive ? "text-rubric" : "text-ink-faint",
              )}
            />
            <span
              className={cn(
                "font-display text-[16px] leading-none transition-colors",
                isActive ? "text-rubric" : "text-ink",
              )}
            >
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface ServiceChipsProps {
  value: EventType;
  onChange: (value: EventType) => void;
}

function ServiceChips({ value, onChange }: ServiceChipsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {EVENT_TYPE_OPTIONS.map((option) => {
        const isActive = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.id)}
            className={cn(
              "missal-focus inline-flex items-center gap-2 rounded-sm border px-3 py-[6px] transition-colors",
              isActive
                ? "border-rubric bg-rubric/[0.06]"
                : "border-rule-strong hover:border-ink-faint",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "inline-block size-2 shrink-0 rounded-full transition-colors",
                isActive ? "bg-rubric" : "bg-transparent ring-1 ring-rule-strong",
              )}
            />
            <span
              className={cn(
                "font-display text-[15px] leading-none transition-colors",
                isActive ? "text-rubric" : "text-ink-soft",
              )}
            >
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface DayPillsProps {
  value: number[];
  onChange: (value: number[]) => void;
}

function DayPills({ value, onChange }: DayPillsProps) {
  const toggle = (dayIndex: number) => {
    const next = value.includes(dayIndex)
      ? value.filter((d) => d !== dayIndex)
      : [...value, dayIndex].sort((a, b) => a - b);
    onChange(next);
  };
  return (
    <div className="flex items-center justify-between gap-1">
      {FILTER_DAY_LABELS.map((day, dayIndex) => {
        const isActive = value.includes(dayIndex);
        return (
          <button
            key={day.full}
            type="button"
            aria-pressed={isActive}
            aria-label={day.full}
            onClick={() => toggle(dayIndex)}
            className="missal-focus group relative flex-1 py-2 text-center"
          >
            <span
              className={cn(
                "smallcaps block text-[14px] transition-colors",
                isActive
                  ? "text-rubric"
                  : "text-ink-soft group-hover:text-ink",
              )}
            >
              {day.abbr}
            </span>
            <span
              className="absolute inset-x-2 bottom-0 h-[1.5px] origin-left bg-rubric transition-transform duration-300 ease-[cubic-bezier(.22,1,.36,1)]"
              style={{ transform: isActive ? "scaleX(1)" : "scaleX(0)" }}
            />
          </button>
        );
      })}
    </div>
  );
}
