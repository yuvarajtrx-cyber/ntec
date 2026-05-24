export function normalizeLocationValue(value) {
  const key = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const aliases = {
    alappakam: "alapakkam",
    pallaram: "pallavaram",
    pallavram: "pallavaram",
    tirpur: "tirupur",
    tiruppur: "tirupur",
    tirupr: "tirupur",
    tirurpur: "tirupur",
    tiupur: "tirupur",
    triupur: "tirupur",
  };
  return aliases[key] || key;
}

export function locationLabel(value) {
  const normalized = normalizeLocationValue(value);
  const s = normalized || String(value || "").trim().replace(/\s+/g, " ");
  return s ? s.replace(/\w\S*/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()) : "";
}

export function uniqueLocations(rows) {
  const locations = new Map();
  rows.map(r => r.location).filter(Boolean).forEach(v => {
    const key = normalizeLocationValue(v);
    if (key && !locations.has(key)) locations.set(key, locationLabel(v));
  });
  return [...locations.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}
