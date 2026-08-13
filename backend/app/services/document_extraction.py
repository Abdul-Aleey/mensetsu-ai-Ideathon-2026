import io

import docx
from fastapi import UploadFile
from pypdf import PdfReader


async def extract_text(file: UploadFile) -> str:
    """Extract plain text from an uploaded PDF or DOCX file."""
    raw = await file.read()
    filename = (file.filename or "").lower()

    if filename.endswith(".pdf"):
        return _extract_pdf(raw)
    if filename.endswith(".docx"):
        return _extract_docx(raw)

    raise ValueError(f"Unsupported file type: {file.filename!r} — expected .pdf or .docx")


def _extract_pdf(raw: bytes) -> str:
    reader = PdfReader(io.BytesIO(raw))
    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n".join(pages).strip()


def _extract_docx(raw: bytes) -> str:
    document = docx.Document(io.BytesIO(raw))
    paragraphs = [p.text for p in document.paragraphs]
    return "\n".join(paragraphs).strip()


def extract_docx_bytes(raw: bytes) -> str:
    """Same DOCX extraction as extract_text(), for callers that already have
    raw bytes instead of an UploadFile — e.g. files fetched from GCS rather
    than uploaded through the API (see services/sample_data.py)."""
    return _extract_docx(raw)
