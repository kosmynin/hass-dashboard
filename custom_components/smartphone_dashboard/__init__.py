"""Smartphone Dashboard integration."""
from __future__ import annotations
from typing import Any
import json
import fnmatch
import math
import re
import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.auth.permissions.const import POLICY_READ
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from .config_manager import ConfigManager
from .notification import NotificationCoordinator
from .const import DOMAIN, FRONTEND_DIR, MODULE_URL, STATIC_URL, VERSION

async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    """Register authenticated backend API and the embedded frontend."""
    await hass.http.async_register_static_paths([StaticPathConfig(STATIC_URL, str(FRONTEND_DIR), False)])
    add_extra_js_url(hass, MODULE_URL)
    websocket_api.async_register_command(hass, websocket_get_config)
    websocket_api.async_register_command(hass, websocket_get_display_config)
    websocket_api.async_register_command(hass, websocket_save_config)
    websocket_api.async_register_command(hass, websocket_import_legacy)
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    manager = ConfigManager(hass)
    await manager.async_load()
    coordinator = NotificationCoordinator(hass, manager)
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = {"manager": manager, "coordinator": coordinator}
    await coordinator.async_start()
    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    runtime = hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    if runtime:
        await runtime["coordinator"].async_stop()
    return True

def _manager(hass: HomeAssistant) -> ConfigManager | None:
    managers = hass.data.get(DOMAIN, {})
    if not managers:
        return None
    return next(iter(managers.values()))["manager"]

def _valid_config(value: dict[str, Any]) -> dict[str, Any]:
    if len(json.dumps(value, ensure_ascii=False)) > 65536:
        raise vol.Invalid("Konfiguration ist größer als 64 KiB")
    def depth(item: Any, level: int = 0) -> None:
        if level > 12: raise vol.Invalid("Konfiguration ist zu tief verschachtelt")
        if isinstance(item, dict):
            if not all(isinstance(key, str) for key in item): raise vol.Invalid("Schlüssel müssen Text sein")
            for child in item.values(): depth(child, level + 1)
        elif isinstance(item, list):
            for child in item: depth(child, level + 1)
        elif isinstance(item, float) and not math.isfinite(item):
            raise vol.Invalid("Nicht endliche Zahlen sind nicht erlaubt")
        elif item is not None and not isinstance(item, (str, int, float, bool)):
            raise vol.Invalid("Nicht unterstützter Wert")
    depth(value)
    numeric_ranges = {"battery_threshold": (1, 100), "contact_minutes": (1, 1440), "co2_threshold": (400, 5000), "frost_threshold": (-30, 20), "max_columns": (1, 4)}
    for key, (minimum, maximum) in numeric_ranges.items():
        if key in value and (isinstance(value[key], bool) or not isinstance(value[key], (int, float)) or not math.isfinite(value[key]) or not minimum <= value[key] <= maximum): raise vol.Invalid(f"{key} ist außerhalb des gültigen Bereichs")
    boolean_keys = ("notification_batteries", "notification_contacts", "notification_co2", "notification_waste", "notification_ups", "notification_frost", "notification_nina")
    for key in boolean_keys:
        if key in value and not isinstance(value[key], bool): raise vol.Invalid(f"{key} muss ein Wahrheitswert sein")
    if "nina_entities" in value and (not isinstance(value["nina_entities"], str) or not re.fullmatch(r"binary_sensor\.[a-zA-Z0-9_]+\*[a-zA-Z0-9_]*", value["nina_entities"])): raise vol.Invalid("nina_entities ist ungültig")
    if "notification_recipients" in value and any(not re.fullmatch(r"notify\.[a-z0-9_]+", item.strip()) for item in str(value["notification_recipients"]).split(",") if item.strip()): raise vol.Invalid("Notify-Dienst ist ungültig")
    for key in ("persons", "rooms", "quick_actions", "home_sections"):
        if key in value and not isinstance(value[key], list): raise vol.Invalid(f"{key} muss eine Liste sein")
    entity_id = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
    for key in ("frost_entity",):
        if key in value and value[key] and (not isinstance(value[key], str) or not entity_id.fullmatch(value[key])): raise vol.Invalid(f"{key} enthält keine gültige Entity-ID")
    for key in ("battery_exclusions", "waste_entities", "ups_entities"):
        if key not in value: continue
        items = value[key] if isinstance(value[key], list) else str(value[key]).split(",")
        if any(not isinstance(item, str) or not entity_id.fullmatch(item.strip()) for item in items if str(item).strip()): raise vol.Invalid(f"{key} enthält eine ungültige Entity-ID")
    if "quick_actions" in value:
        for item in value["quick_actions"]:
            candidate = item.get("entity") if isinstance(item, dict) else item
            if not isinstance(candidate, str) or not re.fullmatch(r"script\.[a-z0-9_]+", candidate): raise vol.Invalid("quick_actions enthält eine ungültige Script-Entity")
    if "persons" in value:
        for person in value["persons"]:
            if not isinstance(person, dict) or not entity_id.fullmatch(str(person.get("entity", ""))) or not str(person["entity"]).startswith("person."):
                raise vol.Invalid("persons enthält einen ungültigen Eintrag")
            travel = person.get("travel_sensor")
            if travel and (not isinstance(travel, str) or not entity_id.fullmatch(travel)): raise vol.Invalid("travel_sensor ist ungültig")
    if "rooms" in value:
        for room in value["rooms"]:
            if not isinstance(room, dict) or not isinstance(room.get("area_id"), str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", room["area_id"]): raise vol.Invalid("rooms enthält einen ungültigen Eintrag")
            light = room.get("main_light")
            if light and (not isinstance(light, str) or not re.fullmatch(r"light\.[a-z0-9_]+", light)): raise vol.Invalid("main_light ist ungültig")
            hidden = room.get("hidden_entities", [])
            if not isinstance(hidden, list) or any(not isinstance(item, str) or not entity_id.fullmatch(item) for item in hidden): raise vol.Invalid("hidden_entities ist ungültig")
    if "home_sections" in value and any(not isinstance(item, str) for item in value["home_sections"]): raise vol.Invalid("home_sections enthält ungültige Einträge")
    def validate_entity_arrays(item: Any) -> None:
        if isinstance(item, dict):
            for key, child in item.items():
                if key in ("entities", "manual_entities", "excluded_entities"):
                    if not isinstance(child, list) or any(not isinstance(entity, str) or not entity_id.fullmatch(entity) for entity in child): raise vol.Invalid(f"{key} enthält eine ungültige Entity-ID")
                else: validate_entity_arrays(child)
        elif isinstance(item, list):
            for child in item: validate_entity_arrays(child)
    if "features" in value and not isinstance(value["features"], dict): raise vol.Invalid("features muss ein Objekt sein")
    features = value.get("features", {})
    css_color = re.compile(r"^(?:#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(?:rgb|rgba|hsl|hsla)\([-+0-9.% ,/]+\)|var\(--[a-zA-Z0-9_-]+\)|transparent|black|white|red|green|blue|orange|yellow|gray|grey)$")
    for feature_name, feature in features.items():
        if not isinstance(feature_name, str) or not isinstance(feature, dict): raise vol.Invalid("features enthält einen ungültigen Eintrag")
        for bool_key in ("enabled", "auto_discover"):
            if bool_key in feature and not isinstance(feature[bool_key], bool): raise vol.Invalid(f"{feature_name}.{bool_key} muss ein Wahrheitswert sein")
        for text_key in ("icon", "hash", "title"):
            if text_key in feature and not isinstance(feature[text_key], str): raise vol.Invalid(f"{feature_name}.{text_key} muss Text sein")
        for list_key in ("printer_ids", "excluded_printer_ids"):
            if list_key in feature and (not isinstance(feature[list_key], list) or any(not isinstance(item, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", item) for item in feature[list_key])): raise vol.Invalid(f"{list_key} ist ungültig")
        if "system_colors" in feature:
            colors = feature["system_colors"]
            if not isinstance(colors, dict) or any(not isinstance(key, str) or not isinstance(color, str) or not css_color.fullmatch(color.strip()) for key, color in colors.items()): raise vol.Invalid("system_colors ist ungültig")
        if "system_groups" in feature:
            groups = feature["system_groups"]
            if not isinstance(groups, list): raise vol.Invalid("system_groups muss eine Liste sein")
            for group in groups:
                if not isinstance(group, dict) or any(not isinstance(group.get(key, ""), str) for key in ("id", "name", "icon", "pattern")): raise vol.Invalid("system_groups enthält einen ungültigen Eintrag")
                try: re.compile(group.get("pattern", ""))
                except re.error as err: raise vol.Invalid("system_groups enthält einen ungültigen regulären Ausdruck") from err
    validate_entity_arrays(features)
    return value

def _valid_key(value: str) -> str:
    if not re.fullmatch(r"[a-zA-Z0-9_.:-]{1,128}", value): raise vol.Invalid("dashboard_key ist ungültig")
    return value

PUBLIC_NOTIFICATION_TYPES = {
    "notification_batteries": bool, "notification_contacts": bool, "notification_co2": bool,
    "notification_waste": bool, "notification_ups": bool, "notification_frost": bool,
    "notification_nina": bool, "battery_threshold": (int, float),
    "contact_minutes": (int, float), "co2_threshold": (int, float), "frost_threshold": (int, float),
}
DISPLAY_ENTITY_LISTS = ("battery_exclusions", "waste_entities", "ups_entities")
NINA_GLOB_RE = re.compile(r"^binary_sensor\.[a-zA-Z0-9_]+\*[a-zA-Z0-9_]*$")

def _public_notification_config(config: Any, existing_entities: set[str], can_read) -> dict[str, Any]:
    if not isinstance(config, dict): return {}
    result = {}
    for key, expected in PUBLIC_NOTIFICATION_TYPES.items():
        value = config.get(key)
        if isinstance(value, expected) and not (isinstance(value, bool) and expected != bool) and (not isinstance(value, float) or math.isfinite(value)):
            result[key] = value
    for key in DISPLAY_ENTITY_LISTS:
        raw = config.get(key, "")
        values = raw if isinstance(raw, list) else str(raw).split(",")
        allowed = [entity_id for item in values if isinstance(item, str) and (entity_id := item.strip()) in existing_entities and can_read(entity_id)]
        result[key] = ",".join(dict.fromkeys(allowed))
    frost_entity = config.get("frost_entity", "")
    result["frost_entity"] = frost_entity if isinstance(frost_entity, str) and frost_entity in existing_entities and can_read(frost_entity) else ""
    nina_pattern = config.get("nina_entities", "")
    matches = [entity_id for entity_id in existing_entities if isinstance(nina_pattern, str) and NINA_GLOB_RE.fullmatch(nina_pattern) and fnmatch.fnmatchcase(entity_id, nina_pattern)]
    if matches and all(can_read(entity_id) for entity_id in matches):
        result["nina_entities"] = nina_pattern
    else:
        result["notification_nina"] = False
        result["nina_entities"] = "binary_sensor.__smartphone_dashboard_no_access_*"
    return result

@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/config/display", vol.Required("dashboard_key"): vol.In(["default"])})
@websocket_api.async_response
async def websocket_get_display_config(hass, connection, msg):
    """Return only non-sensitive display settings to an authenticated user."""
    manager = _manager(hass)
    if manager is None:
        connection.send_error(msg["id"], "not_loaded", "Integration ist nicht eingerichtet")
        return
    dashboard = await manager.async_peek_dashboard("default")
    existing_entities = set(hass.states.async_entity_ids())
    permissions = connection.user.permissions
    can_read = lambda entity_id: connection.user.is_admin or permissions.access_all_entities(POLICY_READ) or permissions.check_entity(entity_id, POLICY_READ)
    connection.send_result(msg["id"], {"config": _public_notification_config(dashboard.get("config"), existing_entities, can_read)})

@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/config/get", vol.Required("dashboard_key"): _valid_key})
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_get_config(hass, connection, msg):
    manager = _manager(hass)
    if manager is None:
        connection.send_error(msg["id"], "not_loaded", "Integration ist nicht eingerichtet")
        return
    dashboard = await manager.async_get_dashboard(msg["dashboard_key"])
    connection.send_result(msg["id"], {"version": VERSION, **dashboard, "migration": manager.data.get("migration", {}), "notifications": manager.data.get("notifications", {})})

@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/config/save", vol.Required("dashboard_key"): _valid_key, vol.Required("revision"): vol.Coerce(int), vol.Required("patch"): vol.All(dict, _valid_config)})
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_save_config(hass, connection, msg):
    manager = _manager(hass)
    if manager is None:
        connection.send_error(msg["id"], "not_loaded", "Integration ist nicht eingerichtet"); return
    connection.send_result(msg["id"], await manager.async_patch_strategy(msg["dashboard_key"], msg["patch"], msg["revision"]))

@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/migration/import_legacy"})
@websocket_api.require_admin
@websocket_api.async_response
async def websocket_import_legacy(hass, connection, msg):
    manager = _manager(hass)
    if manager is None:
        connection.send_error(msg["id"], "not_loaded", "Integration ist nicht eingerichtet"); return
    connection.send_result(msg["id"], await manager.async_import_legacy_helpers())
