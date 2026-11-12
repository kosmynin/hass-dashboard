import ast
import json
from pathlib import Path

ROOT = Path(__file__).parents[1]
COMPONENT = ROOT / "custom_components" / "smartphone_dashboard"

def test_manifest_and_hacs():
    manifest = json.loads((COMPONENT / "manifest.json").read_text())
    hacs = json.loads((ROOT / "hacs.json").read_text())
    assert manifest["domain"] == "smartphone_dashboard"
    assert manifest["config_flow"] is True
    assert manifest["version"] == "22.0.53"
    assert hacs["name"] == "Smartphone Dashboard"
    assert hacs["zip_release"] is True
    assert hacs["filename"] == "smartphone_dashboard.zip"
    assert hacs["hide_default_branch"] is True
    release = (ROOT / ".github/workflows/release.yml").read_text()
    assert 'tags:' in release and 'gh release create' in release
    assert 'smartphone_dashboard.zip' in release and 'unzip -t' in release

def test_python_syntax_and_runtime_files():
    for path in COMPONENT.glob("*.py"):
        ast.parse(path.read_text(), filename=str(path))
    assert (COMPONENT / "frontend/smartphone-dashboard-loader.js").is_file()
    assert (COMPONENT / "frontend/smartphone-dashboard-strategy.js").is_file()

def test_compatibility_package_and_helpers():
    reference = COMPONENT / "compatibility/smartphone_dashboard_legacy_reference.yaml"
    text = reference.read_text()
    assert "active_automation: false" in text
    const = (COMPONENT / "const.py").read_text()
    assert const.count('"input_boolean.smartphone_') == 7
    assert const.count('"input_number.smartphone_') == 4
    assert const.count('"input_text.smartphone_') == 6

def test_storage_is_non_destructive_and_idempotent_by_design():
    source = (COMPONENT / "config_manager.py").read_text()
    assert "helpers_deleted\": False" in source
    assert "async_remove" not in source and "async_delete" not in source
    assert "asyncio.Lock()" in source
    assert '"conflict": True' in source
    assert "_async_migrate_func" in source

def test_ws_contract_and_lifecycle():
    source = (COMPONENT / "__init__.py").read_text()
    assert "CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)" in source
    assert "require_admin" in source
    assert 'vol.Required("revision")' in source
    assert "65536" in source and "level > 12" in source
    assert "async_stop()" in source and '"not_loaded"' in source
    assert "dashboard_key" in source and "quick_actions enthält eine ungültige Script-Entity" in source

def test_legacy_import_uses_state_machine_get_api():
    source = (COMPONENT / "config_manager.py").read_text()
    assert "self.hass.states.get(entity_id)" in source
    assert "self.hass.states[entity_id]" not in source

def test_backend_notifications_are_active_and_legacy_yaml_is_not():
    runtime = (COMPONENT / "notification.py").read_text()
    assert 'NOTIFICATION_TITLE = "Homeassistant"' in runtime
    assert 'PERSISTENT_NOTIFICATION_ID = "smartphone_dashboard_alerts"' in runtime
    assert "self._persistent_message" in runtime
    assert '"persistent_notification",' in runtime
    assert '"message": "clear_notification"' in runtime
    assert "aggregate_alert_message" in runtime and "mobile_live_activity_data" in runtime
    assert "live_activity_entries" in runtime and "live_activity_presentation" in runtime
    assert "for live_tag in live_tags" in runtime
    assert "_active_media_entries" in runtime and "_sync_media_live_activities" in runtime
    assert '"title": f"{NOTIFICATION_TITLE} – {entry[\'title\']}"' in runtime
    assert '"message": entry["message"]' in runtime
    assert "def queue_refresh" in runtime
    assert 'entity_id.startswith(("sensor.", "binary_sensor.", "media_player.", "input_"))' in runtime
    assert 'state.state in ("playing", "buffering")' in runtime
    assert 'if mobile_app:' in runtime and '"retire-standard"' in runtime
    assert 'type: "smartphone_dashboard/notifications/action"' in (
        COMPONENT / "frontend/smartphone-dashboard-strategy.js"
    ).read_text()
    assert "asyncio.Queue" in runtime and "blocking=True" in runtime
    assert "alert_set_digest" in runtime and "valid_nina_glob" in runtime
    assert 'LIVE_ACTIVITY_PAYLOAD_VERSION = "5"' in runtime
    assert "alert_content_digest(alerts)" in runtime
    assert "same_alert_set" in runtime and "reuse_existing" in runtime
    assert "entry.async_create_background_task" in runtime
    assert "hass.async_create_task" not in runtime
    assert not list((COMPONENT / "compatibility").glob("*notifications_package.yaml"))

def test_privacy_and_generic_frontend():
    public = (COMPONENT / "frontend/smartphone-dashboard-strategy.js").read_text(errors="ignore")
    for forbidden in ("bo" + "ris", "anasta" + "siia", "kosmy" + "nin", "erk" + "rath", "home." + "kosmy" + "nin"):
        assert forbidden not in public.lower()
    strategy = (COMPONENT / "frontend/smartphone-dashboard-strategy.js").read_text()
    assert '"entity": "person.' not in strategy
    assert '"entity": "' not in strategy

def test_one_runtime_version():
    manifest = json.loads((COMPONENT / "manifest.json").read_text())
    version = manifest["version"]
    assert f'STRATEGY_VERSION = "{version}"' in (COMPONENT / "frontend/smartphone-dashboard-strategy.js").read_text()
    assert f'const VERSION = "{version}"' in (COMPONENT / "frontend/smartphone-dashboard-loader.js").read_text()
    assert "?v=${VERSION}" in (COMPONENT / "frontend/smartphone-dashboard-loader.js").read_text()
    constants = (COMPONENT / "const.py").read_text()
    assert 'STATIC_URL = f"/smartphone-dashboard/v{VERSION}"' in constants
    assert 'MODULE_URL = f"{STATIC_URL}/smartphone-dashboard-loader.js"' in constants

def test_editor_keeps_entity_multi_selectors_open_while_values_change():
    strategy = (COMPONENT / "frontend/smartphone-dashboard-strategy.js").read_text()
    selector_start = strategy.index('picker.addEventListener("value-changed"')
    selector_end = strategy.index('field.appendChild(picker)', selector_start)
    selector_handler = strategy[selector_start:selector_end]
    assert "event.stopPropagation()" in selector_handler
    excluded_start = strategy.index('"Automatisch erkannte Entitäten ausblenden"')
    excluded_handler = strategy[excluded_start:strategy.index('if (feature.key === "printer")', excluded_start)]
    assert "this._render()" not in excluded_handler
    printer_start = strategy.index('"Automatisch erkannte Bambu-Lab-Geräte ausblenden"')
    excluded_printer_handler = strategy[printer_start:strategy.index('toggle.addEventListener', printer_start)]
    assert "this._render()" not in excluded_printer_handler

def test_loader_repairs_registry_races_and_bounds_timeout_recovery():
    loader = (COMPONENT / "frontend/smartphone-dashboard-loader.js").read_text()
    assert 'text.includes("Timeout waiting for strategy element")' in loader
    assert "text.includes(ELEMENT)" in loader
    assert "sessionStorage.getItem(RECOVERY_KEY)" in loader
    assert "sessionStorage.setItem(RECOVERY_KEY" in loader
    assert "location.reload()" in loader
    assert "clearRecoveryMarker();" in loader
    assert "installImplementation(ELEMENT, SmartphoneDashboardLoader)" in loader
    assert "updateConstructor(existing, implementation)" in loader
    assert "installImplementation(EDITOR_ELEMENT" in loader
    assert "REGISTRY_MONITOR_DURATION" in loader
    assert "observedRegistry !== window.customElements" in loader
    assert "ensureRegistrations();" in loader
    assert "RECOVERY_LIMIT = 2" in loader
    assert "target - performance.now()" in loader
    assert 'new URLSearchParams(location.search || "").get("sd_popup")' in loader
    assert "function requestedDashboardPopup" in loader
    assert "replayDashboardPopupDeepLink();" in loader
    assert 'window.dispatchEvent(new Event("hashchange"))' in loader

def test_frontend_is_an_automatically_versioned_lovelace_resource():
    source = (COMPONENT / "__init__.py").read_text()
    assert "ResourceStorageCollection" in source
    assert "await resources.async_get_info()" in source
    assert 'await resources.async_create_item({"res_type": "module", "url": MODULE_URL})' in source
    assert "await resources.async_update_item(" in source
    assert "await _async_register_frontend_resource(hass)" in source

def test_generic_base_matches_notification_and_quick_action_transformers():
    strategy = (COMPONENT / "frontend/smartphone-dashboard-strategy.js").read_text()
    assert 'heading: "Meldungen"' in strategy
    assert 'heading: "Aktionen"' in strategy
    assert 'entity_id: "sensor.*battery"' in strategy
    assert 'entity_id: "binary_sensor.nina_warning_*"' in strategy
    assert 'unique: true' in strategy
    assert 'show_empty: false' in strategy
    assert 'name: "Keine Meldungen"' in strategy
    assert 'card_param: "cards"' in strategy
    assert 'state: `<= ${batteryThreshold}`' in strategy
    assert "BATTERY_VOLTAGE_EXCLUDE_FILTERS" in strategy
    assert "isBatteryLevelEntity" in strategy
    assert 'not: { state: "0" }' not in strategy
    assert 'state: `>= ${co2Threshold}`' in strategy
    assert 'state: "on"' in strategy
    assert 'attributes: { daysTo: `<= ${wasteDays}` }' in strategy
    assert 'const dueState =' in strategy
    assert "const UPS_NON_ALERT_STATES" in strategy
    assert 'entity_id.startsWith("binary_sensor.")' in strategy
    assert 'state: problemSensor ? "on" : "off"' in strategy
    assert 'const NOTIFICATION_POPUPS' in strategy
    assert 'card_type: "calendar"' in strategy
    assert "data-waste-frequency" not in strategy
    assert "delete result.waste_frequency" in strategy
    assert "delete result.waste_frequencies" in strategy
    assert 'entity?.attributes?.instruction' in strategy
    assert 'entry["state 1"]' not in strategy
    assert 'card?.heading === "Aktionen"' in strategy
    assert 'hass?.states?.[entityId]' in strategy
    assert 'template: "bubble_room_tile"' not in strategy
    assert "function lightSupportsBrightness" in strategy
    assert 'dimmable ? "slider" : "switch"' in strategy
    assert 'tap_action: { action: room.main_light ? "toggle" : "none" }' in strategy
    assert "function graphSensorCard" in strategy
    assert 'template: "bubble_card_graph"' not in strategy
    assert "ACTIVE_ROOM_STYLES" in strategy
    assert "function isEntityVisible" in strategy
    assert "hiddenDashboardEntityIds(hass)" in strategy
    assert "_dashboard_entity_enabled" in (COMPONENT / "notification.py").read_text()
    assert "entry?.hidden !== true" in strategy
    assert "isEntityVisible(hass, configuredLight)" in strategy

def test_storage_is_dashboard_scoped_and_notification_status_atomic():
    source = (COMPONENT / "config_manager.py").read_text()
    assert 'from .storage_core import DEFAULT_DATA' in source
    assert "async_patch_strategy(self, key:" in source
    assert "async_update_notification_status" in source
    assert '"delivered_by_recipient"' in source

def test_storage_version_and_redacted_dashboard_diagnostics():
    assert "STORAGE_VERSION = 3" in (COMPONENT / "const.py").read_text()
    diagnostics = (COMPONENT / "diagnostics.py").read_text()
    assert '"dashboard_count"' in diagnostics and '"dashboard_revisions"' in diagnostics
    assert 'data.get("revision")' not in diagnostics and 'data.get("strategy")' not in diagnostics
    assert '"seeded_fields"' not in diagnostics

def test_notification_backend_uses_only_default_dashboard_and_revisioned_seed():
    runtime = (COMPONENT / "notification.py").read_text()
    manager = (COMPONENT / "config_manager.py").read_text()
    assert "next(iter(dashboards.values()))" not in runtime
    assert 'dashboards.get("default"' in runtime
    assert 'dashboard["revision"] = int(dashboard.get("revision", 0)) + 1' in manager

def test_public_metadata_and_no_placeholder():
    manifest = json.loads((COMPONENT / "manifest.json").read_text())
    assert manifest["documentation"] == "https://github.com/kosmynin/hass-dashboard"
    assert manifest["issue_tracker"] == "https://github.com/kosmynin/hass-dashboard/issues"
    assert manifest["codeowners"] == ["@kosmynin"]
    for path in ROOT.rglob("*"):
        if path.is_file() and "__pycache__" not in path.parts:
            assert ("CHANGE" + "_ME") not in path.read_text(errors="ignore")

def test_local_brand_icon_exists():
    icon = COMPONENT / "brand/icon.png"
    assert icon.is_file()
    assert icon.stat().st_size > 1024
