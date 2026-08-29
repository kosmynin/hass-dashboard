/**
 * Kleiner Sofort-Loader für die Smartphone-Dashboard-Strategy.
 * Diese Datei als Lovelace-Ressource laden; das Core-Modul liegt daneben.
 */

const TYPE = "smartphone-dashboard";
const ELEMENT = `ll-strategy-dashboard-${TYPE}`;
const LEGACY_ELEMENT = `ll-strategy-${TYPE}`;
const CORE_URL = new URL("./smartphone-dashboard-strategy.js?v=22.0.1", import.meta.url).href;

let corePromise;

function loadCore() {
  if (!corePromise) corePromise = import(CORE_URL);
  return corePromise;
}

class SmartphoneDashboardLoader extends HTMLElement {
  static getCreateSuggestions() {
    return { title: "Handy", icon: "mdi:cellphone" };
  }

  static async generate(config, hass) {
    const core = await loadCore();
    return core.SmartphoneDashboardStrategy.generate(config, hass);
  }

  static async getConfigElement() {
    const core = await loadCore();
    return core.SmartphoneDashboardStrategy.getConfigElement();
  }
}

if (!customElements.get(ELEMENT)) {
  customElements.define(ELEMENT, SmartphoneDashboardLoader);
}

if (!customElements.get(LEGACY_ELEMENT)) {
  customElements.define(
    LEGACY_ELEMENT,
    class SmartphoneDashboardLegacyLoader extends SmartphoneDashboardLoader {},
  );
}

window.customStrategies = window.customStrategies || [];
if (!window.customStrategies.some((item) => item.type === TYPE)) {
  window.customStrategies.push({
    type: TYPE,
    strategyType: "dashboard",
    name: "Smartphone-Dashboard",
    description: "Deutsches Smartphone-Dashboard mit grafischer Konfiguration.",
  });
}

// Download früh starten, ohne die sofortige Registrierung zu verzögern.
void loadCore();
console.info("Smartphone-Dashboard-Loader v22.0.1 registriert");
