import assert from "node:assert/strict";
globalThis.HTMLElement = class { attachShadow() { this.shadowRoot = { activeElement: null, querySelector: () => null, querySelectorAll: () => [] }; return this.shadowRoot; } dispatchEvent() {} };
globalThis.customElements = { registry: new Map(), get(name) { return this.registry.get(name); }, define(name, value) { this.registry.set(name, value); }, whenDefined() { return Promise.resolve(); } };
globalThis.window = globalThis;
const { SmartphoneDashboardStrategy, SmartphoneDashboardStrategyEditor, partitionConflictPatch, applyNotificationOptions, mergeBackendNotifications } = await import("../custom_components/smartphone_dashboard/frontend/smartphone-dashboard-strategy.js");

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
assert.equal(filters.find((item) => item.entity_id === "binary_sensor.*contact").last_changed, ">15");
assert.equal(filters.find((item) => item.entity_id === "sensor.*co2*").state, "> 1000");

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
const generatedAuto = generated.views[0].sections[0].cards.find((card) => card.type === "custom:auto-entities");
assert.equal(generatedAuto.filter.exclude.some((item) => item.entity_id === "sensor.excluded_battery"), true);

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
