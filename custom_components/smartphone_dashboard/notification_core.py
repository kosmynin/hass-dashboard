"""Pure notification helpers shared by runtime and tests."""
from __future__ import annotations
from collections.abc import Mapping
from datetime import date, datetime
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
