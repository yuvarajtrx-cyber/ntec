// Server-side fetch scope. The user picks a preset; we send just the preset
// name to /api/sales and the server anchors it on max(voucher_date) so the
// default always lands on real data — even when the calendar month is empty.

export const RANGE_PRESETS = [
  { value: "month",     label: "Latest Month" },
  { value: "lastmonth", label: "Previous Month" },
  { value: "year",      label: "Latest Year" },
  { value: "lastyear",  label: "Previous Year" },
  { value: "all",       label: "All Time" },
];

export function rangeQueryString(range) {
  if (!range || !range.preset) return "";
  return `?preset=${encodeURIComponent(range.preset)}`;
}
