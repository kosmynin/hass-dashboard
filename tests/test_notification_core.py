import runpy
from pathlib import Path
CORE = runpy.run_path(str(Path(__file__).parents[1] / "custom_components/smartphone_dashboard/notification_core.py"))
pending_fingerprints = CORE["pending_fingerprints"]
retained_fingerprints = CORE["retained_fingerprints"]
valid_nina_glob = CORE["valid_nina_glob"]
ups_state_is_alert = CORE["ups_state_is_alert"]

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
