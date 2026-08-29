import assert from "node:assert/strict";
globalThis.HTMLElement = class { attachShadow() { this.shadowRoot = { activeElement: null, querySelector: () => null, querySelectorAll: () => [] }; return this.shadowRoot; } dispatchEvent() {} };
globalThis.customElements = { registry: new Map(), get(name) { return this.registry.get(name); }, define(name, value) { this.registry.set(name, value); }, whenDefined() { return Promise.resolve(); } };
globalThis.window = globalThis;
const { SmartphoneDashboardStrategy, SmartphoneDashboardStrategyEditor, partitionConflictPatch, applyNotificationOptions, mergeBackendNotifications, detectedRooms, applyRoomOptions, configuredFeatures } = await import("../custom_components/smartphone_dashboard/frontend/smartphone-dashboard-strategy.js");

const roomHass = {
  states: { "light.kitchen": { state: "off", attributes: { friendly_name: "Küche" } } },
  areas: { kitchen: { area_id: "kitchen", name: "Küche", icon: "mdi:silverware-fork-knife" } },
  devices: {},
  entities: { kitchen_light: { entity_id: "light.kitchen", area_id: "kitchen" } },
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

const personDashboard = await SmartphoneDashboardStrategy.generate({}, {
  states: { "person.boris": { state: "home", attributes: { friendly_name: "Boris" } } },
  areas: {}, devices: {}, entities: {}, services: {},
});
const personCards = personDashboard.views[0].sections[0].cards;
const personHeadingIndex = personCards.findIndex((card) => card.heading === "Personen");
assert.notEqual(personHeadingIndex, -1);
assert.equal(personCards[personHeadingIndex + 1].cards[0].entity, "person.boris");

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
assert.equal(ninaFilter.options.tap_action.navigation_path, "#meldung-nina");
const ninaPopup = ninaDashboard.views[0].sections[0].cards.find((card) => card.hash === "#meldung-nina");
assert.equal(ninaPopup.cards[0].filter.include[0].options.type, "custom:button-card");
assert.match(ninaPopup.cards[0].filter.include[0].options.custom_fields.instruction, /instruction/);

assert.deepEqual(mergeBackendNotifications({ notification_batteries: true, title: "Explizit" }, { notification_batteries: false, notification_contacts: false, title: "Backend" }), { notification_batteries: true, notification_contacts: false, title: "Explizit" });
const generated = await SmartphoneDashboardStrategy.generate({ backend_key: "default" }, {
  states: {}, areas: {}, devices: {}, entities: {}, services: {},
  callWS: async (request) => {
    assert.equal(request.dashboard_key, "default");
    assert.equal(request.type, "smartphone_dashboard/config/display");
    return { config: { notification_batteries: false, notification_waste: true, notification_ups: true, notification_frost: true, notification_nina: true, battery_exclusions: "sensor.excluded_battery", waste_entities: "sensor.waste", ups_entities: "sensor.ups", frost_entity: "sensor.frost", nina_entities: "binary_sensor.nina_warning_*" } };
  },
});
const generatedFilters = generated.views[0].sections[0].cards.find((card) => card.type === "custom:auto-entities").filter.include;
assert.equal(generatedFilters.some((item) => item.entity_id === "sensor.*battery" || item.attributes?.device_class === "battery"), false);
assert.equal(generatedFilters.some((item) => item.entity_id === "sensor.waste"), true);
assert.equal(generatedFilters.some((item) => item.entity_id === "sensor.ups"), true);
assert.equal(generatedFilters.some((item) => item.entity_id === "sensor.frost"), true);
assert.equal(generatedFilters.find((item) => item.entity_id === "sensor.waste").state, "/.*([Hh]eute|[Mm]orgen).*/");
assert.deepEqual(generatedFilters.find((item) => item.entity_id === "sensor.ups").not, { state: "/^(ONLINE|Online|online)$/" });
assert.equal(generatedFilters.find((item) => item.entity_id === "sensor.waste").options.tap_action.navigation_path, "#meldung-abfall");
assert.equal(generated.views[0].sections[0].cards.some((card) => card.hash === "#meldung-abfall"), true);
assert.equal(generated.views[0].sections[0].cards.some((card) => card.hash === "#meldung-usv"), true);
const generatedAuto = generated.views[0].sections[0].cards.find((card) => card.type === "custom:auto-entities");
assert.equal(generatedAuto.card.type, "vertical-stack");
assert.equal(generatedAuto.card_param, "cards");
assert.equal(generatedAuto.show_empty, false);
assert.equal(generatedAuto.else.name, "Keine Meldungen");
assert.equal(generatedAuto.filter.exclude.some((item) => item.entity_id === "sensor.excluded_battery"), true);

const wasteDashboard = { views: [{ sections: [{ cards: [
  { type: "heading", heading: "Meldungen" },
  { type: "custom:auto-entities", filter: { include: [
    { entity_id: "sensor.*abfall", options: { type: "custom:bubble-card", card_type: "button" } },
  ], exclude: [] } },
] }] }] };
applyNotificationOptions(wasteDashboard, {
  notification_waste: true,
  waste_entities: "sensor.abfall",
}, {
  states: {
    "sensor.abfall": { state: "Biomüll morgen", attributes: { friendly_name: "Abfall" } },
    "calendar.abfall": { state: "on", attributes: { friendly_name: "Abfallkalender" } },
  },
});
const wastePopup = wasteDashboard.views[0].sections[0].cards.find((card) => card.hash === "#meldung-abfall");
assert.equal(wastePopup.cards[0].type, "calendar");
assert.deepEqual(wastePopup.cards[0].entities, ["calendar.abfall"]);

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
