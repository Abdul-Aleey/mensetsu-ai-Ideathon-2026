from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

# SQLite file next to server.py — fine for a single concurrent user. Not
# configurable via env var on purpose: there's only one real value this
# ever takes right now, so making it "swappable" just adds indirection
# nothing currently uses.
engine = create_engine("sqlite:///./mensetsu.db", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from . import models  # noqa: F401 — ensure models are registered before create_all

    Base.metadata.create_all(bind=engine)
    _add_missing_columns()


# create_all() only creates tables that don't exist yet — it never alters an
# existing table to add a newly-added model column. Locally that's fixed by
# just deleting mensetsu.db, but production's DB file is persisted in GCS
# (see services/db_sync.py) and survives across deploys, so a schema change
# here would otherwise 500 every request that touches the new column until
# someone manually resets the GCS-persisted file. Safe to run on every
# startup: skips any column that's already there, and a brand new table
# from create_all() above already has every column, so this is a no-op for
# it.
_NEW_COLUMNS = {
    "sessions": [
        ("mode", "VARCHAR DEFAULT 'hiring'"),
        ("interviewers_json", "JSON DEFAULT '[\"alex\"]'"),
        ("last_speaker", "VARCHAR DEFAULT 'alex'"),
        ("feedback_step", "INTEGER DEFAULT 0"),
        ("feedback_pending_kind", "VARCHAR"),
        ("coaching_json", "JSON"),
    ],
    "turns": [
        ("speaker", "VARCHAR DEFAULT 'alex'"),
    ],
    "reports": [
        ("panel_synthesis_json", "JSON"),
    ],
}


def _add_missing_columns() -> None:
    with engine.connect() as conn:
        for table, columns in _NEW_COLUMNS.items():
            existing = {row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")}
            for name, ddl in columns:
                if name not in existing:
                    conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
        conn.commit()
