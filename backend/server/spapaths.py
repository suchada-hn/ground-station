from pathlib import Path


def is_static_asset_request(full_path: str) -> bool:
    return full_path.startswith(("static/", "assets/")) or full_path == "favicon.ico"


def resolve_static_asset_path(static_root: Path, full_path: str) -> Path:
    resolved_path = (static_root / full_path).resolve()
    resolved_path.relative_to(static_root)
    return resolved_path
