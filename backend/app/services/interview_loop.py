"""The bounded control loop that drives one interview turn at a time.

Phases, always in this order, each bounded so the whole interview is
guaranteed to terminate:

1. "intro"        — the sole interviewer (or, in a two-interviewer session,
                     both of them in turn) introduces themselves/company/
                     role, asks the candidate to introduce themselves, then
                     asks 2 more questions drawn from that introduction.
                     Fixed at 3 turns solo / 4 turns dual — not adaptive,
                     not skippable, and NEVER counted against
                     session.question_rounds (it's fixed overhead, not part
                     of the candidate-facing question budget).
2. "competencies" — the original adaptive Router loop (advance / probe /
                     challenge / follow_thread), bounded by
                     session.question_rounds (primary questions only —
                     follow-ups don't count against it either) and by the
                     per-competency follow-up cap. This is the ONLY phase
                     that spends question_rounds — the budget is shared
                     across interviewers, never additive: in a two-
                     interviewer session, primary questions simply alternate
                     speaker (see _pick_speaker), the total asked still
                     never exceeds question_rounds. Follow-ups on a
                     competency always stay with whoever asked its primary
                     question.
3a. "closing"      — hiring mode (session.mode == "hiring") only: "do you
                     have any questions for me?" then exactly one bounded
                     response. Fixed overhead, never counted.
3b. "feedback"     — practice mode (session.mode == "practice") only: opens
                     with a short transition line acknowledging the
                     candidate's final competency answer and announcing the
                     feedback walkthrough ("intro" pending kind — see
                     _transition_to_feedback), then the Coach agent's per-
                     competency STAR feedback, delivered one item at a
                     time. After each item the candidate gets an explicit
                     choice (see _handle_feedback): ask a follow-up
                     question about it, or click "Next" — every step is a
                     real, re-clickable user action rather than a silent
                     auto-advance chain. Once the last item's "Next" is
                     clicked (or there was nothing to give feedback on at
                     all), whoever spoke last signs off and the session
                     ends. Also fixed overhead, never counted.
4. "complete"      — terminal.
"""

import json
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy.orm import Session as DBSession

from .. import models
from ..config import settings
from ..interviewers import INTERVIEWER_PROFILES
from .assessor import assess_turn
from .coach import (
    generate_coaching,
    generate_feedback_closing,
    generate_feedback_item_followup,
    generate_feedback_transition,
)
from .interviewer import (
    generate_closing_prompt,
    generate_closing_response,
    generate_first_competency,
    generate_intro_followup,
    generate_opening,
    route_next_turn,
)

FOLLOWUP_DECISIONS = {"probe", "challenge", "follow_thread"}


def advance_interview(db: DBSession, session: models.Session, answer: str | None) -> dict:
    turns = session.turns
    competencies = session.competencies

    pending = None
    if answer is not None:
        pending = _record_answer(turns, answer)
        # Competencies phase runs the Assessor concurrently with the Router
        # instead of before it (see _handle_competencies) — skip the eager
        # call here so it isn't run twice.
        if session.phase != "competencies":
            _assess_pending(pending)
    elif turns:
        # A null answer means "give me the current question" — the frontend
        # only means to send this once, right after session creation, to
        # fetch the opening. But the same null-answer call also fires on
        # every reload/remount of the interview page (see Interview.jsx),
        # and without this guard that silently asked a brand-new question
        # each time instead of resuming the one already pending, quietly
        # skipping through the interview on every refresh. Replay the
        # still-unanswered question instead.
        pending = next((t for t in reversed(turns) if t.answer is None), None)
        if pending is not None:
            competency_name = pending.competency.name if pending.competency else None
            turn_kind = "question"
            if session.phase == "feedback":
                turn_kind = "handoff" if session.feedback_pending_kind == "intro" else "feedback_item"
            elif session.phase == "intro" and len(session.interviewers_json) == 2 and session.intro_step == 1:
                # Reloaded right after the first interviewer's hand-off line,
                # before the second interviewer's turn was ever generated —
                # same non-question turn as the fresh-session case below.
                turn_kind = "handoff"
            return _turn_response(session, pending.question, pending.emotion, competency_name, turn_kind=turn_kind)

    if session.phase == "intro":
        return _handle_intro(db, session, competencies, turns, answer)
    if session.phase == "competencies":
        return _handle_competencies(db, session, competencies, turns, answer, pending)
    if session.phase == "closing":
        return _handle_closing(db, session, answer)
    if session.phase == "feedback":
        return _handle_feedback(db, session, answer)

    session.status = "complete"
    session.phase = "complete"
    db.commit()
    return {"status": "complete", "questions_asked": session.questions_asked}


# ---------------------------------------------------------------------------
# Phase 1: intro
# ---------------------------------------------------------------------------


def _total_intro_steps(session) -> int:
    return 4 if len(session.interviewers_json) == 2 else 3


def _intro_followup_speaker(session, step_about_to_be_asked: int) -> str:
    """Which interviewer asks the follow-up currently being generated.
    step_about_to_be_asked is session.intro_step's value BEFORE incrementing
    (i.e. how many intro turns already happened). Solo sessions: always the
    one interviewer. Dual sessions: the first interviewer asks the first
    follow-up (step 2 -> 3), the second asks the second (step 3 -> 4)."""
    interviewers = session.interviewers_json
    if len(interviewers) == 1:
        return interviewers[0]
    return interviewers[0] if step_about_to_be_asked == 2 else interviewers[1]


def _handle_intro(db, session, competencies, turns, answer):
    interviewers = session.interviewers_json
    dual = len(interviewers) == 2
    total_steps = _total_intro_steps(session)

    if answer is None:
        # Step 1: the first interviewer's opening. Solo: introduces self,
        # names the role/company, asks the candidate to introduce
        # themselves. Dual: does the same EXCEPT the candidate-introduce
        # ask, which is deferred to the second interviewer's own turn next.
        speaker = interviewers[0]
        persona = INTERVIEWER_PROFILES[speaker]
        other_persona = INTERVIEWER_PROFILES[interviewers[1]] if dual else None
        state = _serialize_state(session, competencies, turns, 0)
        opening = generate_opening(state, persona, other_persona, ask_candidate_intro=not dual)
        turn = _create_turn(db, session, opening["question_text"], None, False, opening["emotion_tag"], speaker)
        session.intro_step = 1
        db.commit()
        # Dual sessions: this turn hands off to the second interviewer, it
        # doesn't ask the candidate anything — nothing for them to answer,
        # so the frontend should auto-advance instead of listening for a
        # reply that was never coming. Solo sessions: unchanged, this is the
        # real "introduce yourself" ask.
        turn_kind = "handoff" if dual else "question"
        return _turn_response(session, turn.question, turn.emotion, None, turn_kind=turn_kind)

    if dual and session.intro_step == 1:
        # Step 2 (dual only): the second interviewer's own brief self-intro,
        # then they're the one who asks the candidate to introduce themselves.
        speaker = interviewers[1]
        persona = INTERVIEWER_PROFILES[speaker]
        other_persona = INTERVIEWER_PROFILES[interviewers[0]]
        state = _serialize_state(session, competencies, turns, 0)
        opening = generate_opening(state, persona, other_persona, ask_candidate_intro=True)
        turn = _create_turn(db, session, opening["question_text"], None, False, opening["emotion_tag"], speaker)
        session.intro_step = 2
        db.commit()
        return _turn_response(session, turn.question, turn.emotion, None)

    if session.intro_step < total_steps:
        speaker = _intro_followup_speaker(session, session.intro_step)
        persona = INTERVIEWER_PROFILES[speaker]
        state = _serialize_state(session, competencies, turns, 0)
        history = json.dumps(state["turn_log"], ensure_ascii=False, indent=2)
        followup = generate_intro_followup(state, history, persona)
        turn = _create_turn(db, session, followup["question_text"], None, False, followup["emotion_tag"], speaker)
        session.intro_step += 1
        db.commit()
        return _turn_response(session, turn.question, turn.emotion, None)

    # intro_step has reached its fixed target and this answer is the reply
    # to the last intro turn — transition into the competencies phase. This
    # is where question_rounds starts being spent.
    session.phase = "competencies"
    if not competencies:
        db.commit()
        return _transition_out_of_competencies(db, session, competencies, turns)

    speaker = _pick_speaker(session, 0)
    persona = INTERVIEWER_PROFILES[speaker]
    state = _serialize_state(session, competencies, turns, 0)
    history = json.dumps(state["turn_log"], ensure_ascii=False, indent=2)
    first = generate_first_competency(state, persona, competencies[0], history)
    turn = _create_turn(
        db, session, first.get("question_text", ""), competencies[0].id, False, first.get("emotion_tag", "neutral"), speaker
    )
    session.primary_questions_asked = 1  # the first counted question — intro never counted
    db.commit()
    return _turn_response(session, turn.question, turn.emotion, competencies[0].name)


# ---------------------------------------------------------------------------
# Phase 2: competencies (adaptive Router)
# ---------------------------------------------------------------------------


def _handle_competencies(db, session, competencies, turns, answer, pending):
    old_idx = session.current_competency_index
    # The router is called with the CURRENT competency's speaker, since we
    # don't yet know whether it will advance (in which case the new
    # competency's speaker, not this one, ends up asking the transition
    # line) or stay a follow-up (in which case this IS the right speaker).
    # Known trade-off: when it does advance to a different speaker, that one
    # transition line's acknowledgment clause is generated in the outgoing
    # speaker's persona rather than the incoming one's — a second Gemini
    # call to fix this on every single turn isn't worth the latency/cost for
    # what's a subtle tone nuance, not a functional issue (grounding/
    # delivery/cultural-register constraints apply identically either way).
    speaker = _pick_speaker(session, old_idx)
    persona = INTERVIEWER_PROFILES[speaker]
    state = _serialize_state(session, competencies, turns, old_idx)

    # The Assessor's résumé-reality check for this answer never feeds the
    # Router's own decision — the Router prompt already gets the raw answer
    # and the résumé claim directly (see _build_router_prompt); the
    # Assessor's output only updates competency.notes for the later report/
    # coaching. Running both Gemini calls concurrently instead of Assessor-
    # then-Router roughly halves this turn's latency — reported live as a
    # 10-20s wait after every answer, from two sequential ~5-10s calls.
    # assess_future only ever does the Gemini call (_run_assessment), never
    # the ORM write-back — _apply_assessment happens below, strictly after
    # the thread has been joined, so the Session's dirty-tracking is never
    # touched from two threads at once. The `finally` guarantees
    # assess_future.result() is still called even when route_next_turn
    # itself raises — without it, a simultaneous Assessor failure (e.g.
    # during a Gemini outage affecting both calls) was silently discarded
    # instead of surfacing.
    with ThreadPoolExecutor(max_workers=1) as pool:
        assess_future = pool.submit(_run_assessment, pending)
        try:
            routed = route_next_turn(state, answer, persona)
        finally:
            assessment = assess_future.result()
    _apply_assessment(pending, assessment)
    decision = routed.get("decision", "advance")

    new_idx = _apply_decision(session, competencies, old_idx, decision)
    is_followup = new_idx == old_idx
    session.current_competency_index = new_idx

    # Ran out of competencies — nothing new to ask, so no primary question
    # was consumed by this turn; go straight to closing (or feedback).
    if new_idx >= len(competencies):
        db.commit()
        return _transition_out_of_competencies(db, session, competencies, turns)

    if not is_followup:
        session.primary_questions_asked += 1
        if session.primary_questions_asked > session.question_rounds:
            # This question would exceed the candidate's chosen round budget
            # — don't ask it, close instead. Undo the speculative increment
            # so the reported count never overstates what was actually asked.
            session.primary_questions_asked -= 1
            db.commit()
            return _transition_out_of_competencies(db, session, competencies, turns)
        # Advancing to a new competency — its owner may be a different
        # speaker than the one who just asked (alternation), recompute.
        speaker = _pick_speaker(session, new_idx)

    turn = _create_turn(
        db, session, routed["next_question_text"], competencies[new_idx].id, is_followup, routed["emotion_tag"], speaker
    )
    db.commit()
    return _turn_response(session, turn.question, turn.emotion, competencies[new_idx].name)


def _apply_decision(session, competencies, idx, decision) -> int:
    """Bounds-enforced bookkeeping — the follow-up cap here is authoritative
    even if the model tries to probe past it."""
    if idx >= len(competencies):
        return idx

    budget_exhausted = session.followups_this_competency >= settings.max_followups_per_competency
    if decision in FOLLOWUP_DECISIONS and not budget_exhausted:
        session.followups_this_competency += 1
        return idx

    competencies[idx].covered = True
    session.followups_this_competency = 0
    return idx + 1


# ---------------------------------------------------------------------------
# Phase 3: closing (hiring) / feedback (practice)
# ---------------------------------------------------------------------------


def _transition_out_of_competencies(db, session, competencies, turns):
    """The competency phase always ends the same way structurally, but which
    tail it lands in depends on session.mode — hiring interviews close with
    a role/company Q&A, practice sessions get avatar-delivered STAR
    coaching instead."""
    if session.mode == "practice":
        return _transition_to_feedback(db, session)
    return _transition_to_closing(db, session, competencies, turns)


def _transition_to_closing(db, session, competencies, turns):
    session.phase = "closing"
    # Continuity: whoever asked the last competency question also closes —
    # avoids an abrupt hand-off right at the end.
    speaker = session.last_speaker
    persona = INTERVIEWER_PROFILES[speaker]
    state = _serialize_state(session, competencies, turns, session.current_competency_index)
    closing_prompt = generate_closing_prompt(state, persona)
    turn = _create_turn(db, session, closing_prompt["question_text"], None, False, closing_prompt["emotion_tag"], speaker)
    db.commit()
    return _turn_response(session, turn.question, turn.emotion, None)


def _handle_closing(db, session, answer):
    speaker = session.last_speaker  # same interviewer who just asked "any questions?"
    persona = INTERVIEWER_PROFILES[speaker]
    state = _serialize_state(session, session.competencies, session.turns, session.current_competency_index)
    closing = generate_closing_response(state, answer or "", persona)
    _create_turn(db, session, closing["response_text"], None, False, closing["emotion_tag"], speaker)
    session.phase = "complete"
    session.status = "complete"
    db.commit()
    return {
        "status": "complete",
        "questions_asked": session.questions_asked,
        "closing_message": closing["response_text"],
        "speaker": speaker,
        "emotion": closing["emotion_tag"],
    }


def _transition_to_feedback(db, session):
    """Practice mode only. Speaks a short transition line FIRST — whoever
    asked the last competency question acknowledges that answer and
    announces the feedback walkthrough — before the Coach agent's actual
    feedback starts (see _begin_feedback_items). Previously this jumped
    straight into the Coach's first feedback item with nothing said in
    between: the Router's own acknowledgment of the final answer was
    generated then discarded (see _handle_competencies — its
    next_question_text is never used once new_idx runs out of
    competencies), so the candidate's last answer got no reaction at all
    and feedback just started — reported live as the session going silent
    right after the last question."""
    session.phase = "feedback"
    speaker = session.last_speaker
    persona = INTERVIEWER_PROFILES[speaker]
    transition = generate_feedback_transition(session, persona)
    turn = _create_turn(db, session, transition["question_text"], None, False, transition["emotion_tag"], speaker)
    session.feedback_pending_kind = "intro"
    db.commit()
    return _turn_response(session, turn.question, turn.emotion, None, turn_kind="handoff")


def _begin_feedback_items(db, session):
    """Runs the Coach agent ONCE and stores its full output on
    session.coaching_json — the feedback items are then replayed one at a
    time via _handle_feedback rather than calling Gemini per item. Each
    item's speaker is whoever asked that competency live (see
    _competency_speakers) — continuity: the person who asked also coaches."""
    personas = {iid: INTERVIEWER_PROFILES[iid] for iid in session.interviewers_json}
    competency_speakers = _competency_speakers(session)
    coaching = generate_coaching(session, personas, competency_speakers)
    session.coaching_json = coaching
    items = coaching.get("items", [])

    if not items:
        # Nothing was actually asked/covered to give feedback on — skip
        # straight to signing off.
        session.feedback_step = 0
        session.feedback_pending_kind = None
        return _close_feedback_session(db, session)

    return _deliver_feedback_item(db, session, items, 0)


def _deliver_feedback_item(db, session, items, index):
    item = items[index]
    speaker = item.get("speaker", session.interviewers_json[0])
    turn = _create_turn(db, session, item.get("spoken_text", ""), None, False, item.get("emotion_tag", "neutral"), speaker)
    session.feedback_step = index + 1
    session.feedback_pending_kind = None
    db.commit()
    return _turn_response(session, turn.question, turn.emotion, item.get("competency"), turn_kind="feedback_item")


def _close_feedback_session(db, session):
    speaker = session.last_speaker
    persona = INTERVIEWER_PROFILES[speaker]
    closing = generate_feedback_closing(session, persona)
    _create_turn(db, session, closing["response_text"], None, False, closing["emotion_tag"], speaker)
    session.phase = "complete"
    session.status = "complete"
    db.commit()
    return {
        "status": "complete",
        "questions_asked": session.questions_asked,
        "closing_message": closing["response_text"],
        "speaker": speaker,
        "emotion": closing["emotion_tag"],
    }


def _handle_feedback(db, session, answer):
    coaching = session.coaching_json or {}
    items = coaching.get("items", [])

    if session.feedback_pending_kind == "intro":
        # Reply to the transition line — nothing for the candidate to have
        # answered (it's a "handoff"-kind turn, auto-continued), so `answer`
        # is empty. Proceed into the actual Coach-generated feedback.
        return _begin_feedback_items(db, session)

    # Every feedback item leaves the candidate with an explicit choice
    # (see turn_kind "feedback_item" in Interview.jsx): ask a follow-up
    # question about the item just discussed, or click "Next". Both post to
    # this same endpoint — a non-blank answer is a real follow-up question,
    # a blank one is the "Next" click. Deciding this way (rather than the
    # previous silent auto-advance chain through intermediate "handover"/
    # "gate" turns) means every step is a real, re-clickable user action:
    # if a call fails, the button the candidate just pressed is simply still
    # there to press again, instead of the UI being left showing "moving to
    # the next point" with nothing left to click — reported live as the
    # session getting stuck partway through feedback with no way to recover
    # short of reloading.
    current_idx = session.feedback_step - 1
    if answer and answer.strip() and 0 <= current_idx < len(items):
        item = items[current_idx]
        speaker = item.get("speaker", session.interviewers_json[0])
        persona = INTERVIEWER_PROFILES[speaker]
        response = generate_feedback_item_followup(session, item, answer, persona)
        turn = _create_turn(db, session, response["response_text"], None, False, response["emotion_tag"], speaker)
        db.commit()
        return _turn_response(session, turn.question, turn.emotion, item.get("competency"), turn_kind="feedback_item")

    # "Next" — more items to go, or the last one just wrapped up.
    if session.feedback_step < len(items):
        return _deliver_feedback_item(db, session, items, session.feedback_step)

    return _close_feedback_session(db, session)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _record_answer(turns: list[models.Turn], answer: str) -> models.Turn | None:
    pending = next((t for t in reversed(turns) if t.answer is None), None)
    if pending is None:
        return None
    pending.answer = answer
    return pending


def _run_assessment(pending: models.Turn | None) -> dict | None:
    """The Gemini call only — no ORM writes, so this is what's safe to hand
    to a background thread (see _handle_competencies). SQLAlchemy Sessions
    aren't thread-safe for concurrent mutation; see _apply_assessment,
    which does the actual write-back and must run on the main thread only,
    after the thread has been joined."""
    if pending is None or pending.competency_id is None:
        return None
    competency = pending.competency
    return assess_turn(
        question=pending.question,
        answer=pending.answer,
        competency_name=competency.name,
        resume_claim=competency.resume_claim,
    )


def _apply_assessment(pending: models.Turn | None, assessment: dict | None) -> None:
    if pending is None or assessment is None:
        return
    competency = pending.competency
    pending.evidence = assessment.get("evidence_quote")
    reality = assessment.get("resume_reality", "not_applicable")
    note = assessment.get("notes", "")
    existing = f"{competency.notes}\n" if competency.notes else ""
    competency.notes = f"{existing}[{reality}] {note}".strip()


def _assess_pending(pending: models.Turn | None) -> None:
    """Only competency-phase turns get scored — the intro and closing
    exchanges are rapport/wrap-up, not part of the scorecard. Sequential
    call-then-write for callers outside the competencies phase; see
    _handle_competencies for the concurrent version."""
    _apply_assessment(pending, _run_assessment(pending))


def _pick_speaker(session, competency_index: int) -> str:
    """Which interviewer owns a given competency index. Solo sessions:
    always the one interviewer. Two-interviewer sessions: recomputes the
    full per-competency plan from session.competencies every call rather
    than tracking any state — still a pure function of (session,
    competency_index), just one that looks at competency types, not only
    the index, so it's safe to call repeatedly (e.g. once per follow-up on
    the same competency)."""
    interviewers = session.interviewers_json
    if len(interviewers) == 1:
        return interviewers[0]
    plan = _dual_speaker_plan(session)
    return plan[competency_index] if competency_index < len(plan) else interviewers[competency_index % len(interviewers)]


def _dual_speaker_plan(session) -> list[str]:
    """Even alex/sara/alex/... alternation by default, with one adjustment:
    guarantees the second interviewer gets at least one "general"
    (behavioral/motivation/communication/culture-fit — see coach.py)
    competency if the plan has any, instead of leaving it to alternation
    luck. A technical-heavy job description could otherwise alternate every
    "general" competency to the first interviewer and leave the second
    interviewer — Sara, whose bio is HR/people-ops — never actually asking
    anything behavioral in a given session, which wouldn't match what the
    landing page says she does. Swaps two already-assigned indices rather
    than reassigning one outright, so both interviewers still end up with
    the same total count either way — no change to the even question-split
    guarantee. Question content itself is untouched here; this only picks
    who asks whichever competency the Planner already generated for this
    specific job/résumé, never a fixed question."""
    interviewers = session.interviewers_json
    competencies = session.competencies  # ordered by order_index (see models.py relationship)
    plan = [interviewers[i % len(interviewers)] for i in range(len(competencies))]

    second = interviewers[1]
    general_indices = [i for i, c in enumerate(competencies) if c.type == "general"]
    if general_indices and second not in {plan[i] for i in general_indices}:
        target = general_indices[0]
        other = next((i for i in range(len(plan)) if plan[i] == second), None)
        if other is not None:
            plan[target], plan[other] = plan[other], plan[target]
    return plan


def _competency_speakers(session) -> dict[str, str]:
    """competency name -> interviewer id who asked its primary question,
    read back from the actually-recorded turns (the authoritative source —
    covers early-termination edge cases _pick_speaker alone can't reliably
    reconstruct after the fact)."""
    mapping: dict[str, str] = {}
    for t in session.turns:
        if t.competency is not None and t.competency.name not in mapping:
            mapping[t.competency.name] = t.speaker
    return mapping


def _create_turn(db, session, question, competency_id, was_followup, emotion, speaker) -> models.Turn:
    turn = models.Turn(
        session_id=session.id,
        index=session.questions_asked,
        question=question,
        competency_id=competency_id,
        was_followup=was_followup,
        emotion=emotion,
        speaker=speaker,
    )
    db.add(turn)
    session.questions_asked += 1
    session.last_speaker = speaker
    return turn


def _turn_response(session, question, emotion, target_competency, turn_kind="question") -> dict:
    return {
        "status": "in_progress",
        "question": question,
        "emotion": emotion,
        "speaker": session.last_speaker,
        "target_competency": target_competency,
        "questions_asked": session.primary_questions_asked,
        "turn_kind": turn_kind,
    }


def _serialize_state(
    session: models.Session,
    competencies: list[models.Competency],
    turns: list[models.Turn],
    current_idx: int,
) -> dict:
    return {
        "language": session.language,
        "job_description": session.jd_text,
        "resume_text": session.resume_text,
        "recruiter_prompt": session.recruiter_prompt,
        "role_title": session.role_title,
        "company_name": session.company_name,
        "competencies": [
            {
                "name": c.name,
                "type": c.type,
                "resume_claim": c.resume_claim,
                "covered": c.covered,
                "notes": c.notes,
            }
            for c in competencies
        ],
        "current_competency": competencies[current_idx].name if current_idx < len(competencies) else None,
        "followups_this_competency": session.followups_this_competency,
        "max_followups_per_competency": settings.max_followups_per_competency,
        "primary_questions_asked": session.primary_questions_asked,
        "question_rounds": session.question_rounds,
        "turn_log": [
            {
                "question": t.question,
                "answer": t.answer,
                "competency": t.competency.name if t.competency else None,
                "was_followup": t.was_followup,
                "emotion": t.emotion,
            }
            for t in turns
            if t.answer is not None
        ],
    }
