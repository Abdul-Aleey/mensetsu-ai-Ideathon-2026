"""Assessor agent (spec §3.C) — runs silently every turn, invisible to the
candidate. Produces a rolling per-competency evaluation with evidence quotes
pulled from the candidate's own words, plus the résumé-vs-reality check that
feeds the final report's headline "AI-inflated résumé" section.
"""

from ..prompts.assessor import SYSTEM_INSTRUCTION
from .gemini_client import generate_json

VALID_REALITY = {"supports", "contradicts", "unsubstantiated", "not_applicable"}


def assess_turn(question: str, answer: str, competency_name: str, resume_claim: str | None) -> dict:
    prompt = (
        f"Competency: {competency_name}\n"
        f"Résumé claim being probed: {resume_claim or '(none)'}\n"
        f"Question asked: {question}\n"
        f"Candidate's answer: {answer}"
    )
    result = generate_json(SYSTEM_INSTRUCTION, prompt)
    if result.get("resume_reality") not in VALID_REALITY:
        result["resume_reality"] = "not_applicable"
    return result
