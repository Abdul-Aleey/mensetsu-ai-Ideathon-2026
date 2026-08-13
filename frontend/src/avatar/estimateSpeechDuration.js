// ~170 words/minute (English) / ~6 characters/second (Japanese) plus a small
// lead-in pad. Shared between PerxonaAvatarController's own audio-completion
// floor (see speak()) and the chat transcript's progressive reveal timing
// (see Interview.jsx) so both are based on the exact same estimate and never
// quietly drift apart into two different numbers for the same thing.
//
// Word-splitting on whitespace only works for English — Japanese has no
// spaces between words at all, so counting words would collapse any
// Japanese sentence to "1 word" regardless of actual length. Character
// count at a rate suited to the interview's own "measured, formal" business
// register (slower than casual speech) is what actually tracks length for
// exactly the bilingual sessions this product supports.
export function estimateSpeechDurationMs(text, language) {
  return language === "ja"
    ? 800 + (text.replace(/\s+/g, "").length / 6) * 1000
    : 800 + (text.trim().split(/\s+/).filter(Boolean).length / 170) * 60 * 1000;
}
