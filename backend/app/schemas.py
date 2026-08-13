from pydantic import BaseModel


class CompetencyOut(BaseModel):
    id: str
    name: str
    type: str
    resume_claim: str | None
    covered: bool
    notes: str | None

    model_config = {"from_attributes": True}


class SessionOut(BaseModel):
    id: str
    mode: str
    interviewers: list[str]
    role_title: str | None
    company_name: str | None
    candidate_name: str | None
    language: str
    mandatory_language: str | None
    status: str
    phase: str
    question_rounds: int
    questions_asked: int
    current_competency_index: int
    competencies: list[CompetencyOut]

    model_config = {"from_attributes": True}


class TurnOut(BaseModel):
    index: int
    question: str
    answer: str | None
    was_followup: bool
    emotion: str

    model_config = {"from_attributes": True}


class AnswerIn(BaseModel):
    answer: str | None = None  # null on the very first call, to fetch the opening question


class AnswerOut(BaseModel):
    status: str  # "in_progress" | "complete"
    question: str | None = None
    emotion: str | None = None
    speaker: str = "alex"  # which interviewer id is speaking this turn — "alex" | "sara"
    target_competency: str | None = None
    questions_asked: int = 0  # primary questions only — follow-ups don't count
    closing_message: str | None = None
    turn_kind: str = "question"  # "question" | "feedback_item" | "feedback_qna"


class ReportOut(BaseModel):
    mode: str = "hiring"
    recommendation: str
    summary: str
    scorecard: list[dict]
    pros: list[str]
    cons: list[str]
    resume_reality_check: str | None
    next_steps: str | None
    panel_synthesis: dict | None = None

    model_config = {"from_attributes": True}


class PracticeReportOut(BaseModel):
    mode: str = "practice"
    overall_summary: str
    strengths: list[str]
    areas_to_improve: list[str]
    per_question_feedback: list[dict]
    practice_recommendations: str

    model_config = {"from_attributes": True}
