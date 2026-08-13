from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import init_db
from app.interviewers import INTERVIEWER_PROFILES
from app.routers import sessions
from app.services.db_sync import download_db_on_startup
from app.services.gemini_client import check_connection as check_gemini_connection
from app.services.perxona_connect import get_connect_token

app = FastAPI(title="Mensetsu")

app.include_router(sessions.router, prefix="/api")


@app.on_event("startup")
def on_startup() -> None:
    download_db_on_startup()
    init_db()


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "mensetsu"}


@app.get("/api/config")
def frontend_config() -> dict:
    """Public config the frontend needs to boot the avatar(s) — the
    presenter script URL plus each interviewer's Presenter target
    (avatar/scene/voice), keyed by interviewer id. No secrets: the Connect
    bearer token used to actually authenticate is minted separately, on
    demand, via GET /api/connect-token (shared across both interviewers —
    it's an org-level Connect credential, not avatar-specific).
    """
    return {
        "avatar_mode": settings.avatar_mode,
        "perxona_presenter_url": settings.perxona_presenter_url,
        "interviewers": {
            interviewer_id: {
                "avatar_id": profile["avatar_id"],
                "scene_id": profile["scene_id"],
                "voice_id": profile["voice_id"],
                "display_name": profile["display_name"],
            }
            for interviewer_id, profile in INTERVIEWER_PROFILES.items()
        },
    }


@app.get("/api/connect-token")
def connect_token() -> dict:
    """Mints (or reuses) the Perxona Connect bearer token — the frontend
    passes this straight into `presenter.initialize(connect_token, target)`.
    Our backend is the only thing that ever sees PERXONA_CONNECT_PASSWORD.
    """
    return {"connect_token": get_connect_token()}


@app.get("/api/status")
def connection_status() -> dict:
    """Status-dot data for the UI. `gemini_connected` is a real (cheap)
    connectivity check; `perxona_configured` only confirms the Connect
    credentials needed to authenticate exist — the frontend upgrades this
    to a live signal once the presenter itself reports ready (see
    PerxonaAvatarController).
    """
    return {
        "gemini_connected": check_gemini_connection(),
        "perxona_configured": bool(settings.perxona_connect_email and settings.perxona_connect_password),
    }


# Serve the built React frontend as static files (single container, per spec §12).
# In local dev the frontend runs separately via `npm run dev`; this directory only
# exists after `npm run build` (or inside the Docker image).
static_dir = Path(__file__).parent / "static"
assets_dir = static_dir / "assets"
if assets_dir.exists():
    # Vite's hashed JS/CSS output — mounted under its own prefix (not bare "/")
    # so it doesn't swallow the SPA-fallback catch-all route below.
    app.mount("/assets", StaticFiles(directory=assets_dir), name="static-assets")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str) -> FileResponse:
        """Serves the app shell for any non-API route so React Router's
        client-side routes (e.g. /interview/<id>) work on direct navigation
        or a page refresh, not just when reached via in-app navigation —
        StaticFiles(html=True) alone only serves index.html for the root."""
        return FileResponse(static_dir / "index.html")
