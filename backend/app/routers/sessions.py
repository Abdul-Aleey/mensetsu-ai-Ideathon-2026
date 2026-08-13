from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session as DBSession

from .. import models, schemas
from ..database import get_db
from ..interviewers import INTERVIEWER_PROFILES, VALID_INTERVIEWERS
from ..services.coach import generate_coaching
from ..services.db_sync import upload_db_now
from ..services.document_extraction import extract_text
from ..services.interview_loop import _competency_speakers, advance_interview
from ..services.pdf import render_pdf_bytes, render_practice_report_html, render_report_html
from ..services.planner import plan_interview
from ..services.report import generate_report
from ..services.sample_data import fetch_demo_documents
from ..services.storage import load_report_pdf, save_report_pdf

router = APIRouter(prefix="/sessions", tags=["sessions"])


VALID_QUESTION_ROUNDS = {3, 5, 10, 15, 20}
VALID_MODES = {"hiring", "practice"}


def _parse_interviewers(raw: str) -> list[str]:
    ids = [i.strip() for i in raw.split(",") if i.strip()]
    if not ids or not set(ids).issubset(VALID_INTERVIEWERS):
        raise HTTPException(
            status_code=400, detail="interviewers must be a comma-separated subset of: " + ", ".join(sorted(VALID_INTERVIEWERS))
        )
    # De-dupe while preserving order — "alex,alex" should behave like "alex".
    seen = []
    for i in ids:
        if i not in seen:
            seen.append(i)
    return seen


@router.post("", response_model=schemas.SessionOut)
async def create_session(
    background_tasks: BackgroundTasks,
    jd_file: UploadFile = File(...),
    resume_file: UploadFile = File(...),
    recruiter_prompt: str | None = Form(None),
    language: str | None = Form(None),
    question_rounds: int = Form(10),
    mode: str = Form("hiring"),
    interviewers: str = Form("alex"),
    db: DBSession = Depends(get_db),
):
    if question_rounds not in VALID_QUESTION_ROUNDS:
        raise HTTPException(status_code=400, detail="question_rounds must be one of 3, 5, 10, 15, 20.")
    if mode not in VALID_MODES:
        raise HTTPException(status_code=400, detail="mode must be one of hiring, practice.")
    interviewer_ids = _parse_interviewers(interviewers)

    try:
        jd_text = await extract_text(jd_file)
        resume_text = await extract_text(resume_file)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not jd_text.strip():
        raise HTTPException(status_code=400, detail="Could not extract any text from the job description file.")
    if not resume_text.strip():
        raise HTTPException(status_code=400, detail="Could not extract any text from the résumé file.")

    plan = plan_interview(jd_text, resume_text, recruiter_prompt, language)

    session = models.Session(
        role_title=plan.get("role_title"),
        company_name=plan.get("company_name"),
        jd_text=jd_text,
        resume_text=resume_text,
        candidate_name=plan.get("candidate_name"),
        recruiter_prompt=recruiter_prompt,
        language=plan.get("language", "en"),
        mandatory_language=plan.get("mandatory_language"),
        question_rounds=question_rounds,
        mode=mode,
        interviewers_json=interviewer_ids,
        last_speaker=interviewer_ids[0],
        status="in_progress",
    )
    db.add(session)
    db.flush()

    for order_index, c in enumerate(plan.get("competencies", [])):
        db.add(
            models.Competency(
                session_id=session.id,
                order_index=order_index,
                name=c.get("name", ""),
                type=c.get("type", "general"),
                resume_claim=c.get("resume_claim"),
            )
        )

    db.commit()
    db.refresh(session)
    background_tasks.add_task(_sync_db_safely)
    return session


@router.post("/demo", response_model=schemas.SessionOut)
def create_demo_session(background_tasks: BackgroundTasks, db: DBSession = Depends(get_db)):
    """Same as create_session — same plan_interview() call, same everything —
    except the JD/résumé come from the fixed sample pair in GCS instead of an
    upload, and question_rounds is fixed at 3. Lets a live demo skip the file
    picker without touching anything else about how a session is built."""
    try:
        jd_text, resume_text = fetch_demo_documents()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    plan = plan_interview(jd_text, resume_text, None, None)

    session = models.Session(
        role_title=plan.get("role_title"),
        company_name=plan.get("company_name"),
        jd_text=jd_text,
        resume_text=resume_text,
        candidate_name=plan.get("candidate_name"),
        language=plan.get("language", "en"),
        mandatory_language=plan.get("mandatory_language"),
        question_rounds=3,
        status="in_progress",
    )
    db.add(session)
    db.flush()

    for order_index, c in enumerate(plan.get("competencies", [])):
        db.add(
            models.Competency(
                session_id=session.id,
                order_index=order_index,
                name=c.get("name", ""),
                type=c.get("type", "general"),
                resume_claim=c.get("resume_claim"),
            )
        )

    db.commit()
    db.refresh(session)
    background_tasks.add_task(_sync_db_safely)
    return session


@router.get("/{session_id}", response_model=schemas.SessionOut)
def get_session(session_id: str, db: DBSession = Depends(get_db)):
    session = db.get(models.Session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.post("/{session_id}/answer", response_model=schemas.AnswerOut)
def answer(session_id: str, body: schemas.AnswerIn, background_tasks: BackgroundTasks, db: DBSession = Depends(get_db)):
    session = db.get(models.Session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == "complete":
        raise HTTPException(status_code=400, detail="This interview has already finished.")

    result = advance_interview(db, session, body.answer)
    # Fire-and-forget: this used to run synchronously (upload_db_now() re-
    # authenticates a fresh GCS client and re-uploads the whole SQLite file
    # on every single answer), blocking the candidate's next question behind
    # a full GCS round-trip on top of Gemini's own generation latency. The
    # sync is already best-effort by design (see _sync_db_safely), so
    # deferring it past the response is free.
    background_tasks.add_task(_sync_db_safely)
    return result


@router.post("/{session_id}/finalize", response_model=schemas.ReportOut | schemas.PracticeReportOut)
def finalize(session_id: str, background_tasks: BackgroundTasks, db: DBSession = Depends(get_db)):
    session = db.get(models.Session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != "complete":
        raise HTTPException(status_code=400, detail="This interview hasn't finished yet.")

    if session.mode == "practice":
        return _finalize_practice(db, session, background_tasks)
    return _finalize_hiring(db, session, background_tasks)


def _finalize_hiring(db, session, background_tasks):
    if session.report is not None:
        return _report_out(session.report)

    report_data = generate_report(session)
    report = models.Report(
        session_id=session.id,
        recommendation=report_data.get("recommendation", "borderline"),
        summary=report_data.get("summary", ""),
        scorecard_json=report_data.get("scorecard", []),
        pros_json=report_data.get("pros", []),
        cons_json=report_data.get("cons", []),
        resume_reality_check=report_data.get("resume_reality_check"),
        next_steps=report_data.get("next_steps"),
        panel_synthesis_json=report_data.get("panel_synthesis"),
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    try:
        html = render_report_html(session, report_data)
        pdf_bytes = render_pdf_bytes(html)
        report.pdf_path = save_report_pdf(pdf_bytes, session.id)
        db.commit()
    except Exception:
        # PDF rendering unavailable in this environment (e.g. WeasyPrint's
        # native libs missing on Windows dev) — the report data itself is
        # still valid and returned; only the PDF download is affected.
        pass

    background_tasks.add_task(_sync_db_safely)
    return _report_out(report)


def _finalize_practice(db, session, background_tasks):
    if session.practice_report is not None:
        return _practice_report_out(session.practice_report)

    # The Coach agent already ran live during the feedback phase (see
    # interview_loop._transition_to_feedback) — session.coaching_json is the
    # same content the avatar already spoke. Only regenerate as a defensive
    # fallback if it's somehow missing.
    if session.coaching_json:
        coaching = session.coaching_json
    else:
        personas = {iid: INTERVIEWER_PROFILES[iid] for iid in session.interviewers_json}
        coaching = generate_coaching(session, personas, _competency_speakers(session))

    report = models.PracticeReport(
        session_id=session.id,
        overall_summary=coaching.get("overall_summary", ""),
        strengths_json=coaching.get("strengths", []),
        areas_to_improve_json=coaching.get("areas_to_improve", []),
        per_question_feedback_json=coaching.get("items", []),
        practice_recommendations=coaching.get("practice_recommendations", ""),
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    try:
        html = render_practice_report_html(session, coaching)
        pdf_bytes = render_pdf_bytes(html)
        report.pdf_path = save_report_pdf(pdf_bytes, session.id)
        db.commit()
    except Exception:
        # Same defensive handling as the hiring report — PDF rendering
        # unavailable in this environment shouldn't break the JSON response.
        pass

    background_tasks.add_task(_sync_db_safely)
    return _practice_report_out(report)


@router.get("/{session_id}/report.pdf")
def get_report_pdf(session_id: str, db: DBSession = Depends(get_db)):
    session = db.get(models.Session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Report PDF not available.")
    report = session.practice_report if session.mode == "practice" else session.report
    if report is None or not report.pdf_path:
        raise HTTPException(status_code=404, detail="Report PDF not available.")
    pdf_bytes = load_report_pdf(report.pdf_path)
    if pdf_bytes is None:
        raise HTTPException(status_code=404, detail="Report PDF not available.")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="mensetsu-report-{session_id}.pdf"'},
    )


@router.get("/{session_id}/transcript")
def get_transcript(session_id: str, db: DBSession = Depends(get_db)):
    session = db.get(models.Session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return [
        {
            "index": t.index,
            "question": t.question,
            "answer": t.answer,
            "speaker": t.speaker,
            "competency": t.competency.name if t.competency else None,
            "was_followup": t.was_followup,
            "emotion": t.emotion,
            "created_at": t.created_at.isoformat(),
        }
        for t in sorted(session.turns, key=lambda t: t.index)
    ]


def _sync_db_safely() -> None:
    """Best-effort GCS upload after a write — a sync hiccup should never
    break the interview itself. No-ops locally where GCS_BUCKET isn't set."""
    try:
        upload_db_now()
    except Exception:
        pass


def _report_out(report: models.Report) -> dict:
    return {
        "mode": "hiring",
        "recommendation": report.recommendation,
        "summary": report.summary,
        "scorecard": report.scorecard_json,
        "pros": report.pros_json,
        "cons": report.cons_json,
        "resume_reality_check": report.resume_reality_check,
        "next_steps": report.next_steps,
        "panel_synthesis": report.panel_synthesis_json,
    }


def _practice_report_out(report: models.PracticeReport) -> dict:
    return {
        "mode": "practice",
        "overall_summary": report.overall_summary,
        "strengths": report.strengths_json,
        "areas_to_improve": report.areas_to_improve_json,
        "per_question_feedback": report.per_question_feedback_json,
        "practice_recommendations": report.practice_recommendations,
    }
