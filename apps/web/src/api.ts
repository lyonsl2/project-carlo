import type { ChurchDetail, ChurchMapItem, EventSummary, EventType } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

function buildTypesParam(types: EventType[]): string | null {
  if (types.length === 0) {
    return null;
  }
  return types.join(",");
}

export async function fetchChurches(types: EventType[]): Promise<ChurchMapItem[]> {
  const url = new URL("/churches", API_BASE);
  const typeValue = buildTypesParam(types);
  if (typeValue) {
    url.searchParams.set("types", typeValue);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed loading churches");
  }
  return (await response.json()) as ChurchMapItem[];
}

export async function fetchChurch(churchId: number): Promise<ChurchDetail> {
  const response = await fetch(new URL(`/churches/${churchId}`, API_BASE));
  if (!response.ok) {
    throw new Error("Failed loading church");
  }
  return (await response.json()) as ChurchDetail;
}

export async function fetchChurchEvents(
  churchId: number,
  types: EventType[],
): Promise<EventSummary[]> {
  const url = new URL(`/churches/${churchId}/events`, API_BASE);
  const typeValue = buildTypesParam(types);
  if (typeValue) {
    url.searchParams.set("types", typeValue);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed loading church events");
  }
  return (await response.json()) as EventSummary[];
}
