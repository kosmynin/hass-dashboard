"""Transient Companion notifications for a physical Reolink visitor button."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable

    from homeassistant.core import State
    from homeassistant.helpers.entity_registry import RegistryEntry


def is_doorbell_press(old: State | None, new: State | None) -> bool:
    """Ignore initial, restored, disconnected and attribute-only state updates."""
    return bool(
        old and old.state == "off" and not old.attributes.get("restored")
        and new and new.state == "on" and not new.attributes.get("restored")
    )


def doorbell_camera(
    entries: Iterable[RegistryEntry], get_state: Callable[[str], State | None]
) -> str | None:
    """Choose a live Reolink stream from the ringing device, preferring Fluent."""
    profiles = ("sub", "ext", "main")
    candidates = []
    for entry in entries:
        if entry.platform != "reolink" or not entry.entity_id.startswith("camera."):
            continue
        profile = (entry.translation_key or "").partition("_lens_")[0]
        if profile not in profiles or entry.disabled_by or entry.hidden_by:
            continue
        state = get_state(entry.entity_id)
        if state and state.state not in ("unknown", "unavailable"):
            candidates.append((profiles.index(profile), entry.entity_id))
    return min(candidates)[1] if candidates else None


def doorbell_payload(
    visitor_id: str, name: str, camera_id: str | None
) -> dict[str, Any]:
    """Open the native live view so the recipient can enable the microphone."""
    url = f"/?more-info-entity-id={camera_id or visitor_id}"
    data = {
        "url": url,
        "clickAction": url,
        "tag": f"smartphone_dashboard_doorbell_{visitor_id}",
        "push": {"sound": "default", "interruption-level": "time-sensitive"},
        "notification_icon": "mdi:doorbell-video",
        "channel": "Türklingel",
        "importance": "high",
        "priority": "high",
        "ttl": 0,
    }
    if camera_id:
        data["actions"] = [{"action": "URI", "title": "Livebild öffnen", "uri": url}]
    return {
        "title": name or "Türklingel",
        "message": "Es hat geklingelt." if camera_id else "Es hat geklingelt. Kein Livebild verfügbar.",
        "data": data,
    }
