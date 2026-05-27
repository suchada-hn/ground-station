from pathlib import Path

import pytest

from server.spapaths import is_static_asset_request, resolve_static_asset_path


def test_is_static_asset_request_expected_prefixes():
    assert is_static_asset_request("static/js/app.js")
    assert is_static_asset_request("assets/logo.png")
    assert is_static_asset_request("favicon.ico")
    assert not is_static_asset_request("dashboard")


def test_resolve_static_asset_path_rejects_traversal(tmp_path: Path):
    static_root = (tmp_path / "dist").resolve()
    (static_root / "static").mkdir(parents=True)
    (tmp_path / "secrets.txt").write_text("secret", encoding="utf-8")

    with pytest.raises(ValueError):
        resolve_static_asset_path(static_root, "static/../../secrets.txt")


def test_resolve_static_asset_path_allows_valid_path(tmp_path: Path):
    static_root = (tmp_path / "dist").resolve()
    asset_path = static_root / "static" / "app.js"
    asset_path.parent.mkdir(parents=True)
    asset_path.write_text("console.log('ok')", encoding="utf-8")

    resolved = resolve_static_asset_path(static_root, "static/app.js")

    assert resolved == asset_path.resolve()
