/**
 * Real avatar controller — uses Perxona's Presenter SDK (`<sv-presenter>` +
 * `present()`), NOT the `<sv-agent>` conversational widget used earlier.
 * `present(text)` is a pure text-to-speech + motion call with no
 * autonomous AI: it speaks exactly the text it's given, every time.
 * Gemini (our backend) generates each interview question; this only makes
 * the avatar say it. Capturing the candidate's spoken answer is entirely
 * ours to do — the Presenter SDK doesn't listen — via the same browser
 * SpeechRecognition helper MockAvatarController uses.
 *
 * Why the switch from `<sv-agent>`: extensive live testing (see git log)
 * showed `<sv-agent>`'s own autonomous AI kept generating unrelated
 * responses in parallel with anything sent via `agentReply()`, regardless
 * of what we sent — not a reliable "puppet" channel. `present()` is a
 * genuine, stateless "say this text" API instead.
 *
 * Auth model: unlike `<sv-agent>`'s domain-scoped `apiKey`, this uses a
 * separate Perxona "Connect" account (email/password) that our backend
 * logs into and exchanges for a short-lived bearer token — see
 * `GET /api/connect-token`. Nothing Perxona-specific is passed into this
 * constructor; it fetches its own config and token from our own backend.
 *
 * Reference: https://github.com/XRSPACE-Inc/perxona-connect-kit
 */
import { startBrowserSpeechRecognition, stopBrowserSpeechRecognition } from "./browserSpeechRecognition.js";
import { estimateSpeechDurationMs } from "./estimateSpeechDuration.js";

// Maps our own interviewer's emotion_tag (see backend/app/prompts/interviewer.py)
// onto real motion IDs from each avatar's OWN catalog (GET
// /api/v1/connect/assets/avatars/{id}/motions), embedded via Perxona's
// Motion Markup syntax `[MOTION motion_id:priority]`. Motion catalogs are
// per-avatar/per-skeleton, not shared — confirmed live by fetching both
// catalogs directly: a single shared map here (the previous version) used
// Alex's IDs unconditionally for both interviewers, and none of them exist
// in Sara's catalog at all, so she's never actually played a gesture.
// Chosen conservatively to match the "measured, formal, respectful"
// Japanese business register already baked into the interview prompts — no
// big/effusive gestures. "neutral" intentionally has no mapping: per the
// SDK's own priority hierarchy, Talking already plays automatically during
// present(), so tagging every single line would be noisy and repetitive
// rather than purposeful.
const EMOTION_MOTION_IDS = {
  alex: {
    encouraging: "01KZAHAF8ZNKD3NQHZAXBZTK4Y", // "Casual Chest Gesture" — open, inviting
    approving: "01K4M9NC4JRX44R08XP2YH2AC3", // "Male Thumbup Stand" — brief, sincere acknowledgment
    probing: "01KZAH87A457ASGBQKND4ZMN0P", // "Right Hand Pointing Gesture" — a focused, direct beat
  },
  sara: {
    encouraging: "01KZD89ZZGFDVB8CYB7ZWBV1HF", // "Casual Chest Gesture" (Sara's own catalog ID)
    approving: "01K4M9AQJEPKVX3HDKWWY4BH43", // "Female Thumbup Stand"
    probing: "01KZD8E8P8F0BV6QABJVQV8Y86", // "Right Hand Pointing Gesture" (Sara's own catalog ID)
  },
};

// A formal bow fits this product's whole Japanese-business-register premise
// directly — used for the greeting (the very first line a fresh session
// speaks) and the goodbye (the closing message), the two moments a real
// interview actually calls for one. Present in both avatars' catalogs but
// unused until now. Takes priority over the emotion-based gesture above
// for that one line rather than stacking two motion tags.
const FORMAL_BOW_IDS = {
  alex: "01KZAGZ506Y34YKVC9V65NQ0CG",
  sara: "01KZD89FZHTMFERT1G1KZYY3GC",
};

function withMotionMarkup(text, emotion, interviewerId, bow) {
  const motionId = bow ? FORMAL_BOW_IDS[interviewerId] : EMOTION_MOTION_IDS[interviewerId]?.[emotion];
  return motionId ? `[MOTION ${motionId}:1] ${text}` : text;
}

let scriptLoadPromise = null;
function loadPresenterScript(url) {
  if (customElements.get("sv-presenter")) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = url;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load the Perxona presenter script."));
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

export class PerxonaAvatarController {
  /** @param {{ language: string, container: HTMLElement, interviewerId: string }} opts */
  constructor({ language, container, interviewerId }) {
    this.language = language;
    this.container = container;
    this.interviewerId = interviewerId; // "alex" | "sara" — picks which target out of /api/config's `interviewers` map
    this.presenter = null;
    this.connected = false;
    this._connectionChangeCallback = null;
    this._answerCallback = null;
    this._onTokenExpired = null;
    this._recognition = null;
    this._config = null;
    this._preloadPromise = null;
    this._onVisibilityChange = null;
  }

  onConnectionChange(callback) {
    this._connectionChangeCallback = callback;
  }

  onUserAnswer(callback) {
    this._answerCallback = callback;
  }

  // Loads the presenter script and mounts <sv-presenter> — safe to call as
  // soon as we know we're in Perxona mode, well before the candidate's real
  // "Tap to begin" click. Browser autoplay policy only requires the audio
  // *unlock itself* (resumeAudioPlayback, in start() below) to run directly
  // inside a user gesture; the reference perxona-connect-kit sample loads
  // its presenter script and element at page load for exactly this reason —
  // so the click handler has as little to await before resumeAudioPlayback()
  // as possible. Doing this same work inside start() (i.e. inside the click
  // handler) put several awaited fetches and a CDN script load between the
  // click and resumeAudioPlayback(), which reproduced consistently as
  // present() failing with "Audio context is not available" — the browser
  // no longer considered resumeAudioPlayback() close enough to the gesture.
  preload() {
    if (this._preloadPromise) return this._preloadPromise;
    this._preloadPromise = (async () => {
      const config = await fetch("/api/config").then((r) => r.json());
      const target = config.interviewers?.[this.interviewerId];
      if (!config.perxona_presenter_url || !target?.avatar_id || !target?.scene_id) {
        throw new Error(`Perxona Presenter isn't configured for interviewer "${this.interviewerId}" yet.`);
      }
      this._config = config;
      this._target = target;

      await loadPresenterScript(config.perxona_presenter_url);

      const el = document.createElement("sv-presenter");
      this.container.appendChild(el);
      this.presenter = el;

      this.presenter.addEventListener("PRESENTER_STATUS", (event) => {
        const nowConnected = event.detail?.status === "Ready";
        if (nowConnected !== this.connected) {
          this.connected = nowConnected;
          this._connectionChangeCallback?.(this.connected);
        }
      });

      // The Connect API rejects the bearer token eventually; refreshConnectToken()
      // only swaps it in for *subsequent* calls, so this only guards against the
      // token going stale mid-session, not the call that triggered the event.
      this._onTokenExpired = async () => {
        const { connect_token: freshToken } = await fetch("/api/connect-token").then((r) => r.json());
        this.presenter.refreshConnectToken(freshToken);
      };
      this.presenter.addEventListener("CONNECT_TOKEN_EXPIRED", this._onTokenExpired);
    })();
    return this._preloadPromise;
  }

  // Must be called directly from a real user gesture's click handler —
  // resumeAudioPlayback() is the very first await here (preload() above
  // resolves instantly if it already ran) so it stays as close to that
  // gesture as possible.
  async start() {
    await this.preload();

    await this.presenter.resumeAudioPlayback?.();

    // Shared across both interviewers — Connect auth is an org-level
    // credential, not avatar-specific, so the same bearer token works for
    // both controllers' initialize() calls.
    const { connect_token: token } = await fetch("/api/connect-token").then((r) => r.json());
    await this.presenter.initialize(token, {
      avatarId: this._target.avatar_id,
      sceneId: this._target.scene_id,
      voiceId: this._target.voice_id || undefined,
    });

    // initialize() is what actually creates the underlying audio context —
    // the resumeAudioPlayback() call above (before initialize existed) is a
    // no-op against a context that doesn't exist yet, which reproduced
    // consistently as present() failing with "Audio context is not
    // available" even though everything else connected fine. Calling it
    // again now that the real context exists is what actually unlocks it
    // (confirmed live: a second resumeAudioPlayback() call here is what
    // made present() start succeeding).
    await this.presenter.resumeAudioPlayback?.();

    // A fully minimized window (not just an inactive tab) stops
    // requestAnimationFrame entirely — there's nothing to paint. Reported
    // live: the avatar's audio cut out while minimized and stayed silent
    // even after un-minimizing, for the rest of the session. Plain
    // <audio>/<video> keep playing regardless of rendering, but this SDK is
    // a live-rendered, lip-synced 3D avatar; if its audio scheduling is
    // coupled to that render loop (typical for lip-sync), losing rAF loses
    // audio with it. Nudging resumeAudioPlayback() when the page becomes
    // visible again can't recover the line that was already cut short, but
    // it's the one lever this SDK exposes to stop every turn *after* that
    // from staying silently broken too.
    this._onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        this.presenter?.resumeAudioPlayback?.();
      }
    };
    document.addEventListener("visibilitychange", this._onVisibilityChange);

    await new Promise((resolve) => {
      if (this.connected) {
        resolve();
        return;
      }
      const onStatus = (event) => {
        if (event.detail?.status === "Ready") {
          this.presenter.removeEventListener("PRESENTER_STATUS", onStatus);
          resolve();
        }
      };
      this.presenter.addEventListener("PRESENTER_STATUS", onStatus);
      // Safety net — don't hang forever if the presenter never reports ready.
      setTimeout(resolve, 15000);
    });

    // The "Ready" status event fires slightly before present() can reliably
    // accept calls — confirmed live: present() failed with "presenter is
    // not ready, current status: Initializing" for a second or two right
    // after "Ready" had already fired. A one-time buffer here (paid once,
    // while the candidate is still looking at "Connecting…") avoids that
    // gap without adding retry delay to every question later on.
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  async speak(text, emotion, { bow = false } = {}) {
    if (!this.presenter) return;
    const taggedText = withMotionMarkup(text, emotion, this.interviewerId, bow);
    let result = await this.presenter.present(taggedText);
    // present() never rejects — it resolves with a PresentationResult whose
    // success is false on failure. Seen live: the presenter can briefly
    // report "not ready, current status: Initializing" even after our own
    // PRESENTER_STATUS listener already saw "Ready" once (an internal SDK
    // state flap, not something our start() sequencing controls) — a couple
    // of short retries clears it without needing a user-visible error.
    for (let attempt = 0; attempt < 2 && result?.success === false; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      result = await this.presenter.present(taggedText);
    }
    if (result && result.success === false) {
      console.error("Perxona present() failed:", result.code, result.message);
      return result;
    }
    // present() resolves in ~2-3s, right after the request is accepted —
    // nowhere near when the avatar actually finishes speaking. PERFORMANCE_END
    // is the fast, single-event "done talking" signal (confirmed live,
    // correlated with PERFORMANCE_STATE flipping to "Idle") and is the right
    // default for ordinary single-sentence turns — waiting instead for
    // PERFORMANCE_STATE to *confirm* it left "Idle" before trusting it
    // returned there was tried and made every single turn (not just the
    // risky one) wait through the SDK's own slow pre-roll before speaking
    // even starts — confirmed live as a bad trade: noticeably laggy mic/chat/
    // hand-off timing on every question, in exchange for protection only the
    // hand-off line actually needed. So: PERFORMANCE_END stays the primary
    // signal. A word-count floor guards the specific known risk —
    // PERFORMANCE_END fired after just the first internal speech segment of
    // the two-interviewer intro hand-off line during live testing (several
    // sentences long), letting the next interviewer start over its tail —
    // but unconditionally Promise.all-ing it against PERFORMANCE_END on
    // EVERY turn (the previous version of this fix) takes the max of the
    // two waits every time, and reported live as "every turn" lag even for
    // ordinary one-question turns where PERFORMANCE_END already resolves
    // correctly on its own. So the floor only applies above a duration
    // threshold comfortably past ordinary turns (roughly a 25-word English
    // question) and reserved for genuinely long, multi-sentence lines like
    // the hand-off line or a feedback coaching walkthrough.
    const estimatedMs = this._estimatedSpeechMs(text);
    const waits = [this._waitForPerformanceEnd()];
    if (estimatedMs > 10000) waits.push(new Promise((resolve) => setTimeout(resolve, estimatedMs)));
    await Promise.all(waits);
    return result;
  }

  _waitForPerformanceEnd() {
    return new Promise((resolve) => {
      const onEnd = () => {
        this.presenter.removeEventListener("PERFORMANCE_END", onEnd);
        clearTimeout(safety);
        resolve();
      };
      this.presenter.addEventListener("PERFORMANCE_END", onEnd);
      // Safety net — don't hang forever if the event never fires.
      const safety = setTimeout(() => {
        this.presenter.removeEventListener("PERFORMANCE_END", onEnd);
        resolve();
      }, 20000);
    });
  }

  // Deliberately not padded much further than the shared estimate, since
  // this only needs to outlast PERFORMANCE_END's known failure mode
  // (resolving after the first segment of long text), not stand in for it
  // on ordinary turns. See estimateSpeechDuration.js — shared with the chat
  // transcript's progressive reveal timing so both use the same numbers.
  _estimatedSpeechMs(text) {
    return estimateSpeechDurationMs(text, this.language);
  }

  async startListening() {
    this._recognition = startBrowserSpeechRecognition(this.language, (text) => {
      this._answerCallback?.(text);
    });
    // Drives the avatar's own built-in listening animation (leaning
    // in/attentive posture), independent of our own "Listening…" mic
    // button — a real SDK feature that was sitting unused; we previously
    // only ever showed our own UI state, never told the avatar itself.
    this.presenter?.setListening?.(true);
    return Boolean(this._recognition);
  }

  stopListening() {
    stopBrowserSpeechRecognition(this._recognition);
    this._recognition = null;
    this.presenter?.setListening?.(false);
  }

  // Drives the avatar's built-in "thinking" animation — meant for the gap
  // while our backend/Gemini is generating the next question, which was
  // previously a dead spot where the avatar just stood there frozen with no
  // feedback at all.
  setThinking(isThinking) {
    this.presenter?.setThinking?.(isThinking);
  }

  stop() {
    this.stopListening();
    if (this._onVisibilityChange) {
      document.removeEventListener("visibilitychange", this._onVisibilityChange);
      this._onVisibilityChange = null;
    }
    this.presenter?.interruptPresentation?.();
    this.presenter?.remove();
    this.presenter = null;
    if (this.connected) {
      this.connected = false;
      this._connectionChangeCallback?.(false);
    }
  }
}
