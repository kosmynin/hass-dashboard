const ELECTRICITY_TYPES = new Set(["grid", "solar", "battery", "home"]);
const ENERGY_SOURCE_TYPES = new Set([...ELECTRICITY_TYPES, "water", "gas"]);
const POWER_FACTORS = { µW: 1e-6, mW: 1e-3, W: 1, kW: 1e3, MW: 1e6, GW: 1e9, TW: 1e12 };
const COLLECTION_KEY = "energy_smartphone_dashboard";
const HOME_FLOW_TYPE = "home-flow-card";
const SOURCE_LABELS = { grid: "Netz", solar: "PV", home: "Hausverbrauch", battery: "Speicher" };
const SOLAR_TOTAL_SUFFIX = /_(?:power_pv_sum|pv_power_sum|pv_total_power|solar_power_total)$/i;

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

function livePowerSources(source) {
  return source.type === "grid" && Array.isArray(source.power)
    ? source.power.map((meter) => ({ type: "grid", name: source.name, ...meter }))
    : [source];
}

function hasLivePower(source) {
  return [source, source.power_config].some((settings) =>
    Object.entries(settings ?? {}).some(([key, entity]) =>
      /^stat_rate(?:_|$)/.test(key) && typeof entity === "string" && entity.trim(),
    ),
  );
}

function nativeLiveFlow(sources, version) {
  const [year, month] = String(version ?? "").split(".").map(Number);
  if (!(year > 2025 || (year === 2025 && month >= 12))) {
    return hint("Das native Live-Diagramm ist ab Home Assistant 2025.12 verfügbar.");
  }
  return sources.flatMap(livePowerSources).some(hasLivePower) ? {
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

function powerWatts(state) {
  if (!state?.state?.trim()) return undefined;
  const value = Number(state.state) * POWER_FACTORS[state.attributes?.unit_of_measurement];
  return Number.isFinite(value) ? value : undefined;
}

function detectedSolarTotal(sources, hass, entries, isVisible) {
  const inputs = [...new Set(sources.map((source) => source.stat_rate || source.stat_energy_from).filter(Boolean))];
  if (inputs.length < 2) return undefined;
  return Object.keys(hass.states ?? {}).find((entity) => {
    const prefix = SOLAR_TOTAL_SUFFIX.test(entity) && entity.replace(SOLAR_TOTAL_SUFFIX, "");
    if (!prefix || !isVisible(entity) || !powerEntity(hass, entity)) return false;
    const device = entries.get(entity)?.device_id;
    // The total must belong to every configured PV input, never just one inverter of several.
    return inputs.every((input) => {
      const inputDevice = entries.get(input)?.device_id;
      return inputDevice && device ? inputDevice === device : input === entity || input.startsWith(prefix + "_");
    });
  });
}

function powerDirections(fromId, toId, power) {
  const from = power(fromId);
  const to = power(toId);
  if ((fromId && !from) || (toId && !to) || (!from && !to)) return undefined;
  // Keep one-way meters directional. A scalar is interpreted as a signed meter.
  return { ...(from && { consumption: from }), ...(to && { production: to }) };
}

function homeFlowNode(source, hass) {
  const { type } = source;
  const power = (id) => powerEntity(hass, id);
  if (type === "solar" || type === "home") {
    return { entity: power(source.stat_rate), ...(type === "home" && { override_state: true }) };
  }
  const config = source.power_config ?? {};
  const netPower = power(source.stat_rate);
  const inverted = power(config.stat_rate_inverted);
  if (inverted) return { entity: inverted, invert_state: true };
  if (config.stat_rate_inverted) return { entity: netPower };
  if (type === "battery") {
    const out = [config.stat_rate_to_home, config.stat_rate_to_grid].filter(Boolean);
    const into = [config.stat_rate_from_grid, config.stat_rate_from_solar].filter(Boolean);
    if (out.length || into.length) {
      if (netPower) return { entity: netPower };
      if (out.length > 1 || into.length > 1) return {};
      return { entity: powerDirections(out[0], into[0], power) };
    }
  }
  if (config.stat_rate_from || config.stat_rate_to) {
    return { entity: powerDirections(config.stat_rate_from, config.stat_rate_to, power) || netPower };
  }
  return { entity: power(config.stat_rate) || netPower };
}

function homeFlowConfig(sources, hass, batteryLabel, batterySoc, solarTotal) {
  const nodes = {};
  const missingLiveSources = new Set();
  const ambiguous = new Set();
  const candidates = new Map();
  if (solarTotal) nodes.solar = { entity: solarTotal, name: "PV gesamt" };
  for (const source of sources) {
    const { type } = source;
    if (type === "solar" && solarTotal) continue;
    const node = homeFlowNode(source, hass);
    if (!node.entity) {
      if (type !== "home") missingLiveSources.add(SOURCE_LABELS[type]);
      continue;
    }
    const meters = candidates.get(type) ?? new Map();
    const meterKey = JSON.stringify(node);
    if (!meters.has(meterKey)) meters.set(meterKey, {
      ...node,
      name: source.name || (type === "battery" ? batteryLabel : SOURCE_LABELS[type]),
      ...(type === "battery" && (source.stat_soc || batterySoc) && { state_of_charge: source.stat_soc || batterySoc }),
    });
    candidates.set(type, meters);
  }
  // Home Flow has one node per type. The native card below shows separate meters.
  for (const [type, meters] of candidates) {
    if (meters.size === 1) nodes[type] = meters.values().next().value;
    else ambiguous.add(SOURCE_LABELS[type]);
  }
  const notice = [
    missingLiveSources.size && `Quellen ohne Leistungssensor oder mit ungeeigneter Einheit fehlen in der Hausgrafik (${[...missingLiveSources].join(", ")}).`,
    ambiguous.size && `Mehrere getrennte Quellen für ${[...ambiguous].join(", ")} stehen im nativen Leistungsfluss.`,
    ambiguous.has("PV") && "Für PV kann ein Gesamtsensor für die Hausgrafik gewählt werden.",
  ].filter(Boolean).join(" ");
  if (!nodes.grid && !nodes.solar && !nodes.battery) {
    return { card: null, reason: notice || "Die Home Flow Card braucht mindestens eine Quelle für Netz, PV oder Speicher." };
  }
  return {
    card: {
      type: "custom:" + HOME_FLOW_TYPE,
      kilo_decimals: 2,
      animate_numbers: false,
      disable_dots: true,
      ...nodes,
    },
    notice,
  };
}

function entityName(hass, entity) {
  return hass.states?.[entity]?.attributes?.friendly_name || entity;
}

function isStreamUltra(device) {
  return [device?.model, device?.name].some((value) => /\bstream[\s_-]*ultra\b/i.test(value ?? "")) ||
    (/ecoflow/i.test(device?.manufacturer ?? "") && [device?.model, device?.model_id]
      .some((value) => /^bk(?:11|61)$/i.test(value ?? "")));
}

function solarInputNumber(names) {
  for (const name of names) {
    if (!name) continue;
    const normalized = name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
    const input = normalized.match(/\b(?:pv|solar)\s*(?:(?:eingang|input|string|modul|panel|leistung|power|energie|energy)\s+){0,2}(\d+)\b/i)?.[1];
    if (input) return input;
  }
  return undefined;
}

function solarDetails(sources, hass, visibleStatistic, entries, devices, batteryDeviceId, solarTotal, manualInputs) {
  const result = [];
  const ports = new Map();
  const linkedDevices = new Set([batteryDeviceId, entries.get(solarTotal)?.device_id, ...sources.flatMap((source) => [
    entries.get(source.stat_rate)?.device_id, entries.get(source.stat_energy_from)?.device_id,
  ])].filter(Boolean));
  const solarPrefix = solarTotal && SOLAR_TOTAL_SUFFIX.test(solarTotal) && solarTotal.replace(SOLAR_TOTAL_SUFFIX, "");
  const selected = new Set(Array.isArray(manualInputs) ? manualInputs : []);
  for (const entity of new Set([...Object.keys(hass.states ?? {}), ...selected])) {
    if (entity === solarTotal || typeof entity !== "string" || !entity.startsWith("sensor.")) continue;
    const state = hass.states?.[entity];
    const entry = entries.get(entity);
    if (entry?.disabled_by) continue;
    const device = entry?.device_id;
    const related = linkedDevices.has(device) || isStreamUltra(devices[device]) ||
      (solarPrefix && entity.startsWith(solarPrefix + "_"));
    if (!related && !selected.has(entity)) continue;
    const input = solarInputNumber([entry?.translation_key, entry?.original_name, entityName(hass, entity), entity]);
    if (!input && !selected.has(entity)) continue;
    const key = input && (device || solarPrefix) ? (device || solarPrefix) + ":" + input : entity;
    const metric = powerEntity(hass, entity) || selected.has(entity) ? "power" :
      ["Wh", "kWh", "MWh"].includes(state?.attributes?.unit_of_measurement) ? "energy" : null;
    if (!metric) continue;
    if (!ports.has(key)) ports.set(key, { name: input ? "PV " + input : entityName(hass, entity), device });
    const row = ports.get(key);
    if (!row[metric] || (metric === "power" && (
      (selected.has(entity) && !selected.has(row.power)) ||
      (!selected.has(row.power) && powerWatts(hass.states?.[row.power]) === undefined && powerWatts(state) !== undefined)
    ))) row[metric] = entity;
  }
  const portRows = [...ports.values()].sort((a, b) => a.name.localeCompare(b.name, "de", { numeric: true }));
  const multipleDevices = new Set(portRows.map((row) => row.device)).size > 1;
  for (const { device, ...row } of portRows) {
    const label = devices[device]?.name_by_user || devices[device]?.name || devices[device]?.model;
    result.push(multipleDevices && label ? { ...row, name: label + " · " + row.name } : row);
  }
  const deviceForSource = ({ stat_rate, stat_energy_from }) => entries.get(stat_rate)?.device_id || entries.get(stat_energy_from)?.device_id;
  const sourceCounts = new Map();
  for (const source of sources) {
    const device = deviceForSource(source);
    sourceCounts.set(device, (sourceCounts.get(device) || 0) + 1);
  }
  for (const source of sources) {
    const { stat_rate: power, stat_energy_from: energy } = source;
    const device = deviceForSource(source);
    const matchingInput = result.find((row) => (power && row.power === power) || (energy && row.energy === energy));
    if (matchingInput) {
      if (!matchingInput.power) matchingInput.power = powerEntity(hass, power);
      if (!matchingInput.energy && visibleStatistic(energy)) matchingInput.energy = energy;
      continue;
    }
    // Prefer per-input measurements for each period independently.
    const inputs = sourceCounts.get(device) === 1 ? portRows.filter((row) => row.device === device) : [];
    result.push({
      name: source.name || entityName(hass, hass.states?.[energy] ? energy : power || energy),
      power: power !== solarTotal && !inputs.some((row) => row.power) ? powerEntity(hass, power) : undefined,
      energy: !inputs.some((row) => row.energy) && visibleStatistic(energy) ? energy : undefined,
    });
  }
  return result.filter((row) => row.power || row.energy);
}

function energyPopupCards(prefs, hass, isVisible = (entity) => Boolean(hass.states?.[entity]), configuredSolarTotal, manualInputs = []) {
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

  const entries = new Map(Object.entries(hass.entities ?? {}).filter(([, entry]) => entry)
    .map(([key, entry]) => [entry.entity_id || key, entry]));
  const devices = Object.fromEntries(Object.entries(hass.devices ?? {}).filter(([, device]) => device)
    .map(([key, device]) => [device.id || key, device]));
  const batteries = electricity.filter((source) => source.type === "battery");
  const battery = batteries.find(hasLivePower) || batteries[0];
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
  const solarSources = electricity.filter(({ type }) => type === "solar");
  const selectedTotal = powerEntity(hass, configuredSolarTotal);
  const solarTotal = selectedTotal || detectedSolarTotal(solarSources, hass, entries, visible);
  const solar = solarDetails(solarSources, hass, visibleStatistic, entries, devices, batteryDeviceId,
    solarTotal || configuredSolarTotal, manualInputs);
  const liveSources = electricity.flatMap(livePowerSources).map((source) => {
    if (source.type === "solar" && !source.stat_rate && source.stat_energy_from) {
      const power = solar.find((row) => row.energy === source.stat_energy_from)?.power;
      return power ? { ...source, stat_rate: power } : source;
    }
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
  const devicesConfigured = (Array.isArray(prefs.device_consumption) ? prefs.device_consumption : []).filter(Boolean);
  const loads = devicesConfigured
    .map(({ stat_rate, stat_consumption, name }) => ({
      name: name || entityName(hass, stat_consumption || stat_rate),
      power: visible(stat_rate) ? powerEntity(hass, stat_rate) : undefined,
      energy: visibleStatistic(stat_consumption) ? stat_consumption : undefined,
    }))
    .filter((row) => row.power || row.energy);
  let solarTotalIssue;
  if (configuredSolarTotal && !selectedTotal) {
    solarTotalIssue = hass.states?.[configuredSolarTotal]
      ? "Der ausgewählte PV-Gesamtsensor liefert keine unterstützte Leistungseinheit."
      : "Der ausgewählte PV-Gesamtsensor ist in Home Assistant nicht verfügbar.";
  }
  const liveHomeFlow = homeFlowConfig(liveSources, hass, batteryLabel, batterySoc, solarTotal);
  return [{
    type: "custom:smartphone-dashboard-energy",
    views: {
      live: {
        flow: electricity.length ? nativeLiveFlow(electricity, hass.config?.version) : null,
        homeFlow: liveHomeFlow.card,
        homeFlowReason: [solarTotalIssue, liveHomeFlow.reason].filter(Boolean).join(" "),
        homeFlowNotice: [solarTotalIssue, liveHomeFlow.notice].filter(Boolean).join(" "),
        loadSensorsConfigured: devicesConfigured.some((device) => Boolean(device.stat_rate)),
        extra: utilityReadings,
      },
      today: {
        flow: nativeToday,
      },
    },
    battery: batterySoc ? { type: "tile", entity: batterySoc, name: batteryLabel + " · Ladestand", color: "green" } : null,
    loads,
    solar,
  }, dashboardLink];
}

async function loadEnergyPopupCards(hass, isVisible, configuredSolarTotal, manualInputs) {
  try {
    return energyPopupCards(await requestEnergy(hass, { type: "energy/get_prefs" }), hass, isVisible, configuredSolarTotal, manualInputs);
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
    const value = powerWatts(hass.states?.[row.power]);
    if (Number.isFinite(value)) return [{ ...row, value }];
    return !limit && row.power ? [{ ...row, value: null }] : [];
  });
  if (!limit) return values;
  const ranked = new Map();
  for (const row of values) {
    if (row.value > 0) ranked.set(current ? row.power : row.energy, row);
  }
  return [...ranked.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)).slice(0, limit);
}

export { energyPopupCards, energyRows, loadDailyEnergy, loadEnergyPopupCards };
