"""Planner agent (spec §3.A) — runs once at interview start.

Reads the job description + candidate résumé (+ optional recruiter prompt)
and produces the fixed competency checklist that GUARANTEES the interview
terminates: the interview is done when every competency is covered or the
global question budget is hit.
"""

from ..config import settings
from ..prompts.planner import SYSTEM_INSTRUCTION_TEMPLATE
from ..prompts.shared import GROUNDING_RULE
from .gemini_client import generate_json

SYSTEM_INSTRUCTION = SYSTEM_INSTRUCTION_TEMPLATE.format(
    min_c=settings.min_competencies,
    max_c=settings.max_competencies,
    grounding_rule=GROUNDING_RULE,
)


def plan_interview(
    jd_text: str,
    resume_text: str,
    recruiter_prompt: str | None,
    language_override: str | None,
) -> dict:
    prompt_parts = [
        f"JOB DESCRIPTION:\n{jd_text}",
        f"\nCANDIDATE RÉSUMÉ:\n{resume_text}",
    ]
    if recruiter_prompt:
        prompt_parts.append(f"\nRECRUITER'S CUSTOM INSTRUCTION:\n{recruiter_prompt}")
    if language_override:
        prompt_parts.append(
            f"\nThe hiring manager explicitly selected interview language: {language_override}. "
            "Use this as the \"language\" field regardless of the job description's language."
        )

    plan = generate_json(SYSTEM_INSTRUCTION, "\n".join(prompt_parts))

    # Defensive normalization — never let a malformed model response break the
    # bounded interview loop downstream.
    competencies = plan.get("competencies") or []
    plan["competencies"] = competencies[: settings.max_competencies]
    plan.setdefault("role_title", None)
    plan.setdefault("candidate_name", None)
    plan.setdefault("company_name", None)
    plan.setdefault("language", language_override or "en")
    plan.setdefault("mandatory_language", None)
    return plan
