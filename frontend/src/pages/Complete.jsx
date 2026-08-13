import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

const RECOMMENDATION_LABEL = {
  advance: "Advance",
  do_not_advance: "Do not advance",
  borderline: "Borderline",
};

// Mirrors the persona registry in backend/app/interviewers.py.
const INTERVIEWER_NAMES = { alex: "Alex", sara: "Sara" };

export default function Complete() {
  const { sessionId } = useParams();
  const [report, setReport] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sessions/${sessionId}/finalize`, { method: "POST" })
      .then((res) => {
        if (!res.ok) throw new Error("Couldn't generate the report. Please try again.");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  function loadTranscript() {
    if (transcript) {
      setShowTranscript((v) => !v);
      return;
    }
    fetch(`/api/sessions/${sessionId}/transcript`)
      .then((res) => res.json())
      .then((data) => {
        setTranscript(data);
        setShowTranscript(true);
      });
  }

  if (error) {
    return (
      <main className="complete-screen">
        <div className="complete-screen__hero complete-screen__hero--fullscreen complete-screen__hero--error">
          <div className="complete-screen__hero-glow" aria-hidden="true" />
          <div className="complete-screen__hero-inner">
            <span className="complete-screen__loading-spinner complete-screen__loading-spinner--stopped" aria-hidden="true" />
            <h1>Couldn't generate the report</h1>
            <p className="complete-screen__summary" role="alert">
              {error}
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (!report) {
    return (
      <main className="complete-screen">
        <div className="complete-screen__hero complete-screen__hero--fullscreen">
          <div className="complete-screen__hero-glow" aria-hidden="true" />
          <div className="complete-screen__hero-inner">
            <span className="complete-screen__loading-spinner" aria-hidden="true" />
            <h1>Preparing your report…</h1>
            <p className="complete-screen__summary">
              Scoring the interview and writing up the scorecard — this only takes a moment.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const actions = (
    <div className="complete-screen__actions">
      <a className="button" href={`/api/sessions/${sessionId}/report.pdf`} download>
        Download report
      </a>
      <button type="button" className="button button--secondary" onClick={loadTranscript}>
        {showTranscript ? "Hide transcript" : "View transcript"}
      </button>
    </div>
  );

  const transcriptSection = showTranscript && transcript && (
    <section className="transcript-view">
      <h2>Full transcript</h2>
      {transcript.map((t) => (
        <div key={t.index} className="transcript-view__turn">
          <p className="transcript-view__q">
            Q{t.index + 1}. {t.question}
          </p>
          <p className="transcript-view__a">{t.answer || "(no answer recorded)"}</p>
        </div>
      ))}
    </section>
  );

  if (report.mode === "practice") {
    return (
      <main className="complete-screen">
        <div className="complete-screen__hero">
          <div className="complete-screen__hero-glow" aria-hidden="true" />
          <div className="complete-screen__hero-inner">
            <span className="badge badge--practice">Practice session</span>
            <h1>Practice session complete</h1>
            <p className="complete-screen__summary">{report.overall_summary}</p>
          </div>
        </div>

        <div className="complete-screen__inner">
          <section className="pros-cons">
            <div>
              <h2>Strengths</h2>
              <ul>
                {report.strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
            <div>
              <h2>Areas to improve</h2>
              <ul>
                {report.areas_to_improve.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          </section>

          <section>
            <h2>Question-by-question feedback</h2>
            <div className="feedback-cards">
              {report.per_question_feedback.map((item, i) => (
                <div key={i} className="feedback-card">
                  <div className="feedback-card__competency">
                    {item.competency}
                    {item.speaker && (
                      <span className="feedback-card__speaker"> · {INTERVIEWER_NAMES[item.speaker] || item.speaker}</span>
                    )}
                  </div>
                  <p className="feedback-card__question">{item.question_asked}</p>
                  <p className="feedback-card__row">
                    <span className="feedback-card__label feedback-card__label--good">What went well</span>
                    {item.what_went_well}
                  </p>
                  <p className="feedback-card__row">
                    <span className="feedback-card__label feedback-card__label--improve">What to improve</span>
                    {item.what_to_improve}
                  </p>
                  <div className="feedback-card__star">
                    <span className="feedback-card__label">{item.example_framework || "Example answer"}</span>
                    <p>{item.example_answer}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2>Recommendations for next time</h2>
            <p>{report.practice_recommendations}</p>
          </section>

          {actions}
          {transcriptSection}

          <p className="responsible-use-note">
            This is a coaching tool to help you prepare. Treat it as guidance, not a guarantee of how any real
            interview will go.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="complete-screen">
      <div className="complete-screen__hero">
        <div className="complete-screen__hero-glow" aria-hidden="true" />
        <div className="complete-screen__hero-inner">
          <span className={`badge badge--${report.recommendation}`}>
            {RECOMMENDATION_LABEL[report.recommendation] || report.recommendation}
          </span>
          <h1>Interview complete</h1>
          <p className="complete-screen__summary">{report.summary}</p>
        </div>
      </div>

      <div className="complete-screen__inner">
        <section>
          <h2>Competency scorecard</h2>
          <table className="scorecard-table">
            <thead>
              <tr>
                <th>Competency</th>
                <th>Rating</th>
                <th>Justification</th>
              </tr>
            </thead>
            <tbody>
              {report.scorecard.map((row, i) => (
                <tr key={i}>
                  <td>
                    {row.competency}
                    <div className="scorecard-table__type">{row.type}</div>
                  </td>
                  <td className={`rating rating--${row.rating}`}>{row.rating}</td>
                  <td>{row.justification}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="pros-cons">
          <div>
            <h2>Strengths</h2>
            <ul>
              {report.pros.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
          <div>
            <h2>Concerns</h2>
            <ul>
              {report.cons.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        </section>

        <section>
          <h2>Resume vs. interview</h2>
          <p>{report.resume_reality_check}</p>
        </section>

        {report.panel_synthesis && (
          <section>
            <h2>Panel perspectives</h2>
            <div className="panel-perspectives">
              {report.panel_synthesis.perspectives.map((p, i) => (
                <div key={i} className="panel-perspectives__col">
                  <h3>{INTERVIEWER_NAMES[p.speaker] || p.speaker}</h3>
                  <p>{p.read}</p>
                </div>
              ))}
            </div>
            <p className="panel-perspectives__synthesis">{report.panel_synthesis.synthesis}</p>
          </section>
        )}

        <section>
          <h2>Recommendation &amp; next steps</h2>
          <p>{report.next_steps}</p>
        </section>

        {actions}
        {transcriptSection}

        <p className="responsible-use-note">
          Every recommendation from Mensetsu AI is a starting point for your team's journey to the right
          candidate.
        </p>
      </div>
    </main>
  );
}
