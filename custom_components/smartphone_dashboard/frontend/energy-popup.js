const ELECTRICITY_TYPES = new Set(["grid", "solar", "battery", "home"]);

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

function hint(content) {
  return { type: "markdown", content };
}

function supportsLivePower(version) {
  const [year, month] = String(version || "").split(".").map(Number);
  return year > 2025 || (year === 2025 && month >= 12);
}

function hasPowerSensor(source) {
  return [source, source.power_config].some((config) =>
    Object.entries(config || {}).some(([key, value]) =>
      /^stat_rate(?:_|$)/.test(key) && typeof value === "string" && value.trim(),
    ),
  );
}

function energyPopupCards(prefs, hass, isVisible) {
  const sources = (Array.isArray(prefs?.energy_sources) ? prefs.energy_sources : [])
    .filter((source) => ELECTRICITY_TYPES.has(source?.type));
  const dashboardLink = openEnergyDashboard();
  if (!sources.length) {
    return [
      hint("Im Energie-Dashboard sind noch keine Stromquellen eingerichtet. Hinterlege dort Netz, PV, Speicher oder Hausverbrauch."),
      dashboardLink,
    ];
  }

  // Use the entity states for the glanceable readings and let Home Assistant
  // calculate totals, direction and watt conversion in the flow chart.
  const readings = [];
  const seen = new Set();
  for (const [type, key, icon, color] of [
    ["home", "stat_rate", "mdi:home-lightning-bolt-outline", "blue"],
    ["solar", "stat_rate", "mdi:solar-power", "amber"],
    ["battery", "stat_soc", undefined, "green"],
  ]) {
    for (const source of sources) {
      const entity = source[key];
      if (source.type !== type || typeof entity !== "string" ||
        !hass.states?.[entity] || !isVisible(entity) || seen.has(entity)) continue;
      seen.add(entity);
      readings.push({ type: "tile", entity, color, ...(icon ? { icon } : {}) });
    }
  }

  const cards = [];
  if (readings.length) cards.push({ type: "grid", columns: 2, square: false, cards: readings });
  const supportsLive = supportsLivePower(hass.config?.version);
  if (supportsLive && sources.some(hasPowerSensor)) {
    cards.push({
      type: "power-sankey",
      title: "Stromfluss jetzt",
      collection_key: "energy_dashboard_now",
      layout: "vertical",
      show_values: true,
      max_devices: 5,
    });
  } else {
    cards.push(
      hint(supportsLive
        ? "Für den Live-Stromfluss hinterlege Leistungssensoren (W oder kW) in den Energie-Einstellungen."
        : "Der Live-Stromfluss ist ab Home Assistant 2025.12 verfügbar."),
      {
        type: "energy-distribution",
        title: "Energiebilanz",
        collection_key: "energy_smartphone_dashboard",
      },
    );
  }
  return [...cards, dashboardLink];
}

async function loadEnergyPopupCards(hass, isVisible) {
  let timeout;
  try {
    const prefs = await Promise.race([
      hass.callWS({ type: "energy/get_prefs" }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Zeitlimit")), 3500); }),
    ]);
    return energyPopupCards(prefs, hass, isVisible);
  } catch (error) {
    if (error?.code === "not_found") return energyPopupCards(null, hass, isVisible);
    return [
      hint("Die Energiekonfiguration konnte nicht geladen werden. Öffne das Pop-up erneut oder prüfe das Energie-Dashboard."),
      openEnergyDashboard(),
    ];
  } finally {
    clearTimeout(timeout);
  }
}

export { energyPopupCards, loadEnergyPopupCards };
