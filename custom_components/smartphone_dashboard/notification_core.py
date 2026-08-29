"""Pure notification helpers shared by runtime and tests."""
from __future__ import annotations
import re

UPS_NORMAL_STATES = frozenset((
    "online", "on", "ok", "normal", "ol", "connected", "available", "mains", "line",
))
UPS_IGNORED_STATES = frozenset(("", "unknown", "unavailable", "none"))
UPS_PROBLEM_DEVICE_CLASSES = frozenset(("problem", "safety", "smoke", "tamper", "moisture"))

def valid_nina_glob(value: str) -> bool:
    return bool(re.fullmatch(r"binary_sensor\.[a-zA-Z0-9_]+\*[a-zA-Z0-9_]*", value))

def ups_state_is_alert(entity_id: str, state: object, device_class: object = None) -> bool:
    """Interpret common UPS status and binary sensor conventions consistently."""
    normalized = str(state).strip().lower()
    if normalized in UPS_IGNORED_STATES:
        return False
    if entity_id.startswith("binary_sensor."):
        if normalized not in ("on", "off"):
            return False
        problem_sensor = str(device_class or "").strip().lower() in UPS_PROBLEM_DEVICE_CLASSES
        return normalized == ("on" if problem_sensor else "off")
    return normalized not in UPS_NORMAL_STATES

def pending_fingerprints(active: list[str], delivered: list[str]) -> list[str]:
    seen = set(delivered)
    return [fingerprint for fingerprint in dict.fromkeys(active) if fingerprint not in seen]

def retained_fingerprints(active: list[str], delivered: list[str], successful: list[str]) -> list[str]:
    keep = set(delivered) | set(successful)
    return [fingerprint for fingerprint in dict.fromkeys(active) if fingerprint in keep]
