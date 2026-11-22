const streams = new WeakMap();

const ALERT_POPUPS = {
  battery: ["#meldung-batterien", "Batterien", "mdi:battery-alert"],
  contact: ["#meldung-kontakte", "Offene Kontakte", "mdi:door-open"],
  co2: ["#meldung-co2", "CO₂", "mdi:molecule-co2"],
  waste: ["#meldung-abfall", "Abfall", "mdi:trash-can-outline"],
  ups: ["#meldung-usv", "USV", "mdi:power-plug-battery"],
  frost: ["#meldung-frost", "Frost", "mdi:snowflake-alert"],
  nina: ["#meldung-nina", "NINA-Warnungen", "mdi:alert-outline"],
  parcel: ["#meldung-pakete", "Pakete", "mdi:package-variant-closed"],
};

function subscribeAlertStream(connection, listener) {
  let stream = streams.get(connection);
  if (!stream) {
    stream = { listeners: new Set(), snapshot: undefined };
    streams.set(connection, stream);
    const publish = (snapshot) => {
      stream.snapshot = snapshot;
      for (const subscriber of stream.listeners) subscriber(snapshot);
    };
    stream.subscription = Promise.resolve().then(() =>
      connection.subscribeMessage(
        (message) => publish(Array.isArray(message?.alerts) ? message.alerts : null),
        { type: "smartphone_dashboard/notifications/subscribe" },
      ),
    );
    void stream.subscription.catch(() => publish(null));
  }
  stream.listeners.add(listener);
  listener(stream.snapshot);
  return () => {
    stream.listeners.delete(listener);
    if (stream.listeners.size || streams.get(connection) !== stream) return;
    streams.delete(connection);
    void stream.subscription.then((unsubscribe) => unsubscribe()).catch(() => {});
  };
}

class SmartphoneDashboardAlerts extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; min-inline-size: 0; max-inline-size: 100%; contain: inline-size; }
        .list {
          display: grid; grid-template-columns: minmax(0, 1fr);
          gap: var(--vertical-stack-card-gap, 8px);
        }
        .row {
          display: flex; align-items: center; gap: 10px;
          min-inline-size: 0; min-height: 48px; box-sizing: border-box; padding: 6px 12px 6px 6px;
          border-radius: var(--bubble-button-border-radius, var(--bubble-border-radius, 999px));
          background: var(--bubble-button-main-background-color, var(--bubble-main-background-color, var(--secondary-background-color)));
          color: var(--primary-text-color); text-decoration: none;
        }
        a:focus-visible { outline: 2px solid var(--primary-color); outline-offset: -2px; }
        .icon {
          display: grid; place-items: center; flex: 0 0 36px; height: 36px;
          border-radius: var(--bubble-button-icon-border-radius, 50%);
          background: var(--bubble-button-icon-background-color, var(--card-background-color));
        }
        .copy { flex: 1; min-inline-size: 0; font-size: 14px; line-height: 1.35; }
        .title { font-weight: 600; overflow-wrap: anywhere; }
        .detail, .instruction { color: var(--secondary-text-color); overflow-wrap: anywhere; }
        .compact .title, .compact .detail { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .full { align-items: flex-start; border-radius: var(--ha-card-border-radius, 16px); padding: 12px; }
        .full .detail, .instruction { white-space: pre-wrap; }
        .instruction { margin-top: 8px; }
      </style>
      <div class="list"></div>`;
    this._list = this.shadowRoot.querySelector(".list");
  }

  setConfig(config) {
    this._category = config.category ?? "";
    this._summary = config.summary === true;
    this._render(this._snapshot);
  }

  set hass(hass) {
    if (this._connection === hass.connection) return;
    this._unsubscribe?.();
    this._unsubscribe = undefined;
    this._connection = hass.connection;
    this._render(undefined);
    this._connect();
  }

  connectedCallback() {
    this._connect();
  }

  disconnectedCallback() {
    this._unsubscribe?.();
    this._unsubscribe = undefined;
  }

  getCardSize() {
    return 1;
  }

  _connect() {
    if (!this.isConnected || !this._connection?.subscribeMessage || this._unsubscribe) return;
    this._unsubscribe = subscribeAlertStream(this._connection, (snapshot) => this._render(snapshot));
  }

  _render(snapshot) {
    this._snapshot = snapshot;
    const alerts = snapshot?.filter((alert) => !this._category || alert.category === this._category);
    const signature = JSON.stringify([this._category, this._summary, snapshot === null, snapshot === undefined, alerts]);
    if (signature === this._signature) return;
    this._signature = signature;
    if (!alerts?.length) {
      const text = snapshot === undefined ? "Meldungen werden geladen"
        : snapshot === null ? "Meldungen vorübergehend nicht verfügbar"
          : this._category ? "Keine aktive Meldung in diesem Bereich" : "Keine Meldungen";
      this._list.replaceChildren(this._row({ title: text, icon: "mdi:bell-outline" }));
      return;
    }
    const focusedId = this.shadowRoot?.activeElement?.dataset?.alertId;
    const rows = alerts.map((alert) => this._row(alert));
    this._list.replaceChildren(...rows);
    if (focusedId) rows.find((row) => row.dataset.alertId === focusedId)?.focus({ preventScroll: true });
  }

  _row(alert) {
    const href = this._summary && Object.hasOwn(ALERT_POPUPS, alert.category) ? ALERT_POPUPS[alert.category][0] : "";
    const row = document.createElement(href ? "a" : "div");
    row.className = `row ${this._summary || !alert.category ? "compact" : "full"}`;
    if (href) {
      row.href = href;
      row.dataset.alertId = alert.id;
    }
    const icon = document.createElement("ha-icon");
    icon.className = "icon";
    icon.setAttribute("icon", alert.icon);
    icon.setAttribute("aria-hidden", "true");
    if (/^#[a-f\d]{6}$/i.test(alert.color ?? "")) icon.style.color = alert.color;
    const copy = document.createElement("div");
    copy.className = "copy";
    for (const [role, text] of [
      ["title", alert.title],
      ["detail", alert.detail],
      ["instruction", this._summary ? "" : alert.instruction],
    ]) {
      if (!text) continue;
      const line = document.createElement("div");
      line.className = role;
      line.textContent = text;
      copy.append(line);
    }
    row.append(icon, copy);
    return row;
  }
}

export { ALERT_POPUPS, SmartphoneDashboardAlerts, subscribeAlertStream };
