"""clean break celestial vectors schema

Revision ID: f1c2d3e4a5b6
Revises: e3b6a1d9f2c7
Create Date: 2026-06-02 22:15:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f1c2d3e4a5b6"
down_revision: Union[str, None] = "e3b6a1d9f2c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Clean break: retire the legacy vectors cache table before introducing
    # explicit target and snapshot tables.
    op.drop_index("ix_celestial_vectors_cache_lookup", table_name="celestial_vectors_cache")
    op.drop_index("ix_celestial_vectors_cache_expires_at", table_name="celestial_vectors_cache")
    op.drop_index(
        "ix_celestial_vectors_cache_epoch_bucket_utc",
        table_name="celestial_vectors_cache",
    )
    op.drop_index("ix_celestial_vectors_cache_command", table_name="celestial_vectors_cache")
    op.drop_table("celestial_vectors_cache")

    op.create_table(
        "celestial_targets",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("target_type", sa.String(), nullable=False),
        sa.Column("body_class", sa.String(), nullable=True),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("horizons_command", sa.String(), nullable=True),
        sa.Column("body_id", sa.String(), nullable=True),
        sa.Column("parent_body_id", sa.String(), nullable=True),
        sa.Column("always_in_scene", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_celestial_targets_target_type", "celestial_targets", ["target_type"])
    op.create_index("ix_celestial_targets_body_class", "celestial_targets", ["body_class"])
    op.create_index(
        "ix_celestial_targets_horizons_command", "celestial_targets", ["horizons_command"]
    )
    op.create_index("ix_celestial_targets_body_id", "celestial_targets", ["body_id"])
    op.create_index("ix_celestial_targets_parent_body_id", "celestial_targets", ["parent_body_id"])
    op.create_index(
        "ix_celestial_targets_always_in_scene", "celestial_targets", ["always_in_scene"]
    )
    op.create_index("ix_celestial_targets_enabled", "celestial_targets", ["enabled"])

    op.create_table(
        "celestial_vector_snapshots",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("target_id", sa.String(), nullable=False),
        sa.Column("epoch_bucket_utc", sa.DateTime(), nullable=False),
        sa.Column("past_hours", sa.Integer(), nullable=False),
        sa.Column("future_hours", sa.Integer(), nullable=False),
        sa.Column("step_minutes", sa.Integer(), nullable=False),
        sa.Column("frame", sa.String(), nullable=False, server_default="heliocentric-ecliptic"),
        sa.Column("center", sa.String(), nullable=False, server_default="sun"),
        sa.Column("position_xyz_au", sa.JSON(), nullable=False),
        sa.Column("velocity_xyz_au_per_day", sa.JSON(), nullable=False),
        sa.Column("orbit_samples_xyz_au", sa.JSON(), nullable=False),
        sa.Column("orbit_sample_times_utc", sa.JSON(), nullable=False),
        sa.Column("horizons_signature", sa.JSON(), nullable=True),
        sa.Column("source", sa.String(), nullable=False, server_default="horizons"),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["target_id"], ["celestial_targets.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_celestial_vector_snapshots_target_id",
        "celestial_vector_snapshots",
        ["target_id"],
    )
    op.create_index(
        "ix_celestial_vector_snapshots_epoch_bucket_utc",
        "celestial_vector_snapshots",
        ["epoch_bucket_utc"],
    )
    op.create_index(
        "ix_celestial_vector_snapshots_expires_at",
        "celestial_vector_snapshots",
        ["expires_at"],
    )
    op.create_index(
        "ix_celestial_vector_snapshots_lookup",
        "celestial_vector_snapshots",
        [
            "target_id",
            "epoch_bucket_utc",
            "past_hours",
            "future_hours",
            "step_minutes",
            "frame",
            "center",
        ],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_celestial_vector_snapshots_lookup", table_name="celestial_vector_snapshots")
    op.drop_index(
        "ix_celestial_vector_snapshots_expires_at",
        table_name="celestial_vector_snapshots",
    )
    op.drop_index(
        "ix_celestial_vector_snapshots_epoch_bucket_utc",
        table_name="celestial_vector_snapshots",
    )
    op.drop_index(
        "ix_celestial_vector_snapshots_target_id",
        table_name="celestial_vector_snapshots",
    )
    op.drop_table("celestial_vector_snapshots")

    op.drop_index("ix_celestial_targets_enabled", table_name="celestial_targets")
    op.drop_index("ix_celestial_targets_always_in_scene", table_name="celestial_targets")
    op.drop_index("ix_celestial_targets_parent_body_id", table_name="celestial_targets")
    op.drop_index("ix_celestial_targets_body_id", table_name="celestial_targets")
    op.drop_index("ix_celestial_targets_horizons_command", table_name="celestial_targets")
    op.drop_index("ix_celestial_targets_body_class", table_name="celestial_targets")
    op.drop_index("ix_celestial_targets_target_type", table_name="celestial_targets")
    op.drop_table("celestial_targets")

    op.create_table(
        "celestial_vectors_cache",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("command", sa.String(), nullable=False),
        sa.Column("epoch_bucket_utc", sa.DateTime(), nullable=False),
        sa.Column("past_hours", sa.Integer(), nullable=False),
        sa.Column("future_hours", sa.Integer(), nullable=False),
        sa.Column("step_minutes", sa.Integer(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("source", sa.String(), nullable=False, server_default="horizons"),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_celestial_vectors_cache_command",
        "celestial_vectors_cache",
        ["command"],
        unique=False,
    )
    op.create_index(
        "ix_celestial_vectors_cache_epoch_bucket_utc",
        "celestial_vectors_cache",
        ["epoch_bucket_utc"],
        unique=False,
    )
    op.create_index(
        "ix_celestial_vectors_cache_expires_at",
        "celestial_vectors_cache",
        ["expires_at"],
        unique=False,
    )
    op.create_index(
        "ix_celestial_vectors_cache_lookup",
        "celestial_vectors_cache",
        ["command", "epoch_bucket_utc", "past_hours", "future_hours", "step_minutes"],
        unique=True,
    )
