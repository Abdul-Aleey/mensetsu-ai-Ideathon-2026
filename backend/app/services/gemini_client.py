"""Thin wrapper around Gemini via Vertex AI.

Uses the unified google-genai SDK with vertexai=True (Vertex AI path via
Application Default Credentials) — never the public Gemini API-key path, per
spec §2. This is the ONLY place in the backend that talks to Gemini; the
Planner / Interviewer / Assessor services call `generate_json` and never touch
the SDK directly.
"""

import json
import time
from functools import lru_cache

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from ..config import settings

# Total attempts for a transient Gemini failure (network blip, transient
# 5xx/quota error, or an occasionally truncated/malformed JSON response) —
# confirmed live as the cause of "something went wrong, please try
# answering again" surfacing to the candidate on an otherwise normal turn.
# Retrying here fixes it at the source instead of failing the whole
# request; a genuinely persistent failure still raises after these attempts.
_MAX_ATTEMPTS = 3

# APIError.code values that mean the request itself is broken (bad prompt,
# bad auth, wrong resource) rather than a transient condition — retrying
# these would just wait ~1.5s across identical, deterministically-failing
# attempts before raising anyway. 429 (rate limit) is deliberately NOT
# here — that one genuinely is worth retrying.
_NON_RETRYABLE_CODES = {400, 401, 403, 404}


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
    last_error: Exception | None = None
    for attempt in range(_MAX_ATTEMPTS):
        try:
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
        except Exception as exc:
            if isinstance(exc, genai_errors.APIError) and exc.code in _NON_RETRYABLE_CODES:
                raise
            last_error = exc
            if attempt < _MAX_ATTEMPTS - 1:
                time.sleep(0.5 * (attempt + 1))
    raise last_error
