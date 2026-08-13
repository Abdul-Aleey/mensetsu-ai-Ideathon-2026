import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

const STEPS = [
  {
    title: "Upload",
    text: "Upload a job description and a resume. Or skip that step and try the live demo with sample data already loaded.",
    icon: <UploadIcon />,
  },
  {
    title: "Plan",
    text: "The system reads both and builds a set of questions specific to this role and this candidate. Not a fixed script.",
    icon: <PlanIcon />,
  },
  {
    title: "Interview",
    text: "An avatar, Alex, Sara, or both, asks the questions live and follows up based on what you actually say.",
    icon: <ChatIcon />,
  },
  {
    title: "Result",
    text: "You get a clear outcome. A hiring recommendation for recruiters, or personal coaching if you were practicing.",
    icon: <ReportIcon />,
  },
];

export default function HowItWorks() {
  const navigate = useNavigate();
  const [startingDemo, setStartingDemo] = useState(false);

  async function startDemo() {
    if (startingDemo) return;
    setStartingDemo(true);
    try {
      const res = await fetch("/api/sessions/demo", { method: "POST", body: "" });
      if (!res.ok) throw new Error();
      const session = await res.json();
      navigate(`/interview/${session.id}`);
    } catch {
      setStartingDemo(false);
      navigate("/");
    }
  }

  return (
    <main className="landing">
      <div className="landing__hero-band">
        <div className="landing__bg" aria-hidden="true" />

        <header className="landing__nav">
          <Link to="/" className="landing__wordmark">
            <span className="landing__wordmark-mark" aria-hidden="true">
              <MarkIcon />
            </span>
            Mensetsu AI
          </Link>
          <Link to="/" className="landing__nav-link">
            ← Back home
          </Link>
        </header>

        <section className="landing__hiw-hero">
          <span className="landing__kicker landing__kicker--center">How it works</span>
          <h1>From upload to result, in one live conversation.</h1>
          <p>
            A tailored interview, run live by an avatar, ending in a result you can actually use.
          </p>
        </section>
      </div>

      <section className="landing__steps-section">
        <div className="landing__steps">
          {STEPS.map((step, i) => (
            <div key={step.title} className="landing__step">
              <div className="landing__step-top">
                <span className="landing__step-number">{String(i + 1).padStart(2, "0")}</span>
                <span className="landing__step-icon" aria-hidden="true">
                  {step.icon}
                </span>
              </div>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing__paths">
        <div className="landing__path">
          <span className="landing__kicker">For hiring teams</span>
          <h2>Schedule a real interview</h2>
          <ul>
            <li>Upload the job description and the candidate's resume.</li>
            <li>Choose how many questions to ask and which interviewer runs it.</li>
            <li>The interview adapts live. No two candidates get the same follow-up questions.</li>
            <li>Get a scorecard, a check against the resume's claims, and a clear recommendation to advance, hold, or pass.</li>
          </ul>
          <button type="button" className="landing__cta landing__cta--primary" onClick={() => navigate("/setup?mode=hiring")}>
            Schedule a real interview →
          </button>
        </div>

        <div className="landing__path">
          <span className="landing__kicker">For candidates</span>
          <h2>Practice an interview</h2>
          <ul>
            <li>Run the same live interview for a role you're targeting.</li>
            <li>Get feedback right after, one question at a time. What worked, what to improve.</li>
            <li>Each example answer follows the right structure for the question, whether that's a personal story or a technical walkthrough.</li>
            <li>Ask follow-up questions about your feedback, then keep a written report to study later.</li>
          </ul>
          <button type="button" className="landing__cta landing__cta--primary" onClick={() => navigate("/setup?mode=practice")}>
            Practice an interview →
          </button>
        </div>
      </section>

      <section className="landing__closing">
        <h2>Ready to see it live?</h2>
        <div className="landing__actions landing__actions--center">
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

function UploadIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M12 15V4M12 4 7.5 8.5M12 4l4.5 4.5" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </svg>
  );
}

function PlanIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 5.5h16v11H9l-4 3.5v-3.5H4v-11Z" strokeLinejoin="round" />
    </svg>
  );
}

function ReportIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M6 3.5h9l3 3V20a.6.6 0 0 1-.6.6H6.6a.6.6 0 0 1-.6-.6V4.1a.6.6 0 0 1 .6-.6Z" />
      <path d="M9 12h6M9 15.5h6M9 8.5h3" />
    </svg>
  );
}
