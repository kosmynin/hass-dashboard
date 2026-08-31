"""Local notification evaluation and serialized delivery."""
from __future__ import annotations
import asyncio
from datetime import datetime
import fnmatch
import hashlib
import logging
import math
import time
from typing import Any
from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import Event, HomeAssistant, callback
from .config_manager import ConfigManager
from .notification_core import pending_fingerprints, retained_fingerprints, ups_state_is_alert, valid_nina_glob, waste_collection_details

DEFAULTS = {"battery": 6, "contact": 15, "co2": 1000, "frost": 4, "waste_days": 1, "nina": "binary_sensor.nina_warning_*"}
NOTIFICATION_TITLE = "Homeassistant"
_LOGGER = logging.getLogger(__name__)
LEGACY_TO_CONFIG = {
    "input_boolean.smartphone_meldung_batterien": "notification_batteries", "input_boolean.smartphone_meldung_kontakte": "notification_contacts",
    "input_boolean.smartphone_meldung_co2": "notification_co2", "input_boolean.smartphone_meldung_abfall": "notification_waste",
    "input_boolean.smartphone_meldung_usv": "notification_ups", "input_boolean.smartphone_meldung_frost": "notification_frost",
    "input_boolean.smartphone_meldung_nina": "notification_nina", "input_number.smartphone_batterie_grenzwert": "battery_threshold",
    "input_number.smartphone_kontakt_minuten": "contact_minutes", "input_number.smartphone_co2_grenzwert": "co2_threshold",
    "input_number.smartphone_frost_grenzwert": "frost_threshold", "input_text.smartphone_benachrichtigung_empfaenger": "notification_recipients",
    "input_text.smartphone_batterie_ausnahmen": "battery_exclusions", "input_text.smartphone_frost_sensor": "frost_entity",
    "input_text.smartphone_abfall_sensoren": "waste_entities", "input_text.smartphone_usv_sensoren": "ups_entities",
    "input_text.smartphone_nina_muster": "nina_entities",
}

class NotificationCoordinator:
    def __init__(self, hass: HomeAssistant, manager: ConfigManager) -> None:
        self.hass, self.manager = hass, manager
        self._queue: asyncio.Queue[None] = asyncio.Queue(maxsize=1)
        self._worker: asyncio.Task | None = None
        self._migration_task: asyncio.Task | None = None
        self._unsub = None
        self._retry_after = {}
        self._retry_count = {}

    async def async_start(self) -> None:
        if self._worker: return
        self._unsub = self.hass.bus.async_listen(EVENT_STATE_CHANGED, self._state_changed)
        self._worker = self.hass.async_create_task(self._run(), "smartphone_dashboard_notifications")
        self._migration_task = self.hass.async_create_task(self._import_with_retry(), "smartphone_dashboard_legacy_import")
        self._enqueue()

    async def async_stop(self) -> None:
        if self._unsub: self._unsub(); self._unsub = None
        if self._worker:
            self._worker.cancel()
            try: await self._worker
            except asyncio.CancelledError: pass
            self._worker = None
        if self._migration_task:
            self._migration_task.cancel()
            try: await self._migration_task
            except asyncio.CancelledError: pass
            except Exception: _LOGGER.exception("Fehler der Legacy-Migration beim Beenden verarbeitet")
            self._migration_task = None

    async def _import_with_retry(self) -> None:
        attempt = 0
        while True:
            try:
                migration = await self.manager.async_import_legacy_helpers()
                if migration.get("seeded"): return
            except asyncio.CancelledError:
                raise
            except Exception:
                _LOGGER.exception("Legacy-Migration fehlgeschlagen (Versuch %s)", attempt + 1)
            attempt += 1
            await asyncio.sleep(min(300, 5 * attempt))

    @callback
    def _state_changed(self, event: Event) -> None:
        entity_id = event.data.get("entity_id", "")
        if entity_id.startswith(("sensor.", "binary_sensor.", "input_")):
            self._enqueue()

    @callback
    def _enqueue(self) -> None:
        if self._queue.empty(): self._queue.put_nowait(None)

    def _state(self, entity_id: str, default: str = "") -> str:
        dashboards = self.manager.data.get("dashboards", {})
        strategy = dashboards.get("default", {}).get("config", {})
        key = LEGACY_TO_CONFIG.get(entity_id, "")
        seeded_fields = self.manager.data.get("migration", {}).get("seeded_fields", [])
        if (self.manager.data.get("migration", {}).get("seeded") or entity_id in seeded_fields) and key in strategy:
            value = strategy[key]
            return ("on" if value else "off") if isinstance(value, bool) else str(value)
        state = self.hass.states.get(entity_id)
        if state and state.state not in ("unknown", "unavailable"): return state.state
        value = strategy.get(key, default)
        if isinstance(value, bool): return "on" if value else "off"
        return str(value) if value is not None else default

    def _enabled(self, suffix: str) -> bool:
        return self._state(f"input_boolean.smartphone_meldung_{suffix}", "on") == "on"

    def _number(self, entity_id, default, minimum, maximum):
        try: value = float(self._state(entity_id, str(default)))
        except (TypeError, ValueError): value = default
        if not math.isfinite(value): value = default
        return min(maximum, max(minimum, value))

    def evaluate(self) -> list[dict[str, str]]:
        alerts: list[dict[str, str]] = []
        battery_limit = self._number("input_number.smartphone_batterie_grenzwert", DEFAULTS["battery"], 1, 100)
        battery_exclusions = {x.strip() for x in self._state("input_text.smartphone_batterie_ausnahmen").split(",") if x.strip()}
        contact_minutes = self._number("input_number.smartphone_kontakt_minuten", DEFAULTS["contact"], 1, 1440)
        co2_limit = self._number("input_number.smartphone_co2_grenzwert", DEFAULTS["co2"], 400, 5000)
        now = datetime.now().astimezone()
        for state in self.hass.states.async_all():
            entity_id, attrs = state.entity_id, state.attributes
            if self._enabled("batterien") and entity_id not in battery_exclusions and (attrs.get("device_class") == "battery" or entity_id.endswith(("battery", "batterie"))):
                try:
                    value = float(state.state)
                    if value <= battery_limit: alerts.append({"fingerprint": f"battery:{entity_id}", "message": f"🔋 {attrs.get('friendly_name', entity_id)}: {value:g}%"})
                except ValueError: pass
            if self._enabled("kontakte") and entity_id.startswith("binary_sensor.") and (attrs.get("device_class") in ("door", "window", "opening") or "contact" in entity_id or "kontakt" in entity_id) and state.state == "on":
                minutes = (now - state.last_changed).total_seconds() / 60
                if minutes >= contact_minutes: alerts.append({"fingerprint": f"contact:{entity_id}", "message": f"🚪 {attrs.get('friendly_name', entity_id)} ist seit {minutes:.0f} Minuten offen"})
            if self._enabled("co2") and (attrs.get("device_class") == "carbon_dioxide" or any(token in f"{entity_id} {attrs.get('friendly_name','')}".lower() for token in ("co2", "kohlendioxid"))):
                try:
                    value = float(state.state)
                    if value >= co2_limit: alerts.append({"fingerprint": f"co2:{entity_id}", "message": f"💨 {attrs.get('friendly_name', entity_id)}: {value:g} ppm"})
                except ValueError: pass
        alerts.extend(self._configured_alerts(now))
        return alerts

    def _configured_alerts(self, now: datetime) -> list[dict[str, str]]:
        alerts = []
        strategy = self.manager.data.get("dashboards", {}).get("default", {}).get("config", {})
        try:
            waste_days = int(strategy.get("waste_days", DEFAULTS["waste_days"]))
        except (TypeError, ValueError):
            waste_days = DEFAULTS["waste_days"]
        waste_days = min(30, max(0, waste_days))
        for entity_id in filter(None, map(str.strip, self._state("input_text.smartphone_abfall_sensoren").split(","))):
            state = self.hass.states.get(entity_id)
            if self._enabled("abfall") and state:
                details = waste_collection_details(state.state, state.attributes, state.attributes.get("friendly_name", entity_id), now.date())
                if isinstance(details["days"], int) and 0 <= details["days"] <= waste_days:
                    fingerprint_date = details["date"] or str(state.state)
                    alerts.append({"fingerprint": f"waste:{entity_id}:{fingerprint_date}", "message": f"🗑️ {details['type']}: {details['date_label']}"})
        for entity_id in filter(None, map(str.strip, self._state("input_text.smartphone_usv_sensoren").split(","))):
            state = self.hass.states.get(entity_id)
            if self._enabled("usv") and state and ups_state_is_alert(entity_id, state.state, state.attributes.get("device_class")):
                alerts.append({"fingerprint": f"ups:{entity_id}:{state.state}", "message": f"🔌 {state.attributes.get('friendly_name', entity_id)}: {state.state}"})
        frost_id = self._state("input_text.smartphone_frost_sensor")
        frost = self.hass.states.get(frost_id)
        if self._enabled("frost") and frost:
            try:
                value = float(frost.state); limit = self._number("input_number.smartphone_frost_grenzwert", DEFAULTS["frost"], -30, 20)
                if value <= limit: alerts.append({"fingerprint": f"frost:{frost_id}", "message": f"❄️ Frost: {value:g} °C"})
            except ValueError: pass
        pattern = self._state("input_text.smartphone_nina_muster", DEFAULTS["nina"])
        if self._enabled("nina") and valid_nina_glob(pattern):
            for state in self.hass.states.async_all("binary_sensor"):
                if state.state == "on" and fnmatch.fnmatchcase(state.entity_id, pattern):
                    attrs = state.attributes
                    detail = attrs.get("headline") or attrs.get("event") or attrs.get("description") or attrs.get("friendly_name", state.entity_id)
                    severity = attrs.get("severity", "")
                    identifier = attrs.get("identifier", "")
                    fingerprint_source = f"{state.entity_id}:{identifier}:{detail}:{severity}:{attrs.get('onset',attrs.get('start',''))}:{attrs.get('expires',attrs.get('expires_at',''))}"
                    alerts.append({"fingerprint": f"nina:{hashlib.sha256(fingerprint_source.encode()).hexdigest()[:24]}", "message": f"⚠️ {detail}" + (f" ({severity})" if severity else "")})
        return alerts

    async def _run(self) -> None:
        while True:
            try: await asyncio.wait_for(self._queue.get(), timeout=60)
            except asyncio.TimeoutError: pass
            await asyncio.sleep(0.5)
            try:
                alerts = self.evaluate(); fingerprints = [a["fingerprint"] for a in alerts]
                recipients = [x.strip() for x in self._state("input_text.smartphone_benachrichtigung_empfaenger").split(",") if x.strip().startswith("notify.")]
                active_retry_keys = {(recipient, fingerprint) for recipient in recipients for fingerprint in fingerprints}
                self._retry_after = {key: value for key, value in self._retry_after.items() if key in active_retry_keys}
                self._retry_count = {key: value for key, value in self._retry_count.items() if key in active_retry_keys}
                delivered_map = {key: list(value) for key, value in self.manager.data.get("notifications", {}).get("delivered_by_recipient", {}).items() if key in recipients}
                errors = []
                for recipient in recipients:
                    delivered = delivered_map.setdefault(recipient, [])
                    pending = set(pending_fingerprints(fingerprints, delivered)); successful = []
                    for alert in (item for item in alerts if item["fingerprint"] in pending):
                        retry_key = (recipient, alert["fingerprint"])
                        if self._retry_after.get(retry_key, 0) > time.monotonic():
                            errors.append(f"{recipient}: Zustellung wartet auf erneuten Versuch")
                            continue
                        try:
                            await self.hass.services.async_call("notify", recipient.removeprefix("notify."), {"title": NOTIFICATION_TITLE, "message": alert["message"]}, blocking=True)
                            successful.append(alert["fingerprint"]); self._retry_after.pop(retry_key, None); self._retry_count.pop(retry_key, None)
                        except Exception as err:
                            count = min(6, self._retry_count.get(retry_key, 0) + 1); self._retry_count[retry_key] = count
                            self._retry_after[retry_key] = time.monotonic() + min(3600, 30 * (2 ** (count - 1))); errors.append(f"{recipient}: {err}")
                    delivered_map[recipient] = retained_fingerprints(fingerprints, delivered, successful)
                await self.manager.async_update_notification_status(delivered_map, {"active": not errors and bool(recipients), "alerts": len(alerts), "recipients": recipients, "errors": errors[-10:]})
            except asyncio.CancelledError: raise
            except Exception as err:
                _LOGGER.exception("Notification-Auswertung fehlgeschlagen")
                try: await self.manager.async_update_notification_status(self.manager.data.get("notifications", {}).get("delivered_by_recipient", {}), {"active": False, "alerts": 0, "recipients": [], "errors": [str(err)]})
                except Exception: _LOGGER.exception("Notification-Health konnte nicht gespeichert werden")
