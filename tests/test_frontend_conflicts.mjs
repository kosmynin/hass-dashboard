import assert from "node:assert/strict";
globalThis.HTMLElement = class { attachShadow() { this.shadowRoot = { activeElement: null, querySelector: () => null, querySelectorAll: () => [], replaceChildren() {}, append() {} }; return this.shadowRoot; } dispatchEvent() {} };
globalThis.customElements = { registry: new Map(), get(name) { return this.registry.get(name); }, define(name, value) { this.registry.set(name, value); }, whenDefined() { return Promise.resolve(); } };
globalThis.window = globalThis;
const { SmartphoneDashboardStrategy, SmartphoneDashboardStrategyEditor, partitionConflictPatch, applyNotificationOptions, mergeBackendNotifications, detectedRooms, applyRoomOptions, configuredFeatures, parcelSensorEntities, popupContentCards } = await import("../custom_components/smartphone_dashboard/frontend/smartphone-dashboard-strategy.js");
const { energyPopupCards, energyRows, loadDailyEnergy, loadEnergyPopupCards } = await import("../custom_components/smartphone_dashboard/frontend/energy-popup.js");
const { agendaRows, loadCalendarEvents } = await import("../custom_components/smartphone_dashboard/frontend/agenda-cards.js");

const roomHass = {
  states: {
    "light.kitchen": { state: "off", attributes: { friendly_name: "Küche", supported_color_modes: ["brightness"] } },
    "light.kitchen_onoff": { entity_id: "light.kitchen_onoff", state: "off", attributes: { friendly_name: "Küche Arbeitslicht", supported_color_modes: ["onoff"] } },
    "switch.kitchen_socket": { entity_id: "switch.kitchen_socket", state: "off", attributes: { friendly_name: "Zwischenstecker Steckdose" } },
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
  devices: {
    air_quality: { id: "air_quality", area_id: "kitchen", name: "Air Quality" },
    socket: { id: "socket", area_id: "kitchen", name: "Zwischenstecker" },
  },
  entities: {
    kitchen_light: { entity_id: "light.kitchen", area_id: "kitchen" },
    kitchen_onoff: { entity_id: "light.kitchen_onoff", area_id: "kitchen" },
    kitchen_socket: { entity_id: "switch.kitchen_socket", area_id: "kitchen", device_id: "socket" },
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
const retainedRoom = { area_id: "kitchen", icon: "mdi:chef-hat", enabled: false, hidden_entities: ["sensor.kitchen_temperature"] };
const restoredRoom = { area_id: "restored_area", main_light: "light.living_room" };
const removedRoom = { area_id: "obsolete_area" };
const roomRepairEditor = new SmartphoneDashboardStrategyEditor();
const roomRepairChanges = [];
roomRepairEditor._config = { rooms: [restoredRoom, removedRoom, retainedRoom], title: "Handy" };
roomRepairEditor._hass = { async callWS(message) {
  assert.deepEqual(message, { type: "config/area_registry/list" });
  return [{ area_id: "kitchen" }, { area_id: "restored_area" }];
} };
roomRepairEditor._update = (key, value) => { roomRepairChanges.push([key, value]); };
assert.equal(await roomRepairEditor._removeMissingRooms(["obsolete_area", "restored_area"]), true);
assert.deepEqual(roomRepairChanges, [["rooms", [restoredRoom, retainedRoom]]]);
assert.equal(await roomRepairEditor._removeMissingRooms(["restored_area"]), false);
roomRepairEditor._hass = { async callWS() { return null; } };
await assert.rejects(roomRepairEditor._removeMissingRooms(["obsolete_area"]), /Bereichsliste ist ungültig/);
assert.equal(roomRepairChanges.length, 1);
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
assert.equal(onOffLightCard.name, "Arbeitslicht");
assert.equal("attribute" in onOffLightCard, false);
const roomSwitchCard = roomPopupCards.find((card) => card.entity === "switch.kitchen_socket");
assert.equal(roomSwitchCard.button_type, "switch");
assert.equal(roomSwitchCard.name, "Steckdose");

const roomNamingHass = {
  ...roomHass,
  formatEntityName(state, name) {
    assert.deepEqual(name, { type: "entity" });
    return state.entity_id === "switch.kitchen_socket" ? "Kaffeemaschine" : state.attributes.friendly_name;
  },
};
for (const shortSwitchNames of [true, false]) {
  const generated = await SmartphoneDashboardStrategy.generate({ short_switch_names: shortSwitchNames }, roomNamingHass);
  const popup = generated.views[0].sections[0].cards.find((card) => card.hash === "#raum-kitchen");
  const items = popupContentCards(popup);
  const card = items.find((item) => item.entity === "switch.kitchen_socket");
  assert.equal(card.name, shortSwitchNames ? "Kaffeemaschine" : undefined);
  assert.equal(card.button_type, "switch");
  assert.equal(items.find((item) => item.entity === "light.kitchen_onoff").name, shortSwitchNames ? "Arbeitslicht" : undefined);
}

const individualRoomNames = await SmartphoneDashboardStrategy.generate({
  short_switch_names: false,
  rooms: [{ area_id: "kitchen", entity_name_modes: {
    "light.kitchen_onoff": "entity",
    "switch.kitchen_socket": "device",
    "sensor.kitchen_temperature": "device",
  } }],
}, roomNamingHass);
const individualRoomPopup = individualRoomNames.views[0].sections[0].cards.find((card) => card.hash === "#raum-kitchen");
const individualRoomCards = popupContentCards(individualRoomPopup);
assert.equal(individualRoomPopup.name, "Küche");
assert.equal(individualRoomCards.find((card) => card.entity === "light.kitchen_onoff").name, "Arbeitslicht");
assert.equal(individualRoomCards.find((card) => card.entity === "light.kitchen").name, undefined);
assert.equal(individualRoomCards.find((card) => card.entity === "switch.kitchen_socket").name, "Zwischenstecker Kaffeemaschine");
assert.equal(individualRoomCards.find((card) => card.type === "grid").cards[0].custom_fields.title.card.name, "Air Quality Temperatur");

const includeDeviceWithShortDefault = await SmartphoneDashboardStrategy.generate({
  rooms: [{ area_id: "kitchen", entity_name_modes: { "switch.kitchen_socket": "device" } }],
}, roomNamingHass);
const shortNamesPopup = includeDeviceWithShortDefault.views[0].sections[0].cards.find((card) => card.hash === "#raum-kitchen");
assert.equal(popupContentCards(shortNamesPopup).find((card) => card.entity === "switch.kitchen_socket").name,
  "Zwischenstecker Kaffeemaschine");
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
const [energyOverview, energyLink] = await loadEnergyPopupCards(energyHass, isEnergyVisible);
assert.equal(energyOverview.type, "custom:smartphone-dashboard-energy");
const { live, today } = energyOverview.views;
const energyDistribution = today.flow;
assert.deepEqual(energyDistribution, {
  type: "energy-distribution",
  title: "Energieverteilung",
  collection_key: "energy_smartphone_dashboard",
});
assert.deepEqual(live.extra.map((card) => card.entity), ["sensor.water_flow", "sensor.gas_flow"]);
assert.deepEqual(today.extra.map((card) => card.type), ["energy-water-graph", "energy-gas-graph"]);
assert.equal(energyOverview.battery.entity, "sensor.storage_soc");
assert.deepEqual(live.flow, {
  type: "power-sankey",
  title: "Aktueller Leistungsfluss",
  collection_key: "energy_dashboard_now",
  layout: "vertical",
  show_values: true,
  max_devices: 3,
});
assert.equal(live.homeFlow, null);
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
const gridMeter = { type: "grid", stat_energy_from: "sensor.grid_energy" };
const gridPower = { ...gridMeter, power_config: {
  stat_rate_from: "sensor.grid_import", stat_rate_to: "sensor.grid_export",
} };
const batteryPower = { type: "battery", power_config: {
  stat_rate_from_solar: "sensor.charge_from_pv", stat_rate_to_home: "sensor.discharge_to_house",
} };
const firstLiveVersion = { config: { version: "2025.12.0" }, states: {} };
for (const source of [gridPower, batteryPower]) {
  const [overview] = energyPopupCards({ energy_sources: [source] }, firstLiveVersion, isEnergyVisible);
  assert.deepEqual(overview.views.live.flow, live.flow);
  assert.equal(overview.views.live.homeFlow, null);
}
const onlyEnergyTotals = energyPopupCards({
  energy_sources: [gridMeter, { ...gasMeter, stat_rate: "sensor.gas_flow" }],
}, firstLiveVersion, isEnergyVisible);
assert.deepEqual(onlyEnergyTotals[0].views.today.flow, energyDistribution);
assert.match(onlyEnergyTotals[0].views.live.flow.content, /Leistungssensoren/);
assert.match(energyPopupCards({ energy_sources: [gridPower] }, olderEnergyHass)[0].views.live.flow.content, /2025\.12/);

const reading = (state, unit) => ({ state: String(state), attributes: { unit_of_measurement: unit } });
const measuredHass = {
  config: { version: "2026.11.1", time_zone: "Europe/Berlin" },
  devices: { stream: { manufacturer: "EcoFlow", model: "STREAM Ultra" } },
  entities: {
    "sensor.battery_power": { device_id: "stream", translation_key: "battery_power" },
    "sensor.battery_soc": { device_id: "stream", original_name: "Battery SOC" },
    "sensor.solar_total": { device_id: "stream" },
    "sensor.stream_pv1_power": { device_id: "stream" },
    "sensor.stream_pv1_energy": { device_id: "stream" },
    "sensor.stream_pv2_power": { device_id: "stream" },
    "sensor.battery_charge": { device_id: "stream" },
    "sensor.hidden_power": { hidden_by: "user" },
    "sensor.stream_pv3_power": { device_id: "stream", hidden_by: "user" },
  },
  states: {
    "sensor.grid_power": reading(1.16, "kW"),
    "sensor.battery_power": reading(-240, "W"),
    "sensor.battery_soc": reading(67, "%"),
    "sensor.solar_total": reading(560, "W"),
    "sensor.stream_pv1_power": reading(200, "W"),
    "sensor.stream_pv1_energy": reading(20.3, "kWh"),
    "sensor.stream_pv2_power": reading(160, "W"),
    "sensor.stream_pv3_power": reading(120, "W"),
    "sensor.dishwasher_power": reading(0.96, "kW"),
    "sensor.dryer_power": reading(620, "W"),
    "sensor.office_power": reading(250000, "mW"),
    "sensor.fridge_power": reading(130, "W"),
    "sensor.disabled_power": reading("unavailable", "W"),
    "sensor.hidden_power": reading(1800, "W"),
  },
};
const measuredPrefs = {
  energy_sources: [
    { type: "grid", stat_energy_from: "sensor.grid_import", stat_energy_to: "sensor.grid_export", stat_rate: "sensor.grid_power" },
    { type: "solar", stat_rate: "sensor.solar_total", stat_energy_from: "sensor.solar_energy" },
    { type: "battery", stat_energy_from: "sensor.battery_discharge", stat_energy_to: "sensor.battery_charge",
      power_config: { stat_rate_inverted: "sensor.battery_power" } },
    { type: "home", stat_energy_to: "sensor.home_energy" },
  ],
  device_consumption: [
    { name: "Kühlschrank", stat_rate: "sensor.fridge_power" },
    { name: "Trockner", stat_rate: "sensor.dryer_power", stat_consumption: "external:dryer_energy" },
    { name: "Büro-PC", stat_rate: "sensor.office_power" },
    { name: "Geschirrspüler", stat_rate: "sensor.dishwasher_power", stat_consumption: "external:dishwasher_energy" },
    { name: "Ausgefallen", stat_rate: "sensor.disabled_power" },
    { name: "Ausgeblendet", stat_rate: "sensor.hidden_power" },
    { name: "Kühlschrank (doppelt)", stat_rate: "sensor.fridge_power" },
  ],
};
const [measuredOverview] = energyPopupCards(measuredPrefs, measuredHass, (id) =>
  id in measuredHass.states && !measuredHass.entities[id]?.hidden_by,
);
assert.equal(measuredOverview.views.live.homeFlow.type, "custom:home-flow-card");
assert.equal(measuredOverview.views.live.homeFlow.home, undefined);
assert.equal(measuredOverview.views.live.loadSensorsConfigured, true);
assert.deepEqual(measuredOverview.views.live.homeFlow.battery, {
  entity: "sensor.battery_power", invert_state: true, name: "STREAM Ultra", state_of_charge: "sensor.battery_soc",
});
assert.deepEqual(measuredOverview.views.today.homeFlow.battery.entity, {
  consumption: "sensor.battery_discharge", production: "sensor.battery_charge",
});
assert.equal(measuredOverview.views.today.homeFlow.mode, "energy");
assert.equal(measuredOverview.views.today.homeFlow.home.entity, "sensor.home_energy");
assert.equal(measuredOverview.views.today.homeFlow.energy_entities, undefined);
const [energyOnlySolar] = energyPopupCards({ energy_sources: measuredPrefs.energy_sources.map((source) =>
  source.type === "solar" ? { type: "solar", stat_energy_from: "sensor.solar_energy" } : source,
) }, measuredHass);
assert.equal(energyOnlySolar.views.live.homeFlow.type, "custom:home-flow-card");
assert.equal(energyOnlySolar.views.live.homeFlow.grid.entity, "sensor.grid_power");
assert.equal(energyOnlySolar.views.live.homeFlow.solar, undefined);
assert.match(energyOnlySolar.views.live.homeFlowNotice, /Solarquellen ohne Leistungssensor/);
assert.equal(energyOnlySolar.views.today.homeFlow.solar.entity, "sensor.solar_energy");
const [detectedBattery] = energyPopupCards({ energy_sources: [
  { type: "battery", stat_energy_to: "sensor.battery_charge" },
] }, measuredHass);
assert.deepEqual(detectedBattery.views.live.homeFlow.battery, measuredOverview.views.live.homeFlow.battery);
assert.deepEqual(measuredOverview.solar, [
  { name: "PV 1", power: "sensor.stream_pv1_power", energy: "sensor.stream_pv1_energy" },
  { name: "PV 2", power: "sensor.stream_pv2_power" },
]);
const translatedPv = {
  ...measuredHass,
  devices: { stream: { name: "Umbenannter Speicher", model: "Inverter" } },
  entities: {
    "sensor.battery_charge": { device_id: "stream" },
    "sensor.panel_watts": { device_id: "stream", translation_key: "solar_input_1_power" },
    "sensor.panel_kwh": { device_id: "stream", original_name: "PV Eingang 1 Ertrag" },
    "sensor.solar_meter_power": { device_id: "stream" },
  },
  states: {
    "sensor.panel_watts": reading(0, "W"),
    "sensor.panel_kwh": reading(3, "kWh"),
    "sensor.solar_meter_power": reading(450, "W"),
  },
};
const [translatedOverview] = energyPopupCards({ energy_sources: [
  { type: "solar", stat_energy_from: "sensor.panel_kwh" },
] }, translatedPv);
assert.deepEqual(translatedOverview.solar, [
  { name: "PV 1", power: "sensor.panel_watts", energy: "sensor.panel_kwh" },
]);
assert.deepEqual(translatedOverview.views.live.homeFlow.solar, { entity: "sensor.panel_watts", name: "PV" });
assert.equal(energyRows(translatedOverview.solar, translatedPv, "live", {})[0].value, 0);
const [splitBattery] = energyPopupCards({ energy_sources: [
  { type: "battery", stat_energy_from_solar: "sensor.solar_charge", stat_energy_to_home: "sensor.battery_to_home" },
] }, measuredHass);
assert.deepEqual(splitBattery.views.today.homeFlow.battery.entity, {
  consumption: "sensor.battery_to_home", production: "sensor.solar_charge",
});
assert.match(splitBattery.views.live.homeFlowReason, /Leistungsmessung/);
const [solarWithoutPortPower] = energyPopupCards({ energy_sources: [
  { type: "solar", stat_rate: "sensor.solar_meter_power" },
] }, { ...translatedPv, states: { ...translatedPv.states, "sensor.panel_watts": undefined } });
assert.deepEqual(solarWithoutPortPower.solar.map(({ power, energy }) => [power, energy]), [
  [undefined, "sensor.panel_kwh"], ["sensor.solar_meter_power", undefined],
]);
assert.deepEqual(energyRows(measuredOverview.loads, measuredHass, "live", {}, 3).map(({ name, value }) => [name, value]), [
  ["Geschirrspüler", 960], ["Trockner", 620], ["Büro-PC", 250],
]);
const requestStats = [];
const dailyRows = [...measuredOverview.loads, ...measuredOverview.solar];
const statsHass = { ...measuredHass, async callWS(request) {
  requestStats.push(request);
  return {
    "sensor.stream_pv1_energy": [{ change: 0.5 }, { change: null }, { change: 0.75 }],
    "external:dryer_energy": [{ change: 1 }, { change: 1.5 }],
    "external:dishwasher_energy": [{ change: 0 }],
  };
} };
// The UTC offset at midnight differs from that in the afternoon on this date.
const dailyStats = await loadDailyEnergy(statsHass, dailyRows, new Date("2026-03-29T12:00:00Z"));
assert.deepEqual(requestStats[0], {
  type: "recorder/statistics_during_period", start_time: "2026-03-28T23:00:00.000Z",
  end_time: "2026-03-29T12:00:00.000Z", statistic_ids: ["external:dryer_energy", "external:dishwasher_energy", "sensor.stream_pv1_energy"],
  period: "5minute", types: ["change"], units: { energy: "kWh" },
});
assert.deepEqual(energyRows(measuredOverview.loads, measuredHass, "today", dailyStats, 3).map(({ value }) => value), [2.5]);
assert.deepEqual(energyRows(measuredOverview.solar, measuredHass, "today", dailyStats).map(({ value }) => value), [1.25]);
assert.equal(dailyStats["external:dishwasher_energy"], 0);

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
assert.equal(wasteCards[1].type, "custom:smartphone-dashboard-agenda");
assert.deepEqual(wasteCards[1].calendars, ["calendar.hausplan"]);
assert.deepEqual(wasteCards[1].entities, ["sensor.abfall"]);

const wasteCalendarWithoutSensorRegistry = { views: [{ sections: [{ cards: [] }] }] };
applyNotificationOptions(wasteCalendarWithoutSensorRegistry, {
  notification_waste: true,
  waste_entities: "sensor.abfall",
  waste_days: 3,
}, {
  states: {
    "sensor.abfall": { state: "Biomüll morgen", attributes: { daysTo: 1 } },
    "calendar.hausplan": { state: "off", attributes: { friendly_name: "Haushaltstermine" } },
    "calendar.privat": { state: "off", attributes: { friendly_name: "Privat" } },
    "calendar.ausgeblendet": { state: "off", attributes: { friendly_name: "Müllabfuhr intern" } },
  },
  entities: {
    "calendar.ausgeblendet": { hidden: true },
  },
});
const wasteCalendarFallbackPopup = wasteCalendarWithoutSensorRegistry.views[0].sections[0].cards
  .find((card) => card.hash === "#meldung-abfall");
const wasteAgenda = popupContentCards(wasteCalendarFallbackPopup)[1];
assert.deepEqual(wasteAgenda.calendars, []);
assert.deepEqual(wasteAgenda.calendar_candidates, ["calendar.hausplan", "calendar.privat"]);

const agendaStart = new Date(2026, 10, 22);
const agendaEnd = new Date(2026, 11, 20);
const collection = { summary: "Braune Biotonne", start: { date: "2026-11-24" }, end: { date: "2026-11-25" } };
const calendarEvents = await loadCalendarEvents({
  async callWS(request) {
    assert.deepEqual(request, {
      type: "config/entity_registry/get_entries",
      entity_ids: ["calendar.hausplan", "calendar.privat"],
    });
    return { "calendar.hausplan": { platform: "waste_collection_schedule" }, "calendar.privat": { platform: "caldav" } };
  },
  async callApi(method, path) {
    assert.equal(method, "GET");
    assert.match(path, /^calendars\/calendar\.hausplan\?start=/);
    return [collection];
  },
}, wasteAgenda, agendaStart, agendaEnd);
assert.deepEqual(calendarEvents, [collection]);
const wasteStates = {
  "sensor.abfall": { state: "unknown", attributes: {
    "2026-11-21": "Alter Termin",
    "2026-11-23": "Gelbe Tonne",
    "Restmüll": "26.11.2026",
    upcoming: [{ date: "2026-12-05", type: "Papier" }],
    last_update: "2026-11-22",
  } },
};
assert.deepEqual(agendaRows(wasteAgenda, wasteStates, calendarEvents, agendaStart, agendaEnd).map((row) => row.title),
  ["Braune Biotonne"]);
assert.deepEqual(agendaRows(wasteAgenda, wasteStates, [], agendaStart, agendaEnd).map((row) => row.title),
  ["Gelbe Tonne", "Restmüll", "Papier"]);

const parcelHass = {
  states: {
    "sensor.parcel_aggregator_incoming_parcels": {
      state: "2",
      attributes: { friendly_name: "Incoming parcels", parcels: [
        { carrier: "DHL", barcode: "abc", sender: "Shop", status: "in_transit", delivered: false, planned_from: "2026-11-27" },
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
const parcelAgenda = parcelPopupCards[1];
assert.deepEqual(parcelAgenda.calendars, ["calendar.parcel_aggregator_deliveries"]);
const parcelEvent = { summary: "Amazon: Parcel amz", description: "Carrier: Amazon\nBarcode: amz",
  start: { dateTime: "2026-11-24T10:00:00+01:00" }, end: { dateTime: "2026-11-24T14:00:00+01:00" } };
const unidentifiedParcel = { summary: "UPS: Parcel 123456", start: "2026-11-25" };
const deliveryRows = agendaRows(parcelAgenda, parcelHass.states,
  [parcelEvent, parcelEvent, unidentifiedParcel], agendaStart, agendaEnd);
assert.deepEqual(deliveryRows.map((row) => row.title), ["USB-C Netzteil + 1 weitere", "UPS", "Shop"]);
assert.equal(deliveryRows[0].end.toISOString(), "2026-11-24T13:00:00.000Z");
assert.equal(deliveryRows[2].allDay, true);
const parcelFeaturePopup = parcelDashboard.views[0].sections[0].cards.find((card) => card.hash === "#pakete");
assert.deepEqual(popupContentCards(parcelFeaturePopup)[1], parcelAgenda);

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
assert.equal(typeof replacementRegistry.get("smartphone-dashboard-energy").prototype.setConfig, "function");
assert.equal(typeof replacementRegistry.get("smartphone-dashboard-notification-controls").prototype.setConfig, "function");
assert.equal(typeof replacementRegistry.get("smartphone-dashboard-agenda").prototype.setConfig, "function");
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
  assert.deepEqual(lazyEnergy._cards.map((card) => card.config), [energyOverview, energyLink]);
  const updatedEnergyHass = {
    ...energyHass,
    states: { ...energyHass.states, "sensor.house_power": { state: "615" } },
  };
  lazyEnergy.hass = updatedEnergyHass;
  assert.equal(lazyEnergy._cards[0].hass, updatedEnergyHass);
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

  const EnergyCard = replacementRegistry.get("smartphone-dashboard-energy");
  const overview = new EnergyCard();
  const hostEvents = new EventTarget();
  const originalHostEvents = {
    addEventListener: window.addEventListener,
    removeEventListener: window.removeEventListener,
    dispatchEvent: window.dispatchEvent,
  };
  for (const method of Object.keys(originalHostEvents)) window[method] = hostEvents[method].bind(hostEvents);
  const originalWhenDefined = globalThis.customElements.whenDefined;
  let resolveHomeFlow;
  const homeFlowDefinition = new Promise((resolve) => { resolveHomeFlow = resolve; });
  globalThis.customElements.whenDefined = (tag) =>
    tag === "home-flow-card" ? homeFlowDefinition : originalWhenDefined.call(globalThis.customElements, tag);
  function testNode() {
    return {
      children: [],
      events: {},
      dataset: {},
      style: {},
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      querySelector(selector) { return (this.nodes ??= {})[selector] ??= testNode(); },
      setAttribute(key, value) { this[key] = value; },
      addEventListener(event, listener) { this.events[event] = listener; },
    };
  }
  globalThis.document.createElement = testNode;
  const buttons = [testNode(), testNode()];
  overview.shadowRoot = { ...testNode(), querySelectorAll() { return buttons; } };
  overview.hass = statsHass;
  overview.setConfig(measuredOverview);
  overview.isConnected = true;
  overview.connectedCallback();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(buttons[0]["aria-pressed"], "true");
  assert.match(overview._flow.children[0].innerHTML, /Lovelace-Ressource prüfen/);
  assert.equal(overview._cards[0].config.type, "power-sankey");
  assert.equal(overview._details.children[0].dataset.kind, "loads");
  assert.equal(requestStats.length, 1);

  const firstFlowCard = globalThis.customElements.get("home-flow-card");
  if (!firstFlowCard) globalThis.customElements.define("home-flow-card", class {});
  try {
    resolveHomeFlow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(overview._cards[0].config.mode, "power");
    assert.equal(requestStats.length, 1);
    buttons[1].events.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(buttons[1]["aria-pressed"], "true");
    assert.equal(overview._flow.children[0].config.mode, "energy");
    assert.equal(overview._details.children[0].dataset.kind, "solar");
    assert.equal(requestStats.length, 2);
    buttons[0].events.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(overview._flow.children[0].config.mode, "power");
    assert.equal(requestStats.length, 2);
  } finally {
    overview.isConnected = false;
    overview.disconnectedCallback();
    if (!firstFlowCard) globalThis.customElements.registry.delete("home-flow-card");
    globalThis.customElements.whenDefined = originalWhenDefined;
    Object.assign(window, originalHostEvents);
  }
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
