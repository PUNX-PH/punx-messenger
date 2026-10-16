// A camera that can have its background blurred on and off while it is running.
//
// Both places a camera is used (1:1 calls and voice channels) need the same thing:
// "the track to send right now", which is the camera's own, or the blurred copy of
// it, and a way to switch between the two without turning the camera off. This is
// that, once. The caller sends `camera.track` and, after `setBlur`, sends the
// returned track instead (RTCRtpSender.replaceTrack, no renegotiation).
//
// The processor is injected so this can be tested without a camera or a GPU.

const PREF_KEY = 'plexus.blurBackground'

/** Remembered per browser, like the theme: it is about this camera and this room. */
export function loadBlurPref(storage = safeStorage()) {
  try { return storage?.getItem(PREF_KEY) === '1' } catch { return false }
}
export function saveBlurPref(on, storage = safeStorage()) {
  try { storage?.setItem(PREF_KEY, on ? '1' : '0') } catch { /* private mode: it just will not be remembered */ }
}
function safeStorage() {
  try { return globalThis.localStorage } catch { return null }
}

/**
 * @param {MediaStreamTrack} rawTrack the camera's own video track
 * @param {object} opts
 * @param {(track: MediaStreamTrack) => Promise<{track: MediaStreamTrack, stop: () => void}>} opts.createProcessor
 * @returns {Camera} starts with the plain camera; call `setBlur(true)` to blur it
 */
export function openCamera(rawTrack, { createProcessor }) {
  let processor = null
  let stopped = false
  // Calls to setBlur run one after another: switching on and off quickly must not
  // leave two processors running, or lose track of one.
  let queue = Promise.resolve()

  const camera = {
    /** What to send right now. */
    get track() { return processor ? processor.track : rawTrack },
    get blurred() { return processor !== null },
    /** The camera's own track, whatever is being sent. On/off follows this one. */
    get raw() { return rawTrack },
    /**
     * @returns {Promise<{ ok: boolean, track: MediaStreamTrack, error?: Error }>}
     *   `ok` is false when blur could not be started; `track` is then still the
     *   plain camera, which keeps working.
     */
    setBlur(on) {
      const run = async () => {
        if (stopped || on === (processor !== null)) return { ok: true, track: camera.track }
        if (on) {
          try {
            processor = await createProcessor(rawTrack)
          } catch (error) {
            return { ok: false, track: camera.track, error }
          }
          // The camera was closed while the model was starting.
          if (stopped) { processor.stop(); processor = null }
        } else {
          const p = processor
          processor = null
          p.stop()
        }
        return { ok: true, track: camera.track }
      }
      const result = queue.then(run)
      queue = result.catch(() => {})
      return result
    },
    /** Stops the blur and the camera itself. Safe to call twice. */
    stop() {
      stopped = true
      processor?.stop()
      processor = null
      rawTrack.stop()
    },
  }

  return camera
}
