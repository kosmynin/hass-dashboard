"""Local notification evaluation and serialized delivery."""
from __future__ import annotations
import asyncio
from datetime import datetime, timedelta
import fnmatch
import hashlib
import json
import logging
import math
import re
import time
from typing import Any
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er
from homeassistant.util import dt as dt_util
from .config_manager import ConfigManager
from .notification_core import (
    aggregate_alert_message,
    alert_content_digest,
    alert_set_digest,
    area_entity_label,
    dashboard_entity_enabled,
    is_battery_level_sensor,
    live_activity_entries,
    live_activity_presentation,
    live_activity_title,
    media_activity_presentation,
    media_dashboard_url,
    media_live_activity_tag,
    mobile_clear_data,
    mobile_live_activity_data,
    mobile_live_clear_data,
    mobile_media_activity_data,
    notification_recipient_token,
    normalized_alerts,
    parcel_alert,
    parse_mobile_action,
    ups_state_is_alert,
    valid_nina_glob,
    waste_collection_details,
)

DEFAULTS = {"battery": 6, "contact": 15, "co2": 1000, "frost": 4, "waste_days": 1, "nina": "binary_sensor.nina_warning_*"}
NOTIFICATION_TITLE = "Homeassistant"
PERSISTENT_NOTIFICATION_ID = "smartphone_dashboard_alerts"
DIGEST_PREFIX = "digest:"
CLEAR_DIGEST = "clear"
MOBILE_ACTION_EVENT = "mobile_app_notification_action"
LIVE_ACTIVITY_RENEW_AFTER = 7 * 60 * 60
LIVE_ACTIVITY_CONTENT_UPDATE_INTERVAL = 30 * 60
LIVE_ACTIVITY_PAYLOAD_VERSION = "8"
MOBILE_PUSH_DUPLICATE_INTERVAL = 10 * 60
MOBILE_PUSH_HOURLY_LIMIT = 60
MOBILE_PUSH_DAILY_LIMIT = 200
SNOOZE_SECONDS = 30 * 60
_LOGGER = logging.getLogger(__name__)
TEST_ACTIVITY_TAGS = (
    "smartphone_dashboard_test_battery",
    "smartphone_dashboard_test_contact",
    "smartphone_dashboard_test_co2",
    "smartphone_dashboard_test_waste_yellow",
    "smartphone_dashboard_test_waste_paper",
    "smartphone_dashboard_test_waste_bio",
    "smartphone_dashboard_test_waste_residual",
    "smartphone_dashboard_test_ups",
    "smartphone_dashboard_test_frost",
    "smartphone_dashboard_test_nina",
    "smartphone_dashboard_test_parcel_registered",
    "smartphone_dashboard_test_parcel_transit",
    "smartphone_dashboard_test_parcel_delivery",
    "smartphone_dashboard_test_parcel_pickup",
    "smartphone_dashboard_test_parcel_problem",
    "smartphone_dashboard_test_media",
)
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
    def __init__(self, hass: HomeAssistant, manager: ConfigManager, entry: ConfigEntry) -> None:
        self.hass, self.manager, self.entry = hass, manager, entry
        self._queue: asyncio.Queue[None] = asyncio.Queue(maxsize=1)
        self._worker: asyncio.Task | None = None
        self._migration_task: asyncio.Task | None = None
        self._unsub = None
        self._unsub_action = None
        self._retry_after = {}
        self._retry_count = {}
        self._persistent_message: str | None = None
        self._pending_actions: list[dict[str, str]] = []
        self._mobile_send_times: dict[str, list[float]] = {}
        self._mobile_payload_sent_at: dict[tuple[str, str], float] = {}

    async def async_start(self) -> None:
        if self._worker: return
        self._unsub = self.hass.bus.async_listen(EVENT_STATE_CHANGED, self._state_changed)
        self._unsub_action = self.hass.bus.async_listen(
            MOBILE_ACTION_EVENT, self._notification_action
        )
        self._worker = self.entry.async_create_background_task(
            self.hass, self._run(), "smartphone_dashboard_notifications"
        )
        self._migration_task = self.entry.async_create_background_task(
            self.hass, self._import_with_retry(), "smartphone_dashboard_legacy_import"
        )
        self._enqueue()

    async def async_stop(self) -> None:
        if self._unsub: self._unsub(); self._unsub = None
        if self._unsub_action: self._unsub_action(); self._unsub_action = None
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
        if entity_id.startswith(("sensor.", "binary_sensor.", "media_player.", "input_")):
            self._enqueue()

    @callback
    def _enqueue(self) -> None:
        if self._queue.empty(): self._queue.put_nowait(None)

    @callback
    def queue_refresh(self) -> None:
        """Re-evaluate activities immediately after backend settings change."""
        self._enqueue()

    def _recipients(self) -> list[str]:
        return [
            item
            for item in dict.fromkeys(
                value.strip()
                for value in self._state(
                    "input_text.smartphone_benachrichtigung_empfaenger"
                ).split(",")
            )
            if item.startswith("notify.") and item != "notify.persistent_notification"
        ]

    async def _async_notify(
        self, recipient: str, service: str, payload: dict[str, Any]
    ) -> bool:
        """Send once through a local circuit breaker before Companion limits apply."""
        if not recipient.startswith("notify.mobile_app_"):
            await self.hass.services.async_call(
                "notify", service, payload, blocking=True
            )
            return True
        now = time.monotonic()
        signature = hashlib.sha256(
            json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str).encode()
        ).hexdigest()
        signature_key = (recipient, signature)
        last_sent = self._mobile_payload_sent_at.get(signature_key, 0)
        if last_sent and now - last_sent < MOBILE_PUSH_DUPLICATE_INTERVAL:
            return False
        history = [
            sent_at for sent_at in self._mobile_send_times.get(recipient, [])
            if now - sent_at < 24 * 60 * 60
        ]
        recent_hour = sum(now - sent_at < 60 * 60 for sent_at in history)
        if recent_hour >= MOBILE_PUSH_HOURLY_LIMIT or len(history) >= MOBILE_PUSH_DAILY_LIMIT:
            raise RuntimeError(
                "Lokaler Push-Schutz aktiv: zu viele Companion-Aktualisierungen"
            )
        await self.hass.services.async_call(
            "notify", service, payload, blocking=True
        )
        history.append(now)
        self._mobile_send_times[recipient] = history
        self._mobile_payload_sent_at[signature_key] = now
        self._mobile_payload_sent_at = {
            key: sent_at for key, sent_at in self._mobile_payload_sent_at.items()
            if now - sent_at < MOBILE_PUSH_DUPLICATE_INTERVAL
        }
        return True

    def _test_alert_designs(self, group: str) -> list[tuple[str, dict[str, object]]]:
        """Return deterministic samples for visually checking every alert design."""
        designs: list[tuple[str, dict[str, object]]] = []
        if group in ("all", "messages"):
            waste_date = (dt_util.now() + timedelta(days=1)).strftime("%d.%m.")
            designs.extend((
                ("battery", {"fingerprint": "battery:test", "message": "🔋 Flur · Bewegungsmelder: 5%"}),
                ("contact", {"fingerprint": "contact:test", "message": "🚪 Küche · Fenster seit 18 Minuten offen"}),
                ("co2", {"fingerprint": "co2:test", "message": "💨 Wohnzimmer · Kohlendioxid: 1.180 ppm"}),
                ("waste_yellow", {"fingerprint": "waste:test-yellow", "message": f"🗑️ Gelbe Tonne: morgen · {waste_date}"}),
                ("waste_paper", {"fingerprint": "waste:test-paper", "message": f"🗑️ Papier: morgen · {waste_date}"}),
                ("waste_bio", {"fingerprint": "waste:test-bio", "message": f"🗑️ Biomüll: morgen · {waste_date}"}),
                ("waste_residual", {"fingerprint": "waste:test-residual", "message": f"🗑️ Restmüll: morgen · {waste_date}"}),
                ("ups", {"fingerprint": "ups:test", "message": "🔌 USV läuft auf Batterie"}),
                ("frost", {"fingerprint": "frost:test", "message": "❄️ Außen · Temperatur: −2 °C"}),
                ("nina", {"fingerprint": "nina:test", "message": "⚠️ Amtliche Warnung vor starkem Gewitter"}),
            ))
        if group in ("all", "parcels"):
            now = dt_util.now()
            planned_from = (now + timedelta(days=1)).replace(
                hour=14, minute=0, second=0, microsecond=0
            )
            planned_to = planned_from.replace(hour=16)
            parcel_samples = (
                ("parcel_registered", "registered", "Beispielshop"),
                ("parcel_transit", "in_transit", "Technikshop"),
                ("parcel_delivery", "out_for_delivery", "Versandhaus"),
                ("parcel_pickup", "at_pickup_point", "Abholung"),
                ("parcel_problem", "problem", "Mustershop"),
            )
            for slug, status, sender in parcel_samples:
                alert = parcel_alert({
                    "carrier": "Paketdienst",
                    "barcode": f"test-{status}",
                    "sender": sender,
                    "status": status,
                    "delivered": False,
                    "pickup_point": "Paketshop Musterstraße" if status == "at_pickup_point" else "",
                    "planned_from": planned_from.isoformat(),
                    "planned_to": planned_to.isoformat(),
                }, now)
                if alert is not None:
                    designs.append((slug, alert))
        return designs

    def _test_recipients(self, recipient: str = "") -> list[str]:
        candidates = [recipient] if recipient else self._recipients()
        return [
            item for item in dict.fromkeys(candidates)
            if item.startswith("notify.mobile_app_")
        ]

    async def async_send_test_designs(
        self, recipient: str = "", group: str = "all"
    ) -> int:
        """Send real Companion Live Activities for visual verification."""
        recipients = self._test_recipients(recipient)
        if not recipients:
            raise ValueError("Kein Mobile-App-Benachrichtigungsdienst konfiguriert")
        sent = 0
        for target in recipients:
            service = target.removeprefix("notify.")
            for slug, alert in self._test_alert_designs(group):
                presentation = live_activity_presentation(alert)
                await self._async_notify(
                    target,
                    service,
                    {
                        "title": f"{NOTIFICATION_TITLE} – {live_activity_title(alert)}",
                        "message": presentation["message"],
                        "data": mobile_live_activity_data(
                            [alert],
                            tag=f"smartphone_dashboard_test_{slug}",
                            recipient=target,
                            relevance_score=0.2,
                        ),
                    },
                )
                sent += 1
            if group in ("all", "media"):
                media_entry = {
                    "title": "Wohnzimmer",
                    "message": "Beispieltitel · Beispielinterpret",
                    "icon": "mdi:music",
                    "color": "#5E5CE6",
                    "url": media_dashboard_url("media_player.test"),
                }
                await self._async_notify(
                    target,
                    service,
                    {
                        "title": f"{NOTIFICATION_TITLE} – Wohnzimmer",
                        "message": media_entry["message"],
                        "data": mobile_media_activity_data(
                            media_entry,
                            tag="smartphone_dashboard_test_media",
                        ),
                    },
                )
                sent += 1
        return sent

    async def async_clear_test_designs(self, recipient: str = "") -> int:
        """End all Live Activities created by the design test action."""
        recipients = self._test_recipients(recipient)
        if not recipients:
            raise ValueError("Kein Mobile-App-Benachrichtigungsdienst konfiguriert")
        cleared = 0
        for target in recipients:
            service = target.removeprefix("notify.")
            for tag in TEST_ACTIVITY_TAGS:
                await self._async_notify(
                    target,
                    service,
                    {"message": "clear_notification", "data": mobile_live_clear_data(tag)},
                )
                cleared += 1
        return cleared

    @callback
    def _notification_action(self, event: Event) -> None:
        parsed = parse_mobile_action(event.data.get("action"))
        if not parsed:
            return
        self._pending_actions.append(parsed)
        self._enqueue()

    @callback
    def queue_dashboard_action(self, action: str, recipient_token: str) -> bool:
        """Queue a mute action opened from one recipient's Live Activity."""
        recipient = next(
            (
                candidate
                for candidate in self._recipients()
                if candidate.startswith("notify.mobile_app_")
                and notification_recipient_token(candidate) == recipient_token
            ),
            None,
        )
        if recipient is None or action not in ("snooze", "mute"):
            return False
        digest = alert_set_digest(normalized_alerts(self.evaluate()))
        self._pending_actions.append({
            "kind": action,
            "recipient_token": recipient_token,
            "digest": digest,
        })
        self._enqueue()
        return True

    @staticmethod
    def _next_live_tags(previous: list[str], count: int) -> list[str]:
        """Create one generation-scoped tag for every visible activity."""
        previous_tag = previous[0] if previous else ""
        generation = "1" if "_live_0_" in previous_tag else "0"
        base = f"smartphone_dashboard_live_{generation}"
        return [f"{base}_{index}" for index in range(1, count + 1)]

    @staticmethod
    def _next_media_tag(entity_id: str, previous: str = "") -> str:
        generation = 1 if previous.endswith("_0") else 0
        return media_live_activity_tag(entity_id, generation)

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

    def _entity_label(self, entity_id: str, attributes: dict[str, Any]) -> str:
        entity_entry = er.async_get(self.hass).async_get(entity_id)
        device = dr.async_get(self.hass).async_get(entity_entry.device_id) if entity_entry and entity_entry.device_id else None
        area_id = (entity_entry.area_id if entity_entry else None) or (
            dr.async_get_effective_area_id(self.hass, device) if device else None
        )
        area = ar.async_get(self.hass).async_get_area(area_id) if area_id else None
        entity_name = (
            (entity_entry.name or entity_entry.original_name) if entity_entry else None
        ) or attributes.get("friendly_name") or entity_id
        device_name = (device.name_by_user or device.name) if device else None
        return area_entity_label(area.name if area else None, entity_name, device_name, entity_id)

    def _dashboard_entity_enabled(self, entity_id: str, *, allow_hidden: bool = False) -> bool:
        """Apply the same registry visibility policy as the dashboard."""
        entity_entry = er.async_get(self.hass).async_get(entity_id)
        state = self.hass.states.get(entity_id)
        return dashboard_entity_enabled(
            entity_entry.disabled_by if entity_entry else None,
            entity_entry.hidden_by if entity_entry else None,
            state.attributes.get("hidden") if state else False,
            allow_hidden=allow_hidden,
        )

    def evaluate(self) -> list[dict[str, str]]:
        alerts: list[dict[str, str]] = []
        battery_limit = self._number("input_number.smartphone_batterie_grenzwert", DEFAULTS["battery"], 1, 100)
        battery_exclusions = {x.strip() for x in self._state("input_text.smartphone_batterie_ausnahmen").split(",") if x.strip()}
        contact_minutes = self._number("input_number.smartphone_kontakt_minuten", DEFAULTS["contact"], 1, 1440)
        co2_limit = self._number("input_number.smartphone_co2_grenzwert", DEFAULTS["co2"], 400, 5000)
        now = dt_util.now()
        for state in self.hass.states.async_all():
            entity_id, attrs = state.entity_id, state.attributes
            if self._enabled("batterien") and entity_id.startswith("sensor.") and entity_id not in battery_exclusions and self._dashboard_entity_enabled(entity_id, allow_hidden=True) and is_battery_level_sensor(entity_id, attrs):
                try:
                    value = float(state.state)
                    if value <= battery_limit: alerts.append({"fingerprint": f"battery:{entity_id}", "message": f"🔋 {self._entity_label(entity_id, attrs)}: {value:g}%"})
                except ValueError: pass
            if self._enabled("kontakte") and self._dashboard_entity_enabled(entity_id) and entity_id.startswith("binary_sensor.") and (attrs.get("device_class") in ("door", "window", "opening") or "contact" in entity_id or "kontakt" in entity_id) and state.state == "on":
                minutes = (now - state.last_changed).total_seconds() / 60
                if minutes >= contact_minutes: alerts.append({"fingerprint": f"contact:{entity_id}", "message": f"🚪 {self._entity_label(entity_id, attrs)} ist seit {minutes:.0f} Minuten offen"})
            if self._enabled("co2") and self._dashboard_entity_enabled(entity_id) and entity_id.startswith("sensor.") and (attrs.get("device_class") == "carbon_dioxide" or any(token in f"{entity_id} {attrs.get('friendly_name','')}".lower() for token in ("co2", "kohlendioxid"))):
                try:
                    value = float(state.state)
                    if value >= co2_limit: alerts.append({"fingerprint": f"co2:{entity_id}", "message": f"💨 {self._entity_label(entity_id, attrs)}: {value:g} ppm"})
                except ValueError: pass
        alerts.extend(self._configured_alerts(now))
        alerts.extend(self._parcel_alerts(now))
        return alerts

    def _parcel_alerts(self, now: datetime) -> list[dict[str, str]]:
        """Read the shared ha-parcel-integrations contract without carrier coupling."""
        strategy = self.manager.data.get("dashboards", {}).get("default", {}).get("config", {})
        if strategy.get("notification_parcels", True) is False:
            return []
        candidates = [
            state for state in self.hass.states.async_all("sensor")
            if self._dashboard_entity_enabled(state.entity_id)
            and isinstance(state.attributes.get("parcels"), list)
            and not re.search(r"(?:^|_)outgoing|delivered", state.entity_id, re.IGNORECASE)
        ]
        aggregator = next(
            (
                state for state in candidates
                if state.entity_id == "sensor.parcel_aggregator_incoming_parcels"
            ),
            None,
        )
        if aggregator is not None:
            candidates = [aggregator]
        else:
            incoming = [
                state for state in candidates
                if re.search(r"incoming.*parcel|parcel.*incoming", state.entity_id, re.IGNORECASE)
            ]
            if incoming:
                candidates = incoming
        alerts: list[dict[str, str]] = []
        seen: set[str] = set()
        for state in candidates:
            for parcel in state.attributes.get("parcels", []):
                if not isinstance(parcel, dict):
                    continue
                alert = parcel_alert(parcel, now)
                if alert is None or alert["fingerprint"] in seen:
                    continue
                seen.add(alert["fingerprint"])
                alerts.append(alert)
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
            if self._enabled("abfall") and state and self._dashboard_entity_enabled(entity_id):
                details = waste_collection_details(state.state, state.attributes, state.attributes.get("friendly_name", entity_id), now.date())
                if isinstance(details["days"], int) and 0 <= details["days"] <= waste_days:
                    fingerprint_date = details["date"] or str(state.state)
                    alerts.append({"fingerprint": f"waste:{entity_id}:{fingerprint_date}", "message": f"🗑️ {details['type']}: {details['date_label']}"})
        for entity_id in filter(None, map(str.strip, self._state("input_text.smartphone_usv_sensoren").split(","))):
            state = self.hass.states.get(entity_id)
            if self._enabled("usv") and state and self._dashboard_entity_enabled(entity_id) and ups_state_is_alert(entity_id, state.state, state.attributes.get("device_class"), state.attributes.get("friendly_name")):
                alerts.append({"fingerprint": f"ups:{entity_id}:{state.state}", "message": f"🔌 {self._entity_label(entity_id, state.attributes)}: {state.state}"})
        frost_id = self._state("input_text.smartphone_frost_sensor")
        frost = self.hass.states.get(frost_id)
        if self._enabled("frost") and frost and self._dashboard_entity_enabled(frost_id):
            try:
                value = float(frost.state); limit = self._number("input_number.smartphone_frost_grenzwert", DEFAULTS["frost"], -30, 20)
                if value <= limit: alerts.append({"fingerprint": f"frost:{frost_id}", "message": f"❄️ {self._entity_label(frost_id, frost.attributes)}: {value:g} °C"})
            except ValueError: pass
        pattern = self._state("input_text.smartphone_nina_muster", DEFAULTS["nina"])
        if self._enabled("nina") and valid_nina_glob(pattern):
            for state in self.hass.states.async_all("binary_sensor"):
                if state.state == "on" and self._dashboard_entity_enabled(state.entity_id) and fnmatch.fnmatchcase(state.entity_id, pattern):
                    attrs = state.attributes
                    detail = attrs.get("headline") or attrs.get("event") or attrs.get("description") or attrs.get("friendly_name", state.entity_id)
                    severity = attrs.get("severity", "")
                    identifier = attrs.get("identifier", "")
                    fingerprint_source = f"{state.entity_id}:{identifier}:{detail}:{severity}:{attrs.get('onset',attrs.get('start',''))}:{attrs.get('expires',attrs.get('expires_at',''))}"
                    alerts.append({"fingerprint": f"nina:{hashlib.sha256(fingerprint_source.encode()).hexdigest()[:24]}", "message": f"⚠️ {detail}" + (f" ({severity})" if severity else "")})
        return alerts

    def _active_media_entries(self) -> list[dict[str, str]]:
        """Return visible, configured players that are currently playing."""
        strategy = self.manager.data.get("dashboards", {}).get("default", {}).get("config", {})
        if strategy.get("notification_media", True) is False:
            return []
        feature = strategy.get("features", {}).get("media", {})
        if not isinstance(feature, dict):
            feature = {}
        if feature.get("enabled") is False:
            return []
        media_hash = str(feature.get("hash") or "#medien").strip()
        if not re.fullmatch(r"#[a-zA-Z0-9][a-zA-Z0-9_-]*", media_hash):
            media_hash = "#medien"
        excluded = {
            str(entity_id) for entity_id in feature.get("excluded_entities", [])
            if isinstance(entity_id, str)
        }
        manual = {
            str(entity_id) for entity_id in feature.get("entities", [])
            if isinstance(entity_id, str) and entity_id.startswith("media_player.")
        }
        if feature.get("auto_discover", True) is False:
            candidate_ids = manual
        else:
            candidate_ids = {
                state.entity_id for state in self.hass.states.async_all("media_player")
            } | manual
        candidate_ids = {
            entity_id for entity_id in candidate_ids
            if entity_id not in excluded and self._dashboard_entity_enabled(entity_id)
        }
        playing_ids = {
            entity_id for entity_id in candidate_ids
            if (state := self.hass.states.get(entity_id))
            and state.state in ("playing", "buffering")
        }
        entries: list[dict[str, str]] = []
        for entity_id in sorted(playing_ids):
            state = self.hass.states.get(entity_id)
            if state is None:
                continue
            group_members = state.attributes.get("group_members")
            if isinstance(group_members, (list, tuple)):
                visible_group = [
                    str(member) for member in group_members if str(member) in playing_ids
                ]
                if visible_group and entity_id != visible_group[0]:
                    continue
            entry = media_activity_presentation(
                entity_id,
                self._entity_label(entity_id, state.attributes),
                state.attributes,
            )
            entry["url"] = media_dashboard_url(entity_id, media_hash)
            entries.append(entry)
        return entries[:3]

    async def _sync_persistent_notification(self, alerts: list[dict[str, str]]) -> None:
        message = aggregate_alert_message(alerts, bullet="- ") if alerts else ""
        if message == self._persistent_message:
            return
        if alerts:
            await self.hass.services.async_call(
                "persistent_notification",
                "create",
                {
                    "notification_id": PERSISTENT_NOTIFICATION_ID,
                    "title": NOTIFICATION_TITLE,
                    "message": message,
                },
                blocking=True,
            )
        else:
            await self.hass.services.async_call(
                "persistent_notification",
                "dismiss",
                {"notification_id": PERSISTENT_NOTIFICATION_ID},
                blocking=True,
            )
        self._persistent_message = message

    async def _sync_media_live_activities(
        self,
        entries: list[dict[str, str]],
        recipients: list[str],
        media_digest_map: dict[str, dict[str, str]],
        media_tag_map: dict[str, dict[str, str]],
        media_started_map: dict[str, dict[str, float]],
        errors: list[str],
        active_retry_keys: set[tuple[str, str]],
        now_epoch: float,
    ) -> None:
        """Reconcile independently updating media-player Live Activities."""
        desired_entries = {entry["entity_id"]: entry for entry in entries}
        all_recipients = set(recipients) | set(media_tag_map)
        for recipient in all_recipients:
            if not recipient.startswith("notify.mobile_app_"):
                media_digest_map.pop(recipient, None)
                media_tag_map.pop(recipient, None)
                media_started_map.pop(recipient, None)
                continue
            service = recipient.removeprefix("notify.")
            desired = desired_entries if recipient in recipients else {}
            digests = media_digest_map.setdefault(recipient, {})
            tags = media_tag_map.setdefault(recipient, {})
            started = media_started_map.setdefault(recipient, {})

            for entity_id in set(tags) - set(desired):
                tag = tags[entity_id]
                clear_key = (recipient, f"media-clear:{tag}")
                active_retry_keys.add(clear_key)
                if self._retry_after.get(clear_key, 0) > time.monotonic():
                    continue
                try:
                    await self._async_notify(
                        recipient, service,
                        {"message": "clear_notification", "data": mobile_live_clear_data(tag)},
                    )
                    tags.pop(entity_id, None)
                    digests.pop(entity_id, None)
                    started.pop(entity_id, None)
                    self._retry_after.pop(clear_key, None)
                    self._retry_count.pop(clear_key, None)
                except Exception as err:
                    count = min(6, self._retry_count.get(clear_key, 0) + 1)
                    self._retry_count[clear_key] = count
                    self._retry_after[clear_key] = time.monotonic() + min(3600, 30 * (2 ** (count - 1)))
                    errors.append(f"{recipient}: Medien-Live-Activity entfernen: {err}")

            for entity_id, entry in desired.items():
                tag = tags.get(entity_id) or media_live_activity_tag(entity_id)
                started_at = started.get(entity_id, 0)
                renewal_due = started_at > 0 and now_epoch - started_at >= LIVE_ACTIVITY_RENEW_AFTER
                if renewal_due:
                    clear_key = (recipient, f"media-renew:{tag}")
                    active_retry_keys.add(clear_key)
                    if self._retry_after.get(clear_key, 0) > time.monotonic():
                        continue
                    try:
                        await self._async_notify(
                            recipient, service,
                            {"message": "clear_notification", "data": mobile_live_clear_data(tag)},
                        )
                        tag = self._next_media_tag(entity_id, tag)
                        tags[entity_id] = tag
                        digests.pop(entity_id, None)
                        started.pop(entity_id, None)
                        started_at = 0
                        self._retry_after.pop(clear_key, None)
                        self._retry_count.pop(clear_key, None)
                    except Exception as err:
                        count = min(6, self._retry_count.get(clear_key, 0) + 1)
                        self._retry_count[clear_key] = count
                        self._retry_after[clear_key] = time.monotonic() + min(3600, 30 * (2 ** (count - 1)))
                        errors.append(f"{recipient}: Medien-Live-Activity erneuern: {err}")
                        continue
                if digests.get(entity_id) == entry["digest"] and not renewal_due:
                    continue
                live_key = (recipient, f"media:{tag}:{entry['digest']}")
                active_retry_keys.add(live_key)
                if self._retry_after.get(live_key, 0) > time.monotonic():
                    continue
                payload = {
                    "title": f"{NOTIFICATION_TITLE} – {entry['title']}",
                    "message": entry["message"],
                    "data": mobile_media_activity_data(entry, tag=tag, silent=True),
                }
                try:
                    await self._async_notify(recipient, service, payload)
                    tags[entity_id] = tag
                    digests[entity_id] = entry["digest"]
                    started.setdefault(entity_id, now_epoch)
                    self._retry_after.pop(live_key, None)
                    self._retry_count.pop(live_key, None)
                except Exception as err:
                    count = min(6, self._retry_count.get(live_key, 0) + 1)
                    self._retry_count[live_key] = count
                    self._retry_after[live_key] = time.monotonic() + min(3600, 30 * (2 ** (count - 1)))
                    errors.append(f"{recipient}: Medien-Live-Activity: {err}")

            if not tags:
                media_tag_map.pop(recipient, None)
            if not digests:
                media_digest_map.pop(recipient, None)
            if not started:
                media_started_map.pop(recipient, None)

    async def _run(self) -> None:
        while True:
            try: await asyncio.wait_for(self._queue.get(), timeout=60)
            except asyncio.TimeoutError: pass
            await asyncio.sleep(0.5)
            try:
                alerts = normalized_alerts(self.evaluate())
                media_entries = self._active_media_entries()
                fingerprints = [alert["fingerprint"] for alert in alerts]
                digest = alert_set_digest(alerts)
                digest_token = f"{DIGEST_PREFIX}{digest}" if digest else ""
                recipients = self._recipients()
                notification_state = self.manager.data.get("notifications", {})
                stored_deliveries = notification_state.get("delivered_by_recipient", {})
                delivered_map = {
                    key: list(value)
                    for key, value in stored_deliveries.items()
                    if key in recipients and isinstance(value, list)
                }
                live_digest_map = {
                    key: str(value)
                    for key, value in notification_state.get(
                        "live_digest_by_recipient", {}
                    ).items()
                    if isinstance(key, str) and isinstance(value, str)
                }
                live_tag_map: dict[str, list[str]] = {}
                for key, value in notification_state.get(
                    "live_tag_by_recipient", {}
                ).items():
                    if not isinstance(key, str):
                        continue
                    if isinstance(value, str):
                        # Migrate the single activity used before payload v3.
                        live_tag_map[key] = [value]
                    elif isinstance(value, list):
                        tags = [tag for tag in value if isinstance(tag, str) and tag]
                        if tags:
                            live_tag_map[key] = tags
                live_started_map = {
                    key: float(value)
                    for key, value in notification_state.get(
                        "live_started_at_by_recipient", {}
                    ).items()
                    if isinstance(key, str) and isinstance(value, (int, float))
                }
                live_updated_map = {
                    key: float(value)
                    for key, value in notification_state.get(
                        "live_updated_at_by_recipient", {}
                    ).items()
                    if isinstance(key, str) and isinstance(value, (int, float))
                }
                media_digest_map = {
                    recipient: {
                        entity_id: str(digest_value)
                        for entity_id, digest_value in values.items()
                        if isinstance(entity_id, str) and isinstance(digest_value, str)
                    }
                    for recipient, values in notification_state.get(
                        "media_digest_by_recipient", {}
                    ).items()
                    if isinstance(recipient, str) and isinstance(values, dict)
                }
                media_tag_map = {
                    recipient: {
                        entity_id: str(tag)
                        for entity_id, tag in values.items()
                        if isinstance(entity_id, str) and isinstance(tag, str) and tag
                    }
                    for recipient, values in notification_state.get(
                        "media_tag_by_recipient", {}
                    ).items()
                    if isinstance(recipient, str) and isinstance(values, dict)
                }
                media_started_map = {
                    recipient: {
                        entity_id: float(started_at)
                        for entity_id, started_at in values.items()
                        if isinstance(entity_id, str) and isinstance(started_at, (int, float))
                    }
                    for recipient, values in notification_state.get(
                        "media_started_at_by_recipient", {}
                    ).items()
                    if isinstance(recipient, str) and isinstance(values, dict)
                }
                snooze_until_map = {
                    key: float(value)
                    for key, value in notification_state.get(
                        "snooze_until_by_recipient", {}
                    ).items()
                    if key in recipients and isinstance(value, (int, float))
                }
                muted_digest_map = {
                    key: str(value)
                    for key, value in notification_state.get(
                        "muted_digest_by_recipient", {}
                    ).items()
                    if key in recipients and isinstance(value, str)
                }
                pending_actions, self._pending_actions = self._pending_actions, []
                for action in pending_actions:
                    recipient = next(
                        (
                            candidate
                            for candidate in recipients
                            if notification_recipient_token(candidate)
                            == action["recipient_token"]
                        ),
                        None,
                    )
                    if recipient is None:
                        continue
                    if action["kind"] == "snooze":
                        snooze_until_map[recipient] = time.time() + SNOOZE_SECONDS
                        muted_digest_map.pop(recipient, None)
                    elif action["digest"]:
                        muted_digest_map[recipient] = action["digest"]
                        snooze_until_map.pop(recipient, None)
                errors = []
                try:
                    await self._sync_persistent_notification(alerts)
                except Exception as err:
                    errors.append(f"Persistent Notification: {err}")
                active_retry_keys = set()
                now_epoch = time.time()
                for recipient in recipients:
                    delivered = delivered_map.setdefault(recipient, [])
                    previous_digest = next(
                        (item for item in delivered if item.startswith(DIGEST_PREFIX)), ""
                    )
                    service = recipient.removeprefix("notify.")
                    mobile_app = service.startswith("mobile_app_")
                    snooze_was_present = recipient in snooze_until_map
                    snoozed = snooze_until_map.get(recipient, 0) > now_epoch
                    snooze_expired = snooze_was_present and not snoozed
                    if snooze_expired:
                        snooze_until_map.pop(recipient, None)
                    if muted_digest_map.get(recipient) not in (None, digest):
                        muted_digest_map.pop(recipient, None)
                    muted = bool(digest) and muted_digest_map.get(recipient) == digest
                    if alerts:
                        if mobile_app and not snoozed and not muted:
                            content_digest = alert_content_digest(alerts)
                            live_payload_digest = (
                                f"{LIVE_ACTIVITY_PAYLOAD_VERSION}:{digest}:{content_digest}"
                            )
                            previous_live_tags = live_tag_map.get(recipient, [])
                            live_started = live_started_map.get(recipient, 0)
                            live_updated = live_updated_map.get(recipient, 0)
                            previous_live_payload = live_digest_map.get(recipient, "")
                            previous_live_parts = previous_live_payload.split(":", 2)
                            same_payload_version = (
                                len(previous_live_parts) >= 1
                                and previous_live_parts[0]
                                == LIVE_ACTIVITY_PAYLOAD_VERSION
                            )
                            same_alert_set = (
                                len(previous_live_parts) >= 2
                                and previous_live_parts[1] == digest
                            )
                            renewal_due = (
                                live_started > 0
                                and now_epoch - live_started >= LIVE_ACTIVITY_RENEW_AFTER
                            )
                            content_changed = (
                                previous_live_payload != live_payload_digest
                            )
                            content_update_due = (
                                live_updated <= 0
                                or now_epoch - live_updated
                                >= LIVE_ACTIVITY_CONTENT_UPDATE_INTERVAL
                            )
                            live_due = (
                                renewal_due
                                or not previous_live_tags
                                or not same_payload_version
                                or not same_alert_set
                                or (content_changed and content_update_due)
                            )
                            if live_due:
                                entries = live_activity_entries(alerts)
                                reuse_existing = (
                                    same_alert_set
                                    and len(previous_live_tags) == len(entries)
                                    and not renewal_due
                                )
                                clear_succeeded = True
                                for old_tag in ([] if reuse_existing else previous_live_tags):
                                    clear_key = (recipient, f"replace-live:{old_tag}")
                                    active_retry_keys.add(clear_key)
                                    if self._retry_after.get(clear_key, 0) > time.monotonic():
                                        clear_succeeded = False
                                        continue
                                    try:
                                        await self._async_notify(
                                            recipient, service,
                                            {"message": "clear_notification", "data": mobile_live_clear_data(old_tag)},
                                        )
                                        self._retry_after.pop(clear_key, None)
                                        self._retry_count.pop(clear_key, None)
                                    except Exception as err:
                                        clear_succeeded = False
                                        count = min(6, self._retry_count.get(clear_key, 0) + 1)
                                        self._retry_count[clear_key] = count
                                        self._retry_after[clear_key] = time.monotonic() + min(3600, 30 * (2 ** (count - 1)))
                                        errors.append(f"{recipient}: Alte Live Activity entfernen: {err}")

                                if clear_succeeded:
                                    if reuse_existing:
                                        new_live_tags = previous_live_tags
                                    else:
                                        live_digest_map.pop(recipient, None)
                                        live_tag_map.pop(recipient, None)
                                        live_started_map.pop(recipient, None)
                                        live_updated_map.pop(recipient, None)
                                        new_live_tags = self._next_live_tags(
                                            previous_live_tags, len(entries)
                                        )
                                    sent_tags: list[str] = []
                                    for index, (entry, live_tag) in enumerate(
                                        zip(entries, new_live_tags, strict=True), start=1
                                    ):
                                        live_key = (
                                            recipient,
                                            f"live:{live_tag}:{live_payload_digest}",
                                        )
                                        active_retry_keys.add(live_key)
                                        urgent = entry["fingerprint"].startswith("nina:")
                                        presentation = live_activity_presentation(entry)
                                        live_payload = {
                                            "title": (
                                                f"{NOTIFICATION_TITLE} – "
                                                f"{live_activity_title(entry)}"
                                            ),
                                            "message": presentation["message"],
                                            "data": mobile_live_activity_data(
                                                [entry],
                                                tag=live_tag,
                                                silent=bool(live_started or previous_live_tags),
                                                recipient=recipient,
                                                critical_text=f"{index}/{len(entries)}",
                                                relevance_score=(
                                                    1.0 if urgent
                                                    else max(0.55, 0.9 - ((index - 1) * 0.05))
                                                ),
                                            ),
                                        }
                                        if self._retry_after.get(live_key, 0) > time.monotonic():
                                            continue
                                        try:
                                            await self._async_notify(
                                                recipient, service, live_payload
                                            )
                                            sent_tags.append(live_tag)
                                            self._retry_after.pop(live_key, None)
                                            self._retry_count.pop(live_key, None)
                                        except Exception as err:
                                            count = min(6, self._retry_count.get(live_key, 0) + 1)
                                            self._retry_count[live_key] = count
                                            self._retry_after[live_key] = time.monotonic() + min(3600, 30 * (2 ** (count - 1)))
                                            errors.append(f"{recipient}: Live Activity {index}: {err}")
                                    if sent_tags:
                                        live_tag_map[recipient] = (
                                            previous_live_tags
                                            if reuse_existing else sent_tags
                                        )
                                    if len(sent_tags) == len(entries):
                                        live_digest_map[recipient] = live_payload_digest
                                        live_started_map[recipient] = (
                                            live_started
                                            if reuse_existing and live_started > 0
                                            else now_epoch
                                        )
                                        live_updated_map[recipient] = now_epoch

                        if mobile_app and (snoozed or muted):
                            live_tags = live_tag_map.get(recipient, [])
                            if live_tags:
                                all_cleared = True
                                for live_tag in live_tags:
                                    clear_key = (recipient, f"muted-live:{live_tag}")
                                    active_retry_keys.add(clear_key)
                                    if self._retry_after.get(clear_key, 0) > time.monotonic():
                                        all_cleared = False
                                        continue
                                    try:
                                        await self._async_notify(
                                            recipient, service,
                                            {"message": "clear_notification", "data": mobile_live_clear_data(live_tag)},
                                        )
                                        self._retry_after.pop(clear_key, None)
                                        self._retry_count.pop(clear_key, None)
                                    except Exception as err:
                                        all_cleared = False
                                        count = min(6, self._retry_count.get(clear_key, 0) + 1)
                                        self._retry_count[clear_key] = count
                                        self._retry_after[clear_key] = time.monotonic() + min(3600, 30 * (2 ** (count - 1)))
                                        errors.append(f"{recipient}: Live Activity stummschalten: {err}")
                                if all_cleared:
                                    live_digest_map.pop(recipient, None)
                                    live_tag_map.pop(recipient, None)
                                    live_started_map.pop(recipient, None)
                                    live_updated_map.pop(recipient, None)

                        if mobile_app:
                            if delivered:
                                clear_key = (recipient, "retire-standard")
                                active_retry_keys.add(clear_key)
                                if self._retry_after.get(clear_key, 0) <= time.monotonic():
                                    try:
                                        await self._async_notify(
                                            recipient, service,
                                            {"message": "clear_notification", "data": mobile_clear_data()},
                                        )
                                        delivered_map[recipient] = []
                                        self._retry_after.pop(clear_key, None)
                                        self._retry_count.pop(clear_key, None)
                                    except Exception as err:
                                        count = min(6, self._retry_count.get(clear_key, 0) + 1)
                                        self._retry_count[clear_key] = count
                                        self._retry_after[clear_key] = time.monotonic() + min(3600, 30 * (2 ** (count - 1)))
                                        errors.append(f"{recipient}: Alte Mitteilung entfernen: {err}")
                            continue

                        if previous_digest != digest_token:
                            retry_key = (recipient, digest_token)
                            active_retry_keys.add(retry_key)
                            if self._retry_after.get(retry_key, 0) > time.monotonic():
                                errors.append(f"{recipient}: Zustellung wartet auf erneuten Versuch")
                            else:
                                payload: dict[str, Any] = {
                                    "title": NOTIFICATION_TITLE,
                                    "message": aggregate_alert_message(
                                        alerts, max_characters=1800
                                    ),
                                }
                                try:
                                    await self._async_notify(recipient, service, payload)
                                    delivered_map[recipient] = [digest_token, *fingerprints]
                                    self._retry_after.pop(retry_key, None)
                                    self._retry_count.pop(retry_key, None)
                                except Exception as err:
                                    count = min(6, self._retry_count.get(retry_key, 0) + 1)
                                    self._retry_count[retry_key] = count
                                    self._retry_after[retry_key] = time.monotonic() + min(3600, 30 * (2 ** (count - 1)))
                                    errors.append(f"{recipient}: {err}")
                    else:
                        snooze_until_map.pop(recipient, None)
                        muted_digest_map.pop(recipient, None)
                        if not mobile_app:
                            delivered_map[recipient] = []
                            live_digest_map.pop(recipient, None)
                            live_tag_map.pop(recipient, None)
                            live_started_map.pop(recipient, None)
                            live_updated_map.pop(recipient, None)
                            continue
                        if delivered:
                            clear_key = (recipient, CLEAR_DIGEST)
                            active_retry_keys.add(clear_key)
                            if self._retry_after.get(clear_key, 0) <= time.monotonic():
                                try:
                                    await self._async_notify(
                                        recipient, service,
                                        {"message": "clear_notification", "data": mobile_clear_data()},
                                    )
                                    delivered_map[recipient] = []
                                    self._retry_after.pop(clear_key, None)
                                    self._retry_count.pop(clear_key, None)
                                except Exception as err:
                                    count = min(6, self._retry_count.get(clear_key, 0) + 1)
                                    self._retry_count[clear_key] = count
                                    self._retry_after[clear_key] = time.monotonic() + min(3600, 30 * (2 ** (count - 1)))
                                    errors.append(f"{recipient}: Entfernen: {err}")
                        live_tags = live_tag_map.get(recipient, [])
                        if live_tags:
                            all_cleared = True
                            for live_tag in live_tags:
                                live_clear_key = (recipient, f"live-clear:{live_tag}")
                                active_retry_keys.add(live_clear_key)
                                if self._retry_after.get(live_clear_key, 0) > time.monotonic():
                                    all_cleared = False
                                    continue
                                try:
                                    await self._async_notify(
                                        recipient, service,
                                        {"message": "clear_notification", "data": mobile_live_clear_data(live_tag)},
                                    )
                                    self._retry_after.pop(live_clear_key, None)
                                    self._retry_count.pop(live_clear_key, None)
                                except Exception as err:
                                    all_cleared = False
                                    count = min(6, self._retry_count.get(live_clear_key, 0) + 1)
                                    self._retry_count[live_clear_key] = count
                                    self._retry_after[live_clear_key] = time.monotonic() + min(3600, 30 * (2 ** (count - 1)))
                                    errors.append(f"{recipient}: Live Activity entfernen: {err}")
                            if all_cleared:
                                live_digest_map.pop(recipient, None)
                                live_tag_map.pop(recipient, None)
                                live_started_map.pop(recipient, None)
                                live_updated_map.pop(recipient, None)

                removed_recipients = (
                    set(stored_deliveries) | set(live_tag_map)
                ) - set(recipients)
                for recipient in removed_recipients:
                    if not recipient.startswith("notify.mobile_app_"):
                        live_digest_map.pop(recipient, None)
                        live_tag_map.pop(recipient, None)
                        live_started_map.pop(recipient, None)
                        live_updated_map.pop(recipient, None)
                        continue
                    service = recipient.removeprefix("notify.")
                    delivered = stored_deliveries.get(recipient, [])
                    if delivered:
                        clear_key = (recipient, "removed-standard")
                        active_retry_keys.add(clear_key)
                        if self._retry_after.get(clear_key, 0) <= time.monotonic():
                            try:
                                await self._async_notify(
                                    recipient, service,
                                    {"message": "clear_notification", "data": mobile_clear_data()},
                                )
                                self._retry_after.pop(clear_key, None)
                                self._retry_count.pop(clear_key, None)
                            except Exception as err:
                                delivered_map[recipient] = list(delivered)
                                count = min(6, self._retry_count.get(clear_key, 0) + 1)
                                self._retry_count[clear_key] = count
                                self._retry_after[clear_key] = time.monotonic() + min(3600, 30 * (2 ** (count - 1)))
                                errors.append(f"{recipient}: Entfernen: {err}")
                    live_tags = live_tag_map.get(recipient, [])
                    if live_tags:
                        all_cleared = True
                        for live_tag in live_tags:
                            clear_key = (recipient, f"removed-live:{live_tag}")
                            active_retry_keys.add(clear_key)
                            if self._retry_after.get(clear_key, 0) > time.monotonic():
                                all_cleared = False
                                continue
                            try:
                                await self._async_notify(
                                    recipient, service,
                                    {"message": "clear_notification", "data": mobile_live_clear_data(live_tag)},
                                )
                                self._retry_after.pop(clear_key, None)
                                self._retry_count.pop(clear_key, None)
                            except Exception as err:
                                all_cleared = False
                                count = min(6, self._retry_count.get(clear_key, 0) + 1)
                                self._retry_count[clear_key] = count
                                self._retry_after[clear_key] = time.monotonic() + min(3600, 30 * (2 ** (count - 1)))
                                errors.append(f"{recipient}: Live Activity entfernen: {err}")
                        if all_cleared:
                            live_digest_map.pop(recipient, None)
                            live_tag_map.pop(recipient, None)
                            live_started_map.pop(recipient, None)
                            live_updated_map.pop(recipient, None)
                await self._sync_media_live_activities(
                    media_entries,
                    recipients,
                    media_digest_map,
                    media_tag_map,
                    media_started_map,
                    errors,
                    active_retry_keys,
                    now_epoch,
                )
                self._retry_after = {
                    key: value for key, value in self._retry_after.items()
                    if key in active_retry_keys
                }
                self._retry_count = {
                    key: value for key, value in self._retry_count.items()
                    if key in active_retry_keys
                }
                await self.manager.async_update_notification_status(
                    delivered_map,
                    {
                        "active": not errors,
                        "alerts": len(alerts),
                        "recipients": recipients,
                        "persistent_notification_id": PERSISTENT_NOTIFICATION_ID,
                        "live_activities": sum(len(tags) for tags in live_tag_map.values()),
                        "media_live_activities": sum(len(tags) for tags in media_tag_map.values()),
                        "errors": errors[-10:],
                    },
                    {
                        "live_digest_by_recipient": live_digest_map,
                        "live_tag_by_recipient": live_tag_map,
                        "live_started_at_by_recipient": live_started_map,
                        "live_updated_at_by_recipient": live_updated_map,
                        "media_digest_by_recipient": media_digest_map,
                        "media_tag_by_recipient": media_tag_map,
                        "media_started_at_by_recipient": media_started_map,
                        "snooze_until_by_recipient": snooze_until_map,
                        "muted_digest_by_recipient": muted_digest_map,
                    },
                )
            except asyncio.CancelledError: raise
            except Exception as err:
                _LOGGER.exception("Notification-Auswertung fehlgeschlagen")
                try: await self.manager.async_update_notification_status(self.manager.data.get("notifications", {}).get("delivered_by_recipient", {}), {"active": False, "alerts": 0, "recipients": [], "errors": [str(err)]})
                except Exception: _LOGGER.exception("Notification-Health konnte nicht gespeichert werden")
