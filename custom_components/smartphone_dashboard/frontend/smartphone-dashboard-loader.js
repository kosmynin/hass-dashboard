/**
 * Kleiner Sofort-Loader für die Smartphone-Dashboard-Strategy.
 * Wird von der Integration über einen versionsabhängigen Pfad injiziert.
 */

const TYPE = "smartphone-dashboard";
const ELEMENT = `ll-strategy-dashboard-${TYPE}`;
const LEGACY_ELEMENT = `ll-strategy-${TYPE}`;
const VERSION = "22.0.59";
const CORE_URL = new URL(`./smartphone-dashboard-strategy.js?v=${VERSION}`, import.meta.url).href;
const RECOVERY_KEY = `smartphone-dashboard:timeout-reload:${VERSION}:${location.pathname}`;
const EDITOR_ELEMENT = "smartphone-dashboard-strategy-editor";
const REGISTRY_MONITOR_DURATION = 15000;
const RECOVERY_LIMIT = 2;

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
  installImplementation(ELEMENT, SmartphoneDashboardLoader);
  installImplementation(LEGACY_ELEMENT, SmartphoneDashboardLegacyLoader);
  if (coreModule) {
    installImplementation(EDITOR_ELEMENT, coreModule.SmartphoneDashboardStrategyEditor);
  }
  return Boolean(registry.get(ELEMENT));
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
    setTimeout(monitorRegistry, 50);
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
    const attempts = Number.parseInt(sessionStorage.getItem(RECOVERY_KEY) || "0", 10) || 0;
    if (attempts >= RECOVERY_LIMIT) {
      console.error("Smartphone-Dashboard: Strategy blieb trotz Ladeversuchen zu spät");
      return;
    }
    sessionStorage.setItem(RECOVERY_KEY, String(attempts + 1));
  } catch (_error) {
    return;
  }
  console.warn("Smartphone-Dashboard: verspätete Strategy-Registrierung erkannt; begrenzter Reload");
  location.reload();
}

// Download früh starten, ohne die sofortige Registrierung zu verzögern.
void loadCore();
for (const target of [5250, 7000, 10000]) {
  setTimeout(recoverLateRegistration, Math.max(0, target - performance.now()));
}
console.info(`Smartphone-Dashboard-Loader v${VERSION} registriert`);

export { ensureRegistrations };
