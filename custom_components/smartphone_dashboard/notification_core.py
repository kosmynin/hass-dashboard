"""Pure notification helpers shared by runtime and tests."""
from __future__ import annotations
from collections.abc import Mapping
from datetime import date, datetime
import hashlib
import re

MOBILE_NOTIFICATION_TAG = "smartphone_dashboard_alerts"
MOBILE_NOTIFICATION_GROUP = "smartphone_dashboard"

UPS_NORMAL_STATES = frozenset((
    "online", "on", "ok", "normal", "ol", "connected", "available", "mains", "line",
))
UPS_IGNORED_STATES = frozenset(("", "unknown", "unavailable", "none"))
UPS_PROBLEM_DEVICE_CLASSES = frozenset(("problem", "safety", "smoke", "tamper", "moisture"))
UPS_HISTORY_DEVICE_CLASSES = frozenset(("date", "timestamp"))
BATTERY_VOLTAGE_UNITS = frozenset(("v", "mv", "kv"))

def dashboard_entity_enabled(
    disabled_by: object = None,
    hidden_by: object = None,
    state_hidden: object = False,
    *,
    allow_hidden: bool = False,
) -> bool:
    """Apply the common dashboard/notification visibility policy."""
    if disabled_by:
        return False
    return allow_hidden or not hidden_by and state_hidden is not True

def is_battery_level_sensor(entity_id: str, attributes: Mapping[str, object]) -> bool:
    """Identify battery percentages while rejecting battery-voltage sensors."""
    device_class = str(attributes.get("device_class") or "").strip().lower()
    unit = str(attributes.get("unit_of_measurement") or "").strip().lower().replace(" ", "")
    descriptor = " ".join((
        entity_id,
        str(attributes.get("friendly_name") or ""),
        str(attributes.get("name") or ""),
    )).casefold()
    battery_voltage = re.search(
        r"(?:battery|batterie|akku).{0,12}(?:voltage|spannung)|(?:voltage|spannung).{0,12}(?:battery|batterie|akku)",
        descriptor,
    )
    if device_class == "voltage" or unit in BATTERY_VOLTAGE_UNITS or battery_voltage:
        return False
    named_battery = bool(re.search(r"battery|batterie", entity_id, re.IGNORECASE))
    return device_class == "battery" or (named_battery and unit in ("", "%", "percent"))

def normalized_alerts(alerts: list[Mapping[str, object]]) -> list[dict[str, str]]:
    """Return valid alerts once per fingerprint while preserving display order."""
    result: list[dict[str, str]] = []
    seen: set[str] = set()
    for alert in alerts:
        fingerprint = str(alert.get("fingerprint") or "").strip()
        message = str(alert.get("message") or "").strip()
        if not fingerprint or not message or fingerprint in seen:
            continue
        seen.add(fingerprint)
        result.append({"fingerprint": fingerprint, "message": message})
    return result

def alert_set_digest(alerts: list[Mapping[str, object]]) -> str:
    """Create a stable signature for the currently active alert set."""
    fingerprints = sorted(alert["fingerprint"] for alert in normalized_alerts(alerts))
    return hashlib.sha256("\0".join(fingerprints).encode()).hexdigest()[:32] if fingerprints else ""

def aggregate_alert_message(
    alerts: list[Mapping[str, object]],
    bullet: str = "• ",
    max_characters: int | None = None,
) -> str:
    """Format one readable aggregate and optionally limit mobile payload size."""
    message = "\n".join(f"{bullet}{alert['message']}" for alert in normalized_alerts(alerts))
    if not max_characters or len(message) <= max_characters:
        return message
    shortened = message[: max(1, max_characters - 2)].rsplit("\n", 1)[0].rstrip()
    return f"{shortened}\n…" if shortened else "…"

def mobile_notification_data(alert_count: int, passive: bool = False) -> dict[str, object]:
    """Build replacement metadata understood by the iOS Companion app."""
    count = max(0, int(alert_count))
    subtitle = f"{count} aktive Meldung" if count == 1 else f"{count} aktive Meldungen"
    return {
        "tag": MOBILE_NOTIFICATION_TAG,
        "group": MOBILE_NOTIFICATION_GROUP,
        "subtitle": subtitle,
        "push": {
            "interruption-level": "passive" if passive else "active",
            "badge": count,
        },
    }

def mobile_clear_data() -> dict[str, object]:
    """Build the iOS payload that clears the replaced aggregate notification."""
    return {
        "tag": MOBILE_NOTIFICATION_TAG,
        "group": MOBILE_NOTIFICATION_GROUP,
        "push": {"badge": 0},
    }

def area_entity_label(
    area_name: object,
    entity_name: object,
    device_name: object = None,
    entity_id: object = "",
) -> str:
    """Build a concise area/entity label without repeating the device name."""
    area = str(area_name or "").strip()
    name = str(entity_name or "").strip()
    device = str(device_name or "").strip()
    if not name:
        raw_id = str(entity_id or "")
        name = raw_id.split(".", 1)[-1].replace("_", " ").strip() or raw_id
    for prefix in (device, area):
        if prefix and name.casefold().startswith(f"{prefix} ".casefold()):
            name = name[len(prefix):].strip()
    if area and name.casefold() != area.casefold():
        return f"{area} · {name}"
    return name or area or str(entity_id or "")

def valid_nina_glob(value: str) -> bool:
    return bool(re.fullmatch(r"binary_sensor\.[a-zA-Z0-9_]+\*[a-zA-Z0-9_]*", value))

def ups_state_is_alert(entity_id: str, state: object, device_class: object = None, friendly_name: object = None) -> bool:
    """Interpret common UPS status and binary sensor conventions consistently."""
    normalized = str(state).strip().lower()
    if normalized in UPS_IGNORED_STATES:
        return False
    normalized_device_class = str(device_class or "").strip().lower()
    if normalized_device_class in UPS_HISTORY_DEVICE_CLASSES:
        return False
    if re.match(r"^\d{4}-\d{2}-\d{2}(?:[T ]|$)", normalized):
        return False
    descriptor = f"{entity_id} {friendly_name or ''}".lower()
    if re.search(r"(?:umschaltung|letzte[rs]?|last).{0,32}(?:batter|netz|mains|switch)", descriptor):
        return False
    if entity_id.startswith("binary_sensor."):
        if normalized not in ("on", "off"):
            return False
        problem_sensor = normalized_device_class in UPS_PROBLEM_DEVICE_CLASSES
        return normalized == ("on" if problem_sensor else "off")
    return normalized not in UPS_NORMAL_STATES

def _waste_date(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value or "").strip()
    match = re.match(r"^(\d{4})-(\d{2})-(\d{2})", text)
    if match:
        try:
            return date(*(int(part) for part in match.groups()))
        except ValueError:
            return None
    match = re.search(r"(?:^|\D)(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\D|$)", text)
    if match:
        try:
            day, month, year = (int(part) for part in match.groups())
            return date(year, month, day)
        except ValueError:
            return None
    return None

def _waste_types(value: object) -> str:
    values = value if isinstance(value, (list, tuple, set)) else [value]
    return ", ".join(str(item).strip() for item in values if str(item or "").strip())

def waste_collection_details(
    state: object,
    attributes: Mapping[str, object] | None = None,
    fallback_name: str = "Abfall",
    today: date | None = None,
) -> dict[str, object]:
    """Normalize common Waste Collection Schedule sensor formats."""
    attrs = attributes or {}
    reference_date = today or date.today()
    state_text = str(state or "").strip()
    dated: list[tuple[date, str]] = []
    metadata = {"attribution", "last_update", "daysTo", "days_to", "icon", "upcoming"}
    for key, value in attrs.items():
        if key in metadata:
            continue
        key_date = _waste_date(key)
        value_date = _waste_date(value)
        if key_date:
            dated.append((key_date, _waste_types(value)))
        elif value_date:
            dated.append((value_date, str(key).strip()))
    dated.sort(key=lambda item: item[0])

    upcoming = attrs.get("upcoming")
    first_upcoming = upcoming[0] if isinstance(upcoming, (list, tuple)) and upcoming and isinstance(upcoming[0], Mapping) else {}
    pickup_date = (
        _waste_date(first_upcoming.get("date"))
        or _waste_date(attrs.get("date"))
        or _waste_date(attrs.get("next_date"))
        or _waste_date(attrs.get("start"))
        or _waste_date(attrs.get("start_time"))
        or (dated[0][0] if dated else None)
    )
    waste_type = _waste_types(
        first_upcoming.get("types")
        or (dated[0][1] if dated else None)
        or attrs.get("type")
        or attrs.get("waste_type")
        or attrs.get("summary")
        or attrs.get("subject")
        or attrs.get("types")
    )
    if not waste_type and not re.fullmatch(r"-?\d+(?:\.\d+)?", state_text):
        waste_type = re.sub(
            r"\s+in\s+-?\d+\s+(?:days?|tag(?:e|en)?)(?:\s.*)?$",
            "",
            state_text,
            flags=re.IGNORECASE,
        )
        waste_type = re.sub(r"(?:^|\s)(?:heute|morgen|today|tomorrow)(?:\s|$)", " ", waste_type, flags=re.IGNORECASE).strip()
    if not waste_type:
        waste_type = re.sub(r"^Waste Collection Schedule\s*", "", fallback_name, flags=re.IGNORECASE).strip() or "Abfall"

    days: int | None = None
    raw_days = first_upcoming.get("daysTo", attrs.get("daysTo", attrs.get("days_to")))
    try:
        days = int(raw_days) if raw_days is not None else None
    except (TypeError, ValueError):
        pass
    if pickup_date:
        days = (pickup_date - reference_date).days
    if days is None:
        match = re.search(r"\bin\s+(-?\d+)\s+(?:days?|tag(?:e|en)?)\b", state_text, flags=re.IGNORECASE)
        if match:
            days = int(match.group(1))
        elif re.fullmatch(r"-?\d+", state_text):
            days = int(state_text)
        elif re.search(r"\b(?:heute|today)\b", state_text, flags=re.IGNORECASE):
            days = 0
        elif re.search(r"\b(?:morgen|tomorrow)\b", state_text, flags=re.IGNORECASE):
            days = 1

    if pickup_date:
        formatted = pickup_date.strftime("%d.%m.")
        date_label = f"heute · {formatted}" if days == 0 else f"morgen · {formatted}" if days == 1 else formatted
    elif days is not None:
        date_label = "heute" if days == 0 else "morgen" if days == 1 else f"in {days} Tagen"
    else:
        date_label = state_text if state_text.lower() not in ("", "unknown", "unavailable") else "Kein Termin verfügbar"
    return {
        "type": waste_type,
        "date": pickup_date.isoformat() if pickup_date else "",
        "date_label": date_label,
        "days": days,
    }

def pending_fingerprints(active: list[str], delivered: list[str]) -> list[str]:
    seen = set(delivered)
    return [fingerprint for fingerprint in dict.fromkeys(active) if fingerprint not in seen]

def retained_fingerprints(active: list[str], delivered: list[str], successful: list[str]) -> list[str]:
    keep = set(delivered) | set(successful)
    return [fingerprint for fingerprint in dict.fromkeys(active) if fingerprint in keep]
