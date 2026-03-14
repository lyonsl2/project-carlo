/** Capitalize the first letter of a string. */
export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
