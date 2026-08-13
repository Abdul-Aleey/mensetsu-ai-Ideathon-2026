"""PDF report rendering (spec §8) via WeasyPrint (HTML/CSS → PDF).

WeasyPrint needs native Pango/GDK-Pixbuf libraries not present on Windows —
imported lazily here so the rest of the backend works fine on a Windows dev
machine; this module only actually runs inside the Linux Docker container
(or macOS/Linux with GTK installed).
"""

from datetime import date, datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from .. import models
from ..interviewers import INTERVIEWER_PROFILES

TEMPLATE_DIR = Path(__file__).parent.parent / "templates"
_env = Environment(loader=FileSystemLoader(TEMPLATE_DIR), autoescape=True)

RECOMMENDATION_LABELS = {
    "advance": "Advance",
    "do_not_advance": "Do not advance",
    "borderline": "Borderline",
}
LANGUAGE_LABELS = {"en": "English", "ja": "Japanese (日本語)"}


def render_report_html(session: models.Session, report_data: dict) -> str:
    template = _env.get_template("report.html")
    transcript = [
        {
            "index": t.index,
            "question": t.question,
            "answer": t.answer,
            "competency": t.competency.name if t.competency else None,
            "evidence": t.evidence,
        }
        for t in sorted(session.turns, key=lambda t: t.index)
    ]
    recommendation = report_data.get("recommendation", "borderline")
    return template.render(
        language=session.language,
        language_label=LANGUAGE_LABELS.get(session.language, session.language),
        role_title=session.role_title,
        candidate_name=session.candidate_name,
        date=date.today().isoformat(),
        recommendation=recommendation,
        recommendation_label=RECOMMENDATION_LABELS.get(recommendation, recommendation),
        summary=report_data.get("summary", ""),
        scorecard=report_data.get("scorecard", []),
        pros=report_data.get("pros", []),
        cons=report_data.get("cons", []),
        resume_reality_check=report_data.get("resume_reality_check", ""),
        next_steps=report_data.get("next_steps", ""),
        panel_synthesis=report_data.get("panel_synthesis"),
        interviewer_names={iid: INTERVIEWER_PROFILES[iid]["display_name"] for iid in session.interviewers_json},
        transcript=transcript,
    )


def render_practice_report_html(session: models.Session, coaching: dict) -> str:
    template = _env.get_template("practice_report.html")
    transcript = [
        {
            "index": t.index,
            "question": t.question,
            "answer": t.answer,
            "competency": t.competency.name if t.competency else None,
            "evidence": t.evidence,
        }
        for t in sorted(session.turns, key=lambda t: t.index)
    ]
    return template.render(
        language=session.language,
        language_label=LANGUAGE_LABELS.get(session.language, session.language),
        role_title=session.role_title,
        candidate_name=session.candidate_name,
        date=date.today().isoformat(),
        overall_summary=coaching.get("overall_summary", ""),
        strengths=coaching.get("strengths", []),
        areas_to_improve=coaching.get("areas_to_improve", []),
        items=coaching.get("items", []),
        practice_recommendations=coaching.get("practice_recommendations", ""),
        transcript=transcript,
    )


def render_pdf_bytes(html: str) -> bytes:
    """Renders HTML to PDF bytes — caller decides where those bytes go
    (local disk for dev, GCS for Cloud Run; see services/storage.py)."""
    from weasyprint import HTML  # lazy import — see module docstring

    return HTML(string=html).write_pdf()
