import { startBrowserSpeechRecognition, stopBrowserSpeechRecognition } from "./browserSpeechRecognition.js";

/**
 * Zero-credit avatar stand-in (spec §5.1). Speaks via the browser's free
 * speechSynthesis API and listens via the free SpeechRecognition API when
 * available; the Interview screen also always offers a text box so the
 * interview is fully usable even where SpeechRecognition isn't supported
 * (e.g. Firefox).
 */
export class MockAvatarController {
  constructor({ language }) {
    this.language = language; // "en" | "ja"
    this._answerCallback = null;
    this._recognition = null;
  }

  async start() {
    // Nothing to connect to — this is the whole point of mock mode.
  }

  speak(text, _emotion) {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) {
        resolve();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = this.language === "ja" ? "ja-JP" : "en-US";
      const voice = _pickVoice(utterance.lang);
      if (voice) utterance.voice = voice;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.cancel(); // don't let utterances queue up across turns
      window.speechSynthesis.speak(utterance);
    });
  }

  onUserAnswer(callback) {
    this._answerCallback = callback;
  }

  // No avatar to animate in mock mode — exists so Interview.jsx can call it
  // unconditionally without a mode check.
  setThinking(_isThinking) {}

  /** Called by the text-input fallback in the Interview screen. */
  submitTextAnswer(text) {
    if (this._answerCallback) this._answerCallback(text);
  }

  /** Starts one round of browser speech recognition, if supported. */
  startListening() {
    this._recognition = startBrowserSpeechRecognition(this.language, (text) => {
      this._answerCallback?.(text);
    });
    return Boolean(this._recognition);
  }

  stopListening() {
    stopBrowserSpeechRecognition(this._recognition);
    this._recognition = null;
  }

  stop() {
    window.speechSynthesis?.cancel();
    this.stopListening();
    this._answerCallback = null;
  }
}

function _pickVoice(lang) {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  return voices.find((v) => v.lang === lang) || voices.find((v) => v.lang?.startsWith(lang.slice(0, 2)));
}
