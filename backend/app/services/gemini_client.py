"""Thin wrapper around Gemini via Vertex AI.

Uses the unified google-genai SDK with vertexai=True (Vertex AI path via
Application Default Credentials) — never the public Gemini API-key path, per
spec §2. This is the ONLY place in the backend that talks to Gemini; the
Planner / Interviewer / Assessor services call `generate_json` and never touch
the SDK directly.
"""

import json
from functools import lru_cache

from google import genai
from google.genai import types

from ..config import settings


@lru_cache
def _client() -> genai.Client:
    return genai.Client(
        vertexai=True,
        project=settings.google_cloud_project,
        location=settings.google_cloud_location,
    )


def check_connection() -> bool:
    """Cheap, real connectivity check — lists models rather than generating
    content, so it doesn't burn generation quota. Used only for the UI status
    dot; any failure (missing project, no ADC, network) just means "red."
    """
    if not settings.google_cloud_project:
        return False
    try:
        next(iter(_client().models.list()), None)
        return True
    except Exception:
        return False


def generate_json(system_instruction: str, prompt: str) -> dict:
    """Call Gemini and parse a JSON object response.

    Every agent role (Planner, Interviewer/Router, Assessor, Report) uses this
    — they differ only in their system_instruction and prompt, and in what
    shape of JSON they expect back.
    """
    response = _client().models.generate_content(
        model=settings.gemini_model,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
            response_mime_type="application/json",
            temperature=0.4,
        ),
    )
    return json.loads(response.text)
