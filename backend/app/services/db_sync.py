"""Backs the local SQLite file with GCS so demo data survives Cloud Run
instance restarts/cold starts (local disk alone is wiped whenever an
instance is replaced). Only meaningful when GCS_BUCKET is set — no-ops
locally, where the file on disk is already permanent on its own.

google-cloud-storage is imported lazily so this module still loads fine
without the package installed/configured (same pattern as storage.py).
"""

from pathlib import Path

from ..config import settings

DB_PATH = Path("mensetsu.db")
DB_BLOB_NAME = "avatar-hack/db/mensetsu.db"


def download_db_on_startup() -> None:
    """Restores the last-synced DB from GCS before init_db() runs.

    A missing object is the expected, normal case on the very first-ever
    deploy — not an error. When that happens we just proceed with a fresh
    local file; init_db() creates its tables, and the first upload_db_now()
    call (after the first write) creates the GCS object for the first time.
    """
    if not settings.gcs_bucket:
        return

    try:
        from google.cloud import storage

        blob = storage.Client().bucket(settings.gcs_bucket).blob(DB_BLOB_NAME)
        if blob.exists():
            blob.download_to_filename(str(DB_PATH))
    except Exception:
        # GCS unreachable (e.g. no Application Default Credentials in local
        # dev) — proceed with whatever local file already exists rather than
        # crashing app startup. Same posture as gemini_client.check_connection.
        pass


def upload_db_now() -> None:
    """Pushes the current local DB file up to GCS. Call this after any
    request that writes to the database, so the GCS copy never falls far
    behind what a candidate/hiring manager just did."""
    if not settings.gcs_bucket:
        return

    from google.cloud import storage

    blob = storage.Client().bucket(settings.gcs_bucket).blob(DB_BLOB_NAME)
    blob.upload_from_filename(str(DB_PATH))
