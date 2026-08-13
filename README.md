# Mensetsu AI (面接) — AI Interview Screening That Can Actually Tell Candidates Apart

## The Problem

Every résumé looks the same now. AI writing tools have made it trivial to produce a polished, keyword-optimized CV — over half of job seekers now use tools like ChatGPT to write theirs, and adoption is climbing fast, with broader surveys putting AI usage in job applications as high as 65–74%. That means recruiters can no longer use résumé quality as a screening signal at all: the candidate who can write the best prompt looks identical to the candidate who can actually do the job.

This lands on two groups at once:

- **Recruiters and hiring teams**, who were already spending significant time screening — roughly 23 hours per hire, on résumés that get an initial scan of only 7–11 seconds each — now on a signal that's actively degraded. Résumé embellishment was common before AI made it effortless (most workers admit to having exaggerated something on a résumé, and most hiring managers report catching one), and hiring managers routinely find out the hard way, *after* the interview has already been spent.
- **Candidates**, who are stuck preparing against generic "top interview questions" lists that don't resemble how a real adaptive interview actually behaves, and don't check anything against their own résumé.

## The Solution

Don't screen the résumé. Screen the *person*, live, through a real spoken interview, and check what they say against what they claimed. Upload a job description and a résumé. Gemini plans a tailored set of competencies to probe. One or two named AI interviewers — Alex and Sara — conduct an adaptive, spoken interview through a real-time avatar, not a script. Every answer is cross-checked against the specific résumé claim it was meant to prove, live, turn by turn.

**How AI actually contributes** — not "an LLM answers questions," but five distinct, purposeful roles working together in a bounded pipeline: a **Planner** that builds a tailored competency checklist per role and résumé; an **adaptive Router** that decides live, after every answer, whether to advance, probe a vague answer, challenge a résumé mismatch, or follow a more relevant thread; a silent **Assessor** that cross-references every scored answer against its specific résumé claim with a real evidence quote; a **Coach** that turns that evidence into personalized spoken feedback in practice mode; and a **Report** agent that synthesizes everything into a structured, evidence-backed document. See "How the interview works" below for the full mechanics.

The same engine runs two products from one build:

- **B2B — hiring mode**, ending in a scored, evidence-backed recommendation for a recruiter, for teams doing first-round screening at volume who need a signal AI-polished résumés can't fake.
- **B2C — practice mode**, ending in personalized spoken coaching for the candidate — a rehearsal against a real adaptive interviewer instead of a static question bank, closing with concrete feedback rather than generic advice.

This isn't a hopeful architecture claim: `interview_loop.py`, `planner.py`, and `interviewer.py` contain zero role-based branching. `session.mode` (`hiring` | `practice`) only changes what happens *after* the identical adaptive interview finishes — a scored report, or a spoken coaching walkthrough. There's no B2B-only code to rip out to serve a candidate directly; it's one engine serving both sides of the same hiring relationship. Hiring the right person — or getting ready to be hired — is the goal. The résumé reality-check is how Mensetsu AI gets there, not the pitch itself.

## The Prototype

This is a working, end-to-end system, not a mockup — every piece below is built and running:

```
Setup                       Interview                              Complete
──────────────────          ────────────────────────────────       ─────────────────────
Upload JD + résumé      →   Alex (and Sara, if selected) speak  →  Hiring: scored PDF —
Pick mode: hiring/            each question (Perxona SDK)             recommendation,
  practice                   Candidate answers by voice or text       scorecard, résumé
Pick 1 or 2 interviewers     Adaptive follow-ups / challenges          reality-check
Pick question count          Practice mode: spoken feedback walk-  →  Practice: coaching
Gemini plans competencies      through after the last question         report + model
                                                                        example answers
```

<p align="center">
  <img src="docs/screenshots/setup-screen.jpg" alt="Mensetsu AI Setup screen" width="49%" />
  <img src="docs/screenshots/live-interview.jpg" alt="Live 3D interview avatar, mid-question" width="49%" />
</p>

The single most differentiating moment to see live: the interviewer visibly **probing** a vague answer or **challenging** a résumé claim mid-interview — not a canned reaction, a decision made fresh against the full conversation so far. See ["The report"](#the-report) below for what that produces once the interview ends, with a real example transcript.

## The Impact

- If AI-written résumés have pushed genuine signal out of a 7–11 second initial scan, and recruiters are already spending ~23 hours per hire on screening, the value isn't "faster reading" — it's *replacing a skim with a live cross-examination* without costing the recruiter that same 23 hours.
- With most workers admitting to résumé embellishment, and skills/responsibilities being the most commonly inflated claims, a system that tags every answer against its specific résumé claim — with a direct evidence quote — turns "I have a hunch this might be inflated" into a documented, defensible finding a hiring team can act on.
- For candidates, the same adaptive engine becomes practice that matches the *actual* interview they're about to have for a *specific* role, with feedback that names precisely what to fix.
- Two independent revenue motions from one core engine: per-seat/per-screen pricing for hiring teams, freemium-to-paid coaching for candidates — R&D on the adaptive Router and Assessor compounds across both.

## The Future

- **Scale the data layer.** Today's persistence is a single SQLite file — intentionally simple for a single-concurrent-user build. Postgres/Cloud SQL for real concurrent volume is the scoped next step, not an open question.
- **ATS / HRIS integration** — plug into the recruiter workflows that already exist (Greenhouse/Lever-style pipelines) instead of being a separate destination.
- **Deeper analytics for hiring teams** — cross-candidate comparison, competency benchmarking across a requisition, consistency auditing across interviewers.
- **Expand language and market coverage** — the bilingual, culturally-aware delivery model (built for Japan first) generalizes to other markets with distinct interview etiquette.
- **Richer practice-mode products** — role- and industry-specific tracks, progress tracking across sessions, a freemium-to-paid coaching tier.

## How the interview works — two interviewers, one adaptive engine

Sessions run with one interviewer (Alex) or two (Alex **and** Sara), the candidate's choice at setup. In a two-interviewer session they alternate questions and **split the same fixed question budget rather than doubling it** — Alex leans engineering/technical and direct; Sara leans HR/people-ops and conversational, and the plan deliberately guarantees Sara gets at least one behavioral/culture-fit competency rather than leaving it to alternation luck. Each speaks with a distinct Perxona avatar, voice, and background scene.

Five distinct Gemini roles run this product, each with its own dedicated system prompt and a single job — not one general-purpose prompt asked to do everything:

1. **Planner.** The job description and résumé are turned into 4–5 tailored competencies, each with the specific résumé claim to probe.
2. **Intro (fixed, bounded turns).** The interviewer(s) introduce themselves and the role, ask the candidate to introduce themselves, then ask up to two natural follow-ups grounded in what they actually said. In a two-interviewer session, the first hands off to the second before the candidate is asked to speak.
3. **Adaptive competency loop (bounded by the candidate's chosen question count: 3/5/10/15/20).** After every answer, an LLM router chooses exactly one move:
   - `advance` — the answer was specific and complete.
   - `probe` — vague or buzzwordy; ask for a concrete example.
   - `challenge` — the answer is thinner than, or contradicts, the résumé's claim for this competency.
   - `follow_thread` — the answer opened a more relevant thread worth pursuing.

   Every decision is made against the **full transcript so far**, not just the last answer, referencing specific things the candidate said earlier the way a real interviewer builds a conversation instead of running a checklist. Follow-ups are capped per competency, so the interview always terminates.
4. **Assessor.** Runs silently on every scored turn, invisible to the candidate. Tags the answer against its résumé claim — `supports` | `contradicts` | `unsubstantiated` | `not_applicable` — with an evidence quote pulled from the candidate's own words. This is the mechanism behind the résumé reality-check: a live cross-reference, not a keyword match, and not something the candidate ever sees happening.
5. **Closing / Coach, depending on mode.** Hiring sessions close with an invitation for the candidate's own questions, answered strictly from the job description (or a plain "I'll check with the hiring team," never invented). Practice sessions instead move into feedback: a brief spoken transition acknowledging the last answer, then the Coach agent walks through personalized STAR (general competencies) or Problem/Approach/Tradeoffs/Outcome (technical competencies) feedback per competency — delivered by whichever interviewer asked it live. After each item the candidate can ask a follow-up question about it or move to the next; once the last one's done, whoever's speaking signs off and the session completes.
6. **Report.** Hiring sessions get a scored, evidence-backed scorecard and recommendation; practice sessions get a written coaching report built from the same content the avatar already spoke.

The persona is explicitly tuned for the Japanese hiring market regardless of which language is spoken — English or Japanese, selectable at setup — with a measured, formal register and no American-style small talk, and every line is written with TTS delivery in mind: punctuation is the only real pacing control available, since there's no separate prosody channel.

## The avatar (Perxona Presenter SDK)

This is not a chat widget with a video attached. The avatar is driven by Perxona's **Presenter SDK** (`<sv-presenter>` + `present()`), a stateless "speak this" API with no autonomous AI of its own. That was a deliberate choice after testing the conversational `<sv-agent>` widget and finding its own built-in AI would generate unrelated responses regardless of what was sent to it. `present()` speaks exactly what it's given, every time, which is what makes the adaptive interview loop above actually reliable end to end.

**Why this specific piece of infrastructure matters to this specific use case:** a hiring interview only produces a usable signal if the candidate actually engages with it like an interview, not a form. That requires an interviewer with a real presence — expressions that track what's being said, a listening posture, visible reactions to a strong answer — not a static portrait reading text aloud. At the same time, a fair, repeatable screening process cannot tolerate an avatar that improvises: every candidate for a given role needs to be asked the same adaptively-generated question, worded exactly the way the interview logic decided. That's the gap between the two Perxona products tried here: the conversational `<sv-agent>` widget was expressive but unreliable; the Presenter SDK is exactly reliable enough to trust with a hiring decision *and* expressive enough to make the interview worth taking seriously.

The SDK's capabilities are used well beyond "make it talk":

- **Emotion to real motion, not a text label.** Every line already carries an `emotion_tag` (`encouraging` / `approving` / `probing` / `neutral`). That tag maps to real motion IDs pulled from the avatar's own catalog (`GET /api/v1/connect/assets/avatars/{id}/motions`) and is embedded directly in the spoken text via Perxona's Motion Markup: `[MOTION motion_id:priority]` — chosen conservatively to match the "measured, formal" register rather than generic enthusiasm.
- **`setThinking(true)` during Gemini's generation latency**, instead of the avatar standing frozen while the next question is generated.
- **`setListening(true)` tied to actual mic capture**, not a separate UI-only flag.
- **`PRESENTER_STATUS` lifecycle tracking** (`Uninitialized → Initializing → Ready`) drives the app's own live connection indicator and the "connecting…" overlay stays up for the entire connection window, not just before the click — the first question shouldn't be able to start before the candidate can see the avatar is actually ready.
- **`CONNECT_TOKEN_EXPIRED` handling with `refreshConnectToken()`** so a mid-interview token rotation never surfaces as a broken avatar.
- **`PERFORMANCE_END`-driven turn completion**, tuned specifically to avoid two different live failure modes: waiting for the SDK to *confirm* it returned to idle (tried first) added noticeable lag to every ordinary turn; trusting `PERFORMANCE_END` alone let a long, multi-sentence line's audio get cut short by the next speaker starting over its tail. The current approach uses `PERFORMANCE_END` as the fast default for ordinary turns, with an estimated-duration floor that only kicks in above ~10 seconds of expected speech — long enough to guard the real risk (hand-off lines, feedback walkthroughs) without taxing every short answer with it.

Getting this reliable took real debugging, documented in the code as it was found — `resumeAudioPlayback()` must be called *after* `initialize()`, not before (the audio context doesn't exist until `initialize()` creates it); script loading and connection setup are moved out of the click handler entirely (`preload()`, run the moment the page mounts) so the actual audio-unlock call stays as close as possible to the user's real click, since browser autoplay policy is stricter about this than it first appears.

## The report

The interview isn't the product. The decision it supports is — a scored recommendation for a recruiter, or a coaching walkthrough for a candidate — and the report is what carries that decision forward. Every session ends in a structured, bilingual PDF built from the full transcript and the competency-level evidence gathered turn by turn during the interview itself, not bolted on afterward.

**Hiring mode:**
- **A clear recommendation** (`advance`, `do_not_advance`, or `borderline`), written as decision support for a human recruiter, never as an automated verdict.
- **A per-competency scorecard** (`Strong` / `Adequate` / `Weak`), each rating justified with a specific traceable quote from the interview.
- **The résumé reality check**, the mechanism behind the recommendation: a narrative synthesis of where the live interview backed up the résumé and where it didn't, built from the Assessor's per-turn `supports` / `contradicts` / `unsubstantiated` tags — a structured field generated from evidence collected live, not inferred after the fact.
- **Pros, cons, and concrete next steps**, everything grounded in something actually said. In two-interviewer sessions, each interviewer's own independent read plus a synthesized panel view.

**Practice mode:**
- **What went well / what to improve**, per competency, grounded in the actual answer given.
- **A model example answer** for each question — STAR structure for general competencies, Problem/Approach/Tradeoffs/Outcome for technical ones.
- **Overall strengths, areas to improve, and practice recommendations** for the candidate's next session or real interview.

**[See a real hiring report →](docs/sample-report.pdf)**, an actual session, not a mockup. The candidate's résumé claimed she led a monolith-to-microservices migration and designed a Kafka event bus. Asked to walk through it, her real answer was *"Well we did it in team so I am not at all aware."* Pushed on her individual contribution, it narrowed to SAP data extraction. Asked about a Redis caching strategy she'd listed: *"I dont remember much regarding it."* Asked to name the async libraries behind a claimed 300% performance gain: *"I dont remember."* The adaptive router pressed the same claim across five separate turns before moving on. This is what "probe the résumé" actually looks like in a real transcript. Recommendation: **Do not advance**, with every line of justification traceable back to one of those exact answers.

## Tech stack

- **Backend:** FastAPI + SQLAlchemy (SQLite, GCS-synced for Cloud Run's ephemeral disk), Gemini via Vertex AI (Application Default Credentials, no API keys), with retry-with-backoff around every Gemini call so a transient network/5xx blip doesn't fail an otherwise-normal turn.
- **Frontend:** React + Vite, Perxona Presenter SDK, browser SpeechRecognition/speechSynthesis for a zero-credit "mock mode."
- **Deploy:** single Docker image (React build served as static files by FastAPI), Cloud Run.

## Responsible use, by design

This is a **decision-support** tool, not an auto-reject pipeline. That's a deliberate product boundary, not a legal disclaimer bolted on afterward. The Report agent's own system prompt is explicitly instructed to write in a confident but not absolute tone, and every recommendation is framed as input to a human decision. Hiring is a regulated, high-risk use of AI; a product that quietly automated the reject decision itself would be solving the wrong problem. Practice mode carries the same discipline in the other direction: its coaching report explicitly frames itself as guidance to prepare with, not a guarantee of how any real interview will go. A human stays in the loop because the architecture puts them there, not because a README says to.

## Local development

Requires Python 3.11+, Node 20+.

### Backend

```
cd backend
python -m venv .venv
.venv/Scripts/activate   # Windows; use `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
uvicorn server:app --reload --port 8080
```

Health check: `http://127.0.0.1:8080/api/health`

### Frontend

```
cd frontend
npm install
npm run dev
```

Runs at `http://127.0.0.1:5173` and proxies `/api/*` to the backend on `:8080` (see `vite.config.js`). In production both are served from one origin: `npm run build` output is copied into `backend/static/` and served by FastAPI (see `Dockerfile`).

**Windows note:** if `npm run dev` starts but nothing responds on `localhost:5173`, it's a Node IPv6-vs-IPv4 loopback binding quirk, not a real failure. `vite.config.js` already pins `host: "127.0.0.1"` to avoid it.

### WeasyPrint (PDF report generation)

WeasyPrint needs native Pango/GDK-Pixbuf libraries not present on Windows by default. PDF generation only works inside the Docker container (Linux) or on macOS/Linux with GTK installed. This doesn't block any other local dev work; the PDF service module is imported lazily so its absence doesn't break the rest of the app.

## Environment variables

Copy `backend/.env.example` to `backend/.env` for local dev (already gitignored, never commit it). **In production, set these directly as Cloud Run env vars.**

| Variable | Default | Purpose |
|---|---|---|
| `AVATAR_MODE` | `mock` | `mock` \| `perxona`. **Default `mock` so Perxona credits are never spent by accident.** |
| `PERXONA_CONNECT_EMAIL` / `PERXONA_CONNECT_PASSWORD` | — | A Perxona **Connect** account (separate from the old `<sv-agent>` domain-scoped API key) that the backend logs into to mint a short-lived bearer token for the Presenter SDK; see `backend/app/services/perxona_connect.py`. Kept out of git entirely; set once as Cloud Run env vars. |
| `PERXONA_API_BASE_URL` | `https://console.perxona.ai/asia` | Region-specific Connect API base URL. |
| `PERXONA_PRESENTER_URL` | Perxona CDN, `/asia/` region | Presenter engine script URL, region-scoped, matters for auth. |
| `PERXONA_PRESENTER_AVATAR_ID` / `_SCENE_ID` / `_VOICE_ID` | Alex's IDs | Alex — navy-suited male avatar, a warm marble reception/lobby scene, warm male voice. |
| `PERXONA_SARA_AVATAR_ID` / `_SCENE_ID` / `_VOICE_ID` | Sara's IDs | Sara — professional female avatar, a distinct bookshelf-lined study/office scene (deliberately different from Alex's — two interviewers, two rooms), steady/approachable female voice. |
| `GEMINI_MODEL` | `gemini-3.5-flash` | Vertex AI Gemini model id |
| `GOOGLE_CLOUD_PROJECT` | — | GCP project for Vertex AI |
| `GOOGLE_CLOUD_LOCATION` | `asia-northeast1` | Vertex AI region |
| `GCS_BUCKET` | — | Bucket for the SQLite DB and generated PDFs, so they survive Cloud Run's ephemeral disk and multi-instance model. Falls back to local disk if unset (fine for local dev only). |

Vertex AI auth uses Application Default Credentials. On Cloud Run this is automatic via the service account (needs the **Vertex AI User** role). For local testing, run `gcloud auth application-default login` yourself.

## Deploy (Cloud Run)

```
gcloud builds submit --config cloudbuild.yaml . --project <your-project-id>
```

Builds the multi-stage `Dockerfile` (React build served as static files by FastAPI/uvicorn) and deploys to Cloud Run. Non-secret env vars are baked into `cloudbuild.yaml`. The Perxona Connect credentials are deliberately **not** in `cloudbuild.yaml` (kept out of git). Set them once, directly on the service:

```
gcloud run services update <service-name> \
  --region <region> --project <project-id> \
  --update-env-vars PERXONA_CONNECT_EMAIL=...,PERXONA_CONNECT_PASSWORD=...
```

`--update-env-vars` merges rather than replaces, so this only needs to run once. It persists across every future redeploy.

## Project structure

```
backend/
  server.py               FastAPI app entrypoint, mounts built frontend as static files
  app/
    config.py              env-driven settings
    database.py             SQLAlchemy engine/session (SQLite, GCS-synced)
    interviewers.py          Alex/Sara persona registry (name, bio, avatar/scene/voice)
    models.py                 Session, Competency, Turn, Report, PracticeReport
    schemas.py                  Pydantic request/response shapes
    routers/                     API endpoints
    prompts/                      Planner / Interviewer-Router / Assessor / Coach / Report
                                    prompt templates — pure text, no business logic
    services/                       interview_loop (the bounded adaptive state machine),
                                      Gemini calls (with retry), Perxona Connect auth,
                                      PDF generation, document extraction
frontend/
  src/
    pages/                  Setup / Interview / Complete screens
    avatar/                   AvatarController interface + Mock/Perxona implementations
    components/                 CameraPanel etc.
Dockerfile                 multi-stage build, single container for Cloud Run
cloudbuild.yaml             Cloud Build + Cloud Run deploy pipeline
```
