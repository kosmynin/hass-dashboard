import ast
import json
import math
import re
from pathlib import Path
from typing import Any

class Invalid(Exception): pass
class Vol: Invalid = Invalid

source = (Path(__file__).parents[1] / "custom_components/smartphone_dashboard/__init__.py").read_text()
tree = ast.parse(source)
function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "_valid_config")
namespace = {"json": json, "math": math, "re": re, "vol": Vol, "Any": Any}
exec(compile(ast.Module(body=[function], type_ignores=[]), "validation", "exec"), namespace)
validate = namespace["_valid_config"]

def rejected(value):
    try: validate(value)
    except Invalid: return True
    return False

def test_nonfinite_numbers_are_rejected_recursively():
    assert rejected({"future": {"value": float("nan")}})
    assert rejected({"features": {"system": {"future": [float("inf")]}}})
    assert rejected({"waste_days": -1})
    assert rejected({"waste_days": 31})
    assert validate({"waste_days": 0}) == {"waste_days": 0}

def test_malformed_known_feature_shapes_are_rejected():
    assert rejected({"features": {"printer": {"enabled": "nein"}}})
    assert rejected({"features": {"printer": {"auto_discover": []}}})
    assert rejected({"features": {"printer": {"printer_ids": [3]}}})
    assert rejected({"features": {"system": {"system_colors": {"cpu": "url(javascript:x)"}}}})
    assert rejected({"features": {"system": {"system_groups": [{"id": "x", "pattern": "["}]}}})
    assert rejected({"features": {"security": {"master_alarm": "switch.alarmanlage"}}})
    assert validate({"features": {"security": {"master_alarm": "alarm_control_panel.master"}}})

def test_valid_forward_compatible_feature_data_survives():
    value = {"features": {"printer": {"enabled": True, "auto_discover": False, "printer_ids": ["device_1"], "future": {"finite": 2}}}}
    assert validate(value) is value


def test_doorbell_accepts_only_companion_recipients_and_a_boolean_switch():
    for phones in ("", "notify.mobile_app_first, notify.mobile_app_second"):
        assert validate({"notification_doorbell": True, "doorbell_recipients": phones})
    for invalid in (True, ["notify.mobile_app_phone"], "notify.everyone", "notify.mobile_app_"):
        assert rejected({"doorbell_recipients": invalid})
    assert rejected({"notification_doorbell": "on"})


def test_room_entity_name_modes_are_validated():
    value = {
        "rooms": [{
            "area_id": "kitchen",
            "entity_name_modes": {"light.worktop": "entity", "switch.socket": "device"},
        }],
    }
    assert validate(value) is value
    for modes in ([], {"light.worktop": "short"}, {"worktop": "entity"}):
        assert rejected({"rooms": [{"area_id": "kitchen", "entity_name_modes": modes}]})
