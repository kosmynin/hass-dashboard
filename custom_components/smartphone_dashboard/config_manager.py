"""Versioned, idempotent storage and legacy-import support."""
from __future__ import annotations
from copy import deepcopy
import asyncio
from typing import Any
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from .const import HELPER_ENTITY_IDS, STORAGE_KEY, STORAGE_VERSION
from .storage_core import DEFAULT_DATA, migrate_store_data, normalize_legacy_value

HELPER_CONFIG_KEYS = {
    "input_boolean.smartphone_meldung_batterien": "notification_batteries", "input_boolean.smartphone_meldung_kontakte": "notification_contacts",
    "input_boolean.smartphone_meldung_co2": "notification_co2", "input_boolean.smartphone_meldung_abfall": "notification_waste",
    "input_boolean.smartphone_meldung_usv": "notification_ups", "input_boolean.smartphone_meldung_frost": "notification_frost",
    "input_boolean.smartphone_meldung_nina": "notification_nina", "input_number.smartphone_batterie_grenzwert": "battery_threshold",
    "input_number.smartphone_kontakt_minuten": "contact_minutes", "input_number.smartphone_co2_grenzwert": "co2_threshold",
    "input_number.smartphone_frost_grenzwert": "frost_threshold", "input_text.smartphone_benachrichtigung_empfaenger": "notification_recipients",
    "input_text.smartphone_batterie_ausnahmen": "battery_exclusions", "input_text.smartphone_frost_sensor": "frost_entity",
    "input_text.smartphone_abfall_sensoren": "waste_entities", "input_text.smartphone_usv_sensoren": "ups_entities", "input_text.smartphone_nina_muster": "nina_entities",
}

class DashboardStore(Store[dict[str, Any]]):
    """Migrate the pre-backend v1 store to the revisioned v22 schema."""
    async def _async_migrate_func(self, old_major_version: int, old_minor_version: int, old_data: dict[str, Any]) -> dict[str, Any]:
        return migrate_store_data(old_major_version, old_data)

class ConfigManager:
    """Own integration data without deleting or owning legacy helpers."""
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store: Store[dict[str, Any]] = DashboardStore(hass, STORAGE_VERSION, STORAGE_KEY)
        self.data = deepcopy(DEFAULT_DATA)
        self._lock = asyncio.Lock()

    async def async_load(self) -> None:
        stored = await self.store.async_load()
        if isinstance(stored, dict):
            self.data.update(stored)
        self.data.setdefault("dashboards", {})
        notifications = self.data.get("notifications")
        if not isinstance(notifications, dict) or "delivered_by_recipient" not in notifications:
            old_health = notifications.get("health", {}) if isinstance(notifications, dict) else {}
            self.data["notifications"] = {"delivered_by_recipient": {}, "health": old_health}
        await self.async_import_legacy_helpers()

    async def async_import_legacy_helpers(self) -> dict[str, Any]:
        async with self._lock:
            previous_data = deepcopy(self.data)
            snapshot = {entity_id: self.hass.states[entity_id].state for entity_id in HELPER_ENTITY_IDS if entity_id in self.hass.states and self.hass.states[entity_id].state not in ("unknown", "unavailable")}
            self.data["legacy_helpers"] = snapshot
            seeded_fields = set(self.data.get("migration", {}).get("seeded_fields", []))
            if snapshot:
                dashboard = self.data["dashboards"].setdefault("default", {"revision": 0, "config": {}})
                config = dashboard["config"]
                config_changed = False
                for entity_id, state in snapshot.items():
                    if entity_id in seeded_fields: continue
                    key = HELPER_CONFIG_KEYS[entity_id]
                    value = normalize_legacy_value(entity_id, state)
                    if value is None: continue
                    if key not in config:
                        config[key] = value
                        config_changed = True
                    seeded_fields.add(entity_id)
                if config_changed:
                    dashboard["revision"] = int(dashboard.get("revision", 0)) + 1
            seeded = len(seeded_fields) == len(HELPER_ENTITY_IDS)
            self.data["migration"] = {
                "legacy_helpers_found": len(snapshot), "legacy_helpers_expected": len(HELPER_ENTITY_IDS),
                "mode": "seeded_backend_authority", "helpers_deleted": False, "seeded": seeded,
                "seeded_fields": sorted(seeded_fields),
            }
            if self.data != previous_data:
                await self.store.async_save(self.data)
            return deepcopy(self.data["migration"])

    async def async_get_dashboard(self, key: str) -> dict[str, Any]:
        async with self._lock:
            dashboard = self.data["dashboards"].setdefault(key, {"revision": 0, "config": {}})
            return deepcopy(dashboard)

    async def async_peek_dashboard(self, key: str) -> dict[str, Any]:
        """Read a dashboard without creating attacker-controlled storage keys."""
        async with self._lock:
            dashboard = self.data.get("dashboards", {}).get(key, {"revision": 0, "config": {}})
            return deepcopy(dashboard)

    async def async_patch_strategy(self, key: str, patch: dict[str, Any], revision: int) -> dict[str, Any]:
        async with self._lock:
            dashboard = self.data["dashboards"].setdefault(key, {"revision": 0, "config": {}})
            if revision != dashboard["revision"]:
                return {"saved": False, "conflict": True, **deepcopy(dashboard)}
            dashboard["config"].update(deepcopy(patch))
            dashboard["revision"] += 1
            await self.store.async_save(self.data)
            return {"saved": True, **deepcopy(dashboard)}

    async def async_update_notification_status(self, delivered_by_recipient: dict[str, list[str]], health: dict[str, Any]) -> None:
        async with self._lock:
            preserved = {key: deepcopy(value) for key, value in self.data.get("notifications", {}).items() if key not in ("delivered_by_recipient", "health")}
            next_value = {**preserved, "delivered_by_recipient": {key: list(dict.fromkeys(value))[-500:] for key, value in delivered_by_recipient.items()}, "health": deepcopy(health)}
            if self.data.get("notifications") == next_value: return
            self.data["notifications"] = next_value
            await self.store.async_save(self.data)
