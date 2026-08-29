"""Constants for Smartphone Dashboard."""
from pathlib import Path

DOMAIN = "smartphone_dashboard"
VERSION = "22.0.13"
STORAGE_KEY = f"{DOMAIN}.config"
STORAGE_VERSION = 3
FRONTEND_DIR = Path(__file__).parent / "frontend"
STATIC_URL = f"/smartphone-dashboard/v{VERSION}"
MODULE_URL = f"{STATIC_URL}/smartphone-dashboard-loader.js"

HELPER_ENTITY_IDS = (
    "input_boolean.smartphone_meldung_batterien", "input_boolean.smartphone_meldung_kontakte",
    "input_boolean.smartphone_meldung_co2", "input_boolean.smartphone_meldung_abfall",
    "input_boolean.smartphone_meldung_usv", "input_boolean.smartphone_meldung_frost",
    "input_boolean.smartphone_meldung_nina", "input_number.smartphone_batterie_grenzwert",
    "input_number.smartphone_kontakt_minuten", "input_number.smartphone_co2_grenzwert",
    "input_number.smartphone_frost_grenzwert", "input_text.smartphone_benachrichtigung_empfaenger",
    "input_text.smartphone_batterie_ausnahmen", "input_text.smartphone_frost_sensor",
    "input_text.smartphone_abfall_sensoren", "input_text.smartphone_usv_sensoren",
    "input_text.smartphone_nina_muster",
)
