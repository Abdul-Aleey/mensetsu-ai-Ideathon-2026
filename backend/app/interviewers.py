"""Static registry of the two interviewer personas — the single source of
truth both the prompt layer (name/bio, for tone) and the frontend config
endpoint (Perxona avatar/scene/voice targets) read from. Not user-editable;
just two fixed entries for this product.
"""

from .config import settings

INTERVIEWER_PROFILES = {
    "alex": {
        "display_name": "Alex",
        "bio": (
            "A background in engineering and technical hiring. Direct and "
            "structured — good at drawing out concrete specifics rather than "
            "letting a vague answer slide."
        ),
        "avatar_id": settings.perxona_presenter_avatar_id,
        "scene_id": settings.perxona_presenter_scene_id,
        "voice_id": settings.perxona_presenter_voice_id,
    },
    "sara": {
        "display_name": "Sara",
        "bio": (
            "A background in HR and people operations. Warm and "
            "conversational — puts candidates at ease while still probing "
            "for real substance."
        ),
        "avatar_id": settings.perxona_sara_avatar_id,
        "scene_id": settings.perxona_sara_scene_id,
        "voice_id": settings.perxona_sara_voice_id,
    },
}

VALID_INTERVIEWERS = set(INTERVIEWER_PROFILES)


def get_profile(interviewer_id: str) -> dict:
    return INTERVIEWER_PROFILES[interviewer_id]
