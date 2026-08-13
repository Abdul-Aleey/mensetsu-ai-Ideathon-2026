"""Report agent (spec §4.3) — the one extra Gemini call that finalizes the
Assessor's rolling per-turn evaluations into the structured PDF report.
"""

from .. import models
from ..interviewers import INTERVIEWER_PROFILES
from ..prompts.report import report_system_instruction
from .gemini_client import generate_json


def generate_report(session: models.Session) -> dict:
    # competency name -> id of whoever asked its primary question — read back
    # from the actually-recorded turns, same approach as
    # interview_loop._competency_speakers, so it's correct even after
    # early-termination edge cases rather than recomputing the speaker plan.
    competency_speakers: dict[str, str] = {}
    for t in session.turns:
        if t.competency is not None and t.competency.name not in competency_speakers:
            competency_speakers[t.competency.name] = t.speaker

    transcript = [
        {
            "index": t.index,
            "question": t.question,
            "answer": t.answer,
            "competency": t.competency.name if t.competency else None,
            "was_followup": t.was_followup,
            "evidence": t.evidence,
            "speaker": t.speaker,
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
            "asked_by": competency_speakers.get(c.name),
        }
        for c in session.competencies
    ]

    dual = len(session.interviewers_json) == 2
    interviewers = [
        {"id": iid, "display_name": INTERVIEWER_PROFILES[iid]["display_name"], "bio": INTERVIEWER_PROFILES[iid]["bio"]}
        for iid in session.interviewers_json
    ]

    prompt = (
        f"Interview language: {session.language}\n"
        f"Role: {session.role_title}\n"
        f"Job description:\n{session.jd_text}\n\n"
        f"Candidate résumé:\n{session.resume_text}\n\n"
        f"Competencies and Assessor notes:\n{competencies}\n\n"
        f"Full transcript:\n{transcript}"
    )
    return generate_json(report_system_instruction(dual, interviewers), prompt)
