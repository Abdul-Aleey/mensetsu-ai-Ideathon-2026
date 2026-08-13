"""Coach agent — practice-mode only (spec extension). Runs once, right after
the adaptive competency phase ends, to produce the full feedback walkthrough
the avatar speaks AND the content the written practice report is built from.
"""

from .. import models
from ..prompts.coach import (
    coach_feedback_system_instruction,
    coach_handover_qna_system_instruction,
    coach_handover_response_system_instruction,
    coach_qna_response_system_instruction,
)
from .gemini_client import generate_json

VALID_EMOTIONS = {"encouraging", "probing", "approving", "neutral"}


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
    if result.get("qna_emotion_tag") not in VALID_EMOTIONS:
        result["qna_emotion_tag"] = "encouraging"
    return result


def generate_handover_qna_prompt(persona: dict, next_persona: dict, language: str) -> dict:
    """Asked by the interviewer who just finished their own feedback items,
    right before handing off to the other interviewer for the rest —
    see interview_loop.py's feedback-phase handover gate."""
    prompt = f"Interview language: {language}"
    result = generate_json(coach_handover_qna_system_instruction(persona, next_persona), prompt)
    if result.get("emotion_tag") not in VALID_EMOTIONS:
        result["emotion_tag"] = "encouraging"
    return result


def generate_handover_qna_response(
    session: models.Session, delivered_items: list[dict], candidate_reply: str, persona: dict, next_persona: dict
) -> dict:
    prompt = (
        f"Interview language: {session.language}\n"
        f"Feedback {persona['display_name']} already gave (items): {delivered_items}\n\n"
        f"Candidate's reply to 'do you have any questions for me': {candidate_reply}"
    )
    result = generate_json(coach_handover_response_system_instruction(persona, next_persona), prompt)
    if result.get("emotion_tag") not in VALID_EMOTIONS:
        result["emotion_tag"] = "neutral"
    return result


def generate_coaching_qna_response(session: models.Session, coaching: dict, candidate_reply: str, persona: dict) -> dict:
    prompt = (
        f"Interview language: {session.language}\n"
        f"Feedback already given (items): {coaching.get('items', [])}\n"
        f"Overall summary already given: {coaching.get('overall_summary', '')}\n\n"
        f"Candidate's reply to 'do you have any questions about this feedback': {candidate_reply}"
    )
    result = generate_json(coach_qna_response_system_instruction(persona), prompt)
    if result.get("emotion_tag") not in VALID_EMOTIONS:
        result["emotion_tag"] = "neutral"
    return result
