/**
 * zpennachi
 * Exact 100% Verbatim Original Webflow Glitch Code
 */

const canvas = document.getElementById('glitchCanvas');
const ctx = canvas.getContext('2d');
const muteBtn = document.getElementById('mute-btn');

const amplitudeEl = document.getElementById('amplitude-slider');
const periodEl = document.getElementById('period-slider');
const effectEl = document.getElementById('effect-slider');

let amplitude = parseFloat(amplitudeEl.dataset.val);
let period = parseFloat(periodEl.dataset.val);
let effectIntensity = parseFloat(effectEl.dataset.val);

let imageData;
let eventListenersInitialized = false;
let animationRequestId;

const defaultImageUrl = './assets/default-image.webp';
const defaultImageFallback = 'https://cdn.prod.website-files.com/643af806354c783eb866d160/645123b173e3c023c2af5543_06_Seeing-the-forest-for-the-trees.webp';

// ==========================================
// Interactive ASCII Slider Component
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
// Exact Original Webflow Image Processing & Glitch Math
// ==========================================
function resizeImage(image, maxWidth, maxHeight, useMaxSize = true) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    let width = image.width;
    let height = image.height;

    if (useMaxSize) {
      const aspectRatio = width / height;
      if (width > maxWidth || height > maxHeight) {
        if (width > maxWidth) {
          width = maxWidth;
          height = width / aspectRatio;
        }
        if (height > maxHeight) {
          height = maxHeight;
          width = height * aspectRatio;
        }
      }
    }

    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(image, 0, 0, width, height);
    const resizedImage = new Image();
    resizedImage.onload = () => resolve(resizedImage);
    resizedImage.src = canvas.toDataURL();
  });
}

async function loadImage(src, useMaxSize = true) {
  if (animationRequestId) {
    cancelAnimationFrame(animationRequestId);
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = async function () {
    const maxWidth = useMaxSize ? 300 : img.width * 0.5;
    const maxHeight = useMaxSize ? 300 : img.height * 0.5;
    const resizedImg = await resizeImage(img, maxWidth, maxHeight);
    canvas.width = resizedImg.width;
    canvas.height = resizedImg.height;
    ctx.drawImage(resizedImg, 0, 0);
    imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    if (!eventListenersInitialized) {
      setupEventListeners();
      eventListenersInitialized = true;
    }

    triggerSort();
  };

  img.onerror = function () {
    if (src === defaultImageUrl) {
      loadImage(defaultImageFallback, useMaxSize);
    }
  };

  if (src instanceof File) {
    img.src = URL.createObjectURL(src);
  } else {
    img.src = src;
  }
}

function triggerSort() {
  if (!imageData) {
    return;
  }

  const data = imageData.data;
  const numPixels = data.length / 4;

  const lerp = (a, b, t) => a + (b - a) * t;

  const glitchedPixels = new Uint8ClampedArray(data);
  for (let i = 0; i < numPixels; i++) {
    const offset = i * 4;
    const x = (i % canvas.width) + 15 * (Math.random() - 0.5);
    const y = Math.floor(i / canvas.width) + 3 * (Math.random() - 0.5);
    const offset2 = (Math.floor(y) * canvas.width + Math.floor(x)) * 4;
    glitchedPixels[offset] = data[offset2];
    glitchedPixels[offset + 1] = data[offset2 + 1];
    glitchedPixels[offset + 2] = data[offset2 + 2];
    glitchedPixels[offset + 3] = data[offset2 + 3];
  }

  const waveImageData = new ImageData(glitchedPixels, canvas.width, canvas.height);

  if (animationRequestId) {
    cancelAnimationFrame(animationRequestId);
  }

  let frameCount = 0;
  const animate = () => {
    frameCount++;
    if (frameCount % 4 === 0) {
      const freq1 = 2 * Math.PI / period;
      const freq2 = 2 * Math.PI / (period / 1.5);
      for (let i = 0; i < numPixels; i++) {
        const offset = i * 4;
        const x = i % canvas.width;
        const y = Math.floor(i / canvas.width);
        const dx = Math.round(amplitude * Math.sin(freq1 * (x + (Date.now() / 2000))) * Math.sin(freq1 * (y + (Date.now() / 2000))));
        const dy = Math.round(amplitude * Math.sin(freq2 * (x + (Date.now() / 3000))) * Math.sin(freq2 * (y + (Date.now() / 30000))));
        const x2 = Math.max(0, Math.min(canvas.width - 1, x + dx));
        const y2 = Math.max(0, Math.min(canvas.height - 1, y + dy));
        const offset2 = (y2 * canvas.width + x2) * 4;

        for (let j = 0; j < 4; j++) {
          waveImageData.data[offset + j] = lerp(imageData.data[offset + j], glitchedPixels[offset2 + j], effectIntensity);
        }
      }
      ctx.putImageData(waveImageData, 0, 0);
    }
    animationRequestId = requestAnimationFrame(animate);
  };

  animate();
}

function saveImage() {
  if (!canvas) return;
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = 1920;
  exportCanvas.height = 1080;
  const exportCtx = exportCanvas.getContext('2d');
  exportCtx.drawImage(canvas, 0, 0, exportCanvas.width, exportCanvas.height);
  const link = document.createElement('a');
  link.href = exportCanvas.toDataURL('image/png');
  link.download = 'glitched-image.png';
  link.click();
}

// ==========================================
// Web Audio Synth
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
// Event Listeners
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

  // Clicking canvas re-triggers the sort glitch and saves image
  canvas.addEventListener('click', function (e) {
    e.stopPropagation();
    handleInteraction();
    saveImage();
    triggerSort();
  });

  // Drag & drop custom image
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        loadImage(file, true);
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
loadImage(defaultImageUrl, true);
