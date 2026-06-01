// Server-side fetch scope by year. The user ticks one or more years in the
// topbar checklist; we send them as ?years=2024,2025 and the server filters
// at the SQL level so the payload only contains those years.

export function yearsQueryString(years) {
  if (!Array.isArray(years) || years.length === 0) return "";
  return `?years=${years.join(",")}`;
}

export function formatYearsLabel(years) {
  if (!Array.isArray(years) || years.length === 0) return "No years";
  const sorted = [...years].sort((a, b) => a - b);
  if (sorted.length === 1) return String(sorted[0]);
  // Detect contiguous run for a compact "2022–2026" style label.
  const contiguous = sorted.every((y, i) => i === 0 || y === sorted[i - 1] + 1);
  if (contiguous) return `${sorted[0]}–${sorted[sorted.length - 1]}`;
  return sorted.join(", ");
}
