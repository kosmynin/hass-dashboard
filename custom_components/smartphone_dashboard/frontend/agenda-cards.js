import { selectParcels } from "./parcel-selection.js";

const WASTE_PLATFORM = "waste_collection_schedule";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const GERMAN_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const WASTE_DATE_METADATA = new Set([
  "date", "next_date", "start", "start_time", "end", "end_time", "last_update",
]);

function calendarDate(value) {
  if (typeof value !== "string") return null;
  const german = value.match(GERMAN_DATE);
  const iso = german
    ? `${german[3]}-${german[2].padStart(2, "0")}-${german[1].padStart(2, "0")}`
    : value;
  const date = new Date(DATE_ONLY.test(iso) ? `${iso}T00:00:00` : iso);
  if (!Number.isFinite(date.getTime())) return null;
  if (DATE_ONLY.test(iso) && Number(iso.slice(-2)) !== date.getDate()) return null;
  return date;
}

function eventDates(event) {
  const start = event.start?.dateTime ?? event.start?.date ?? event.start;
  const end = event.end?.dateTime ?? event.end?.date ?? event.end;
  return {
    start: calendarDate(start),
    end: calendarDate(end),
    allDay: event.all_day === true || DATE_ONLY.test(start),
  };
}

function parcelAgendaRows(states, config, events) {
  const parcels = selectParcels(states, config.entities, config.content_entities);
  const barcodeOf = ({ parcel }) => String(parcel.barcode ?? "").trim().toLowerCase();
  const byBarcode = new Map(parcels.filter(barcodeOf).map((entry) => [barcodeOf(entry), entry]));
  const covered = new Set();
  const rows = events.map((event) => {
    const dates = eventDates(event);
    const summary = String(event.summary ?? "").trim();
    const reportedBarcode = String(event.description ?? "").match(/^Barcode:\s*(.+)$/im)?.[1].trim().toLowerCase();
    const barcode = reportedBarcode || summary.split(/[^a-z0-9-]+/i)
      .map((part) => part.toLowerCase()).find((part) => byBarcode.has(part));
    const match = byBarcode.get(barcode);
    if (barcode && dates.start) covered.add(barcode);
    const fallbackLabel = summary.replace(/^[^:]+:\s*/, "");
    const trackingOnly = (barcode && fallbackLabel.toLowerCase().includes(barcode)) ||
      /^(?:(?:parcel|paket|sendung|tracking)\s*#?\s*)?[a-z]*\d[a-z0-9-]*$/i.test(fallbackLabel);
    const carrier = summary.includes(":") ? summary.split(":")[0].trim() : "";
    const title = match?.label || (trackingOnly ? carrier || "Paket" : summary || "Paket");
    return { ...dates, title, identity: barcode };
  });
  for (const entry of parcels) {
    const { parcel, label } = entry;
    const identity = barcodeOf(entry);
    if (covered.has(identity)) continue;
    rows.push({
      start: calendarDate(parcel.planned_from || parcel.planned_to),
      end: parcel.planned_from ? calendarDate(parcel.planned_to) : null,
      allDay: DATE_ONLY.test(parcel.planned_from || parcel.planned_to),
      title: label,
      identity,
    });
  }
  return rows;
}

function wasteSensorRows(states, entities, today) {
  const rows = [];
  const add = (value, types) => {
    const start = calendarDate(value);
    const title = Array.isArray(types) ? types.filter(Boolean).join(", ") : types;
    if (start && typeof title === "string" && title.trim()) {
      rows.push({ start, title: title.trim(), allDay: true });
    }
  };
  for (const entity of entities) {
    const state = states[entity];
    if (!state || state.state === "unavailable") continue;
    const attrs = state.attributes ?? {};
    const count = rows.length;
    for (const [key, value] of Object.entries(attrs)) {
      if (DATE_ONLY.test(key) || GERMAN_DATE.test(key)) add(key, value);
      else if (!WASTE_DATE_METADATA.has(key) && (DATE_ONLY.test(value) || GERMAN_DATE.test(value))) add(value, key);
    }
    for (const entry of Array.isArray(attrs.upcoming) ? attrs.upcoming : []) {
      add(entry?.date, entry?.types ?? entry?.type);
    }
    const title = attrs.waste_type ?? attrs.type ??
      (/^(?:\d+|unknown)$/.test(state.state) ? attrs.friendly_name : state.state);
    const date = attrs.next_date ?? attrs.date ?? attrs.start ?? attrs.start_time;
    if (date) add(date, title);
    const days = attrs.daysTo ?? attrs.days_to;
    if (rows.length === count && days != null && Number.isInteger(Number(days))) {
      const start = new Date(today);
      start.setDate(start.getDate() + Number(days));
      if (typeof title === "string" && title.trim()) rows.push({ start, title: title.trim(), allDay: true });
    }
  }
  return rows;
}

function agendaRows(config, states, events, today, end) {
  const rows = config.kind === "parcel"
    ? parcelAgendaRows(states, config, events)
    : events.map((event) => ({ ...eventDates(event), title: String(event.summary ?? "").trim() }));
  const upcoming = (entries) => entries
    .filter((row) => row.title && row.start && row.start < end && (row.start >= today || row.end > today))
    .sort((left, right) => left.start - right.start || left.title.localeCompare(right.title, "de"));
  const sorted = upcoming(rows);
  if (!sorted.length && config.kind === "waste") sorted.push(...upcoming(wasteSensorRows(states, config.entities, today)));
  const keys = new Set();
  return sorted.filter((row) => {
    const key = `${row.start.getTime()}|${row.identity || row.title.toLocaleLowerCase("de-DE")}`;
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  }).slice(0, config.kind === "waste" ? 6 : 8);
}

async function loadCalendarEvents(hass, config, start, end) {
  let ids = config.calendars;
  if (!ids.length && config.kind === "waste" && config.calendar_candidates.length && hass.callWS) {
    try {
      const entries = await hass.callWS({
        type: "config/entity_registry/get_entries",
        entity_ids: config.calendar_candidates,
      });
      ids = config.calendar_candidates.filter((id) =>
        entries?.[id]?.platform === WASTE_PLATFORM && !entries[id].hidden_by && !entries[id].disabled_by,
      );
    } catch {
      // Sensor attributes remain available when registry access fails.
    }
  }
  if (!hass.callApi || !ids.length) return [];
  const range = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
  const results = await Promise.allSettled(ids.map((id) => hass.callApi("GET", `calendars/${id}?${range}`)));
  return results.flatMap((result) => result.status === "fulfilled" && Array.isArray(result.value) ? result.value : []);
}

const DATE_FORMAT = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
const TIME_FORMAT = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });

class SmartphoneDashboardAgenda extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; min-inline-size: 0; }
        ha-card { padding: 12px; border-radius: var(--ha-card-border-radius, 16px); }
        h3 { font-size: 14px; margin: 0 0 8px; }
        ul { padding: 0; margin: 0; list-style: none; }
        li { display: grid; grid-template-columns: 5.5em minmax(0, 1fr); align-items: start; gap: 10px; padding: 8px 0; }
        li + li { border-top: 1px solid var(--divider-color); }
        .date { color: var(--secondary-text-color); font-size: 13px; }
        .title { color: var(--primary-text-color); font-weight: 600; overflow-wrap: anywhere; }
        p { color: var(--secondary-text-color); margin: 0; }
        p:empty { display: none; }
      </style>
      <ha-card><h3></h3><p role="status"></p><ul></ul></ha-card>`;
  }

  setConfig(config) {
    this._config = config;
    this._tracked = [...new Set([...config.entities, ...(config.content_entities ?? [])])];
    this._request = undefined;
    this._events = undefined;
    this._update();
  }

  set hass(value) {
    const previous = this._hass;
    this._hass = value;
    if (!previous || this._tracked?.some((id) => previous.states?.[id] !== value?.states?.[id])) this._update();
  }

  connectedCallback() {
    this._update();
  }

  disconnectedCallback() {
    this._request = undefined;
    this._events = undefined;
  }

  getCardSize() {
    return 3;
  }

  _update() {
    const config = this._config;
    if (!this.isConnected || !config || !this._hass) return;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + (config.kind === "waste" ? 45 : 30));
    if (!this._request) {
      const request = loadCalendarEvents(this._hass, config, start, end).catch(() => []);
      this._request = request;
      void request.then((events) => {
        if (this._request !== request) return;
        this._events = events;
        this._update();
      });
    }
    const rows = agendaRows(config, this._hass.states ?? {}, this._events ?? [], start, end);
    this.shadowRoot.querySelector("h3").textContent = config.kind === "waste" ? "Abholtermine" : "Liefertermine";
    this.shadowRoot.querySelector("p").textContent = rows.length ? "" : this._events === undefined
      ? "Termine werden geladen …" : "Keine kommenden Termine verfügbar";
    this.shadowRoot.querySelector("ul").replaceChildren(...rows.map((row) => {
      const item = document.createElement("li");
      const date = document.createElement("div");
      date.className = "date";
      date.textContent = DATE_FORMAT.format(row.start);
      if (!row.allDay) {
        const time = document.createElement("div");
        time.textContent = TIME_FORMAT.format(row.start) + (row.end > row.start ? `–${TIME_FORMAT.format(row.end)}` : "");
        date.append(time);
      }
      const title = document.createElement("div");
      title.className = "title";
      title.textContent = row.title;
      item.append(date, title);
      return item;
    }));
    this.dispatchEvent(new Event("iron-resize", { bubbles: true, composed: true }));
  }
}

export { SmartphoneDashboardAgenda, agendaRows, loadCalendarEvents };
