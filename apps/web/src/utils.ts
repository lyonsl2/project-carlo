/** Format minutes since midnight to "h:MM AM/PM" display string. */
export function formatMinutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `12:${m.toString().padStart(2, "0")} AM`;
  if (h === 12) return `12:${m.toString().padStart(2, "0")} PM`;
  if (h < 12) return `${h}:${m.toString().padStart(2, "0")} AM`;
  return `${h - 12}:${m.toString().padStart(2, "0")} PM`;
}

/** Capitalize the first letter of a string. */
export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Format YYYY-MM-DD to "Tuesday, March 17th" style. */
export function formatEventDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const month = d.toLocaleDateString("en-US", { month: "long" });
  const day = d.getDate();
  const suffix =
    day >= 11 && day <= 13
      ? "th"
      : { 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th";
  return `${weekday}, ${month} ${day}${suffix}`;
}

/** Format structured address fields into a single display string. */
export function formatAddress(church: {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
}): string | null {
  const parts: string[] = [];
  if (church.address_line1) parts.push(church.address_line1);
  if (church.address_line2) parts.push(church.address_line2);
  const stateZip = [church.state, church.postal_code].filter(Boolean).join(" ");
  const cityStateZip = [church.city, stateZip].filter(Boolean).join(", ");
  if (cityStateZip) parts.push(cityStateZip);
  return parts.length > 0 ? parts.join(", ") : null;
}
