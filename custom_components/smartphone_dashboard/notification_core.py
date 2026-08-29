"""Pure notification helpers shared by runtime and tests."""
from __future__ import annotations
import re

def valid_nina_glob(value: str) -> bool:
    return bool(re.fullmatch(r"binary_sensor\.[a-zA-Z0-9_]+\*[a-zA-Z0-9_]*", value))

def pending_fingerprints(active: list[str], delivered: list[str]) -> list[str]:
    seen = set(delivered)
    return [fingerprint for fingerprint in dict.fromkeys(active) if fingerprint not in seen]

def retained_fingerprints(active: list[str], delivered: list[str], successful: list[str]) -> list[str]:
    keep = set(delivered) | set(successful)
    return [fingerprint for fingerprint in dict.fromkeys(active) if fingerprint in keep]
