(() => {
  if (window.__avengerHandTrackingLoaded) {
    console.warn('Avenger Hand Tracking script already loaded');
    return;
  }
  window.__avengerHandTrackingLoaded = true;

  const videoElement = document.getElementById('video');
  const canvasElement = document.getElementById('output');
  const canvasCtx = canvasElement.getContext('2d');
  const gestureLabel = document.getElementById('gesture');
  const statusLabel = document.getElementById('status');
  const startButton = document.getElementById('startButton');

  console.log('Avenger Hand Tracking init', { startButton: !!startButton, hasMediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia), hasElements: !!videoElement && !!canvasElement });

  if (!videoElement || !canvasElement) {
    console.error('Required DOM elements missing: #video or #output canvas');
    return;
  }

  if (!canvasCtx) {
    console.error('Unable to get 2D canvas context');
  }

const setGesture = (name) => {
  if (gestureLabel) gestureLabel.textContent = name;
};

const setStatus = (message) => {
  if (statusLabel) {
    statusLabel.textContent = message;
  }
};

const debugLabel = document.getElementById('debug');
const setDebug = (message) => {
  if (debugLabel) {
    debugLabel.textContent = message;
  }
};

const checkCameraSupport = async () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setGesture('Camera unsupported');
    setStatus('Camera API not available. Use HTTPS or localhost in a supported browser.');
    return false;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const hasCamera = devices.some((device) => device.kind === 'videoinput');
    if (!hasCamera) {
      setGesture('No camera');
      setStatus('No camera device detected. Connect a camera and refresh the page.');
      return false;
    }
  } catch (error) {
    console.warn('enumerateDevices failed', error);
  }

  return true;
};

// Dynamically load MediaPipe scripts if not already present
const loadMediaPipe = async () => {
  if (window.Hands && window.drawConnectors && window.drawLandmarks && window.HAND_CONNECTIONS) return;

  const tryLoadScript = (src) => new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve(src);
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.referrerPolicy = 'no-referrer';
    s.onload = () => {
      console.log('Loaded script:', src);
      resolve(src);
    };
    s.onerror = (e) => {
      console.warn('Script failed to load:', src, e);
      s.remove();
      reject(new Error('Failed to load ' + src));
    };
    document.head.appendChild(s);
  });

  const loadWithFallback = async (candidates) => {
    let lastErr = null;
    for (const src of candidates) {
      try {
        await tryLoadScript(src);
        return;
      } catch (err) {
        lastErr = err;
        // try next
      }
    }
    throw lastErr || new Error('No candidates provided');
  };

  try {
    await loadWithFallback([
      'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js',
      'https://unpkg.com/@mediapipe/hands@0.4.1675469240/hands.js',
      'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js'
    ]);
    await loadWithFallback([
      'https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils@0.3.1675466124/drawing_utils.js',
      'https://unpkg.com/@mediapipe/drawing_utils@0.3.1675466124/drawing_utils.js',
      'https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils@0.3.1675466124/drawing_utils.js'
    ]);
    // Give globals a moment to initialize
    let attempts = 0;
    while (!(window.Hands && window.drawConnectors && window.drawLandmarks && window.HAND_CONNECTIONS) && attempts < 20) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 100));
      attempts += 1;
      if (attempts === 10) console.log('Waiting for MediaPipe globals to initialize...');
    }
    if (!(window.Hands && window.drawConnectors && window.drawLandmarks && window.HAND_CONNECTIONS)) {
      throw new Error('MediaPipe globals not available after loading');
    }
  } catch (err) {
    console.error('loadMediaPipe error', err);
    throw err;
  }
};

window.addEventListener('error', (event) => {
  setStatus(`Error: ${event.message}`);
});

window.addEventListener('unhandledrejection', (event) => {
  setStatus(`Promise error: ${event.reason}`);
});

const effectState = {
  activeGesture: null,
  lastGesture: null,
  gestureStart: performance.now(),
  lastFrame: performance.now(),
  particles: []
};

let frameCount = 0;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (min, max) => min + Math.random() * (max - min);

const addParticle = (particle) => {
  effectState.particles.push(particle);
};

const updateParticles = (dt) => {
  effectState.particles = effectState.particles.filter((particle) => {
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.life -= dt;
    particle.alpha = clamp(particle.life / particle.maxLife, 0, 1);
    return particle.life > 0;
  });
};

const drawParticles = () => {
  if (!canvasCtx) return;
  for (const particle of effectState.particles) {
    canvasCtx.save();
    canvasCtx.globalAlpha = particle.alpha * particle.opacity;
    canvasCtx.fillStyle = particle.color;
    canvasCtx.beginPath();
    canvasCtx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    canvasCtx.fill();
    canvasCtx.restore();
  }
};

const emitSparkBurst = (x, y, count, color) => {
  for (let i = 0; i < count; i += 1) {
    addParticle({
      x,
      y,
      vx: rand(-0.6, 0.6) * 0.8,
      vy: rand(-1.6, -0.4) * 0.8,
      size: rand(1.5, 3.5),
      color,
      life: rand(240, 420),
      maxLife: rand(240, 420),
      opacity: rand(0.55, 0.9)
    });
  }
};

const drawIronManVFX = (x, y, now) => {
  canvasCtx.globalCompositeOperation = 'lighter';
  const beamTarget = { x: canvasElement.width / 2, y: -120 };
  const beamWidth = 16 + 8 * Math.sin(now / 150);
  const beamGradient = canvasCtx.createLinearGradient(x, y, beamTarget.x, beamTarget.y);
  beamGradient.addColorStop(0, 'rgba(255,220,200,0.95)');
  beamGradient.addColorStop(0.35, 'rgba(255,80,60,0.45)');
  beamGradient.addColorStop(1, 'rgba(255,20,20,0.05)');
  canvasCtx.strokeStyle = beamGradient;
  canvasCtx.lineWidth = beamWidth;
  canvasCtx.lineCap = 'round';
  canvasCtx.beginPath();
  canvasCtx.moveTo(x, y);
  canvasCtx.lineTo(beamTarget.x, beamTarget.y);
  canvasCtx.stroke();

  const ringCount = 3;
  for (let i = 0; i < ringCount; i += 1) {
    const radius = 32 + i * 22 + 8 * Math.sin(now / 160 + i);
    canvasCtx.strokeStyle = `rgba(255,120,80,${0.15 - i * 0.04})`;
    canvasCtx.lineWidth = 3;
    canvasCtx.beginPath();
    canvasCtx.arc(x, y, radius, 0, Math.PI * 2);
    canvasCtx.stroke();
  }

  const glow = canvasCtx.createRadialGradient(x, y, 0, x, y, 140);
  glow.addColorStop(0, 'rgba(255,255,240,0.85)');
  glow.addColorStop(0.3, 'rgba(255,80,60,0.55)');
  glow.addColorStop(1, 'rgba(255,40,20,0)');
  canvasCtx.fillStyle = glow;
  canvasCtx.beginPath();
  canvasCtx.arc(x, y, 140, 0, Math.PI * 2);
  canvasCtx.fill();

  if (Math.random() < 0.2) {
    emitSparkBurst(x + rand(-12, 12), y + rand(-12, 12), 4, 'rgba(255,210,150,0.95)');
  }
  canvasCtx.globalCompositeOperation = 'source-over';
};

const drawSpiderManVFX = (landmarks, now) => {
  const idx = landmarks[8];
  const pinky = landmarks[20];
  const ix = idx.x * canvasElement.width;
  const iy = idx.y * canvasElement.height;
  const px = pinky.x * canvasElement.width;
  const py = pinky.y * canvasElement.height;
  const avgX = (ix + px) / 2;
  const avgY = (iy + py) / 2;
  const target = { x: avgX + rand(-120, 120), y: avgY - 220 + 30 * Math.sin(now / 160) };

  canvasCtx.strokeStyle = '#b4f0ff';
  canvasCtx.lineWidth = 4;
  canvasCtx.lineCap = 'round';
  canvasCtx.shadowBlur = 18;
  canvasCtx.shadowColor = 'rgba(100,220,255,0.65)';
  canvasCtx.beginPath();
  canvasCtx.moveTo(ix, iy);
  canvasCtx.quadraticCurveTo(avgX - 40, avgY - 80, target.x, target.y);
  canvasCtx.stroke();
  canvasCtx.beginPath();
  canvasCtx.moveTo(px, py);
  canvasCtx.quadraticCurveTo(avgX + 40, avgY - 80, target.x, target.y);
  canvasCtx.stroke();
  canvasCtx.shadowBlur = 0;

  for (let i = 0; i < 6; i += 1) {
    canvasCtx.strokeStyle = `rgba(180,240,255,${0.15 - i * 0.02})`;
    canvasCtx.lineWidth = 1.5;
    canvasCtx.beginPath();
    canvasCtx.moveTo(lerp(ix, target.x, 0.1 + i * 0.15), lerp(iy, target.y, 0.1 + i * 0.15));
    canvasCtx.lineTo(lerp(px, target.x, 0.1 + i * 0.15), lerp(py, target.y, 0.1 + i * 0.15));
    canvasCtx.stroke();
  }

  if (Math.random() < 0.2) {
    emitSparkBurst(target.x, target.y, 3, 'rgba(200,255,255,0.75)');
  }
};

const drawWandaVFX = (landmarks, now) => {
  const palm = landmarks[9];
  const x = palm.x * canvasElement.width;
  const y = palm.y * canvasElement.height;
  const radius = 180 + 24 * Math.sin(now / 170);

  const aura = canvasCtx.createRadialGradient(x, y, 0, x, y, radius);
  aura.addColorStop(0, 'rgba(255,40,110,0.92)');
  aura.addColorStop(0.35, 'rgba(255,80,120,0.35)');
  aura.addColorStop(1, 'rgba(80,20,30,0)');
  canvasCtx.globalCompositeOperation = 'lighter';
  canvasCtx.fillStyle = aura;
  canvasCtx.beginPath();
  canvasCtx.arc(x, y, radius, 0, Math.PI * 2);
  canvasCtx.fill();

  for (let i = 0; i < 5; i += 1) {
    const phase = now / 120 + i * 1.2;
    const px = x + Math.cos(phase) * (radius * 0.6);
    const py = y + Math.sin(phase) * (radius * 0.6);
    canvasCtx.strokeStyle = `rgba(255,90,140,${0.18 - i * 0.02})`;
    canvasCtx.lineWidth = 2.5;
    canvasCtx.beginPath();
    canvasCtx.moveTo(x, y);
    canvasCtx.quadraticCurveTo(x + (i - 2) * 15, y - 80, px, py);
    canvasCtx.stroke();
  }

  canvasCtx.fillStyle = 'rgba(255,80,120,0.55)';
  canvasCtx.beginPath();
  canvasCtx.arc(x, y, 28 + 8 * Math.abs(Math.sin(now / 130)), 0, Math.PI * 2);
  canvasCtx.fill();
  canvasCtx.globalCompositeOperation = 'source-over';

  if (Math.random() < 0.15) {
    emitSparkBurst(x + rand(-18, 18), y + rand(-18, 18), 4, 'rgba(255,180,230,0.9)');
  }
};

const renderCinematicOverlay = (gesture, now) => {
  canvasCtx.save();
  const intensity = gesture === 'Wanda' ? 0.14 : gesture === 'Iron Man' ? 0.16 : gesture === 'Spider-Man' ? 0.12 : 0.06;
  canvasCtx.fillStyle = `rgba(20, 14, 40, ${intensity})`;
  canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);

  if (gesture === 'Iron Man') {
    canvasCtx.strokeStyle = 'rgba(255,120,80,0.14)';
    canvasCtx.lineWidth = 1.5;
    canvasCtx.beginPath();
    canvasCtx.arc(canvasElement.width / 2, canvasElement.height / 3, 220 + 20 * Math.sin(now / 130), 0, Math.PI * 2);
    canvasCtx.stroke();
  }

  if (gesture === 'Spider-Man') {
    canvasCtx.strokeStyle = 'rgba(120,220,255,0.08)';
    canvasCtx.lineWidth = 2;
    canvasCtx.beginPath();
    canvasCtx.moveTo(canvasElement.width * 0.1, canvasElement.height * 0.8);
    canvasCtx.lineTo(canvasElement.width * 0.9, canvasElement.height * 0.3);
    canvasCtx.stroke();
  }

  if (gesture === 'Wanda') {
    canvasCtx.filter = 'blur(1px)';
    canvasCtx.fillStyle = `rgba(255,40,90,0.12)`;
    canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.filter = 'none';
  }

  canvasCtx.restore();
};

const drawEffect = (gesture, landmarks) => {
  if (!landmarks || landmarks.length === 0) return;
  if (!canvasCtx) return;

  const now = performance.now();
  const dt = clamp(now - effectState.lastFrame, 16, 40) * 0.06;
  effectState.lastFrame = now;
  updateParticles(dt);

  const center = landmarks[9];
  const x = center.x * canvasElement.width;
  const y = center.y * canvasElement.height;

  if (gesture === 'Iron Man') {
    drawIronManVFX(x, y, now);
  }

  if (gesture === 'Spider-Man') {
    drawSpiderManVFX(landmarks, now);
  }

  if (gesture === 'Wanda') {
    drawWandaVFX(landmarks, now);
  }

  drawParticles();
  renderCinematicOverlay(gesture, now);
};

const calcFingerExtended = (landmarks, tipIndex, dipIndex, pipIndex) => {
  return landmarks[tipIndex].y < landmarks[dipIndex].y && landmarks[dipIndex].y < landmarks[pipIndex].y;
};

const detectGesture = (landmarks) => {
  if (!landmarks || landmarks.length === 0) return 'No hands';

  const thumbExtended = calcFingerExtended(landmarks, 4, 3, 2);
  const indexExtended = calcFingerExtended(landmarks, 8, 7, 6);
  const middleExtended = calcFingerExtended(landmarks, 12, 11, 10);
  const ringExtended = calcFingerExtended(landmarks, 16, 15, 14);
  const pinkyExtended = calcFingerExtended(landmarks, 20, 19, 18);

  if (indexExtended && middleExtended && ringExtended && pinkyExtended && thumbExtended) {
    return 'Iron Man';
  }

  if (indexExtended && !middleExtended && !ringExtended && pinkyExtended) {
    return 'Spider-Man';
  }

  if (!thumbExtended && !indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
    return 'Wanda';
  }

  return 'Searching...';
};

const onResults = (results) => {
  try {
    const count = results.multiHandLandmarks ? results.multiHandLandmarks.length : 0;
    console.log('onResults called. multiHandLandmarks count:', count, 'multiHandedness:', results.multiHandedness);
    if (!results.image) {
      console.warn('onResults: results.image is missing');
    }
    if (count > 0 && results.multiHandLandmarks[0] && results.multiHandLandmarks[0].length) {
      console.log('First hand sample (first 5 points):', results.multiHandLandmarks[0].slice(0, 5));
    }
  } catch (e) {
    console.warn('onResults log error', e);
  }
  if (!canvasCtx) {
    console.warn('onResults: missing canvas context, skipping draw');
    return;
  }
  canvasCtx.save();
  try {
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    if (results.image) canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
  } catch (e) {
    console.warn('onResults canvas draw error', e);
  }

  const handCount = results.multiHandLandmarks ? results.multiHandLandmarks.length : 0;
  frameCount += 1;
  setDebug(`hands=${handCount} | frame=${frameCount} | readyState=${videoElement.readyState}`);

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    // Choose a gesture based on both detected hands.
    const gestures = results.multiHandLandmarks.map((handLandmarks) => detectGesture(handLandmarks));
    const combinedGesture = gestures.includes('Wanda')
      ? 'Wanda'
      : gestures.includes('Spider-Man')
      ? 'Spider-Man'
      : gestures.includes('Iron Man')
      ? 'Iron Man'
      : 'Searching...';

    setGesture(combinedGesture);

    // Draw effect using first hand center, but still render both hands.
    drawEffect(combinedGesture, results.multiHandLandmarks[0]);

    for (const handLandmarks of results.multiHandLandmarks) {
      try {
        if (window.drawConnectors) window.drawConnectors(canvasCtx, handLandmarks, window.HAND_CONNECTIONS, { color: '#ffffff', lineWidth: 2 });
        if (window.drawLandmarks) window.drawLandmarks(canvasCtx, handLandmarks, { color: '#ffcc00', lineWidth: 1 });
      } catch (e) {
        console.warn('drawing_utils error', e);
      }
    }
  } else {
    setGesture('Show your hand');
    setStatus('No hand detected. Move a clear hand pose into the frame.');
    if (frameCount % 60 === 0) {
      console.log('No hand landmarks detected yet.', {
        readyState: videoElement.readyState,
        videoWidth: videoElement.videoWidth,
        videoHeight: videoElement.videoHeight,
        multiHandedness: results.multiHandedness,
        imagePresent: Boolean(results.image)
      });
    }
    setDebug(`hands=${handCount} | frame=${frameCount} | status=no hands`);
  }

  canvasCtx.restore();
};

let hasStarted = false;

const initializeHands = async (stream) => {
  setStatus('Initializing hand tracking...');
  setGesture('Waiting...');

  if (!window.Hands || !window.drawConnectors || !window.drawLandmarks || !window.HAND_CONNECTIONS) {
    throw new Error('MediaPipe scripts are not loaded. Please refresh the page.');
  }

  const hands = new window.Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`
  });
  console.log('Created Hands instance:', hands);
  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    selfieMode: true,
    minDetectionConfidence: 0.1,
    minTrackingConfidence: 0.1
  });
  hands.onResults(onResults);
  console.log('Hands.onResults handler registered');

  const resizeCanvas = () => {
    try {
      const w = videoElement.videoWidth || 1280;
      const h = videoElement.videoHeight || 720;
      if (!w || !h) {
        console.warn('Video metadata not ready: videoWidth=', videoElement.videoWidth, 'videoHeight=', videoElement.videoHeight, 'readyState=', videoElement.readyState);
      }
      if (canvasElement.width !== w || canvasElement.height !== h) {
        canvasElement.width = w;
        canvasElement.height = h;
      }
    } catch (e) {
      console.warn('resizeCanvas failed', e);
    }
  };

  videoElement.muted = true;
  videoElement.playsInline = true;
  videoElement.autoplay = true;
  videoElement.style.display = 'block';
  videoElement.srcObject = stream;
  videoElement.addEventListener('loadedmetadata', () => {
    console.log('video loadedmetadata', videoElement.videoWidth, videoElement.videoHeight, videoElement.readyState);
    resizeCanvas();
  });
  videoElement.addEventListener('canplay', () => {
    console.log('video canplay', videoElement.videoWidth, videoElement.videoHeight, videoElement.readyState);
    resizeCanvas();
  });
  videoElement.addEventListener('playing', () => {
    console.log('video playing', videoElement.videoWidth, videoElement.videoHeight, videoElement.readyState);
    resizeCanvas();
  });

  await videoElement.play();

  // ensure canvas matches video when the video becomes available or window resizes
  resizeCanvas();
  videoElement.addEventListener('loadeddata', resizeCanvas);
  videoElement.addEventListener('play', resizeCanvas);
  window.addEventListener('resize', resizeCanvas);

  const processFrame = async () => {
    const desiredInterval = 1000 / 15; // ~15 FPS
    const now = performance.now();
    if (!processFrame._last) processFrame._last = 0;
    if (videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && (now - processFrame._last) >= desiredInterval) {
      try {
        console.log('Sending frame to Hands; readyState=', videoElement.readyState, 'size=', videoElement.videoWidth, 'x', videoElement.videoHeight);
        await hands.send({ image: videoElement });
        processFrame._last = now;
        if (!processFrame._logged) {
          console.log('First frame sent to Hands.send()');
          processFrame._logged = true;
        }
      } catch (err) {
        console.error('hands.send error', err);
      }
    }
    requestAnimationFrame(processFrame);
  };

  requestAnimationFrame(processFrame);
  setStatus('Camera active. Show your hand in view.');
};

const startCamera = async () => {
  if (hasStarted) return;
  hasStarted = true;
  if (startButton) startButton.disabled = true;
  setStatus('Start clicked. Requesting camera permission...');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setGesture('Camera failed');
    setStatus('Camera API not available in this browser.');
    return;
  }

  if (navigator.permissions) {
    try {
      const permissionStatus = await navigator.permissions.query({ name: 'camera' });
      setStatus(`Camera permission state: ${permissionStatus.state}`);
      permissionStatus.onchange = () => {
        setStatus(`Camera permission state changed to ${permissionStatus.state}`);
      };
    } catch (permissionError) {
      console.warn('Permission query failed', permissionError);
    }
  }

  try {
    const supported = await checkCameraSupport();
    if (!supported) {
      if (startButton) startButton.disabled = false;
      hasStarted = false;
      return;
    }
    try {
      await loadMediaPipe();
    } catch (e) {
      setGesture('MediaPipe failed');
      setStatus('Failed to load MediaPipe scripts. Check console for details.');
      if (startButton) startButton.disabled = false;
      hasStarted = false;
      return;
    }

    console.log('navigator.mediaDevices:', navigator.mediaDevices);
    setStatus('Requesting camera stream...');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: 'user' },
      audio: false
    });
    console.log('Camera stream received');
    await initializeHands(stream);
  } catch (error) {
    console.error('getUserMedia failed', error);
    const message = error && error.name === 'NotAllowedError'
      ? 'Camera permission denied. Please allow camera access in the browser address bar.'
      : (error && error.message ? error.message : 'Unknown camera error.');
    setGesture('Camera failed');
    setStatus('Unable to start camera: ' + message);
    console.error(error);
    if (startButton) startButton.disabled = false;
    hasStarted = false;
  }
};

if (startButton) {
  startButton.addEventListener('click', () => {
    console.log('Start Camera clicked');
    setStatus('Button clicked. Trying to request camera...');
    startCamera();
  });
}

window.addEventListener('load', () => {
  if (!startButton) {
    console.error('Start button missing');
    return;
  }
  setStatus('Ready. Click Start Camera and allow browser camera access.');
});
})();
