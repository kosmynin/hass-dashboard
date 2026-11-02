import runpy
from datetime import date
from pathlib import Path
CORE = runpy.run_path(str(Path(__file__).parents[1] / "custom_components/smartphone_dashboard/notification_core.py"))
pending_fingerprints = CORE["pending_fingerprints"]
retained_fingerprints = CORE["retained_fingerprints"]
area_entity_label = CORE["area_entity_label"]
valid_nina_glob = CORE["valid_nina_glob"]
ups_state_is_alert = CORE["ups_state_is_alert"]
waste_collection_details = CORE["waste_collection_details"]
filter_waste_types = CORE["filter_waste_types"]
normalized_alerts = CORE["normalized_alerts"]
alert_set_digest = CORE["alert_set_digest"]
aggregate_alert_message = CORE["aggregate_alert_message"]
mobile_notification_data = CORE["mobile_notification_data"]
mobile_clear_data = CORE["mobile_clear_data"]
mobile_dashboard_url = CORE["mobile_dashboard_url"]
mobile_live_activity_data = CORE["mobile_live_activity_data"]
mobile_live_clear_data = CORE["mobile_live_clear_data"]
live_activity_message = CORE["live_activity_message"]
mobile_action_ids = CORE["mobile_action_ids"]
parse_mobile_action = CORE["parse_mobile_action"]
is_battery_level_sensor = CORE["is_battery_level_sensor"]
dashboard_entity_enabled = CORE["dashboard_entity_enabled"]

def test_area_entity_label_replaces_device_with_area():
    assert area_entity_label("Wohnzimmer", "AirGradient ONE CO₂", "AirGradient ONE", "sensor.co2") == "Wohnzimmer · CO₂"
    assert area_entity_label("Küche", "Fenster", "Fenstersensor", "binary_sensor.fenster") == "Küche · Fenster"
    assert area_entity_label(None, "AirGradient ONE CO₂", "AirGradient ONE", "sensor.co2") == "CO₂"

def test_battery_voltage_is_never_a_battery_level_alert():
    assert is_battery_level_sensor("sensor.remote_battery", {"device_class": "battery", "unit_of_measurement": "%"})
    assert is_battery_level_sensor("sensor.fernbedienung_batterie", {"unit_of_measurement": "%"})
    assert not is_battery_level_sensor("sensor.remote_battery_voltage", {"device_class": "voltage", "unit_of_measurement": "V"})
    assert not is_battery_level_sensor("sensor.batteriespannung", {"friendly_name": "Batteriespannung", "unit_of_measurement": "V"})
    assert not is_battery_level_sensor("sensor.remote_battery", {"device_class": "battery", "unit_of_measurement": "mV"})
    assert not is_battery_level_sensor("sensor.battery_temperature", {"unit_of_measurement": "°C"})

def test_dashboard_visibility_is_shared_except_for_hidden_batteries():
    assert dashboard_entity_enabled()
    assert not dashboard_entity_enabled(hidden_by="user")
    assert not dashboard_entity_enabled(state_hidden=True)
    assert dashboard_entity_enabled(hidden_by="user", allow_hidden=True)
    assert not dashboard_entity_enabled(disabled_by="integration", allow_hidden=True)

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
    assert not ups_state_is_alert("sensor.ups_last_switch", "2026-09-01T20:00:00+02:00", "timestamp", "UPS Umschaltung von Batterie")
    assert not ups_state_is_alert("sensor.ups_umschaltung_von_batterie", "2026-09-01T20:00:00+02:00", None, "UPS Umschaltung von Batterie")
    assert not ups_state_is_alert("sensor.ups_umschaltung_von_batterie", "1. September 2026 um 20:00", None, "UPS Umschaltung von Batterie")

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

def test_aggregate_alerts_are_deduplicated_and_digest_is_order_independent():
    alerts = [
        {"fingerprint": "battery:a", "message": "Batterie niedrig"},
        {"fingerprint": "co2:b", "message": "CO2 hoch"},
        {"fingerprint": "battery:a", "message": "Duplikat"},
        {"fingerprint": "", "message": "Ungueltig"},
    ]
    assert normalized_alerts(alerts) == [
        {"fingerprint": "battery:a", "message": "Batterie niedrig"},
        {"fingerprint": "co2:b", "message": "CO2 hoch"},
    ]
    assert alert_set_digest(alerts) == alert_set_digest(list(reversed(alerts)))
    assert alert_set_digest([{"fingerprint": "battery:a", "message": "Neuer Wert"}]) == alert_set_digest(
        [{"fingerprint": "battery:a", "message": "Alter Wert"}]
    )

def test_aggregate_message_and_iphone_replacement_payloads():
    alerts = [
        {"fingerprint": "a", "message": "Erste Meldung"},
        {"fingerprint": "b", "message": "Zweite Meldung"},
    ]
    assert aggregate_alert_message(alerts) == "• Erste Meldung\n• Zweite Meldung"
    assert aggregate_alert_message(alerts, bullet="- ") == "- Erste Meldung\n- Zweite Meldung"
    assert aggregate_alert_message(alerts, max_characters=20).endswith("\n…")
    active = mobile_notification_data(2)
    passive = mobile_notification_data(1, passive=True)
    assert active["tag"] == passive["tag"] == mobile_clear_data()["tag"]
    assert active["group"] == passive["group"] == mobile_clear_data()["group"]
    assert active["subtitle"] == "2 aktive Meldungen"
    assert active["push"] == {"interruption-level": "active", "badge": 2}
    assert passive["push"] == {"interruption-level": "passive", "badge": 1}
    assert mobile_clear_data()["push"] == {"badge": 0}

def test_iphone_actions_are_scoped_to_recipient_and_alert_set():
    recipient = "notify.mobile_app_boris_iphone"
    digest = "a" * 32
    data = mobile_notification_data(2, recipient=recipient, digest=digest)
    assert data["url"] == mobile_dashboard_url(recipient)
    assert "sd_popup=meldungen" in data["url"]
    assert data["clickAction"] == data["url"]
    assert data["url"].endswith("#meldungen")
    assert [action["title"] for action in data["actions"]] == [
        "Details", "30 Min. stumm", "Bis Änderung stumm",
    ]
    identifiers = mobile_action_ids(recipient, digest)
    assert parse_mobile_action(identifiers["snooze"])["kind"] == "snooze"
    parsed_mute = parse_mobile_action(identifiers["mute"])
    assert parsed_mute["kind"] == "mute"
    assert parsed_mute["digest"] == digest
    assert parse_mobile_action("UNRELATED_ACTION") is None

def test_live_activity_is_compact_quiet_on_updates_and_red_for_nina():
    alerts = [
        {"fingerprint": "co2:a", "message": "Wohnzimmer · CO₂: 1.420 ppm"},
        {"fingerprint": "contact:b", "message": "Küche · Fenster seit 18 Minuten offen"},
        {"fingerprint": "nina:c", "message": "Amtliche Warnung"},
    ]
    assert live_activity_message(alerts) == (
        "Wohnzimmer · CO₂: 1.420 ppm\n"
        "Küche · Fenster seit 18 Minuten offen\n"
        "+1 weitere"
    )
    recipient = "notify.mobile_app_boris_iphone"
    data = mobile_live_activity_data(
        alerts,
        tag="smartphone_dashboard_live_1",
        silent=True,
        recipient=recipient,
    )
    assert data["tag"] == "smartphone_dashboard_live_1"
    assert data["live_update"] is True
    assert data["critical_text"] == "3"
    assert data["notification_icon_color"] == "#FF453A"
    assert data["silent"] is True
    assert data["url"] == mobile_dashboard_url(recipient)
    assert data["clickAction"] == data["url"]
    assert data["url"].endswith("#meldungen")
    assert mobile_live_clear_data(data["tag"]) == {"tag": "smartphone_dashboard_live_1"}

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

def test_waste_frequency_filters_and_removes_frequency_from_name():
    attributes = {
        "2026-09-01": ["Restmüll - 2 wöchentlich", "Restmüll - wöchentlich"],
        "daysTo": 1,
    }
    weekly = waste_collection_details(
        "Restmüll morgen", attributes, "Abfall", date(2026, 8, 31), "weekly",
    )
    two_weeks = waste_collection_details(
        "Restmüll morgen", attributes, "Abfall", date(2026, 8, 31), "two_weeks",
    )
    combined = waste_collection_details(
        "Restmüll morgen", attributes, "Abfall", date(2026, 8, 31), "all",
    )
    assert weekly["type"] == "Restmüll"
    assert two_weeks["type"] == "Restmüll"
    assert combined["type"] == "Restmüll"
    assert "wöchentlich" not in combined["type"]

def test_waste_frequency_chooses_next_matching_date_and_deduplicates_aliases():
    details = waste_collection_details(
        "1",
        {
            "2026-09-01": "Restmüll - wöchentlich",
            "2026-09-15": ["Gelbe Tonne/Container - 2 wöchentlich", "Gelber Container - 2 wöchentlich"],
        },
        "Abfall",
        date(2026, 8, 31),
        "two_weeks",
    )
    assert details == {
        "type": "Gelbe Tonne",
        "date": "2026-09-15",
        "date_label": "15.09.",
        "days": 15,
    }
    assert filter_waste_types("Gelbe Tonne/Container - vierwöchentlich", "four_weeks") == "Gelbe Tonne"
    assert filter_waste_types("Gelber Container - zwei-wöchentlich", "two_weeks") == "Gelbe Tonne"
    assert waste_collection_details(
        "1", {"2026-09-01": "Restmüll - wöchentlich"}, "Abfall", date(2026, 8, 31), "four_weeks",
    ) is None
