import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import alexAvatar from "../assets/alex-avatar.png";
import saraAvatar from "../assets/sara-avatar.png";

const STATS = [
  { value: "2", label: "AI interviewers" },
  { value: "EN + JA", label: "languages supported" },
  { value: "<3 min", label: "setup to first question" },
];

export default function Landing() {
  const navigate = useNavigate();
  const [startingDemo, setStartingDemo] = useState(false);
  const [error, setError] = useState(null);

  async function startDemo() {
    if (startingDemo) return;
    setStartingDemo(true);
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
      setStartingDemo(false);
    }
  }

  return (
    <main className="landing">
      <div className="landing__hero-band">
        <div className="landing__bg" aria-hidden="true" />

        <header className="landing__nav">
          <div className="landing__wordmark">
            <span className="landing__wordmark-mark" aria-hidden="true">
              <MarkIcon />
            </span>
            Mensetsu AI
          </div>
          <Link to="/how-it-works" className="landing__nav-link">
            How it works
          </Link>
        </header>

        <section className="landing__hero">
          <span className="landing__badge">
            <span className="landing__badge-dot" aria-hidden="true" />
            Live AI interview avatars
          </span>

          <h1 className="landing__headline">
            AI makes every resume look the same now.
            <br />
            <span className="landing__headline-accent">Find out who's actually right for the role.</span>
          </h1>

          <p className="landing__subheadline">
            Businesses use Mensetsu AI to schedule interviews with candidates, see how they actually perform,
            and shortlist the right ones to move forward. Candidates use it to practice for real interviews
            and get personal recommendations to improve.
          </p>

          <div className="landing__actions">
            <button type="button" className="landing__cta landing__cta--primary" onClick={startDemo} disabled={startingDemo}>
              <span className="landing__cta-main">
                {startingDemo && <span className="landing__cta-spinner" aria-hidden="true" />}
                {startingDemo ? "Starting…" : "Try the live demo →"}
              </span>
              <span className="landing__cta-sub">with Alex</span>
            </button>
            <button type="button" className="landing__cta" onClick={() => navigate("/setup?mode=practice")}>
              Practice an interview
            </button>
            <button type="button" className="landing__cta" onClick={() => navigate("/setup?mode=hiring")}>
              Schedule a real interview
            </button>
          </div>

          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}

          <p className="landing__fineprint">No login required. Try the live demo free, nothing to upload.</p>

          <div className="landing__stats">
            {STATS.map((s) => (
              <div key={s.label} className="landing__stat">
                <span className="landing__stat-value">{s.value}</span>
                <span className="landing__stat-label">{s.label}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="landing__avatars">
        <div className="landing__avatars-inner">
          <div className="landing__avatars-copy">
            <span className="landing__kicker">Meet your interviewer</span>
            <h2>Choose your interviewer</h2>
            <p>
              Run your interview with Alex, Sara, or both together. If you pick both, they take turns asking
              questions from the same list, so it takes no longer than a single interviewer would.
            </p>
          </div>
          <div className="landing__avatars-figures">
            <figure className="landing__avatar-figure">
              <img src={alexAvatar} alt="Alex, an AI interviewer" />
              <figcaption>
                <p className="landing__avatar-name">Alex</p>
                <p className="landing__avatar-blurb">Background in engineering and hiring. Direct and structured.</p>
              </figcaption>
            </figure>
            <figure className="landing__avatar-figure">
              <img src={saraAvatar} alt="Sara, an AI interviewer" />
              <figcaption>
                <p className="landing__avatar-name">Sara</p>
                <p className="landing__avatar-blurb">Background in HR and people operations. Warm and conversational.</p>
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section className="landing__closing">
        <h2>Ready to see it live?</h2>
        <div className="landing__actions landing__actions--center">
          <button type="button" className="landing__cta landing__cta--primary" onClick={startDemo} disabled={startingDemo}>
            <span className="landing__cta-main">{startingDemo ? "Starting…" : "Try the live demo →"}</span>
            <span className="landing__cta-sub">with Alex</span>
          </button>
          <button type="button" className="landing__cta" onClick={() => navigate("/setup?mode=practice")}>
            Practice an interview
          </button>
          <button type="button" className="landing__cta" onClick={() => navigate("/setup?mode=hiring")}>
            Schedule a real interview
          </button>
        </div>
        <Link to="/how-it-works" className="landing__see-how">
          see how it works →
        </Link>
      </section>
    </main>
  );
}

function MarkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M12 2 21 12 12 22 3 12 12 2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </svg>
  );
}

