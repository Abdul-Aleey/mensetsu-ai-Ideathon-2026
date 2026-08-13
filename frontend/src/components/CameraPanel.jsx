import { useEffect, useRef, useState } from "react";

// Live self-view only — genuine getUserMedia feed, styled like a real video
// interview call. We deliberately do NOTHING with the stream: no recording,
// no upload, no analysis, no background blur. Spec §6.
// FUTURE: attach frame analysis / emotion detection here.
export default function CameraPanel({ candidateName }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [state, setState] = useState("off"); // "off" | "requesting" | "on" | "denied"
  const [micLevel, setMicLevel] = useState(0);

  async function openCamera() {
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      setState("on");
      _watchMicLevel(stream, setMicLevel);
    } catch {
      setState("denied");
    }
  }

  // The <video> element only mounts once state === "on" (see render below),
  // so it doesn't exist yet at the point openCamera() resolves — assigning
  // srcObject there would silently no-op on a null ref. This effect runs
  // after that render commits, once videoRef.current is guaranteed to be
  // the real, mounted element.
  useEffect(() => {
    if (state === "on" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [state]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="camera-panel">
      {state === "on" && (
        <div className="camera-panel__tile">
          <video ref={videoRef} autoPlay playsInline muted className="camera-panel__video" />
          <div className="camera-panel__overlay">
            <span className="camera-panel__rec">● REC</span>
            <span
              className="camera-panel__mic-dot"
              style={{ opacity: 0.35 + Math.min(micLevel, 1) * 0.65 }}
              aria-hidden="true"
            />
            {candidateName && <span className="camera-panel__name">{candidateName.split(" ")[0]}</span>}
          </div>
        </div>
      )}

      {state !== "on" && (
        <div className={`camera-panel__placeholder${state === "denied" ? " camera-panel__placeholder--denied" : ""}`}>
          <CameraOffIcon />
          {state === "denied" ? (
            <p>Camera off — permission was denied. You can still continue by typing your answers.</p>
          ) : (
            <>
              <p>Camera off</p>
              <button type="button" onClick={openCamera} disabled={state === "requesting"}>
                {state === "requesting" ? "Requesting access…" : "Open camera"}
              </button>
            </>
          )}
          {candidateName && <p className="camera-panel__name">{candidateName.split(" ")[0]}</p>}
        </div>
      )}
    </div>
  );
}

function CameraOffIcon() {
  return (
    <svg
      className="camera-panel__placeholder-icon"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M15 7h-1.2l-1-1H8.2l-1 1H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="10.5" cy="12.5" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M18 10.5 22 8v9l-4-2.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M3 3 21 21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function _watchMicLevel(stream, onLevel) {
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) return;

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  let raf;
  function tick() {
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
    onLevel(avg / 255);
    raf = requestAnimationFrame(tick);
  }
  tick();

  stream.getTracks().forEach((track) =>
    track.addEventListener("ended", () => {
      cancelAnimationFrame(raf);
      ctx.close();
    })
  );
}
