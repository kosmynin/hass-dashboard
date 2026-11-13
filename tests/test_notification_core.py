import runpy
from datetime import date, datetime
from pathlib import Path
CORE = runpy.run_path(str(Path(__file__).parents[1] / "custom_components/smartphone_dashboard/notification_core.py"))
pending_fingerprints = CORE["pending_fingerprints"]
retained_fingerprints = CORE["retained_fingerprints"]
area_entity_label = CORE["area_entity_label"]
valid_nina_glob = CORE["valid_nina_glob"]
ups_state_is_alert = CORE["ups_state_is_alert"]
waste_collection_details = CORE["waste_collection_details"]
normalized_alerts = CORE["normalized_alerts"]
alert_set_digest = CORE["alert_set_digest"]
alert_content_digest = CORE["alert_content_digest"]
parcel_alert = CORE["parcel_alert"]
parcel_display_label = CORE["parcel_display_label"]
parcel_content_label = CORE["parcel_content_label"]
aggregate_alert_message = CORE["aggregate_alert_message"]
mobile_notification_data = CORE["mobile_notification_data"]
mobile_clear_data = CORE["mobile_clear_data"]
mobile_dashboard_url = CORE["mobile_dashboard_url"]
alert_dashboard_url = CORE["alert_dashboard_url"]
mobile_live_activity_data = CORE["mobile_live_activity_data"]
mobile_live_clear_data = CORE["mobile_live_clear_data"]
live_activity_message = CORE["live_activity_message"]
live_activity_entries = CORE["live_activity_entries"]
live_activity_presentation = CORE["live_activity_presentation"]
live_activity_title = CORE["live_activity_title"]
media_activity_presentation = CORE["media_activity_presentation"]
media_dashboard_url = CORE["media_dashboard_url"]
media_live_activity_tag = CORE["media_live_activity_tag"]
mobile_media_activity_data = CORE["mobile_media_activity_data"]
appliance_kind = CORE["appliance_kind"]
appliance_phase = CORE["appliance_phase"]
appliance_activity_presentation = CORE["appliance_activity_presentation"]
appliance_live_activity_tag = CORE["appliance_live_activity_tag"]
mobile_appliance_activity_data = CORE["mobile_appliance_activity_data"]
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
    assert alert_content_digest(
        [{"fingerprint": "co2:a", "message": "Wohnzimmer: 1200 ppm"}]
    ) != alert_content_digest(
        [{"fingerprint": "co2:a", "message": "Wohnzimmer: 1450 ppm"}]
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

def test_parcel_contract_becomes_stable_german_live_alert():
    alert = parcel_alert({
        "carrier": "DHL",
        "barcode": "00340434161094000000",
        "sender": "Beispielshop",
        "status": "out_for_delivery",
        "delivered": False,
        "planned_from": "2026-11-12T14:00:00+01:00",
        "planned_to": "2026-11-12T16:00:00+01:00",
    }, datetime.fromisoformat("2026-11-12T10:00:00+01:00"))
    assert alert == {
        "fingerprint": "parcel:dhl:00340434161094000000",
        "message": "📦 Beispielshop: heute 14:00–16:00",
        "critical_text": "Heute",
        "progress": 3,
        "progress_max": 4,
        "progress_bar_direction": "increasing",
    }
    presentation = live_activity_presentation(alert)
    assert presentation == {
        "message": "Beispielshop: heute 14:00–16:00",
        "icon": "mdi:truck-delivery",
        "color": "#30D158",
    }
    assert live_activity_title(alert) == "Paket"
    live_data = mobile_live_activity_data([alert], critical_text="1/1")
    assert live_data["critical_text"] == "Heute"
    assert live_data["progress"] == 3
    assert live_data["progress_max"] == 4
    assert live_data["progress_bar_color"] == "#30D158"
    assert live_data["progress_bar_direction"] == "increasing"
    assert live_data["background_color"] == "#101820"
    assert parcel_alert({"status": "delivered", "delivered": True}) is None
    assert "sd_popup=meldung-pakete" in alert_dashboard_url(alert)

def test_parcel_label_removes_broken_scraper_placeholders():
    assert parcel_display_label(
        "Gebrüder Weiss Express Ltd. (Not Sel Ths-", "Gebrüder Weiss"
    ) == "Gebrüder Weiss Express Ltd."
    assert parcel_display_label("Not Selected", "DHL") == "DHL"
    assert parcel_display_label(None, "UPS") == "UPS"
    alert = parcel_alert({
        "carrier": "Gebrüder Weiss",
        "barcode": "broken-label",
        "sender": "Gebrüder Weiss Express Ltd. (Not Sel Ths-",
        "status": "registered",
    })
    assert alert["message"] == "📦 Gebrüder Weiss Express Ltd."

def test_amazon_parcel_uses_compact_content_instead_of_generic_carrier():
    parcel = {
        "carrier": "Amazon",
        "barcode": "amazon-order",
        "sender": None,
        "status": "in_transit",
        "raw": {"items": ["USB-C Netzteil", "Ladekabel", "Schutzhülle"]},
    }
    assert parcel_content_label(parcel) == "USB-C Netzteil + 2 weitere"
    alert = parcel_alert(parcel)
    assert alert is not None
    assert alert["message"] == "📦 USB-C Netzteil + 2 weitere"

def test_registered_parcels_do_not_start_a_live_activity():
    registered = parcel_alert({
        "carrier": "DHL",
        "barcode": "registered",
        "sender": "Beispielshop",
        "status": "registered",
    })
    in_transit = parcel_alert({
        "carrier": "UPS",
        "barcode": "transit",
        "sender": "Technikshop",
        "status": "in_transit",
    })
    assert registered is not None and in_transit is not None
    assert live_activity_entries([registered]) == []
    assert live_activity_entries([registered, in_transit]) == [in_transit]

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
        {"fingerprint": "waste:d", "message": "🗑️ Restmüll und Biomüll: morgen"},
        {"fingerprint": "battery:e", "message": "🔋 Flur · Bewegungsmelder: 5%"},
    ]
    assert live_activity_message(alerts) == (
        "Wohnzimmer · CO₂: 1.420 ppm\n"
        "Küche · Fenster seit 18 Minuten offen\n"
        "Amtliche Warnung\n"
        "🗑️ Restmüll und Biomüll: morgen\n"
        "+1 weitere"
    )
    entries = live_activity_entries(alerts)
    assert [entry["message"] for entry in entries] == [
        "Wohnzimmer · CO₂: 1.420 ppm",
        "Küche · Fenster seit 18 Minuten offen",
        "Amtliche Warnung",
        "+2 weitere Meldungen – für Details öffnen",
    ]
    recipient = "notify.mobile_app_boris_iphone"
    data = mobile_live_activity_data(
        alerts,
        tag="smartphone_dashboard_live_1",
        silent=True,
        recipient=recipient,
        critical_text="3/5",
        relevance_score=0.9,
    )
    assert data["tag"] == "smartphone_dashboard_live_1"
    assert data["live_update"] is True
    assert data["critical_text"] == "3/5"
    assert data["relevance_score"] == 0.9
    assert data["notification_icon_color"] == "#FF453A"
    assert data["notification_icon"] == "mdi:alert-outline"
    assert data["silent"] is True
    assert data["url"] == alert_dashboard_url({"fingerprint": "nina:c"}, recipient)
    assert data["clickAction"] == data["url"]
    assert "sd_popup=meldung-nina" in data["url"]
    assert data["url"].endswith("#meldung-nina")
    assert mobile_live_clear_data(data["tag"]) == {"tag": "smartphone_dashboard_live_1"}

def test_live_activity_uses_category_icons_colors_and_plain_text():
    co2 = live_activity_presentation({
        "fingerprint": "co2:sensor.air_quality",
        "message": "💨 Wohnung · Kohlendioxid: 1118 ppm",
    })
    assert co2 == {
        "message": "Wohnung · Kohlendioxid: 1118 ppm",
        "icon": "mdi:molecule-co2",
        "color": "#A2AA52",
    }
    assert live_activity_title({"fingerprint": "co2:sensor.air_quality"}) == "CO₂"
    assert live_activity_title({"fingerprint": "waste:sensor.abfall"}) == "Abfall"
    waste = live_activity_presentation({
        "fingerprint": "waste:sensor.abfall:2026-11-04",
        "message": "🗑️ Gelbe Tonne: morgen · 04.11.",
    })
    assert waste == {
        "message": "Gelbe Tonne: morgen · 04.11.",
        "icon": "mdi:trash-can-outline",
        "color": "#FFD700",
    }
    waste_data = mobile_live_activity_data([
        {"fingerprint": "waste:x", "message": "🗑️ Papier: morgen"}
    ])
    assert waste_data["notification_icon"] == "mdi:trash-can-outline"
    assert waste_data["notification_icon_color"] == "#4169E1"
    assert waste_data["url"] == "/handy/handy?sd_popup=meldung-abfall#meldung-abfall"
    expected_popups = {
        "battery": "meldung-batterien",
        "contact": "meldung-kontakte",
        "co2": "meldung-co2",
        "waste": "meldung-abfall",
        "ups": "meldung-usv",
        "frost": "meldung-frost",
        "nina": "meldung-nina",
        "summary": "meldungen",
    }
    for category, popup in expected_popups.items():
        url = alert_dashboard_url({"fingerprint": f"{category}:x"})
        assert f"sd_popup={popup}" in url
        assert url.endswith(f"#{popup}")

def test_media_live_activity_contains_player_track_and_media_icon():
    entry = media_activity_presentation(
        "media_player.wohnzimmer",
        "Wohnzimmer",
        {
            "media_title": "A Forest",
            "media_artist": "The Cure",
            "media_album_name": "Seventeen Seconds",
            "media_content_type": "music",
            "media_content_id": "track-42",
        },
    )
    assert entry["title"] == "Wohnzimmer"
    assert entry["message"] == "A Forest · The Cure · Seventeen Seconds"
    assert entry["icon"] == "mdi:music"
    assert entry["color"] == "#5E5CE6"
    assert len(entry["digest"]) == 24
    tag = media_live_activity_tag(entry["entity_id"])
    assert tag.startswith("smartphone_dashboard_media_") and tag.endswith("_0")
    assert media_live_activity_tag(entry["entity_id"], 1).endswith("_1")
    data = mobile_media_activity_data(entry, tag=tag, silent=True)
    assert data["notification_icon"] == "mdi:music"
    assert data["critical_text"] == "▶"
    assert data["url"].endswith("#medien")
    assert data["silent"] is True
    remote_url = media_dashboard_url(entry["entity_id"])
    assert remote_url == "/handy/handy?sd_popup=medien&sd_media=media_player.wohnzimmer#medien"
    entry["url"] = remote_url
    remote_data = mobile_media_activity_data(entry, tag=tag)
    assert remote_data["url"] == remote_url
    assert remote_data["clickAction"] == remote_url
    assert media_dashboard_url("invalid", "#kaputt?") == "/handy/handy?sd_popup=medien#medien"

def test_appliance_live_activity_normalizes_integrations_and_throttles_progress():
    assert appliance_kind("Bosch Geschirrspüler SMV") == "dishwasher"
    assert appliance_kind("LG washing_machine") == "washer"
    assert appliance_kind("Miele Tumble Dryer") == "dryer"
    assert appliance_kind("Küche Backofen") == "oven"
    assert appliance_phase("BSH.Common.EnumType.OperationState.Run") == "active"
    assert appliance_phase("Programme running") == "active"
    assert appliance_phase("Pause") == "paused"
    assert appliance_phase("Ready") == "inactive"
    assert appliance_phase("Finished") == "inactive"

    entry = appliance_activity_presentation(
        "device-42", "Spülmaschine", "dishwasher", "Run",
        program="Eco_50", progress=63, remaining_minutes=47,
        url="/handy/handy?sd_popup=raum-kueche#raum-kueche",
    )
    assert entry["title"] == "Spülmaschine"
    assert entry["message"] == "Eco 50 · noch 47 Min."
    assert entry["critical_text"] == "47 Min."
    assert entry["icon"] == "mdi:dishwasher"
    assert entry["progress"] == 63
    # Small minute/progress changes share a digest and therefore do not create
    # one push update per sensor tick.
    near = appliance_activity_presentation(
        "device-42", "Spülmaschine", "dishwasher", "Run",
        program="Eco_50", progress=64, remaining_minutes=46,
        url="/handy/handy?sd_popup=raum-kueche#raum-kueche",
    )
    assert entry["digest"] == near["digest"]
    tag = appliance_live_activity_tag("device-42")
    assert tag.startswith("smartphone_dashboard_appliance_") and tag.endswith("_0")
    data = mobile_appliance_activity_data(entry, tag=tag, silent=True)
    assert data["progress"] == 63 and data["progress_max"] == 100
    assert data["critical_text"] == "47 Min."
    assert data["url"].endswith("#raum-kueche")
    assert data["silent"] is True

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
    sentence = waste_collection_details("Restmüll wird abgeholt.", {"daysTo": 1}, "Abfall", date(2026, 8, 31))
    assert sentence["type"] == "Restmüll"
    multiple = waste_collection_details(
        "Restmüll und Biomüll werden\nmorgen abgeholt.",
        {"daysTo": 1},
        "Abfall",
        date(2026, 8, 31),
    )
    assert multiple["type"] == "Restmüll und Biomüll"
    assert multiple["date_label"] == "morgen"
    assert live_activity_message([{
        "fingerprint": "waste:sensor.abfall:2026-09-01",
        "message": f"🗑️ {multiple['type']}: {multiple['date_label']}",
    }]) == "🗑️ Restmüll und Biomüll: morgen"
    duplicate = waste_collection_details(
        "1",
        {"upcoming": [{"date": "2026-09-01", "types": ["Restmüll", "Restmüll wird abgeholt.", "Restmüll-Abholung"]}]},
        "Abfall",
        date(2026, 8, 31),
    )
    assert duplicate["type"] == "Restmüll"
