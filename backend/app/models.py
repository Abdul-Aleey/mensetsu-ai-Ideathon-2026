import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    role_title: Mapped[str | None] = mapped_column(String, nullable=True)
    company_name: Mapped[str | None] = mapped_column(String, nullable=True)
    jd_text: Mapped[str] = mapped_column(Text)
    resume_text: Mapped[str] = mapped_column(Text)
    candidate_name: Mapped[str | None] = mapped_column(String, nullable=True)
    recruiter_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    language: Mapped[str] = mapped_column(String, default="en")  # "en" | "ja"
    mandatory_language: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="setup")  # setup | in_progress | complete
    mode: Mapped[str] = mapped_column(String, default="hiring")  # "hiring" | "practice"
    interviewers_json: Mapped[list] = mapped_column(JSON, default=lambda: ["alex"])  # ["alex"] | ["sara"] | ["alex", "sara"]
    # Updated every time a turn is created — lets closing/feedback-qna turns
    # continue from whoever spoke last instead of needing to re-derive it.
    last_speaker: Mapped[str] = mapped_column(String, default="alex")
    question_rounds: Mapped[int] = mapped_column(Integer, default=10)  # candidate-facing budget: 1 | 2 | 3 | 5 | 10 | 15 | 20
    primary_questions_asked: Mapped[int] = mapped_column(Integer, default=0)  # counts toward question_rounds
    questions_asked: Mapped[int] = mapped_column(Integer, default=0)  # total turns incl. follow-ups, for indexing
    phase: Mapped[str] = mapped_column(String, default="intro")  # intro | competencies | closing | feedback | complete
    intro_step: Mapped[int] = mapped_column(Integer, default=0)  # 0=not started, 1..3 = intro turns asked
    followups_this_competency: Mapped[int] = mapped_column(Integer, default=0)
    current_competency_index: Mapped[int] = mapped_column(Integer, default=0)
    # practice mode only — mirrors intro_step's pattern for the feedback phase.
    # Count of feedback items delivered so far (0..len(items)).
    feedback_step: Mapped[int] = mapped_column(Integer, default=0)
    # practice mode only — "intro" while the transition line into feedback
    # (acknowledging the last competency answer) is pending a reply, None
    # otherwise (see interview_loop.py's _handle_feedback: once feedback
    # items are underway, deciding follow-up vs. "Next" is just a matter of
    # whether the candidate's answer was blank, no extra state needed).
    feedback_pending_kind: Mapped[str | None] = mapped_column(String, nullable=True)
    coaching_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    competencies: Mapped[list["Competency"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="Competency.order_index"
    )
    turns: Mapped[list["Turn"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="Turn.index"
    )
    report: Mapped["Report | None"] = relationship(back_populates="session", cascade="all, delete-orphan")
    practice_report: Mapped["PracticeReport | None"] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )

    @property
    def interviewers(self) -> list[str]:
        """Bridges the interviewers_json column to the cleaner `interviewers`
        name SessionOut (schemas.py) reads via from_attributes."""
        return self.interviewers_json


class Competency(Base):
    __tablename__ = "competencies"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"))
    order_index: Mapped[int] = mapped_column(Integer)  # plan order — id is a random UUID, not sortable
    name: Mapped[str] = mapped_column(String)
    type: Mapped[str] = mapped_column(String)  # "general" | "technical"
    resume_claim: Mapped[str | None] = mapped_column(Text, nullable=True)
    covered: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    session: Mapped[Session] = relationship(back_populates="competencies")


class Turn(Base):
    __tablename__ = "turns"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"))
    index: Mapped[int] = mapped_column(Integer)
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    speaker: Mapped[str] = mapped_column(String, default="alex")  # which interviewer id spoke this turn
    competency_id: Mapped[str | None] = mapped_column(ForeignKey("competencies.id"), nullable=True)
    was_followup: Mapped[bool] = mapped_column(Boolean, default=False)
    emotion: Mapped[str] = mapped_column(String, default="neutral")
    evidence: Mapped[str | None] = mapped_column(Text, nullable=True)  # Assessor's evidence quote for this turn
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    session: Mapped[Session] = relationship(back_populates="turns")
    competency: Mapped["Competency | None"] = relationship()


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), unique=True)
    recommendation: Mapped[str] = mapped_column(String)  # "advance" | "do_not_advance" | "borderline"
    summary: Mapped[str] = mapped_column(Text)
    scorecard_json: Mapped[dict] = mapped_column(JSON)
    pros_json: Mapped[list] = mapped_column(JSON)
    cons_json: Mapped[list] = mapped_column(JSON)
    resume_reality_check: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_steps: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Two-interviewer sessions only — each interviewer's own read from the
    # competencies they personally asked, plus a short synthesis. Null for
    # solo-interviewer sessions (see prompts/report.py's dual branch).
    panel_synthesis_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    pdf_path: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    session: Mapped[Session] = relationship(back_populates="report")


class PracticeReport(Base):
    __tablename__ = "practice_reports"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), unique=True)
    overall_summary: Mapped[str] = mapped_column(Text)
    strengths_json: Mapped[list] = mapped_column(JSON)
    areas_to_improve_json: Mapped[list] = mapped_column(JSON)
    # one entry per competency asked: {competency, question_asked, what_went_well,
    # what_to_improve, example_answer, example_framework} — the same items the
    # avatar spoke live, persisted from Session.coaching_json rather than regenerated.
    per_question_feedback_json: Mapped[list] = mapped_column(JSON)
    practice_recommendations: Mapped[str] = mapped_column(Text)
    pdf_path: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    session: Mapped[Session] = relationship(back_populates="practice_report")
