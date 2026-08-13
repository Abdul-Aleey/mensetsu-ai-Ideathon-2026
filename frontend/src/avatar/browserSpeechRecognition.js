/**
 * Shared browser-native speech recognition (Web Speech API). Used by any
 * avatar controller that needs to capture the candidate's spoken answer
 * itself: MockAvatarController always needs this (it has no real backend),
 * and PerxonaAvatarController needs it too now that it's built on the
 * Presenter SDK, which only speaks — it doesn't listen.
 */
export function startBrowserSpeechRecognition(language, onResult) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;

  const recognition = new SpeechRecognition();
  recognition.lang = language === "ja" ? "ja-JP" : "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    const text = event.results[0]?.[0]?.transcript;
    if (text) onResult(text);
  };
  // Without this, a denied mic permission (or any other recognition
  // failure) failed completely silently — nothing in the UI or console
  // showed it, so it just looked like there was no mic at all, indistinguishable
  // from every other reason the candidate might type instead.
  recognition.onerror = (event) => {
    console.error("Speech recognition error:", event.error);
  };
  recognition.start();
  return recognition;
}

export function stopBrowserSpeechRecognition(recognition) {
  recognition?.stop();
}
