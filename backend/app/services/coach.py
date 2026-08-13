"""Coach agent — practice-mode only (spec extension). Runs once, right after
the adaptive competency phase ends, to produce the full feedback walkthrough
the avatar speaks AND the content the written practice report is built from.
"""

from .. import models
from ..prompts.coach import (
    coach_feedback_system_instruction,
    coach_item_followup_system_instruction,
    coach_session_closing_system_instruction,
    coach_transition_system_instruction,
)
from .gemini_client import generate_json

VALID_EMOTIONS = {"encouraging", "probing", "approving", "neutral"}


def generate_feedback_transition(session: models.Session, persona: dict) -> dict:
    """The line spoken right after the last competency answer, before the
    Coach agent's actual feedback walkthrough starts — see
    interview_loop.py's _transition_to_feedback. Grounded in the last real
    Q&A pair so the acknowledgment reacts to what was actually said instead
    of a generic "let's move on" line."""
    last_turn = next((t for t in reversed(session.turns) if t.answer is not None), None)
    prompt = (
        f"Interview language: {session.language}\n"
        f"Last question asked: {last_turn.question if last_turn else ''}\n"
        f"Candidate's last answer: {last_turn.answer if last_turn else ''}"
    )
    result = generate_json(coach_transition_system_instruction(persona), prompt)
    if result.get("emotion_tag") not in VALID_EMOTIONS:
        result["emotion_tag"] = "encouraging"
    return result


def generate_coaching(session: models.Session, personas: dict, competency_speakers: dict[str, str]) -> dict:
    """`personas`: every interviewer id -> profile present in this session
    (see app/interviewers.py). `competency_speakers`: competency name ->
    interviewer id who asked it live (interview_loop.py's speaker-continuity
    rule — whoever asked a competency also delivers its feedback)."""
    transcript = [
        {
            "index": t.index,
            "question": t.question,
            "answer": t.answer,
            "competency": t.competency.name if t.competency else None,
            "was_followup": t.was_followup,
            "evidence": t.evidence,
        }
        for t in session.turns
    ]
    competencies = [
        {
            "name": c.name,
            "type": c.type,
            "resume_claim": c.resume_claim,
            "covered": c.covered,
            "assessor_notes": c.notes,
            "asked_by": competency_speakers.get(c.name, next(iter(personas))),
        }
        for c in session.competencies
    ]

    prompt = (
        f"Interview language: {session.language}\n"
        f"Role: {session.role_title}\n"
        f"Job description:\n{session.jd_text}\n\n"
        f"Candidate résumé:\n{session.resume_text}\n\n"
        f"Competencies, Assessor notes, and assigned speaker:\n{competencies}\n\n"
        f"Full transcript:\n{transcript}"
    )
    result = generate_json(coach_feedback_system_instruction(personas), prompt)
    result.setdefault("items", [])
    for item in result["items"]:
        if item.get("emotion_tag") not in VALID_EMOTIONS:
            item["emotion_tag"] = "neutral"
        # Attach deterministically from our own mapping rather than trusting
        # the model to echo it back correctly — this is data we already know.
        item["speaker"] = competency_speakers.get(item.get("competency"), next(iter(personas)))
    return result


def generate_feedback_item_followup(session: models.Session, item: dict, candidate_question: str, persona: dict) -> dict:
    """Answers a candidate's follow-up question about ONE already-delivered
    feedback item — see interview_loop.py's per-item follow-up-or-next
    choice."""
    prompt = (
        f"Interview language: {session.language}\n"
        f"Competency: {item.get('competency')}\n"
        f"Feedback already given on this competency: {item}\n\n"
        f"Candidate's follow-up question: {candidate_question}"
    )
    result = generate_json(coach_item_followup_system_instruction(persona), prompt)
    if result.get("emotion_tag") not in VALID_EMOTIONS:
        result["emotion_tag"] = "neutral"
    return result


def generate_feedback_closing(session: models.Session, persona: dict) -> dict:
    """The sign-off spoken once the candidate clicks past the last feedback
    item — see interview_loop.py's _close_feedback_session."""
    result = generate_json(coach_session_closing_system_instruction(persona), f"Interview language: {session.language}")
    if result.get("emotion_tag") not in VALID_EMOTIONS:
        result["emotion_tag"] = "encouraging"
    return result
