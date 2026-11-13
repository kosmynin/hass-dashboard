"""Pure notification helpers shared by runtime and tests."""
from __future__ import annotations
from collections.abc import Mapping
from datetime import date, datetime
import hashlib
import re
from urllib.parse import quote

MOBILE_NOTIFICATION_TAG = "smartphone_dashboard_alerts"
MOBILE_NOTIFICATION_GROUP = "smartphone_dashboard"
MOBILE_LIVE_ACTIVITY_TAG_PREFIX = "smartphone_dashboard_live"
MOBILE_MEDIA_ACTIVITY_TAG_PREFIX = "smartphone_dashboard_media"
MOBILE_DASHBOARD_PATH = "/handy/handy"
MOBILE_ACTION_PREFIX = "SMARTPHONE_DASHBOARD"
ALERT_POPUP_BY_CATEGORY = {
    "battery": "meldung-batterien",
    "contact": "meldung-kontakte",
    "co2": "meldung-co2",
    "waste": "meldung-abfall",
    "ups": "meldung-usv",
    "frost": "meldung-frost",
    "nina": "meldung-nina",
    "parcel": "meldung-pakete",
}

PARCEL_STATUS_LABELS = {
    "registered": "Registriert",
    "in_transit": "Unterwegs",
    "out_for_delivery": "In Zustellung",
    "at_pickup_point": "Abholbereit",
    "delivered": "Zugestellt",
    "returning": "Rücksendung",
    "problem": "Problem",
    "unknown": "Status unbekannt",
}

PARCEL_STATUS_PROGRESS = {
    "registered": 1,
    "in_transit": 2,
    "out_for_delivery": 3,
    "at_pickup_point": 4,
    "returning": 2,
    "problem": 2,
    "unknown": 1,
}

PARCEL_STATUS_CRITICAL_TEXT = {
    "registered": "Erfasst",
    "in_transit": "Unterwegs",
    "out_for_delivery": "Heute",
    "at_pickup_point": "Abholbereit",
    "delivered": "Zugestellt",
    "returning": "Rückweg",
    "problem": "Problem",
    "unknown": "Offen",
}

def parcel_display_label(sender: object, carrier: object = None) -> str:
    """Return a readable parcel label without scraper placeholders."""
    def clean(value: object) -> str:
        text = re.sub(r"\s+", " ", str(value or "").replace("\u200b", " ")).strip()
        placeholder = re.search(
            r"\(\s*(?:not\s+sel(?:ected)?|not\s+set|none|null|unknown|n/?a)\b",
            text,
            re.IGNORECASE,
        )
        if placeholder:
            text = text[:placeholder.start()]
        elif text.count("(") > text.count(")"):
            text = text[:text.rfind("(")]
        text = text.strip(" \t\r\n-–—·,:;()")
        return "" if text.casefold() in {
            "none", "null", "unknown", "unbekannt", "not set", "not selected", "n/a"
        } else text

    clean_sender = clean(sender)
    clean_carrier = clean(carrier)
    return clean_sender or clean_carrier or "Paket"

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

def normalized_alerts(alerts: list[Mapping[str, object]]) -> list[dict[str, object]]:
    """Return valid alerts once per fingerprint while preserving display order."""
    result: list[dict[str, object]] = []
    seen: set[str] = set()
    for alert in alerts:
        fingerprint = str(alert.get("fingerprint") or "").strip()
        message = str(alert.get("message") or "").strip()
        if not fingerprint or not message or fingerprint in seen:
            continue
        seen.add(fingerprint)
        normalized: dict[str, object] = {
            "fingerprint": fingerprint,
            "message": message,
        }
        for key in (
            "critical_text",
            "progress",
            "progress_max",
            "progress_bar_direction",
        ):
            if key in alert:
                normalized[key] = alert[key]
        result.append(normalized)
    return result

def alert_set_digest(alerts: list[Mapping[str, object]]) -> str:
    """Create a stable signature for the currently active alert set."""
    fingerprints = sorted(alert["fingerprint"] for alert in normalized_alerts(alerts))
    return hashlib.sha256("\0".join(fingerprints).encode()).hexdigest()[:32] if fingerprints else ""

def alert_content_digest(alerts: list[Mapping[str, object]]) -> str:
    """Track displayed values separately from the stable alert identity."""
    normalized = normalized_alerts(alerts)
    content = "\0".join(
        f"{alert['fingerprint']}\n{alert['message']}" for alert in normalized
    )
    return hashlib.sha256(content.encode()).hexdigest()[:32] if content else ""

def parcel_alert(
    parcel: Mapping[str, object],
    now: datetime | None = None,
) -> dict[str, object] | None:
    """Turn one canonical parcel-contract entry into a German active alert."""
    status = str(parcel.get("status") or "unknown").strip().casefold()
    if parcel.get("delivered") is True or status == "delivered":
        return None
    carrier = str(parcel.get("carrier") or "Paketdienst").strip()
    barcode = str(parcel.get("barcode") or "").strip()
    sender = str(parcel.get("sender") or "").strip()
    pickup_point = str(parcel.get("pickup_point") or "").strip()
    label = parcel_display_label(sender, carrier)
    status_label = PARCEL_STATUS_LABELS.get(status, PARCEL_STATUS_LABELS["unknown"])
    details = [status_label]
    if status == "at_pickup_point" and pickup_point:
        details.append(pickup_point)

    reference = now or datetime.now().astimezone()
    if reference.tzinfo is None:
        reference = reference.astimezone()
    reference_timezone = reference.tzinfo

    def parse_timestamp(value: object) -> datetime | None:
        if not value:
            return None
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=reference_timezone)
            return parsed.astimezone(reference_timezone)
        except (TypeError, ValueError):
            return None

    planned_from = parse_timestamp(parcel.get("planned_from"))
    planned_to = parse_timestamp(parcel.get("planned_to"))
    if planned_from:
        day_delta = (planned_from.date() - reference.date()).days
        day = (
            "heute" if day_delta == 0
            else "morgen" if day_delta == 1
            else planned_from.strftime("%d.%m.")
        )
        if planned_to and planned_to.date() == planned_from.date():
            window = f"{day} {planned_from:%H:%M}–{planned_to:%H:%M}"
        elif planned_from.hour or planned_from.minute:
            window = f"{day} {planned_from:%H:%M}"
        else:
            window = day
        details.append(window)
    identity = barcode or hashlib.sha256(
        "\0".join((carrier, sender, str(parcel.get("planned_from") or ""))).encode()
    ).hexdigest()[:16]
    progress = PARCEL_STATUS_PROGRESS.get(status, PARCEL_STATUS_PROGRESS["unknown"])
    return {
        "fingerprint": f"parcel:{carrier.casefold()}:{identity}",
        "message": f"📦 {label}: {' · '.join(details)}",
        "critical_text": PARCEL_STATUS_CRITICAL_TEXT.get(
            status, PARCEL_STATUS_CRITICAL_TEXT["unknown"]
        ),
        "progress": progress,
        "progress_max": 4,
        "progress_bar_direction": "increasing",
    }

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

def notification_recipient_token(recipient: str) -> str:
    """Return a short opaque identifier suitable for notification action IDs."""
    return hashlib.sha256(recipient.encode()).hexdigest()[:12]

def mobile_dashboard_url(recipient: str = "") -> str:
    """Open the aggregate alert popup and identify the originating device."""
    return dashboard_popup_url("meldungen", recipient)

def dashboard_popup_url(popup: str, recipient: str = "") -> str:
    """Build a Companion-safe popup link with a query fallback for fragments."""
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]*", popup):
        popup = "meldungen"
    parameters = [f"sd_popup={quote(popup, safe='')}"]
    if recipient:
        parameters.append(f"sd_recipient={notification_recipient_token(recipient)}")
    return f"{MOBILE_DASHBOARD_PATH}?{'&'.join(parameters)}#{popup}"

def alert_dashboard_url(alert: Mapping[str, object], recipient: str = "") -> str:
    """Open the detail popup matching one alert category."""
    category = str(alert.get("fingerprint") or "").partition(":")[0].casefold()
    return dashboard_popup_url(ALERT_POPUP_BY_CATEGORY.get(category, "meldungen"), recipient)

def mobile_action_ids(recipient: str, digest: str) -> dict[str, str]:
    """Build recipient- and alert-set-specific actionable notification IDs."""
    token = notification_recipient_token(recipient)
    safe_digest = re.sub(r"[^a-f0-9]", "", digest.casefold())[:32] or "none"
    return {
        "snooze": f"{MOBILE_ACTION_PREFIX}_SNOOZE_30_{token}_{safe_digest}",
        "mute": f"{MOBILE_ACTION_PREFIX}_MUTE_SET_{token}_{safe_digest}",
    }

def parse_mobile_action(action: object) -> dict[str, str] | None:
    """Parse one action created by :func:`mobile_action_ids`."""
    value = str(action or "")
    match = re.fullmatch(
        rf"{MOBILE_ACTION_PREFIX}_(SNOOZE_30|MUTE_SET)_([a-f0-9]{{12}})_([a-f0-9]{{1,32}}|none)",
        value,
    )
    if not match:
        return None
    kind, recipient_token, digest = match.groups()
    return {
        "kind": "snooze" if kind == "SNOOZE_30" else "mute",
        "recipient_token": recipient_token,
        "digest": "" if digest == "none" else digest,
    }

def mobile_notification_data(
    alert_count: int,
    passive: bool = False,
    *,
    recipient: str = "",
    digest: str = "",
) -> dict[str, object]:
    """Build replacement metadata understood by the iOS Companion app."""
    count = max(0, int(alert_count))
    subtitle = f"{count} aktive Meldung" if count == 1 else f"{count} aktive Meldungen"
    data: dict[str, object] = {
        "tag": MOBILE_NOTIFICATION_TAG,
        "group": MOBILE_NOTIFICATION_GROUP,
        "subtitle": subtitle,
        "url": mobile_dashboard_url(recipient),
        "clickAction": mobile_dashboard_url(recipient),
        "push": {
            "interruption-level": "passive" if passive else "active",
            "badge": count,
        },
    }
    if recipient:
        actions = mobile_action_ids(recipient, digest)
        data["actions"] = [
            {
                "action": "URI",
                "title": "Details",
                "uri": mobile_dashboard_url(recipient),
                "icon": "sfsymbols:list.bullet",
            },
            {
                "action": actions["snooze"],
                "title": "30 Min. stumm",
                "icon": "sfsymbols:bell.slash",
            },
            {
                "action": actions["mute"],
                "title": "Bis Änderung stumm",
                "icon": "sfsymbols:bell.slash.circle",
            },
        ]
    return data

def live_activity_message(alerts: list[Mapping[str, object]], limit: int = 4) -> str:
    """Create the compact, glanceable body used on the Lock Screen."""
    normalized = normalized_alerts(alerts)
    visible = [alert["message"] for alert in normalized[: max(1, limit)]]
    remaining = len(normalized) - len(visible)
    if remaining:
        visible.append(f"+{remaining} weitere")
    return "\n".join(visible)

def live_activity_entries(
    alerts: list[Mapping[str, object]], limit: int = 4
) -> list[dict[str, object]]:
    """Split independent alerts into independently readable Live Activities."""
    normalized = normalized_alerts(alerts)
    maximum = max(1, limit)
    if len(normalized) <= maximum:
        return normalized
    visible = normalized[: maximum - 1]
    remaining = len(normalized) - len(visible)
    return [
        *visible,
        {
            "fingerprint": f"summary:{remaining}",
            "message": f"+{remaining} weitere Meldungen – für Details öffnen",
        },
    ]

def live_activity_presentation(alert: Mapping[str, object]) -> dict[str, str]:
    """Return Bubble-Card-like icon, color and text for one Live Activity."""
    fingerprint = str(alert.get("fingerprint") or "").strip().casefold()
    message = str(alert.get("message") or "").strip()
    message = re.sub(r"^(?:🔋|🚪|💨|🗑️?|🔌|❄️?|⚠️|📦)\s*", "", message)
    category = fingerprint.partition(":")[0]
    presentations = {
        "battery": ("mdi:battery-alert", "#FF9F0A"),
        "contact": ("mdi:door-open", "#FF9F0A"),
        "co2": ("mdi:molecule-co2", "#A2AA52"),
        "ups": ("mdi:power-plug-battery", "#FF9F0A"),
        "frost": ("mdi:snowflake-alert", "#64D2FF"),
        "nina": ("mdi:alert-outline", "#FF453A"),
        "parcel": ("mdi:package-variant-closed", "#0A84FF"),
        "summary": ("mdi:bell-badge-outline", "#FF9F0A"),
    }
    if category == "parcel":
        descriptor = message.casefold()
        if "problem" in descriptor or "rücksendung" in descriptor:
            icon, color = "mdi:package-variant-remove", "#FF453A"
        elif "in zustellung" in descriptor:
            icon, color = "mdi:truck-delivery", "#30D158"
        elif "abholbereit" in descriptor:
            icon, color = "mdi:package-variant", "#FF9F0A"
        else:
            icon, color = "mdi:package-variant-closed", "#0A84FF"
    elif category == "waste":
        descriptor = message.casefold()
        if re.search(r"gelb|wertstoff|verpack", descriptor):
            icon, color = "mdi:trash-can-outline", "#FFD700"
        elif re.search(r"papier|pappe|blau", descriptor):
            icon, color = "mdi:trash-can-outline", "#4169E1"
        elif re.search(r"bio|braun|organisch", descriptor):
            icon, color = "mdi:trash-can-outline", "#8B4513"
        elif re.search(r"rest|grau", descriptor):
            icon, color = "mdi:trash-can-outline", "#8E8E93"
        else:
            icon, color = "mdi:trash-can-outline", "#FF9F0A"
    else:
        icon, color = presentations.get(
            category, ("mdi:bell-badge-outline", "#FF9F0A")
        )
    return {"message": message, "icon": icon, "color": color}

def live_activity_title(alert: Mapping[str, object]) -> str:
    """Return a short German category title for the Live Activity header."""
    category = str(alert.get("fingerprint") or "").partition(":")[0].casefold()
    return {
        "battery": "Batterie",
        "contact": "Kontakt",
        "co2": "CO₂",
        "waste": "Abfall",
        "ups": "USV",
        "frost": "Frost",
        "nina": "Warnung",
        "parcel": "Paket",
        "summary": "Meldungen",
    }.get(category, "Meldung")

def mobile_live_activity_data(
    alerts: list[Mapping[str, object]],
    *,
    tag: str = MOBILE_LIVE_ACTIVITY_TAG_PREFIX,
    silent: bool = False,
    recipient: str = "",
    critical_text: str | None = None,
    relevance_score: float | None = None,
) -> dict[str, object]:
    """Build a Home Assistant Companion Live Activity / Live Update payload."""
    normalized = normalized_alerts(alerts)
    count = len(normalized)
    urgent = any(alert["fingerprint"].startswith("nina:") for alert in normalized)
    presentation_alert = next(
        (alert for alert in normalized if alert["fingerprint"].startswith("nina:")),
        normalized[0] if normalized else {},
    )
    presentation = live_activity_presentation(presentation_alert)
    destination = alert_dashboard_url(presentation_alert, recipient)
    color = presentation["color"]
    fingerprint = str(presentation_alert.get("fingerprint") or "")
    critical = str(
        presentation_alert.get("critical_text") or critical_text or count
    )
    data: dict[str, object] = {
        "tag": tag,
        "live_update": True,
        "critical_text": critical,
        "notification_icon": presentation["icon"],
        "notification_icon_color": color,
        "color": color,
        "background_color": "#101820" if fingerprint.startswith("parcel:") else "#1C1C1E",
        "text_color": "#FFFFFF",
        "relevance_score": relevance_score if relevance_score is not None else (1.0 if urgent else 0.8),
        "sticky": True,
        "alert_once": silent,
        "url": destination,
        "clickAction": destination,
    }
    try:
        progress = int(presentation_alert.get("progress"))
        progress_max = int(presentation_alert.get("progress_max"))
    except (TypeError, ValueError):
        progress = progress_max = 0
    if progress_max > 0:
        data.update({
            "progress": min(progress_max, max(0, progress)),
            "progress_max": progress_max,
            "progress_bar_color": color,
            "progress_bar_direction": str(
                presentation_alert.get("progress_bar_direction") or "increasing"
            ),
        })
    if silent:
        data["silent"] = True
    return data

def mobile_clear_data() -> dict[str, object]:
    """Build the iOS payload that clears the replaced aggregate notification."""
    return {
        "tag": MOBILE_NOTIFICATION_TAG,
        "group": MOBILE_NOTIFICATION_GROUP,
        "push": {"badge": 0},
    }

def mobile_live_clear_data(tag: str = MOBILE_LIVE_ACTIVITY_TAG_PREFIX) -> dict[str, object]:
    """Build the payload that ends the current Live Activity / Live Update."""
    return {"tag": tag}

def media_activity_presentation(
    entity_id: str,
    player_name: object,
    attributes: Mapping[str, object],
) -> dict[str, str]:
    """Create a concise media-player Live Activity presentation."""
    name = str(player_name or attributes.get("friendly_name") or entity_id).strip()
    title = str(
        attributes.get("media_title")
        or attributes.get("media_series_title")
        or attributes.get("media_channel")
        or attributes.get("app_name")
        or "Wiedergabe aktiv"
    ).strip()
    detail_parts = [
        str(attributes.get(key) or "").strip()
        for key in ("media_artist", "media_album_name")
    ]
    details = [part for part in detail_parts if part and part.casefold() != title.casefold()]
    message = " · ".join(dict.fromkeys([title, *details]))
    content_type = " ".join((
        str(attributes.get("media_content_type") or ""),
        str(attributes.get("app_name") or ""),
    )).casefold()
    configured_icon = str(attributes.get("icon") or "").strip()
    if configured_icon.startswith("mdi:"):
        icon = configured_icon
    elif "podcast" in content_type:
        icon = "mdi:podcast"
    elif re.search(r"radio|channel", content_type):
        icon = "mdi:radio"
    elif re.search(r"movie|video|tv|episode", content_type):
        icon = "mdi:television-play"
    elif re.search(r"music|audio|track", content_type):
        icon = "mdi:music"
    else:
        icon = "mdi:speaker-play"
    identity = "\0".join((
        entity_id,
        name,
        title,
        *details,
        str(attributes.get("media_content_id") or ""),
        str(attributes.get("app_name") or ""),
    ))
    return {
        "entity_id": entity_id,
        "title": name,
        "message": message,
        "icon": icon,
        "color": "#5E5CE6",
        "digest": hashlib.sha256(identity.encode()).hexdigest()[:24],
    }

def media_live_activity_tag(entity_id: str, generation: int = 0) -> str:
    """Return a short, stable and entity-specific media Live Activity tag."""
    token = hashlib.sha256(entity_id.encode()).hexdigest()[:12]
    return f"{MOBILE_MEDIA_ACTIVITY_TAG_PREFIX}_{token}_{generation % 2}"

def media_dashboard_url(entity_id: str, media_hash: str = "#medien") -> str:
    """Open the media popup with the originating player selected as its remote."""
    if not re.fullmatch(r"media_player\.[a-zA-Z0-9_]+", entity_id):
        entity_id = ""
    if not re.fullmatch(r"#[a-zA-Z0-9][a-zA-Z0-9_-]*", media_hash):
        media_hash = "#medien"
    parameters = [f"sd_popup={quote(media_hash.removeprefix('#'), safe='')}"]
    if entity_id:
        parameters.append(f"sd_media={quote(entity_id, safe='')}")
    return f"{MOBILE_DASHBOARD_PATH}?{'&'.join(parameters)}{media_hash}"

def mobile_media_activity_data(
    entry: Mapping[str, object],
    *,
    tag: str,
    silent: bool = False,
) -> dict[str, object]:
    """Build the Companion payload for one active media player."""
    url = str(entry.get("url") or f"{MOBILE_DASHBOARD_PATH}#medien")
    color = str(entry.get("color") or "#5E5CE6")
    data: dict[str, object] = {
        "tag": tag,
        "live_update": True,
        "critical_text": "▶",
        "notification_icon": str(entry.get("icon") or "mdi:speaker-play"),
        "notification_icon_color": color,
        "color": color,
        "background_color": "#1C1C1E",
        "text_color": "#FFFFFF",
        "relevance_score": 0.45,
        "sticky": True,
        "alert_once": silent,
        "url": url,
        "clickAction": url,
    }
    if silent:
        data["silent"] = True
    return data

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
    parts = [
        part.strip()
        for item in values
        for part in re.split(r"\s*[,;]\s*", str(item or ""))
        if part.strip()
    ]
    names: list[str] = []
    seen: set[str] = set()
    for part in parts:
        name = re.sub(
            r"\s*[-–—]?\s*(?:alle\s*)?(?:(?:2|4|zwei|vier)\s*[- ]?\s*)?w(?:ö|oe|o)chentlich\b.*$",
            "",
            part,
            flags=re.IGNORECASE,
        )
        name = re.sub(
            r"^\s*(?:(?:heute|morgen|today|tomorrow)\s+)?(?:wird|werden)\s+",
            "",
            name,
            flags=re.IGNORECASE,
        )
        name = re.sub(
            r"\s+(?:(?:wird|werden)\s+)?(?:(?:heute|morgen|today|tomorrow|in\s+\d+\s+(?:days?|tag(?:e|en)?))\s+)?(?:abgeholt|geleert|gesammelt|collected|emptied)\s*[.!?]*$",
            "",
            name,
            flags=re.IGNORECASE,
        )
        name = re.sub(
            r"^\s*(?:abholung|leerung)\s*(?:von\s+)?[:\-–—]?\s*",
            "",
            name,
            flags=re.IGNORECASE,
        )
        name = re.sub(
            r"\s*[-–—]?\s*(?:abholung|leerung)\s*[.!?]*$",
            "",
            name,
            flags=re.IGNORECASE,
        ).strip(" .,!?:;-–—/")
        name = re.split(r"\s*/\s*", name, maxsplit=1)[0].strip()
        if re.search(r"gelb", name, flags=re.IGNORECASE) and re.search(
            r"tonne|container|wertstoff|verpack", name, flags=re.IGNORECASE
        ):
            name = "Gelbe Tonne"
        key = name.casefold()
        if name and key not in seen:
            seen.add(key)
            names.append(name)
    return ", ".join(names)

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
    metadata = {
        "attribution", "last_update", "daysTo", "days_to", "icon", "upcoming",
        "date", "next_date", "start", "start_time", "type", "waste_type",
        "summary", "subject", "types", "friendly_name",
    }
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
    waste_type = _waste_types(waste_type) or "Abfall"

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
