/**
 * Smartphone-Dashboard-Strategie für Home Assistant
 *
 * Wird vom Integrations-Loader aus demselben versionsabhängigen Pfad geladen.
 */

import { ALERT_POPUPS, SmartphoneDashboardAlerts } from "./notification-cards.js";
import { loadEnergyPopupCards } from "./energy-popup.js";
import { SmartphoneDashboardEnergy } from "./energy-overview.js";
import { SmartphoneDashboardAgenda } from "./agenda-cards.js";
import { selectParcels } from "./parcel-selection.js";

const STRATEGY_VERSION = "23.1.9";
const CONFIG_VERSION = 26;

const HOME_SECTION_LABELS = {
  persons: "Personen",
  notifications: "Meldungen",
  quick_actions: "Schnellaktionen",
  rooms: "Räume",
  navigation: "Weitere Bereiche",
};

function homeSectionKey(card) {
  if (card?.card_type === "pop-up") return undefined;
  const title = card?.heading || card?.name;
  if (title === "Aktionen") return "quick_actions";
  return Object.keys(HOME_SECTION_LABELS).find((key) => HOME_SECTION_LABELS[key] === title);
}

function sectionHeading(key, icon) {
  return { type: "custom:bubble-card", card_type: "separator", name: HOME_SECTION_LABELS[key], icon };
}

function bubblePopup(hash, header, cards) {
  return {
    type: "custom:bubble-card",
    card_type: "pop-up",
    popup_mode: "adaptive-dialog",
    performance_mode: "performance",
    hash,
    show_header: true,
    ...header,
    cards,
  };
}

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

const cachedDisplayNotificationConfigs = new Map();
let cachedEntityIndex;
const DISPLAY_CONFIG_CACHE_PREFIX = `smartphone-dashboard:display-config:${STRATEGY_VERSION}`;
const POPUP_NAVIGATION_EVENTS = ["hashchange", "location-changed", "popstate"];

class SmartphoneDashboardDeferredCards extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._cards = [];
    this._mounted = false;
    this._mounting = false;
    this._onLocationChange = () => this._activateIfNeeded();
  }

  setConfig(config) {
    if (!config || !Array.isArray(config.cards)) throw new Error("Pop-up-Karten fehlen");
    if (this._config === config) return;
    this._config = config;
    this._refreshOnOpen = config.card_source === "energy" ||
      config.cards.some((card) => card.type === "custom:smartphone-dashboard-agenda");
    this._clearCards();
    this._activateIfNeeded();
  }

  set hass(value) {
    this._hass = value;
    this._activateIfNeeded();
  }

  connectedCallback() {
    for (const event of POPUP_NAVIGATION_EVENTS) window.addEventListener(event, this._onLocationChange);
    this._activateIfNeeded();
  }

  disconnectedCallback() {
    for (const event of POPUP_NAVIGATION_EVENTS) window.removeEventListener(event, this._onLocationChange);
    if (this._refreshOnOpen && this._mounted) this._clearCards();
  }

  getCardSize() {
    return this._cards.reduce((size, card) => size + (card.getCardSize?.() || 1), 1);
  }

  _isRequested() {
    const hash = String(this._config?.popup_hash || "");
    return !hash || globalThis.location?.hash === hash;
  }

  _clearCards() {
    this._cards = [];
    this._mounted = false;
    this.shadowRoot.replaceChildren();
  }

  _activateIfNeeded() {
    if (!this.isConnected || !this._config) return;
    const config = this._config;
    const energy = config.card_source === "energy";
    if (!this._isRequested()) {
      if (this._refreshOnOpen && this._mounted) this._clearCards();
      return;
    }
    if (this._mounting || (energy && !this._hass)) return;
    if (this._mounted) {
      for (const card of this._cards) card.hass = this._hass;
      return;
    }
    this._mounting = true;
    const helpersReady = typeof window.loadCardHelpers === "function"
      ? window.loadCardHelpers()
      : Promise.reject(new Error("Home-Assistant-Kartenhelfer sind nicht verfügbar"));
    const cardsReady = energy
      ? loadEnergyPopupCards(this._hass, (entityId) => isEntityVisible(this._hass, entityId), config.pv_total)
      : config.cards;
    void Promise.all([helpersReady, cardsReady]).then(([helpers, configs]) => {
      if (!this.isConnected || this._config !== config || !this._isRequested()) return;
      const container = document.createElement("div");
      container.className = "cards";
      this._cards = configs.map((cardConfig) => {
        const card = helpers.createCardElement(cardConfig);
        if (this._hass) card.hass = this._hass;
        container.append(card);
        return card;
      });
      this.shadowRoot.replaceChildren();
      const style = document.createElement("style");
      style.textContent = `
        :host { display: block; min-width: 0; }
        .cards { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--vertical-stack-card-gap, 8px); }
      `;
      this.shadowRoot.append(style, container);
      this._mounted = true;
      this.dispatchEvent(new Event("iron-resize", { bubbles: true, composed: true }));
    }).catch((error) => {
      if (!this.isConnected || this._config !== config || !this._isRequested()) return;
      console.error("Smartphone-Dashboard: Pop-up-Inhalt konnte nicht geladen werden", error);
      this.shadowRoot.innerHTML = `<ha-card>Pop-up-Inhalt konnte nicht geladen werden.</ha-card>`;
      this._mounted = true;
    }).finally(() => {
      this._mounting = false;
      if (this._config !== config) this._activateIfNeeded();
    });
  }
}

class SmartphoneDashboardNotificationControls extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._busy = false;
  }

  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  set hass(value) {
    this._hass = value;
    this._render();
  }

  getCardSize() {
    return 2;
  }

  connectedCallback() {
    this._render();
  }

  _recipientToken() {
    const token = new URLSearchParams(window.location.search).get("sd_recipient") || "";
    return /^[a-f0-9]{12}$/.test(token) ? token : "";
  }

  async _apply(action) {
    const token = this._recipientToken();
    if (!this._hass || !token || this._busy) return;
    this._busy = true;
    this._status = "Wird angewendet …";
    this._render();
    let status;
    try {
      await this._hass.callWS({
        type: "smartphone_dashboard/notifications/action",
        action,
        recipient_token: token,
      });
      status = action === "snooze"
        ? "Mitteilungen sind für 30 Minuten pausiert."
        : "Mitteilungen bleiben bis zur nächsten Änderung pausiert.";
    } catch (error) {
      status = `Aktion fehlgeschlagen: ${error?.message || error}`;
    } finally {
      this._busy = false;
      this._status = status;
      this._render();
    }
  }

  _render() {
    if (!this.shadowRoot) return;
    const token = this._recipientToken();
    this.hidden = !token;
    if (!token) return;
    if (this._renderedToken !== token) {
      this._renderedToken = token;
    this.shadowRoot.innerHTML = `
      <style>
        :host([hidden]) { display: none; }
        ha-card {
          padding: 16px;
          box-shadow: none;
        }
        .heading { display: flex; gap: 12px; align-items: center; }
        .heading ha-icon { color: var(--secondary-text-color); }
        .title { font-size: 15px; font-weight: 600; line-height: 1.2; }
        .description, .status { color: var(--secondary-text-color); line-height: 1.35; }
        .description { margin-top: 2px; font-size: 13px; }
        .actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr)); gap: 8px; margin-top: 12px; }
        button {
          min-height: 44px; border: 1px solid var(--divider-color); border-radius: 12px;
          padding: 9px 11px; color: var(--primary-text-color);
          background: var(--card-background-color); font: inherit; font-size: 13px;
          font-weight: 650; cursor: pointer;
        }
        button:first-child { background: var(--secondary-background-color); }
        button:disabled { opacity: .55; cursor: default; }
        button:focus-visible { outline: 2px solid var(--primary-color); }
        .status { margin-top: 8px; font-size: 13px; }
        .status:empty { margin-top: 0; }
      </style>
      <ha-card>
        <div class="heading">
          <ha-icon icon="mdi:bell-off-outline" aria-hidden="true"></ha-icon>
          <div><div class="title">Live Activities pausieren</div>
          <div class="description">Die Pause gilt für Meldungen auf diesem Gerät.</div></div>
        </div>
        <div class="actions">
          <button type="button" data-action="snooze">30 Minuten pausieren</button>
          <button type="button" data-action="mute">Bis zur Änderung pausieren</button>
        </div>
        <div class="status" role="status"></div>
      </ha-card>`;
      this._statusNode = this.shadowRoot.querySelector(".status");
      this._buttons = this.shadowRoot.querySelectorAll("button[data-action]");
      for (const button of this._buttons) {
        button.addEventListener("click", () => void this._apply(button.dataset.action));
      }
    }
    const status = this._status || "";
    if (this._statusNode.textContent !== status) this._statusNode.textContent = status;
    for (const button of this._buttons) button.disabled = Boolean(this._busy || !this._hass);
  }
}

function parcelSelectionExpression(entityIds, contentEntityIds) {
  return "(" + selectParcels.toString() + ")(hass.states, " +
    JSON.stringify(entityIds) + ", " + JSON.stringify(contentEntityIds) + ")";
}

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
const BACKEND_NOTIFICATION_KEYS = [
  ...Object.keys(NOTIFICATION_HELPERS), "waste_days", "notification_media", "notification_parcels", "notification_appliances",
];

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
      const displayCacheKey = displayConfigCacheKey(hass);
      const cachedConfig = cachedDisplayNotificationConfigs.get(displayCacheKey) ?? readDisplayConfigCache(hass);
      let timeoutId;
      try {
        const backendRequest = hass.callWS({
          type: "smartphone_dashboard/config/display",
          dashboard_key: "default",
        });
        const backend = await Promise.race([
          backendRequest,
          new Promise((resolve) => {
            timeoutId = setTimeout(resolve, cachedConfig ? 300 : 1500);
          }),
        ]);
        const backendConfig = backend?.config;
        if (backendConfig) {
          cachedDisplayNotificationConfigs.set(displayCacheKey, backendConfig);
          writeDisplayConfigCache(hass, backendConfig);
        }
        config = mergeBackendNotifications(explicitConfig, backendConfig ?? cachedConfig);
      } catch (_error) {
        config = mergeBackendNotifications(explicitConfig, cachedConfig);
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
    generated = applyDeferredPopupContents(generated);
    return applyEntityOverrides(
      generated,
      config.entity_overrides && typeof config.entity_overrides === "object"
        ? config.entity_overrides
        : {},
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

function displayConfigCacheKey(hass) {
  const userId = String(hass?.user?.id || "anonymous").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${DISPLAY_CONFIG_CACHE_PREFIX}:${userId}`;
}

function readDisplayConfigCache(hass) {
  try {
    const raw = globalThis.sessionStorage?.getItem(displayConfigCacheKey(hass));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch (_error) {
    return undefined;
  }
}

function writeDisplayConfigCache(hass, config) {
  try {
    globalThis.sessionStorage?.setItem(displayConfigCacheKey(hass), JSON.stringify(config || {}));
  } catch (_error) {
    // Private Browser und restriktive WebViews können Session Storage sperren.
  }
}


const BASE_DASHBOARD = {
  title: "Smartphone Dashboard",
  views: [{
    title: "Handy", path: "handy", icon: "mdi:cellphone",
    type: "sections", max_columns: 1, dense_section_placement: true,
    sections: [{ type: "grid", cards: [
      { type: "heading", heading: "Personen", icon: "mdi:account-group-outline" },
      { type: "horizontal-stack", cards: [] },
      sectionHeading("notifications", "mdi:bell-badge-outline"),
      { type: "custom:smartphone-dashboard-alerts", summary: true },
      sectionHeading("quick_actions", "mdi:gesture-tap"),
      { type: "grid", columns: 2, square: false, cards: [] },
      sectionHeading("rooms", "mdi:floor-plan"),
      { type: "grid", columns: 2, square: false, cards: [] },
      sectionHeading("navigation", "mdi:view-grid-plus-outline"),
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

function popupContentCards(popup) {
  const cards = Array.isArray(popup?.cards) ? popup.cards : [];
  if (
    cards.length === 1 &&
    cards[0]?.type === "custom:smartphone-dashboard-deferred-cards" &&
    Array.isArray(cards[0].cards)
  ) return cards[0].cards;
  return cards;
}

function applyDeferredPopupContents(dashboard) {
  const cards = dashboard?.views?.[0]?.sections?.[0]?.cards;
  if (!Array.isArray(cards)) return dashboard;
  for (const popup of cards) {
    if (popup?.card_type !== "pop-up" || !popup.hash) continue;
    const content = popupContentCards(popup);
    if (!content.length || popup.cards?.[0]?.type === "custom:smartphone-dashboard-deferred-cards") continue;
    popup.cards = [{
      type: "custom:smartphone-dashboard-deferred-cards",
      popup_hash: popup.hash,
      cards: content,
    }];
  }
  return dashboard;
}

function valuesOf(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function dashboardEntityIndex(hass) {
  const states = hass?.states || {};
  const entities = hass?.entities;
  const devicesSource = hass?.devices;
  const areasSource = hass?.areas;
  if (
    cachedEntityIndex?.states === states &&
    cachedEntityIndex?.entities === entities &&
    cachedEntityIndex?.devicesSource === devicesSource &&
    cachedEntityIndex?.areasSource === areasSource
  ) return cachedEntityIndex;

  const stateEntries = Object.entries(states);
  const stateIds = stateEntries.map(([entityId]) => entityId);
  const registryEntries = (() => {
    if (Array.isArray(entities)) return entities.filter((entry) => entry?.entity_id);
    if (!entities || typeof entities !== "object") return [];
    return Object.entries(entities)
      .filter(([, entry]) => entry && typeof entry === "object")
      .map(([entityId, entry]) => ({ ...entry, entity_id: entry.entity_id || entityId }))
      .filter((entry) => entry.entity_id);
  })();
  const registry = new Map(registryEntries.map((entry) => [entry.entity_id, entry]));
  const devices = valuesOf(devicesSource);
  const areas = valuesOf(areasSource);
  cachedEntityIndex = {
    states,
    entities,
    devicesSource,
    areasSource,
    stateEntries,
    stateIds,
    registryEntries,
    registry,
    devices,
    deviceById: new Map(devices.map((device) => [device.id, device])),
    areas,
    areaById: new Map(areas.map((area) => [area.area_id || area.id, area])),
  };
  return cachedEntityIndex;
}

function entityRegistryEntries(hass) {
  return dashboardEntityIndex(hass).registryEntries;
}

function entityRegistryMap(hass) {
  return dashboardEntityIndex(hass).registry;
}

function isEntityVisible(hass, entityId, registry = entityRegistryMap(hass)) {
  const state = hass?.states?.[entityId];
  if (!state) return false;
  const entry = registry.get(entityId);
  return entry?.hidden !== true && !entry?.hidden_by && !entry?.disabled_by &&
    state.attributes?.hidden !== true;
}

function entityDisplayName(hass, entityId, formattedName) {
  const index = dashboardEntityIndex(hass);
  const entry = index.registry.get(entityId);
  const device = index.deviceById.get(entry?.device_id);
  const areaId = entry?.area_id || device?.area_id;
  const area = index.areaById.get(areaId);
  const areaName = String(area?.name || "").trim();
  const deviceName = String(device?.name_by_user || device?.name || "").trim();
  const friendlyName = String(hass?.states?.[entityId]?.attributes?.friendly_name || "").trim();
  let entityName = String(formattedName || entry?.name || entry?.original_name || friendlyName || entityId.split(".")[1] || entityId).trim();
  for (const prefix of [deviceName, areaName].filter(Boolean)) {
    if (entityName.toLocaleLowerCase("de-DE").startsWith(`${prefix.toLocaleLowerCase("de-DE")} `)) {
      entityName = entityName.slice(prefix.length).trim();
    }
  }
  return entityName || entityId.split(".")[1] || entityId;
}

function roomEntityName(hass, entityId, mode, defaultShort) {
  if (mode !== "entity" && mode !== "device" && !defaultShort) return undefined;
  const state = hass.states?.[entityId];
  const friendly = state?.attributes?.friendly_name;
  const name = state && hass.formatEntityName?.(state, { type: "entity" });
  const short = entityDisplayName(hass, entityId, name !== friendly ? name : undefined);
  if (mode !== "device") return short;

  const index = dashboardEntityIndex(hass);
  const device = index.deviceById.get(index.registry.get(entityId)?.device_id);
  const deviceName = (device?.name_by_user || device?.name || "").trim();
  if (!deviceName) return friendly || short;
  return deviceName.toLocaleLowerCase("de-DE") === short.toLocaleLowerCase("de-DE")
    ? short
    : `${deviceName} ${short}`;
}

const ROOM_ENTITY_NAME_OPTIONS = [
  ["", "Standard"],
  ["entity", "Nur Entitätsname"],
  ["device", "Mit Gerätenamen"],
];
const ROOM_NAMED_DOMAINS = new Set(["light", "switch", "climate", "media_player", "cover", "fan", "camera"]);

function normalizeRoomKey(value) {
  return String(value || "")
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function entitiesForArea(hass, areaId) {
  const index = dashboardEntityIndex(hass);
  return index.registryEntries
    .filter((entry) => {
      const deviceArea = index.deviceById.get(entry.device_id)?.area_id;
      return (
        (entry.area_id || deviceArea) === areaId &&
        isEntityVisible(hass, entry.entity_id, index.registry)
      );
    })
    .map((entry) => entry.entity_id)
    .sort((a, b) => a.localeCompare(b, "de"));
}

function detectedRooms(hass, configuredRooms) {
  const configured = Array.isArray(configuredRooms) ? configuredRooms : [];
  const existing = new Map(configured.map((room) => [room.area_id, room]));

  const areas = [...dashboardEntityIndex(hass).areas].sort((a, b) =>
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
  const allPersonEntities = dashboardEntityIndex(hass).stateIds
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


function synchronizationStatus(config, hass) {
  const helperIds = Object.values(NOTIFICATION_HELPERS);
  const installedHelpers = helperIds.filter((entityId) => hass?.states?.[entityId]).length;
  const recipients = csv(notificationSetting(config, hass, "notification_recipients"))
    .filter((service) => service !== "notify.persistent_notification");
  const missingServices = recipients.filter((service) => !/^notify\.[a-z0-9_]+$/.test(service) || !hass?.services?.notify?.[service.slice(7)]);
  const problems = [];
  if (missingServices.length) problems.push(`Notify-Dienste fehlen: ${missingServices.join(", ")}`);
  const pushDetail = recipients.length === 1 ? "1 optionaler Push-Dienst" : `${recipients.length} optionale Push-Dienste`;
  return { active: problems.length === 0, installedHelpers, totalHelpers: helperIds.length,
    title: problems.length ? "Benachrichtigungssystem unvollständig" : "Benachrichtigungssystem aktiv",
    detail: problems.length ? problems.join(" · ") : `Eine Persistent Notification · ${pushDetail} · ${installedHelpers} optionale Legacy-Helfer` };
}

function parcelSourceEntityIds(hass) {
  const registry = entityRegistryMap(hass);
  return dashboardEntityIndex(hass).stateEntries
    .filter(([entityId, state]) =>
      entityId.startsWith("sensor.") &&
      isEntityVisible(hass, entityId, registry) &&
      Array.isArray(state?.attributes?.parcels),
    )
    .map(([entityId]) => entityId);
}

function parcelSensorEntities(hass) {
  const candidates = parcelSourceEntityIds(hass).filter((entityId) => !/(?:^|_)outgoing|delivered/i.test(entityId));
  const incoming = candidates.filter((entityId) => /incoming.*parcel|parcel.*incoming/i.test(entityId));
  return (incoming.length ? incoming : candidates).sort((left, right) => left.localeCompare(right, "de"));
}

function parcelCalendarEntities(hass) {
  const registry = entityRegistryMap(hass);
  return dashboardEntityIndex(hass).stateEntries
    .filter(([entityId, state]) =>
      entityId.startsWith("calendar.") &&
      isEntityVisible(hass, entityId, registry) &&
      (registry.get(entityId)?.platform === "parcel_aggregator" ||
        /parcel|paket|deliver|liefer/i.test(`${entityId} ${state?.attributes?.friendly_name || ""}`)),
    )
    .map(([entityId]) => entityId)
    .sort((left, right) => left.localeCompare(right, "de"));
}

const WASTE_NAME = /abfall|müll|muell|entsorg|waste|trash|garbage|recycl/i;

function wasteAgendaCard(hass, wasteEntityIds) {
  const registry = entityRegistryMap(hass);
  const candidates = dashboardEntityIndex(hass).stateEntries
    .filter(([entityId]) => entityId.startsWith("calendar.") && isEntityVisible(hass, entityId, registry))
    .map(([entityId, state]) => ({ entityId, state, entry: registry.get(entityId) }));
  if (!wasteEntityIds.length) {
    wasteEntityIds = dashboardEntityIndex(hass).stateEntries
      .filter(([id, state]) => id.startsWith("sensor.") && isEntityVisible(hass, id, registry) &&
        (registry.get(id)?.platform === "waste_collection_schedule" ||
          WASTE_NAME.test(`${id} ${state.attributes?.friendly_name || ""}`)))
      .map(([id]) => id);
  }
  wasteEntityIds = wasteEntityIds.filter((id) => isEntityVisible(hass, id, registry));
  const wasteEntries = wasteEntityIds.map((entityId) => registry.get(entityId)).filter(Boolean);
  const linked = candidates.filter(({ entry }) => entry && wasteEntries.some((wasteEntry) =>
    (entry.device_id && entry.device_id === wasteEntry.device_id) ||
    (entry.config_entry_id && entry.config_entry_id === wasteEntry.config_entry_id),
  ));
  const integrationCalendars = candidates.filter(({ entry }) =>
    [entry?.platform, entry?.integration]
      .some((value) => String(value || "").toLowerCase() === "waste_collection_schedule"),
  );
  const selected = linked.length
    ? linked
    : integrationCalendars.length
      ? integrationCalendars
      : candidates.filter(({ entityId, state }) => WASTE_NAME.test(
        `${entityId} ${state?.attributes?.friendly_name || ""}`,
      ));
  return {
    type: "custom:smartphone-dashboard-agenda",
    kind: "waste",
    entities: wasteEntityIds,
    calendars: selected.map(({ entityId }) => entityId),
    calendar_candidates: candidates.map(({ entityId }) => entityId),
  };
}

function parcelAgendaCard(hass, entities, calendars) {
  return {
    type: "custom:smartphone-dashboard-agenda",
    kind: "parcel",
    entities,
    calendars,
    content_entities: parcelSourceEntityIds(hass),
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function parcelOverviewCard(entityIds, hass) {
  const ids = [...new Set(entityIds.filter(Boolean))];
  return {
    type: "custom:button-card",
    show_name: false,
    show_icon: false,
    show_state: false,
    tap_action: { action: "none" },
    custom_fields: {
      parcels: `[[[
        const parcels = ${parcelSelectionExpression(ids, parcelSourceEntityIds(hass))};
        if (!parcels.length) return '<div class="parcel-empty">Keine Pakete unterwegs</div>';
        const escape = ${escapeHtml.toString()};
        return parcels.map(({ parcel, status, carrier, label, design }) => {
        const date = (value) => value ? new Date(value) : null;
        const from = date(parcel.planned_from);
        const to = date(parcel.planned_to);
        const windowStart = from && Number.isFinite(from.getTime()) ? from : to;
        const formatTime = (value) => value.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        const planned = windowStart && Number.isFinite(windowStart.getTime())
          ? windowStart.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) +
            ' · ' + formatTime(windowStart) +
            (to && to > windowStart ? '–' + formatTime(to) : '')
          : '';
        const subtitle = [
          carrier !== label ? carrier : '', design.label,
          status === 'at_pickup_point' ? parcel.pickup_point : '',
        ].filter(Boolean).join(' · ');
        const content = '<div class="parcel-icon" style="--parcel-color:' + design.color + '">' +
          '<ha-icon icon="' + design.icon + '" aria-hidden="true"></ha-icon></div>' +
          '<div class="parcel-copy"><div class="parcel-name">' + escape(label) +
          '</div><div class="parcel-meta">' + escape(subtitle) + '</div>' +
          (planned ? '<div class="parcel-meta">' + escape(planned) + '</div>' : '') +
          '<progress class="parcel-progress" style="--parcel-color:' + design.color + '" value="' + design.step +
          '" max="4" aria-label="Versandfortschritt"></progress></div>';
        let url = '';
        try {
          const parsed = new URL(parcel.url);
          if (['http:', 'https:'].includes(parsed.protocol)) url = parsed.href;
        } catch {}
        return url
          ? '<a class="parcel-row" href="' + escape(url) + '" target="_self" rel="external" onclick="event.stopPropagation()" onpointerdown="event.stopPropagation()" ontouchstart="event.stopPropagation()">' + content + '<span class="parcel-open" aria-hidden="true"><ha-icon icon="mdi:open-in-new"></ha-icon></span></a>'
          : '<div class="parcel-row">' + content + '</div>';
        }).join('');
      ]]]`,
    },
    styles: {
      card: [{ padding: "0" }, { "text-align": "left" }, { "box-shadow": "none" }],
      grid: [{ "grid-template-areas": "'parcels'" }, { "grid-template-columns": "minmax(0, 1fr)" }],
      custom_fields: { parcels: [{ width: "100%" }, { "pointer-events": "auto" }, { "z-index": "3" }] },
    },
    extra_styles: `
      .parcel-row { display:flex; align-items:center; gap:12px; width:100%; box-sizing:border-box; padding:12px; color:var(--primary-text-color); text-decoration:none; }
      .parcel-row + .parcel-row { border-top: 1px solid var(--divider-color); }
      a.parcel-row { position:relative; z-index:3; pointer-events:auto !important; cursor:pointer; touch-action:manipulation; }
      a.parcel-row > * { pointer-events:none !important; }
      a.parcel-row:focus-visible { outline:2px solid var(--primary-color); outline-offset:-4px; border-radius:inherit; }
      .parcel-icon { width:44px; height:44px; border-radius:50%; display:grid; place-items:center; flex:0 0 44px; color:var(--parcel-color); background:var(--secondary-background-color); }
      .parcel-icon ha-icon { --mdc-icon-size:24px; color:inherit; }
      .parcel-copy { flex:1; min-width:0; }
      .parcel-name { font-weight:600; overflow-wrap:anywhere; }
      .parcel-meta, .parcel-empty { color:var(--secondary-text-color); font-size:13px; line-height:1.4; overflow-wrap:anywhere; }
      .parcel-progress { display:block; width:100%; height:4px; margin-top:8px; accent-color:var(--parcel-color); }
      .parcel-row .parcel-open { width:24px; height:24px; display:grid; place-items:center; color:var(--secondary-text-color); flex:0 0 24px; }
      .parcel-row .parcel-open ha-icon { --mdc-icon-size:20px; }
      .parcel-empty { padding:16px; }
    `,
  };
}

function applyNotificationOptions(dashboard, config, hass) {
  if (config.show_notifications === false) return dashboard;
  const cards = dashboard.views?.[0]?.sections?.[0]?.cards;
  if (!Array.isArray(cards)) return dashboard;
  const list = (category = "") => ({ type: "custom:smartphone-dashboard-alerts", category });
  const controls = { type: "custom:smartphone-dashboard-notification-controls" };
  const wasteEntities = csv(notificationSetting(config, hass, "waste_entities"));

  cards.push(bubblePopup("#meldungen", {
    button_type: "name", name: "Meldungen", icon: "mdi:bell-badge-outline",
  }, [list(), controls]));

  for (const [category, [hash, name, icon]] of Object.entries(ALERT_POPUPS)) {
    const content = category === "parcel"
      ? parcelFeatureCards({ entities: parcelSensorEntities(hass) }, hass)
      : [list(category)];
    if (category === "waste") content.push(wasteAgendaCard(hass, wasteEntities));
    cards.push(bubblePopup(hash, { button_type: "name", name, icon }, [...content, controls]));
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
  const headingIndex = cards.findIndex((card) => homeSectionKey(card) === "quick_actions");
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
          name: appearance.name || attributes.friendly_name || entity,
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

function lightSupportsBrightness(hass, entityId) {
  if (!String(entityId || "").startsWith("light.")) return false;
  const attributes = hass?.states?.[entityId]?.attributes || {};
  const colorModes = Array.isArray(attributes.supported_color_modes)
    ? attributes.supported_color_modes.map((mode) => String(mode).toLowerCase())
    : [];
  if (colorModes.length) {
    return colorModes.some((mode) => !["onoff", "unknown"].includes(mode));
  }
  return (Number(attributes.supported_features) & 1) === 1 ||
    Object.prototype.hasOwnProperty.call(attributes, "brightness");
}

function genericRoomPopup(room, hass, shortSwitchNames) {
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
  const nameOption = (entity, defaultShort = false) => {
    const name = roomEntityName(hass, entity, room.entity_name_modes?.[entity], defaultShort);
    return name ? { name } : {};
  };
  const sensorMetricRank = (entityId) => {
    const attributes = hass?.states?.[entityId]?.attributes || {};
    const deviceClass = String(attributes.device_class || "").toLowerCase();
    const descriptor = `${entityId} ${entityDisplayName(hass, entityId)} ${deviceClass} ${attributes.unit_of_measurement || ""}`.toLowerCase();
    if (deviceClass === "temperature" || /temperature|temperatur|°c|°f/.test(descriptor)) return 0;
    if (deviceClass === "humidity" || /humidity|luftfeuchtigkeit/.test(descriptor)) return 1;
    if (deviceClass === "carbon_dioxide" || /co2|co₂|carbon.dioxide|kohlendioxid|ppm/.test(descriptor)) return 2;
    if (["pm25", "particulate_matter_2_5"].includes(deviceClass) || /pm[_. -]?2[_.]?5|particulate.*2[_.]?5|feinstaub.*2[_.]?5/.test(descriptor)) return 3;
    if (deviceClass === "pm10" || /pm[_. -]?10|particulate.*10|feinstaub.*10/.test(descriptor)) return 4;
    if (deviceClass === "pm1" || /pm[_. -]?1(?:\D|$)|particulate.*1(?:\D|$)|feinstaub.*1(?:\D|$)/.test(descriptor)) return 5;
    if (/volatile_organic_compounds|voc|flüchtige.*verbindung/.test(descriptor)) return 6;
    if (deviceClass === "pressure" || /luftdruck|pressure|hpa|mbar/.test(descriptor)) return 7;
    if (deviceClass === "illuminance" || /beleuchtungsstärke|illuminance|\blux\b/.test(descriptor)) return 8;
    if (deviceClass === "battery" || /battery|batterie|akku/.test(descriptor)) return 9;
    return 100;
  };
  const sensors = entities.filter((entityId) => {
    if (!entityId.startsWith("sensor.")) return false;
    const state = hass?.states?.[entityId];
    return Boolean(state?.attributes?.unit_of_measurement) && !["unknown", "unavailable"].includes(state?.state);
  }).sort((left, right) =>
    sensorMetricRank(left) - sensorMetricRank(right) ||
    entityDisplayName(hass, left).localeCompare(entityDisplayName(hass, right), "de"));
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
    lights.map((entity) => {
      const dimmable = lightSupportsBrightness(hass, entity);
      return {
        type: "custom:bubble-card",
        card_type: "button",
        button_type: dimmable ? "slider" : "switch",
        entity,
        ...nameOption(entity, shortSwitchNames),
        ...(dimmable ? { show_attribute: true, attribute: "brightness" } : {}),
      };
    }),
  );
  addGroup(
    "Schalter",
    "mdi:toggle-switch-outline",
    switches.map((entity) => ({
      type: "custom:bubble-card",
      card_type: "button",
      button_type: "switch",
      entity,
      ...nameOption(entity, shortSwitchNames),
    })),
  );
  addGroup(
    "Klima",
    "mdi:home-thermometer-outline",
    climates.map((entity) => ({
      type: "custom:bubble-card",
      card_type: "climate",
      entity,
      ...nameOption(entity),
    })),
  );
  addGroup(
    "Medien",
    "mdi:cast-audio",
    mediaPlayers.map((entity) => ({
      type: "custom:bubble-card",
      card_type: "media-player",
      entity,
      ...nameOption(entity),
    })),
  );
  addGroup("Abdeckungen", "mdi:blinds", covers.map((entity) => ({
    type: "custom:bubble-card", card_type: "cover", entity, ...nameOption(entity),
  })));
  addGroup("Lüfter", "mdi:fan", fans.map((entity) => ({
    type: "custom:bubble-card", card_type: "button", button_type: "switch", entity, ...nameOption(entity),
  })));
  addGroup("Kameras", "mdi:cctv", cameras.map((entity) => ({
    type: "picture-entity", entity, camera_view: "live", show_name: true, show_state: false, ...nameOption(entity),
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
        return graphSensorCard(entity, hass, {
          ...appearance,
          ...nameOption(entity, true),
        });
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

  return bubblePopup(room.popup_hash, {
    button_type: room.main_light ? "switch" : "name",
    name: room.name,
    icon: room.icon,
    entity: room.main_light || undefined,
    show_name: true,
    ...(room.entity_count ? { styles: ACTIVE_ROOM_STYLES } : {}),
  }, cards);
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
      cards: rooms.map((room) => {
        const dimmable = lightSupportsBrightness(hass, room.main_light);
        return {
          type: "custom:bubble-card",
          card_type: "button",
          button_type: room.main_light ? (dimmable ? "slider" : "switch") : "name",
          name: room.name,
          icon: room.icon,
          ...(room.main_light ? {
            entity: room.main_light,
            ...(dimmable ? {
              light_slider_type: "brightness",
              slider_fill_orientation: "left",
              slider_value_position: "right",
            } : {}),
          } : {}),
          tap_action: { action: room.main_light ? "toggle" : "none" },
          button_action: {
            tap_action: { action: "navigate", navigation_path: room.popup_hash },
          },
          ...(room.entity_count ? { styles: ACTIVE_ROOM_STYLES } : {}),
        };
      }),
    };
  }

  const legacyHashes = new Set(["#kueche", "#wohnzimmer", "#schlafzimmer", "#arbeitszimmer"]);
  const firstLegacyPopup = cards.findIndex((card) => legacyHashes.has(card?.hash));
  const withoutRoomPopups = cards.filter((card) => !legacyHashes.has(card?.hash));
  const insertionIndex = firstLegacyPopup < 0 ? withoutRoomPopups.length : firstLegacyPopup;
  // Bekannte und neue Räume werden vollständig aus der Area Registry erzeugt.
  const popups = rooms.map((room) => genericRoomPopup(room, hass, config.short_switch_names !== false));
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
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    const key = homeSectionKey(card);
    if (key && !visible[key]) {
      const next = cards[index + 1];
      if (next && !homeSectionKey(next) && next?.card_type !== "pop-up") index += 1;
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
  return dashboardEntityIndex(hass).stateIds.filter((id) =>
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
  const pvTotal = config?.features?.energy?.pv_total;
  if (pvTotal !== undefined && (typeof pvTotal !== "string" || (pvTotal && !/^sensor\.[a-z0-9_]+$/.test(pvTotal)))) {
    errors.push("Energie · PV-Gesamtleistung erwartet eine Sensor-Entitäts-ID.");
  }
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
  if (key === "energy") return [];
  if (key === "parcels") return parcelSensorEntities(hass);
  if (key === "security") {
    const printerDeviceIds = new Set(autoBambuPrinterIds(hass));
    return [
      ...entityIds(hass, "alarm_control_panel"),
      ...entityIds(hass, "camera").filter((entityId) =>
        !isPrinterCameraEntity(hass, entityId, printerDeviceIds)),
      ...entityIds(hass, "lock"),
    ];
  }
  const registry = entityRegistryMap(hass);
  if (key === "printer") return dashboardEntityIndex(hass).stateIds.filter((id) =>
    isEntityVisible(hass, id, registry) &&
    /^(sensor|binary_sensor|switch|button|number|select)\./.test(id) &&
    /printer|druck|bambu|octoprint|klipper|moonraker/i.test(id),
  );
  return dashboardEntityIndex(hass).stateIds.filter((id) =>
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
  const index = dashboardEntityIndex(hass);
  const devices = index.devices;
  const deviceById = index.deviceById;
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

function isPrinterCameraEntity(hass, entityId, knownPrinterDeviceIds = new Set(autoBambuPrinterIds(hass))) {
  if (!entityId.startsWith("camera.")) return false;
  const registry = entityRegistryMap(hass);
  const entry = registry.get(entityId);
  if (entry?.device_id && knownPrinterDeviceIds.has(entry.device_id)) return true;
  const device = dashboardEntityIndex(hass).deviceById.get(entry?.device_id);
  const descriptor = [
    entityId,
    hass?.states?.[entityId]?.attributes?.friendly_name,
    entry?.platform,
    entry?.original_name,
    device?.manufacturer,
    device?.model,
    device?.name,
    device?.name_by_user,
  ].filter(Boolean).join(" ");
  return /bambu|3d[ _-]?druck|3d[ _-]?print|octoprint|klipper|moonraker/i.test(descriptor);
}

const FEATURE_META = {
  media: ["Medien", "mdi:cast-audio", "#medien"],
  energy: ["Energie", "mdi:lightning-bolt", "#energie"],
  parcels: ["Pakete", "mdi:package-variant-closed", "#pakete"],
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

function securityMasterAlarm(configuredEntity, entities, hass) {
  const alarmPanels = entities.filter((entityId) => entityId.startsWith("alarm_control_panel."));
  if (!alarmPanels.length) return "";
  if (alarmPanels.includes(configuredEntity)) return configuredEntity;
  const namedMaster = alarmPanels.find((entityId) => {
    const friendlyName = hass?.states?.[entityId]?.attributes?.friendly_name || "";
    return /(?:^|[\s_.-])(master|haupt(?:alarm|anlage)?|zentrale?)(?:$|[\s_.-])/i.test(
      `${entityId} ${friendlyName}`,
    );
  });
  return namedMaster || [...alarmPanels].sort((left, right) => {
    const leftName = hass?.states?.[left]?.attributes?.friendly_name || left;
    const rightName = hass?.states?.[right]?.attributes?.friendly_name || right;
    return leftName.localeCompare(rightName, "de");
  })[0];
}

function configuredFeatures(config, hass) {
  const configured = config.features && typeof config.features === "object" ? config.features : {};
  const registry = entityRegistryMap(hass);
  const index = dashboardEntityIndex(hass);
  const existingEntities = new Set(
    index.stateIds.filter((entityId) => isEntityVisible(hass, entityId, registry)),
  );
  const existingDevices = new Set(index.devices.map((device) => device.id));
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
    const manualEntities = key !== "energy" && Array.isArray(item.entities)
      ? item.entities.filter((entityId) => existingEntities.has(entityId) && !excluded.has(entityId))
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
    let entities = [...new Set([
      ...automaticEntities,
      ...manualEntities,
    ])];
    if (key === "security") {
      const printerDeviceIds = new Set(autoBambuPrinterIds(hass));
      entities = entities.filter((entityId) =>
        !isPrinterCameraEntity(hass, entityId, printerDeviceIds));
    }
    return {
      key,
      name: item.name || meta[0],
      icon: item.icon || meta[1],
      hash: Object.values(requestedHashes).filter((hash) => hash === requestedHashes[key]).length > 1
        ? meta[2]
        : requestedHashes[key],
      enabled: item.enabled !== false,
      auto_discover: item.auto_discover !== false,
      entities,
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
      ...(key === "energy" && item.pv_total && { pv_total: item.pv_total }),
      master_alarm: key === "security"
        ? securityMasterAlarm(item.master_alarm, entities, hass)
        : "",
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
  const devices = dashboardEntityIndex(hass).deviceById;
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

function securityFeatureCards(item, hass) {
  const alarmEntities = item.entities.filter((entityId) =>
    entityId.startsWith("alarm_control_panel.") && hass?.states?.[entityId]);
  const singleHeaderAlarm = alarmEntities.length === 1 && alarmEntities[0] === item.master_alarm
    ? item.master_alarm
    : "";
  const priority = (entityId) => {
    if (entityId === item.master_alarm) return -1;
    if (entityId.startsWith("alarm_control_panel.")) return 0;
    if (entityId.startsWith("camera.")) return 1;
    if (entityId.startsWith("lock.")) return 2;
    return 3;
  };
  return [...item.entities]
    .filter((entityId) => hass?.states?.[entityId] && entityId !== singleHeaderAlarm)
    .sort((left, right) => {
      const difference = priority(left) - priority(right);
      if (difference) return difference;
      const leftName = hass.states[left]?.attributes?.friendly_name || left;
      const rightName = hass.states[right]?.attributes?.friendly_name || right;
      return leftName.localeCompare(rightName, "de");
    })
    .map((entityId) => featureEntityCard(entityId, hass));
}

function requestedMediaPlayer(hass) {
  try {
    const entityId = new URLSearchParams(globalThis.location?.search || "").get("sd_media") || "";
    return /^media_player\.[a-z0-9_]+$/i.test(entityId) && hass?.states?.[entityId]
      ? entityId
      : "";
  } catch (_error) {
    return "";
  }
}

function featurePopupCards(item, hass) {
  if (item.key === "energy") return [{
    type: "custom:smartphone-dashboard-deferred-cards",
    popup_hash: item.hash,
    card_source: "energy",
    ...(item.pv_total && { pv_total: item.pv_total }),
    cards: [],
  }];
  if (item.key === "parcels") return parcelFeatureCards(item, hass);
  if (item.key === "printer") return printerFeatureCards(item, hass);
  if (item.key === "system") return systemFeatureCards(item, hass);
  if (item.key === "security") return securityFeatureCards(item, hass);
  const preferredMedia = item.key === "media" ? requestedMediaPlayer(hass) : "";
  return [...item.entities]
    .sort((left, right) => {
      if (left === preferredMedia) return -1;
      if (right === preferredMedia) return 1;
      return 0;
    })
    .filter((id) => hass?.states?.[id])
    .map((id) => featureEntityCard(id, hass));
}

function parcelFeatureCards(item, hass) {
  const calendars = parcelCalendarEntities(hass);
  if (!item.entities.length && !calendars.length) return [];
  const cards = item.entities.length ? [parcelOverviewCard(item.entities, hass)] : [];
  cards.push(parcelAgendaCard(hass, item.entities, calendars));
  return cards;
}

function applyDynamicFeatures(dashboard, config, hass) {
  const cards = dashboard.views?.[0]?.sections?.[0]?.cards;
  if (!Array.isArray(cards)) return dashboard;
  const legacyHashes = new Set(["#medien", "#energie", "#pakete", "#3ddruck", "#info", "#camera_alarm", "#system", "#sicherheit"]);
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
  const popups = features.map((item) => {
    const securityHeader = item.key === "security" && item.master_alarm
      ? {
          entity: item.master_alarm,
          button_type: "state",
          show_state: true,
          tap_action: { action: "more-info" },
        }
      : { button_type: "name", name: item.name, icon: item.icon };
    return bubblePopup(item.hash, securityHeader, item.popup_cards);
  });
  if (navigationHeadingIndex >= 0 && cleaned[navigationHeadingIndex + 1]?.type === "grid") {
    cleaned[navigationHeadingIndex + 1] = navigation;
  } else {
    const popupIndex = cleaned.findIndex((card) => card?.card_type === "pop-up");
    const insertionIndex = popupIndex < 0 ? cleaned.length : popupIndex;
    cleaned.splice(insertionIndex, 0,
      sectionHeading("navigation", "mdi:view-grid-plus-outline"),
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
  const standaloneKey = (card) => {
    if (card?.card_type === "pop-up") return "popup";
    if (card?.type === "horizontal-stack" && card.cards?.some((x) => x?.entity?.startsWith("person."))) return "persons";
    if (card?.type === "vertical-stack" && card.cards?.[0]?.name === "Meldungen") return "notifications";
    return "other";
  };
  const blocks = [];
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    const sectionKey = homeSectionKey(card);
    const key = sectionKey || standaloneKey(card);
    const block = [card];
    if (sectionKey && cards[index + 1] && !homeSectionKey(cards[index + 1]) && cards[index + 1]?.card_type !== "pop-up") {
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
  delete result.waste_frequency;
  delete result.waste_frequencies;
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
        ...(key === "energy" ? {} : { auto_discover: true, entities: [] }),
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
  short_switch_names: true,
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
  notification_parcels: true,
  notification_media: true,
  notification_appliances: true,
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
    const registrySources = [hass?.areas, hass?.devices, hass?.entities, hass?.services?.notify];
    const registrySourcesChanged = !this._registrySources || registrySources.some(
      (source, index) => source !== this._registrySources[index],
    );
    let registryChanged = false;
    if (registrySourcesChanged) {
      const index = dashboardEntityIndex(hass);
      const registrySignature = JSON.stringify([
        index.areas.map((x) => [x.area_id, x.name]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        index.devices.map((x) => [x.id, x.area_id, x.manufacturer, x.model, x.name, x.name_by_user]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        index.registryEntries.map((x) => [x.entity_id, x.area_id, x.device_id, x.disabled_by, x.hidden_by, x.hidden, x.name, x.original_name, x.platform, x.unique_id]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        Object.keys(hass?.services?.notify || {}).sort(),
      ]);
      registryChanged = Boolean(previousHass && this._registrySignature && this._registrySignature !== registrySignature);
      this._registrySignature = registrySignature;
      this._registrySources = registrySources;
    }
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
    if (BACKEND_NOTIFICATION_KEYS.includes(key)) {
      const cacheKey = displayConfigCacheKey(this._hass);
      const displayConfig = { ...(cachedDisplayNotificationConfigs.get(cacheKey) || {}), [key]: value };
      cachedDisplayNotificationConfigs.set(cacheKey, displayConfig);
      writeDisplayConfigCache(this._hass, displayConfig);
    }
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
      for (const key of BACKEND_NOTIFICATION_KEYS) {
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
      room.area_id === areaId
        ? { ...room, ...(typeof changes === "function" ? changes(room) : changes) }
        : room,
    );
    this._update("rooms", rooms);
  }

  async _removeMissingRooms(areaIds) {
    const config = this._config;
    const areas = await this._hass.callWS({ type: "config/area_registry/list" });
    if (this._disposed || config !== this._config) return false;
    if (!Array.isArray(areas) || areas.some((area) => typeof area?.area_id !== "string")) {
      throw new Error("Bereichsliste ist ungültig");
    }
    const knownIds = new Set(areas.map((area) => area.area_id));
    const missingIds = new Set(areaIds.filter((id) => !knownIds.has(id)));
    const rooms = config.rooms.filter((room) => !missingIds.has(room?.area_id));
    if (rooms.length === config.rooms.length) return false;
    this._update("rooms", rooms);
    return true;
  }

  _updatePerson(entityId, changes) {
    const persons = detectedPersons(this._hass, this._config.persons).map((person) =>
      person.entity === entityId ? { ...person, ...changes } : person,
    );
    this._update("persons", persons);
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
      picker.addEventListener("value-changed", (event) => {
        // ha-selector bubbles its own value event through the Lovelace editor.
        // Only our config-changed event may leave this editor; otherwise Home
        // Assistant can recreate the complete strategy editor after every
        // selected item and closes an open multi-select menu.
        event.stopPropagation();
        const selected = this._selectorValue(event, multiple);
        picker.value = selected;
        onChange(selected);
      });
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

  _addReorderControls(row, host, key, getEntries, entryKey, getId, label) {
    const entries = getEntries();
    const index = entries.findIndex((entry) => getId(entry) === entryKey);
    const move = (source, target, offset = 0) => {
      const ordered = [...getEntries()];
      const from = ordered.findIndex((entry) => getId(entry) === source);
      const targetIndex = ordered.findIndex((entry) => getId(entry) === target);
      if (from < 0 || targetIndex < 0) return;
      const to = targetIndex + offset;
      if (to < 0 || to >= ordered.length || from === to) return;
      const [entry] = ordered.splice(from, 1);
      ordered.splice(to, 0, entry);
      this._update(key, ordered);
      this._render();
      [...this.shadowRoot.querySelectorAll("[data-reorder-key]")].find(
        (item) => item.dataset.reorderKey === key && item.dataset.reorderEntry === getId(entry),
      )?.focus();
    };
    row.tabIndex = -1;
    row.dataset.reorderKey = key;
    row.dataset.reorderEntry = entryKey;
    row.draggable = true;
    const transferType = `application/x-smartphone-dashboard-${key}`;
    row.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData(transferType, entryKey);
      event.dataTransfer.effectAllowed = "move";
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("dragover", (event) => {
      if (event.dataTransfer.types.includes(transferType)) event.preventDefault();
    });
    row.addEventListener("drop", (event) => {
      const source = event.dataTransfer.getData(transferType);
      if (!source) return;
      event.preventDefault();
      move(source, entryKey);
    });
    const controls = document.createElement("div");
    controls.className = "reorder-controls";
    for (const [step, icon, direction] of [
      [-1, "mdi:chevron-up", "nach oben"],
      [1, "mdi:chevron-down", "nach unten"],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.title = `${label} ${direction} verschieben`;
      button.setAttribute("aria-label", button.title);
      button.disabled = index + step < 0 || index + step >= entries.length;
      const symbol = document.createElement("ha-icon");
      symbol.setAttribute("icon", icon);
      controls.append(button);
      button.append(symbol);
      button.addEventListener("click", () => move(entryKey, entryKey, step));
    }
    host.append(controls);
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

    for (const person of persons) {
      const item = document.createElement("div");
      item.className = "person-item";
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

      const sensorLabel = this._entitySelector(
        "Fahrzeitsensor nach Hause (optional)",
        person.travel_sensor,
        { domain: "sensor" },
        (value) => this._updatePerson(person.entity, { travel_sensor: value }),
      );
      sensorLabel.classList.add("person-sensor");

      this._addReorderControls(item, row, "persons", () => detectedPersons(this._hass, this._config.persons),
        person.entity, (entry) => entry.entity,
        row.querySelector(".person-name").textContent);

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
      this._addReorderControls(item, item, "quick_actions", () => configuredQuickActions(this._hass, this._config.quick_actions),
        entityId, (entry) => entry,
        item.querySelector(".action-name").textContent);
      container.appendChild(item);
    }
  }

  _renderRooms(container) {
    const rooms = detectedRooms(this._hass, this._config.rooms);
    if (this._hass?.areas && Array.isArray(this._config.rooms)) {
      const { areaById } = dashboardEntityIndex(this._hass);
      const missingIds = [...new Set(this._config.rooms
        .map((room) => room?.area_id).filter((id) => id && !areaById.has(id)))];
      if (missingIds.length) {
        const cleanup = document.createElement("div");
        cleanup.innerHTML = `
          <p class="hint"></p>
          <button type="button">Veraltete Bereiche entfernen</button>
          <p class="hint" role="status"></p>
        `;
        cleanup.querySelector("p").textContent =
          `Die Bereichs-IDs ${missingIds.join(", ")} sind unbekannt. Speichere anschließend das Dashboard.`;
        const button = cleanup.querySelector("button");
        const status = cleanup.querySelector("[role=status]");
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            if (await this._removeMissingRooms(missingIds)) this._render();
            else status.textContent = "Keine Einträge entfernt. Prüfe die aktuelle Bereichsliste.";
          } catch {
            status.textContent = "Die Home-Assistant-Bereichsliste konnte nicht geprüft werden.";
          } finally {
            button.disabled = false;
          }
        });
        container.appendChild(cleanup);
      }
    }

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
      const expand = header.querySelector(".expand");
      const updateExpanded = () => {
        expand.textContent = body.hidden ? "⌄" : "⌃";
        expand.setAttribute("aria-expanded", String(!body.hidden));
        expand.setAttribute("aria-label", `${room.name} konfigurieren`);
      };
      updateExpanded();

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
        const row = document.createElement("div");
        row.className = "room-entity-setting";
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
          const visible = event.currentTarget.checked;
          this._updateRoom(room.area_id, (currentRoom) => {
            const hidden = new Set(currentRoom.hidden_entities || []);
            if (visible) hidden.delete(entityId);
            else hidden.add(entityId);
            return { hidden_entities: [...hidden] };
          });
        });
        label.append(checkbox, copy);
        row.appendChild(label);

        const domain = entityId.split(".")[0];
        const sensorUnit = this._hass.states[entityId]?.attributes?.unit_of_measurement;
        if (ROOM_NAMED_DOMAINS.has(domain) || (domain === "sensor" && sensorUnit)) {
          const select = document.createElement("select");
          select.setAttribute("aria-label", `Namensanzeige für ${friendlyName}`);
          for (const [value, title] of ROOM_ENTITY_NAME_OPTIONS) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = title;
            select.appendChild(option);
          }
          select.value = room.entity_name_modes?.[entityId] ?? "";
          select.addEventListener("change", (event) => {
            const mode = event.currentTarget.value;
            this._updateRoom(room.area_id, (currentRoom) => {
              const names = { ...currentRoom.entity_name_modes };
              if (mode) names[entityId] = mode;
              else delete names[entityId];
              return { entity_name_modes: names };
            });
          });
          row.appendChild(select);
        }
        body.appendChild(row);
      }

      expand.addEventListener("click", () => {
        body.hidden = !body.hidden;
        if (body.hidden) this._expandedRooms.delete(room.area_id);
        else this._expandedRooms.add(room.area_id);
        updateExpanded();
      });

      this._addReorderControls(item, header, "rooms", () => detectedRooms(this._hass, this._config.rooms),
        room.area_id, (entry) => entry.area_id, room.name);

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
        .editor { display: grid; gap: 12px; color: var(--primary-text-color); }
        .intro { padding: 4px 2px 8px; }
        h2 { margin: 0 0 6px; font-size: 22px; }
        .version { margin-inline-start: 8px; color: var(--secondary-text-color); font-size: 12px; font-weight: 400; vertical-align: middle; }
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
        summary ha-icon { color: var(--secondary-text-color); }
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
        .reorder-controls { display: flex; margin-inline-start: auto; }
        .reorder-controls button {
          display: grid; place-items: center; height: 44px; width: 44px; padding: 0;
          color: var(--secondary-text-color); background: transparent;
          border: 0; border-radius: 8px; cursor: pointer;
        }
        .reorder-controls button:disabled { opacity: .35; cursor: default; }
        .reorder-controls ha-icon { color: inherit; }
        .editor button:focus-visible, .editor summary:focus-visible, [data-reorder-key]:focus {
          outline: 2px solid var(--primary-color); outline-offset: -2px;
        }
        @media (pointer: coarse) { .drag { display: none; } }
        @media (max-width: 440px) {
          .room-header, .person-row, .action-item { flex-wrap: wrap; gap: 4px; }
          .room-body { padding-inline: 12px; }
          .action-add { grid-template-columns: minmax(0, 1fr); }
          .action-add button { min-height: 44px; }
        }
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
        .room-entity-setting { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 12px; }
        .room-entity-setting .entity-row { flex: 1 1 15rem; min-width: 0; overflow-wrap: anywhere; }
        .room-entity-setting select { width: auto; max-width: 100%; min-height: 36px; padding: 6px 8px; font-size: 13px; }
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
            <div class="switch-row"><div class="switch-copy"><div class="switch-title">Pakete</div><div class="switch-description">Aktive Sendungen aus den HA Parcel Integrations im Dashboard und als iPhone Live Activities anzeigen.</div></div><ha-switch data-switch="notification_parcels"></ha-switch></div>
            <div class="switch-row"><div class="switch-copy"><div class="switch-title">Aktive Medien</div><div class="switch-description">Abspielende Media Player als stille iPhone Live Activities anzeigen. Die Auswahl folgt dem Bereich „Medien“.</div></div><ha-switch data-switch="notification_media"></ha-switch></div>
            <div class="switch-row"><div class="switch-copy"><div class="switch-title">Laufende Haushaltsgeräte</div><div class="switch-description">Spülmaschine, Waschmaschine, Trockner und Backofen während eines laufenden Programms mit Fortschritt und Restzeit als iPhone Live Activities anzeigen.</div></div><ha-switch data-switch="notification_appliances"></ha-switch></div>
          </div>
        </details>

        <details data-panel="actions" ${panelOpen("actions")}>
          <summary><ha-icon icon="mdi:gesture-tap"></ha-icon>Schnellaktionen</summary>
          <div class="panel actions-panel" data-action-panel></div>
        </details>

        <details data-panel="synchronization" ${panelOpen("synchronization")}>
          <summary><ha-icon icon="mdi:bell-sync-outline"></ha-icon>Benachrichtigungen & Synchronisierung</summary>
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
            <div class="entity-title">Benachrichtigungen</div>
            <div data-notify-selector-host></div>
            <div data-battery-selector-host></div>
            <div data-frost-selector-host></div>
            <div data-waste-selector-host></div>
            <div data-ups-selector-host></div>
            <label class="native-field">NINA-Entitätsmuster<input data-nina-entities type="text" list="nina-entity-suggestions"><datalist id="nina-entity-suggestions"></datalist><span class="hint">Genau ein * als Platzhalter verwenden, zum Beispiel binary_sensor.nina_warning_*.</span><span class="field-error" data-nina-error></span></label>
            <p class="hint">Das Backend pflegt genau eine zusammengefasste Persistent Notification. Optionale iPhone-Push-Mitteilungen werden ersetzt statt gestapelt und bei Entwarnung entfernt.</p>
            <p class="hint" data-notification-service-status aria-live="polite"></p>
          </div>
        </details>

        <details data-panel="rooms" ${panelOpen("rooms")}>
          <summary><ha-icon icon="mdi:floor-plan"></ha-icon>Räume</summary>
          <div class="panel">
            <div class="switch-row">
              <div class="switch-copy">
                <div class="switch-title">Kurze Namen für Licht und Schalter</div>
                <div class="switch-description">Gilt für Entitäten mit der Namensauswahl „Standard“.</div>
              </div>
              <ha-switch data-switch="short_switch_names" aria-label="Kurze Namen für Licht und Schalter"></ha-switch>
            </div>
          </div>
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
      ["show_quick_actions", "Schnellaktionen", "Ausgewählte Skripte direkt ausführen."],
      ["show_rooms", "Räume", "Räume öffnen und Hauptlichter steuern."],
      ["show_navigation", "Weitere Bereiche", "Pakete, Medien, Energie, System, Sicherheit und 3D-Druck anzeigen."],
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
    const homeOrder = this.shadowRoot.querySelector("[data-home-order]");
    for (const key of this._config.home_sections) {
      const item = document.createElement("div"); item.className = "action-item";
      item.innerHTML = `<span class="drag">⋮⋮</span><div class="action-copy"><div class="action-name"></div></div>`;
      const label = HOME_SECTION_LABELS[key] || "Sonstige Karten";
      item.querySelector(".action-name").textContent = label;
      this._addReorderControls(item, item, "home_sections", () => this._config.home_sections, key,
        (entry) => entry, label);
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
    const notifyOptions = Object.keys(this._hass?.services?.notify || {}).filter((service) => service !== "persistent_notification").sort().map((service) => ({
      value: `notify.${service}`,
      label: `notify.${service}`,
    }));
    this.shadowRoot.querySelector("[data-notify-selector-host]").replaceWith(this._createSelector({
      label: "iPhone-/Push-Dienste (optional)",
      value: notificationList("notification_recipients").filter((service) => service !== "notify.persistent_notification"),
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
      const energy = feature.key === "energy";
      const sourceFields = energy
        ? '<div data-pv-total-host></div><p class="hint">Ohne Auswahl wird ein passender PV-Gesamtsensor automatisch erkannt.</p>'
        : `<div class="switch-row"><div class="switch-copy"><div class="switch-title">Neue Entitäten automatisch ergänzen</div></div><ha-switch data-auto></ha-switch></div>
          ${feature.key === "security" ? '<div data-master-alarm-host></div>' : ""}
          ${feature.key === "printer" ? '<div data-printer-ids-host></div><label class="select-label">Automatisch erkannte Bambu-Lab Geräte-IDs<textarea class="readonly-list" data-auto-printer-ids rows="3" readonly></textarea></label><div data-excluded-printer-ids-host></div>' : ""}
          <div data-entities-host></div>
          <label class="select-label">Automatisch erkannte Entitäten<textarea class="readonly-list" data-auto-entities rows="5" readonly></textarea></label>
          <div data-excluded-host></div>`;
      row.innerHTML = `<div class="switch-row"><div class="switch-copy"><div class="switch-title"></div><div class="switch-description"></div></div><ha-switch data-enabled></ha-switch></div>
        <ha-textfield data-name label="Name"></ha-textfield>
        <div data-feature-icon-host></div>
        <label class="native-field">Navigations-Hash<input data-hash type="text" list="${hashListId}"></label>
        <datalist id="${hashListId}"></datalist><div class="field-error" data-hash-error></div>
        ${sourceFields}`;
      row.querySelector(".switch-title").textContent = feature.name;
      const featureItemCount = feature.entities.length + feature.printer_ids.length;
      row.querySelector(".switch-description").textContent = energy
        ? "Quellen aus dem Home-Assistant-Energie-Dashboard"
        : `${featureItemCount} Einträge · ${feature.hash}`;
      const toggle = row.querySelector("[data-enabled]");
      toggle.checked = feature.enabled;
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
      const updateFeature = (changes) => this._update("features", {
        ...(this._config.features || {}),
        [feature.key]: { ...(this._config.features?.[feature.key] || {}), ...changes },
      });
      row.querySelector("[data-feature-icon-host]").replaceWith(this._iconSelector("Icon", feature.icon, (value) => updateFeature({ icon: value })));
      const hashSuggestions = Object.values(FEATURE_META).map((meta) => meta[2]);
      row.querySelector(`#${hashListId}`).append(...hashSuggestions.map((hash) => { const option = document.createElement("option"); option.value = hash; return option; }));
      toggle.addEventListener("change", (event) => updateFeature({ enabled: event.currentTarget.checked }));
      nameField.addEventListener("change", (event) => updateFeature({ name: event.currentTarget.value.trim() }));
      hashField.addEventListener("input", validateHash);
      hashField.addEventListener("change", () => {
        const candidate = validateHash();
        if (!candidate) return;
        updateFeature({ hash: candidate });
        this._render();
      });
      if (energy) {
        row.querySelector("[data-pv-total-host]").replaceWith(this._entitySelector(
          "PV-Gesamtleistung für die Hausgrafik", feature.pv_total || "",
          { domain: "sensor", device_class: "power" }, (value) => updateFeature({ pv_total: value }),
        ));
        featurePanel.appendChild(row);
        continue;
      }

      const autoToggle = row.querySelector("[data-auto]");
      autoToggle.checked = feature.auto_discover;
      autoToggle.addEventListener("change", (event) => { updateFeature({ auto_discover: event.currentTarget.checked }); this._render(); });
      row.querySelector("[data-auto-entities]").value = feature.automatic_entities.join("\n");
      if (feature.key === "security") {
        row.querySelector("[data-master-alarm-host]").replaceWith(this._entitySelector(
          "Master-Alarmanlage im Kopfbereich", feature.master_alarm,
          { domain: "alarm_control_panel" }, (value) => updateFeature({ master_alarm: value }),
        ));
      }
      row.querySelector("[data-entities-host]").replaceWith(this._entitySelector(
        "Manuell hinzugefügte Entitäten", feature.manual_entities, { multiple: true }, (value) => updateFeature({ entities: value }),
      ));
      row.querySelector("[data-excluded-host]").replaceWith(this._entitySelector(
        "Automatisch erkannte Entitäten ausblenden", feature.excluded_entities, { multiple: true },
        (value) => updateFeature({ excluded_entities: value }),
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
          onChange: (value) => updateFeature({ excluded_printer_ids: value }),
        }));
      }
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

function registerDashboardComponents(registry) {
  for (const [tag, component] of [
    ["smartphone-dashboard-strategy-editor", SmartphoneDashboardStrategyEditor],
    ["smartphone-dashboard-deferred-cards", SmartphoneDashboardDeferredCards],
    ["smartphone-dashboard-energy", SmartphoneDashboardEnergy],
    ["smartphone-dashboard-notification-controls", SmartphoneDashboardNotificationControls],
    ["smartphone-dashboard-alerts", SmartphoneDashboardAlerts],
    ["smartphone-dashboard-agenda", SmartphoneDashboardAgenda],
  ]) {
    if (!registry.get(tag)) registry.define(tag, component);
  }
}

console.info(`Smartphone-Dashboard-Strategy v${STRATEGY_VERSION} geladen`);

export {
  SmartphoneDashboardStrategy,
  SmartphoneDashboardStrategyEditor,
  registerDashboardComponents,
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
  parcelSensorEntities,
  popupContentCards,
};
