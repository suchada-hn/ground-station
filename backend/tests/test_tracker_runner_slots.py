# Copyright (c) 2026 Efstratios Goudelis

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from db.models import TrackingState
from tracker import instances as tracker_instances
from tracker.contracts import get_tracking_state_name
from tracker.runner import TrackerSupervisor


def _set_target_limit(monkeypatch, limit: int) -> None:
    monkeypatch.setattr("tracker.runner.arguments.max_tracker_targets", limit, raising=False)


def test_target_slot_allocator_reuses_lowest_free_slot(monkeypatch):
    _set_target_limit(monkeypatch, 10)
    supervisor = TrackerSupervisor()

    assert supervisor.ensure_tracker_for_rotator("rot-1")["tracker_id"] == "target-1"
    assert supervisor.ensure_tracker_for_rotator("rot-2")["tracker_id"] == "target-2"
    assert supervisor.ensure_tracker_for_rotator("rot-3")["tracker_id"] == "target-3"

    remove_reply = supervisor.remove_tracker("target-2")
    assert remove_reply["success"] is True

    reuse_reply = supervisor.ensure_tracker_for_rotator("rot-4")
    assert reuse_reply["success"] is True
    assert reuse_reply["tracker_id"] == "target-2"


def test_target_slot_allocator_enforces_configured_limit(monkeypatch):
    _set_target_limit(monkeypatch, 2)
    supervisor = TrackerSupervisor()

    assert supervisor.ensure_tracker_for_rotator("rot-1")["tracker_id"] == "target-1"
    assert supervisor.ensure_tracker_for_rotator("rot-2")["tracker_id"] == "target-2"

    limit_reply = supervisor.ensure_tracker_for_rotator("rot-3")
    assert limit_reply["success"] is False
    assert limit_reply["error"] == "tracker_slot_limit_reached"
    assert limit_reply["data"]["limit"] == 2
    assert limit_reply["data"]["active_targets"] == 2


def test_observation_slots_do_not_consume_target_slot_limit(monkeypatch):
    _set_target_limit(monkeypatch, 1)
    supervisor = TrackerSupervisor()

    observation_reply = supervisor.create_observation_tracker_slot("obs-pass-1")
    assert observation_reply["success"] is True
    observation_tracker_id = observation_reply["tracker_id"]
    assert observation_tracker_id.startswith("obs-")

    assign_reply = supervisor.assign_rotator(observation_tracker_id, "rot-obs")
    assert assign_reply["success"] is True

    target_reply = supervisor.ensure_tracker_for_rotator("rot-target")
    assert target_reply["success"] is True
    assert target_reply["tracker_id"] == "target-1"


def test_instances_payload_uses_target_number_only_for_target_slots(monkeypatch):
    _set_target_limit(monkeypatch, 5)
    supervisor = TrackerSupervisor()

    target_reply = supervisor.ensure_tracker_for_rotator("rot-1")
    observation_reply = supervisor.create_observation_tracker_slot("obs-pass-2")
    supervisor.assign_rotator(observation_reply["tracker_id"], "rot-obs-2")

    instances = supervisor.get_instances_payload()["instances"]
    target_instance = next(
        row for row in instances if row["tracker_id"] == target_reply["tracker_id"]
    )
    observation_instance = next(
        row for row in instances if row["tracker_id"] == observation_reply["tracker_id"]
    )

    assert target_instance["target_number"] == 1
    assert observation_instance["target_number"] is None


@pytest.mark.asyncio
async def test_startup_restore_removes_stale_observation_tracker_state(db_engine, monkeypatch):
    async_session = async_sessionmaker(
        db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    target_state_name = get_tracking_state_name("target-1")
    observation_state_name = get_tracking_state_name("obs-123")

    async with async_session() as session:
        session.add_all(
            [
                TrackingState(
                    name=target_state_name,
                    value={
                        "norad_id": 25544,
                        "rotator_id": "rot-1",
                        "rotator_state": "connected",
                        "rig_id": "none",
                        "rig_state": "disconnected",
                    },
                ),
                TrackingState(
                    name=observation_state_name,
                    value={
                        "norad_id": 57166,
                        "rotator_id": "none",
                        "rotator_state": "disconnected",
                        "rig_id": "none",
                        "rig_state": "disconnected",
                    },
                ),
            ]
        )
        await session.commit()

    class _Manager:
        async def sync_tracking_state_from_db(self):
            return None

    manager_calls = []
    assignment_calls = []

    monkeypatch.setattr(tracker_instances, "AsyncSessionLocal", async_session)
    monkeypatch.setattr(
        tracker_instances,
        "get_tracker_manager",
        lambda tracker_id: manager_calls.append(tracker_id) or _Manager(),
    )
    monkeypatch.setattr(
        tracker_instances,
        "assign_rotator_to_tracker",
        lambda tracker_id, rotator_id: assignment_calls.append((tracker_id, rotator_id)),
    )

    restored = await tracker_instances.restore_tracker_instances_from_db()

    assert restored == ["target-1"]
    assert manager_calls == ["target-1"]
    assert assignment_calls == [("target-1", "rot-1")]

    async with async_session() as session:
        result = await session.execute(select(TrackingState.name).order_by(TrackingState.name))
        state_names = result.scalars().all()

    assert state_names == [target_state_name]
