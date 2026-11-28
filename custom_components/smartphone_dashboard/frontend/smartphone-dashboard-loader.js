/**
 * Kleiner Sofort-Loader für die Smartphone-Dashboard-Strategy.
 * Wird von der Integration über einen versionsabhängigen Pfad injiziert.
 */

const TYPE = "smartphone-dashboard";
const ELEMENT = `ll-strategy-dashboard-${TYPE}`;
const LEGACY_ELEMENT = `ll-strategy-${TYPE}`;
const VERSION = "23.1.9";
const CORE_URL = new URL(`./smartphone-dashboard-strategy.js?v=${VERSION}`, import.meta.url).href;
const REGISTRY_MONITOR_DURATION = 15000;

let corePromise;
let coreModule;
let popupReplaySignature = "";

function requestedDashboardPopup() {
  const requested = new URLSearchParams(location.search || "").get("sd_popup");
  if (/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(requested || "")) return `#${requested}`;
  return /^#[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(location.hash || "")
    ? location.hash
    : "";
}

function replayDashboardPopupDeepLink() {
  const target = requestedDashboardPopup();
  const signature = `${location.search || ""}|${target}`;
  if (!target || popupReplaySignature === signature) return;
  popupReplaySignature = signature;

  // Beim Kaltstart ist der Hash bereits gesetzt, bevor Bubble Card seine
  // Pop-up-Listener registriert. Wiederholte, zustandslose hashchange-Events
  // reichen den Deep Link nach, sobald das Dashboard gerendert ist. Der
  // Query-Parameter dient als Fallback, falls die Companion App den Fragment-
  // Teil beim Öffnen entfernt. Nach manuellem Schließen bleibt der Hash leer
  // und spätere Versuche öffnen den Dialog nicht erneut.
  [0, 150, 500, 1200, 2500].forEach((delay, index) => {
    setTimeout(() => {
      if (location.hash !== target) {
        if (index === 0 && requestedDashboardPopup() === target) {
          location.hash = target;
        }
        return;
      }
      if (typeof window.dispatchEvent === "function" && typeof Event === "function") {
        window.dispatchEvent(new Event("hashchange"));
      }
    }, delay);
  });
}

function loadCore() {
  if (!corePromise) {
    corePromise = import(CORE_URL).then((core) => {
      coreModule = core;
      ensureRegistrations();
      return core;
    });
  }
  return corePromise;
}

class SmartphoneDashboardLoader extends HTMLElement {
  static getCreateSuggestions() {
    return { title: "Handy", icon: "mdi:cellphone" };
  }

  static async generate(config, hass) {
    const core = await loadCore();
    const dashboard = await core.SmartphoneDashboardStrategy.generate(config, hass);
    replayDashboardPopupDeepLink();
    return dashboard;
  }

  static async getConfigElement() {
    const core = await loadCore();
    return core.SmartphoneDashboardStrategy.getConfigElement();
  }
}

class SmartphoneDashboardLegacyLoader extends SmartphoneDashboardLoader {}

let observedRegistry;
function ensureRegistrations() {
  const registry = window.customElements;
  if (!registry) return false;
  observedRegistry = registry;
  if (!registry.get(ELEMENT)) registry.define(ELEMENT, SmartphoneDashboardLoader);
  if (!registry.get(LEGACY_ELEMENT)) registry.define(LEGACY_ELEMENT, SmartphoneDashboardLegacyLoader);
  coreModule?.registerDashboardComponents(registry);
}

ensureRegistrations();

// Extra modules can execute before HA replaces the native registry with its
// scoped-registry polyfill. Re-register into the active registry when that
// happens, otherwise a successful early registration silently disappears.
const registryMonitorStarted = performance.now();
function monitorRegistry() {
  const registryChanged = observedRegistry !== window.customElements;
  const registrationMissing = !window.customElements?.get(ELEMENT);
  if (registryChanged || registrationMissing) ensureRegistrations();
  if (performance.now() - registryMonitorStarted < REGISTRY_MONITOR_DURATION) {
    setTimeout(monitorRegistry, 250);
  }
}
setTimeout(monitorRegistry, 0);
if (typeof window.addEventListener === "function") {
  window.addEventListener("load", () => {
    ensureRegistrations();
    replayDashboardPopupDeepLink();
  }, { once: true });
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
void loadCore().catch((error) => console.error("Smartphone-Dashboard konnte nicht geladen werden", error));
console.info(`Smartphone-Dashboard-Loader v${VERSION} registriert`);

export { ensureRegistrations };
