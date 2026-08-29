import runpy
from pathlib import Path

CORE = runpy.run_path(str(Path(__file__).parents[1] / "custom_components/smartphone_dashboard/storage_core.py"))
migrate = CORE["migrate_store_data"]
normalize = CORE["normalize_legacy_value"]
safe_revision = CORE["safe_revision"]

def test_real_v2_fixture_migrates_without_loss():
    old = {"schema": 22, "revision": 7, "strategy": {"title": "Lokal", "notification_nina": False, "notification_recipients": "notify.phone"}, "notifications": {"delivered": ["old"], "health": {"active": False}}, "legacy_helpers": {"input_boolean.x": "off"}, "migration": {"seeded": True}}
    result = migrate(2, old)
    assert result["dashboards"]["default"] == {"revision": 7, "config": old["strategy"]}
    assert result["legacy_helpers"] == old["legacy_helpers"]
    assert result["migration"] == old["migration"]
    assert result["notifications"]["health"] == {"active": False}
    assert result["notifications"]["delivered_by_recipient"] == {"notify.phone": ["old"]}
    assert result["notifications"]["legacy_delivered"] == ["old"]
    assert "revision" not in result and "strategy" not in result

def test_v1_fixture_and_existing_v3_dashboards_survive():
    assert migrate(1, {"strategy": {"title": "Alt"}})["dashboards"]["default"]["config"] == {"title": "Alt"}
    current = {"dashboards": {"one": {"revision": 3, "config": {"title": "Eins"}}}, "notifications": {"delivered_by_recipient": {"notify.phone": ["a"]}, "health": {}}}
    assert migrate(2, current)["dashboards"] == current["dashboards"]
    assert migrate(2, current)["notifications"]["delivered_by_recipient"] == current["notifications"]["delivered_by_recipient"]

def test_partial_seed_values_are_safe_and_nina_is_migrated():
    assert normalize("input_boolean.smartphone_meldung_nina", "unknown") is None
    assert normalize("input_boolean.smartphone_meldung_nina", "off") is False
    assert normalize("input_number.smartphone_co2_grenzwert", "nan") is None
    assert normalize("input_text.smartphone_nina_muster", "binary_sensor.nina_warning_region") == "binary_sensor.nina_warning_region*"
    assert normalize("input_text.smartphone_nina_muster", "bad**") == "binary_sensor.nina_warning_*"
    assert normalize("input_text.smartphone_nina_muster", "bad*") == "binary_sensor.nina_warning_*"
    assert normalize("input_text.smartphone_nina_muster", "binary_sensor.foo.bar") == "binary_sensor.nina_warning_*"
    assert normalize("input_text.smartphone_nina_muster", "binary_sensor.nina_warning_*") == "binary_sensor.nina_warning_*"

def test_invalid_old_revision_is_safe():
    assert safe_revision("kaputt") == 0
    assert safe_revision(-4) == 0
    assert migrate(2, {"revision": "kaputt", "strategy": {"title": "Alt"}})["dashboards"]["default"]["revision"] == 0
