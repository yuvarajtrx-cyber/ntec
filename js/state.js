import { KPI_DEFAULT_SETTINGS } from "./constants.js";

// Shared mutable state that crosses page boundaries.
// Per-page state (CURRENT_PAGE for browse, PRODUCTS_PAGE, chart refs, modal selections)
// lives inside the owning page module instead.
export const state = {
  session: null,
  permissions: new Set(),
  rows: [],
  homeRange: "1y",
  kpiPeriod: "1y",
  kpiActive: "concentration",
  kpiSettings: JSON.parse(JSON.stringify(KPI_DEFAULT_SETTINGS)),
  // Server-side fetch scope. years[] is what /api/sales filters on (also
  // what gets ticked in the topbar checklist). availableYears comes back from
  // the server so the picker only offers years that actually have data.
  range: { years: [], availableYears: [] },
};
