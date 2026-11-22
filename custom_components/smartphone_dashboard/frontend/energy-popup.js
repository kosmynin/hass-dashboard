const ENERGY_SOURCE_TYPES = new Set(["grid", "solar", "battery", "home", "water", "gas"]);

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

function energyPopupCards(prefs, hass, isVisible) {
  const sources = (Array.isArray(prefs?.energy_sources) ? prefs.energy_sources : [])
    .filter((source) => ENERGY_SOURCE_TYPES.has(source?.type));
  const dashboardLink = openEnergyDashboard();
  if (!sources.length) {
    return [
      hint("Im Energie-Dashboard sind noch keine Quellen für Strom, Wasser oder Gas eingerichtet."),
      dashboardLink,
    ];
  }

  // The native card calculates today's totals. Tiles show current sensor values.
  const readings = [];
  const seen = new Set();
  for (const [type, key, icon, color] of [
    ["home", "stat_rate", "mdi:home-lightning-bolt-outline", "blue"],
    ["solar", "stat_rate", "mdi:solar-power", "amber"],
    ["battery", "stat_soc", undefined, "green"],
    ["water", "stat_rate", "mdi:water", "cyan"],
    ["gas", "stat_rate", "mdi:fire", "orange"],
  ]) {
    for (const source of sources) {
      const entity = source[key];
      if (source.type !== type || typeof entity !== "string" ||
        !hass.states?.[entity] || !isVisible(entity) || seen.has(entity)) continue;
      seen.add(entity);
      readings.push({ type: "tile", entity, color, ...(icon ? { icon } : {}) });
    }
  }

  const cards = [{
    type: "energy-distribution",
    title: "Energieverteilung",
    collection_key: "energy_smartphone_dashboard",
  }];
  if (readings.length) cards.push({ type: "grid", columns: 2, square: false, cards: readings });
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
