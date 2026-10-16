// Blurs everything behind the person in a camera track, like Meet and Zoom do.
//
//   const { track, stop } = await createBlurProcessor(rawCameraTrack)
//
// `track` is a new video track to send in place of the camera's own. Stopping the
// processor does NOT stop the camera: whoever opened the camera owns it.
//
// How: every frame goes through MediaPipe's selfie segmentation (a small model run
// on the GPU) which says, per pixel, how much of it is the person; the person is
// drawn sharp over a blurred copy of the same frame, on a canvas, and the canvas
// is captured as the new track. The model and runtime are served from our own
// origin (see scripts/copy-mediapipe.mjs) and only fetched on first use.

const BASE = '/mediapipe/'
const FPS = 24
// Waiting longer than this for the first blurred frame means it is not going to
// work here (no WebGL, blocked download); better to say so than send black.
const FIRST_FRAME_TIMEOUT_MS = 10_000

/** Can this browser possibly do it? A cheap check; the real test is trying. */
export function blurSupported() {
  return typeof document !== 'undefined'
    && typeof Worker !== 'undefined'
    && typeof HTMLCanvasElement !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function'
}

let scriptPromise = null
function loadScript() {
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      if (window.SelfieSegmentation) return resolve()
      const el = document.createElement('script')
      el.src = `${BASE}selfie_segmentation.js`
      el.onload = () => (window.SelfieSegmentation ? resolve() : reject(new Error('blur model did not load')))
      el.onerror = () => reject(new Error("couldn't download the blur model"))
      document.head.appendChild(el)
    }).catch((e) => { scriptPromise = null; throw e })
  }
  return scriptPromise
}

// One segmenter is shared by one camera at a time. A spare is kept after use so
// turning the camera off and on again does not pay the model's start-up (about a
// second) again; a second camera running at once gets its own.
let spare = null
async function acquire() {
  if (spare) { const s = spare; spare = null; return s }
  await loadScript()
  const seg = new window.SelfieSegmentation({ locateFile: (file) => `${BASE}${file}` })
  // 1 = the "landscape" model: faster, and made for exactly this wide, close-up shot.
  seg.setOptions({ modelSelection: 1 })
  await seg.initialize()
  return seg
}
function release(seg) {
  seg.onResults(() => {})
  if (spare) seg.close().catch(() => {})
  else spare = seg
}

// A timer that keeps its pace in a hidden tab. requestAnimationFrame stops there,
// and a page timer is cut to once a second, which would freeze the picture the
// other people see the moment you switch to another tab mid-call. A worker's
// timer is not throttled.
function makeTicker(ms, onTick) {
  const url = URL.createObjectURL(new Blob(
    ['let t;onmessage=e=>{clearInterval(t);if(e.data)t=setInterval(()=>postMessage(0),e.data)}'],
    { type: 'text/javascript' },
  ))
  const worker = new Worker(url)
  worker.onmessage = onTick
  worker.postMessage(ms)
  return () => { worker.terminate(); URL.revokeObjectURL(url) }
}

const hasCanvasFilter = () =>
  typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype

export async function createBlurProcessor(rawTrack) {
  const seg = await acquire()
  let stopTicker = () => {}
  let outTrack = null
  const video = document.createElement('video')
  const cleanup = () => {
    stopTicker()
    video.pause()
    video.srcObject = null
    outTrack?.stop()
    release(seg)
  }

  try {
    video.muted = true
    video.playsInline = true
    video.srcObject = new MediaStream([rawTrack])
    await video.play()
    if (!video.videoWidth) {
      await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }))
    }

    const w = video.videoWidth
    const h = video.videoHeight
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    const filter = hasCanvasFilter()
    const radius = Math.max(6, Math.round(h / 40))
    // Browsers without canvas filters (older Safari) blur by shrinking and
    // stretching back, which is cruder but costs no more.
    const small = document.createElement('canvas')
    small.width = Math.max(1, Math.round(w / 12))
    small.height = Math.max(1, Math.round(h / 12))
    const sctx = small.getContext('2d')

    let firstFrame
    const firstFrameDrawn = new Promise((resolve) => { firstFrame = resolve })

    seg.onResults((r) => {
      ctx.save()
      ctx.clearRect(0, 0, w, h)
      // The person: the mask says how opaque each pixel is, and the frame is
      // kept only where the mask is.
      ctx.drawImage(r.segmentationMask, 0, 0, w, h)
      ctx.globalCompositeOperation = 'source-in'
      ctx.drawImage(r.image, 0, 0, w, h)
      // Everything else, blurred, drawn behind. Drawn a little oversize so the
      // blur does not fade to transparent at the edges of the picture.
      ctx.globalCompositeOperation = 'destination-over'
      if (filter) {
        ctx.filter = `blur(${radius}px)`
        ctx.drawImage(r.image, -radius, -radius, w + radius * 2, h + radius * 2)
      } else {
        sctx.drawImage(r.image, 0, 0, small.width, small.height)
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(small, 0, 0, w, h)
      }
      ctx.restore()
      firstFrame()
    })

    outTrack = canvas.captureStream(FPS).getVideoTracks()[0]
    let busy = false
    stopTicker = makeTicker(Math.round(1000 / FPS), async () => {
      // A camera that is switched off sends black whatever is drawn; do no work.
      if (busy || !outTrack.enabled || video.readyState < 2) return
      busy = true
      try { await seg.send({ image: video }) } catch (e) { console.warn('[blur]', e) } finally { busy = false }
    })

    await Promise.race([
      firstFrameDrawn,
      new Promise((_, reject) => setTimeout(() => reject(new Error("background blur didn't start")), FIRST_FRAME_TIMEOUT_MS)),
    ])
    // The raw track's on/off carries over, so a camera that was turned off stays off.
    outTrack.enabled = rawTrack.enabled

    return {
      track: outTrack,
      stop() { cleanup() },
    }
  } catch (e) {
    cleanup()
    throw e
  }
}
