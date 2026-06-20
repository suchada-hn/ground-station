# flake8: noqa
# pylint: skip-file
# type: ignore

import json
import logging
import os
import sys
from typing import Any, Dict, List, Optional

from hardware.uhdprobe import probe_uhd_usrp

logger = logging.getLogger("uhd-usbenum")

# Try to import UHD with path handling
uhd = None
try:
    # Add common UHD installation paths
    uhd_paths = [
        "/usr/local/lib/python3.12/site-packages",
        "/usr/lib/python3/dist-packages",
        "/opt/uhd/lib/python3.12/site-packages",
    ]

    for path in uhd_paths:
        if os.path.exists(os.path.join(path, "uhd")) and path not in sys.path:
            sys.path.insert(0, path)
            break

    import uhd
except ImportError:
    pass


def _parse_device_args_string(value: str) -> Dict[str, str]:
    parsed: Dict[str, str] = {}
    for token in str(value or "").split(","):
        token = token.strip()
        if not token or "=" not in token:
            continue
        key, raw_value = token.split("=", 1)
        key = key.strip()
        raw_value = raw_value.strip()
        if key:
            parsed[key] = raw_value
    return parsed


def _build_label(index: int, attrs: Dict[str, str]) -> str:
    product = (
        str(attrs.get("product", "")).strip()
        or str(attrs.get("name", "")).strip()
        or str(attrs.get("type", "")).strip()
        or "UHD Device"
    )
    serial = str(attrs.get("serial", "")).strip()
    if serial:
        return f"{product} / {serial}"
    return f"{product} #{index}"


def probe_available_uhd_devices() -> str:
    """
    List and return information about all discoverable local UHD/USRP devices.

    Returns:
        JSON string containing:
            - success: Boolean indicating success
            - data: List of device dictionaries with:
                - device_index: Device index in discovery output
                - label: Human-readable device label
                - serial: Device serial if available
                - device_args: UHD device args string
                - antennas: Dictionary of available RX/TX antennas
                - frequency_ranges: RX/TX frequency ranges in MHz when available
            - error: Error message if any
            - log: List of log messages
    """

    log_messages: List[str] = []
    devices: List[Dict[str, Any]] = []
    success: Optional[bool] = None
    error: Optional[str] = None

    log_messages.append("Enumerating available UHD/USRP devices")

    if uhd is None:
        log_messages.append(
            "ERROR: UHD library not found. Please ensure UHD Python bindings are installed."
        )
        reply: Dict[str, Any] = {
            "success": False,
            "data": [],
            "error": "UHD library not available",
            "log": log_messages,
        }
        return json.dumps(reply)

    try:
        discovered_devices = uhd.find("")
        log_messages.append(f"Found {len(discovered_devices)} UHD/USRP device(s)")

        for index, discovered in enumerate(discovered_devices):
            raw_args = (
                discovered.to_string() if hasattr(discovered, "to_string") else str(discovered)
            )
            attrs = _parse_device_args_string(raw_args)
            serial = str(attrs.get("serial", "")).strip()

            entry: Dict[str, Any] = {
                "device_index": index,
                "label": _build_label(index, attrs),
                "serial": serial,
                "device_args": raw_args,
                "antennas": {"rx": [], "tx": []},
                "frequency_ranges": {},
            }

            # Preserve common UHD attributes for UI diagnostics and future UX use.
            for key in ("type", "name", "product", "addr", "resource", "mgmt_addr"):
                value = str(attrs.get(key, "")).strip()
                if value:
                    entry[key] = value

            # Reuse the existing UHD probe flow to keep capability gathering consistent.
            probe_details: Dict[str, Any] = {}
            if serial:
                probe_details["serial"] = serial
            elif raw_args:
                probe_details["device_args"] = raw_args

            if probe_details:
                probe_reply = probe_uhd_usrp(probe_details)
                probe_logs = probe_reply.get("log") or []
                if isinstance(probe_logs, list):
                    for line in probe_logs:
                        text = str(line).strip()
                        if text:
                            log_messages.append(f"probe[{entry['label']}]: {text}")

                if probe_reply.get("success"):
                    probe_data = probe_reply.get("data") or {}
                    entry["antennas"] = probe_data.get("antennas") or {"rx": [], "tx": []}
                    entry["frequency_ranges"] = probe_data.get("frequency_ranges") or {}
                else:
                    probe_error = probe_reply.get("error") or "unknown probe error"
                    log_messages.append(
                        f"WARNING: Could not probe UHD capabilities for {entry['label']}: {probe_error}"
                    )

            log_messages.append(f"Found UHD/USRP device: {entry['label']}")
            devices.append(entry)

        success = True

    except Exception as exc:
        log_messages.append(f"Error: Error enumerating UHD/USRP devices: {str(exc)}")
        log_messages.append(f"Exception: {str(exc)}")
        success = False
        error = str(exc)

    reply = {
        "success": success,
        "data": devices,
        "error": error,
        "log": log_messages,
    }
    return json.dumps(reply)
