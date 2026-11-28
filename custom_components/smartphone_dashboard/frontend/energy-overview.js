import { energyRows, loadDailyEnergy } from "./energy-popup.js";

const REFRESH_INTERVAL = 5 * 60 * 1000;
const PERIODS = ["live", "today"];
const HOME_FLOW_READY = "smartphone-dashboard-home-flow-ready";
let watchingHomeFlow = false;

const styles = `
  :host { display: block; min-width: 0; color: var(--primary-text-color); }
  [hidden] { display: none !important; }
  .overview, .detail-cards, .flow, .utilities { display: grid; gap: 8px; min-width: 0; }
  .detail-cards:empty, .flow:empty { display: none; }
  .period {
    display: flex; justify-self: start; gap: 4px; padding: 4px;
    border-radius: 24px; background: var(--secondary-background-color);
  }
  button {
    appearance: none; min-height: 44px; min-width: 68px; padding: 0 14px;
    border: 0; border-radius: 20px; background: transparent;
    color: var(--secondary-text-color); font: inherit; font-weight: 600; cursor: pointer;
  }
  button[aria-pressed="true"] { background: var(--card-background-color); color: var(--primary-text-color); }
  button:focus-visible, summary:focus-visible { outline: 2px solid var(--primary-color); }
  ha-card { min-width: 0; padding: 12px 14px; }
  .heading { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  h3 { margin: 0; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
  .scope, .status { color: var(--secondary-text-color); font-size: 13px; }
  .status { margin: 8px 0 0; }
  .flow-status { margin: 0; padding: 0 4px; }
  .flow-status a { color: var(--primary-color); }
  ul { list-style: none; padding: 0; margin: 4px 0 0; }
  li { display: grid; gap: 4px; padding: 6px 0; }
  li + li { border-top: 1px solid var(--divider-color); }
  li:last-child { padding-bottom: 0; }
  .row { display: flex; gap: 8px; align-items: baseline; justify-content: space-between; }
  .name { min-width: 0; overflow-wrap: anywhere; }
  .value { white-space: nowrap; font-weight: 600; font-variant-numeric: tabular-nums; }
  .track { height: 3px; background: var(--divider-color); border-radius: 3px; overflow: hidden; }
  .bar { height: 100%; border-radius: inherit; background: var(--primary-color); }
  [data-kind="solar"] .bar { background: var(--energy-solar-color, var(--primary-color)); }
  summary { min-height: 44px; align-content: center; cursor: pointer; }
`;

class SmartphoneDashboardEnergy extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._period = "live";
    this._cards = [];
    this._mountId = 0;
    this._onHomeFlowReady = () => {
      if (this.isConnected && this._period === "live" && this._config?.views?.live?.homeFlow) void this._mountFlow();
    };
  }

  setConfig(config) {
    this._config = config;
    this._daily = undefined;
    this._dailyRequest = undefined;
    this._dailyError = false;
    this._dailyFetchedAt = 0;
    if (this.isConnected) this._build();
  }

  set hass(hass) {
    this._hass = hass;
    for (const card of this._cards) card.hass = hass;
    this._renderDetails();
    if (!this._refreshTimer) this._refreshDaily();
  }

  connectedCallback() {
    window.addEventListener(HOME_FLOW_READY, this._onHomeFlowReady);
    if (!watchingHomeFlow && !customElements.get("home-flow-card")) {
      watchingHomeFlow = true;
      void customElements.whenDefined("home-flow-card").then(() => window.dispatchEvent(new Event(HOME_FLOW_READY)));
    }
    if (this._config) this._build();
  }

  disconnectedCallback() {
    window.removeEventListener(HOME_FLOW_READY, this._onHomeFlowReady);
    this._mountId++;
    this._cards = [];
    this._dailyRequest = undefined;
    clearTimeout(this._refreshTimer);
    this._refreshTimer = undefined;
  }

  getCardSize() { return 6; }

  _build() {
    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <div class="overview">
        <div class="period" role="group" aria-label="Zeitraum">
          <button type="button" aria-controls="energy-content">Jetzt</button>
          <button type="button" aria-controls="energy-content">Heute</button>
        </div>
        <div class="overview" id="energy-content">
          <div class="flow"></div>
          <div class="detail-cards"></div>
          <div class="detail-cards extra"></div>
          <details hidden><summary>Wasser und Gas</summary><div class="utilities"></div></details>
        </div>
      </div>
    `;
    this._buttons = [...this.shadowRoot.querySelectorAll("button")];
    this._flow = this.shadowRoot.querySelector(".flow");
    this._details = this.shadowRoot.querySelector(".detail-cards");
    this._extras = this.shadowRoot.querySelector(".extra");
    this._utilityDetails = this.shadowRoot.querySelector("details");
    this._utilities = this.shadowRoot.querySelector(".utilities");
    this._utilityDetails.addEventListener("toggle", () => this._notifyResize());
    this._buttons.forEach((button, index) => button.addEventListener("click", () => {
      const period = PERIODS[index];
      if (period === this._period) return;
      this._period = period;
      this._showPeriod();
    }));
    this._showPeriod();
  }

  _showPeriod() {
    const period = this._period;
    this._buttons.forEach((button, index) => button.setAttribute("aria-pressed", String(PERIODS[index] === period)));
    this._signature = undefined;
    this._renderDetails();
    void this._mountFlow();
    clearTimeout(this._refreshTimer);
    this._refreshTimer = undefined;
    this._refreshDaily();
    this._notifyResize();
  }

  async _mountFlow() {
    const mountId = ++this._mountId;
    const view = this._config.views[this._period];
    const live = this._period === "live";
    this._cards = [];
    this._flow.replaceChildren();
    this._extras.replaceChildren();
    this._utilities.replaceChildren();
    this._utilityDetails.hidden = true;
    try {
      const helpers = await window.loadCardHelpers();
      if (!this.isConnected || mountId !== this._mountId) return;
      const appendCard = (parent, card) => {
        if (this._hass) card.hass = this._hass;
        parent.append(card);
        this._cards.push(card);
      };
      let flowCard;
      const homeFlowLoaded = Boolean(customElements.get("home-flow-card"));
      if (view.homeFlow && homeFlowLoaded) {
        try {
          const card = helpers.createCardElement(view.homeFlow);
          if (card.localName === "hui-error-card") {
            console.warn("Smartphone-Dashboard: Home Flow Card konnte nicht erstellt werden", card.error);
          } else {
            appendCard(this._flow, card);
            flowCard = card;
          }
        } catch (error) {
          console.warn("Smartphone-Dashboard: Home Flow Card konnte nicht geöffnet werden", error);
        }
      }
      if (live && ((!flowCard && view.flow) || (flowCard && view.homeFlowNotice))) {
        const status = document.createElement("p");
        status.className = "status flow-status";
        if (flowCard) status.textContent = view.homeFlowNotice;
        else if (!homeFlowLoaded) {
          status.innerHTML = 'Das Modul der Home Flow Card ist noch nicht geladen. <a href="https://cards.flixlix.com/home-flow-card/installation#verify-the-install" target="_blank" rel="noopener noreferrer">Lovelace-Ressource prüfen</a>';
        } else {
          status.textContent = view.homeFlowReason || "Die Home Flow Card konnte mit dieser Konfiguration nicht geöffnet werden.";
        }
        (flowCard ? this._extras : this._flow).append(status);
      }
      if (view.distribution) appendCard(this._flow, helpers.createCardElement(view.distribution));
      if (view.flow) appendCard(this._flow, helpers.createCardElement(view.flow));
      if (this._config.battery && (!flowCard || !view.homeFlow.battery?.state_of_charge)) {
        appendCard(this._extras, helpers.createCardElement(this._config.battery));
      }
      // The native daily distribution already includes water and gas.
      if (live) {
        for (const config of view.extra) appendCard(this._utilities, helpers.createCardElement(config));
        this._utilityDetails.hidden = !view.extra.length;
        this._utilityDetails.open = !view.flow;
        this._utilityDetails.querySelector("summary").textContent = view.extra.length === 1
          ? view.extra[0].name || view.extra[0].title : "Wasser und Gas";
      }
    } catch {
      if (!this.isConnected || mountId !== this._mountId) return;
      const message = document.createElement("ha-card");
      message.textContent = "Der Stromfluss konnte nicht geladen werden.";
      this._flow.append(message);
    }
    this._notifyResize();
  }

  _refreshDaily() {
    if (this._period !== "today" || !this.isConnected || !this._hass || !this._config || this._dailyRequest) return;
    const delay = this._dailyFetchedAt + REFRESH_INTERVAL - Date.now();
    clearTimeout(this._refreshTimer);
    if (delay > 0) {
      this._refreshTimer = setTimeout(() => this._refreshDaily(), delay);
      return;
    }
    const rows = this._config.solar;
    if (!rows.some((row) => row.energy)) return;
    const request = loadDailyEnergy(this._hass, rows);
    this._dailyRequest = request;
    this._dailyError = false;
    this._renderDetails();
    void request.then((value) => {
      if (this._dailyRequest === request) this._daily = value;
    }).catch(() => {
      if (this._dailyRequest === request) {
        this._daily = undefined;
        this._dailyError = true;
      }
    }).finally(() => {
      if (!this.isConnected || this._dailyRequest !== request) return;
      this._dailyRequest = undefined;
      this._dailyFetchedAt = Date.now();
      this._renderDetails();
      if (this._period === "today") this._refreshDaily();
      this._notifyResize();
    });
  }

  _renderDetails() {
    if (!this.isConnected || !this._details || !this._hass || !this._config.views.live.flow) return;
    const today = this._period === "today";
    const { solar } = this._config;
    const rows = energyRows(solar, this._hass, this._period, this._daily || {});
    const configured = solar.some((row) => today ? row.energy : row.power);
    const signature = JSON.stringify([this._period, rows, configured, this._dailyError, Boolean(this._dailyRequest)]);
    if (signature === this._signature) return;
    this._signature = signature;
    const formatter = new Intl.NumberFormat(this._hass.locale?.language ?? "de", {
      minimumFractionDigits: today ? 2 : 0, maximumFractionDigits: today ? 2 : 0,
    });

    const card = document.createElement("ha-card");
    card.dataset.kind = "solar";
    card.innerHTML = '<div class="heading"><h3></h3><span class="scope"></span></div>';
    card.querySelector("h3").textContent = today ? "PV-Ertrag je Eingang" : "PV-Eingänge";
    card.querySelector(".scope").textContent = today ? "Heute" : "Jetzt";
    if (rows.length) {
      const list = document.createElement("ul");
      const max = Math.max(0, ...rows.map(({ value }) => value));
      for (const { name, value } of rows) {
        const row = document.createElement("li");
        row.innerHTML = '<div class="row"><span class="name"></span><span class="value"></span></div><div class="track" aria-hidden="true"><div class="bar"></div></div>';
        row.querySelector(".name").textContent = name;
        row.querySelector(".value").textContent = value === null
          ? "Nicht verfügbar" : formatter.format(value) + (today ? " kWh" : " W");
        row.querySelector(".bar").style.width = (max ? Math.max(0, value) / max * 100 : 0) + "%";
        list.append(row);
      }
      card.append(list);
    } else {
      const status = document.createElement("p");
      status.className = "status";
      if (!configured) {
        status.textContent = today
          ? "Keine sichtbaren PV-Ertragszähler gefunden. Prüfe die Energie-Entitäten deines Wechselrichters."
          : "Keine PV-Leistungssensoren gefunden. Wähle bei Bedarf die Module in den Dashboard-Einstellungen unter Energie aus.";
      } else if (today && this._dailyRequest) {
        status.textContent = "Tageswerte werden geladen …";
      } else if (today && this._dailyError) {
        status.textContent = "Tageswerte konnten nicht geladen werden.";
      } else {
        status.textContent = today ? "Für heute liegen noch keine Messwerte vor." : "Aktuell sind keine Messwerte verfügbar.";
      }
      card.append(status);
    }
    this._details.replaceChildren(card);
  }

  _notifyResize() {
    this.dispatchEvent(new Event("iron-resize", { bubbles: true, composed: true }));
  }
}

export { SmartphoneDashboardEnergy };
