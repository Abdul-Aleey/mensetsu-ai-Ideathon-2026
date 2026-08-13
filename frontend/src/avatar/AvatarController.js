/**
 * @typedef {Object} AvatarController
 * @property {() => Promise<void>} start
 * @property {(text: string, emotion: string) => Promise<void>} speak - resolves once the avatar has actually finished saying it
 * @property {(callback: (text: string) => void) => void} onUserAnswer
 * @property {(isThinking: boolean) => void} setThinking - no-op in mock mode; drives the avatar's thinking animation in Perxona mode
 * @property {() => void} stop
 *
 * The interview loop only ever talks to this interface — it must not know or
 * care whether MockAvatarController or PerxonaAvatarController is active.
 * See spec §5.1.
 */
export {};
