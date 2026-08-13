import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import FileDropZone from "../components/FileDropZone.jsx";
import alexAvatar from "../assets/alex-avatar.png";
import saraAvatar from "../assets/sara-avatar.png";

const ACCEPT = ".pdf,.docx";

// Mirrors the persona registry in backend/app/interviewers.py — short
// enough here to just be static copy rather than another round trip.
const INTERVIEWER_PROFILES = {
  alex: {
    displayName: "Alex",
    avatar: alexAvatar,
    blurb: "Background in engineering and hiring. Direct and structured.",
  },
  sara: {
    displayName: "Sara",
    avatar: saraAvatar,
    blurb: "Background in HR and people operations. Warm and conversational.",
  },
};
const INTERVIEWER_ORDER = ["alex", "sara"];

const MODE_COPY = {
  hiring: {
    label: "Schedule Interview",
    tagline: "For recruiters and hiring teams",
    description: "Screen a candidate against a specific role and get a scored, evidence-backed recommendation.",
    headline: "Run the interview built for this exact role, not a generic one.",
    brandCopy:
      "AI writing tools made polished resumes easy to fake, which makes them hard to tell apart. Upload the " +
      "role and the candidate. We plan a tailored interview, run it live through an avatar, and hand your " +
      "team a clear, evidence-backed read on who to move forward.",
    kicker: "New interview",
    title: "Set up this interview",
    subtitle: "Two files and you're ready to go.",
    recruiterPromptLabel: "Custom instructions (optional)",
    recruiterPromptPlaceholder: "e.g. Focus on backend depth and give extra weight to system design experience.",
    submitLabel: "Start interview →",
    features: [
      { icon: <TargetIcon />, text: "Questions tailored to this role and this resume, not a generic script" },
      { icon: <WaveIcon />, text: "Live adaptive interview that probes vague or inflated claims" },
      { icon: <ChartIcon />, text: "A resume reality check: where the interview backed up the resume, and where it didn't" },
    ],
  },
  practice: {
    label: "Practice Interview",
    tagline: "For candidates preparing on their own",
    description: "Run the same live interview for a role you're targeting, then get personalized, structured coaching.",
    headline: "Practice the interview you're actually about to have, not a generic one.",
    brandCopy:
      "Upload the job you're targeting and your resume. We run the same live, adaptive interview a recruiter " +
      "would see, then the same avatar walks you through what you said well, what to sharpen, and a " +
      "model example answer for each question, before handing you a coaching report to take with you.",
    kicker: "New practice session",
    title: "Set up your practice session",
    subtitle: "Two files and you're ready to go.",
    recruiterPromptLabel: "What would you like to focus on practicing? (optional)",
    recruiterPromptPlaceholder: "e.g. I want extra pressure-testing on system design questions.",
    submitLabel: "Start practicing →",
    features: [
      { icon: <TargetIcon />, text: "The same live, adaptive interview a real screening would run" },
      { icon: <WaveIcon />, text: "The avatar walks you through feedback after every question" },
      { icon: <ChartIcon />, text: "A model example answer for each question, plus a take-home coaching report" },
    ],
  },
};

// Setup does real work server-side (document extraction + a live Gemini call
// to plan competencies) that can take several seconds — cycle through these
// so the wait reads as visible progress instead of a frozen button.
const SETUP_STEPS = [
  "Reading the job description…",
  "Reviewing the resume…",
  "Mapping the competencies this role needs…",
  "Almost ready…",
];

export default function Setup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedMode = searchParams.get("mode");
  const [mode, setMode] = useState(requestedMode === "practice" ? "practice" : "hiring");
  const [interviewers, setInterviewers] = useState(["alex"]);
  const [jdFile, setJdFile] = useState(null);
  const [resumeFile, setResumeFile] = useState(null);
  const [recruiterPrompt, setRecruiterPrompt] = useState("");
  const [language, setLanguage] = useState("auto");
  const [questionRounds, setQuestionRounds] = useState(10);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [geminiConnected, setGeminiConnected] = useState(false);
  const [perxonaConfigured, setPerxonaConfigured] = useState(false);

  const copy = MODE_COPY[mode];
  const canSubmit = jdFile && resumeFile && !submitting;

  // Surface connection status before the user commits to starting a
  // session — otherwise a missing/expired credential only shows up as a
  // confusing failure after they've already picked files and clicked start.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/status")
      .then((res) => res.json())
      .then((status) => {
        if (cancelled) return;
        setGeminiConnected(Boolean(status.gemini_connected));
        setPerxonaConfigured(Boolean(status.perxona_configured));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleInterviewer(id) {
    setInterviewers((current) => {
      const has = current.includes(id);
      if (has && current.length === 1) return current; // at least one interviewer required
      const next = has ? current.filter((i) => i !== id) : [...current, id];
      return INTERVIEWER_ORDER.filter((i) => next.includes(i)); // canonical order regardless of click order
    });
  }

  useEffect(() => {
    if (!submitting) {
      setStepIndex(0);
      return;
    }
    const id = setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, SETUP_STEPS.length - 1));
    }, 2200);
    return () => clearInterval(id);
  }, [submitting]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    const form = new FormData();
    form.append("jd_file", jdFile);
    form.append("resume_file", resumeFile);
    if (recruiterPrompt.trim()) form.append("recruiter_prompt", recruiterPrompt.trim());
    if (language !== "auto") form.append("language", language);
    form.append("question_rounds", String(questionRounds));
    form.append("mode", mode);
    form.append("interviewers", interviewers.join(","));

    try {
      const res = await fetch("/api/sessions", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Something went wrong setting up the interview. Please try again.");
      }
      const session = await res.json();
      navigate(`/interview/${session.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // Skips the file picker for a live demo — same create-session flow as
  // handleSubmit, just with the JD/résumé already sitting in GCS instead of
  // picked by hand (see backend POST /sessions/demo).
  async function handleDemo() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/sessions/demo", { method: "POST", body: "" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Something went wrong starting the demo. Please try again.");
      }
      const session = await res.json();
      navigate(`/interview/${session.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="setup-screen">
      <div className="setup-screen__brand">
        <div className="setup-screen__brand-glow" aria-hidden="true" />
        <div className="setup-screen__brand-inner">
          <div className="setup-screen__topbar">
            <Link to="/" className="setup-screen__wordmark">
              <span className="setup-screen__wordmark-mark" aria-hidden="true">
                <MarkIcon />
              </span>
              Mensetsu AI
            </Link>
            <div className="setup-screen__topbar-right">
              <div className="interview-screen__status-lights">
                <span className="status-light" title={`Gemini: ${geminiConnected ? "connected" : "not connected"}`}>
                  <span className={`status-light__dot${geminiConnected ? " is-green" : " is-red"}`} />
                  Gemini
                </span>
                <span
                  className="status-light"
                  title={`Perxona: ${perxonaConfigured ? "credentials configured" : "not configured"}`}
                >
                  <span className={`status-light__dot${perxonaConfigured ? " is-green" : " is-red"}`} />
                  Perxona
                </span>
              </div>
              <Link to="/" className="setup-screen__back-link">
                ← Back home
              </Link>
            </div>
          </div>

          <div className="setup-screen__headline-row">
            <h1>{copy.headline}</h1>
            <p className="setup-screen__brand-copy">{copy.brandCopy}</p>
          </div>

          <ul className="setup-screen__features">
            {copy.features.map((f, i) => (
              <li key={i}>
                <span className="setup-screen__feature-icon">{f.icon}</span>
                {f.text}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="setup-screen__form-side">
        <div className="setup-screen__form-inner">
          {submitting && (
            <div className="setup-loading" role="status" aria-live="polite">
              <span className="setup-loading__spinner" aria-hidden="true" />
              <p className="setup-loading__title">Setting up your {mode === "practice" ? "practice session" : "interview"}…</p>
              <p className="setup-loading__step">{SETUP_STEPS[stepIndex]}</p>
            </div>
          )}

          <div className="mode-toggle" role="group" aria-label="Interview mode">
            {Object.entries(MODE_COPY).map(([key, m]) => (
              <button
                key={key}
                type="button"
                className={`mode-toggle__option${mode === key ? " is-selected" : ""}`}
                onClick={() => setMode(key)}
                disabled={submitting}
              >
                <span className="mode-toggle__label">{m.label}</span>
                <span className="mode-toggle__tagline">{m.tagline}</span>
                <span className="mode-toggle__description">{m.description}</span>
              </button>
            ))}
          </div>

          <span className="setup-screen__kicker">{copy.kicker}</span>
          <h2>{copy.title}</h2>
          <p className="setup-screen__subtitle">{copy.subtitle}</p>

          {mode === "hiring" && (
            <>
              <button type="button" className="setup-screen__demo-button" onClick={handleDemo} disabled={submitting}>
                Try a live demo
              </button>
              <p className="setup-screen__demo-hint">Starts the demo interview with Alex right away, nothing to upload.</p>

              <div className="setup-screen__divider">
                <span>or set up your own</span>
              </div>
            </>
          )}

          <div className="field">
            <span>Who do you want to {mode === "practice" ? "practice with" : "interview with"}?</span>
            <div className="interviewer-toggle" role="group" aria-label="Interviewers">
              {INTERVIEWER_ORDER.map((id) => {
                const profile = INTERVIEWER_PROFILES[id];
                const selected = interviewers.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className={`interviewer-toggle__option${selected ? " is-selected" : ""}`}
                    onClick={() => toggleInterviewer(id)}
                    disabled={submitting}
                    aria-pressed={selected}
                  >
                    <img src={profile.avatar} alt="" aria-hidden="true" />
                    <span className="interviewer-toggle__name">{profile.displayName}</span>
                    <span className="interviewer-toggle__blurb">{profile.blurb}</span>
                  </button>
                );
              })}
            </div>
            {interviewers.length === 2 && (
              <p className="interviewer-toggle__hint">
                Both take questions and split the same question budget. It doesn't double.
              </p>
            )}
          </div>

          <form onSubmit={handleSubmit}>
            <div className="setup-screen__uploads">
              <FileDropZone
                label="Job description"
                accept={ACCEPT}
                file={jdFile}
                onChange={setJdFile}
                icon={<DocumentIcon />}
              />
              <FileDropZone
                label="Candidate resume"
                accept={ACCEPT}
                file={resumeFile}
                onChange={setResumeFile}
                icon={<PersonIcon />}
              />
            </div>

            <label className="field">
              <span>{copy.recruiterPromptLabel}</span>
              <textarea
                value={recruiterPrompt}
                onChange={(e) => setRecruiterPrompt(e.target.value)}
                placeholder={copy.recruiterPromptPlaceholder}
                rows={3}
              />
            </label>

            <label className="field">
              <span>Interview language</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="auto">Auto-detect from job description</option>
                <option value="en">English</option>
                <option value="ja">Japanese</option>
              </select>
            </label>

            <div className="field">
              <span>Number of questions</span>
              <div className="rounds-picker">
                {[3, 5, 10, 15, 20].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`rounds-picker__option${questionRounds === n ? " is-selected" : ""}`}
                    onClick={() => setQuestionRounds(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" disabled={!canSubmit}>
              {submitting ? "Setting up…" : copy.submitLabel}
            </button>
          </form>

          <p className="responsible-use-note">
            Every recommendation from Mensetsu AI is a starting point for your team's journey to the right
            candidate.
          </p>
        </div>
      </div>
    </main>
  );
}

function MarkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2 21 12 12 22 3 12 12 2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M6 2.5h8l4 4V21a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 21V3a.5.5 0 0 1 .5-.5Z" />
      <path d="M14 2.5V7h4" />
      <path d="M9 12h6M9 15.5h6M9 8.5h2" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5" />
    </svg>
  );
}

function TargetIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" />
    </svg>
  );
}

function WaveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2 12h3l2-6 4 12 3-9 2 5h6" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 20V10M12 20V4M20 20v-7" />
      <path d="M2 20h20" />
    </svg>
  );
}
