"""Fetches the fixed Data Analyst JD/résumé pair used by the "Demo" shortcut
on Setup — lets a live demo skip the file picker without touching anything
else about how a session is built. See routers/sessions.py's POST
/sessions/demo, which is otherwise identical to the normal create_session.
"""

from .document_extraction import extract_docx_bytes
from ..config import settings

SAMPLE_DATA_PREFIX = "avatar-hack/sample-data"


def fetch_demo_documents() -> tuple[str, str]:
    """Returns (jd_text, resume_text) downloaded from GCS. Raises RuntimeError
    if GCS_BUCKET isn't configured or the files aren't there — the demo
    shortcut only works where it was actually set up, and should fail loudly
    rather than silently falling back to something unexpected mid-demo."""
    if not settings.gcs_bucket:
        raise RuntimeError("GCS_BUCKET isn't configured — the demo shortcut needs the sample files in GCS.")

    from google.cloud import storage  # lazy import — see services/storage.py

    try:
        bucket = storage.Client().bucket(settings.gcs_bucket)
        jd_blob = bucket.blob(f"{SAMPLE_DATA_PREFIX}/job_description_data_analyst.docx")
        resume_blob = bucket.blob(f"{SAMPLE_DATA_PREFIX}/resume_data_analyst.docx")

        if not jd_blob.exists() or not resume_blob.exists():
            raise RuntimeError(f"Demo sample files not found in GCS at {SAMPLE_DATA_PREFIX}/.")

        jd_text = extract_docx_bytes(jd_blob.download_as_bytes())
        resume_text = extract_docx_bytes(resume_blob.download_as_bytes())
    except RuntimeError:
        raise
    except Exception as exc:
        # Covers GCS/auth failures (e.g. no Application Default Credentials
        # locally) — surfaces as the same clean 503 the caller already
        # handles, instead of an opaque 500 from a raw google-cloud exception.
        raise RuntimeError(f"Couldn't fetch the demo sample files from GCS: {exc}") from exc

    return jd_text, resume_text
