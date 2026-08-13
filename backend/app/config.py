from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Avatar
    avatar_mode: str = "mock"  # "mock" | "perxona" — default mock so credits are never spent by accident

    # Perxona Connect (Presenter SDK) — a separate account/auth model from
    # the old <sv-agent> conversational widget. present() is a pure
    # text-to-speech + motion call with no autonomous AI: it speaks exactly
    # the text it's given. See app/services/perxona_connect.py and
    # frontend/src/avatar/PerxonaAvatarController.js.
    perxona_api_base_url: str = "https://console.perxona.ai/asia"
    perxona_connect_email: str | None = None
    perxona_connect_password: str | None = None
    perxona_presenter_url: str = "https://cdn.perxona.ai/asia/prod/latest/widget/entry/presenter.js"
    # Chosen to match the original "Alex" persona as closely as this
    # catalog allows: a navy-suited male avatar (cc006_male_finance) and the
    # same "Male - warm and expressive" voice. Scene is "sova_Interior_13" —
    # a warm marble reception/lobby — chosen deliberately DIFFERENT from
    # Sara's below (see her comment): sharing one room read as generic, and
    # a distinct, slightly more formal space suits Alex's direct/structured
    # engineering-hiring persona.
    perxona_presenter_avatar_id: str = "01K4M8SH17VHBRTXWEB2KKYPCS"
    perxona_presenter_scene_id: str = "01K87XYCZ1H1QJ1J28NMZN8WEP"
    perxona_presenter_voice_id: str = "01KWV12DBD8VTFA4YXJ4AHCCHR"

    # Sara — the second interviewer persona. Chosen from the same Connect
    # asset catalog (queried directly via the Connect API, GET
    # /api/v1/connect/assets/avatars|scenes|voices — no console login
    # needed): cc007_female_hr (same professional-suit collection as Alex's
    # cc006_male_finance) and the "Female - steady and approachable" Azure
    # voice — same provider and EN/JA coverage as Alex's voice. Scene is
    # "sova_Interior_30" — a warm, bookshelf-lined study/office, visually
    # distinct from Alex's marble reception above (see live testing notes:
    # both interviewers sharing the exact same background read as an
    # oversight rather than two people in two different rooms) and a good
    # fit for her warmer HR/people-ops persona.
    perxona_sara_avatar_id: str = "01K4M8T4RF9HTYE1W0M0957VSJ"
    perxona_sara_scene_id: str = "01KPW5FQT3KYNBYG618FF4N39R"
    perxona_sara_voice_id: str = "01KWV12DBC54C1P0BVY3C3P1JA"

    # Gemini / Vertex AI
    gemini_model: str = "gemini-3.5-flash"
    google_cloud_project: str | None = None
    google_cloud_location: str = "asia-northeast1"

    # Data
    gcs_bucket: str | None = None  # optional — if unset, PDFs are written to local disk (pdf_dir)
    pdf_dir: str = "generated_pdfs"

    # Interview bounds (spec §3) — the candidate-facing question count
    # (3/5/10/15/20) is chosen per-session at Setup and lives on Session.
    # question_rounds, not here.
    min_competencies: int = 4
    max_competencies: int = 5
    max_followups_per_competency: int = 2


settings = Settings()
