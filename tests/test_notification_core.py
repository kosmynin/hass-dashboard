import runpy
from datetime import date
from pathlib import Path
CORE = runpy.run_path(str(Path(__file__).parents[1] / "custom_components/smartphone_dashboard/notification_core.py"))
pending_fingerprints = CORE["pending_fingerprints"]
retained_fingerprints = CORE["retained_fingerprints"]
valid_nina_glob = CORE["valid_nina_glob"]
ups_state_is_alert = CORE["ups_state_is_alert"]
waste_collection_details = CORE["waste_collection_details"]

def test_nina_glob_exactly_one_star():
    assert valid_nina_glob("binary_sensor.nina_warning_*")
    assert not valid_nina_glob("binary_sensor.nina_warning")
    assert not valid_nina_glob("binary_sensor.nina_**")

def test_ups_states_cover_text_and_binary_sensor_conventions():
    assert not ups_state_is_alert("sensor.ups_status", "ONLINE")
    assert not ups_state_is_alert("sensor.ups_status", "Connected")
    assert ups_state_is_alert("sensor.ups_status", "battery")
    assert not ups_state_is_alert("binary_sensor.ups_online", "on", "connectivity")
    assert ups_state_is_alert("binary_sensor.ups_online", "off", "connectivity")
    assert ups_state_is_alert("binary_sensor.ups_problem", "on", "problem")
    assert not ups_state_is_alert("binary_sensor.ups_problem", "off", "problem")
    assert not ups_state_is_alert("binary_sensor.ups_online", "unavailable", "connectivity")

def test_dedupe_and_successful_delivery_retention():
    assert pending_fingerprints(["a", "b", "b"], ["a"]) == ["b"]
    assert retained_fingerprints(["a", "b", "c"], ["a", "old"], ["b"]) == ["a", "b"]

def test_delivery_state_is_per_recipient_and_partial_failures_retry():
    fingerprints = ["battery:a"]
    delivered = {"notify.phone_a": [], "notify.phone_b": []}
    delivered["notify.phone_a"] = retained_fingerprints(fingerprints, delivered["notify.phone_a"], fingerprints)
    delivered["notify.phone_b"] = retained_fingerprints(fingerprints, delivered["notify.phone_b"], [])
    assert pending_fingerprints(fingerprints, delivered["notify.phone_a"]) == []
    assert pending_fingerprints(fingerprints, delivered["notify.phone_b"]) == fingerprints
    delivered["notify.phone_b"] = retained_fingerprints(fingerprints, delivered["notify.phone_b"], fingerprints)
    assert all(not pending_fingerprints(fingerprints, values) for values in delivered.values())

def test_waste_collection_details_support_default_and_dated_attributes():
    details = waste_collection_details(
        "Biomüll in 1 days",
        {"2026-09-01": "Biomüll", "daysTo": 1},
        "Waste Collection Schedule Abfall",
        date(2026, 8, 31),
    )
    assert details == {
        "type": "Biomüll",
        "date": "2026-09-01",
        "date_label": "morgen · 01.09.",
        "days": 1,
    }

def test_waste_collection_details_support_generic_and_text_states():
    generic = waste_collection_details(
        "1",
        {"upcoming": [{"date": "2026-09-01", "types": ["Gelbe Tonne"], "daysTo": 1}]},
        "Abfall",
        date(2026, 8, 31),
    )
    assert generic["type"] == "Gelbe Tonne"
    assert generic["date_label"] == "morgen · 01.09."
    text = waste_collection_details("Restmüll morgen", {}, "Abfall", date(2026, 8, 31))
    assert text["type"] == "Restmüll"
    assert text["date_label"] == "morgen"
    assert text["days"] == 1
