"""Object storage for generated report PDFs.

Seam: if GCS_BUCKET is set, PDFs go to Google Cloud Storage — required for a
real Cloud Run deployment, since each instance's local filesystem is
ephemeral and not shared, so a PDF written to disk by one instance may be
unreachable (404) when a later request lands on a different instance or
after a restart. If GCS_BUCKET is unset, falls back to local disk under
settings.pdf_dir — fine for local development, not safe once Cloud Run scales
past a single always-on instance.

google-cloud-storage is imported lazily so this module (and everything that
imports it) still loads fine without the package installed/configured.
"""

from pathlib import Path

from ..config import settings

GCS_PREFIX = "gs://"


def save_report_pdf(pdf_bytes: bytes, session_id: str) -> str:
    """Persists the PDF and returns an opaque path — pass it to
    load_report_pdf() later to retrieve the same bytes, regardless of which
    backend (GCS or local disk) actually stored it."""
    if settings.gcs_bucket:
        from google.cloud import storage  # lazy import — see module docstring

        client = storage.Client()
        blob = client.bucket(settings.gcs_bucket).blob(f"avatar-hack/result/{session_id}.pdf")
        blob.upload_from_string(pdf_bytes, content_type="application/pdf")
        return f"{GCS_PREFIX}{settings.gcs_bucket}/avatar-hack/result/{session_id}.pdf"

    path = Path(settings.pdf_dir) / f"{session_id}.pdf"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(pdf_bytes)
    return str(path)


def load_report_pdf(pdf_path: str) -> bytes | None:
    """Returns None if the PDF can't be found — callers should 404, not 500."""
    if pdf_path.startswith(GCS_PREFIX):
        from google.cloud import storage  # lazy import — see module docstring

        bucket_name, _, blob_name = pdf_path[len(GCS_PREFIX) :].partition("/")
        blob = storage.Client().bucket(bucket_name).blob(blob_name)
        if not blob.exists():
            return None
        return blob.download_as_bytes()

    path = Path(pdf_path)
    if not path.exists():
        return None
    return path.read_bytes()
