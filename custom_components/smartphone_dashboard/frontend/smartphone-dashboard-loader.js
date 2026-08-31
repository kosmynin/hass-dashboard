/**
 * Kleiner Sofort-Loader für die Smartphone-Dashboard-Strategy.
 * Wird von der Integration über einen versionsabhängigen Pfad injiziert.
 */

const TYPE = "smartphone-dashboard";
const ELEMENT = `ll-strategy-dashboard-${TYPE}`;
const LEGACY_ELEMENT = `ll-strategy-${TYPE}`;
const VERSION = "22.0.15";
const CORE_URL = new URL(`./smartphone-dashboard-strategy.js?v=${VERSION}`, import.meta.url).href;
const RECOVERY_KEY = `smartphone-dashboard:timeout-reload:${VERSION}:${location.pathname}`;
const EDITOR_ELEMENT = "smartphone-dashboard-strategy-editor";

let corePromise;

function loadCore() {
  if (!corePromise) {
    corePromise = import(CORE_URL).then((core) => {
      installImplementation(EDITOR_ELEMENT, core.SmartphoneDashboardStrategyEditor);
      return core;
    });
  }
  return corePromise;
}

function updateConstructor(target, implementation) {
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(implementation))) {
    if (["length", "name", "prototype"].includes(name)) continue;
    Object.defineProperty(target, name, descriptor);
  }
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(implementation.prototype))) {
    if (name === "constructor") continue;
    Object.defineProperty(target.prototype, name, descriptor);
  }
}

function installImplementation(tag, implementation) {
  const existing = customElements.get(tag);
  if (!existing) customElements.define(tag, implementation);
  else if (existing !== implementation) updateConstructor(existing, implementation);
  return customElements.get(tag);
}

function clearRecoveryMarker() {
  try {
    sessionStorage.removeItem(RECOVERY_KEY);
  } catch (_error) {
    // Session Storage kann in besonders restriktiven Browserprofilen gesperrt sein.
  }
}

class SmartphoneDashboardLoader extends HTMLElement {
  static getCreateSuggestions() {
    return { title: "Handy", icon: "mdi:cellphone" };
  }

  static async generate(config, hass) {
    clearRecoveryMarker();
    const core = await loadCore();
    return core.SmartphoneDashboardStrategy.generate(config, hass);
  }

  static async getConfigElement() {
    const core = await loadCore();
    return core.SmartphoneDashboardStrategy.getConfigElement();
  }
}

installImplementation(ELEMENT, SmartphoneDashboardLoader);
installImplementation(
  LEGACY_ELEMENT,
  class SmartphoneDashboardLegacyLoader extends SmartphoneDashboardLoader {},
);

window.customStrategies = window.customStrategies || [];
if (!window.customStrategies.some((item) => item.type === TYPE)) {
  window.customStrategies.push({
    type: TYPE,
    strategyType: "dashboard",
    name: "Smartphone-Dashboard",
    description: "Deutsches Smartphone-Dashboard mit grafischer Konfiguration.",
  });
}

function containsStrategyTimeout(root) {
  const text = root.textContent || "";
  if (text.includes("Timeout waiting for strategy element") && text.includes(ELEMENT)) {
    return true;
  }
  for (const element of root.querySelectorAll?.("*") || []) {
    if (element.shadowRoot && containsStrategyTimeout(element.shadowRoot)) return true;
  }
  return false;
}

function recoverLateRegistration() {
  // HA wartet derzeit nur fünf Sekunden und lädt Ressourcen parallel. Nur nach
  // diesem Zeitfenster nach der exakt zugehörigen Fehlerkarte suchen.
  if (performance.now() < 4500 || !containsStrategyTimeout(document)) return;
  try {
    if (sessionStorage.getItem(RECOVERY_KEY)) return;
    sessionStorage.setItem(RECOVERY_KEY, "1");
  } catch (_error) {
    return;
  }
  console.warn("Smartphone-Dashboard: verspätete Strategy-Registrierung erkannt; einmaliger Reload");
  location.reload();
}

// Download früh starten, ohne die sofortige Registrierung zu verzögern.
void loadCore();
for (const delay of [0, 250, 1000, 2500]) setTimeout(recoverLateRegistration, delay);
console.info(`Smartphone-Dashboard-Loader v${VERSION} registriert`);
