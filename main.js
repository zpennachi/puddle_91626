/**
 * zpennachi
 * Ultra-Fast High-Resolution 2D Glitch Engine with Sine LUT (Zero Math.sin in inner loop)
 * 100% Authentic Byte-Offset Glitch & True Color Burning Feedback at 60 FPS
 */

const canvas = document.getElementById('glitchCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const muteBtn = document.getElementById('mute-btn');

const amplitudeEl = document.getElementById('amplitude-slider');
const periodEl = document.getElementById('period-slider');
const effectEl = document.getElementById('effect-slider');

let amplitude = parseFloat(amplitudeEl.dataset.val);
let period = parseFloat(periodEl.dataset.val);
let effectIntensity = parseFloat(effectEl.dataset.val);

let imageData = null;
let glitchedPixels = null;
let waveImageData = null;
let animationRequestId = null;
let eventListenersInitialized = false;

// High-definition resolution (600px for crisp detail + 60fps performance)
const TARGET_RESOLUTION = 600;

const defaultImageUrl = './assets/default-image.webp';
const defaultImageFallback = 'https://cdn.prod.website-files.com/643af806354c783eb866d160/645123b173e3c023c2af5543_06_Seeing-the-forest-for-the-trees.webp';

// Pre-allocated Lookup Tables for 60fps performance
let sinX1 = new Float32Array(TARGET_RESOLUTION);
let sinY1 = new Float32Array(TARGET_RESOLUTION);
let sinX2 = new Float32Array(TARGET_RESOLUTION);
let sinY2 = new Float32Array(TARGET_RESOLUTION);

// ==========================================
// 1. Interactive ASCII Slider Component
// ==========================================
class AsciiSlider {
  constructor(element, onChange, trackLength = 16) {
    this.el = element;
    this.min = parseFloat(element.dataset.min);
    this.max = parseFloat(element.dataset.max);
    this.value = parseFloat(element.dataset.val);
    this.step = parseFloat(element.dataset.step) || 0.01;
    this.trackLength = trackLength;
    this.onChange = onChange;
    this.isDragging = false;

    this.render();
    this.initEvents();
  }

  render() {
    const ratio = Math.max(0, Math.min(1, (this.value - this.min) / (this.max - this.min)));
    const pos = Math.round(ratio * (this.trackLength - 1));
    const left = '='.repeat(pos);
    const right = '='.repeat(this.trackLength - 1 - pos);
    this.el.textContent = `[${left}|${right}]`;
    this.el.setAttribute('aria-valuenow', this.value);
  }

  setValueFromRatio(ratio) {
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    const rawVal = this.min + clampedRatio * (this.max - this.min);
    const steppedVal = Math.round((rawVal - this.min) / this.step) * this.step + this.min;
    this.value = Math.max(this.min, Math.min(this.max, parseFloat(steppedVal.toFixed(4))));
    this.el.dataset.val = this.value;
    this.render();
    if (this.onChange) this.onChange(this.value);
  }

  initEvents() {
    const updateFromPointer = (e) => {
      const rect = this.el.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const ratio = (clientX - rect.left) / rect.width;
      this.setValueFromRatio(ratio);
    };

    this.el.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      updateFromPointer(e);
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        updateFromPointer(e);
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    this.el.addEventListener('touchstart', (e) => {
      this.isDragging = true;
      updateFromPointer(e);
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (this.isDragging) {
        updateFromPointer(e);
      }
    }, { passive: true });

    window.addEventListener('touchend', () => {
      this.isDragging = false;
    });

    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        const nextVal = Math.min(this.max, this.value + this.step);
        this.setValueFromRatio((nextVal - this.min) / (this.max - this.min));
        e.preventDefault();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        const prevVal = Math.max(this.min, this.value - this.step);
        this.setValueFromRatio((prevVal - this.min) / (this.max - this.min));
        e.preventDefault();
      } else if (e.key === 'Home') {
        this.setValueFromRatio(0);
        e.preventDefault();
      } else if (e.key === 'End') {
        this.setValueFromRatio(1);
        e.preventDefault();
      }
    });
  }
}

// ==========================================
// 2. Image Processing & Setup
// ==========================================
function resizeImage(image, maxSize = TARGET_RESOLUTION) {
  return new Promise((resolve) => {
    const offCanvas = document.createElement('canvas');
    const offCtx = offCanvas.getContext('2d');

    let width = image.naturalWidth || image.width;
    let height = image.naturalHeight || image.height;

    const aspectRatio = width / height;
    if (width > maxSize || height > maxSize) {
      if (width > height) {
        width = maxSize;
        height = Math.round(width / aspectRatio);
      } else {
        height = maxSize;
        width = Math.round(height * aspectRatio);
      }
    }

    offCanvas.width = width;
    offCanvas.height = height;
    offCtx.drawImage(image, 0, 0, width, height);
    const resizedImage = new Image();
    resizedImage.onload = () => resolve(resizedImage);
    resizedImage.src = offCanvas.toDataURL();
  });
}

async function loadImage(src) {
  if (animationRequestId) {
    cancelAnimationFrame(animationRequestId);
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = async function () {
    const resizedImg = await resizeImage(img, TARGET_RESOLUTION);

    canvas.width = resizedImg.width;
    canvas.height = resizedImg.height;

    // Resize pre-calculated LUTs
    sinX1 = new Float32Array(canvas.width);
    sinY1 = new Float32Array(canvas.height);
    sinX2 = new Float32Array(canvas.width);
    sinY2 = new Float32Array(canvas.height);

    ctx.drawImage(resizedImg, 0, 0);
    imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    if (!eventListenersInitialized) {
      setupEventListeners();
      eventListenersInitialized = true;
    }

    applyGlitch();
  };

  img.onerror = function () {
    if (src === defaultImageUrl) {
      loadImage(defaultImageFallback);
    }
  };

  if (src instanceof File) {
    img.src = URL.createObjectURL(src);
  } else {
    img.src = src;
  }
}

// ==========================================
// 3. Ultra-Fast Sine LUT Glitch & Feedback Engine
// ==========================================
function applyGlitch() {
  if (!imageData) return;

  const data = imageData.data;
  const numPixels = data.length / 4;
  const w = canvas.width;
  const h = canvas.height;
  const scale = w / 300.0;

  glitchedPixels = new Uint8ClampedArray(data.length);
  for (let i = 0; i < numPixels; i++) {
    const offset = i * 4;
    const x = (i % w) + Math.round(15 * scale * (Math.random() - 0.5));
    const y = Math.floor(i / w) + Math.round(3 * scale * (Math.random() - 0.5));
    const offset2 = (y * w + x) * 4;

    glitchedPixels[offset] = data[offset2];
    glitchedPixels[offset + 1] = data[offset2 + 1];
    glitchedPixels[offset + 2] = data[offset2 + 2];
    glitchedPixels[offset + 3] = data[offset2 + 3];
  }

  waveImageData = new ImageData(new Uint8ClampedArray(glitchedPixels), w, h);

  if (animationRequestId) {
    cancelAnimationFrame(animationRequestId);
  }

  let frameCount = 0;
  const animate = () => {
    frameCount++;
    if (frameCount % 2 === 0) {
      const safePeriod = period === 0 ? 0.001 : period;
      const freq1 = (2 * Math.PI) / safePeriod;
      const freq2 = (2 * Math.PI) / (safePeriod / 1.5);
      const now = Date.now();

      const origData = imageData.data;
      const waveData = waveImageData.data;

      // 1. Fill Lookup Tables once per frame (only W + H calculations instead of W*H!)
      const t2000 = now / 2000;
      const t3000 = now / 3000;
      const t30000 = now / 30000;

      for (let x = 0; x < w; x++) {
        sinX1[x] = Math.sin(freq1 * (x + t2000));
        sinX2[x] = Math.sin(freq2 * (x + t3000));
      }
      for (let y = 0; y < h; y++) {
        sinY1[y] = Math.sin(freq1 * (y + t2000));
        sinY2[y] = Math.sin(freq2 * (y + t30000));
      }

      // Scale amplitude proportionally with resolution
      const ampScaled = amplitude * (w / 300.0);
      const eff = effectIntensity;

      // 2. Lightning-fast inner pixel loop (pure arithmetic, zero Math.sin)
      for (let y = 0; y < h; y++) {
        const factorY1 = ampScaled * sinY1[y];
        const factorY2 = ampScaled * sinY2[y];
        const rowOffset = y * w;

        for (let x = 0; x < w; x++) {
          const pixelIndex = rowOffset + x;
          const offset = pixelIndex * 4;

          const dx = (sinX1[x] * factorY1) | 0;
          const dy = (sinX2[x] * factorY2) | 0;

          const x2 = x + dx < 0 ? 0 : (x + dx >= w ? w - 1 : x + dx);
          const y2 = y + dy < 0 ? 0 : (y + dy >= h ? h - 1 : y + dy);
          const offset2 = (y2 * w + x2) * 4;

          // Authentic Lerp & Burning Color Extrapolation
          const origR = origData[offset];
          const origG = origData[offset + 1];
          const origB = origData[offset + 2];

          const glitchR = glitchedPixels[offset2];
          const glitchG = glitchedPixels[offset2 + 1];
          const glitchB = glitchedPixels[offset2 + 2];

          // True Color Burning (when eff > 1.0, channels clamp to neon primaries)
          waveData[offset] = origR + (glitchR - origR) * eff;
          waveData[offset + 1] = origG + (glitchG - origG) * eff;
          waveData[offset + 2] = origB + (glitchB - origB) * eff;
          waveData[offset + 3] = origData[offset + 3];
        }
      }

      ctx.putImageData(waveImageData, 0, 0);
    }

    animationRequestId = requestAnimationFrame(animate);
  };

  animate();
}

// 4x crisp export on click
function saveImage() {
  if (!canvas) return;
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = canvas.width * 2;
  exportCanvas.height = canvas.height * 2;
  const exportCtx = exportCanvas.getContext('2d');
  
  exportCtx.imageSmoothingEnabled = false;
  exportCtx.drawImage(canvas, 0, 0, exportCanvas.width, exportCanvas.height);
  
  const link = document.createElement('a');
  link.href = exportCanvas.toDataURL('image/png');
  link.download = 'glitched-image.png';
  link.click();
}

// ==========================================
// 4. Web Audio Harmonic Synth
// ==========================================
let currentPitchValue = -900;
let sourceNode;
let isMuted = false;

function mapValue(value, inputMin, inputMax, outputMin, outputMax) {
  return ((value - inputMin) / (inputMax - inputMin)) * (outputMax - outputMin) + outputMin;
}

const AudioCtx = window.AudioContext || window.webkitAudioContext;
const audioContext = new AudioCtx();
const masterGain = audioContext.createGain();
masterGain.connect(audioContext.destination);
masterGain.gain.value = 0.4;
let originalVolume = masterGain.gain.value;

const delay = audioContext.createDelay();
delay.delayTime.value = 0.3;

const feedback = audioContext.createGain();
feedback.gain.value = 0.05;
delay.connect(feedback);
feedback.connect(delay);
delay.connect(masterGain);

function loadAudio() {
  fetch('./assets/ambient.mp3')
    .then((res) => {
      if (!res.ok) throw new Error('Local audio missing');
      return res.arrayBuffer();
    })
    .catch(() => {
      return fetch('https://cdn.prod.website-files.com/643af806354c783eb866d160/64876f44dcb3488649921a6a_Tuesday%20at%207-01%20PM.mp3.txt').then((r) => r.arrayBuffer());
    })
    .then((data) => audioContext.decodeAudioData(data))
    .then((audioBuffer) => {
      sourceNode = audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.detune.value = currentPitchValue;
      sourceNode.connect(delay);
      sourceNode.loop = true;
      sourceNode.start();
    })
    .catch((err) => console.log(err));
}
loadAudio();

const soundOnSvg = `
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
  </svg>
`;

const soundMutedSvg = `
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
    <line x1="23" y1="9" x2="17" y2="15"></line>
    <line x1="17" y1="9" x2="23" y2="15"></line>
  </svg>
`;

function toggleMute() {
  isMuted = !isMuted;
  if (isMuted) {
    originalVolume = masterGain.gain.value;
    masterGain.gain.value = 0;
    muteBtn.innerHTML = soundMutedSvg;
  } else {
    masterGain.gain.value = originalVolume;
    muteBtn.innerHTML = soundOnSvg;
  }
}

function handleInteraction() {
  if (!isMuted && audioContext.state === 'suspended') {
    audioContext.resume();
  }
}

// ==========================================
// 5. Event Listeners Setup
// ==========================================
function setupEventListeners() {
  new AsciiSlider(amplitudeEl, (val) => {
    amplitude = val;
    currentPitchValue = amplitude;
    const mappedPitch = mapValue(currentPitchValue, -2, 25, -750, 750);
    if (sourceNode) {
      sourceNode.detune.value = mappedPitch;
    }
  }, 16);

  new AsciiSlider(periodEl, (val) => {
    period = val;
    const mappedDelay = mapValue(period, -0.1, 2, 0.01, 1);
    delay.delayTime.value = mappedDelay;
  }, 16);

  new AsciiSlider(effectEl, (val) => {
    effectIntensity = val;
    const mappedFeedback = mapValue(effectIntensity, 0.1, 1.3, 0.01, 0.95);
    feedback.gain.value = mappedFeedback;
  }, 16);

  // Click canvas saves crisp image and re-triggers glitch scatter
  canvas.addEventListener('click', function (e) {
    e.stopPropagation();
    handleInteraction();
    saveImage();
    applyGlitch();
  });

  // Drag & drop custom image
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        loadImage(file);
      }
    }
  });

  muteBtn.addEventListener('click', toggleMute);
  document.body.addEventListener('click', handleInteraction);
  document.body.addEventListener('touchstart', handleInteraction);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && !isMuted && audioContext.state === 'running') {
      audioContext.suspend();
    } else if (document.visibilityState === 'visible' && !isMuted && audioContext.state === 'suspended') {
      audioContext.resume();
    }
  });
}

// Initial Boot
loadImage(defaultImageUrl);
