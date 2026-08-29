"""Dependency-free storage migration helpers."""
from __future__ import annotations
from copy import deepcopy
import re
from typing import Any

DEFAULT_DATA: dict[str, Any] = {
    "schema": 22,
    "dashboards": {},
    "legacy_helpers": {},
    "migration": {},
    "notifications": {"delivered_by_recipient": {}, "health": {}},
}
NINA_GLOB_RE = re.compile(r"^binary_sensor\.[a-zA-Z0-9_]+\*[a-zA-Z0-9_]*$")
NINA_ENTITY_RE = re.compile(r"^binary_sensor\.[a-zA-Z0-9_]+$")

def safe_revision(value: Any) -> int:
    try:
        revision = int(value)
    except (TypeError, ValueError, OverflowError):
        return 0
    return max(0, revision)

def migrate_store_data(old_major_version: int, old_data: Any) -> dict[str, Any]:
    """Migrate actual v1/v2 layouts without discarding unrelated data."""
    source = deepcopy(old_data) if isinstance(old_data, dict) else {}
    migrated = deepcopy(DEFAULT_DATA)
    migrated.update(source)
    migrated["schema"] = 22
    dashboards = migrated.get("dashboards")
    if not isinstance(dashboards, dict):
        dashboards = {}
    strategy = source.get("strategy")
    if isinstance(strategy, dict):
        dashboards.setdefault("default", {"revision": safe_revision(source.get("revision", 0)), "config": deepcopy(strategy)})
    migrated["dashboards"] = dashboards
    migrated.pop("strategy", None)
    migrated.pop("revision", None)
    notifications = source.get("notifications")
    if not isinstance(notifications, dict):
        notifications = {}
    delivered_by_recipient = notifications.get("delivered_by_recipient")
    if not isinstance(delivered_by_recipient, dict):
        delivered_by_recipient = {}
    legacy_delivered = notifications.get("delivered", [])
    if isinstance(legacy_delivered, list) and legacy_delivered:
        recipients = []
        if isinstance(strategy, dict):
            recipients = [item.strip() for item in str(strategy.get("notification_recipients", "")).split(",") if item.strip().startswith("notify.")]
        for recipient in recipients:
            delivered_by_recipient.setdefault(recipient, deepcopy(legacy_delivered))
    migrated["notifications"] = {
        **notifications,
        "delivered_by_recipient": deepcopy(delivered_by_recipient),
        "health": deepcopy(notifications.get("health", {})) if isinstance(notifications.get("health", {}), dict) else {},
    }
    if isinstance(legacy_delivered, list) and legacy_delivered:
        migrated["notifications"]["legacy_delivered"] = deepcopy(legacy_delivered)
    migrated["notifications"].pop("delivered", None)
    return migrated

def normalize_legacy_value(entity_id: str, state: str) -> Any:
    """Return a safe imported helper value, or None for unavailable/invalid."""
    if state in ("unknown", "unavailable"):
        return None
    if entity_id.startswith("input_boolean."):
        return state == "on" if state in ("on", "off") else None
    if entity_id.startswith("input_number."):
        try:
            value = float(state)
        except (TypeError, ValueError):
            return None
        return value if value == value and value not in (float("inf"), float("-inf")) else None
    if entity_id == "input_text.smartphone_nina_muster":
        value = state.strip()
        if NINA_ENTITY_RE.fullmatch(value):
            value += "*"
        return value if NINA_GLOB_RE.fullmatch(value) else "binary_sensor.nina_warning_*"
    return state
