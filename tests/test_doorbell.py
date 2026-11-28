"""Run the coordinator's real state-change and delivery paths with local HA doubles."""

import ast
import asyncio
import hashlib
import json
import logging
from pathlib import Path
import re
import runpy
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace


COMPONENT = Path(__file__).parents[1] / "custom_components/smartphone_dashboard"
DOORBELL = runpy.run_path(str(COMPONENT / "doorbell.py"))
NOW = datetime(2026, 11, 1, tzinfo=timezone.utc)


def state(value, *, restored=False, at=NOW):
    return SimpleNamespace(state=value, attributes={"restored": restored}, last_changed=at)


def entity(entity_id, key, device="entrance", platform="reolink", **settings):
    return SimpleNamespace(
        entity_id=entity_id, translation_key=key, device_id=device, platform=platform,
        disabled_by=settings.get("disabled_by"), hidden_by=settings.get("hidden_by"),
    )


def test_doorbell_requires_a_real_transition():
    pressed = DOORBELL["is_doorbell_press"]
    for old in (None, state("unavailable"), state("unknown"), state("on"), state("off", restored=True)):
        assert not pressed(old, state("on"))
    for new in (None, state("off"), state("unavailable"), state("on", restored=True)):
        assert not pressed(state("off"), new)
    assert pressed(state("off"), state("on"))


def test_camera_selection_uses_available_live_profiles_and_ignores_user_facing_names():
    entries = [
        entity("camera.backup", "main"), entity("camera.fluent_hidden", "sub", hidden_by="user"),
        entity("camera.photo", "snapshots_sub"), entity("camera.third_party", "sub", platform="other"),
        entity("camera.balanced", "ext"), entity("camera.disabled", "sub", disabled_by="user"),
        entity("camera.renamed", "sub"),
    ]
    states = {entry.entity_id: state("idle") for entry in entries}
    camera = DOORBELL["doorbell_camera"]
    assert camera(entries, states.get) == "camera.renamed"
    states["camera.renamed"] = state("unavailable")
    assert camera(entries, states.get) == "camera.balanced"
    del states["camera.balanced"]
    assert camera(entries, states.get) == "camera.backup"
    states["camera.backup"] = state("unknown")
    assert camera(entries, states.get) is None


def test_visitor_ring_reaches_each_phone_once_and_opens_only_the_ringing_camera(caplog):
    visitor_id = "binary_sensor.umbenannt"
    entries = [
        entity(visitor_id, "visitor"), entity("binary_sensor.person", "person"),
        entity("binary_sensor.nvr_visitor", "visitor"),
        entity("binary_sensor.other", "visitor", platform="mqtt"),
        entity("camera.front", "main"), entity("camera.back", "sub", device="back"),
    ]
    registry = SimpleNamespace(async_get={entry.entity_id: entry for entry in entries}.get)
    core_state = SimpleNamespace(running=object())
    namespace = {
        **DOORBELL, "callback": lambda f: f, "CoreState": core_state,
        "asyncio": asyncio, "hashlib": hashlib, "json": json, "time": time,
        "re": re, "timedelta": timedelta, "_LOGGER": logging.getLogger("test.doorbell"),
        "er": SimpleNamespace(
            async_get=lambda hass: registry,
            async_entries_for_device=lambda reg, device: [e for e in entries if e.device_id == device],
        ),
        "dr": SimpleNamespace(async_get=lambda hass: SimpleNamespace(
            async_get=lambda device: SimpleNamespace(name_by_user="Eingang", name="Doorbell"),
        )),
    }
    path = COMPONENT / "notification.py"
    module = ast.parse(path.read_text())
    # CI installs pytest only. Use the real coordinator and constants, stubbing the HA APIs.
    body = [
        node for node in module.body if
        (isinstance(node, ast.ImportFrom) and node.module == "__future__")
        or (isinstance(node, ast.ClassDef) and node.name == "NotificationCoordinator")
        or (isinstance(node, ast.Assign) and (
            node.targets[0].id.startswith("MOBILE_PUSH_")
            or node.targets[0].id in ("LEGACY_TO_CONFIG", "DOORBELL_ALIAS_WINDOW")
        ))
    ]
    exec(compile(ast.Module(body=body, type_ignores=[]), str(path), "exec"), namespace)
    tasks = []
    deliveries = []
    service_failures = []
    states = {"camera.front": state("idle"), "camera.back": state("idle")}
    settings = {"notification_recipients": "notify.mobile_app_legacy,notify.email"}

    async def notify(domain, service, payload, blocking):
        assert domain == "notify" and blocking
        await asyncio.sleep(0)
        if service == "mobile_app_offline":
            service_failures.append(service)
            raise RuntimeError("offline")
        deliveries.append((service, payload))

    hass = SimpleNamespace(
        state=core_state.running, states=SimpleNamespace(get=states.get),
        services=SimpleNamespace(async_call=notify),
    )
    coordinator = namespace["NotificationCoordinator"](
        hass, SimpleNamespace(data={"dashboards": {"default": {"config": settings}}}),
        SimpleNamespace(async_create_background_task=lambda h, coro, name: tasks.append(asyncio.create_task(coro))),
    )

    def press(entity_id=visitor_id, at=NOW):
        coordinator._state_changed(SimpleNamespace(data={
            "entity_id": entity_id, "old_state": state("off"), "new_state": state("on", at=at),
        }))

    async def check():
        press()
        settings["notification_doorbell"] = True
        hass.state = "starting"
        press()
        hass.state = core_state.running
        press("binary_sensor.person")
        press("binary_sensor.other")
        press("binary_sensor.unregistered")
        assert not tasks

        press()
        await asyncio.gather(*tasks)
        assert [service for service, _ in deliveries] == ["mobile_app_legacy"]
        payload = deliveries[0][1]
        assert payload["title"] == "Eingang"
        data = payload["data"]
        camera_url = "/?more-info-entity-id=camera.front"
        assert data["actions"] == [{"action": "URI", "title": "Livebild öffnen", "uri": camera_url}]
        assert data["url"] == data["clickAction"] == camera_url
        assert data["push"] == {"sound": "default", "interruption-level": "time-sensitive"}
        assert data["notification_icon"] == "mdi:doorbell-video"
        assert data["channel"] == "Türklingel"

        settings["doorbell_recipients"] = "notify.mobile_app_one,notify.mobile_app_offline, notify.mobile_app_one,notify.mobile_app_two"
        press(at=NOW + timedelta(seconds=15))
        press(at=NOW + timedelta(seconds=15))  # replay of the same event
        press("binary_sensor.nvr_visitor", at=NOW + timedelta(seconds=16))
        press(at=NOW + timedelta(seconds=17))  # separate press, same notification content
        await asyncio.gather(*tasks)
        for target in ("mobile_app_one", "mobile_app_two"):
            assert [service for service, _ in deliveries].count(target) == 2
        assert len(deliveries) == 5 and service_failures
        assert "offline" in caplog.text

        states["camera.front"] = state("unavailable")
        settings["doorbell_recipients"] = "notify.mobile_app_two"
        press(at=NOW + timedelta(minutes=1))
        await asyncio.gather(*tasks)
        payload = deliveries[-1][1]
        assert "Kein Livebild" in payload["message"]
        assert "actions" not in payload["data"]
        assert payload["data"]["url"] == f"/?more-info-entity-id={visitor_id}"

    asyncio.run(check())
