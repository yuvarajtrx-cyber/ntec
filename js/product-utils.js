export function normalizeProductName(name) {
  if (!name) return "";
  return String(name)
    // Collapse "Seal king" / "Seal King" / "SEAL KING" / "Seal-King" → "Sealking"
    .replace(/\bseal[\s\-]+king\b/gi, "Sealking")
    // Standalone "Sealking" / "SEALKING" → "Sealking" (consistent case)
    .replace(/\bsealking\b/gi, "Sealking")
    // Collapse runs of whitespace (including non-breaking spaces) and trim
    .replace(/[\s ]+/g, " ")
    .trim();
}

// Case- and whitespace-insensitive key. Two raw names that differ ONLY in
// spacing or capitalization will produce the same key and therefore group
// together — preventing duplicate rows from showing up in the Products tab.
export function productKey(name) {
  return normalizeProductName(name).toLowerCase();
}

export function flattenLineItems(rows) {
  const out = [];
  rows.forEach(r => {
    const items = Array.isArray(r.line_items) ? r.line_items : [];
    items.forEach(li => {
      if (!li || !li.particulars) return;
      const display = normalizeProductName(li.particulars);
      out.push({
        product: display,
        productKey: display.toLowerCase(),
        quantity: Number(li.quantity) || 0,
        rate: Number(li.rate) || 0,
        value: Number(li.value) || 0,
        voucher_no: r.voucher_no,
        voucher_date: r.voucher_date,
        customer: r.particulars,
        category: r.category,
        month: (r.voucher_date || "").slice(0, 7),
      });
    });
  });
  return out;
}
