// Button Card evaluates the view in its own scope.
function selectParcels(states, entityIds, contentEntityIds) {
  const designs = {
    registered: { label: "Registriert", step: 1, icon: "mdi:package-variant-closed", color: "#0A84FF" },
    in_transit: { label: "Unterwegs", step: 2, icon: "mdi:truck-fast", color: "#0A84FF" },
    out_for_delivery: { label: "In Zustellung", step: 3, icon: "mdi:truck-delivery", color: "var(--success-color)" },
    at_pickup_point: { label: "Abholbereit", step: 4, icon: "mdi:package-variant", color: "#FF9F0A" },
    returning: { label: "Rücksendung", step: 2, icon: "mdi:package-variant-remove", color: "var(--error-color)" },
    problem: { label: "Problem", step: 2, icon: "mdi:alert-circle-outline", color: "var(--error-color)" },
    unknown: { label: "Status unbekannt", step: 1, icon: "mdi:package-variant-closed", color: "#8E8E93" },
  };
  const parcelsFrom = (ids) => ids.flatMap((id) => {
    const state = states[id];
    const parcels = state?.attributes?.parcels;
    return ["unavailable", "unknown"].includes(state?.state) || !Array.isArray(parcels) ? [] : parcels;
  });
  const clean = (value) => {
    let text = typeof value === "string" ? value.replace(/\u200b/g, " ").replace(/\s+/g, " ").trim() : "";
    const placeholder = text.match(/\(\s*(?:not\s+sel(?:ected)?|not\s+set|none|null|unknown|n\/?a)\b/i);
    if (placeholder) text = text.slice(0, placeholder.index);
    else if ((text.match(/\(/g) || []).length > (text.match(/\)/g) || []).length) text = text.slice(0, text.lastIndexOf("("));
    text = text.replace(/^[\s\-–—·,:;()]+|[\s\-–—·,:;()]+$/g, "");
    return /^(?:none|null|unknown|unbekannt|not set|not selected|n\/?a)$/i.test(text) ? "" : text;
  };
  const contentLabel = (parcel) => {
    for (const candidate of [parcel.content_title, parcel.contents, parcel.items, parcel.raw?.items]) {
      const items = new Map();
      for (const item of Array.isArray(candidate) ? candidate : [candidate]) {
        const label = clean(item) || clean(item?.title) || clean(item?.name);
        if (label && !items.has(label.toLowerCase())) items.set(label.toLowerCase(), label);
      }
      if (items.size) {
        const first = items.values().next().value;
        return items.size > 1 ? first + " + " + (items.size - 1) + " weitere" : first;
      }
    }
    return "";
  };
  const statusOf = (parcel) => String(parcel.status || "unknown").trim().toLowerCase();
  const rank = (parcel) => {
    const status = statusOf(parcel);
    const immediate = { at_pickup_point: 0, out_for_delivery: 1, problem: 2 };
    if (Object.hasOwn(immediate, status)) return immediate[status];
    if (parcel.planned_from || parcel.planned_to) return 3;
    const later = { in_transit: 4, returning: 5, registered: 6 };
    return Object.hasOwn(later, status) ? later[status] : 7;
  };
  const time = (parcel) => {
    for (const value of [parcel.planned_from, parcel.planned_to]) {
      const timestamp = Date.parse(value || "");
      if (Number.isFinite(timestamp)) return timestamp;
    }
    return Number.MAX_SAFE_INTEGER;
  };
  const identity = (parcel) => [parcel.carrier, parcel.barcode, parcel.sender].join("\0").toLowerCase();
  const compare = (a, b) => rank(a) - rank(b) || time(a) - time(b) ||
    (identity(a) < identity(b) ? -1 : Number(identity(a) > identity(b)));
  const parcels = parcelsFrom(entityIds)
    .filter((item) => item && item.delivered !== true && statusOf(item) !== "delivered")
    .sort(compare);
  const contents = new Map();
  for (const candidate of parcelsFrom(contentEntityIds)) {
    if (!candidate) continue;
    const barcode = String(candidate.barcode || "").trim();
    if (!barcode || contents.has(barcode)) continue;
    const label = contentLabel(candidate);
    if (label) contents.set(barcode, label);
  }
  const unique = new Map();
  for (const parcel of parcels) {
    const barcode = String(parcel.barcode || "").trim();
    const key = barcode || identity(parcel) + String(parcel.planned_from || "");
    const preferred = unique.get(key);
    unique.set(key, preferred ? {
      ...preferred,
      sender: clean(preferred.sender) || parcel.sender,
      url: preferred.url || parcel.url,
    } : parcel);
  }
  return [...unique.values()].map((parcel) => {
    const barcode = String(parcel.barcode || "").trim();
    const status = statusOf(parcel);
    const carrier = clean(parcel.carrier);
    return {
      parcel, status, carrier,
      label: contentLabel(parcel) || contents.get(barcode) || clean(parcel.sender) || carrier || "Paket",
      design: Object.hasOwn(designs, status) ? designs[status] : designs.unknown,
    };
  });
}

export { selectParcels };
