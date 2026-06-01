// Server-side fetch scope. The user picks a preset in the topbar selector;
// we resolve it to a (from, to) pair of ISO dates and send those to /api/sales
// so the server only ships the rows in that window.

export const RANGE_PRESETS = [
  { value: "month",     label: "This Month" },
  { value: "lastmonth", label: "Last Month" },
  { value: "year",      label: "This Year" },
  { value: "lastyear",  label: "Last Year" },
  { value: "all",       label: "All Time" },
];

function iso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function resolveRange(preset, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case "lastmonth": {
      const from = new Date(y, m - 1, 1);
      const to = new Date(y, m, 0);
      return { from: iso(from), to: iso(to) };
    }
    case "year": {
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    case "lastyear": {
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    }
    case "all": {
      return { from: null, to: null };
    }
    case "month":
    default: {
      const from = new Date(y, m, 1);
      const to = new Date(y, m + 1, 0);
      return { from: iso(from), to: iso(to) };
    }
  }
}

export function rangeQueryString({ from, to }) {
  const parts = [];
  if (from) parts.push(`from=${encodeURIComponent(from)}`);
  if (to) parts.push(`to=${encodeURIComponent(to)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}
