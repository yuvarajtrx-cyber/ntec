export const SALE_TYPE_GROUPS = {
  "__sale_group_domestic__": {
    label: "Domestic",
    matches: value => String(value || "").toLowerCase().startsWith("domestic"),
  },
  "__sale_group_export__": {
    label: "Export",
    matches: value => String(value || "").toLowerCase().startsWith("export"),
  },
};

export function saleTypeMatches(category, selected) {
  if (!selected) return true;
  const group = SALE_TYPE_GROUPS[selected];
  if (group) return group.matches(category);
  return category === selected;
}

export function saleTypeOptions(categories) {
  const unique = [...new Set(categories.filter(Boolean))].sort();
  const options = [];
  if (unique.some(SALE_TYPE_GROUPS.__sale_group_domestic__.matches)) {
    options.push(["__sale_group_domestic__", "Domestic"]);
  }
  if (unique.some(SALE_TYPE_GROUPS.__sale_group_export__.matches)) {
    options.push(["__sale_group_export__", "Export"]);
  }
  unique.forEach(v => options.push([v, v]));
  return options;
}
