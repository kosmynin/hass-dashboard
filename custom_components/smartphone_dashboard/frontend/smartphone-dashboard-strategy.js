/**
 * Smartphone-Dashboard-Strategie für Home Assistant
 *
 * Wird vom Integrations-Loader aus demselben versionsabhängigen Pfad geladen.
 */

const STRATEGY_TYPE = "smartphone-dashboard";
const STRATEGY_ELEMENT = `ll-strategy-dashboard-${STRATEGY_TYPE}`;
const LEGACY_STRATEGY_ELEMENT = `ll-strategy-${STRATEGY_TYPE}`;
const STRATEGY_VERSION = "22.0.16";
const CONFIG_VERSION = 22;

const ACTIVE_ROOM_STYLES = `
  ha-card, .bubble-button-card-container, .bubble-name-container,
  .bubble-main-icon-container, .bubble-icon-container {
    opacity: 1 !important;
    filter: none !important;
  }
  .bubble-name, .bubble-icon {
    color: var(--primary-text-color) !important;
    opacity: 1 !important;
  }
`;

const UPS_NON_ALERT_STATES = [
  "ONLINE", "Online", "online", "ON", "On", "on", "OK", "Ok", "ok",
  "NORMAL", "Normal", "normal", "OL", "ol", "Connected", "connected",
  "AVAILABLE", "Available", "available", "MAINS", "Mains", "mains",
  "LINE", "Line", "line", "UNKNOWN", "Unknown", "unknown",
  "UNAVAILABLE", "Unavailable", "unavailable", "NONE", "None", "none", "",
];
const UPS_PROBLEM_DEVICE_CLASSES = new Set([
  "problem", "safety", "smoke", "tamper", "moisture",
]);
let cachedDisplayNotificationConfig;
const NOTIFICATION_POPUPS = {
  batteries: ["#meldung-batterien", "Batterien", "mdi:battery-alert"],
  contacts: ["#meldung-kontakte", "Offene Kontakte", "mdi:door-open"],
  co2: ["#meldung-co2", "CO₂", "mdi:molecule-co2"],
  waste: ["#meldung-abfall", "Abfall", "mdi:trash-can-outline"],
  ups: ["#meldung-usv", "USV", "mdi:power-plug-battery"],
  frost: ["#meldung-frost", "Frost", "mdi:snowflake-alert"],
  nina: ["#meldung-nina", "NINA-Warnungen", "mdi:alert-outline"],
};
const NINA_SUMMARY_STYLES = `\${(() => {
  const entityId = typeof entity === 'string' ? entity : entity?.entity_id;
  const warning = hass.states[entityId];
  const headline = warning?.attributes?.headline || warning?.attributes?.friendly_name || 'NINA-Warnung';
  const description = warning?.attributes?.description || warning?.attributes?.instruction || 'Amtliche Warnung aktiv';
  const name = card.querySelector('.bubble-name');
  const state = card.querySelector('.bubble-state');
  const icon = card.querySelector('.bubble-icon');
  if (name) name.innerText = headline;
  if (state) state.innerText = description;
  if (icon) icon.style.setProperty('color', 'var(--error-color)', 'important');
})()}`;
const WASTE_SUMMARY_STYLES = `\${(() => {
  const entityId = typeof entity === 'string' ? entity : entity?.entity_id;
  const waste = hass.states[entityId];
  const attributes = waste?.attributes || {};
  const stateText = String(waste?.state || '').trim();
  const parseDate = (value) => {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    const text = String(value).trim();
    let match = text.match(/^(\\d{4})-(\\d{2})-(\\d{2})/);
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    match = text.match(/(?:^|\\D)(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})(?:\\D|$)/);
    if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const typeText = (value) => {
    const values = Array.isArray(value) ? value : value == null ? [] : [value];
    return values.map((item) => String(item).trim()).filter(Boolean).join(', ');
  };
  const dated = Object.entries(attributes).flatMap(([key, value]) => {
    if (['attribution', 'last_update', 'daysTo', 'days_to', 'icon'].includes(key)) return [];
    const keyDate = parseDate(key);
    if (keyDate) return [{ date: keyDate, types: typeText(value) }];
    const valueDate = parseDate(value);
    return valueDate ? [{ date: valueDate, types: key }] : [];
  }).sort((left, right) => left.date - right.date);
  const upcoming = Array.isArray(attributes.upcoming) ? attributes.upcoming[0] : null;
  const pickupDate = parseDate(upcoming?.date || attributes.date || attributes.next_date || attributes.start || attributes.start_time) || dated[0]?.date || null;
  let types = typeText(upcoming?.types || dated[0]?.types || attributes.type || attributes.waste_type || attributes.summary || attributes.subject || attributes.types);
  if (!types && !/^-?\\d+(?:\\.\\d+)?$/.test(stateText)) {
    types = stateText
      .replace(/\\s+in\\s+-?\\d+\\s+(?:days?|tag(?:e|en)?)(?:\\s.*)?$/i, '')
      .replace(/(?:^|\\s)(?:heute|morgen|today|tomorrow)(?:\\s|$)/ig, ' ')
      .trim();
  }
  if (!types) {
    types = String(attributes.friendly_name || 'Abfall')
      .replace(/^Waste Collection Schedule\\s*/i, '')
      .trim() || 'Abfall';
  }
  let days = Number(upcoming?.daysTo ?? attributes.daysTo ?? attributes.days_to);
  if (!Number.isFinite(days)) {
    const match = stateText.match(/\\bin\\s+(-?\\d+)\\s+(?:days?|tag(?:e|en)?)\\b/i);
    if (match) days = Number(match[1]);
    else if (/^-?\\d+$/.test(stateText)) days = Number(stateText);
    else if (/\\b(?:heute|today)\\b/i.test(stateText)) days = 0;
    else if (/\\b(?:morgen|tomorrow)\\b/i.test(stateText)) days = 1;
  }
  let dateLabel = '';
  if (pickupDate) {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const target = new Date(pickupDate.getFullYear(), pickupDate.getMonth(), pickupDate.getDate());
    const difference = Math.round((target - start) / 86400000);
    const formatted = target.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    dateLabel = difference === 0 ? 'heute · ' + formatted : difference === 1 ? 'morgen · ' + formatted : target.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
  } else if (Number.isFinite(days)) {
    dateLabel = days === 0 ? 'heute' : days === 1 ? 'morgen' : 'in ' + days + ' Tagen';
  } else if (stateText && !['unknown', 'unavailable'].includes(stateText.toLowerCase())) {
    dateLabel = stateText;
  }
  const name = card.querySelector('.bubble-name');
  const state = card.querySelector('.bubble-state');
  const icon = card.querySelector('.bubble-icon');
  const normalizedTypes = types.toLowerCase();
  const iconColor = /gelb|wertstoff|verpack/.test(normalizedTypes)
    ? '#FFD700'
    : /rest|grau/.test(normalizedTypes)
      ? '#4A4A4A'
      : /papier|pappe|blau/.test(normalizedTypes)
        ? '#4169E1'
        : /bio|braun|organisch/.test(normalizedTypes)
          ? '#8B4513'
          : 'var(--primary-text-color)';
  if (name) name.innerText = types;
  if (state) state.innerText = dateLabel ? 'Nächster Termin: ' + dateLabel : 'Kein Termin verfügbar';
  if (icon) icon.style.setProperty('color', iconColor, 'important');
})()}`;
const NOTIFICATION_HELPERS = {
  notification_batteries: "input_boolean.smartphone_meldung_batterien",
  notification_contacts: "input_boolean.smartphone_meldung_kontakte",
  notification_co2: "input_boolean.smartphone_meldung_co2",
  notification_waste: "input_boolean.smartphone_meldung_abfall",
  notification_ups: "input_boolean.smartphone_meldung_usv",
  notification_frost: "input_boolean.smartphone_meldung_frost",
  notification_nina: "input_boolean.smartphone_meldung_nina",
  battery_threshold: "input_number.smartphone_batterie_grenzwert",
  contact_minutes: "input_number.smartphone_kontakt_minuten",
  co2_threshold: "input_number.smartphone_co2_grenzwert",
  frost_threshold: "input_number.smartphone_frost_grenzwert",
  notification_recipients: "input_text.smartphone_benachrichtigung_empfaenger",
  battery_exclusions: "input_text.smartphone_batterie_ausnahmen",
  frost_entity: "input_text.smartphone_frost_sensor",
  waste_entities: "input_text.smartphone_abfall_sensoren",
  ups_entities: "input_text.smartphone_usv_sensoren",
  nina_entities: "input_text.smartphone_nina_muster",
};
const BACKEND_NOTIFICATION_KEYS = [...Object.keys(NOTIFICATION_HELPERS), "waste_days"];

// Sofort registrieren: Home Assistant wartet maximal fünf Sekunden auf das
// Strategy-Element. Die Funktionsdeklarationen darunter werden beim Aufruf
// bereits verfügbar sein; generate() läuft erst nach Abschluss des Moduls.
class SmartphoneDashboardStrategy extends HTMLElement {
  static async getConfigElement() {
    await customElements.whenDefined("smartphone-dashboard-strategy-editor");
    return document.createElement("smartphone-dashboard-strategy-editor");
  }

  static getCreateSuggestions(_hass) {
    return {
      title: "Handy",
      icon: "mdi:cellphone",
    };
  }

  static async generate(config, hass) {
    const explicitConfig = config && typeof config === "object" ? config : {};
    if (typeof hass?.callWS === "function") {
      const dashboardKey = "default";
      let timeoutId;
      try {
        const backend = await Promise.race([
          hass.callWS({ type: "smartphone_dashboard/config/display", dashboard_key: dashboardKey }),
          new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error("Backend-Zeitlimit")), 1500); }),
        ]);
        cachedDisplayNotificationConfig = backend?.config || {};
        config = mergeBackendNotifications(explicitConfig, backend?.config);
      } catch (_error) {
        config = mergeBackendNotifications(explicitConfig, cachedDisplayNotificationConfig);
      } finally {
        clearTimeout(timeoutId);
      }
    }
    config = migrateConfig(config, hass);
    const dashboard = structuredClone(BASE_DASHBOARD);
    const view = dashboard.views?.[0];

    dashboard.title = config.title || dashboard.title || "Handy";

    if (view) {
      view.title = config.view_title || view.title || "Handy";
      view.icon = config.view_icon || view.icon || "mdi:cellphone";
    }

    let generated = applyPersonOptions(dashboard, config, hass);
    generated = applyNotificationOptions(generated, config, hass);
    generated = applyQuickActionOptions(generated, config, hass);
    generated = applyRoomOptions(generated, config, hass);
    generated = applyDashboardOptions(generated, config);
    generated = applyDynamicFeatures(generated, config, hass);
    generated = applyHomeSectionOrder(generated, config);
    return applyEntityOverrides(
      generated,
      config.entity_overrides && typeof config.entity_overrides === "object"
        ? { "binary_sensor.nina_warning_*": normalizeNinaGlob(notificationSetting(config, hass, "nina_entities")), ...config.entity_overrides }
        : { "binary_sensor.nina_warning_*": normalizeNinaGlob(notificationSetting(config, hass, "nina_entities")) },
    );
  }
}

function resolveBackendKey(config) {
  return String(config?.backend_key || globalThis.location?.pathname || "default").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 128) || "default";
}

function mergeBackendNotifications(explicitConfig, backendConfig) {
  const merged = { ...(explicitConfig || {}) };
  for (const key of BACKEND_NOTIFICATION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(merged, key) && Object.prototype.hasOwnProperty.call(backendConfig || {}, key)) merged[key] = backendConfig[key];
  }
  return merged;
}

if (!customElements.get(STRATEGY_ELEMENT)) {
  customElements.define(STRATEGY_ELEMENT, SmartphoneDashboardStrategy);
}

if (!customElements.get(LEGACY_STRATEGY_ELEMENT)) {
  customElements.define(
    LEGACY_STRATEGY_ELEMENT,
    class SmartphoneDashboardLegacyStrategy extends SmartphoneDashboardStrategy {},
  );
}

const BASE_DASHBOARD = {
  title: "Smartphone Dashboard",
  views: [{
    title: "Handy", path: "handy", icon: "mdi:cellphone",
    type: "sections", max_columns: 1, dense_section_placement: true,
    sections: [{ type: "grid", cards: [
      { type: "heading", heading: "Personen", icon: "mdi:account-group-outline" },
      { type: "horizontal-stack", cards: [] },
      { type: "heading", heading: "Meldungen", icon: "mdi:bell-badge-outline" },
      { type: "custom:auto-entities", unique: true, show_empty: false, card: { type: "vertical-stack" }, card_param: "cards", filter: { include: [
        { entity_id: "sensor.*battery", options: { type: "custom:bubble-card", card_type: "button" } },
        { entity_id: "sensor.*batterie", options: { type: "custom:bubble-card", card_type: "button" } },
        { domain: "sensor", attributes: { device_class: "battery" }, options: { type: "custom:bubble-card", card_type: "button" } },
        { entity_id: "binary_sensor.*contact", options: { type: "custom:bubble-card", card_type: "button" } },
        { entity_id: "binary_sensor.*kontakt", options: { type: "custom:bubble-card", card_type: "button" } },
        { domain: "binary_sensor", attributes: { device_class: "door" }, options: { type: "custom:bubble-card", card_type: "button" } },
        { domain: "binary_sensor", attributes: { device_class: "window" }, options: { type: "custom:bubble-card", card_type: "button" } },
        { domain: "binary_sensor", attributes: { device_class: "opening" }, options: { type: "custom:bubble-card", card_type: "button" } },
        { entity_id: "sensor.*kohlendioxid", options: { type: "custom:bubble-card", card_type: "button" } },
        { entity_id: "sensor.*co2*", options: { type: "custom:bubble-card", card_type: "button" } },
        { domain: "sensor", attributes: { device_class: "carbon_dioxide" }, options: { type: "custom:bubble-card", card_type: "button" } },
        { entity_id: "sensor.*abfall", options: { type: "custom:bubble-card", card_type: "button" } },
        { entity_id: "sensor.*ups_status", options: { type: "custom:bubble-card", card_type: "button" } },
        { entity_id: "sensor.*temperature", options: { type: "custom:bubble-card", card_type: "button" } },
        { entity_id: "binary_sensor.nina_warning_*", state: "on", options: {
          type: "custom:bubble-card", card_type: "button", button_type: "state",
          icon: "mdi:alert-outline", show_state: false, show_attribute: true,
          styles: NINA_SUMMARY_STYLES,
        } }
      ], exclude: [] },
      else: {
        type: "custom:bubble-card",
        card_type: "button",
        button_type: "name",
        name: "Keine Meldungen",
        icon: "mdi:bell-off-outline",
      } },
      { type: "heading", heading: "Aktionen", icon: "mdi:gesture-tap" },
      { type: "grid", columns: 2, square: false, cards: [] },
      { type: "custom:bubble-card", card_type: "separator", name: "Räume", icon: "mdi:floor-plan" },
      { type: "grid", columns: 2, square: false, cards: [] },
      { type: "custom:bubble-card", card_type: "separator", name: "Weitere Bereiche", icon: "mdi:view-grid-plus-outline" },
      { type: "grid", columns: 2, square: false, cards: [] }
    ] }]
  }]
};

/**
 * Ersetzt Entity-IDs ausschließlich bei exakten String-Treffern.
 * Dadurch bleiben JavaScript-Templates und CSS unverändert.
 */
function applyEntityOverrides(value, overrides) {
  if (typeof value === "string") {
    return Object.prototype.hasOwnProperty.call(overrides, value)
      ? overrides[value]
      : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => applyEntityOverrides(item, overrides));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        applyEntityOverrides(item, overrides),
      ]),
    );
  }

  return value;
}

function valuesOf(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function entityRegistryEntries(hass) {
  const entities = hass?.entities;
  if (Array.isArray(entities)) return entities.filter((entry) => entry?.entity_id);
  if (!entities || typeof entities !== "object") return [];
  return Object.entries(entities)
    .filter(([, entry]) => entry && typeof entry === "object")
    .map(([entityId, entry]) => ({
      ...entry,
      entity_id: entry.entity_id || entityId,
    }))
    .filter((entry) => entry.entity_id);
}

function entityRegistryMap(hass) {
  return new Map(
    entityRegistryEntries(hass)
      .map((entry) => [entry.entity_id, entry]),
  );
}

function isEntityVisible(hass, entityId, registry = entityRegistryMap(hass)) {
  const state = hass?.states?.[entityId];
  if (!state) return false;
  const entry = registry.get(entityId);
  return entry?.hidden !== true && !entry?.hidden_by && !entry?.disabled_by &&
    state.attributes?.hidden !== true;
}

function hiddenDashboardEntityIds(hass) {
  const registry = entityRegistryMap(hass);
  return Object.keys(hass?.states || {}).filter(
    (entityId) => !isEntityVisible(hass, entityId, registry),
  );
}

function normalizeRoomKey(value) {
  return String(value || "")
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function entitiesForArea(hass, areaId) {
  const devices = new Map(valuesOf(hass?.devices).map((device) => [device.id, device]));
  const registry = entityRegistryMap(hass);
  return entityRegistryEntries(hass)
    .filter((entry) => {
      const deviceArea = devices.get(entry.device_id)?.area_id;
      return (
        (entry.area_id || deviceArea) === areaId &&
        isEntityVisible(hass, entry.entity_id, registry)
      );
    })
    .map((entry) => entry.entity_id)
    .sort((a, b) => a.localeCompare(b, "de"));
}

function detectedRooms(hass, configuredRooms) {
  const configured = Array.isArray(configuredRooms) ? configuredRooms : [];
  const existing = new Map(configured.map((room) => [room.area_id, room]));

  const areas = valuesOf(hass?.areas).sort((a, b) =>
    String(a.name).localeCompare(String(b.name), "de"),
  );

  const areaMap = new Map(areas.map((area) => [area.area_id, area]));
  const orderedAreas = [
    ...configured.map((room) => areaMap.get(room.area_id)).filter(Boolean),
    ...areas.filter((area) => !existing.has(area.area_id)),
  ];

  return orderedAreas.map((area) => {
    const current = existing.get(area.area_id);
    const areaEntities = entitiesForArea(hass, area.area_id);
    const firstLight = areaEntities.find((entityId) => entityId.startsWith("light."));
    const configuredLight = String(current?.main_light || "");
    const mainLight = configuredLight.startsWith("light.") && isEntityVisible(hass, configuredLight)
      ? configuredLight
      : firstLight || "";
    const room = {
      area_id: area.area_id,
      name: area.name,
      icon: area.icon || "mdi:floor-plan",
      main_light: mainLight,
      popup_hash: `#raum-${area.area_id}`,
      enabled: true,
      hidden_entities: [],
      ...current,
    };
    // Registry-Daten und existierende Zustände sind maßgeblich. Gespeicherte
    // Entity-IDs können nach Umbenennen oder Entfernen veraltet sein.
    room.name = area.name;
    room.main_light = mainLight;
    room.entity_count = areaEntities.length;
    room.hidden_entities = Array.isArray(room.hidden_entities)
      ? room.hidden_entities.filter((entityId) => hass?.states?.[entityId])
      : [];
    return room;
  });
}

function detectedPersons(hass, configuredPersons) {
  const configured = Array.isArray(configuredPersons) ? configuredPersons : [];
  const existing = new Map(configured.map((person) => [person.entity, person]));
  const registry = entityRegistryMap(hass);
  const allPersonEntities = Object.keys(hass?.states || {})
    .filter((entityId) => entityId.startsWith("person."));
  const personEntities = allPersonEntities
    .filter((entityId) => isEntityVisible(hass, entityId, registry))
    .sort((a, b) => {
      const nameA = hass.states[a]?.attributes?.friendly_name || a;
      const nameB = hass.states[b]?.attributes?.friendly_name || b;
      return nameA.localeCompare(nameB, "de");
    });
  const ordered = [
    ...configured.map((person) => person.entity).filter((entityId) => allPersonEntities.includes(entityId)),
    ...personEntities.filter((entityId) => !existing.has(entityId)),
  ];

  return ordered.map((entity) => ({
    entity,
    enabled: true,
    travel_sensor: "",
    ...existing.get(entity),
  }));
}

function createPersonCard(person) {
  const personId = JSON.stringify(person.entity);
  const travelId = JSON.stringify(person.travel_sensor || "");
  return {
    type: "custom:bubble-card",
    card_type: "button",
    button_type: "state",
    entity: person.entity,
    show_state: true,
    state_color: true,
    card_layout: "large",
    styles: `\${(() => {
      const personState = hass.states[${personId}]?.state;
      const travelEntity = ${travelId};
      const travel = travelEntity ? Number(hass.states[travelEntity]?.state) : NaN;
      const zoneName = personState && !['home', 'not_home', 'unknown', 'unavailable'].includes(personState)
        ? hass.states[\`zone.\${personState}\`]?.attributes?.friendly_name || personState
        : null;
      card.querySelector('.bubble-state').innerText = personState === 'home'
        ? 'Zuhause'
        : Number.isFinite(travel)
          ? Math.round(travel) + ' min entfernt'
          : zoneName || 'Unterwegs';
    })()}`,
  };
}

function applyPersonOptions(dashboard, config, hass) {
  if (!Array.isArray(config.persons)) return dashboard;
  const cards = dashboard.views?.[0]?.sections?.[0]?.cards;
  if (!Array.isArray(cards)) return dashboard;
  const headingIndex = cards.findIndex((card) => card?.heading === "Personen" || card?.name === "Personen");
  const legacyIndex = cards.findIndex(
    (card) =>
      card?.type === "horizontal-stack" &&
      card.cards?.some((item) => item?.entity?.startsWith("person.")),
  );
  const index = headingIndex >= 0 && cards[headingIndex + 1]?.type === "horizontal-stack"
    ? headingIndex + 1
    : legacyIndex;
  if (index < 0) return dashboard;
  const persons = detectedPersons(hass, config.persons).filter(
    (person) => person.enabled !== false && isEntityVisible(hass, person.entity),
  );
  if (!persons.length) {
    if (headingIndex >= 0 && index === headingIndex + 1) cards.splice(headingIndex, 2);
    else cards.splice(index, 1);
    return dashboard;
  }
  cards[index] = {
    type: "horizontal-stack",
    cards: persons.map(createPersonCard),
  };
  // Die Überschrift dient im Basislayout nur als eindeutiger Platzhalter für
  // die Generierung. Im fertigen Smartphone-Dashboard stehen die kompakten
  // Personenkarten ohne zusätzlichen Titel.
  if (headingIndex >= 0 && index === headingIndex + 1) cards.splice(headingIndex, 1);
  return dashboard;
}

function notificationSetting(config, hass, key) {
  if (config && Object.prototype.hasOwnProperty.call(config, key)) return config[key];
  const helper = NOTIFICATION_HELPERS[key];
  const state = helper ? hass?.states?.[helper]?.state : undefined;
  if (state !== undefined && !["unknown", "unavailable"].includes(state)) {
    if (helper.startsWith("input_boolean.")) return state === "on";
    if (helper.startsWith("input_text.")) return state;
    const number = Number(state);
    if (Number.isFinite(number)) return number;
  }
  return config[key];
}

function normalizeNinaGlob(value) {
  const text = String(value || "").trim();
  return /^binary_sensor\.[a-z0-9_]+\*[a-z0-9_]*$/i.test(text)
    ? text
    : "";
}

function registryEntityId(hass, domain, uniqueId) {
  const prefix = `${domain}.`;
  return entityRegistryEntries(hass).find(
    (entry) =>
      entry?.unique_id === uniqueId &&
      String(entry?.entity_id || "").startsWith(prefix),
  )?.entity_id;
}

function packageEntity(hass, { domain, uniqueId, entityId, alias, attributeId }) {
  const registeredId = registryEntityId(hass, domain, uniqueId);
  if (registeredId) return [registeredId, hass?.states?.[registeredId]];

  const exact = entityId ? hass?.states?.[entityId] : undefined;
  if (exact && (!alias || exact.attributes?.friendly_name === alias)) {
    return [entityId, exact];
  }

  return Object.entries(hass?.states || {}).find(
    ([candidateId, state]) =>
      candidateId.startsWith(`${domain}.`) &&
      (
        (attributeId && state?.attributes?.id === attributeId) ||
        (alias && state?.attributes?.friendly_name === alias)
      ),
  );
}

function synchronizationStatus(config, hass) {
  const helperIds = Object.values(NOTIFICATION_HELPERS);
  const installedHelpers = helperIds.filter((entityId) => hass?.states?.[entityId]).length;
  const recipients = csv(notificationSetting(config, hass, "notification_recipients"));
  const missingServices = recipients.filter((service) => !/^notify\.[a-z0-9_]+$/.test(service) || !hass?.services?.notify?.[service.slice(7)]);
  const problems = [];
  if (!recipients.length) problems.push("keine Benachrichtigungsdienste konfiguriert");
  if (missingServices.length) problems.push(`Notify-Dienste fehlen: ${missingServices.join(", ")}`);
  return { active: problems.length === 0, installedHelpers, totalHelpers: helperIds.length,
    title: problems.length ? "Backend-Synchronisierung unvollständig" : "Backend-Synchronisierung aktiv",
    detail: problems.length ? problems.join(" · ") : `Backend bereit · ${installedHelpers} optionale Legacy-Helfer · ${recipients.length} Notify-Dienste` };
}

function withNotificationPopup(entry, category) {
  const hash = NOTIFICATION_POPUPS[category]?.[0];
  if (!hash) return entry;
  return {
    ...entry,
    options: {
      ...(entry.options || {}),
      tap_action: { action: "navigate", navigation_path: hash },
      button_action: { tap_action: { action: "navigate", navigation_path: hash } },
    },
  };
}

function notificationCalendarEntities(hass) {
  const registry = entityRegistryMap(hass);
  return Object.entries(hass?.states || {})
    .filter(([entityId, state]) =>
      entityId.startsWith("calendar.") &&
      isEntityVisible(hass, entityId, registry) &&
      /abfall|müll|muell|waste|trash|recycl/i.test(
        `${entityId} ${state?.attributes?.friendly_name || ""}`,
      ),
    )
    .map(([entityId]) => entityId)
    .sort((a, b) => a.localeCompare(b, "de"));
}

function notificationDetailCard(filters, category, hiddenEntityIds = []) {
  const include = filters.map((entry) => {
    const detail = structuredClone(entry);
    if (category === "nina") {
      detail.options = {
        type: "custom:button-card",
        icon: "mdi:alert-outline",
        show_state: false,
        show_label: true,
        show_icon: true,
        name: "[[[ return entity?.attributes?.headline || entity?.attributes?.friendly_name || 'NINA-Warnung'; ]]]",
        label: "[[[ return [entity?.attributes?.severity, entity?.attributes?.sender_name].filter(Boolean).join(' · '); ]]]",
        custom_fields: {
          description: "[[[ return entity?.attributes?.description || 'Keine Beschreibung vorhanden.'; ]]]",
          instruction: "[[[ return entity?.attributes?.instruction || ''; ]]]",
          period: "[[[ const start = entity?.attributes?.onset || entity?.attributes?.sent; const end = entity?.attributes?.expires; return [start && `Von: ${start}`, end && `Bis: ${end}`].filter(Boolean).join(' · '); ]]]",
        },
        styles: {
          card: [
            { padding: "18px" },
            { "text-align": "left" },
            { "border-left": "5px solid var(--error-color)" },
          ],
          grid: [
            { "grid-template-areas": "'i n' 'i l' 'description description' 'instruction instruction' 'period period'" },
            { "grid-template-columns": "42px 1fr" },
          ],
          name: [{ "white-space": "normal" }, { "font-weight": "700" }],
          icon: [{ color: "var(--error-color)" }],
          label: [{ "white-space": "normal" }, { color: "var(--secondary-text-color)" }],
          custom_fields: {
            description: [{ "white-space": "pre-wrap" }, { "margin-top": "14px" }, { "line-height": "1.45" }],
            instruction: [{ "white-space": "pre-wrap" }, { "margin-top": "12px" }, { "font-weight": "600" }, { "line-height": "1.45" }],
            period: [{ "white-space": "normal" }, { "margin-top": "12px" }, { color: "var(--secondary-text-color)" }, { "font-size": "12px" }],
          },
        },
        tap_action: { action: "more-info" },
      };
    } else {
      detail.options = {
        ...(detail.options || {}),
        button_type: "state",
        show_state: true,
        tap_action: { action: "more-info" },
      };
      delete detail.options.button_action;
    }
    return detail;
  });
  return {
    type: "custom:auto-entities",
    unique: true,
    show_empty: false,
    card: { type: "vertical-stack" },
    card_param: "cards",
    filter: {
      include,
      exclude: [
        { state: "unavailable" },
        { state: "unknown" },
        ...hiddenEntityIds.map((entity_id) => ({ entity_id })),
      ],
    },
    else: {
      type: "markdown",
      content: "Aktuell ist keine passende Meldung aktiv.",
    },
  };
}

function notificationDetailPopups(filtersByCategory, hass, hiddenEntityIds = []) {
  const calendars = notificationCalendarEntities(hass);
  return Object.entries(filtersByCategory).flatMap(([category, filters]) => {
    if (!filters.length || !NOTIFICATION_POPUPS[category]) return [];
    const [hash, name, icon] = NOTIFICATION_POPUPS[category];
    const cards = [notificationDetailCard(filters, category, hiddenEntityIds)];
    if (category === "waste" && calendars.length) {
      cards.push({
        type: "custom:bubble-card",
        card_type: "calendar",
        entities: calendars.map((entity) => ({ entity, color: "var(--success-color)" })),
        days: 45,
        limit: 6,
        card_layout: "normal",
        rows: 4,
        show_end: false,
        show_progress: false,
      });
    }
    return [{
      type: "custom:bubble-card",
      card_type: "pop-up",
      popup_mode: "adaptive-dialog",
      hash,
      button_type: "name",
      name,
      icon,
      show_header: true,
      scrolling_effect: true,
      cards,
    }];
  });
}

function applyNotificationOptions(dashboard, config, hass) {
  const cards = dashboard.views?.[0]?.sections?.[0]?.cards;
  if (!Array.isArray(cards)) return dashboard;
  const section = cards.find(
    (card) => card?.type === "vertical-stack" && card.cards?.[0]?.name === "Meldungen",
  );
  const notificationHeadingIndex = cards.findIndex((card) => card?.heading === "Meldungen" || card?.name === "Meldungen");
  const autoEntities = section?.cards?.find((card) => card?.type === "custom:auto-entities") ||
    cards.slice(notificationHeadingIndex + 1).find((card) => card?.type === "custom:auto-entities");
  const includes = autoEntities?.filter?.include;
  if (!Array.isArray(includes)) return dashboard;

  const settings = {
    batteries: notificationSetting(config, hass, "notification_batteries") !== false,
    contacts: notificationSetting(config, hass, "notification_contacts") !== false,
    co2: notificationSetting(config, hass, "notification_co2") !== false,
    waste: notificationSetting(config, hass, "notification_waste") !== false,
    ups: notificationSetting(config, hass, "notification_ups") !== false,
    frost: notificationSetting(config, hass, "notification_frost") !== false,
    nina: notificationSetting(config, hass, "notification_nina") !== false,
  };
  const batteryThreshold = Number(notificationSetting(config, hass, "battery_threshold")) || 6;
  const contactMinutes = Number(notificationSetting(config, hass, "contact_minutes")) || 15;
  const co2Threshold = Number(notificationSetting(config, hass, "co2_threshold")) || 1000;
  const configuredWasteDays = Number(notificationSetting(config, hass, "waste_days"));
  const wasteDays = Number.isFinite(configuredWasteDays)
    ? Math.min(30, Math.max(0, Math.trunc(configuredWasteDays)))
    : 1;
  const frostSetting = notificationSetting(config, hass, "frost_threshold");
  const frostThreshold = Number.isFinite(Number(frostSetting))
    ? Number(frostSetting)
    : 4;
  const frostEntity =
    notificationSetting(config, hass, "frost_entity") || "";
  const wasteEntities = csv(notificationSetting(config, hass, "waste_entities"));
  const upsEntities = csv(notificationSetting(config, hass, "ups_entities"));
  const ninaEntities = normalizeNinaGlob(notificationSetting(config, hass, "nina_entities"));
  const batteryExclusions = String(
    notificationSetting(config, hass, "battery_exclusions") ||
      "",
  )
    .split(",")
    .map((entityId) => entityId.trim())
    .filter(Boolean);
  const hiddenEntityIds = hiddenDashboardEntityIds(hass);

  const emitted = new Set();
  const detailFilters = Object.fromEntries(
    Object.keys(NOTIFICATION_POPUPS).map((category) => [category, []]),
  );
  const emit = (category, entries) => {
    detailFilters[category].push(...entries.map((entry) => structuredClone(entry)));
    return entries.map((entry) => withNotificationPopup(entry, category));
  };
  autoEntities.filter.include = includes.flatMap((entry) => {
    const entityId = entry.entity_id || "";
    if (["sensor.*battery", "sensor.*batterie"].includes(entityId) || entry.attributes?.device_class === "battery") {
      entry.state = `<= ${batteryThreshold}`;
      entry.not = { state: "0" };
      return settings.batteries ? emit("batteries", [entry]) : [];
    }
    if (["binary_sensor.*contact", "binary_sensor.*kontakt"].includes(entityId) || ["door", "window", "opening"].includes(entry.attributes?.device_class)) {
      entry.state = "on";
      entry.last_changed = `> ${contactMinutes}`;
      return settings.contacts ? emit("contacts", [entry]) : [];
    }
    if (["sensor.*kohlendioxid", "sensor.*co2*"].includes(entityId) || entry.attributes?.device_class === "carbon_dioxide") {
      entry.state = `> ${co2Threshold}`;
      return settings.co2 ? emit("co2", [entry]) : [];
    }
    if (entityId === "sensor.*abfall") {
      const dueNumbers = Array.from({ length: wasteDays + 1 }, (_value, index) => index).join("|");
      const dueWords = wasteDays >= 1
        ? "[Hh]eute|[Mm]orgen|[Tt]oday|[Tt]omorrow"
        : "[Hh]eute|[Tt]oday";
      const dueState = `/(?:${dueWords}|\\bin\\s+(?:${dueNumbers})\\s+(?:[Tt]ag(?:e|en)?|days?)\\b|^(?:${dueNumbers})$)/`;
      const entries = wasteEntities.map((entity_id) => ({
        ...entry,
        entity_id,
        or: [
          { attributes: { daysTo: `<= ${wasteDays}` }, not: { attributes: { daysTo: "< 0" } } },
          { attributes: { days_to: `<= ${wasteDays}` }, not: { attributes: { days_to: "< 0" } } },
          { state: dueState },
        ],
        options: {
          ...(entry.options || {}),
          button_type: "state",
          show_state: true,
          icon: "mdi:trash-can-outline",
          styles: WASTE_SUMMARY_STYLES,
        },
      }));
      return settings.waste ? emit("waste", entries) : [];
    }
    if (entityId === "sensor.*ups_status") {
      if (emitted.has("ups")) return [];
      emitted.add("ups");
      const entries = upsEntities.map((entity_id) => {
        const state = hass?.states?.[entity_id];
        if (entity_id.startsWith("binary_sensor.")) {
          const problemSensor = UPS_PROBLEM_DEVICE_CLASSES.has(
            String(state?.attributes?.device_class || "").toLowerCase(),
          );
          return { ...entry, entity_id, state: problemSensor ? "on" : "off" };
        }
        return {
          ...entry,
          entity_id,
          not: { or: UPS_NON_ALERT_STATES.map((normalState) => ({ state: normalState })) },
        };
      });
      return settings.ups ? emit("ups", entries) : [];
    }
    if (entityId === "sensor.*temperature") {
      entry.entity_id = frostEntity;
      entry.state = `<= ${frostThreshold}`;
      return settings.frost && Boolean(frostEntity) ? emit("frost", [entry]) : [];
    }
    if (entityId.startsWith("binary_sensor.nina_warning_")) {
      if (emitted.has("nina")) return [];
      emitted.add("nina");
      return settings.nina && Boolean(ninaEntities)
        ? emit("nina", [{
          ...entry,
          entity_id: ninaEntities,
          options: {
            ...(entry.options || {}),
            icon: "mdi:alert-outline",
            styles: NINA_SUMMARY_STYLES,
          },
        }])
        : [];
    }
    return [entry];
  });
  autoEntities.filter.exclude = [
    { state: "unavailable" },
    { state: "unknown" },
    ...hiddenEntityIds.map((entity_id) => ({ options: {}, entity_id })),
    ...batteryExclusions.map((entity_id) => ({ options: {}, entity_id })),
  ];
  const popupHashes = new Set(Object.values(NOTIFICATION_POPUPS).map(([hash]) => hash));
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    if (popupHashes.has(cards[index]?.hash)) cards.splice(index, 1);
  }
  if (config.show_notifications !== false) {
    cards.push(...notificationDetailPopups(detailFilters, hass, hiddenEntityIds));
  }
  return dashboard;
}

function configuredQuickActions(hass, configured) {
  const actions = Array.isArray(configured) ? configured : [];
  return [...new Set(actions.map(String).map((id) => id.trim()).filter((id) => id.startsWith("script.")))];
}

function partitionConflictPatch(patch, serverConfig, baseConfig) {
  const overlap = Object.keys(patch).filter((key) => JSON.stringify(serverConfig?.[key]) !== JSON.stringify(baseConfig?.[key]));
  return {
    overlap,
    retryable: Object.fromEntries(Object.entries(patch).filter(([key]) => !overlap.includes(key))),
  };
}

function applyQuickActionOptions(dashboard, config, hass) {
  if (!Array.isArray(config.quick_actions)) return dashboard;
  const cards = dashboard.views?.[0]?.sections?.[0]?.cards;
  if (!Array.isArray(cards)) return dashboard;
  const headingIndex = cards.findIndex((card) => card?.name === "Aktionen" || card?.heading === "Aktionen");
  if (headingIndex < 0) return dashboard;
  const actions = configuredQuickActions(hass, config.quick_actions).filter((entityId) => isEntityVisible(hass, entityId));
  if (!actions.length) {
    cards.splice(headingIndex, 2);
    return dashboard;
  }
  const actionCards = actions.map((entity) => ({
    type: "custom:bubble-card",
    card_type: "button",
    button_type: "name",
    entity,
    icon: hass.states[entity]?.attributes?.icon || "mdi:gesture-tap-button",
    tap_action: { action: "perform-action", perform_action: "script.turn_on", target: { entity_id: entity } },
    button_action: {
      tap_action: { action: "perform-action", perform_action: "script.turn_on", target: { entity_id: entity } },
    },
  }));
  cards[headingIndex + 1] =
    actionCards.length === 1
      ? actionCards[0]
      : { type: "grid", columns: 2, square: false, cards: actionCards };
  return dashboard;
}

function graphSensorCard(entity, hass, appearance = {}) {
  const attributes = hass?.states?.[entity]?.attributes || {};
  const icon = appearance.icon || attributes.icon || "mdi:chart-line";
  const color = appearance.color || "var(--primary-color)";
  return {
    type: "custom:button-card",
    entity,
    show_name: false,
    show_state: false,
    show_icon: false,
    custom_fields: {
      title: {
        card: {
          type: "custom:bubble-card",
          card_type: "button",
          button_type: "state",
          entity,
          name: attributes.friendly_name || entity,
          icon,
          card_layout: "normal",
          styles: `
            ha-card {
              --bubble-main-background-color: rgba(var(--rgb-primary-text-color), 0.1) !important;
              background: transparent !important;
              box-shadow: none !important;
            }
          `,
        },
      },
      graph: {
        card: {
          type: "custom:mini-graph-card",
          entities: [entity],
          show: { name: false, icon: false, state: false },
          line_color: color,
          card_mod: {
            style: `
              ha-card {
                box-shadow: none;
                background: none;
                backdrop-filter: none !important;
                border: none;
              }
            `,
          },
        },
      },
    },
    styles: {
      grid: [
        { "grid-template-areas": '"title" "graph"' },
        { "grid-template-rows": "min-content min-content" },
      ],
      card: [
        { padding: "0px" },
        { "border-radius": "25px" },
        { "box-shadow": "none" },
        { background: "rgba(var(--rgb-primary-text-color), 0.1)" },
      ],
    },
  };
}

function genericRoomPopup(room, hass) {
  const hidden = new Set(room.hidden_entities || []);
  const entities = entitiesForArea(hass, room.area_id).filter(
    (entityId) => !hidden.has(entityId),
  );
  const lights = entities.filter((entityId) => entityId.startsWith("light."));
  const switches = entities.filter((entityId) => entityId.startsWith("switch."));
  const climates = entities.filter((entityId) => entityId.startsWith("climate."));
  const mediaPlayers = entities.filter((entityId) => entityId.startsWith("media_player."));
  const covers = entities.filter((entityId) => entityId.startsWith("cover."));
  const fans = entities.filter((entityId) => entityId.startsWith("fan."));
  const cameras = entities.filter((entityId) => entityId.startsWith("camera."));
  const sensors = entities.filter((entityId) => {
    if (!entityId.startsWith("sensor.")) return false;
    const state = hass?.states?.[entityId];
    return Boolean(state?.attributes?.unit_of_measurement) && !["unknown", "unavailable"].includes(state?.state);
  });
  const cards = [];

  function sensorAppearance(entity) {
    const attributes = hass?.states?.[entity]?.attributes || {};
    const deviceClass = attributes.device_class || "";
    const unit = attributes.unit_of_measurement || "";
    const key = `${entity} ${deviceClass} ${unit}`.toLowerCase();
    if (deviceClass === "humidity" || /humidity|feuchtigkeit/.test(`${entity} ${deviceClass}`.toLowerCase())) {
      return { icon: attributes.icon || "mdi:water-percent", color: "#AEC8A4" };
    }
    if (/co2|carbon_dioxide|kohlendioxid|ppm/.test(key)) {
      return { icon: attributes.icon || "mdi:molecule-co2", color: "#A2AA52" };
    }
    if (/pm25|pm2\.5|particulate/.test(key)) {
      return { icon: attributes.icon || "mdi:molecule", color: "#D2AA52" };
    }
    if (/temperature|temperatur|°c|°f/.test(key)) {
      return { icon: attributes.icon || "mdi:thermometer", color: "#A2AADB" };
    }
    if (deviceClass === "battery" || /battery|batterie|akku/.test(`${entity} ${deviceClass}`.toLowerCase())) {
      return { icon: attributes.icon || "mdi:battery", color: "#A2DD52" };
    }
    if (/cpu|processor|prozessor/.test(key)) {
      return { icon: attributes.icon || "mdi:cpu-64-bit", color: "#A2AADB" };
    }
    if (/memory|ram|arbeitsspeicher/.test(key)) {
      return { icon: attributes.icon || "mdi:memory", color: "#AEC8A4" };
    }
    if (/power|leistung|w$|kw/.test(key)) {
      return { icon: attributes.icon || "mdi:flash", color: "#FFAA52" };
    }
    return { icon: attributes.icon || "mdi:chart-line", color: "#8AB4F8" };
  }

  function addGroup(name, icon, groupCards) {
    if (!groupCards.length) return;
    cards.push({ type: "custom:bubble-card", card_type: "separator", name, icon });
    cards.push(...groupCards);
  }

  addGroup(
    "Licht",
    "mdi:lightbulb-outline",
    lights.map((entity) => ({
      type: "custom:bubble-card",
      card_type: "button",
      button_type: "slider",
      entity,
      show_attribute: true,
      attribute: "brightness",
    })),
  );
  addGroup(
    "Schalter",
    "mdi:toggle-switch-outline",
    switches.map((entity) => ({
      type: "custom:bubble-card",
      card_type: "button",
      button_type: "switch",
      entity,
    })),
  );
  addGroup(
    "Klima",
    "mdi:home-thermometer-outline",
    climates.map((entity) => ({
      type: "custom:bubble-card",
      card_type: "climate",
      entity,
    })),
  );
  addGroup(
    "Medien",
    "mdi:cast-audio",
    mediaPlayers.map((entity) => ({
      type: "custom:bubble-card",
      card_type: "media-player",
      entity,
    })),
  );
  addGroup("Abdeckungen", "mdi:blinds", covers.map((entity) => ({
    type: "custom:bubble-card", card_type: "cover", entity,
  })));
  addGroup("Lüfter", "mdi:fan", fans.map((entity) => ({
    type: "custom:bubble-card", card_type: "button", button_type: "switch", entity,
  })));
  addGroup("Kameras", "mdi:cctv", cameras.map((entity) => ({
    type: "picture-entity", entity, camera_view: "live", show_name: true, show_state: false,
  })));
  if (sensors.length) {
    cards.push({
      type: "custom:bubble-card",
      card_type: "separator",
      name: "Sensoren",
      icon: "mdi:chart-line",
    });
    cards.push({
      type: "grid",
      columns: 2,
      square: false,
      cards: sensors.map((entity) => {
        const appearance = sensorAppearance(entity);
        return graphSensorCard(entity, hass, appearance);
      }),
    });
  }

  if (!cards.length) {
    cards.push({
      type: "custom:bubble-card",
      card_type: "button",
      button_type: "name",
      name: "Keine steuerbaren Entitäten",
      icon: "mdi:information-outline",
    });
  }

  return {
    type: "custom:bubble-card",
    card_type: "pop-up",
    popup_mode: "adaptive-dialog",
    hash: room.popup_hash,
    button_type: room.main_light ? "switch" : "name",
    name: room.name,
    icon: room.icon,
    entity: room.main_light || undefined,
    scrolling_effect: true,
    show_name: true,
    show_header: true,
    ...(room.entity_count ? { styles: ACTIVE_ROOM_STYLES } : {}),
    cards,
  };
}

function removeHiddenEntities(value, hidden) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !(item?.entity && hidden.has(item.entity)))
      .map((item) => removeHiddenEntities(item, hidden));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        removeHiddenEntities(item, hidden),
      ]),
    );
  }
  return value;
}

function applyRoomOptions(dashboard, config, hass) {
  if (!Array.isArray(config.rooms)) return dashboard;

  const view = dashboard.views?.[0];
  const cards = view?.sections?.[0]?.cards;
  if (!Array.isArray(cards)) return dashboard;

  const rooms = detectedRooms(hass, config.rooms).filter(
    (room) => room.enabled !== false && room.entity_count > 0,
  );
  const roomHeadingIndex = cards.findIndex((card) => card?.name === "Räume");
  if (!rooms.length && roomHeadingIndex >= 0) {
    const deleteCount = cards[roomHeadingIndex + 1]?.type === "grid" ? 2 : 1;
    cards.splice(roomHeadingIndex, deleteCount);
  }
  if (rooms.length && roomHeadingIndex >= 0 && cards[roomHeadingIndex + 1]?.type === "grid") {
    cards[roomHeadingIndex + 1] = {
      type: "grid",
      columns: 2,
      square: false,
      cards: rooms.map((room) => ({
        type: "custom:bubble-card",
        card_type: "button",
        button_type: room.main_light ? "slider" : "name",
        name: room.name,
        icon: room.icon,
        ...(room.main_light ? {
          entity: room.main_light,
          light_slider_type: "brightness",
          slider_fill_orientation: "left",
          slider_value_position: "right",
        } : {}),
        tap_action: { action: room.main_light ? "toggle" : "none" },
        button_action: {
          tap_action: { action: "navigate", navigation_path: room.popup_hash },
        },
        ...(room.entity_count ? { styles: ACTIVE_ROOM_STYLES } : {}),
      })),
    };
  }

  const legacyHashes = new Set(["#kueche", "#wohnzimmer", "#schlafzimmer", "#arbeitszimmer"]);
  const legacyPopups = new Map(
    cards
      .filter((card) => legacyHashes.has(card?.hash))
      .map((card) => [card.hash, card]),
  );
  const firstLegacyPopup = cards.findIndex((card) => legacyHashes.has(card?.hash));
  const withoutRoomPopups = cards.filter((card) => !legacyHashes.has(card?.hash));
  const insertionIndex = firstLegacyPopup < 0 ? withoutRoomPopups.length : firstLegacyPopup;
  // Bekannte und neue Räume werden vollständig aus der Area Registry erzeugt.
  const popups = rooms.map((room) => genericRoomPopup(room, hass));
  withoutRoomPopups.splice(insertionIndex, 0, ...popups);
  view.sections[0].cards = withoutRoomPopups;
  return dashboard;
}

function applyDashboardOptions(dashboard, config) {
  const view = dashboard.views?.[0];
  const cards = view?.sections?.[0]?.cards;

  if (!view || !Array.isArray(cards)) return dashboard;

  view.max_columns = Number(config.max_columns) || view.max_columns || 1;
  view.dense_section_placement = config.dense_section_placement !== false;

  if (config.theme) view.theme = config.theme;
  else delete view.theme;

  if (config.background) view.background = config.background;
  else delete view.background;

  const visible = {
    persons: config.show_persons !== false,
    notifications: config.show_notifications !== false,
    quick_actions: config.show_quick_actions !== false,
    rooms: config.show_rooms !== false,
    navigation: config.show_navigation !== false,
  };

  const filtered = [];
  const sectionKey = (card) => ({
    Personen: "persons",
    Meldungen: "notifications",
    Aktionen: "quick_actions",
    Räume: "rooms",
    "Weitere Bereiche": "navigation",
  })[card?.heading || card?.name];

  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    const key = sectionKey(card);
    if (key && !visible[key]) {
      const next = cards[index + 1];
      if (next && !sectionKey(next) && next?.card_type !== "pop-up") index += 1;
      continue;
    }
    const isPersons =
      card?.type === "horizontal-stack" &&
      card.cards?.some((item) => item?.entity?.startsWith("person."));
    const isNotifications =
      card?.type === "vertical-stack" && card.cards?.[0]?.name === "Meldungen";
    const isNavigation =
      card?.type === "grid" &&
      card.cards?.some((item) => item?.name === "Medien") &&
      card.cards?.some((item) => item?.name === "System");

    if (!visible.persons && isPersons) continue;
    if (!visible.notifications && isNotifications) continue;
    if (!visible.navigation && isNavigation) continue;

    filtered.push(card);
  }

  view.sections[0].cards = filtered;
  return dashboard;
}

function csv(value) {
  return Array.isArray(value)
    ? value.filter(Boolean)
    : String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function entityIds(hass, domain, pattern) {
  const registry = entityRegistryMap(hass);
  return Object.keys(hass?.states || {}).filter((id) =>
    isEntityVisible(hass, id, registry) &&
    (!domain || id.startsWith(`${domain}.`)) && (!pattern || pattern.test(id)),
  );
}

function matchesEntityPattern(entityId, pattern) {
  if (!pattern) return false;
  try {
    return new RegExp(pattern, "i").test(entityId);
  } catch (_error) {
    return false;
  }
}

function isValidRegularExpression(pattern) {
  if (!pattern) return true;
  try {
    new RegExp(pattern, "i");
    return true;
  } catch (_error) {
    return false;
  }
}

function normalizedNavigationHash(value, fallback) {
  const raw = String(value || "").trim();
  const candidate = raw ? (raw.startsWith("#") ? raw : `#${raw}`) : fallback;
  return /^#[a-z0-9][a-z0-9_-]*$/i.test(candidate) ? candidate : fallback;
}

function configurationValidationErrors(config) {
  const errors = [];
  const hashes = [];
  for (const [key, meta] of Object.entries(FEATURE_META)) {
    const raw = String(config?.features?.[key]?.hash || "").trim();
    const candidate = raw ? (raw.startsWith("#") ? raw : `#${raw}`) : meta[2];
    if (!/^#[a-z0-9][a-z0-9_-]*$/i.test(candidate)) {
      errors.push(`${meta[0]}: ungültiger Navigations-Hash`);
    } else {
      hashes.push([key, candidate]);
    }
  }
  for (const [key, hash] of hashes) {
    if (hashes.some(([otherKey, otherHash]) => otherKey !== key && otherHash === hash)) {
      errors.push(`${FEATURE_META[key][0]}: Navigations-Hash ${hash} ist doppelt`);
    }
  }
  const groups = config?.features?.system?.system_groups;
  if (Array.isArray(groups)) {
    const seenGroupIds = new Set();
    for (const group of groups) {
      const groupId = String(group?.id || "").trim();
      if (groupId && seenGroupIds.has(groupId)) {
        errors.push(`Systemgruppe „${group?.name || groupId}“: Gruppen-ID ${groupId} ist doppelt`);
      }
      if (groupId) seenGroupIds.add(groupId);
      if (!isValidRegularExpression(String(group?.pattern || ""))) {
        errors.push(`Systemgruppe „${group?.name || group?.id || "Unbenannt"}“: ungültiger regulärer Ausdruck`);
      }
    }
  }
  const colors = config?.features?.system?.system_colors;
  if (colors && typeof colors === "object") {
    for (const [key, value] of Object.entries(colors)) {
      if (!isSafeCssColor(value)) errors.push(`Systemfarbe „${key}“ ist ungültig`);
    }
  }
  return [...new Set(errors)];
}

function autoFeatureEntities(hass, key, systemGroups = []) {
  if (key === "media") return entityIds(hass, "media_player");
  if (key === "security") return [
    ...entityIds(hass, "camera"),
    ...entityIds(hass, "alarm_control_panel"),
    ...entityIds(hass, "lock"),
  ];
  const registry = entityRegistryMap(hass);
  if (key === "printer") return Object.keys(hass?.states || {}).filter((id) =>
    isEntityVisible(hass, id, registry) &&
    /^(sensor|binary_sensor|switch|button|number|select)\./.test(id) &&
    /printer|druck|bambu|octoprint|klipper|moonraker/i.test(id),
  );
  return Object.keys(hass?.states || {}).filter((id) =>
    isEntityVisible(hass, id, registry) &&
    /^(sensor|binary_sensor)\./.test(id) &&
    (/system|server|processor|memory|disk|cpu|ram|power|last|home_assistant_core|uptime|ups|opnsense|truenas|zima|influxdb_(internet|truenas|zima)|gateway.*status|net_(in|out)|inbytes|outbytes|pool/i.test(id) ||
      systemGroups.some((group) => matchesEntityPattern(id, group.pattern))),
  );
}

function autoBambuPrinterIds(hass) {
  const isBambuPrinterText = (parts, manufacturer) => {
    const maker = String(manufacturer || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const makerKnown = Boolean(maker) && !["unknown", "unavailable", "none"].includes(maker);
    const makerIsBambu = /\bbambu(?:\s*lab)?\b/.test(maker);
    if (makerKnown && !makerIsBambu) return false;
    if (makerIsBambu) return true;
    const text = parts.filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return /\bbambu(?:\s*lab)?\b/.test(text) || /\b(?:a\s*1(?:\s*mini)?|p\s*1\s*[sp]|p\s*2\s*s|h\s*2\s*[ds]|x\s*1\s*c|x\s*1\s*carbon)\b/.test(text);
  };
  const devices = valuesOf(hass?.devices);
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  const registry = entityRegistryMap(hass);
  const visibleDeviceIds = new Set(
    [...registry.values()]
      .filter((entity) => entity.device_id && isEntityVisible(hass, entity.entity_id, registry))
      .map((entity) => entity.device_id),
  );
  const deviceIds = devices
    .filter((device) => isBambuPrinterText(
      [device.model, device.name_by_user, device.name], device.manufacturer,
    ))
    .map((device) => device.id)
    .filter((deviceId) => deviceId && (!registry.size || visibleDeviceIds.has(deviceId)));
  const registryDeviceIds = entityRegistryEntries(hass)
    .filter((entity) =>
      entity.device_id &&
      isEntityVisible(hass, entity.entity_id, registry) &&
      isBambuPrinterText(
        [entity.entity_id, entity.platform, entity.original_name, entity.name],
        deviceById.get(entity.device_id)?.manufacturer,
      ),
    )
    .map((entity) => entity.device_id);
  return [...new Set([...deviceIds, ...registryDeviceIds])];
}

const FEATURE_META = {
  media: ["Medien", "mdi:cast-audio", "#medien"],
  security: ["Sicherheit", "mdi:shield-home-outline", "#sicherheit"],
  printer: ["3D-Druck", "mdi:printer-3d", "#3ddruck"],
  system: ["System", "mdi:server", "#system"],
};

const DEFAULT_SYSTEM_GROUPS = [
  { id: "it", name: "IT", icon: "mdi:server", pattern: "" },
  { id: "opnsense", name: "OPNsense", icon: "mdi:router-network", pattern: "opnsense" },
  { id: "nas", name: "NAS", icon: "mdi:nas", pattern: "truenas|(^|[_.])nas([_.]|$)" },
  { id: "home_assistant", name: "Home Assistant", icon: "mdi:home-assistant", pattern: "home_assistant|homeassistant" },
  { id: "zima", name: "Zima 1", icon: "mdi:timeline-outline", pattern: "zima" },
];

const DEFAULT_SYSTEM_COLORS = {
  cpu: "#A2AADB",
  memory: "#AEC8A4",
  buffers: "#FFFFAA",
  download: "#FFAA52",
  upload: "#FFFFFF",
  storage: "#FFAA52",
  ups: "#A2DD52",
  power: "#A2AA52",
  other: "#8AB4F8",
};

function normalizedSystemGroups(value) {
  const source = Array.isArray(value) && value.length ? value : DEFAULT_SYSTEM_GROUPS;
  const usedIds = new Set();
  return source.map((group, index) => {
    const baseId = String(group?.id || `system_${index + 1}`).trim() || `system_${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) id = `${baseId}_${suffix++}`;
    usedIds.add(id);
    return {
      id,
      name: String(group?.name || `Gruppe ${index + 1}`),
      icon: String(group?.icon || "mdi:server"),
      pattern: String(group?.pattern || ""),
    };
  });
}

function isSafeCssColor(value) {
  const color = String(value || "").trim();
  return (
    /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) ||
    /^(?:rgb|rgba|hsl|hsla)\(\s*[-+0-9.% ,/]+\s*\)$/i.test(color) ||
    /^var\(--[a-z0-9_-]+\)$/i.test(color) ||
    /^(?:transparent|black|white|red|green|blue|orange|yellow|gray|grey)$/i.test(color)
  );
}

function normalizedSystemColors(value) {
  const configured = value && typeof value === "object" ? value : {};
  return Object.fromEntries(Object.entries(DEFAULT_SYSTEM_COLORS).map(([key, fallback]) => [
    key,
    isSafeCssColor(configured[key]) ? String(configured[key]).trim() : fallback,
  ]));
}

function configuredFeatures(config, hass) {
  const configured = config.features && typeof config.features === "object" ? config.features : {};
  const registry = entityRegistryMap(hass);
  const existingEntities = new Set(
    Object.keys(hass?.states || {}).filter((entityId) => isEntityVisible(hass, entityId, registry)),
  );
  const existingDevices = new Set(valuesOf(hass?.devices).map((device) => device.id));
  const requestedHashes = Object.fromEntries(Object.entries(FEATURE_META).map(([key, meta]) => [
    key,
    normalizedNavigationHash(configured[key]?.hash, meta[2]),
  ]));
  return Object.entries(FEATURE_META).map(([key, meta]) => {
    const item = configured[key] || {};
    const excluded = new Set(Array.isArray(item.excluded_entities) ? item.excluded_entities : []);
    const excludedPrinters = new Set(
      Array.isArray(item.excluded_printer_ids) ? item.excluded_printer_ids : [],
    );
    const systemGroups = key === "system" ? normalizedSystemGroups(item.system_groups) : [];
    const manualEntities = Array.isArray(item.entities)
      ? item.entities.filter((entityId) => existingEntities.has(entityId))
      : [];
    const entityRegistry = registry;
    const automaticEntities = item.auto_discover !== false
      ? autoFeatureEntities(hass, key, systemGroups).filter((entityId) =>
          !excluded.has(entityId) &&
          !(key === "printer" && excludedPrinters.has(entityRegistry.get(entityId)?.device_id)),
        )
      : [];
    const manualPrinterIds = key === "printer" && Array.isArray(item.printer_ids)
      ? item.printer_ids.filter((deviceId) => existingDevices.has(deviceId))
      : [];
    const automaticPrinterIds = key === "printer" && item.auto_discover !== false
      ? autoBambuPrinterIds(hass).filter((deviceId) => !excludedPrinters.has(deviceId))
      : [];
    return {
      key,
      name: item.name || meta[0],
      icon: item.icon || meta[1],
      hash: Object.values(requestedHashes).filter((hash) => hash === requestedHashes[key]).length > 1
        ? meta[2]
        : requestedHashes[key],
      enabled: item.enabled !== false,
      auto_discover: item.auto_discover !== false,
      entities: [...new Set([
        ...automaticEntities,
        ...manualEntities,
      ])],
      manual_entities: [...new Set(manualEntities)],
      automatic_entities: [...new Set(automaticEntities)],
      excluded_entities: [...excluded],
      printer_ids:
        key === "printer"
          ? [...new Set([...automaticPrinterIds, ...manualPrinterIds])]
          : [],
      manual_printer_ids: [...new Set(manualPrinterIds)],
      automatic_printer_ids: [...new Set(automaticPrinterIds)],
      excluded_printer_ids: [...excludedPrinters],
      system_groups: systemGroups,
      system_colors: key === "system" ? normalizedSystemColors(item.system_colors) : {},
    };
  });
}

function featureEntityCard(entity, hass) {
  const domain = entity.split(".")[0];
  if (domain === "camera") return { type: "picture-entity", entity, camera_view: "live", show_state: false };
  if (domain === "media_player") return { type: "custom:bubble-card", card_type: "media-player", entity };
  if (domain === "alarm_control_panel") return { type: "alarm-panel", entity };
  if (["sensor", "binary_sensor"].includes(domain) && hass?.states?.[entity]?.attributes?.unit_of_measurement) {
    return graphSensorCard(entity, hass);
  }
  return { type: "custom:bubble-card", card_type: "button", button_type: ["switch", "input_boolean", "fan", "lock"].includes(domain) ? "switch" : "state", entity };
}

function systemGraphAppearance(entity, hass, configuredColors) {
  const attributes = hass?.states?.[entity]?.attributes || {};
  const key = `${entity} ${attributes.device_class || ""} ${attributes.unit_of_measurement || ""}`.toLowerCase();
  const colors = normalizedSystemColors(configuredColors);
  if (/cpu|processor/.test(key)) return { icon: attributes.icon || "mdi:cpu-64-bit", color: colors.cpu };
  if (/memory.*buffer|buffer.*memory/.test(key)) return { icon: attributes.icon || "mdi:memory-arrow-down", color: colors.buffers };
  if (/ram|memory|speicher.*%/.test(key)) return { icon: attributes.icon || "mdi:memory", color: colors.memory };
  if (/download|inbytes|net_in/.test(key)) return { icon: attributes.icon || "mdi:download", color: colors.download };
  if (/upload|outbytes|net_out/.test(key)) return { icon: attributes.icon || "mdi:upload", color: colors.upload };
  if (/disk|pool|storage|speicher/.test(key)) return { icon: attributes.icon || "mdi:harddisk", color: colors.storage };
  if (/ups.*(last|load)|(last|load).*ups/.test(key)) return { icon: attributes.icon || "mdi:battery-alert", color: colors.ups };
  if (/power|leistung|last/.test(key)) return { icon: attributes.icon || "mdi:power-plug-battery", color: colors.power };
  return { icon: attributes.icon || "mdi:chart-line", color: colors.other };
}

function systemGroupForEntity(entity, configuredGroups) {
  const groups = normalizedSystemGroups(configuredGroups);
  const matched = groups.find((group) => group.pattern && matchesEntityPattern(entity, group.pattern));
  return matched || groups.find((group) => !group.pattern) || groups[0];
}

function systemFeatureCards(item, hass) {
  const configuredGroups = normalizedSystemGroups(item.system_groups);
  const groups = new Map();
  for (const entity of item.entities.filter((id) => hass?.states?.[id])) {
    const group = systemGroupForEntity(entity, configuredGroups);
    if (!group) continue;
    if (!groups.has(group.id)) groups.set(group.id, { ...group, entities: [] });
    groups.get(group.id).entities.push(entity);
  }
  return configuredGroups
    .filter((group) => groups.has(group.id))
    .map((group) => groups.get(group.id))
    .flatMap((group) => {
      const graphs = [];
      const states = [];
      const separatorStates = [];
      for (const entity of group.entities) {
        const value = hass.states[entity];
        if (entity.startsWith("sensor.") && value?.attributes?.unit_of_measurement) {
          const appearance = systemGraphAppearance(entity, hass, item.system_colors);
          graphs.push(graphSensorCard(entity, hass, appearance));
        } else if (/binary_sensor\.ups|opnsense_gateway_.*_status/i.test(entity)) {
          separatorStates.push({
            entity,
            name: value?.attributes?.friendly_name,
            icon: value?.attributes?.icon,
          });
        } else {
          states.push(featureEntityCard(entity, hass));
        }
      }
      const separator = {
        type: "custom:bubble-card",
        card_type: "separator",
        name: group.name,
        icon: group.icon,
      };
      if (separatorStates.length) {
        separator.sub_button = {
          main: separatorStates.map((item) => Object.fromEntries(
            Object.entries(item).filter(([, value]) => value),
          )),
        };
      }
      return [
        separator,
        ...states,
        ...(graphs.length
          ? [{ type: "grid", columns: 2, square: false, cards: graphs }]
          : []),
      ];
    });
}

function printerFeatureCards(item, hass) {
  const devices = new Map(valuesOf(hass?.devices).map((device) => [device.id, device]));
  const cards = item.printer_ids.flatMap((printerId) => {
    const device = devices.get(printerId);
    const name =
      device?.name_by_user || device?.name || device?.model || "Bambu Lab Drucker";
    return [
      {
        type: "custom:bubble-card",
        card_type: "separator",
        name,
        icon: "mdi:printer-3d",
      },
      {
        type: "custom:ha-bambulab-print_status-card",
        printer: printerId,
        style: "simple",
      },
    ];
  });
  const auxiliary = item.entities
    .filter((id) => hass?.states?.[id] && !/^sensor\./.test(id))
    .map((id) => featureEntityCard(id, hass));
  return [...cards, ...auxiliary];
}

function featurePopupCards(item, hass) {
  if (item.key === "printer") return printerFeatureCards(item, hass);
  if (item.key === "system") return systemFeatureCards(item, hass);
  return item.entities
    .filter((id) => hass?.states?.[id])
    .map((id) => featureEntityCard(id, hass));
}

function applyDynamicFeatures(dashboard, config, hass) {
  const cards = dashboard.views?.[0]?.sections?.[0]?.cards;
  if (!Array.isArray(cards)) return dashboard;
  const legacyHashes = new Set(["#medien", "#3ddruck", "#info", "#camera_alarm", "#system", "#sicherheit"]);
  const isOldNavigation = (card) => card?.type === "grid" && card.cards?.some((x) =>
    ["Medien", "System", "Alarm", "3D Drucker"].includes(x?.name),
  );
  const cleaned = cards.filter((card) => !legacyHashes.has(card?.hash) && !isOldNavigation(card));
  const navigationHeadingIndex = cleaned.findIndex((card) => card?.name === "Weitere Bereiche");
  const removeNavigationBlock = () => {
    const index = cleaned.findIndex((card) => card?.name === "Weitere Bereiche");
    if (index < 0) return;
    const count = cleaned[index + 1]?.type === "grid" ? 2 : 1;
    cleaned.splice(index, count);
  };
  if (config.show_navigation === false) {
    removeNavigationBlock();
    dashboard.views[0].sections[0].cards = cleaned;
    return dashboard;
  }
  const features = configuredFeatures(config, hass)
    .filter((item) => item.enabled)
    .map((item) => ({ ...item, popup_cards: featurePopupCards(item, hass) }))
    .filter((item) => item.popup_cards.length);
  if (!features.length) {
    removeNavigationBlock();
    dashboard.views[0].sections[0].cards = cleaned;
    return dashboard;
  }
  const navigation = { type: "grid", columns: 2, square: false, cards: features.map((item) => ({
    type: "custom:bubble-card", card_type: "button", button_type: "name", name: item.name, icon: item.icon,
    tap_action: { action: "navigate", navigation_path: item.hash },
    button_action: { tap_action: { action: "navigate", navigation_path: item.hash } },
  })) };
  const popups = features.map((item) => ({
    type: "custom:bubble-card", card_type: "pop-up", popup_mode: "adaptive-dialog", hash: item.hash,
    button_type: "name", name: item.name, icon: item.icon, show_header: true, scrolling_effect: true,
    cards: item.popup_cards,
  }));
  if (navigationHeadingIndex >= 0 && cleaned[navigationHeadingIndex + 1]?.type === "grid") {
    cleaned[navigationHeadingIndex + 1] = navigation;
  } else {
    const popupIndex = cleaned.findIndex((card) => card?.card_type === "pop-up");
    const insertionIndex = popupIndex < 0 ? cleaned.length : popupIndex;
    cleaned.splice(insertionIndex, 0,
      { type: "custom:bubble-card", card_type: "separator", name: "Weitere Bereiche", icon: "mdi:view-grid-plus-outline" },
      navigation,
    );
  }
  cleaned.push(...popups);
  dashboard.views[0].sections[0].cards = cleaned;
  return dashboard;
}

function applyHomeSectionOrder(dashboard, config) {
  const cards = dashboard.views?.[0]?.sections?.[0]?.cards;
  if (!Array.isArray(cards) || !Array.isArray(config.home_sections)) return dashboard;
  const headerKey = (card) => {
    const title = card?.heading || card?.name;
    if (title === "Personen") return "persons";
    if (title === "Meldungen") return "notifications";
    if (title === "Aktionen") return "quick_actions";
    if (title === "Räume") return "rooms";
    if (title === "Weitere Bereiche") return "navigation";
    return undefined;
  };
  const standaloneKey = (card) => {
    if (card?.card_type === "pop-up") return "popup";
    if (card?.type === "horizontal-stack" && card.cards?.some((x) => x?.entity?.startsWith("person."))) return "persons";
    if (card?.type === "vertical-stack" && card.cards?.[0]?.name === "Meldungen") return "notifications";
    return "other";
  };
  const blocks = [];
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    const sectionKey = headerKey(card);
    const key = sectionKey || standaloneKey(card);
    const block = [card];
    if (sectionKey && cards[index + 1] && !headerKey(cards[index + 1]) && cards[index + 1]?.card_type !== "pop-up") {
      block.push(cards[index + 1]);
      index += 1;
    }
    blocks.push({ key, cards: block, index: blocks.length });
  }
  const order = new Map(config.home_sections.map((key, index) => [key, index]));
  blocks.sort((a, b) => {
    if (a.key === "popup" || b.key === "popup") return a.key === b.key ? a.index - b.index : a.key === "popup" ? 1 : -1;
    const ai = order.has(a.key) ? order.get(a.key) : 999;
    const bi = order.has(b.key) ? order.get(b.key) : 999;
    return ai - bi || a.index - b.index;
  });
  dashboard.views[0].sections[0].cards = blocks.flatMap((x) => x.cards);
  return dashboard;
}

function migrateConfig(config, hass) {
  const previousVersion = Number(config?.config_version) || 0;
  const result = { ...EDITOR_DEFAULTS, ...(config || {}), config_version: CONFIG_VERSION };
  if (previousVersion < 22) {
    const oldNina = String(result.nina_entities || "").trim();
    if (/^binary_sensor\.[a-z0-9_]+$/i.test(oldNina)) result.nina_entities = `${oldNina}*`;
    else if (!normalizeNinaGlob(oldNina)) result.nina_entities = EDITOR_DEFAULTS.nina_entities;
  }
  if (!Array.isArray(result.persons)) result.persons = detectedPersons(hass, []);
  if (!Array.isArray(result.rooms)) result.rooms = detectedRooms(hass, []);
  if (!Array.isArray(result.quick_actions)) result.quick_actions = configuredQuickActions(hass, []);
  const knownSections = ["persons", "notifications", "quick_actions", "rooms", "navigation", "other"];
  if (!Array.isArray(result.home_sections)) result.home_sections = [...knownSections];
  else {
    const merged = [...new Set(result.home_sections.filter((key) => typeof key === "string" && key))];
    for (const key of knownSections) {
      if (merged.includes(key)) continue;
      const otherIndex = merged.indexOf("other");
      if (key === "navigation" && otherIndex >= 0) merged.splice(otherIndex, 0, key);
      else merged.push(key);
    }
    result.home_sections = merged;
  }
  if (!result.features) {
    result.features = Object.fromEntries(
      Object.keys(FEATURE_META).map((key) => [key, {
        enabled: true,
        auto_discover: true,
        entities: [],
        ...(key === "printer" ? { printer_ids: [], excluded_printer_ids: [] } : {}),
      }]),
    );
  } else {
    result.features = Object.fromEntries(
      Object.entries(result.features).map(([key, value]) => [key, { ...(value || {}) }]),
    );
    for (const item of Object.values(result.features)) {
      for (const key of ["entities", "excluded_entities", "printer_ids", "excluded_printer_ids"]) {
        if (item[key] === undefined) continue;
        item[key] = Array.isArray(item[key])
          ? [...new Set(item[key].map(String).map((entry) => entry.trim()).filter(Boolean))]
          : [...new Set(String(item[key]).split(/[\n,\s]+/).map((entry) => entry.trim()).filter(Boolean))];
      }
    }
    if (previousVersion < 21) {
      for (const [key, item] of Object.entries(result.features)) {
        if (!(key in FEATURE_META) || item.auto_discover === false) continue;
        const groups = key === "system" ? normalizedSystemGroups(item.system_groups) : [];
        const autoEntities = new Set(autoFeatureEntities(hass, key, groups));
        if (Array.isArray(item.entities)) {
          item.entities = item.entities.filter((entityId) => !autoEntities.has(entityId));
        }
        if (key === "printer" && Array.isArray(item.printer_ids)) {
          const autoPrinters = new Set(autoBambuPrinterIds(hass));
          item.printer_ids = item.printer_ids.filter((deviceId) => !autoPrinters.has(deviceId));
        }
      }
    }
    if (result.features.system) {
      result.features.system.system_groups = normalizedSystemGroups(
        result.features.system.system_groups,
      );
      result.features.system.system_colors = normalizedSystemColors(
        result.features.system.system_colors,
      );
    }
  }
  return result;
}

const EDITOR_DEFAULTS = {
  config_version: CONFIG_VERSION,
  title: "Handy",
  view_title: "Handy",
  view_icon: "mdi:cellphone",
  show_persons: true,
  show_notifications: true,
  show_quick_actions: true,
  show_rooms: true,
  show_navigation: true,
  dense_section_placement: true,
  max_columns: 1,
  theme: "",
  background: "",
  notification_batteries: true,
  notification_contacts: true,
  notification_co2: true,
  notification_waste: true,
  notification_ups: true,
  notification_frost: true,
  notification_nina: true,
  battery_threshold: 6,
  contact_minutes: 15,
  co2_threshold: 1000,
  frost_threshold: 4,
  waste_days: 1,
  notification_recipients: "",
  battery_exclusions: "",
  frost_entity: "",
  waste_entities: "",
  ups_entities: "",
  nina_entities: "binary_sensor.nina_warning_*",
};

class SmartphoneDashboardStrategyEditor extends HTMLElement {
  setConfig(config) {
    const nextSignature = JSON.stringify(config || {});
    if (this._configInputSignature === nextSignature) return;
    this._blockedBackendConflicts = {};
    this._pendingBackendPatch = {};
    this._inflightBackendPatch = {};
    clearTimeout(this._backendRetryTimer);
    clearTimeout(this._backendSaveTimer);
    this._backendRetryCount = 0;
    this._lifecycleGeneration = (this._lifecycleGeneration || 0) + 1;
    this._backendInitialized = false;
    this._backendReady = false;
    this._configInputSignature = nextSignature;
    this._sourceConfig = config;
    this._config = migrateConfig(config, this._hass);
    this._render();
    if (this._hass && !this._disposed) void this._initializeBackend();
  }

  set hass(hass) {
    const previousHass = this._hass;
    const registrySignature = JSON.stringify([
      valuesOf(hass?.areas).map((x) => [x.area_id, x.name]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      valuesOf(hass?.devices).map((x) => [x.id, x.area_id, x.manufacturer, x.model, x.name, x.name_by_user]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      entityRegistryEntries(hass).map((x) => [x.entity_id, x.area_id, x.device_id, x.disabled_by, x.hidden_by, x.hidden, x.name, x.original_name, x.platform, x.unique_id]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      Object.entries(hass?.states || {}).map(([id, state]) => [id, state?.attributes?.friendly_name, state?.attributes?.device_class, state?.attributes?.unit_of_measurement, state?.attributes?.icon]).sort((a, b) => a[0].localeCompare(b[0])),
      Object.keys(hass?.services?.notify || {}).sort(),
    ]);
    const registryChanged = Boolean(previousHass && this._registrySignature && this._registrySignature !== registrySignature);
    this._registrySignature = registrySignature;
    this._hass = hass;
    if (!previousHass) {
      this._config = migrateConfig(this._sourceConfig || this._config, hass);
      void this._initializeBackend();
    }
    if (!previousHass) this._render();
    else if (registryChanged) this._scheduleSafeRender();
    else this._updateLiveControls();
  }

  connectedCallback() {
    this._disposed = false;
    this._lifecycleGeneration = (this._lifecycleGeneration || 0) + 1;
    if (this._hass && !this._backendReady) void this._initializeBackend();
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._render();
    if (!customElements.get("ha-selector") && !this._selectorLoadRequested) {
      this._selectorLoadRequested = true;
      const helpersReady = typeof window.loadCardHelpers === "function"
        ? window.loadCardHelpers().catch(() => undefined)
        : Promise.resolve();
      void helpersReady.then(() => customElements.whenDefined("ha-selector")).then(() => {
        if (this._selectorUpgradeRendered) return;
        this._selectorUpgradeRendered = true;
        this._scheduleSafeRender();
      });
    }
  }

  disconnectedCallback() {
    this._disposed = true;
    this._lifecycleGeneration = (this._lifecycleGeneration || 0) + 1;
    clearTimeout(this._backendRetryTimer);
    clearTimeout(this._backendSaveTimer);
    this._pendingBackendPatch = { ...(this._inflightBackendPatch || {}), ...(this._pendingBackendPatch || {}) };
    this._backendInitialized = false;
    this._backendReady = false;
  }

  _scheduleSafeRender() {
    const active = this.shadowRoot?.activeElement;
    if (!active) { this._render(); return; }
    if (this._pendingSafeRender) return;
    this._pendingSafeRender = true;
    active.addEventListener("blur", () => {
      this._pendingSafeRender = false;
      const pending = this._pendingNotificationUpdate || Promise.resolve();
      void pending.finally(() => this._render());
    }, { once: true });
  }

  _update(key, value) {
    if (!this._backendReady) (this._localEditsBeforeBackend ||= new Set()).add(key);
    this._config = { ...this._config, [key]: value };
    this._configInputSignature = JSON.stringify(this._config);
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        bubbles: true,
        composed: true,
        detail: { config: this._config },
      }),
    );
    if (this._blockedBackendConflicts) delete this._blockedBackendConflicts[key];
    this._scheduleBackendSave({ [key]: value });
  }

  _dashboardKey() {
    return resolveBackendKey(this._config);
  }

  async _initializeBackend() {
    const generation = this._lifecycleGeneration;
    if ((this._backendInitialized && this._backendInitGeneration === generation) || typeof this._hass?.callWS !== "function") return;
    this._backendInitialized = true;
    this._backendInitGeneration = generation;
    try {
      const requestKey = this._dashboardKey();
      const result = await this._hass.callWS({ type: "smartphone_dashboard/config/get", dashboard_key: requestKey });
      if (this._disposed || generation !== this._lifecycleGeneration) return;
      if (requestKey !== this._dashboardKey()) { this._backendInitialized = false; return void this._initializeBackend(); }
      this._backendRevision = Number(result.revision) || 0;
      this._backendKeyLoaded = requestKey;
      this._backendBase = result.config || {};
      let importedNotifications = false;
      for (const key of Object.keys(NOTIFICATION_HELPERS)) {
        if (Object.prototype.hasOwnProperty.call(this._backendBase, key) && !Object.prototype.hasOwnProperty.call(this._sourceConfig || {}, key) && !this._localEditsBeforeBackend?.has(key)) {
          this._config[key] = this._backendBase[key]; importedNotifications = true;
        }
      }
      if (importedNotifications) {
        this._configInputSignature = JSON.stringify(this._config);
        this.dispatchEvent(new CustomEvent("config-changed", { bubbles: true, composed: true, detail: { config: this._config } }));
      }
      if (!Object.keys(this._backendBase).length) this._pendingBackendPatch = { ...this._config, ...(this._pendingBackendPatch || {}) };
      this._backendReady = true; this._localEditsBeforeBackend = new Set(); this._scheduleBackendSave({});
      if (importedNotifications) this._scheduleSafeRender();
    } catch (error) {
      if (this._disposed || generation !== this._lifecycleGeneration) return;
      this._backendInitialized = false; this._showBackendStatus(`Backend nicht verfügbar: ${error?.message || error}. Erneut versuchen nach der nächsten Änderung.`, true);
    }
  }

  _scheduleBackendSave(patch = {}) {
    if (this._disposed) return;
    patch = Object.fromEntries(Object.entries(patch).filter(([key]) => !Object.prototype.hasOwnProperty.call(this._blockedBackendConflicts || {}, key)));
    this._pendingBackendPatch = { ...(this._pendingBackendPatch || {}), ...patch };
    if (!this._backendReady) { if (!this._backendInitialized) void this._initializeBackend(); return; }
    clearTimeout(this._backendSaveTimer);
    this._backendSaveTimer = setTimeout(() => {
      const snapshot = structuredClone(this._pendingBackendPatch || {}); this._pendingBackendPatch = {};
      if (!Object.keys(snapshot).length) return;
      this._inflightBackendPatch = { ...(this._inflightBackendPatch || {}), ...snapshot };
      const saveKey = this._dashboardKey();
      const generation = this._lifecycleGeneration;
      this._backendSaveQueue = (this._backendSaveQueue || Promise.resolve()).then(async () => {
        if (this._disposed || generation !== this._lifecycleGeneration) return;
        try {
          if (saveKey !== this._dashboardKey() || saveKey !== this._backendKeyLoaded) {
            this._pendingBackendPatch = { ...snapshot, ...(this._pendingBackendPatch || {}) };
            this._backendReady = false; this._backendInitialized = false; return void this._initializeBackend();
          }
          let result;
          for (let casAttempt = 0; casAttempt < 3; casAttempt += 1) {
            result = await this._hass.callWS({ type: "smartphone_dashboard/config/save", dashboard_key: saveKey, revision: this._backendRevision, patch: snapshot });
            if (this._disposed || generation !== this._lifecycleGeneration) return;
            if (!result.conflict) break;
            const { overlap, retryable } = partitionConflictPatch(snapshot, result.config, this._backendBase);
            if (overlap.length) {
              this._backendRevision = result.revision;
              this._backendBase = result.config || {};
              this._blockedBackendConflicts = { ...(this._blockedBackendConflicts || {}), ...Object.fromEntries(overlap.map((key) => [key, snapshot[key]])) };
              this._pendingBackendPatch = { ...retryable, ...(this._pendingBackendPatch || {}) };
              for (const [key, value] of Object.entries(snapshot)) if (JSON.stringify(this._inflightBackendPatch?.[key]) === JSON.stringify(value)) delete this._inflightBackendPatch[key];
              this._showBackendStatus(`Konflikt bei ${overlap.join(", ")}. Änderungen nicht überschrieben; bitte neu laden oder bewusst erneut ändern.`, true);
              if (Object.keys(retryable).length) this._scheduleBackendSave({});
              return;
            }
            this._backendRevision = result.revision;
            this._backendBase = result.config || {};
            if (casAttempt === 2) {
              this._pendingBackendPatch = { ...snapshot, ...(this._pendingBackendPatch || {}) };
              for (const [key, value] of Object.entries(snapshot)) if (JSON.stringify(this._inflightBackendPatch?.[key]) === JSON.stringify(value)) delete this._inflightBackendPatch[key];
              this._showBackendStatus("Backend-Konflikt konnte nicht automatisch aufgelöst werden. Änderung bleibt vorgemerkt; bitte Feld erneut ändern oder Editor neu verbinden.", true);
              return;
            }
          }
          if (this._disposed || generation !== this._lifecycleGeneration) return;
          this._backendRevision = result.revision; this._backendBase = { ...(result.config || this._backendBase), ...snapshot };
          for (const [key, value] of Object.entries(snapshot)) if (JSON.stringify(this._inflightBackendPatch?.[key]) === JSON.stringify(value)) delete this._inflightBackendPatch[key];
          this._backendRetryCount = 0;
          if (!Object.keys(this._pendingBackendPatch || {}).length && !Object.keys(this._blockedBackendConflicts || {}).length) this._showBackendStatus("Backend-Konfiguration gespeichert.", false);
        } catch (error) {
          if (this._disposed || generation !== this._lifecycleGeneration) return;
          this._pendingBackendPatch = { ...snapshot, ...(this._pendingBackendPatch || {}) };
          for (const [key, value] of Object.entries(snapshot)) if (JSON.stringify(this._inflightBackendPatch?.[key]) === JSON.stringify(value)) delete this._inflightBackendPatch[key];
          clearTimeout(this._backendRetryTimer);
          this._backendRetryCount = Math.min(8, (this._backendRetryCount || 0) + 1);
          if (!this._disposed && this._backendRetryCount < 8) {
            this._showBackendStatus(`Backend-Speichern fehlgeschlagen: ${error?.message || error}. Änderung bleibt vorgemerkt; automatischer neuer Versuch.`, true);
            this._backendRetryTimer = setTimeout(() => this._scheduleBackendSave({}), Math.min(60000, 2000 * (2 ** (this._backendRetryCount - 1))));
          } else {
            this._showBackendStatus(`Backend-Speichern wiederholt fehlgeschlagen: ${error?.message || error}. Änderung bleibt vorgemerkt; bitte Feld erneut ändern oder Editor neu verbinden.`, true);
          }
        }
      });
    }, 250);
  }

  _showBackendStatus(message, error) {
    const status = this.shadowRoot?.querySelector("[data-backend-status]");
    if (status) { status.textContent = message; status.classList.toggle("error", error); }
  }

  _effectiveSetting(key) {
    const helperValue = notificationSetting(this._config, this._hass, key);
    const value = helperValue === undefined ? this._config[key] : helperValue;
    if (["battery_threshold", "contact_minutes", "co2_threshold", "frost_threshold", "waste_days"].includes(key)) {
      const number = Number(value);
      return Number.isFinite(number) && String(value).trim() !== ""
        ? number
        : EDITOR_DEFAULTS[key];
    }
    return value;
  }

  _updateLiveControls() {
    if (!this.shadowRoot || !this._config) return;
    const activeElement = this.shadowRoot.activeElement;
    for (const selector of this.shadowRoot.querySelectorAll("ha-selector")) selector.hass = this._hass;

    for (const field of this.shadowRoot.querySelectorAll("[data-notification-number]")) {
      if (field !== activeElement) {
        field.value = String(this._effectiveSetting(field.dataset.notificationNumber));
      }
    }
    for (const field of this.shadowRoot.querySelectorAll("[data-notification-text]")) {
      if (field !== activeElement) {
        field.value = String(this._effectiveSetting(field.dataset.notificationText) || "");
      }
    }
    for (const toggle of this.shadowRoot.querySelectorAll("[data-switch^='notification_']")) {
      toggle.checked = this._effectiveSetting(toggle.dataset.switch) !== false;
    }

    const synchronization = synchronizationStatus(this._config, this._hass);
    const status = this.shadowRoot.querySelector("[data-sync-status]");
    if (status) {
      status.classList.toggle("incomplete", !synchronization.active);
      status.querySelector("ha-icon")?.setAttribute(
        "icon",
        synchronization.active ? "mdi:check-circle-outline" : "mdi:alert-circle-outline",
      );
      const title = status.querySelector("[data-sync-title]");
      const detail = status.querySelector("[data-sync-detail]");
      if (title) title.textContent = synchronization.title;
      if (detail) detail.textContent = synchronization.detail;
    }
  }

  _updateNotificationSetting(key, value) {
    const previous = this._notificationUpdateQueue || Promise.resolve();
    const operation = previous.catch(() => undefined).then(() =>
      this._performNotificationSettingUpdate(key, value),
    );
    this._notificationUpdateQueue = operation;
    this._pendingNotificationUpdate = operation;
    void operation.finally(() => {
      if (this._pendingNotificationUpdate === operation) this._pendingNotificationUpdate = undefined;
      if (this._notificationUpdateQueue === operation) this._notificationUpdateQueue = undefined;
    });
    return operation;
  }

  async _performNotificationSettingUpdate(key, value) {
    const serviceStatus = this.shadowRoot?.querySelector("[data-notification-service-status]");
    try {
      const helper = NOTIFICATION_HELPERS[key];
      if (helper && this._hass?.states?.[helper]) {
        const domain = helper.split(".")[0];
        if (domain === "input_boolean") {
          await this._hass.callService(
            "input_boolean",
            value ? "turn_on" : "turn_off",
            {},
            { entity_id: helper },
          );
        } else if (domain === "input_number") {
          await this._hass.callService(
            "input_number",
            "set_value",
            { value },
            { entity_id: helper },
          );
        } else {
          await this._hass.callService(
            "input_text",
            "set_value",
            { value },
            { entity_id: helper },
          );
        }
      }
      this._update(key, value);
      if (serviceStatus) {
        serviceStatus.classList.remove("error");
        serviceStatus.textContent = "Einstellung wurde gespeichert.";
      }
    } catch (error) {
      if (serviceStatus) {
        serviceStatus.classList.add("error");
        serviceStatus.textContent = `Speichern fehlgeschlagen: ${error?.message || error}`;
      }
    }
  }

  _updateRoom(areaId, changes) {
    const rooms = detectedRooms(this._hass, this._config.rooms).map((room) =>
      room.area_id === areaId ? { ...room, ...changes } : room,
    );
    this._update("rooms", rooms);
    this._render();
  }

  _updatePerson(entityId, changes) {
    const persons = detectedPersons(this._hass, this._config.persons).map((person) =>
      person.entity === entityId ? { ...person, ...changes } : person,
    );
    this._update("persons", persons);
    this._render();
  }

  _selectorValue(event, multiple = false) {
    const value = event?.detail?.value ?? event?.currentTarget?.value;
    if (!multiple) return typeof value === "string" ? value.trim() : "";
    if (Array.isArray(value)) return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))];
    return [...new Set(String(value || "").split(/[\n,\s]+/).map((item) => item.trim()).filter(Boolean))];
  }

  _createSelector({ label, selector, value, multiple = false, onChange, fallbackOptions = [] }) {
    const field = document.createElement("label");
    field.className = "select-label selector-field";
    const caption = document.createElement("span");
    caption.textContent = label;
    field.appendChild(caption);
    if (customElements.get("ha-selector")) {
      const picker = document.createElement("ha-selector");
      picker.hass = this._hass;
      picker.label = label;
      picker.setAttribute("aria-label", label);
      picker.selector = selector;
      picker.value = multiple
        ? (Array.isArray(value) ? value : this._selectorValue({ currentTarget: { value } }, true))
        : String(value || "");
      picker.addEventListener("value-changed", (event) => onChange(this._selectorValue(event, multiple)));
      field.appendChild(picker);
      return field;
    }
    if (multiple) {
      const values = Array.isArray(value) ? [...value] : this._selectorValue({ currentTarget: { value } }, true);
      const tokenBox = document.createElement("div"); tokenBox.className = "token-picker";
      const tokens = document.createElement("div"); tokens.className = "tokens";
      const controls = document.createElement("div"); controls.className = "token-controls";
      const input = document.createElement("input"); input.className = "selector-fallback"; input.setAttribute("aria-label", label);
      const add = document.createElement("button"); add.type = "button"; add.textContent = "Hinzufügen";
      const listId = `selector-${++this._selectorListCounter || (this._selectorListCounter = 1)}`;
      if (fallbackOptions.length) input.setAttribute("list", listId);
      const list = document.createElement("datalist"); list.id = listId;
      for (const option of fallbackOptions) { const el = document.createElement("option"); el.value = typeof option === "string" ? option : option.value; el.label = typeof option === "string" ? option : option.label; list.appendChild(el); }
      const emit = () => onChange([...values]);
      const paint = () => { tokens.replaceChildren(...values.map((entry) => { const chip = document.createElement("span"); chip.className = "token"; chip.textContent = entry; const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.setAttribute("aria-label", `${entry} entfernen`); remove.addEventListener("click", () => { values.splice(values.indexOf(entry), 1); paint(); emit(); }); chip.appendChild(remove); return chip; })); };
      const addValue = () => { const entries = this._selectorValue({ currentTarget: input }, true); for (const entry of entries) if (!values.includes(entry)) values.push(entry); input.value = ""; paint(); emit(); };
      add.addEventListener("click", addValue); input.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); addValue(); } });
      input.addEventListener("blur", () => { if (input.value.trim()) addValue(); });
      controls.append(input, add); tokenBox.append(tokens, controls, list); field.appendChild(tokenBox); paint(); return field;
    }
    const fallback = document.createElement("input");
    fallback.className = "selector-fallback";
    fallback.setAttribute("aria-label", label);
    {
      fallback.type = "text";
      fallback.value = String(value || "");
      if (fallbackOptions.length) {
        const listId = `selector-${Math.random().toString(36).slice(2)}`;
        fallback.setAttribute("list", listId);
        const list = document.createElement("datalist");
        list.id = listId;
        for (const option of fallbackOptions) {
          const element = document.createElement("option");
          element.value = typeof option === "string" ? option : option.value;
          element.label = typeof option === "string" ? option : option.label;
          list.appendChild(element);
        }
        field.appendChild(list);
      }
    }
    fallback.addEventListener("change", (event) => onChange(this._selectorValue(event, false)));
    field.appendChild(fallback);
    return field;
  }

  _entitySelector(label, value, options, onChange) {
    const { multiple = false, domain, device_class: deviceClass, include_entities: includeEntities } = options || {};
    const filter = {};
    if (domain) filter.domain = domain;
    if (deviceClass) filter.device_class = deviceClass;
    const registry = entityRegistryMap(this._hass);
    return this._createSelector({
      label,
      value,
      multiple,
      selector: { entity: { multiple, ...(Object.keys(filter).length ? { filter } : {}), ...(includeEntities ? { include_entities: includeEntities } : {}) } },
      fallbackOptions: Object.keys(this._hass?.states || {}).filter((entityId) =>
        isEntityVisible(this._hass, entityId, registry) &&
        (!domain || entityId.startsWith(`${domain}.`)) && (!includeEntities || includeEntities.includes(entityId)),
      ),
      onChange,
    });
  }

  _iconSelector(label, value, onChange) {
    return this._createSelector({ label, value, selector: { icon: {} }, onChange });
  }

  _renderPersons(container) {
    const persons = detectedPersons(this._hass, this._config.persons);
    if (!persons.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "Keine Personen-Entitäten erkannt.";
      container.appendChild(empty);
      return;
    }

    const registry = entityRegistryMap(this._hass);
    const travelSensors = Object.keys(this._hass?.states || {}).filter((entityId) => {
      if (!entityId.startsWith("sensor.") || !isEntityVisible(this._hass, entityId, registry)) return false;
      const state = this._hass.states[entityId];
      const unit = state?.attributes?.unit_of_measurement;
      return unit === "min" || /travel|fahrt|fahrzeit|home_travel/i.test(entityId);
    });

    for (const person of persons) {
      const item = document.createElement("div");
      item.className = "person-item";
      item.draggable = true;
      item.dataset.personEntity = person.entity;

      const row = document.createElement("div");
      row.className = "person-row";
      row.innerHTML = `
        <span class="drag" title="Ziehen zum Sortieren">⋮⋮</span>
        <ha-icon icon="mdi:account"></ha-icon>
        <div class="person-copy"><div class="person-name"></div><div class="person-id"></div></div>
        <ha-switch></ha-switch>
      `;
      row.querySelector(".person-name").textContent =
        this._hass?.states?.[person.entity]?.attributes?.friendly_name || person.entity;
      row.querySelector(".person-id").textContent = person.entity;
      const toggle = row.querySelector("ha-switch");
      toggle.checked = person.enabled !== false;
      toggle.addEventListener("change", (event) =>
        this._updatePerson(person.entity, { enabled: event.currentTarget.checked }),
      );

      const candidates = [...new Set([person.travel_sensor, ...travelSensors].filter(Boolean))];
      const sensorLabel = this._entitySelector(
        "Fahrzeitsensor nach Hause (optional)",
        person.travel_sensor,
        { domain: "sensor" },
        (value) => this._updatePerson(person.entity, { travel_sensor: value }),
      );
      sensorLabel.classList.add("person-sensor");

      item.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", person.entity);
        event.dataTransfer.effectAllowed = "move";
        item.classList.add("dragging");
      });
      item.addEventListener("dragend", () => item.classList.remove("dragging"));
      item.addEventListener("dragover", (event) => event.preventDefault());
      item.addEventListener("drop", (event) => {
        event.preventDefault();
        const sourceId = event.dataTransfer.getData("text/plain");
        if (!sourceId || sourceId === person.entity) return;
        const ordered = detectedPersons(this._hass, this._config.persons);
        const sourceIndex = ordered.findIndex((entry) => entry.entity === sourceId);
        const targetIndex = ordered.findIndex((entry) => entry.entity === person.entity);
        if (sourceIndex < 0 || targetIndex < 0) return;
        const [moved] = ordered.splice(sourceIndex, 1);
        ordered.splice(targetIndex, 0, moved);
        this._update("persons", ordered);
        this._render();
      });

      item.append(row, sensorLabel);
      container.appendChild(item);
    }
  }

  _renderQuickActions(container) {
    const actions = configuredQuickActions(this._hass, this._config.quick_actions);
    const registry = entityRegistryMap(this._hass);
    const available = Object.keys(this._hass?.states || {})
      .filter((entityId) => entityId.startsWith("script.") && isEntityVisible(this._hass, entityId, registry) && !actions.includes(entityId))
      .sort((a, b) => {
        const nameA = this._hass.states[a]?.attributes?.friendly_name || a;
        const nameB = this._hass.states[b]?.attributes?.friendly_name || b;
        return nameA.localeCompare(nameB, "de");
      });

    const addRow = document.createElement("div");
    addRow.className = "action-add";
    let selectedScript = "";
    const select = this._entitySelector("Script auswählen", "", { domain: "script", include_entities: available }, (value) => { selectedScript = value; });
    const feedback = document.createElement("div"); feedback.className = "field-error";
    const add = document.createElement("button");
    add.type = "button";
    add.textContent = "Hinzufügen";
    add.disabled = !available.length;
    add.addEventListener("click", () => {
      if (!selectedScript) { feedback.textContent = "Bitte zuerst ein Script auswählen."; return; }
      if (actions.includes(selectedScript)) { feedback.textContent = "Dieses Script ist bereits als Schnellaktion enthalten."; return; }
      this._update("quick_actions", [...actions, selectedScript]);
      this._render();
    });
    addRow.append(select, add);
    container.append(addRow, feedback);

    if (!actions.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "Noch keine Schnellaktionen ausgewählt.";
      container.appendChild(empty);
    }

    for (const entityId of actions) {
      const item = document.createElement("div");
      item.className = "action-item";
      item.draggable = true;
      item.dataset.actionEntity = entityId;
      item.innerHTML = `<span class="drag">⋮⋮</span><ha-icon></ha-icon><div class="action-copy"><div class="action-name"></div><div class="action-id"></div></div><button type="button" title="Entfernen">×</button>`;
      item.querySelector("ha-icon").setAttribute(
        "icon",
        this._hass.states[entityId]?.attributes?.icon || "mdi:script-text-outline",
      );
      item.querySelector(".action-name").textContent =
        this._hass.states[entityId]?.attributes?.friendly_name || `${entityId} (nicht verfügbar)`;
      item.querySelector(".action-id").textContent = entityId;
      item.querySelector("button").addEventListener("click", () => {
        this._update(
          "quick_actions",
          actions.filter((action) => action !== entityId),
        );
        this._render();
      });
      item.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", entityId);
        item.classList.add("dragging");
      });
      item.addEventListener("dragend", () => item.classList.remove("dragging"));
      item.addEventListener("dragover", (event) => event.preventDefault());
      item.addEventListener("drop", (event) => {
        event.preventDefault();
        const source = event.dataTransfer.getData("text/plain");
        if (!source || source === entityId) return;
        const ordered = [...actions];
        const sourceIndex = ordered.indexOf(source);
        const targetIndex = ordered.indexOf(entityId);
        if (sourceIndex < 0 || targetIndex < 0) return;
        const [moved] = ordered.splice(sourceIndex, 1);
        ordered.splice(targetIndex, 0, moved);
        this._update("quick_actions", ordered);
        this._render();
      });
      container.appendChild(item);
    }
  }

  _renderRooms(container) {
    const rooms = detectedRooms(this._hass, this._config.rooms);

    if (!rooms.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "Noch keine Home-Assistant-Bereiche erkannt.";
      container.appendChild(empty);
      return;
    }

    for (const room of rooms) {
      const item = document.createElement("div");
      item.className = "room-item";
      item.draggable = true;
      item.dataset.areaId = room.area_id;

      const header = document.createElement("div");
      header.className = "room-header";
      header.innerHTML = `
        <span class="drag" title="Ziehen zum Sortieren">⋮⋮</span>
        <ha-icon></ha-icon>
        <div class="room-name"></div>
        <ha-switch></ha-switch>
        <button class="expand" type="button" title="Raum konfigurieren">⌄</button>
      `;
      header.querySelector("ha-icon").setAttribute("icon", room.icon || "mdi:floor-plan");
      header.querySelector(".room-name").textContent = room.name;
      const enabled = header.querySelector("ha-switch");
      enabled.checked = room.enabled !== false;
      enabled.addEventListener("change", (event) =>
        this._updateRoom(room.area_id, { enabled: event.currentTarget.checked }),
      );

      const body = document.createElement("div");
      body.className = "room-body";
      body.hidden = !this._expandedRooms?.has(room.area_id);
      header.querySelector(".expand").textContent = body.hidden ? "⌄" : "⌃";

      const icon = this._iconSelector("Icon", room.icon, (value) =>
        this._updateRoom(room.area_id, { icon: value }),
      );
      body.appendChild(icon);

      const lightLabel = this._entitySelector("Hauptlicht", room.main_light, { domain: "light" }, (value) =>
        this._updateRoom(room.area_id, { main_light: value }),
      );
      body.appendChild(lightLabel);

      const entityTitle = document.createElement("div");
      entityTitle.className = "entity-title";
      entityTitle.textContent = "Entitäten im Raum";
      body.appendChild(entityTitle);

      const entityIds = entitiesForArea(this._hass, room.area_id);
      if (!entityIds.length) {
        const empty = document.createElement("p");
        empty.className = "hint";
        empty.textContent = "Keine sichtbaren Entitäten gefunden.";
        body.appendChild(empty);
      }

      for (const entityId of entityIds) {
        const label = document.createElement("label");
        label.className = "entity-row";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = !(room.hidden_entities || []).includes(entityId);
        const copy = document.createElement("span");
        const friendlyName =
          this._hass?.states?.[entityId]?.attributes?.friendly_name || entityId;
        copy.textContent = `${friendlyName} · ${entityId}`;
        checkbox.addEventListener("change", (event) => {
          const hidden = new Set(room.hidden_entities || []);
          if (event.currentTarget.checked) hidden.delete(entityId);
          else hidden.add(entityId);
          this._updateRoom(room.area_id, { hidden_entities: [...hidden] });
        });
        label.append(checkbox, copy);
        body.appendChild(label);
      }

      header.querySelector(".expand").addEventListener("click", () => {
        body.hidden = !body.hidden;
        if (body.hidden) this._expandedRooms.delete(room.area_id);
        else this._expandedRooms.add(room.area_id);
        header.querySelector(".expand").textContent = body.hidden ? "⌄" : "⌃";
      });

      item.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", room.area_id);
        event.dataTransfer.effectAllowed = "move";
        item.classList.add("dragging");
      });
      item.addEventListener("dragend", () => item.classList.remove("dragging"));
      item.addEventListener("dragover", (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      });
      item.addEventListener("drop", (event) => {
        event.preventDefault();
        const sourceId = event.dataTransfer.getData("text/plain");
        if (!sourceId || sourceId === room.area_id) return;
        const ordered = detectedRooms(this._hass, this._config.rooms);
        const sourceIndex = ordered.findIndex((entry) => entry.area_id === sourceId);
        const targetIndex = ordered.findIndex((entry) => entry.area_id === room.area_id);
        if (sourceIndex < 0 || targetIndex < 0) return;
        const [moved] = ordered.splice(sourceIndex, 1);
        ordered.splice(targetIndex, 0, moved);
        this._update("rooms", ordered);
        this._render();
      });

      item.append(header, body);
      container.appendChild(item);
    }
  }

  _renderSystemFeatureSettings(container, feature, updateFeature) {
    const settings = document.createElement("div");
    settings.className = "system-settings";
    settings.innerHTML = `
      <div class="entity-title">Systemgruppen</div>
      <p class="hint">Das erste passende reguläre Ausdrucksmuster bestimmt die Gruppe. Eine Gruppe ohne Muster dient als Auffanggruppe.</p>
      <div class="system-groups"></div>
      <button class="system-add" type="button">Gruppe hinzufügen</button>
      <div class="entity-title">Diagrammfarben</div>
      <div class="system-colors"></div>
    `;

    const currentGroups = () => normalizedSystemGroups(
      this._config.features?.system?.system_groups || feature.system_groups,
    );
    const saveGroups = (groups) => updateFeature({ system_groups: groups });
    const groupsContainer = settings.querySelector(".system-groups");
    const groups = currentGroups();
    groups.forEach((group, index) => {
      const item = document.createElement("div");
      item.className = "system-group-item";
      const suggestionId = `system-entities-${String(group.id).replace(/[^a-z0-9_-]/gi, "-")}-${index}`;
      item.innerHTML = `
        <div class="system-group-head">
          <ha-icon></ha-icon><strong></strong>
          <div class="system-group-actions"><button data-up type="button" title="Nach oben">↑</button><button data-down type="button" title="Nach unten">↓</button><button data-remove type="button" title="Entfernen">×</button></div>
        </div>
        <label class="native-field">Name<input data-group-name type="text"></label>
        <div data-group-icon-host></div>
        <label class="native-field">Erkennungsmuster für Entity-IDs<input data-group-pattern type="text" list="${suggestionId}" placeholder="z. B. opnsense|firewall"><datalist id="${suggestionId}"></datalist></label>
      `;
      item.querySelector("ha-icon").setAttribute("icon", group.icon);
      item.querySelector("strong").textContent = group.name;
      const name = item.querySelector("[data-group-name]");
      const pattern = item.querySelector("[data-group-pattern]");
      name.value = group.name;
      pattern.value = group.pattern;
      const suggestions = item.querySelector(`#${suggestionId}`);
      const registry = entityRegistryMap(this._hass);
      for (const entityId of Object.keys(this._hass?.states || {}).filter(
        (id) => id.startsWith("sensor.") && isEntityVisible(this._hass, id, registry),
      )) {
        const option = document.createElement("option"); option.value = entityId; suggestions.appendChild(option);
      }
      const patternError = document.createElement("div");
      patternError.className = "field-error";
      const showPatternError = () => {
        const valid = isValidRegularExpression(pattern.value.trim());
        pattern.classList.toggle("invalid", !valid);
        patternError.textContent = valid ? "" : "Ungültiger regulärer Ausdruck. Das Muster wird nicht verwendet.";
        return valid;
      };
      showPatternError();
      pattern.closest("label")?.appendChild(patternError);
      const updateGroup = (changes) => saveGroups(currentGroups().map((entry) =>
        entry.id === group.id ? { ...entry, ...changes } : entry,
      ));
      name.addEventListener("change", (event) => updateGroup({ name: event.currentTarget.value.trim() || group.name }));
      item.querySelector("[data-group-icon-host]").replaceWith(this._iconSelector("Icon", group.icon, (value) =>
        updateGroup({ icon: value || "mdi:server" }),
      ));
      pattern.addEventListener("input", showPatternError);
      pattern.addEventListener("change", (event) => {
        if (!showPatternError()) return;
        updateGroup({ pattern: event.currentTarget.value.trim() });
      });
      item.querySelector("[data-up]").disabled = index === 0;
      item.querySelector("[data-down]").disabled = index === groups.length - 1;
      item.querySelector("[data-remove]").disabled = groups.length === 1;
      const move = (offset) => {
        const ordered = currentGroups();
        const from = ordered.findIndex((entry) => entry.id === group.id);
        const to = from + offset;
        if (from < 0 || to < 0 || to >= ordered.length) return;
        ordered.splice(to, 0, ordered.splice(from, 1)[0]);
        saveGroups(ordered);
        this._render();
      };
      item.querySelector("[data-up]").addEventListener("click", () => move(-1));
      item.querySelector("[data-down]").addEventListener("click", () => move(1));
      item.querySelector("[data-remove]").addEventListener("click", () => {
        saveGroups(currentGroups().filter((entry) => entry.id !== group.id));
        this._render();
      });
      groupsContainer.appendChild(item);
    });

    settings.querySelector(".system-add").addEventListener("click", () => {
      const groups = currentGroups();
      groups.push({
        id: `system_${Date.now()}`,
        name: `Gruppe ${groups.length + 1}`,
        icon: "mdi:server",
        pattern: "",
      });
      saveGroups(groups);
      this._render();
    });

    const colorMeta = {
      cpu: "CPU",
      memory: "Arbeitsspeicher",
      buffers: "Speicherpuffer",
      download: "Download",
      upload: "Upload",
      storage: "Datenspeicher",
      ups: "USV-Last",
      power: "Leistung",
      other: "Sonstige Sensoren",
    };
    const colorsContainer = settings.querySelector(".system-colors");
    const colors = normalizedSystemColors(feature.system_colors);
    for (const [key, label] of Object.entries(colorMeta)) {
      const field = document.createElement("label");
      field.className = "native-field";
      field.innerHTML = `${label}<div class="color-row"><input type="color" data-color-picker><input type="text" data-system-color><span class="color-preview"></span></div><span class="field-error"></span>`;
      const input = field.querySelector("[data-system-color]");
      const picker = field.querySelector("[data-color-picker]");
      const preview = field.querySelector(".color-preview");
      const error = field.querySelector(".field-error");
      input.value = colors[key];
      if (/^#[0-9a-f]{6}$/i.test(colors[key])) picker.value = colors[key];
      const validateColor = () => {
        const valid = isSafeCssColor(input.value);
        input.classList.toggle("invalid", !valid);
        error.textContent = valid ? "" : "Ungültiger oder unsicherer CSS-Farbwert.";
        preview.style.background = valid ? input.value : "transparent";
        return valid;
      };
      input.addEventListener("input", validateColor);
      input.addEventListener("change", (event) => {
        if (!validateColor()) return;
        updateFeature({
          system_colors: {
            ...normalizedSystemColors(this._config.features?.system?.system_colors || feature.system_colors),
            [key]: event.currentTarget.value.trim(),
          },
        });
      });
      picker.addEventListener("input", (event) => {
        input.value = event.currentTarget.value;
        validateColor();
      });
      picker.addEventListener("change", (event) => updateFeature({
        system_colors: {
          ...normalizedSystemColors(this._config.features?.system?.system_colors || feature.system_colors),
          [key]: event.currentTarget.value,
        },
      }));
      validateColor();
      colorsContainer.appendChild(field);
    }
    container.appendChild(settings);
  }

  _render() {
    if (!this.shadowRoot || !this._config) return;

    const renderedPanels = [...this.shadowRoot.querySelectorAll("details[data-panel]")];
    if (renderedPanels.length) {
      this._openPanels = new Set(
        renderedPanels.filter((panel) => panel.open).map((panel) => panel.dataset.panel),
      );
    } else if (!this._openPanels) {
      this._openPanels = new Set(["general", "home"]);
    }

    const renderedRooms = [...this.shadowRoot.querySelectorAll(".room-item")];
    if (renderedRooms.length) {
      this._expandedRooms = new Set(
        renderedRooms
          .filter((item) => !item.querySelector(".room-body")?.hidden)
          .map((item) => item.dataset.areaId),
      );
    } else if (!this._expandedRooms) {
      this._expandedRooms = new Set();
    }

    const panelOpen = (panel) => (this._openPanels.has(panel) ? "open" : "");
    const synchronization = synchronizationStatus(this._config, this._hass);

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .editor { display: grid; gap: 14px; color: var(--primary-text-color); }
        .intro { padding: 4px 2px 8px; }
        h2 { margin: 0 0 6px; font-size: 22px; }
        .version { display: inline-flex; margin-left: 8px; padding: 3px 7px; border-radius: 999px; color: var(--primary-color); background: color-mix(in srgb, var(--primary-color) 14%, transparent); font-size: 11px; vertical-align: middle; }
        .intro p, .hint { margin: 0; color: var(--secondary-text-color); line-height: 1.45; }
        .hint.error { color: var(--error-color); }
        details {
          border: 1px solid var(--divider-color);
          border-radius: 16px;
          background: var(--ha-card-background, var(--card-background-color));
          overflow: hidden;
        }
        summary {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px;
          cursor: pointer;
          font-size: 17px;
          font-weight: 600;
          list-style: none;
        }
        summary::-webkit-details-marker { display: none; }
        summary::after { content: "›"; margin-left: auto; font-size: 25px; transform: rotate(90deg); }
        details[open] summary::after { transform: rotate(-90deg); }
        summary ha-icon { color: var(--primary-color); }
        .panel { display: grid; gap: 16px; padding: 0 16px 18px; }
        ha-textfield { width: 100%; }
        .switch-row {
          display: flex;
          align-items: center;
          gap: 14px;
          min-height: 46px;
        }
        .switch-copy { flex: 1; }
        .switch-title { font-weight: 500; }
        .switch-description { margin-top: 3px; color: var(--secondary-text-color); font-size: 13px; }
        .footer { padding: 4px 2px; font-size: 13px; }
        .rooms-panel { gap: 10px; }
        .persons-panel { gap: 10px; }
        .person-item { border: 1px solid var(--divider-color); border-radius: 12px; padding: 10px 12px 12px; }
        .person-item.dragging { opacity: .45; }
        .person-row { display: flex; align-items: center; gap: 10px; }
        .person-row ha-icon { color: var(--primary-color); }
        .person-copy { flex: 1; min-width: 0; }
        .person-name { font-weight: 600; }
        .person-id { overflow: hidden; color: var(--secondary-text-color); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
        .person-sensor { margin: 10px 0 0 42px; }
        .actions-panel { gap: 10px; }
        .action-add { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
        .action-add button, .action-item button { border: 0; border-radius: 8px; padding: 0 14px; color: var(--text-primary-color, white); background: var(--primary-color); cursor: pointer; }
        .action-add button:disabled { opacity: .45; cursor: default; }
        .action-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--divider-color); border-radius: 12px; }
        .action-item.dragging { opacity: .45; }
        .action-item ha-icon { color: var(--primary-color); }
        .action-copy { flex: 1; min-width: 0; }
        .action-name { font-weight: 600; }
        .action-id { overflow: hidden; color: var(--secondary-text-color); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
        .action-item button { width: 34px; height: 34px; padding: 0; font-size: 20px; background: transparent; color: var(--error-color); }
        .sync-status { display: flex; align-items: center; gap: 10px; padding: 12px; border-radius: 12px; background: color-mix(in srgb, var(--success-color, #22c55e) 14%, transparent); }
        .sync-status.incomplete { background: color-mix(in srgb, var(--warning-color, #f59e0b) 16%, transparent); }
        .sync-status ha-icon { color: var(--success-color, #22c55e); }
        .sync-status.incomplete ha-icon { color: var(--warning-color, #f59e0b); }
        .sync-status > div { min-width: 0; }
        .sync-title { font-weight: 700; }
        .sync-detail { overflow-wrap: anywhere; color: var(--secondary-text-color); font-size: 12px; }
        .room-item { border: 1px solid var(--divider-color); border-radius: 12px; overflow: hidden; }
        .room-item.dragging { opacity: .45; }
        .room-header { display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
        .drag { cursor: grab; color: var(--secondary-text-color); letter-spacing: -3px; }
        .room-header ha-icon { color: var(--primary-color); }
        .room-name { flex: 1; font-weight: 600; }
        .expand { border: 0; background: transparent; color: var(--primary-text-color); font-size: 20px; cursor: pointer; }
        .room-body { display: grid; gap: 12px; padding: 4px 12px 14px 42px; }
        .room-body[hidden] { display: none; }
        .select-label { display: grid; gap: 6px; color: var(--secondary-text-color); font-size: 12px; }
        select, .native-field input { width: 100%; box-sizing: border-box; padding: 11px; border: 1px solid var(--divider-color); border-radius: 8px; color: var(--primary-text-color); background: var(--card-background-color); font: inherit; }
        .native-field { display: grid; gap: 6px; color: var(--secondary-text-color); font-size: 12px; }
        .native-field input:focus { outline: 2px solid var(--primary-color); outline-offset: 1px; }
        .native-field input.invalid, textarea.invalid { border-color: var(--error-color); outline-color: var(--error-color); }
        .selector-field ha-selector { width: 100%; }
        .selector-fallback { width: 100%; box-sizing: border-box; padding: 11px; border: 1px solid var(--divider-color); border-radius: 8px; color: var(--primary-text-color); background: var(--card-background-color); font: inherit; }
        .token-picker, .tokens { display: grid; gap: 7px; }
        .tokens { display: flex; flex-wrap: wrap; }
        .token { display: inline-flex; align-items: center; gap: 5px; padding: 5px 8px; border-radius: 999px; color: var(--primary-text-color); background: color-mix(in srgb, var(--primary-color) 14%, transparent); }
        .token button { border: 0; padding: 0; color: inherit; background: transparent; cursor: pointer; }
        .token-controls { display: grid; grid-template-columns: 1fr auto; gap: 7px; }
        .token-controls > button { border: 0; border-radius: 8px; padding: 0 11px; color: white; background: var(--primary-color); }
        .field-error { min-height: 16px; color: var(--error-color); font-size: 12px; line-height: 1.3; }
        .readonly-list { opacity: .75; background: color-mix(in srgb, var(--secondary-background-color) 75%, transparent); }
        .system-settings { display: grid; gap: 12px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--divider-color); }
        .system-groups { display: grid; gap: 10px; }
        .system-group-item { display: grid; gap: 9px; padding: 10px; border: 1px solid var(--divider-color); border-radius: 10px; }
        .system-group-head { display: flex; align-items: center; gap: 8px; }
        .system-group-head ha-icon { color: var(--primary-color); }
        .system-group-head strong { flex: 1; }
        .system-group-actions { display: flex; gap: 3px; }
        .system-group-actions button, .system-add { border: 0; border-radius: 8px; padding: 7px 10px; color: var(--primary-color); background: color-mix(in srgb, var(--primary-color) 12%, transparent); cursor: pointer; }
        .system-group-actions button:disabled { opacity: .3; cursor: default; }
        .system-group-actions [data-remove] { color: var(--error-color); }
        .system-colors { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
        .color-row { display: grid; grid-template-columns: 42px 1fr 24px; align-items: center; gap: 7px; }
        .color-row input[type="color"] { width: 42px; height: 42px; padding: 2px; }
        .color-preview { width: 22px; height: 22px; border: 1px solid var(--divider-color); border-radius: 50%; }
        @media (max-width: 520px) { .system-colors { grid-template-columns: 1fr; } }
        .entity-title { margin-top: 4px; font-weight: 600; }
        .entity-row { display: flex; align-items: flex-start; gap: 10px; font-size: 13px; line-height: 1.35; }
        .entity-row input { margin-top: 2px; accent-color: var(--primary-color); }
        textarea { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid var(--divider-color); border-radius: 8px; color: var(--primary-text-color); background: var(--card-background-color); font: 12px monospace; }
        .data-actions { display: flex; flex-wrap: wrap; gap: 8px; }
        .data-actions button { border: 0; border-radius: 8px; padding: 10px 12px; color: white; background: var(--primary-color); cursor: pointer; }
        .data-actions .danger { background: var(--error-color); }
      </style>
      <div class="editor">
        <div class="intro">
          <h2>Dashboard-Einstellungen <span class="version">v${STRATEGY_VERSION}</span></h2>
          <p>Darstellung und Inhalte des Smartphone-Dashboards konfigurieren.</p>
          <p class="hint" data-backend-status aria-live="polite">Backend wird synchronisiert …</p>
        </div>

        <details data-panel="general" ${panelOpen("general")}>
          <summary><ha-icon icon="mdi:tune"></ha-icon>Allgemein</summary>
          <div class="panel">
            <ha-textfield data-field="title" label="Dashboard-Titel"></ha-textfield>
            <ha-textfield data-field="view_title" label="Ansichtstitel"></ha-textfield>
            <div data-view-icon-host></div>
          </div>
        </details>

        <details data-panel="home" ${panelOpen("home")}>
          <summary><ha-icon icon="mdi:view-dashboard-outline"></ha-icon>Startseite</summary>
          <div class="panel"><div data-switch-panel></div><div class="entity-title">Reihenfolge</div><div class="actions-panel" data-home-order></div></div>
        </details>

        <details data-panel="persons" ${panelOpen("persons")}>
          <summary><ha-icon icon="mdi:account-group-outline"></ha-icon>Personen</summary>
          <div class="panel persons-panel" data-person-panel></div>
        </details>

        <details data-panel="notifications" ${panelOpen("notifications")}>
          <summary><ha-icon icon="mdi:bell-badge-outline"></ha-icon>Meldungen</summary>
          <div class="panel">
            <div class="switch-row"><div class="switch-copy"><div class="switch-title">Batterien</div><div class="switch-description">Niedrige Batteriestände melden.</div></div><ha-switch data-switch="notification_batteries"></ha-switch></div>
            <label class="native-field">Batterie-Grenzwert in Prozent<input data-notification-number="battery_threshold" type="number" min="1" max="100"></label>
            <div class="switch-row"><div class="switch-copy"><div class="switch-title">Offene Kontakte</div><div class="switch-description">Länger geöffnete Türen und Fenster melden.</div></div><ha-switch data-switch="notification_contacts"></ha-switch></div>
            <label class="native-field">Melden nach Minuten<input data-notification-number="contact_minutes" type="number" min="1" max="1440"></label>
            <div class="switch-row"><div class="switch-copy"><div class="switch-title">CO₂</div><div class="switch-description">Hohe CO₂-Werte melden.</div></div><ha-switch data-switch="notification_co2"></ha-switch></div>
            <label class="native-field">CO₂-Grenzwert in ppm<input data-notification-number="co2_threshold" type="number" min="400" max="5000" step="50"></label>
            <div class="switch-row"><div class="switch-copy"><div class="switch-title">Abfall</div><div class="switch-description">Nur an Abholungen innerhalb des gewählten Vorlaufs erinnern.</div></div><ha-switch data-switch="notification_waste"></ha-switch></div>
            <label class="native-field">Abfall-Vorlauf in Tagen<input data-notification-number="waste_days" type="number" min="0" max="30"></label>
            <div class="switch-row"><div class="switch-copy"><div class="switch-title">USV</div><div class="switch-description">Abweichenden USV-Status melden.</div></div><ha-switch data-switch="notification_ups"></ha-switch></div>
            <div class="switch-row"><div class="switch-copy"><div class="switch-title">Frostwarnung</div><div class="switch-description">Bei niedriger Außentemperatur warnen.</div></div><ha-switch data-switch="notification_frost"></ha-switch></div>
            <label class="native-field">Frost-Grenzwert in °C<input data-notification-number="frost_threshold" type="number" min="-30" max="20"></label>
            <div class="switch-row"><div class="switch-copy"><div class="switch-title">NINA</div><div class="switch-description">Aktive amtliche Warnmeldungen anzeigen.</div></div><ha-switch data-switch="notification_nina"></ha-switch></div>
          </div>
        </details>

        <details data-panel="actions" ${panelOpen("actions")}>
          <summary><ha-icon icon="mdi:gesture-tap"></ha-icon>Schnellaktionen</summary>
          <div class="panel actions-panel" data-action-panel></div>
        </details>

        <details data-panel="synchronization" ${panelOpen("synchronization")}>
          <summary><ha-icon icon="mdi:sync"></ha-icon>Automation & Synchronisierung</summary>
          <div class="panel">
            <div class="sync-status ${synchronization.active ? "" : "incomplete"}" data-sync-status>
              <ha-icon icon="${synchronization.active ? "mdi:check-circle-outline" : "mdi:alert-circle-outline"}"></ha-icon>
              <div><div class="sync-title" data-sync-title>${synchronization.title}</div><div class="sync-detail" data-sync-detail>${synchronization.detail}</div></div>
            </div>
            <div class="entity-title">Gemeinsame Grenzwerte</div>
            <label class="native-field">Batterie-Grenzwert in Prozent<input data-notification-number="battery_threshold" type="number" min="1" max="100"></label>
            <label class="native-field">Kontakt offen seit Minuten<input data-notification-number="contact_minutes" type="number" min="1" max="1440"></label>
            <label class="native-field">CO₂-Grenzwert in ppm<input data-notification-number="co2_threshold" type="number" min="400" max="5000" step="50"></label>
            <label class="native-field">Abfall-Vorlauf in Tagen<input data-notification-number="waste_days" type="number" min="0" max="30"></label>
            <label class="native-field">Frost-Grenzwert in °C<input data-notification-number="frost_threshold" type="number" min="-30" max="20"></label>
            <div class="entity-title">Automation</div>
            <div data-notify-selector-host></div>
            <div data-battery-selector-host></div>
            <div data-frost-selector-host></div>
            <div data-waste-selector-host></div>
            <div data-ups-selector-host></div>
            <label class="native-field">NINA-Entitätsmuster<input data-nina-entities type="text" list="nina-entity-suggestions"><datalist id="nina-entity-suggestions"></datalist><span class="hint">Genau ein * als Platzhalter verwenden, zum Beispiel binary_sensor.nina_warning_*.</span><span class="field-error" data-nina-error></span></label>
            <p class="hint">Diese Werte werden gemeinsam von Dashboard und Benachrichtigungsautomation verwendet.</p>
            <p class="hint" data-notification-service-status aria-live="polite"></p>
          </div>
        </details>

        <details data-panel="rooms" ${panelOpen("rooms")}>
          <summary><ha-icon icon="mdi:floor-plan"></ha-icon>Räume</summary>
          <div class="panel rooms-panel" data-room-panel></div>
        </details>

        <details data-panel="features" ${panelOpen("features")}>
          <summary><ha-icon icon="mdi:widgets-outline"></ha-icon>Weitere Bereiche</summary>
          <div class="panel" data-feature-panel></div>
        </details>

        <details data-panel="data" ${panelOpen("data")}>
          <summary><ha-icon icon="mdi:database-cog-outline"></ha-icon>Import, Export & Zurücksetzen</summary>
          <div class="panel">
            <textarea data-config-json rows="10" aria-label="Strategy-Konfiguration als JSON"></textarea>
            <div class="data-actions"><button type="button" data-export>In Zwischenablage</button><button type="button" data-download>JSON herunterladen</button><button type="button" data-import>JSON übernehmen</button><button type="button" class="danger" data-reset>Zurücksetzen</button></div>
            <p class="hint" data-data-status>Beim Import werden nur Strategy-Einstellungen geändert.</p>
          </div>
        </details>

        <details data-panel="design" ${panelOpen("design")}>
          <summary><ha-icon icon="mdi:palette-outline"></ha-icon>Layout und Design</summary>
          <div class="panel">
            <div class="switch-row">
              <div class="switch-copy">
                <div class="switch-title">Kompakte Anordnung</div>
                <div class="switch-description">Lücken im Sections-Raster automatisch füllen.</div>
              </div>
              <ha-switch data-switch="dense_section_placement"></ha-switch>
            </div>
            <ha-textfield data-number="max_columns" type="number" min="1" max="4" label="Maximale Spaltenanzahl"></ha-textfield>
            <ha-textfield data-field="theme" label="Theme (optional)"></ha-textfield>
            <ha-textfield data-field="background" label="Hintergrundbild oder CSS-Wert (optional)"></ha-textfield>
          </div>
        </details>

        <p class="hint footer">Änderungen werden in der Dashboard-Konfiguration gespeichert.</p>
      </div>
    `;

    for (const panel of this.shadowRoot.querySelectorAll("details[data-panel]")) {
      panel.addEventListener("toggle", () => {
        if (panel.open) this._openPanels.add(panel.dataset.panel);
        else this._openPanels.delete(panel.dataset.panel);
      });
    }

    const switches = [
      ["show_persons", "Personen", "Anwesenheit und Fahrzeit anzeigen."],
      ["show_notifications", "Meldungen", "Batterien, Kontakte und Warnungen anzeigen."],
      ["show_quick_actions", "Schnellaktionen", "Den Bereich „Aktionen“ anzeigen."],
      ["show_rooms", "Räume", "Raumkacheln und deren Navigation anzeigen."],
      ["show_navigation", "Weitere Bereiche", "Medien, System, Alarm und 3D-Drucker anzeigen."],
    ];

    const switchPanel = this.shadowRoot.querySelector("[data-switch-panel]");
    for (const [key, title, description] of switches) {
      const row = document.createElement("div");
      row.className = "switch-row";
      row.innerHTML = `<div class="switch-copy"><div class="switch-title"></div><div class="switch-description"></div></div><ha-switch></ha-switch>`;
      row.querySelector(".switch-title").textContent = title;
      row.querySelector(".switch-description").textContent = description;
      const toggle = row.querySelector("ha-switch");
      toggle.checked = this._config[key] !== false;
      toggle.addEventListener("change", (event) =>
        this._update(key, event.currentTarget.checked),
      );
      switchPanel.appendChild(row);
    }
    const sectionLabels = { persons: "Personen", notifications: "Meldungen", quick_actions: "Schnellaktionen", rooms: "Räume", navigation: "Weitere Bereiche", other: "Sonstige Karten" };
    const homeOrder = this.shadowRoot.querySelector("[data-home-order]");
    for (const key of this._config.home_sections) {
      const item = document.createElement("div"); item.className = "action-item"; item.draggable = true; item.dataset.homeSection = key;
      item.innerHTML = `<span class="drag">⋮⋮</span><div class="action-copy"><div class="action-name"></div></div>`;
      item.querySelector(".action-name").textContent = sectionLabels[key] || key;
      item.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", key));
      item.addEventListener("dragover", (event) => event.preventDefault());
      item.addEventListener("drop", (event) => {
        event.preventDefault(); const source = event.dataTransfer.getData("text/plain"); if (!source || source === key) return;
        const order = [...this._config.home_sections]; const from = order.indexOf(source); const to = order.indexOf(key); if (from < 0 || to < 0) return;
        order.splice(to, 0, order.splice(from, 1)[0]); this._update("home_sections", order); this._render();
      });
      homeOrder.appendChild(item);
    }

    this._renderRooms(this.shadowRoot.querySelector("[data-room-panel]"));
    this._renderPersons(this.shadowRoot.querySelector("[data-person-panel]"));
    this._renderQuickActions(this.shadowRoot.querySelector("[data-action-panel]"));
    this.shadowRoot.querySelector("[data-view-icon-host]").replaceWith(
      this._iconSelector("Ansichts-Icon", this._config.view_icon, (value) => this._update("view_icon", value)),
    );
    const notificationList = (key) => this._selectorValue({ currentTarget: { value: this._effectiveSetting(key) } }, true);
    const saveNotificationList = (key) => (value) => void this._updateNotificationSetting(key, value.join(","));
    const notifyOptions = Object.keys(this._hass?.services?.notify || {}).sort().map((service) => ({
      value: `notify.${service}`,
      label: `notify.${service}`,
    }));
    this.shadowRoot.querySelector("[data-notify-selector-host]").replaceWith(this._createSelector({
      label: "Benachrichtigungsdienste",
      value: notificationList("notification_recipients"),
      multiple: true,
      selector: { select: { multiple: true, custom_value: true, mode: "dropdown", options: notifyOptions } },
      fallbackOptions: notifyOptions,
      onChange: saveNotificationList("notification_recipients"),
    }));
    this.shadowRoot.querySelector("[data-battery-selector-host]").replaceWith(this._entitySelector(
      "Ausgeschlossene Batteriesensoren", notificationList("battery_exclusions"),
      { domain: "sensor", device_class: "battery", multiple: true }, saveNotificationList("battery_exclusions"),
    ));
    this.shadowRoot.querySelector("[data-frost-selector-host]").replaceWith(this._entitySelector(
      "Temperatursensor für Frostwarnungen", this._effectiveSetting("frost_entity"),
      { domain: "sensor", device_class: "temperature" }, (value) => void this._updateNotificationSetting("frost_entity", value),
    ));
    this.shadowRoot.querySelector("[data-waste-selector-host]").replaceWith(this._entitySelector(
      "Abfallsensoren", notificationList("waste_entities"), { domain: "sensor", multiple: true }, saveNotificationList("waste_entities"),
    ));
    this.shadowRoot.querySelector("[data-ups-selector-host]").replaceWith(this._entitySelector(
      "USV-Sensoren", notificationList("ups_entities"), { multiple: true }, saveNotificationList("ups_entities"),
    ));
    const ninaInput = this.shadowRoot.querySelector("[data-nina-entities]");
    const ninaError = this.shadowRoot.querySelector("[data-nina-error]");
    ninaInput.value = String(this._effectiveSetting("nina_entities") || "");
    const registry = entityRegistryMap(this._hass);
    for (const entityId of Object.keys(this._hass?.states || {}).filter(
      (id) => /^binary_sensor\.nina/i.test(id) && isEntityVisible(this._hass, id, registry),
    ).sort()) {
      const option = document.createElement("option"); option.value = `${entityId}*`; this.shadowRoot.querySelector("#nina-entity-suggestions").appendChild(option);
    }
    const validateNina = () => {
      const valid = Boolean(normalizeNinaGlob(ninaInput.value));
      ninaInput.classList.toggle("invalid", !valid);
      ninaError.textContent = valid ? "" : "Genau ein Muster im Format binary_sensor.nina_* ist erlaubt; unterstützt wird nur * als Platzhalter.";
      return valid;
    };
    ninaInput.addEventListener("input", validateNina);
    ninaInput.addEventListener("change", () => { if (validateNina()) void this._updateNotificationSetting("nina_entities", ninaInput.value.trim()); });
    validateNina();
    const featurePanel = this.shadowRoot.querySelector("[data-feature-panel]");
    const renderedFeatures = configuredFeatures(this._config, this._hass);
    const configuredHashes = renderedFeatures.map((item) => ({
      key: item.key,
      hash: String(this._config.features?.[item.key]?.hash || item.hash).trim(),
    }));
    for (const feature of renderedFeatures) {
      const row = document.createElement("div");
      row.className = "person-item";
      const hashListId = `feature-hashes-${feature.key}`;
      row.innerHTML = `<div class="switch-row"><div class="switch-copy"><div class="switch-title"></div><div class="switch-description"></div></div><ha-switch data-enabled></ha-switch></div><ha-textfield data-name label="Name"></ha-textfield><div data-feature-icon-host></div><label class="native-field">Navigations-Hash<input data-hash type="text" list="${hashListId}"></label><datalist id="${hashListId}"></datalist><div class="field-error" data-hash-error></div><div class="switch-row"><div class="switch-copy"><div class="switch-title">Neue Entitäten automatisch ergänzen</div></div><ha-switch data-auto></ha-switch></div>${feature.key === "printer" ? '<div data-printer-ids-host></div><label class="select-label">Automatisch erkannte Bambu-Lab Geräte-IDs<textarea class="readonly-list" data-auto-printer-ids rows="3" readonly></textarea></label><div data-excluded-printer-ids-host></div>' : ""}<div data-entities-host></div><label class="select-label">Automatisch erkannte Entitäten<textarea class="readonly-list" data-auto-entities rows="5" readonly></textarea></label><div data-excluded-host></div>`;
      row.querySelector(".switch-title").textContent = feature.name;
      const featureItemCount = feature.entities.length + feature.printer_ids.length;
      row.querySelector(".switch-description").textContent = `${featureItemCount} Einträge · ${feature.hash}`;
      const toggle = row.querySelector("[data-enabled]");
      toggle.checked = feature.enabled;
      const autoToggle = row.querySelector("[data-auto]"); autoToggle.checked = feature.auto_discover;
      const nameField = row.querySelector("[data-name]"); nameField.value = feature.name;
      const hashField = row.querySelector("[data-hash]");
      hashField.value = this._config.features?.[feature.key]?.hash || feature.hash;
      const hashError = row.querySelector("[data-hash-error]");
      const validateHash = () => {
        const raw = hashField.value.trim();
        const candidate = raw ? (raw.startsWith("#") ? raw : `#${raw}`) : FEATURE_META[feature.key][2];
        let message = "";
        if (!/^#[a-z0-9][a-z0-9_-]*$/i.test(candidate)) {
          message = "Der Hash muss mit # beginnen und darf nur Buchstaben, Zahlen, _ und - enthalten.";
        } else if (configuredHashes.some((item) => item.key !== feature.key &&
          normalizedNavigationHash(item.hash, FEATURE_META[item.key][2]) === candidate)) {
          message = "Dieser Navigations-Hash wird bereits von einem anderen Bereich verwendet.";
        }
        hashField.classList.toggle("invalid", Boolean(message));
        hashError.textContent = message;
        return message ? "" : candidate;
      };
      validateHash();
      row.querySelector("[data-auto-entities]").value = feature.automatic_entities.join("\n");
      const updateFeature = (changes) => this._update("features", {
        ...(this._config.features || {}),
        [feature.key]: { ...(this._config.features?.[feature.key] || {}), ...changes },
      });
      row.querySelector("[data-feature-icon-host]").replaceWith(this._iconSelector("Icon", feature.icon, (value) => updateFeature({ icon: value })));
      const hashSuggestions = Object.keys(FEATURE_META).map((key) => FEATURE_META[key][2]);
      row.querySelector(`#${hashListId}`).append(...hashSuggestions.map((hash) => { const option = document.createElement("option"); option.value = hash; return option; }));
      row.querySelector("[data-entities-host]").replaceWith(this._entitySelector(
        "Manuell hinzugefügte Entitäten", feature.manual_entities, { multiple: true }, (value) => updateFeature({ entities: value }),
      ));
      row.querySelector("[data-excluded-host]").replaceWith(this._entitySelector(
        "Automatisch erkannte Entitäten ausblenden", feature.excluded_entities, { multiple: true },
        (value) => { updateFeature({ excluded_entities: value }); this._render(); },
      ));
      if (feature.key === "printer") {
        row.querySelector("[data-auto-printer-ids]").value = feature.automatic_printer_ids.join("\n");
        const bambuOptions = valuesOf(this._hass?.devices).filter((device) =>
          autoBambuPrinterIds({ devices: [device] }).includes(device.id),
        ).map((device) => ({ value: device.id, label: device.name_by_user || device.name || device.model || device.id }));
        row.querySelector("[data-printer-ids-host]").replaceWith(this._createSelector({
          label: "Bambu-Lab-Geräte", value: feature.manual_printer_ids, multiple: true,
          selector: { device: { multiple: true } }, fallbackOptions: bambuOptions,
          onChange: (value) => updateFeature({ printer_ids: value }),
        }));
        row.querySelector("[data-excluded-printer-ids-host]").replaceWith(this._createSelector({
          label: "Automatisch erkannte Bambu-Lab-Geräte ausblenden", value: feature.excluded_printer_ids, multiple: true,
          selector: { device: { multiple: true } }, fallbackOptions: bambuOptions,
          onChange: (value) => { updateFeature({ excluded_printer_ids: value }); this._render(); },
        }));
      }
      toggle.addEventListener("change", (event) => updateFeature({ enabled: event.currentTarget.checked }));
      autoToggle.addEventListener("change", (event) => { updateFeature({ auto_discover: event.currentTarget.checked }); this._render(); });
      nameField.addEventListener("change", (event) => updateFeature({ name: event.currentTarget.value.trim() }));
      hashField.addEventListener("input", validateHash);
      hashField.addEventListener("change", () => {
        const candidate = validateHash();
        if (!candidate) return;
        updateFeature({ hash: candidate });
        this._render();
      });
      if (feature.key === "system") {
        this._renderSystemFeatureSettings(row, feature, updateFeature);
      }
      featurePanel.appendChild(row);
    }

    const jsonArea = this.shadowRoot.querySelector("[data-config-json]");
    const status = this.shadowRoot.querySelector("[data-data-status]");
    jsonArea.value = JSON.stringify(this._config, null, 2);
    this.shadowRoot.querySelector("[data-export]").addEventListener("click", async () => {
      await navigator.clipboard.writeText(JSON.stringify(this._config, null, 2));
      status.textContent = "Konfiguration wurde kopiert.";
    });
    this.shadowRoot.querySelector("[data-download]").addEventListener("click", () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(this._config, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "smartphone-dashboard-config.json"; link.click(); URL.revokeObjectURL(url);
    });
    this.shadowRoot.querySelector("[data-import]").addEventListener("click", () => {
      try {
        const imported = JSON.parse(jsonArea.value);
        const validationErrors = configurationValidationErrors(imported);
        if (validationErrors.length) throw new Error(validationErrors.join("; "));
        this._config = migrateConfig(imported, this._hass); this._update("config_version", CONFIG_VERSION); this._render();
      }
      catch (error) { status.textContent = `Import fehlgeschlagen: ${error.message}`; }
    });
    this.shadowRoot.querySelector("[data-reset]").addEventListener("click", () => {
      this._config = migrateConfig({}, this._hass); this._update("config_version", CONFIG_VERSION); this._render();
    });

    for (const field of this.shadowRoot.querySelectorAll("[data-field]")) {
      const key = field.dataset.field;
      field.value = this._config[key] || "";
      field.addEventListener("change", (event) =>
        this._update(key, event.currentTarget.value.trim()),
      );
    }

    for (const field of this.shadowRoot.querySelectorAll("[data-number]")) {
      const key = field.dataset.number;
      field.value = String(this._config[key] || 1);
      field.addEventListener("change", (event) => {
        const value = Math.min(4, Math.max(1, Number(event.currentTarget.value) || 1));
        this._update(key, value);
      });
    }

    for (const field of this.shadowRoot.querySelectorAll("[data-notification-number]")) {
      const key = field.dataset.notificationNumber;
      field.value = String(this._effectiveSetting(key));
      field.addEventListener("change", (event) => {
        const minimum = Number(event.currentTarget.min);
        const maximum = Number(event.currentTarget.max);
        const raw = Number(event.currentTarget.value);
        const value = Math.min(maximum, Math.max(minimum, Number.isFinite(raw) ? raw : minimum));
        void this._updateNotificationSetting(key, value);
      });
    }

    for (const field of this.shadowRoot.querySelectorAll("[data-notification-text]")) {
      const key = field.dataset.notificationText;
      field.value = String(this._effectiveSetting(key) || "");
      field.addEventListener("change", (event) =>
        void this._updateNotificationSetting(key, event.currentTarget.value.trim()),
      );
    }

    for (const toggle of this.shadowRoot.querySelectorAll("[data-switch]")) {
      const key = toggle.dataset.switch;
      toggle.checked = this._effectiveSetting(key) !== false;
      toggle.addEventListener("change", (event) =>
        key.startsWith("notification_")
          ? void this._updateNotificationSetting(key, event.currentTarget.checked)
          : this._update(key, event.currentTarget.checked),
      );
    }
  }
}

if (!customElements.get("smartphone-dashboard-strategy-editor")) {
  customElements.define(
    "smartphone-dashboard-strategy-editor",
    SmartphoneDashboardStrategyEditor,
  );
}

window.customStrategies = window.customStrategies || [];

if (
  !window.customStrategies.some(
    (strategy) =>
      strategy.type === STRATEGY_TYPE &&
      strategy.strategyType === "dashboard",
  )
) {
  window.customStrategies.push({
    type: STRATEGY_TYPE,
    strategyType: "dashboard",
    name: "Smartphone-Dashboard",
    description:
      "Ein kompaktes deutsches Dashboard mit Räumen, Meldungen und Pop-ups.",
  });
}

console.info(`Smartphone-Dashboard-Strategy v${STRATEGY_VERSION} geladen`);

export {
  SmartphoneDashboardStrategy,
  SmartphoneDashboardStrategyEditor,
  STRATEGY_VERSION,
  configurationValidationErrors,
  configuredQuickActions,
  configuredFeatures,
  applyNotificationOptions,
  mergeBackendNotifications,
  resolveBackendKey,
  partitionConflictPatch,
  normalizeNinaGlob,
  synchronizationStatus,
  detectedRooms,
  applyRoomOptions,
};
