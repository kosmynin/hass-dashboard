import ast
import math
import fnmatch
import re
from pathlib import Path
from typing import Any

source = (Path(__file__).parents[1] / "custom_components/smartphone_dashboard/__init__.py").read_text()
tree = ast.parse(source)
names = {"PUBLIC_NOTIFICATION_TYPES", "DISPLAY_ENTITY_LISTS", "NINA_GLOB_RE"}
nodes = [node for node in tree.body if (isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id in names for target in node.targets)) or (isinstance(node, ast.FunctionDef) and node.name == "_public_notification_config")]
namespace = {"Any": Any, "math": math, "fnmatch": fnmatch, "re": re}
exec(compile(ast.Module(body=nodes, type_ignores=[]), "public-display", "exec"), namespace)
sanitize = namespace["_public_notification_config"]

def test_public_display_is_strictly_sanitized():
    config = {"notification_batteries": False, "battery_threshold": 7, "notification_recipients": "notify.private", "battery_exclusions": "sensor.allowed,sensor.denied", "frost_entity": "sensor.allowed", "waste_entities": "sensor.allowed,sensor.missing", "ups_entities": ["sensor.denied"], "nina_entities": "binary_sensor.nina_warning_*", "legacy_helpers": {"secret": "x"}, "errors": ["private"]}
    existing = {"sensor.allowed", "sensor.denied", "binary_sensor.nina_warning_allowed"}
    result = sanitize(config, existing, lambda entity_id: entity_id not in {"sensor.denied"})
    assert result["notification_batteries"] is False and result["battery_threshold"] == 7
    assert result["battery_exclusions"] == "sensor.allowed"
    assert result["frost_entity"] == "sensor.allowed"
    assert result["waste_entities"] == "sensor.allowed" and result["ups_entities"] == ""
    assert result["nina_entities"] == "binary_sensor.nina_warning_*"
    assert "notification_recipients" not in result and "legacy_helpers" not in result and "errors" not in result

def test_nina_falls_back_if_match_is_not_readable_or_missing():
    existing = {"binary_sensor.nina_region_denied", "binary_sensor.nina_other_allowed"}
    denied = sanitize({"notification_nina": True, "nina_entities": "binary_sensor.nina_region_*"}, existing, lambda entity: entity.endswith("allowed"))
    assert denied["notification_nina"] is False
    assert denied["nina_entities"] == "binary_sensor.__smartphone_dashboard_no_access_*"
    assert "other" not in denied["nina_entities"]
    invalid = sanitize({"notification_nina": True, "nina_entities": "bad*"}, set(), lambda _entity: True)
    assert invalid["notification_nina"] is False
    assert invalid["nina_entities"] == "binary_sensor.__smartphone_dashboard_no_access_*"

def test_public_endpoint_is_not_admin_but_full_and_save_are():
    display = source[source.index("async def websocket_get_display_config"):source.index("@websocket_api.websocket_command", source.index("async def websocket_get_display_config"))]
    assert "require_admin" not in display
    assert source.count("@websocket_api.require_admin") == 3
