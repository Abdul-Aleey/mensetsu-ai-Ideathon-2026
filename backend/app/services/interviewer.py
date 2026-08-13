"""Interviewer agent — spans four phases of one interview: opening, self-
intro follow-ups, adaptive competency questions, and closing. The bounded
loop that enforces termination (question ceiling, follow-up cap) lives in
interview_loop.py — this module only drafts what gets spoken at each step.
Prompt text lives in app/prompts/interviewer.py; this file is business logic
only.

Every function takes a `persona` dict (app/interviewers.py) identifying
which interviewer is speaking this turn — interview_loop.py decides who
that is (see its speaker-alternation logic) and passes the right one in.
"""

import json

from ..prompts.interviewer import (
    closing_prompt_system_instruction,
    closing_response_system_instruction,
    first_competency_system_instruction,
    intro_followup_system_instruction,
    opening_system_instruction,
    router_system_instruction,
)
from .gemini_client import generate_json

VALID_EMOTIONS = {"encouraging", "probing", "approving", "neutral"}
VALID_DECISIONS = {"advance", "probe", "challenge", "follow_thread"}


def generate_opening(
    state: dict, persona: dict, other_persona: dict | None = None, ask_candidate_intro: bool = True
) -> dict:
    prompt = (
        f"Interview language: {state['language']}\n"
        f"Company: {state.get('company_name') or 'not specified'}\n"
        f"Role: {state.get('role_title') or 'not specified'}\n"
        f"Job description:\n{state['job_description']}"
    )
    result = generate_json(opening_system_instruction(persona, other_persona, ask_candidate_intro), prompt)
    if result.get("emotion_tag") not in VALID_EMOTIONS:
        result["emotion_tag"] = "encouraging"
    return result


def generate_intro_followup(state: dict, self_intro_and_history: str, persona: dict) -> dict:
    prompt = (
        f"Interview language: {state['language']}\n"
        f"Role: {state.get('role_title') or 'not specified'}\n"
        f"Job description:\n{state['job_description']}\n\n"
        f"Conversation so far:\n{self_intro_and_history}"
    )
    result = generate_json(intro_followup_system_instruction(persona), prompt)
    if result.get("emotion_tag") not in VALID_EMOTIONS:
        result["emotion_tag"] = "encouraging"
    return result


def generate_first_competency(state: dict, persona: dict, competency, history_json: str) -> dict:
    prompt = (
        f"Interview language: {state['language']}\n"
        f"Job description:\n{state['job_description']}\n"
        f"Candidate résumé:\n{state['resume_text']}\n"
        f"Conversation so far:\n{history_json}\n"
        f"Competency to ask about: {competency.name} ({competency.type})\n"
        f"Résumé claim to probe: {competency.resume_claim or '(none)'}"
    )
    result = generate_json(first_competency_system_instruction(persona), prompt)
    if result.get("emotion_tag") not in VALID_EMOTIONS:
        result["emotion_tag"] = "encouraging"
    return result


def route_next_turn(state: dict, latest_answer: str, persona: dict) -> dict:
    prompt = _build_router_prompt(state, latest_answer)
    result = generate_json(router_system_instruction(persona), prompt)

    if result.get("emotion_tag") not in VALID_EMOTIONS:
        result["emotion_tag"] = "neutral"
    if result.get("decision") not in VALID_DECISIONS:
        result["decision"] = "advance"
    return result


def _build_router_prompt(state: dict, latest_answer: str) -> str:
    parts = [
        f"Interview language: {state['language']}",
        f"Job description:\n{state['job_description']}",
        f"Candidate résumé:\n{state['resume_text']}",
        f"Competencies (in order, with résumé claims to probe and coverage status):\n"
        f"{json.dumps(state['competencies'], ensure_ascii=False, indent=2)}",
        f"Current competency: {state['current_competency']}",
        f"Follow-ups used on current competency: {state['followups_this_competency']} "
        f"(max {state['max_followups_per_competency']})",
        f"Primary questions asked so far: {state['primary_questions_asked']} (budget {state['question_rounds']})",
        f"Conversation so far:\n{json.dumps(state['turn_log'], ensure_ascii=False, indent=2)}",
        f"Candidate's latest answer: {latest_answer}",
    ]
    return "\n\n".join(parts)


def generate_closing_prompt(state: dict, persona: dict) -> dict:
    prompt = f"Interview language: {state['language']}\nRole: {state.get('role_title') or 'not specified'}"
    result = generate_json(closing_prompt_system_instruction(persona), prompt)
    if result.get("emotion_tag") not in VALID_EMOTIONS:
        result["emotion_tag"] = "encouraging"
    return result


def generate_closing_response(state: dict, candidate_reply: str, persona: dict) -> dict:
    prompt = (
        f"Interview language: {state['language']}\n"
        f"Job description:\n{state['job_description']}\n"
        f"Recruiter's custom instruction: {state.get('recruiter_prompt') or '(none)'}\n\n"
        f"Candidate's reply to 'do you have any questions': {candidate_reply}"
    )
    result = generate_json(closing_response_system_instruction(persona), prompt)
    if result.get("emotion_tag") not in VALID_EMOTIONS:
        result["emotion_tag"] = "neutral"
    return result
