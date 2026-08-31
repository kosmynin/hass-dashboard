import assert from "node:assert/strict";
globalThis.HTMLElement = class { attachShadow() { this.shadowRoot = { activeElement: null, querySelector: () => null, querySelectorAll: () => [] }; return this.shadowRoot; } dispatchEvent() {} };
globalThis.customElements = { registry: new Map(), get(name) { return this.registry.get(name); }, define(name, value) { this.registry.set(name, value); }, whenDefined() { return Promise.resolve(); } };
globalThis.window = globalThis;
const { SmartphoneDashboardStrategy, SmartphoneDashboardStrategyEditor, partitionConflictPatch, applyNotificationOptions, mergeBackendNotifications, detectedRooms, applyRoomOptions, configuredFeatures } = await import("../custom_components/smartphone_dashboard/frontend/smartphone-dashboard-strategy.js");

const roomHass = {
  states: {
    "light.kitchen": { state: "off", attributes: { friendly_name: "Küche" } },
    "sensor.kitchen_temperature": { state: "21.5", attributes: { friendly_name: "Küchentemperatur", device_class: "temperature", unit_of_measurement: "°C" } },
    "sensor.kitchen_hidden": { state: "42", attributes: { friendly_name: "Versteckt", unit_of_measurement: "%" } },
    "sensor.hidden_room_only": { state: "1", attributes: { friendly_name: "Einzige versteckte Entität", unit_of_measurement: "%" } },
  },
  areas: {
    kitchen: { area_id: "kitchen", name: "Küche", icon: "mdi:silverware-fork-knife" },
    hidden_room: { area_id: "hidden_room", name: "Versteckter Raum", icon: "mdi:eye-off" },
  },
  devices: {},
  entities: {
    kitchen_light: { entity_id: "light.kitchen", area_id: "kitchen" },
    kitchen_temperature: { entity_id: "sensor.kitchen_temperature", area_id: "kitchen" },
    "sensor.kitchen_hidden": { entity_id: "sensor.kitchen_hidden", area_id: "kitchen", hidden: true },
    "sensor.hidden_room_only": { entity_id: "sensor.hidden_room_only", area_id: "hidden_room", hidden: true },
  },
};
const sanitizedRooms = detectedRooms(roomHass, [{
  area_id: "kitchen",
  main_light: "light.removed",
  hidden_entities: ["sensor.removed"],
}]);
assert.equal(sanitizedRooms[0].main_light, "light.kitchen");
assert.deepEqual(sanitizedRooms[0].hidden_entities, []);
const roomDashboard = { views: [{ sections: [{ cards: [
  { type: "custom:bubble-card", card_type: "separator", name: "Räume" },
  { type: "grid", columns: 2, cards: [] },
] }] }] };
applyRoomOptions(roomDashboard, { rooms: sanitizedRooms }, roomHass);
const roomCard = roomDashboard.views[0].sections[0].cards[1].cards[0];
assert.equal(roomCard.type, "custom:bubble-card");
assert.equal(roomCard.button_type, "slider");
assert.equal(roomCard.entity, "light.kitchen");
assert.equal("template" in roomCard, false);
assert.deepEqual(roomCard.tap_action, { action: "toggle" });
assert.deepEqual(roomCard.button_action.tap_action, { action: "navigate", navigation_path: "#raum-kitchen" });
assert.match(roomCard.styles, /primary-text-color/);
const roomPopup = roomDashboard.views[0].sections[0].cards.find((card) => card.hash === "#raum-kitchen");
const sensorGrid = roomPopup.cards.find((card) => card.type === "grid");
const sensorCard = sensorGrid.cards.find((card) => card.entity === "sensor.kitchen_temperature");
assert.equal(sensorCard.type, "custom:button-card");
assert.equal("template" in sensorCard, false);
assert.equal(sensorCard.custom_fields.title.card.entity, "sensor.kitchen_temperature");
assert.equal(sensorCard.custom_fields.graph.card.entities[0], "sensor.kitchen_temperature");
assert.equal(sensorCard.custom_fields.graph.card.line_color, "#A2AADB");
assert.equal(JSON.stringify(roomPopup).includes("sensor.kitchen_hidden"), false);
assert.equal(roomDashboard.views[0].sections[0].cards[1].cards.length, 1);
assert.equal(roomDashboard.views[0].sections[0].cards.some((card) => card.hash === "#raum-hidden_room"), false);

const visibilityHass = {
  states: {
    "person.visible": { state: "home", attributes: { friendly_name: "Sichtbar" } },
    "person.hidden": { state: "home", attributes: { friendly_name: "Versteckt" } },
    "script.visible": { state: "off", attributes: { friendly_name: "Sichtbares Script" } },
    "script.hidden": { state: "off", attributes: { friendly_name: "Verstecktes Script" } },
    "media_player.visible": { state: "idle", attributes: { friendly_name: "Sichtbare Medien" } },
    "media_player.hidden": { state: "idle", attributes: { friendly_name: "Versteckte Medien" } },
    "sensor.hidden_battery": { state: "3", attributes: { friendly_name: "Versteckte Batterie", device_class: "battery", unit_of_measurement: "%" } },
    "sensor.disabled_system_cpu": { state: "12", attributes: { friendly_name: "Deaktivierte CPU", unit_of_measurement: "%" } },
  },
  areas: {}, devices: {}, services: {},
  entities: {
    "person.visible": { entity_id: "person.visible" },
    "person.hidden": { entity_id: "person.hidden", hidden: true },
    "script.visible": { entity_id: "script.visible" },
    "script.hidden": { entity_id: "script.hidden", hidden: true },
    "media_player.visible": { entity_id: "media_player.visible" },
    "media_player.hidden": { entity_id: "media_player.hidden", hidden_by: "integration" },
    "sensor.hidden_battery": { hidden: true },
    "sensor.disabled_system_cpu": { entity_id: "sensor.disabled_system_cpu", disabled_by: "integration" },
  },
};
const visibilityDashboard = await SmartphoneDashboardStrategy.generate({
  persons: [{ entity: "person.visible" }, { entity: "person.hidden" }],
  quick_actions: ["script.visible", "script.hidden"],
  features: {
    media: { enabled: true, auto_discover: true, entities: ["media_player.hidden"] },
    system: { enabled: true, auto_discover: true, entities: ["sensor.disabled_system_cpu"] },
  },
}, visibilityHass);
const visibilityCards = visibilityDashboard.views[0].sections[0].cards;
assert.equal(visibilityCards.some((card) => card.heading === "Personen"), false);
const visibilityPersons = visibilityCards.find((card) =>
  card.type === "horizontal-stack" && card.cards?.some((item) => item.entity?.startsWith("person."))
);
assert.deepEqual(visibilityPersons.cards.map((card) => card.entity), ["person.visible"]);
assert.equal(visibilityCards.some((card) => card.entity === "script.visible"), true);
assert.equal(visibilityCards.some((card) => card.entity === "script.hidden"), false);
const mediaPopup = visibilityCards.find((card) => card.hash === "#medien");
assert.deepEqual(mediaPopup.cards.map((card) => card.entity), ["media_player.visible"]);
assert.equal(visibilityCards.some((card) => card.hash === "#system"), false);
const visibilityAuto = visibilityCards.find((card) => card.type === "custom:auto-entities");
assert.equal(visibilityAuto.filter.exclude.some((item) => item.entity_id === "sensor.hidden_battery"), true);
const batteryPopup = visibilityCards.find((card) => card.hash === "#meldung-batterien");
assert.equal(batteryPopup.cards[0].filter.exclude.some((item) => item.entity_id === "sensor.hidden_battery"), true);

const personDashboard = await SmartphoneDashboardStrategy.generate({}, {
  states: { "person.boris": { state: "home", attributes: { friendly_name: "Boris" } } },
  areas: {}, devices: {}, entities: {}, services: {},
});
const personCards = personDashboard.views[0].sections[0].cards;
assert.equal(personCards.some((card) => card.heading === "Personen"), false);
const personStack = personCards.find((card) =>
  card.type === "horizontal-stack" && card.cards?.some((item) => item.entity?.startsWith("person."))
);
assert.equal(personStack.cards[0].entity, "person.boris");

const hiddenPersonsDashboard = await SmartphoneDashboardStrategy.generate({ show_persons: false }, {
  states: { "person.boris": { state: "home", attributes: { friendly_name: "Boris" } } },
  areas: {}, devices: {}, entities: {}, services: {},
});
assert.equal(JSON.stringify(hiddenPersonsDashboard).includes("person.boris"), false);
assert.equal(JSON.stringify(hiddenPersonsDashboard).includes('"heading":"Personen"'), false);

const staleFeatures = configuredFeatures({ features: {
  media: { auto_discover: false, entities: ["media_player.removed"] },
  printer: { auto_discover: false, printer_ids: ["removed-printer"] },
} }, { states: {}, devices: {}, entities: {} });
assert.deepEqual(staleFeatures.find((item) => item.key === "media").entities, []);
assert.deepEqual(staleFeatures.find((item) => item.key === "printer").printer_ids, []);

const navigationDashboard = await SmartphoneDashboardStrategy.generate({}, {
  states: { "media_player.living_room": { state: "idle", attributes: { friendly_name: "Wohnzimmer" } } },
  areas: {}, devices: {}, entities: {}, services: {},
});
const navigationCards = navigationDashboard.views[0].sections[0].cards;
const navigationHeadingIndex = navigationCards.findIndex((card) => card.name === "Weitere Bereiche");
assert.notEqual(navigationHeadingIndex, -1);
assert.equal(navigationCards[navigationHeadingIndex + 1].type, "grid");
assert.equal(navigationCards[navigationHeadingIndex + 1].cards[0].name, "Medien");

const first = partitionConflictPatch({ A: "local", B: 2 }, { A: "remote", B: 1 }, { A: "base", B: 1 });
assert.deepEqual(first.overlap, ["A"]);
assert.deepEqual(first.retryable, { B: 2 });
const unrelated = partitionConflictPatch({ B: 3 }, { A: "remote", B: 2 }, { A: "remote", B: 2 });
assert.deepEqual(unrelated.overlap, []);
assert.deepEqual(unrelated.retryable, { B: 3 });
const explicitReedit = partitionConflictPatch({ A: "intentional" }, { A: "remote" }, { A: "remote" });
assert.deepEqual(explicitReedit.overlap, []);
assert.deepEqual(explicitReedit.retryable, { A: "intentional" });

const dashboard = { views: [{ sections: [{ cards: [
  { type: "heading", heading: "Meldungen" },
  { type: "custom:auto-entities", unique: true, filter: { include: [
    { entity_id: "sensor.*battery", options: {} },
    { domain: "sensor", attributes: { device_class: "battery" }, options: {} },
    { entity_id: "binary_sensor.*contact", options: {} },
    { entity_id: "sensor.*co2*", options: {} },
  ], exclude: [] } },
] }] }] };
applyNotificationOptions(dashboard, { notification_batteries: false, notification_contacts: true, notification_co2: true }, { states: {} });
const filters = dashboard.views[0].sections[0].cards[1].filter.include;
assert.equal(filters.some((item) => item.entity_id === "sensor.*battery" || item.attributes?.device_class === "battery"), false);
assert.equal(filters.find((item) => item.entity_id === "binary_sensor.*contact").last_changed, "> 15");
assert.equal(filters.find((item) => item.entity_id === "binary_sensor.*contact").state, "on");
assert.equal(filters.find((item) => item.entity_id === "binary_sensor.*contact").options.tap_action.navigation_path, "#meldung-kontakte");
assert.equal(filters.find((item) => item.entity_id === "sensor.*co2*").state, "> 1000");
const ninaDashboard = { views: [{ sections: [{ cards: [
  { type: "heading", heading: "Meldungen" },
  { type: "custom:auto-entities", filter: { include: [
    { entity_id: "binary_sensor.nina_warning_*", state: "on", options: { styles: "headline description" } },
  ], exclude: [] } },
] }] }] };
applyNotificationOptions(ninaDashboard, { notification_nina: true, nina_entities: "binary_sensor.nina_warning_*" }, { states: {} });
const ninaFilter = ninaDashboard.views[0].sections[0].cards[1].filter.include[0];
assert.equal(ninaFilter.state, "on");
assert.match(ninaFilter.options.styles, /headline/);
assert.match(ninaFilter.options.styles, /var\(--error-color\)/);
assert.equal(ninaFilter.options.tap_action.navigation_path, "#meldung-nina");
const ninaPopup = ninaDashboard.views[0].sections[0].cards.find((card) => card.hash === "#meldung-nina");
assert.equal(ninaPopup.cards[0].filter.include[0].options.type, "custom:button-card");
assert.match(ninaPopup.cards[0].filter.include[0].options.custom_fields.instruction, /instruction/);
assert.deepEqual(ninaPopup.cards[0].filter.include[0].options.styles.icon, [{ color: "var(--error-color)" }]);

assert.deepEqual(mergeBackendNotifications({ notification_batteries: true, title: "Explizit" }, { notification_batteries: false, notification_contacts: false, title: "Backend" }), { notification_batteries: true, notification_contacts: false, title: "Explizit" });
const generated = await SmartphoneDashboardStrategy.generate({ backend_key: "default" }, {
  states: {}, areas: {}, devices: {}, entities: {}, services: {},
  callWS: async (request) => {
    assert.equal(request.dashboard_key, "default");
    assert.equal(request.type, "smartphone_dashboard/config/display");
    return { config: { notification_batteries: false, notification_waste: true, notification_ups: true, notification_frost: true, notification_nina: true, battery_exclusions: "sensor.excluded_battery", waste_entities: "sensor.waste", waste_days: 3, ups_entities: "sensor.ups", frost_entity: "sensor.frost", nina_entities: "binary_sensor.nina_warning_*" } };
  },
});
const generatedFilters = generated.views[0].sections[0].cards.find((card) => card.type === "custom:auto-entities").filter.include;
assert.equal(generatedFilters.some((item) => item.entity_id === "sensor.*battery" || item.attributes?.device_class === "battery"), false);
assert.equal(generatedFilters.some((item) => item.entity_id === "sensor.waste"), true);
assert.equal(generatedFilters.some((item) => item.entity_id === "sensor.ups"), true);
assert.equal(generatedFilters.some((item) => item.entity_id === "sensor.frost"), true);
assert.equal(generatedFilters.find((item) => item.entity_id === "sensor.waste").or[0].attributes.daysTo, "<= 3");
assert.equal(generatedFilters.find((item) => item.entity_id === "sensor.waste").or[0].not.attributes.daysTo, "< 0");
assert.match(generatedFilters.find((item) => item.entity_id === "sensor.waste").or[2].state, /days/);
const upsNormalFilter = generatedFilters.find((item) => item.entity_id === "sensor.ups").not.or;
assert.equal(upsNormalFilter.some((item) => item.state === "online"), true);
assert.equal(upsNormalFilter.some((item) => item.state === "on"), true);
assert.equal(upsNormalFilter.some((item) => item.state === "unavailable"), true);
assert.equal(generatedFilters.find((item) => item.entity_id === "sensor.waste").options.tap_action.navigation_path, "#meldung-abfall");
assert.equal(generatedFilters.find((item) => item.entity_id === "sensor.waste").options.show_state, true);
assert.match(generatedFilters.find((item) => item.entity_id === "sensor.waste").options.styles, /Nächster Termin/);
assert.equal(generated.views[0].sections[0].cards.some((card) => card.hash === "#meldung-abfall"), true);
assert.equal(generated.views[0].sections[0].cards.some((card) => card.hash === "#meldung-usv"), true);
const generatedAuto = generated.views[0].sections[0].cards.find((card) => card.type === "custom:auto-entities");
assert.equal(generatedAuto.card.type, "vertical-stack");
assert.equal(generatedAuto.card_param, "cards");
assert.equal(generatedAuto.show_empty, false);
assert.equal(generatedAuto.else.name, "Keine Meldungen");
assert.equal(generatedAuto.filter.exclude.some((item) => item.entity_id === "sensor.excluded_battery"), true);

const binaryUpsDashboard = { views: [{ sections: [{ cards: [
  { type: "heading", heading: "Meldungen" },
  { type: "custom:auto-entities", filter: { include: [
    { entity_id: "sensor.*ups_status", options: { type: "custom:bubble-card", card_type: "button" } },
  ], exclude: [] } },
] }] }] };
applyNotificationOptions(binaryUpsDashboard, {
  notification_ups: true,
  ups_entities: "binary_sensor.ups_online,binary_sensor.ups_problem",
}, {
  states: {
    "binary_sensor.ups_online": { state: "on", attributes: { device_class: "connectivity" } },
    "binary_sensor.ups_problem": { state: "off", attributes: { device_class: "problem" } },
  },
});
const binaryUpsFilters = binaryUpsDashboard.views[0].sections[0].cards.find((card) => card.type === "custom:auto-entities").filter.include;
assert.equal(binaryUpsFilters.find((item) => item.entity_id === "binary_sensor.ups_online").state, "off");
assert.equal(binaryUpsFilters.find((item) => item.entity_id === "binary_sensor.ups_problem").state, "on");

const wasteDashboard = { views: [{ sections: [{ cards: [
  { type: "heading", heading: "Meldungen" },
  { type: "custom:auto-entities", filter: { include: [
    { entity_id: "sensor.*abfall", options: { type: "custom:bubble-card", card_type: "button" } },
  ], exclude: [] } },
] }] }] };
applyNotificationOptions(wasteDashboard, {
  notification_waste: true,
  waste_entities: "sensor.abfall",
  waste_days: 3,
}, {
  states: {
    "sensor.abfall": { state: "Biomüll in 1 days", attributes: { friendly_name: "Waste Collection Schedule Abfall", "2026-09-01": "Biomüll", daysTo: 1 } },
    "calendar.abfall": { state: "on", attributes: { friendly_name: "Abfallkalender" } },
  },
});
const wastePopup = wasteDashboard.views[0].sections[0].cards.find((card) => card.hash === "#meldung-abfall");
assert.equal(wastePopup.cards[0].type, "custom:auto-entities");
assert.equal(wastePopup.cards[0].filter.include[0].options.show_state, true);
assert.match(wastePopup.cards[0].filter.include[0].options.styles, /attributes\.upcoming/);
assert.match(wastePopup.cards[0].filter.include[0].options.styles, /#FFD700/);
assert.match(wastePopup.cards[0].filter.include[0].options.styles, /#4A4A4A/);
assert.match(wastePopup.cards[0].filter.include[0].options.styles, /#4169E1/);
assert.match(wastePopup.cards[0].filter.include[0].options.styles, /#8B4513/);
assert.equal(wastePopup.cards[1].type, "custom:bubble-card");
assert.equal(wastePopup.cards[1].card_type, "calendar");
assert.deepEqual(wastePopup.cards[1].entities, [{ entity: "calendar.abfall", color: "var(--success-color)" }]);
assert.equal(wastePopup.cards[1].limit, 6);
assert.equal(wastePopup.cards[1].days, 45);
assert.equal(wastePopup.cards[1].rows, 4);

const editor = new SmartphoneDashboardStrategyEditor();
let timerFired = false;
editor._inflightBackendPatch = { A: "ungespeichert" };
editor._pendingBackendPatch = { B: "wartend" };
editor._backendRetryTimer = setTimeout(() => { timerFired = true; }, 10);
editor._backendSaveTimer = setTimeout(() => { timerFired = true; }, 10);
editor.disconnectedCallback();
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(timerFired, false);
assert.equal(editor._disposed, true);
assert.deepEqual(editor._pendingBackendPatch, { A: "ungespeichert", B: "wartend" });

const deferred = [];
const lifecycleEditor = new SmartphoneDashboardStrategyEditor();
lifecycleEditor._render = () => {};
lifecycleEditor._config = { backend_key: "default" };
lifecycleEditor._sourceConfig = {};
lifecycleEditor._lifecycleGeneration = 1;
lifecycleEditor._hass = { callWS: () => new Promise((resolve) => deferred.push(resolve)) };
void lifecycleEditor._initializeBackend();
lifecycleEditor.connectedCallback();
assert.equal(deferred.length, 2);
deferred[0]({ revision: 1, config: { notification_batteries: true } });
await Promise.resolve();
deferred[1]({ revision: 2, config: { notification_batteries: false } });
await Promise.resolve(); await Promise.resolve();
assert.equal(lifecycleEditor._backendReady, true);
assert.equal(lifecycleEditor._backendRevision, 2);

const casEditor = new SmartphoneDashboardStrategyEditor();
casEditor._disposed = false; casEditor._lifecycleGeneration = 1; casEditor._backendReady = true;
casEditor._backendInitialized = true; casEditor._backendKeyLoaded = "default"; casEditor._backendRevision = 0;
casEditor._backendBase = { A: 0 }; casEditor._config = { backend_key: "default" };
let casCalls = 0;
casEditor._hass = { callWS: async () => ({ conflict: true, revision: ++casCalls, config: { A: 0, remote: casCalls } }) };
casEditor._scheduleBackendSave({ A: 1 });
await new Promise((resolve) => setTimeout(resolve, 350));
assert.equal(casCalls, 3);
assert.equal(casEditor._backendBase.A, 0);
assert.equal(casEditor._pendingBackendPatch.A, 1);

class OldStrategy extends HTMLElement {
  static async generate() { return { old: true }; }
}
class OldEditor extends HTMLElement {}
const oldGenerate = OldStrategy.generate;
customElements.registry.set("ll-strategy-dashboard-smartphone-dashboard", OldStrategy);
customElements.registry.set("ll-strategy-smartphone-dashboard", class extends OldStrategy {});
customElements.registry.set("smartphone-dashboard-strategy-editor", OldEditor);
globalThis.location = { pathname: "/handy", reload() {} };
globalThis.document = { textContent: "", querySelectorAll: () => [] };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const nativeSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = () => 0;
await import("../custom_components/smartphone_dashboard/frontend/smartphone-dashboard-loader.js");
const upgradedStrategy = customElements.get("ll-strategy-dashboard-smartphone-dashboard");
assert.equal(upgradedStrategy, OldStrategy);
assert.notEqual(upgradedStrategy.generate, oldGenerate);
const upgradedDashboard = await upgradedStrategy.generate({}, {
  states: {}, areas: {}, devices: {}, entities: {}, services: {},
});
assert.equal(upgradedDashboard.title, "Handy");
assert.equal(typeof OldEditor.prototype.setConfig, "function");
globalThis.setTimeout = nativeSetTimeout;
