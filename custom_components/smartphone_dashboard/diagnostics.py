"""Diagnostics without entity IDs, recipients or message content."""
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from .const import DOMAIN, VERSION

async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: ConfigEntry):
    runtime = hass.data[DOMAIN][entry.entry_id]
    data = runtime["manager"].data
    health = data.get("notifications", {}).get("health", {})
    dashboards = data.get("dashboards", {})
    migration = data.get("migration", {})
    migration_task = runtime["coordinator"]._migration_task
    return {
        "version": VERSION, "schema": data.get("schema"),
        "migration": {"seeded": bool(migration.get("seeded")), "valid_helper_count": int(migration.get("legacy_helpers_found", 0)), "expected_helper_count": int(migration.get("legacy_helpers_expected", 17)), "mode": migration.get("mode")},
        "legacy_compatibility": {"seeded": bool(migration.get("seeded")), "valid_helper_count": int(migration.get("legacy_helpers_found", 0)), "polling": bool(migration_task and not migration_task.done())},
        "notification_health": {"active": health.get("active"), "alerts": health.get("alerts"), "recipient_count": len(health.get("recipients", [])), "error_count": len(health.get("errors", []))},
        "dashboard_count": len(dashboards),
        "dashboard_revisions": sorted(int(item.get("revision", 0)) for item in dashboards.values() if isinstance(item, dict)),
    }
