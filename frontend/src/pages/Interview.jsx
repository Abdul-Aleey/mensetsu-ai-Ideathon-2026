import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { estimateSpeechDurationMs } from "../avatar/estimateSpeechDuration.js";
import { MockAvatarController } from "../avatar/MockAvatarController.js";
import { PerxonaAvatarController } from "../avatar/PerxonaAvatarController.js";
import CameraPanel from "../components/CameraPanel.jsx";

const EMOTION_LABEL = {
  encouraging: "🙂 encouraging",
  probing: "🤔 probing",
  approving: "😊 approving",
  neutral: "😐 neutral",
};

// Mirrors the persona registry in backend/app/interviewers.py — just the
// display names, which is all the chat panel / slot labels need.
const INTERVIEWER_NAMES = { alex: "Alex", sara: "Sara" };

// Plain fetch() never times out on its own — if the backend hangs (a
// stalled Gemini call, previously with no timeout of its own either; see
// gemini_client.py's _REQUEST_TIMEOUT_MS), the candidate is left staring at
// a frozen "thinking" animation forever, no error, no way to retry.
// Reported live as exactly that: an answer produced no response at all,
// spoken or written, session never recovered. This is the frontend's own
// backstop — generous enough (100s) to not cut off a legitimately slow but
// still-succeeding backend retry cycle, short enough to eventually hand the
// candidate back a real error and a retry button instead of silence.
const ANSWER_FETCH_TIMEOUT_MS = 100_000;

async function fetchWithTimeout(url, options, timeoutMs = ANSWER_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("This is taking much longer than expected. Please try again.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export default function Interview() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState(null);
  const [question, setQuestion] = useState(null);
  const [emotion, setEmotion] = useState("neutral");
  // Which interviewer is speaking the current turn — "alex" | "sara". In a
  // two-interviewer session the other one just sits idle until their turn.
  const [currentSpeaker, setCurrentSpeaker] = useState("alex");
  const currentSpeakerRef = useRef("alex"); // mirrors currentSpeaker for callbacks that need a fresh read, not a stale closure
  // "question" (normal answer form) | "feedback_item" (practice mode's
  // per-competency STAR coaching — same answer form, plus a "Next" button
  // since replying is optional there) | "handoff" (nothing for the
  // candidate to answer at all, auto-advances).
  const [turnKind, setTurnKind] = useState("question");
  const [questionsAsked, setQuestionsAsked] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [answerDraft, setAnswerDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [avatarMode, setAvatarMode] = useState("mock"); // overridden from /api/config once loaded
  const [geminiConnected, setGeminiConnected] = useState(false);
  const [perxonaConnectedMap, setPerxonaConnectedMap] = useState({}); // interviewer id -> connected
  const [transcript, setTranscript] = useState([]); // running {speaker, text}[] for the live chat panel
  // The currently-speaking line, revealed progressively in step with
  // estimated speech duration (see speakAndPushTranscript) — rendered as an
  // extra trailing bubble after `transcript`, then folded into `transcript`
  // itself once the line is fully spoken.
  const [revealingEntry, setRevealingEntry] = useState(null);
  const revealFrameRef = useRef(null);

  useEffect(() => {
    return () => {
      if (revealFrameRef.current) cancelAnimationFrame(revealFrameRef.current);
    };
  }, []);

  const [begun, setBegun] = useState(false); // gates the whole flow behind a real user click
  const [connecting, setConnecting] = useState(false);

  // Up to two controller instances, keyed by interviewer id ("alex" | "sara").
  const controllersRef = useRef({});
  // Perxona needs one <sv-presenter> mount point per interviewer — populated
  // via callback refs in the JSX below rather than useRef-per-id, since the
  // set of ids is dynamic (1 or 2, from session.interviewers).
  const perxonaContainerNodesRef = useRef({});
  const startedRef = useRef(false);
  const transcriptEndRef = useRef(null);
  // Holds the latest continueWithoutAnswer closure so speakAndListen can
  // trigger auto-advance without a circular useCallback dependency
  // (continueWithoutAnswer itself depends on speakAndListen). Used both for
  // practice-mode feedback beats and the two-interviewer intro hand-off.
  const continueWithoutAnswerRef = useRef(null);
  const pendingResumeRef = useRef(null);
  const setupPromiseRef = useRef(null);
  const avatarPanelRef = useRef(null);
  const [columnHeight, setColumnHeight] = useState(null);

  // Measures the avatar panel's actual rendered height (it's sized by
  // aspect-ratio off its own width, so it has no fixed pixel value) and
  // applies it directly to the camera+chat column. A CSS-only stretch
  // (height: 100% on a grid item whose row height comes from a sibling's
  // aspect-ratio) doesn't reliably resolve across browsers — when it
  // didn't, the chat panel had no height bound at all and just grew with
  // every new message instead of scrolling internally within a fixed box.
  useEffect(() => {
    if (!avatarPanelRef.current) return undefined;
    const el = avatarPanelRef.current;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height) setColumnHeight(height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript, revealingEntry]);

  const pushTranscript = useCallback((speaker, text) => {
    if (!text) return;
    setTranscript((t) => [...t, { speaker, text }]);
  }, []);

  // Three approaches, in order, all reported live: pushing the full line
  // only once speak() resolved made the chat panel visibly lag behind the
  // avatar on anything longer than a short sentence ("text takes too long
  // to appear"). Pushing the whole block ~900ms after speak() was CALLED
  // fixed that but overcorrected in a different way — the reveal clock
  // started before the avatar had actually begun talking at all (Perxona's
  // present() takes ~2-3s just to be accepted, well before any real audio
  // exists), so the message was visibly appearing during a window where
  // nothing had started yet — "chat message appears before it's loaded."
  //
  // This waits for a genuine "speech is actually starting" signal from the
  // controller (onAccepted — Perxona's request-accepted event, or the
  // browser's real onstart event in mock mode) before starting the reveal
  // clock at all, then reveals character by character over the same
  // estimated-duration math PerxonaAvatarController already uses for its
  // own audio-completion floor (see estimateSpeechDuration.js) — like live
  // captioning, not a pre-generated block. Snapped to 100% the instant
  // speak() actually resolves, so it never lags behind real completion
  // either. If onAccepted never fires for some reason, the line still
  // appears in full the moment speak() resolves — same safe fallback as
  // the original "wait for completion" behavior, never a regression.
  const speakAndPushTranscript = useCallback(
    async (controller, speaker, text, emo, options) => {
      if (!text) {
        await controller.speak(text, emo, options);
        return;
      }
      const durationMs = estimateSpeechDurationMs(text, session?.language || "en");
      let done = false;
      let startedAt = null;

      const tick = (now) => {
        if (done || startedAt == null) return;
        const revealedChars = Math.min(text.length, Math.floor((text.length * (now - startedAt)) / durationMs));
        setRevealingEntry({ speaker, text: text.slice(0, revealedChars) });
        if (revealedChars < text.length) {
          revealFrameRef.current = requestAnimationFrame(tick);
        }
      };
      const onAccepted = () => {
        if (done || startedAt != null) return;
        startedAt = performance.now();
        setRevealingEntry({ speaker, text: "" });
        revealFrameRef.current = requestAnimationFrame(tick);
      };

      await controller.speak(text, emo, { ...options, onAccepted });
      done = true;
      if (revealFrameRef.current) cancelAnimationFrame(revealFrameRef.current);
      setRevealingEntry(null);
      pushTranscript(speaker, text);
    },
    [pushTranscript, session]
  );

  const [micUnsupported, setMicUnsupported] = useState(false);

  const speakAndListen = useCallback(
    async (text, emo, kind = "question", speaker = "alex", options) => {
      setCurrentSpeaker(speaker);
      currentSpeakerRef.current = speaker;
      setQuestion(text);
      setEmotion(emo);
      setTurnKind(kind);
      setSpeaking(true);
      await speakAndPushTranscript(controllersRef.current[speaker], speaker, text, emo, options);
      setSpeaking(false);
      if (kind === "handoff") {
        // Nothing for the candidate to say — the first interviewer in a
        // two-interviewer session passing things to the second one, or the
        // practice-mode transition line right before feedback starts. Move
        // straight to the next turn the moment the current interviewer
        // finishes speaking, instead of listening for a reply that was
        // never coming.
        continueWithoutAnswerRef.current?.();
        return;
      }
      // "feedback_item" also opens the mic/text form here (same as an
      // ordinary question) — the candidate can ask a follow-up about what
      // was just said. Moving to the next item is now its own explicit
      // "Next" button (see the render below) rather than auto-advancing:
      // that auto-advance chain had no recovery if any single hop failed —
      // reported live as the session getting stuck showing "moving to the
      // next point" with nothing left to click. A button can just be
      // clicked again.
      const ok = await controllersRef.current[speaker].startListening();
      setListening(ok);
      setMicUnsupported(!ok);
    },
    [speakAndPushTranscript]
  );

  // Explicit, clickable mic control — the automatic "start listening after
  // speaking" above gave no obvious, reliable affordance that the mic was
  // ever active (a small overlay badge on the avatar video is easy to miss
  // entirely, or to catch only for the brief moment before something ends
  // it), so this lets the candidate directly see and control mic state
  // rather than relying on it happening silently in the background.
  const toggleMic = useCallback(async () => {
    const controller = controllersRef.current[currentSpeakerRef.current];
    if (!controller) return;
    if (listening) {
      controller.stopListening();
      setListening(false);
      return;
    }
    const ok = await controller.startListening();
    setListening(ok);
    setMicUnsupported(!ok);
  }, [listening]);

  const submitAnswer = useCallback(
    async (text) => {
      if (!text.trim() || submitting) return;
      setSubmitting(true);
      setError(null);
      const speakerNow = currentSpeakerRef.current;
      controllersRef.current[speakerNow].stopListening();
      setListening(false);
      setAnswerDraft("");
      pushTranscript("candidate", text);
      // Gemini generating the next question is real, visible latency — previously
      // the avatar just stood there frozen for however long that took. Perxona's
      // own "thinking" animation fills that dead spot instead of our own state.
      controllersRef.current[speakerNow].setThinking(true);
      setThinking(true);

      try {
        const res = await fetchWithTimeout(`/api/sessions/${sessionId}/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer: text }),
        });
        if (!res.ok) throw new Error("Something went wrong. Please try answering again.");
        const data = await res.json();
        controllersRef.current[speakerNow].setThinking(false);
        setThinking(false);
        setQuestionsAsked(data.questions_asked);

        if (data.status === "complete") {
          // Speak the closing remarks before leaving, so the candidate
          // actually hears the interview end rather than being cut off.
          if (data.closing_message) {
            const closer = data.speaker || speakerNow;
            setCurrentSpeaker(closer);
            currentSpeakerRef.current = closer;
            setQuestion(data.closing_message);
            setEmotion(data.emotion || "neutral");
            setSpeaking(true);
            await speakAndPushTranscript(controllersRef.current[closer], closer, data.closing_message, data.emotion || "neutral", {
              bow: true,
            });
            setSpeaking(false);
          }
          navigate(`/complete/${sessionId}`);
          return;
        }
        await speakAndListen(data.question, data.emotion, data.turn_kind, data.speaker);
      } catch (err) {
        controllersRef.current[speakerNow].setThinking(false);
        setThinking(false);
        setError(err.message);
      } finally {
        setSubmitting(false);
      }
    },
    [sessionId, submitting, navigate, speakAndListen, speakAndPushTranscript]
  );

  // Two cases where there's nothing for the candidate to answer, so this
  // fires automatically (via continueWithoutAnswerRef, see speakAndListen)
  // right after the current interviewer finishes speaking, rather than
  // waiting on a click: practice mode's feedback items, and the first
  // interviewer's hand-off line in a two-interviewer session's intro. Posts
  // an empty answer (recorded but never assessed, since neither of these
  // turns carries a competency_id) instead of reusing submitAnswer, so
  // nothing gets pushed into the chat panel as if the candidate "said" it.
  const continueWithoutAnswer = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    // Clears any half-typed follow-up question left in the box — reachable
    // now that feedback_item turns show a real text form alongside the
    // "Next feedback" button: without this, text typed but not sent here
    // would still be sitting in the box on the next item's form, and a
    // later accidental Enter/click would send it as a follow-up about the
    // wrong competency.
    setAnswerDraft("");
    const speakerNow = currentSpeakerRef.current;
    controllersRef.current[speakerNow].setThinking(true);
    setThinking(true);

    try {
      const res = await fetchWithTimeout(`/api/sessions/${sessionId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: "" }),
      });
      if (!res.ok) throw new Error("Something went wrong. Please try continuing again.");
      const data = await res.json();
      controllersRef.current[speakerNow].setThinking(false);
      setThinking(false);
      setQuestionsAsked(data.questions_asked);

      if (data.status === "complete") {
        if (data.closing_message) {
          const closer = data.speaker || speakerNow;
          setCurrentSpeaker(closer);
          currentSpeakerRef.current = closer;
          setQuestion(data.closing_message);
          setEmotion(data.emotion || "neutral");
          setSpeaking(true);
          await speakAndPushTranscript(controllersRef.current[closer], closer, data.closing_message, data.emotion || "neutral", {
            bow: true,
          });
          setSpeaking(false);
        }
        navigate(`/complete/${sessionId}`);
        return;
      }
      await speakAndListen(data.question, data.emotion, data.turn_kind, data.speaker);
    } catch (err) {
      controllersRef.current[speakerNow].setThinking(false);
      setThinking(false);
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }, [sessionId, submitting, navigate, speakAndListen, speakAndPushTranscript]);
  continueWithoutAnswerRef.current = continueWithoutAnswer;

  const createController = useCallback(
    (mode, language, interviewerId) => {
      if (mode === "perxona") {
        // No Perxona-specific config passed in here — PerxonaAvatarController
        // fetches its own target (avatar/scene/voice), keyed by
        // interviewerId, and Connect bearer token from our backend
        // (GET /api/config, GET /api/connect-token).
        const controller = new PerxonaAvatarController({
          language,
          container: perxonaContainerNodesRef.current[interviewerId],
          interviewerId,
        });
        controller.onConnectionChange((connected) =>
          setPerxonaConnectedMap((m) => ({ ...m, [interviewerId]: connected }))
        );
        return controller;
      }
      // Mock mode never actually talks to Perxona — the status dot should say so.
      setPerxonaConnectedMap((m) => ({ ...m, [interviewerId]: false }));
      return new MockAvatarController({ language });
    },
    []
  );

  // Fetch everything needed to build the controller — and, in Perxona mode,
  // load its script/element — as soon as the page mounts, not gated behind
  // the "Tap to begin" click. Only the actual audio-unlock call
  // (resumeAudioPlayback, inside controller.start()) needs to run directly
  // in the click handler to satisfy the browser's autoplay policy; loading
  // the presenter script and creating <sv-presenter> ahead of time means
  // start() has almost nothing left to await once the click fires. Doing
  // all of this setup inside the click handler (the previous approach) put
  // several fetches and a CDN script load between the click and
  // resumeAudioPlayback(), which reproduced consistently as present()
  // failing with "Audio context is not available" — the browser no longer
  // considered the unlock call close enough to the gesture.
  useEffect(() => {
    let cancelled = false;
    setupPromiseRef.current = (async () => {
      const [configRes, statusRes, sessionRes, transcriptRes] = await Promise.all([
        fetch("/api/config"),
        fetch("/api/status"),
        fetch(`/api/sessions/${sessionId}`),
        fetch(`/api/sessions/${sessionId}/transcript`),
      ]);
      if (cancelled) return;
      if (!sessionRes.ok) {
        setError("Couldn't load this interview session.");
        return;
      }
      const config = await configRes.json();
      const status = await statusRes.json().catch(() => ({}));
      const data = await sessionRes.json();
      const priorTurns = await transcriptRes.json().catch(() => []);
      if (cancelled) return;
      setGeminiConnected(Boolean(status.gemini_connected));
      // flushSync forces the re-render (and this component's per-interviewer
      // container ref callbacks below) to actually commit before the
      // controller-creation loop runs. Without it, a two-interviewer session
      // silently only builds Alex's controller: this same effect continues
      // synchronously past setSession() with no await in between, so on the
      // very first render (before session was ever set) the JSX's session
      // interviewers fallback is just ["alex"] and only Alex's container
      // div exists yet — Sara's perxonaContainerNodesRef entry is still
      // undefined when her controller is constructed a few lines down,
      // and preload() then throws appending into a null container, caught
      // silently by the .catch(console.error) below.
      flushSync(() => setSession(data));
      const mode = config.avatar_mode || "mock";
      setAvatarMode(mode);

      // Rehydrate the chat panel from whatever the backend already has —
      // without this, reloading this page mid-interview showed an empty
      // "conversation will appear here" panel even though the interview
      // was already several questions in, since `transcript` is otherwise
      // only ever built up in memory during this one page load.
      const interviewers = data.interviewers?.length ? data.interviewers : ["alex"];

      for (const turn of priorTurns) {
        if (turn.answer != null) {
          // Completed turn — both sides already happened, safe to show immediately.
          // Feedback-item "continue" turns are recorded with an empty answer
          // (nothing was actually said) — skip the candidate bubble for those.
          pushTranscript(turn.speaker || interviewers[0], turn.question);
          if (turn.answer !== "") pushTranscript("candidate", turn.answer);
        } else if (data.phase !== "feedback" && !(data.phase === "intro" && interviewers.length === 2)) {
          // Still-pending question — don't push it yet. beginInterview()
          // re-speaks it below, and that speak() call is what pushes it via
          // onSpeakStart, so it only appears once the avatar actually says it.
          pendingResumeRef.current = {
            question: turn.question,
            emotion: turn.emotion || "neutral",
            speaker: turn.speaker || interviewers[0],
          };
        }
        // else: reloading mid-feedback-phase, or mid-intro in a two-
        // interviewer session. The transcript endpoint doesn't carry
        // turn_kind, so this shortcut can't tell a real question apart from
        // a "handoff" turn (e.g. reloading right after the first
        // interviewer's hand-off line, before the second one's turn was
        // ever generated) — hardcoding "question" here would open the mic
        // and wait for a reply that was never coming instead of auto-
        // advancing. Skip the shortcut and let beginInterview's "fresh"
        // branch re-ask the backend directly below — advance_interview's
        // null-answer replay already returns the correct turn_kind for
        // both cases.
      }
      if (pendingResumeRef.current) {
        // data.questions_asked here is the SESSION's total turn counter
        // (intro turns, follow-ups, everything) — a completely different
        // number from AnswerOut's questions_asked, which every other call
        // site of setQuestionsAsked() uses and which is deliberately
        // primary-questions-only so it stays bounded by questionRounds.
        // Using the wrong one here only surfaced on reload, showing
        // "Question 10 of 3" once total turns outgrew the actual budget.
        pendingResumeRef.current.questionsAsked = data.primary_questions_asked;
      }

      // One controller per interviewer in this session — both get created
      // and (in Perxona mode) preloaded up front, even though only one
      // speaks at a time; the idle one just sits connected and ready.
      for (const id of interviewers) {
        const controller = createController(mode, data.language, id);
        controller.onUserAnswer((text) => submitAnswer(text));
        controllersRef.current[id] = controller;
      }
      if (mode === "perxona") {
        Object.values(controllersRef.current).forEach((c) =>
          c.preload?.().catch((err) => console.error("Perxona preload failed:", err))
        );
      }
    })();
    return () => {
      cancelled = true;
      Object.values(controllersRef.current).forEach((c) => c?.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const beginInterview = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setBegun(true);
    setConnecting(true);

    await setupPromiseRef.current;
    const controllers = Object.values(controllersRef.current);
    if (!controllers.length) {
      // Setup failed — error state already set. Without clearing connecting
      // here, the "Connecting…" overlay (now visible for the whole
      // connecting window, not just pre-click — see below) would stay
      // stuck on screen forever on top of the error message instead of
      // getting out of the way of it.
      setConnecting(false);
      return;
    }

    const pending = pendingResumeRef.current;
    if (pending?.question) {
      // Resuming an interview that already has an unanswered question —
      // re-speak it rather than asking the backend for a new one (the
      // backend now also guards against this, but skip the redundant
      // round-trip here too).
      await Promise.all(controllers.map((c) => c.start()));
      setConnecting(false);
      setQuestionsAsked(pending.questionsAsked ?? 0);
      await speakAndListen(pending.question, pending.emotion, "question", pending.speaker);
      return;
    }

    // Truly fresh session (or a reload mid-feedback-phase, see the skipped
    // shortcut above) — fire the opening/pending-turn call alongside widget
    // connection instead of after it — 3D asset loading/connection is
    // normally the slower side, so by the time the avatar is ready to
    // speak the text is usually already sitting here waiting, instead of
    // the candidate seeing a connected-but-silent avatar while Gemini
    // generates. The backend's null-answer handling already replays
    // whatever's actually pending (including the right turn_kind) rather
    // than always asking something brand new.
    const openingPromise = fetchWithTimeout(`/api/sessions/${sessionId}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: null }),
    }).then((res) => res.json());

    await Promise.all(controllers.map((c) => c.start()));
    const opening = await openingPromise;
    setConnecting(false);
    setQuestionsAsked(opening.questions_asked);
    // bow: true only here — this is the one moment guaranteed to be the
    // actual first line of a fresh session, unlike the resume branch above
    // (pending.question), which could be re-speaking any turn after a
    // reload, not necessarily the opening greeting.
    await speakAndListen(opening.question, opening.emotion, opening.turn_kind, opening.speaker, { bow: true });
  }, [sessionId, speakAndListen]);

  const competencyCount = session?.competencies?.length ?? 0;
  const questionRounds = session?.question_rounds ?? 10;
  const interviewers = session?.interviewers?.length ? session.interviewers : ["alex"];
  const perxonaConnected = interviewers.length > 0 && interviewers.every((id) => perxonaConnectedMap[id]);

  return (
    <main className="interview-screen">
      <div className="interview-screen__glow" aria-hidden="true" />

      <header className="interview-screen__header">
        <div className="interview-screen__brand-row">
          <div className="interview-screen__wordmark">Mensetsu AI</div>
          <div className="interview-screen__status-lights">
            <span className="status-light" title={`Gemini: ${geminiConnected ? "connected" : "not connected"}`}>
              <span className={`status-light__dot${geminiConnected ? " is-green" : " is-red"}`} />
              Gemini
            </span>
            <span
              className="status-light"
              title={`Perxona: ${perxonaConnected ? "connected" : "not connected"}`}
            >
              <span className={`status-light__dot${perxonaConnected ? " is-green" : " is-red"}`} />
              Perxona
            </span>
            <button
              type="button"
              className="interview-screen__refresh-button"
              title="Start a brand new interview"
              onClick={() => navigate("/setup")}
            >
              ⟳ New interview
            </button>
          </div>
        </div>
        <div className="interview-screen__progress">
          <div className="interview-screen__steps" aria-hidden="true">
            {Array.from({ length: questionRounds }).map((_, i) => (
              <span key={i} className={i < questionsAsked ? "is-done" : ""} />
            ))}
          </div>
          <span>
            Question {questionsAsked} of {questionRounds} · {competencyCount} competencies planned
          </span>
        </div>
      </header>

      <div className="interview-screen__panels">
        <div
          className={`avatar-panel${interviewers.length === 2 ? " avatar-panel--dual" : ""}`}
          ref={avatarPanelRef}
        >
          <div className="avatar-panel__slots">
            {interviewers.map((id) => (
              <div
                key={id}
                className={`avatar-panel__slot${currentSpeaker === id && speaking ? " is-speaking" : ""}`}
              >
                {/* Always mounted, regardless of avatarMode — PerxonaAvatarController.start()
                    needs this ref to exist the moment it runs, which can happen before
                    React has re-rendered with avatarMode === "perxona" (avatarMode starts
                    as "mock" and only flips after an async /api/config fetch resolves).
                    Conditionally rendering this div meant the ref was still null when
                    start() ran, causing "Cannot read properties of null (reading
                    'appendChild')". Positioned absolute so it doesn't affect the
                    placeholder's flex layout below when unused (mock mode). */}
                <div
                  ref={(el) => {
                    perxonaContainerNodesRef.current[id] = el;
                  }}
                  className="avatar-panel__perxona-container"
                />
                {avatarMode !== "perxona" && (
                  <div className="avatar-panel__placeholder">
                    <div className="avatar-panel__avatar-icon" aria-hidden="true">
                      🧑‍💼
                    </div>
                    <p className="avatar-panel__question">
                      {currentSpeaker === id ? question || "Connecting…" : ""}
                    </p>
                    {currentSpeaker === id && (
                      <p className="avatar-panel__emotion">{EMOTION_LABEL[emotion] || emotion}</p>
                    )}
                  </div>
                )}
                {interviewers.length === 2 && (
                  <span className="avatar-panel__slot-name">{INTERVIEWER_NAMES[id] || id}</span>
                )}
              </div>
            ))}
          </div>
          <div className="avatar-panel__camera-overlay">
            <CameraPanel candidateName={session?.candidate_name} />
          </div>
          {(!begun || connecting) && (
            // begun flips to true the instant the button is clicked (before
            // any of the actual connecting work happens), so gating this
            // overlay on !begun alone made it disappear immediately on
            // click — in real Perxona mode (where the mock-mode placeholder
            // text below is disabled) that left nothing on screen telling
            // the candidate the avatar was still loading, so the first
            // question started being spoken with no visible cue to pay
            // attention, and got missed. Keeping the overlay up for the
            // whole `connecting` window — not just pre-click — means it
            // only disappears right as speakAndListen actually starts
            // talking.
            <div className="avatar-panel__start-gate">
              <button type="button" onClick={beginInterview} disabled={connecting}>
                {connecting ? "Connecting your interviewer…" : "Tap to begin your interview"}
              </button>
            </div>
          )}
        </div>

        <div className="interview-chat-column" style={columnHeight ? { height: `${columnHeight}px` } : undefined}>
          <div className="interview-chat">
            <div className="interview-chat__list">
              {transcript.length === 0 && !revealingEntry && (
                <p className="interview-chat__empty">The conversation will appear here.</p>
              )}
              {transcript.map((entry, i) => (
                <div key={i} className={`interview-chat__bubble interview-chat__bubble--${entry.speaker}`}>
                  <span className="interview-chat__speaker">
                    {entry.speaker === "candidate"
                      ? session?.candidate_name || "You"
                      : INTERVIEWER_NAMES[entry.speaker] || entry.speaker}
                  </span>
                  <p>{entry.text}</p>
                </div>
              ))}
              {revealingEntry && (
                <div
                  className={`interview-chat__bubble interview-chat__bubble--${revealingEntry.speaker} interview-chat__bubble--revealing`}
                >
                  <span className="interview-chat__speaker">{INTERVIEWER_NAMES[revealingEntry.speaker] || revealingEntry.speaker}</span>
                  <p>
                    {revealingEntry.text}
                    <span className="interview-chat__cursor" aria-hidden="true" />
                  </p>
                </div>
              )}
              <div ref={transcriptEndRef} />
            </div>
          </div>

          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}

          {micUnsupported && (
            <p className="field-error" role="alert">
              Voice input isn't available in this browser. Please type your answer below.
            </p>
          )}

          <form
            className="interview-screen__answer-form"
            onSubmit={(e) => {
              e.preventDefault();
              submitAnswer(answerDraft);
            }}
          >
            <textarea
              value={answerDraft}
              onChange={(e) => setAnswerDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, like a chat app — Shift+Enter still inserts a
                // newline for anyone who actually wants a multi-line answer.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitAnswer(answerDraft);
                }
              }}
              placeholder={
                turnKind === "feedback_item"
                  ? "Ask a follow-up question about this feedback, or click Next"
                  : "Type your answer, or use the mic button"
              }
              rows={2}
              disabled={submitting || speaking}
            />
            <button
              type="button"
              className={`interview-screen__mic-button${listening ? " is-active" : ""}`}
              onClick={toggleMic}
              disabled={submitting || speaking}
              title={listening ? "Stop listening" : "Click to speak your answer"}
            >
              {listening ? "Listening…" : "Speak"}
            </button>
            {turnKind === "feedback_item" && (
              <button
                type="button"
                className="interview-screen__next-button"
                onClick={() => continueWithoutAnswer()}
                disabled={submitting || speaking}
                title="Move on to the next piece of feedback"
              >
                Next feedback
              </button>
            )}
            <button type="submit" disabled={submitting || speaking || !answerDraft.trim()}>
              {turnKind === "feedback_item" ? "Ask" : "Send answer"}
            </button>
          </form>
        </div>
      </div>

      <p className="interview-screen__powered-by">
        <PerxonaMark /> Powered by Perxona
      </p>
    </main>
  );
}

function PerxonaMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 8v8l7-4-7-4Z" fill="currentColor" />
    </svg>
  );
}
