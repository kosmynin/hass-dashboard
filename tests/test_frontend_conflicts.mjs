import assert from "node:assert/strict";
globalThis.HTMLElement = class { attachShadow() { this.shadowRoot = { activeElement: null, querySelector: () => null, querySelectorAll: () => [], replaceChildren() {}, append() {} }; return this.shadowRoot; } dispatchEvent() {} };
globalThis.customElements = { registry: new Map(), get(name) { return this.registry.get(name); }, define(name, value) { this.registry.set(name, value); }, whenDefined() { return Promise.resolve(); } };
globalThis.window = globalThis;
const { SmartphoneDashboardStrategy, SmartphoneDashboardStrategyEditor, partitionConflictPatch, applyNotificationOptions, mergeBackendNotifications, detectedRooms, applyRoomOptions, configuredFeatures, parcelSensorEntities, popupContentCards } = await import("../custom_components/smartphone_dashboard/frontend/smartphone-dashboard-strategy.js");
const { energyPopupCards, loadEnergyPopupCards } = await import("../custom_components/smartphone_dashboard/frontend/energy-popup.js");

const roomHass = {
  states: {
    "light.kitchen": { state: "off", attributes: { friendly_name: "Küche", supported_color_modes: ["brightness"] } },
    "light.kitchen_onoff": { state: "off", attributes: { friendly_name: "Arbeitslicht", supported_color_modes: ["onoff"] } },
    "switch.kitchen_socket": { state: "off", attributes: { friendly_name: "Steckdose" } },
    "sensor.air_pm25": { state: "8", attributes: { friendly_name: "Air Quality PM2.5", device_class: "pm25", unit_of_measurement: "µg/m³" } },
    "sensor.air_co2": { state: "620", attributes: { friendly_name: "Air Quality Kohlendioxid", device_class: "carbon_dioxide", unit_of_measurement: "ppm" } },
    "sensor.air_humidity": { state: "48", attributes: { friendly_name: "Air Quality Luftfeuchtigkeit", device_class: "humidity", unit_of_measurement: "%" } },
    "sensor.kitchen_temperature": { state: "21.5", attributes: { friendly_name: "Air Quality Temperatur", device_class: "temperature", unit_of_measurement: "°C" } },
    "sensor.kitchen_hidden": { state: "42", attributes: { friendly_name: "Versteckt", unit_of_measurement: "%" } },
    "sensor.hidden_room_only": { state: "1", attributes: { friendly_name: "Einzige versteckte Entität", unit_of_measurement: "%" } },
  },
  areas: {
    kitchen: { area_id: "kitchen", name: "Küche", icon: "mdi:silverware-fork-knife" },
    hidden_room: { area_id: "hidden_room", name: "Versteckter Raum", icon: "mdi:eye-off" },
  },
  devices: { air_quality: { id: "air_quality", area_id: "kitchen", name: "Air Quality" } },
  entities: {
    kitchen_light: { entity_id: "light.kitchen", area_id: "kitchen" },
    kitchen_onoff: { entity_id: "light.kitchen_onoff", area_id: "kitchen" },
    kitchen_socket: { entity_id: "switch.kitchen_socket", area_id: "kitchen" },
    kitchen_temperature: { entity_id: "sensor.kitchen_temperature", device_id: "air_quality", original_name: "Temperatur" },
    air_humidity: { entity_id: "sensor.air_humidity", device_id: "air_quality", original_name: "Luftfeuchtigkeit" },
    air_co2: { entity_id: "sensor.air_co2", device_id: "air_quality", original_name: "Kohlendioxid" },
    air_pm25: { entity_id: "sensor.air_pm25", device_id: "air_quality", original_name: "PM2.5" },
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
assert.doesNotMatch(roomCard.styles, /(?:border(?:-radius)?|min-height)\s*:/);
const roomPopup = roomDashboard.views[0].sections[0].cards.find((card) => card.hash === "#raum-kitchen");
assert.equal(roomPopup.styles, roomCard.styles);
assert.equal(roomPopup.performance_mode, "performance");
const roomPopupCards = popupContentCards(roomPopup);
assert.equal(roomPopupCards.find((card) => card.entity === "light.kitchen").button_type, "slider");
const onOffLightCard = roomPopupCards.find((card) => card.entity === "light.kitchen_onoff");
assert.equal(onOffLightCard.button_type, "switch");
assert.equal("attribute" in onOffLightCard, false);
assert.equal(roomPopupCards.find((card) => card.entity === "switch.kitchen_socket").button_type, "switch");
const sensorGrid = roomPopupCards.find((card) => card.type === "grid");
const sensorCard = sensorGrid.cards.find((card) => card.entity === "sensor.kitchen_temperature");
assert.deepEqual(sensorGrid.cards.map((card) => card.entity), [
  "sensor.kitchen_temperature",
  "sensor.air_humidity",
  "sensor.air_co2",
  "sensor.air_pm25",
]);
assert.deepEqual(sensorGrid.cards.map((card) => card.custom_fields.title.card.name), [
  "Temperatur",
  "Luftfeuchtigkeit",
  "Kohlendioxid",
  "PM2.5",
]);
assert.equal(sensorCard.type, "custom:button-card");
assert.equal("template" in sensorCard, false);
assert.equal(sensorCard.custom_fields.title.card.entity, "sensor.kitchen_temperature");
assert.equal(sensorCard.custom_fields.graph.card.entities[0], "sensor.kitchen_temperature");
assert.equal(sensorCard.custom_fields.graph.card.line_color, "#A2AADB");
assert.equal(JSON.stringify(roomPopup).includes("sensor.kitchen_hidden"), false);
assert.equal(roomDashboard.views[0].sections[0].cards[1].cards.length, 1);
assert.equal(roomDashboard.views[0].sections[0].cards.some((card) => card.hash === "#raum-hidden_room"), false);

const onOffRoomHass = {
  states: {
    "light.hallway": { state: "off", attributes: { friendly_name: "Flurlicht", supported_color_modes: ["onoff"] } },
  },
  areas: { hallway: { area_id: "hallway", name: "Flur", icon: "mdi:door" } },
  devices: {},
  entities: { hallway_light: { entity_id: "light.hallway", area_id: "hallway" } },
};
const onOffRoomDashboard = { views: [{ sections: [{ cards: [
  { type: "custom:bubble-card", card_type: "separator", name: "Räume" },
  { type: "grid", columns: 2, cards: [] },
] }] }] };
applyRoomOptions(onOffRoomDashboard, { rooms: detectedRooms(onOffRoomHass, []) }, onOffRoomHass);
const onOffRoomCard = onOffRoomDashboard.views[0].sections[0].cards[1].cards[0];
assert.equal(onOffRoomCard.button_type, "switch");
assert.equal("light_slider_type" in onOffRoomCard, false);

const visibilityHass = {
  states: {
    "person.visible": { state: "home", attributes: { friendly_name: "Sichtbar" } },
    "person.hidden": { state: "home", attributes: { friendly_name: "Versteckt" } },
    "script.visible": { state: "off", attributes: { friendly_name: "Sichtbares Script" } },
    "script.hidden": { state: "off", attributes: { friendly_name: "Verstecktes Script" } },
    "media_player.visible": { state: "idle", attributes: { friendly_name: "Sichtbare Medien" } },
    "media_player.hidden": { state: "idle", attributes: { friendly_name: "Versteckte Medien" } },
    "sensor.visible_battery": { state: "80", attributes: { friendly_name: "Sichtbare Batterie", device_class: "battery", unit_of_measurement: "%" } },
    "sensor.hidden_battery": { state: "3", attributes: { friendly_name: "Versteckte Batterie", device_class: "battery", unit_of_measurement: "%" } },
    "sensor.remote_battery_voltage": { state: "2.9", attributes: { friendly_name: "Remote Battery Voltage", device_class: "voltage", unit_of_measurement: "V" } },
    "sensor.batteriespannung": { state: "2900", attributes: { friendly_name: "Batteriespannung", device_class: "battery", unit_of_measurement: "mV" } },
    "sensor.hidden_co2": { state: "1500", attributes: { friendly_name: "Verstecktes CO₂", device_class: "carbon_dioxide", unit_of_measurement: "ppm" } },
    "binary_sensor.hidden_contact": { state: "on", attributes: { friendly_name: "Versteckter Kontakt", device_class: "door" } },
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
    "sensor.visible_battery": { entity_id: "sensor.visible_battery" },
    "sensor.hidden_battery": { hidden: true },
    "sensor.remote_battery_voltage": { entity_id: "sensor.remote_battery_voltage" },
    "sensor.batteriespannung": { entity_id: "sensor.batteriespannung" },
    "sensor.hidden_co2": { entity_id: "sensor.hidden_co2", hidden_by: "user" },
    "binary_sensor.hidden_contact": { entity_id: "binary_sensor.hidden_contact", hidden_by: "user" },
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
assert.equal(mediaPopup.cards.length, 1);
assert.equal(mediaPopup.cards[0].type, "custom:smartphone-dashboard-deferred-cards");
assert.equal(mediaPopup.cards[0].popup_hash, "#medien");
assert.deepEqual(popupContentCards(mediaPopup).map((card) => card.entity), ["media_player.visible"]);
assert.equal(visibilityCards.some((card) => card.hash === "#system"), false);
assert.equal(visibilityCards.some((card) => card.type === "custom:auto-entities"), false);
assert.equal(popupContentCards(visibilityCards.find((card) => card.hash === "#meldung-batterien"))[0].category, "battery");

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
assert.deepEqual(navigationCards[navigationHeadingIndex + 1].cards.find((card) => card.name === "Energie").button_action.tap_action,
  { action: "navigate", navigation_path: "#energie" });
const energyPopup = navigationCards.find((card) => card.hash === "#energie");
assert.deepEqual(energyPopup.cards, [{
  type: "custom:smartphone-dashboard-deferred-cards",
  popup_hash: "#energie",
  card_source: "energy",
  cards: [],
}]);
const disabledEnergyDashboard = await SmartphoneDashboardStrategy.generate(
  { features: { energy: { enabled: false } } },
  { states: {}, areas: {}, devices: {}, entities: {}, services: {} },
);
assert.equal(disabledEnergyDashboard.views[0].sections[0].cards.some((card) => card.hash === "#energie"), false);

const energyPrefs = {
  energy_sources: [
    { type: "battery", stat_soc: "sensor.storage_soc" },
    { type: "home", stat_rate: "sensor.house_power" },
    { type: "solar", stat_rate: "sensor.pv_power" },
    { type: "solar", stat_rate: "sensor.hidden_pv_power" },
    { type: "grid", stat_energy_from: "sensor.grid_energy" },
    { type: "water", stat_energy_from: "sensor.water_total", stat_rate: "sensor.water_flow" },
    { type: "gas", stat_energy_from: "sensor.gas_total", stat_rate: "sensor.gas_flow" },
  ],
};
let energyRequests = 0;
let currentEnergyPrefs = energyPrefs;
const energyHass = {
  config: { version: "2026.11.1" },
  states: {
    "sensor.house_power": { state: "480" },
    "sensor.pv_power": { state: "0" },
    "sensor.hidden_pv_power": { state: "230" },
    "sensor.storage_soc": { state: "72" },
    "sensor.water_flow": { state: "0" },
    "sensor.gas_flow": { state: "0.4" },
  },
  entities: {
    "sensor.hidden_pv_power": { entity_id: "sensor.hidden_pv_power", hidden: true },
  },
  async callWS(request) {
    assert.deepEqual(request, { type: "energy/get_prefs" });
    energyRequests += 1;
    return currentEnergyPrefs;
  },
};
const isEnergyVisible = (entity) => !energyHass.entities[entity]?.hidden;
const [energyDistribution, energyReadings, energyLink] = await loadEnergyPopupCards(energyHass, isEnergyVisible);
assert.deepEqual(energyDistribution, {
  type: "energy-distribution",
  title: "Energieverteilung",
  collection_key: "energy_smartphone_dashboard",
});
assert.equal(energyReadings.columns, 2);
assert.deepEqual(energyReadings.cards.map((card) => card.entity),
  ["sensor.house_power", "sensor.pv_power", "sensor.storage_soc", "sensor.water_flow", "sensor.gas_flow"]);
assert.equal(energyLink.button_action.tap_action.navigation_path, "/energy");
const waterMeter = { type: "water", stat_energy_from: "sensor.water_total" };
const gasMeter = { type: "gas", stat_energy_from: "sensor.gas_total" };
const olderEnergyHass = { config: { version: "2025.7.0" }, states: {} };
for (const sources of [[waterMeter], [gasMeter], [waterMeter, gasMeter]]) {
  assert.deepEqual(
    energyPopupCards({ energy_sources: sources }, olderEnergyHass, isEnergyVisible),
    [energyDistribution, energyLink],
  );
}
const fetchErrorCards = await loadEnergyPopupCards({
  async callWS() { throw new Error("offline"); },
}, isEnergyVisible);
assert.match(fetchErrorCards[0].content, /konnte nicht geladen werden/);
const missingConfigCards = await loadEnergyPopupCards({
  async callWS() { throw { code: "not_found" }; },
}, isEnergyVisible);
assert.match(missingConfigCards[0].content, /keine Quellen für Strom, Wasser oder Gas/);

globalThis.location = {
  pathname: "/handy/handy",
  search: "?sd_media=media_player.kueche",
  reload() {},
};
const mediaRemoteDashboard = await SmartphoneDashboardStrategy.generate({}, {
  states: {
    "media_player.wohnzimmer": { state: "playing", attributes: { friendly_name: "Wohnzimmer" } },
    "media_player.kueche": { state: "playing", attributes: { friendly_name: "Küche" } },
  },
  areas: {}, devices: {}, entities: {}, services: {},
});
const mediaRemotePopup = mediaRemoteDashboard.views[0].sections[0].cards
  .find((card) => card.hash === "#medien");
const mediaRemotePopupCards = popupContentCards(mediaRemotePopup);
assert.deepEqual(mediaRemotePopupCards.map((card) => card.entity), [
  "media_player.kueche",
  "media_player.wohnzimmer",
]);
assert.equal(mediaRemotePopupCards[0].type, "custom:bubble-card");
assert.equal(mediaRemotePopupCards[0].card_type, "media-player");
delete globalThis.location;

const securityHass = {
  states: {
    "camera.eingang": { state: "idle", attributes: { friendly_name: "Eingang" } },
    "camera.bambu": { state: "idle", attributes: { friendly_name: "Bambu Lab Kamera" } },
    "camera.ausgeblendet": { state: "idle", attributes: { friendly_name: "Ausgeblendete Kamera" } },
    "camera.versteckt": { state: "idle", attributes: { friendly_name: "Versteckte Kamera" } },
    "alarm_control_panel.garage": { state: "disarmed", attributes: { friendly_name: "Garage" } },
    "alarm_control_panel.master": { state: "armed_home", attributes: { friendly_name: "Master Alarmanlage" } },
    "lock.haustuer": { state: "locked", attributes: { friendly_name: "Haustür" } },
  },
  areas: {},
  devices: { bambu: { id: "bambu", manufacturer: "Bambu Lab", model: "X1 Carbon", name: "3D-Drucker" } },
  entities: {
    "camera.eingang": { entity_id: "camera.eingang" },
    "camera.bambu": { entity_id: "camera.bambu", device_id: "bambu", platform: "bambu_lab" },
    "camera.ausgeblendet": { entity_id: "camera.ausgeblendet" },
    "camera.versteckt": { entity_id: "camera.versteckt", hidden_by: "user" },
  },
  services: {},
};
const securityConfig = { features: { security: {
  auto_discover: true,
  entities: ["camera.ausgeblendet"],
  excluded_entities: ["camera.ausgeblendet"],
} } };
const securityFeature = configuredFeatures(securityConfig, securityHass)
  .find((item) => item.key === "security");
assert.equal(securityFeature.master_alarm, "alarm_control_panel.master");
assert.equal(securityFeature.entities.includes("camera.bambu"), false);
assert.equal(securityFeature.entities.includes("camera.ausgeblendet"), false);
assert.equal(securityFeature.entities.includes("camera.versteckt"), false);
const securityDashboard = await SmartphoneDashboardStrategy.generate(securityConfig, securityHass);
const securityPopup = securityDashboard.views[0].sections[0].cards.find((card) => card.hash === "#sicherheit");
assert.equal(securityPopup.entity, "alarm_control_panel.master");
assert.equal(securityPopup.button_type, "state");
assert.equal(securityPopup.show_state, true);
assert.deepEqual(securityPopup.tap_action, { action: "more-info" });
const securityPopupCards = popupContentCards(securityPopup);
assert.deepEqual(securityPopupCards.map((card) => card.type), [
  "alarm-panel", "alarm-panel", "picture-entity", "custom:bubble-card",
]);
assert.equal(securityPopupCards[0].entity, "alarm_control_panel.master");

const singleAlarmHass = {
  ...securityHass,
  states: Object.fromEntries(Object.entries(securityHass.states)
    .filter(([entityId]) => entityId !== "alarm_control_panel.garage")),
};
const singleAlarmDashboard = await SmartphoneDashboardStrategy.generate(securityConfig, singleAlarmHass);
const singleAlarmPopup = singleAlarmDashboard.views[0].sections[0].cards
  .find((card) => card.hash === "#sicherheit");
assert.equal(singleAlarmPopup.entity, "alarm_control_panel.master");
const singleAlarmPopupCards = popupContentCards(singleAlarmPopup);
assert.equal(singleAlarmPopupCards.some((card) => card.type === "alarm-panel"), false);
assert.deepEqual(singleAlarmPopupCards.map((card) => card.type), [
  "picture-entity", "custom:bubble-card",
]);

const notificationCards = (await SmartphoneDashboardStrategy.generate({}, { states: {} })).views[0].sections[0].cards;
assert.deepEqual(notificationCards.find((card) => card.type === "custom:smartphone-dashboard-alerts"), {
  type: "custom:smartphone-dashboard-alerts", summary: true,
});
const aggregateNotificationPopupCards = popupContentCards(notificationCards.find((card) => card.hash === "#meldungen"));
assert.equal(aggregateNotificationPopupCards[0].type, "custom:smartphone-dashboard-alerts");
assert.equal(aggregateNotificationPopupCards[1].type, "custom:smartphone-dashboard-notification-controls");

const first = partitionConflictPatch({ A: "local", B: 2 }, { A: "remote", B: 1 }, { A: "base", B: 1 });
assert.deepEqual(first.overlap, ["A"]);
assert.deepEqual(first.retryable, { B: 2 });
const unrelated = partitionConflictPatch({ B: 3 }, { A: "remote", B: 2 }, { A: "remote", B: 2 });
assert.deepEqual(unrelated.overlap, []);
assert.deepEqual(unrelated.retryable, { B: 3 });
const explicitReedit = partitionConflictPatch({ A: "intentional" }, { A: "remote" }, { A: "remote" });
assert.deepEqual(explicitReedit.overlap, []);
assert.deepEqual(explicitReedit.retryable, { A: "intentional" });

const wasteDashboard = await SmartphoneDashboardStrategy.generate({ waste_entities: "sensor.abfall" }, {
  states: {
    "sensor.abfall": { state: "Biomüll morgen", attributes: { daysTo: 1 } },
    "calendar.hausplan": { state: "off", attributes: { friendly_name: "Haushaltstermine" } },
  },
  entities: {
    "sensor.abfall": { entity_id: "sensor.abfall", platform: "waste_collection_schedule" },
    "calendar.hausplan": { entity_id: "calendar.hausplan", platform: "waste_collection_schedule" },
  },
});
const wasteCards = popupContentCards(wasteDashboard.views[0].sections[0].cards
  .find((card) => card.hash === "#meldung-abfall"));
assert.equal(wasteCards[0].category, "waste");
assert.equal(wasteCards[1].card_type, "calendar");
assert.deepEqual(wasteCards[1].entities, [{ entity: "calendar.hausplan", color: "var(--success-color)" }]);

const wasteCalendarWithoutSensorRegistry = { views: [{ sections: [{ cards: [] }] }] };
applyNotificationOptions(wasteCalendarWithoutSensorRegistry, {
  notification_waste: true,
  waste_entities: "sensor.abfall",
  waste_days: 3,
}, {
  states: {
    "sensor.abfall": { state: "Biomüll morgen", attributes: { daysTo: 1 } },
    "calendar.hausplan": { state: "off", attributes: { friendly_name: "Haushaltstermine" } },
  },
  entities: {
    "calendar.hausplan": { entity_id: "calendar.hausplan", platform: "waste_collection_schedule" },
  },
});
const wasteCalendarFallbackPopup = wasteCalendarWithoutSensorRegistry.views[0].sections[0].cards
  .find((card) => card.hash === "#meldung-abfall");
assert.deepEqual(popupContentCards(wasteCalendarFallbackPopup)[1].entities, [
  { entity: "calendar.hausplan", color: "var(--success-color)" },
]);

const parcelHass = {
  states: {
    "sensor.parcel_aggregator_incoming_parcels": {
      state: "2",
      attributes: { friendly_name: "Incoming parcels", parcels: [
        { carrier: "DHL", barcode: "abc", sender: "Shop", status: "in_transit", delivered: false },
        { carrier: "UPS", barcode: "def", sender: "Apple", status: "out_for_delivery", delivered: false, url: "https://example.org/track?name=a&code=b" },
      ] },
    },
    "sensor.dhl_incoming_parcels": {
      state: "1",
      attributes: { parcels: [{ carrier: "DHL", barcode: "abc", status: "in_transit", delivered: false }] },
    },
    "sensor.amazon_orders_incoming_parcels": {
      state: "1",
      attributes: { parcels: [{ carrier: "Amazon", barcode: "amz", sender: null, status: "at_pickup_point", delivered: false, raw: { items: [{ title: "USB-C Netzteil" }, "Ladekabel"] } }] },
    },
    "sensor.parcel_aggregator_delivered_parcels": {
      state: "1",
      attributes: { parcels: [{ carrier: "DHL", barcode: "old", status: "delivered", delivered: true }] },
    },
    "calendar.parcel_aggregator_deliveries": { state: "on", attributes: { friendly_name: "Parcel deliveries" } },
  },
  entities: {
    aggregator: { entity_id: "sensor.parcel_aggregator_incoming_parcels", platform: "parcel_aggregator" },
    dhl: { entity_id: "sensor.dhl_incoming_parcels", platform: "dhl" },
    amazon: { entity_id: "sensor.amazon_orders_incoming_parcels", platform: "amazon_orders" },
    delivered: { entity_id: "sensor.parcel_aggregator_delivered_parcels", platform: "parcel_aggregator" },
    calendar: { entity_id: "calendar.parcel_aggregator_deliveries", platform: "parcel_aggregator" },
  },
  areas: {}, devices: {}, services: {},
};
assert.deepEqual(parcelSensorEntities(parcelHass), [
  "sensor.amazon_orders_incoming_parcels", "sensor.dhl_incoming_parcels", "sensor.parcel_aggregator_incoming_parcels",
]);
const parcelFeature = configuredFeatures({}, parcelHass).find((feature) => feature.key === "parcels");
assert.equal(parcelFeature.hash, "#pakete");
const parcelDashboard = await SmartphoneDashboardStrategy.generate({}, parcelHass);
const parcelPopup = parcelDashboard.views[0].sections[0].cards.find((card) => card.hash === "#meldung-pakete");
const parcelPopupCards = popupContentCards(parcelPopup);
assert.equal(parcelPopupCards[0].type, "custom:button-card");
const parcelTemplate = parcelPopupCards[0].custom_fields.parcels.slice(3, -3);
const parcelHtml = Function("hass", parcelTemplate)(parcelHass);
assert.match(parcelHtml, /USB-C Netzteil \+ 1 weitere/);
assert.match(parcelHtml, /Apple/);
assert.match(parcelHtml, /Shop/);
assert.equal((parcelHtml.match(/class="parcel-row"/g) || []).length, 3);
assert.match(parcelHtml, /<progress[^>]*value="3" max="4"/);
assert.match(parcelHtml, /href="https:\/\/example\.org\/track\?name=a&amp;code=b"/);
assert.match(parcelHtml, /mdi:open-in-new/);
assert.ok(parcelHtml.indexOf("USB-C Netzteil") < parcelHtml.indexOf("Apple"));
assert.deepEqual(parcelPopupCards[1].entities, [
  { entity: "calendar.parcel_aggregator_deliveries", color: "#0A84FF" },
]);

const roomEditor = new SmartphoneDashboardStrategyEditor();
roomEditor._hass = roomHass;
roomEditor._config = { rooms: sanitizedRooms };
roomEditor._update = (key, value) => { roomEditor._config[key] = value; };
for (const entityId of ["sensor.air_humidity", "sensor.air_co2"]) {
  roomEditor._updateRoom("kitchen", (room) => ({ hidden_entities: [...room.hidden_entities, entityId] }));
}
assert.deepEqual(roomEditor._config.rooms[0].hidden_entities, ["sensor.air_humidity", "sensor.air_co2"]);
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

globalThis.location = { pathname: "/handy", reload() {} };
globalThis.document = { textContent: "", querySelectorAll: () => [] };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const nativeSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = () => 0;
const loaderModule = await import("../custom_components/smartphone_dashboard/frontend/smartphone-dashboard-loader.js");
const upgradedStrategy = customElements.get("ll-strategy-dashboard-smartphone-dashboard");
assert.equal(typeof upgradedStrategy.generate, "function");
const upgradedDashboard = await upgradedStrategy.generate({}, {
  states: {}, areas: {}, devices: {}, entities: {}, services: {},
});
assert.equal(upgradedDashboard.title, "Handy");
assert.equal(typeof customElements.get("smartphone-dashboard-strategy-editor").prototype.setConfig, "function");
globalThis.location.search = "?sd_popup=meldung-abfall";
globalThis.location.hash = "#veraltet";
globalThis.setTimeout = (callback) => { callback(); return 0; };
await upgradedStrategy.generate({}, {
  states: {}, areas: {}, devices: {}, entities: {}, services: {},
});
assert.equal(globalThis.location.hash, "#meldung-abfall");
const replacementRegistry = {
  registry: new Map(),
  get(name) { return this.registry.get(name); },
  define(name, value) { this.registry.set(name, value); },
};
globalThis.customElements = replacementRegistry;
loaderModule.ensureRegistrations();
const replacementStrategy = replacementRegistry.get("ll-strategy-dashboard-smartphone-dashboard");
assert.equal(typeof replacementStrategy.generate, "function");
const replacementDashboard = await replacementStrategy.generate({}, {
  states: {}, areas: {}, devices: {}, entities: {}, services: {},
});
assert.equal(replacementDashboard.title, "Handy");
assert.equal(
  typeof replacementRegistry.get("smartphone-dashboard-strategy-editor").prototype.setConfig,
  "function",
);
assert.equal(typeof replacementRegistry.get("smartphone-dashboard-deferred-cards").prototype.setConfig, "function");
assert.equal(typeof replacementRegistry.get("smartphone-dashboard-notification-controls").prototype.setConfig, "function");
globalThis.setTimeout = nativeSetTimeout;

const DeferredCards = replacementRegistry.get("smartphone-dashboard-deferred-cards");
const lazyPopup = new DeferredCards();
lazyPopup.isConnected = true;
lazyPopup._config = { popup_hash: "#raum-kitchen", cards: [] };
lazyPopup._mounted = true;
const child = { hass: null };
lazyPopup._cards = [child];
globalThis.location.search = "?sd_popup=raum-kitchen";
globalThis.location.hash = "";
const latestHass = { states: { "light.kitchen": { state: "on" } } };
lazyPopup.hass = latestHass;
assert.equal(child.hass, null);
globalThis.location.hash = "#raum-kitchen";
lazyPopup._onLocationChange();
assert.equal(child.hass, latestHass);

const originalDocument = globalThis.document;
const originalCardHelpers = window.loadCardHelpers;
try {
  globalThis.document = { createElement() { return { append() {} }; } };
  window.loadCardHelpers = async () => ({
    createCardElement(config) { return { config }; },
  });
  const lazyEnergy = new DeferredCards();
  lazyEnergy.isConnected = true;
  const requestsBeforeOpen = energyRequests;
  lazyEnergy.setConfig(energyPopup.cards[0]);
  lazyEnergy.hass = energyHass;
  assert.equal(energyRequests, requestsBeforeOpen);
  globalThis.location.hash = "#energie";
  lazyEnergy._onLocationChange();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(lazyEnergy._cards.map((card) => card.config), [energyDistribution, energyReadings, energyLink]);
  assert.equal(energyRequests, requestsBeforeOpen + 1);
  globalThis.location.hash = "";
  lazyEnergy._onLocationChange();
  assert.equal(lazyEnergy._cards.length, 0);
  currentEnergyPrefs = { energy_sources: [waterMeter, gasMeter] };
  globalThis.location.hash = "#energie";
  lazyEnergy._onLocationChange();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(lazyEnergy._cards.map((card) => card.config), [energyDistribution, energyLink]);
  assert.equal(energyRequests, requestsBeforeOpen + 2);
} finally {
  globalThis.location.hash = "";
  globalThis.document = originalDocument;
  window.loadCardHelpers = originalCardHelpers;
}

const { subscribeAlertStream, SmartphoneDashboardAlerts } = await import("../custom_components/smartphone_dashboard/frontend/notification-cards.js");
let notify;
let subscribeCount = 0;
let unsubscribeCount = 0;
const connection = {
  async subscribeMessage(listener, options) {
    assert.equal(options.type, "smartphone_dashboard/notifications/subscribe");
    notify = listener;
    subscribeCount += 1;
    return () => { unsubscribeCount += 1; };
  },
};
const summaryUpdates = [], detailUpdates = [];
const releaseSummary = subscribeAlertStream(connection, (value) => summaryUpdates.push(value));
const releaseDetail = subscribeAlertStream(connection, (value) => detailUpdates.push(value));
await Promise.resolve();
assert.equal(subscribeCount, 1);
const alerts = [
  { category: "ups", title: "Server · Status", detail: "Batterie ersetzen" },
  { category: "ups", title: "Server · Status", detail: "Keine Batterie erkannt" },
  { category: "waste", title: "Restmüll und Biomüll", detail: "Nächster Termin: morgen" },
  { category: "parcel", title: "Nächstes Paket", detail: "Abholbereit" },
];
notify({ alerts });
assert.deepEqual(summaryUpdates, [undefined, alerts]);
assert.deepEqual(detailUpdates, [undefined, alerts]);
releaseDetail();
notify({ alerts: [] });
assert.deepEqual(summaryUpdates.at(-1), []);
assert.equal(detailUpdates.at(-1), alerts);
releaseSummary();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(unsubscribeCount, 1);

const rendered = [];
const alertView = Object.create(SmartphoneDashboardAlerts.prototype);
alertView._list = { replaceChildren: (...rows) => rendered.push(rows) };
alertView._row = (row) => row;
alertView.setConfig({ category: "ups" });
alertView._render(alerts);
assert.deepEqual(rendered.at(-1).map((entry) => entry.detail), ["Batterie ersetzen", "Keine Batterie erkannt"]);
alertView._render(null);
assert.match(rendered.at(-1)[0].title, /nicht verfügbar/);
alertView._render([]);
assert.equal(rendered.at(-1)[0].title, "Keine aktive Meldung in diesem Bereich");
