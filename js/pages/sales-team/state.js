// Per-page state. Lives in this module (not global state) since nothing else needs it.
export const ST = {
  view: "l0",
  selection: { person: null, customer: null },
  filters: {
    saleGroup: "",             // "" | "domestic" | "export" | "other"
    material: "",              // "" | "fg" | "rm"
    month: "",                 // "" | "YYYY-MM"
    dateFrom: "",
    dateTo: "",
    q: "",
  },
};

export const UNASSIGNED = "Unassigned";

export const CHART_PALETTE = [
  "#2563eb", "#16a34a", "#f59e0b", "#dc2626",
  "#7c3aed", "#0891b2", "#db2777", "#4b5563",
];

export function resetFilters() {
  ST.filters = { saleGroup: "", material: "", month: "", dateFrom: "", dateTo: "", q: "" };
}

export function resetView() {
  ST.view = "l0";
  ST.selection = { person: null, customer: null };
}
