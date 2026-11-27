const ELECTRICITY_TYPES = new Set(["grid", "solar", "battery", "home"]);
const ENERGY_SOURCE_TYPES = new Set([...ELECTRICITY_TYPES, "water", "gas"]);
const POWER_FACTORS = { W: 1, kW: 1000, MW: 1000000 };
const COLLECTION_KEY = "energy_smartphone_dashboard";
const HOME_FLOW_TYPE = "home-flow-card";

function openEnergyDashboard() {
  const tapAction = { action: "navigate", navigation_path: "/energy" };
  return {
    type: "custom:bubble-card",
    card_type: "button",
    button_type: "name",
    name: "Energie-Dashboard öffnen",
    icon: "mdi:lightning-bolt",
    tap_action: tapAction,
    button_action: { tap_action: tapAction },
  };
}

const hint = (content) => ({ type: "markdown", content });

async function requestEnergy(hass, request) {
  let timeout;
  try {
    return await Promise.race([
      hass.callWS(request),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Zeitlimit")), 3500); }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function nativeLiveFlow(sources, version) {
  const [year, month] = String(version ?? "").split(".").map(Number);
  if (!(year > 2025 || (year === 2025 && month >= 12))) {
    return hint("Das native Live-Diagramm ist ab Home Assistant 2025.12 verfügbar.");
  }
  const hasPower = sources.some((source) =>
    [source, source.power_config].some((settings) =>
      Object.entries(settings ?? {}).some(([key, entity]) =>
        /^stat_rate(?:_|$)/.test(key) && typeof entity === "string" && entity.trim(),
      ),
    ),
  );
  return hasPower ? {
    type: "power-sankey",
    title: "Aktueller Leistungsfluss",
    collection_key: "energy_dashboard_now",
    layout: "vertical",
    show_values: true,
    max_devices: 3,
  } : hint("Hinterlege Leistungssensoren (W oder kW) in den Energie-Einstellungen, um den aktuellen Stromfluss zu sehen.");
}

function powerEntity(hass, entity) {
  const unit = hass.states?.[entity]?.attributes?.unit_of_measurement;
  return Object.hasOwn(POWER_FACTORS, unit) ? entity : undefined;
}

function directions(from, to) {
  if (!from && !to) return undefined;
  // Keep one-way meters directional. A scalar is interpreted as a signed meter.
  return { ...(from && { consumption: from }), ...(to && { production: to }) };
}

function homeFlowNode(source, hass, period) {
  const { type } = source;
  if (period === "today") {
    if (type === "solar") return { entity: source.stat_energy_from };
    if (type === "home") return { entity: source.stat_energy_to, override_state: true };
    if (type === "battery" && ["from_grid", "from_solar", "to_home", "to_grid"]
      .some((direction) => source["stat_energy_" + direction])) return {};
    return { entity: directions(source.stat_energy_from, source.stat_energy_to) };
  }
  const power = (id) => powerEntity(hass, id);
  if (type === "solar" || type === "home") {
    return { entity: power(source.stat_rate), ...(type === "home" && { override_state: true }) };
  }
  const config = source.power_config ?? {};
  if (config.stat_rate_inverted) {
    return { entity: power(config.stat_rate_inverted), invert_state: true };
  }
  if (config.stat_rate_from || config.stat_rate_to) {
    const from = power(config.stat_rate_from);
    const to = power(config.stat_rate_to);
    if ((config.stat_rate_from && !from) || (config.stat_rate_to && !to)) return {};
    return { entity: directions(from, to) };
  }
  return { entity: power(config.stat_rate || source.stat_rate) };
}

function homeFlowConfig(sources, hass, period, batteryLabel, batterySoc) {
  const nodes = {};
  for (const source of sources) {
    const { type } = source;
    // The external card has one node per source type. Use the native flow
    // whenever individual sources cannot be represented without dropping data.
    if (nodes[type]) return null;
    const node = homeFlowNode(source, hass, period);
    if (!node.entity) return null;
    nodes[type] = {
      ...node,
      name: source.name || { grid: "Netz", solar: "PV", home: "Hausverbrauch", battery: batteryLabel }[type],
      ...(type === "battery" && batterySoc && { state_of_charge: batterySoc }),
    };
  }
  if (!nodes.grid && !nodes.solar && !nodes.battery) return null;
  return { type: "custom:" + HOME_FLOW_TYPE, mode: period === "live" ? "power" : "energy",
    kilo_decimals: 2, animate_numbers: false, disable_dots: true, collection_key: COLLECTION_KEY, ...nodes };
}

function entityName(hass, entity) {
  return hass.states?.[entity]?.attributes?.friendly_name || entity;
}

function isStreamUltra(device) {
  return /ecoflow/i.test(device?.manufacturer ?? "") &&
    /stream\s+ultra|^bk(?:11|61)$/i.test(device?.model ?? "");
}

function solarDetails(sources, hass, isVisible, visibleStatistic, entries, devices) {
  const result = [];
  const ports = new Map();
  for (const [entity, entry] of entries) {
    if (!isVisible(entity)) continue;
    const device = devices[entry.device_id];
    if (!isStreamUltra(device)) continue;
    const match = [entry.original_name, entityName(hass, entity), entity]
      .map((name) => name?.replaceAll("_", " ").match(/\bpv[\s-]*([1-4])[\s-]+(?:power|energy|leistung|energie)\b/i))
      .find(Boolean);
    if (!match) continue;
    const input = match[1];
    const key = entry.device_id + ":" + input;
    const attributes = hass.states?.[entity]?.attributes;
    const metric = powerEntity(hass, entity) ? "power" :
      ["Wh", "kWh", "MWh"].includes(attributes?.unit_of_measurement) ? "energy" : null;
    if (!metric) continue;
    if (!ports.has(key)) ports.set(key, { name: "PV " + input, device: entry.device_id });
    ports.get(key)[metric] ??= entity;
  }
  const portRows = [...ports.values()].sort((a, b) => a.name.localeCompare(b.name));
  const multipleDevices = new Set(portRows.map((row) => row.device)).size > 1;
  for (const { device, ...row } of portRows) {
    const label = devices[device].name_by_user || devices[device].name || devices[device].model;
    result.push(multipleDevices ? { ...row, name: label + " · " + row.name } : row);
  }
  for (const source of sources) {
    const { stat_rate: power, stat_energy_from: energy } = source;
    const device = entries.get(power)?.device_id || entries.get(energy)?.device_id;
    // Prefer the individual inputs over a total on the same inverter.
    if (portRows.some((row) => row.device === device || (power && row.power === power) || (energy && row.energy === energy))) continue;
    result.push({
      name: source.name || entityName(hass, energy || power),
      power: power && isVisible(power) ? powerEntity(hass, power) : undefined,
      energy: visibleStatistic(energy) ? energy : undefined,
    });
  }
  return result.filter((row) => row.power || row.energy);
}

function energyPopupCards(prefs, hass, isVisible = (entity) => Boolean(hass.states?.[entity])) {
  const sources = (Array.isArray(prefs?.energy_sources) ? prefs.energy_sources : [])
    .filter((source) => ENERGY_SOURCE_TYPES.has(source?.type));
  const dashboardLink = openEnergyDashboard();
  if (!sources.length) {
    return [
      hint("Im Energie-Dashboard sind noch keine Quellen für Strom, Wasser oder Gas eingerichtet."),
      dashboardLink,
    ];
  }

  const electricity = sources.filter((source) => ELECTRICITY_TYPES.has(source.type));
  const nativeToday = { type: "energy-distribution", title: "Energieverteilung", collection_key: COLLECTION_KEY };
  const utilities = sources.filter((source) => source.type === "water" || source.type === "gas");
  const visible = (entity) => Boolean(entity && isVisible(entity));
  const visibleStatistic = (id) => Boolean(id && (id.includes(":") || visible(id)));
  if (!electricity.length && !utilities.some((source) => visible(source.stat_rate))) {
    return [nativeToday, dashboardLink];
  }

  const entries = new Map(Object.entries(hass.entities ?? {}).map(([key, entry]) => [entry.entity_id || key, entry]));
  const devices = hass.devices ?? {};
  const battery = electricity.find((source) => source.type === "battery");
  const batteryDeviceId = [battery?.stat_soc, battery?.stat_rate, battery?.stat_energy_from, battery?.stat_energy_to,
    battery?.stat_energy_from_grid, battery?.stat_energy_from_solar, battery?.stat_energy_to_home, battery?.stat_energy_to_grid,
    ...Object.values(battery?.power_config ?? {})]
    .map((entity) => entries.get(entity)?.device_id).find(Boolean);
  const batteryDevice = devices[batteryDeviceId];
  const batteryLabel = battery?.name || batteryDevice?.name_by_user || batteryDevice?.name || batteryDevice?.model || "Speicher";
  let batterySoc = visible(battery?.stat_soc) ? battery.stat_soc : undefined;
  if (!battery?.stat_soc && batteryDeviceId) {
    batterySoc = [...entries].find(([entity, entry]) => entry.device_id === batteryDeviceId && visible(entity) &&
      hass.states?.[entity]?.attributes?.unit_of_measurement === "%" &&
      [entry.translation_key, entry.original_name, entityName(hass, entity)]
        .some((name) => /(?:^|\s)(?:battery[ _]soc|batterie[- ]?ladestand)$/i.test(name || "")))?.[0];
  }
  const liveSources = electricity.map((source) => {
    if (source !== battery || source.stat_rate || source.power_config || !isStreamUltra(batteryDevice)) return source;
    // EcoFlow reports signed battery power as positive while charging.
    const power = [...entries].find(([entity, entry]) => entry.device_id === batteryDeviceId && visible(entity) &&
      powerEntity(hass, entity) && [entry.translation_key, entry.original_name]
        .some((name) => /^battery[ _]power$/i.test(name || "")))?.[0];
    return power ? { ...source, power_config: { stat_rate_inverted: power } } : source;
  });
  const utilityReadings = [...new Map(utilities.filter((source) => visible(source.stat_rate)).map((source) => [
    source.stat_rate, { type: "tile", entity: source.stat_rate, name: source.type === "water" ? "Wasser" : "Gas" },
  ])).values()];
  const utilityGraphs = [...new Set(utilities.map((source) => source.type))].map((type) => ({
    type: "energy-" + type + "-graph",
    title: type === "water" ? "Wasser heute" : "Gas heute",
    collection_key: COLLECTION_KEY,
  }));
  const loads = (Array.isArray(prefs.device_consumption) ? prefs.device_consumption : [])
    .filter((device) => device)
    .map(({ stat_rate, stat_consumption, name }) => ({
      name: name || entityName(hass, stat_consumption || stat_rate),
      power: visible(stat_rate) ? powerEntity(hass, stat_rate) : undefined,
      energy: visibleStatistic(stat_consumption) ? stat_consumption : undefined,
    }))
    .filter((row) => row.power || row.energy);
  return [{
    type: "custom:smartphone-dashboard-energy",
    views: {
      live: {
        flow: electricity.length ? nativeLiveFlow(electricity, hass.config?.version) : null,
        homeFlow: homeFlowConfig(liveSources, hass, "live", batteryLabel, batterySoc),
        extra: utilityReadings,
      },
      today: {
        flow: nativeToday,
        homeFlow: homeFlowConfig(electricity, hass, "today", batteryLabel, batterySoc),
        extra: utilityGraphs,
      },
    },
    battery: batterySoc ? { type: "tile", entity: batterySoc, name: batteryLabel + " · Ladestand", color: "green" } : null,
    loads,
    solar: solarDetails(electricity.filter(({ type }) => type === "solar"), hass, visible, visibleStatistic, entries, devices),
  }, dashboardLink];
}

async function loadEnergyPopupCards(hass, isVisible) {
  try {
    return energyPopupCards(await requestEnergy(hass, { type: "energy/get_prefs" }), hass, isVisible);
  } catch (error) {
    if (error?.code === "not_found") return energyPopupCards(null, hass, isVisible);
    return [
      hint("Die Energiekonfiguration konnte nicht geladen werden. Öffne das Pop-up erneut oder prüfe das Energie-Dashboard."),
      openEnergyDashboard(),
    ];
  }
}

function todayStart(now, timeZone) {
  if (!timeZone) return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23",
  });
  const wallTime = (date) => {
    const { year, month, day, hour, minute, second } = Object.fromEntries(
      formatter.formatToParts(date).map(({ type, value }) => [type, Number(value)]),
    );
    return Date.UTC(year, month - 1, day, hour, minute, second);
  };
  // Resolve the timezone offset at midnight, which can differ from its offset now.
  const date = new Date(wallTime(now));
  const midnight = date.setUTCHours(0, 0, 0, 0);
  const estimate = midnight - (wallTime(midnight) - midnight);
  return new Date(midnight - (wallTime(estimate) - estimate));
}

async function loadDailyEnergy(hass, rows, now = new Date()) {
  const statisticIds = [...new Set(rows.map((row) => row.energy).filter(Boolean))];
  if (!statisticIds.length) return {};
  const stats = await requestEnergy(hass, {
    type: "recorder/statistics_during_period",
    start_time: todayStart(now, hass.config?.time_zone).toISOString(),
    end_time: now.toISOString(),
    statistic_ids: statisticIds,
    period: "5minute",
    types: ["change"],
    units: { energy: "kWh" },
  });
  return Object.fromEntries(statisticIds.flatMap((id) => {
    const changes = (stats?.[id] ?? []).map(({ change }) => change).filter(Number.isFinite);
    return changes.length ? [[id, changes.reduce((sum, change) => sum + change, 0)]] : [];
  }));
}

function energyRows(rows, hass, period, daily, limit) {
  const current = period === "live";
  const values = rows.flatMap((row) => {
    if (!current) return Number.isFinite(daily[row.energy]) ? [{ ...row, value: daily[row.energy] }] : [];
    const state = hass.states?.[row.power];
    if (!state?.state?.trim()) return [];
    const value = Number(state.state) * POWER_FACTORS[state.attributes?.unit_of_measurement];
    return Number.isFinite(value) ? [{ ...row, value }] : [];
  });
  if (!limit) return values;
  const ranked = new Map();
  for (const row of values) {
    if (row.value > 0) ranked.set(current ? row.power : row.energy, row);
  }
  return [...ranked.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)).slice(0, limit);
}

export { energyPopupCards, energyRows, loadDailyEnergy, loadEnergyPopupCards };
