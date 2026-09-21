/**
 * zpennachi
 * Hardware-Accelerated WebGL Engine with Recursive Ping-Pong Feedback & Color Burning
 * Pure ASCII interactive sliders & Harmonic Web Audio Synth
 */

const canvas = document.getElementById('glitchCanvas');
const muteBtn = document.getElementById('mute-btn');

const amplitudeEl = document.getElementById('amplitude-slider');
const periodEl = document.getElementById('period-slider');
const effectEl = document.getElementById('effect-slider');

let amplitude = parseFloat(amplitudeEl.dataset.val);
let period = parseFloat(periodEl.dataset.val);
let effectIntensity = parseFloat(effectEl.dataset.val);

let animationRequestId = null;
let eventListenersInitialized = false;

const TARGET_RESOLUTION = 800;

const defaultImageUrl = './assets/default-image.webp';
const defaultImageFallback = 'https://cdn.prod.website-files.com/643af806354c783eb866d160/645123b173e3c023c2af5543_06_Seeing-the-forest-for-the-trees.webp';

// ==========================================
// 1. WebGL Setup with Ping-Pong FBO Feedback
// ==========================================
let gl = null;
let mainProgram = null;
let copyProgram = null;

let origTexture = null;
let glitchTexture = null;

let fboA = null, fboB = null;
let fboTexA = null, fboTexB = null;

let uniformLocs = {};
let origImageData = null;
let imageWidth = 0;
let imageHeight = 0;

const vsSource = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
    v_uv = (a_position + 1.0) * 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

// Main Feedback & Distortion Shader
const fsSource = `
  precision highp float;
  uniform sampler2D u_prevTex;
  uniform sampler2D u_origTex;
  uniform sampler2D u_glitchTex;
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_amplitude;
  uniform float u_period;
  uniform float u_effect;
  uniform int u_isFirstFrame;
  varying vec2 v_uv;

  void main() {
    float safePeriod = u_period == 0.0 ? 0.0001 : u_period;
    float freq1 = 6.28318530718 / safePeriod;
    float freq2 = 6.28318530718 / (safePeriod / 1.5);

    vec2 pixelPos = v_uv * u_resolution;
    float x = pixelPos.x;
    float y = pixelPos.y;

    float ampScaled = u_amplitude * (u_resolution.x / 300.0);

    // Chromatic RGB wave phase separation
    float phaseR = 1.5;
    float phaseB = -1.5;

    float dxR = ampScaled * sin(freq1 * (x + phaseR + u_time / 2000.0)) * sin(freq1 * (y + phaseR + u_time / 2000.0));
    float dyR = ampScaled * sin(freq2 * (x + phaseR + u_time / 3000.0)) * sin(freq2 * (y + phaseR + u_time / 30000.0));

    float dxG = ampScaled * sin(freq1 * (x + u_time / 2000.0)) * sin(freq1 * (y + u_time / 2000.0));
    float dyG = ampScaled * sin(freq2 * (x + u_time / 3000.0)) * sin(freq2 * (y + u_time / 30000.0));

    float dxB = ampScaled * sin(freq1 * (x + phaseB + u_time / 2000.0)) * sin(freq1 * (y + phaseB + u_time / 2000.0));
    float dyB = ampScaled * sin(freq2 * (x + phaseB + u_time / 3000.0)) * sin(freq2 * (y + phaseB + u_time / 30000.0));

    vec2 uvR = clamp((pixelPos + vec2(dxR, dyR)) / u_resolution, 0.0, 1.0);
    vec2 uvG = clamp((pixelPos + vec2(dxG, dyG)) / u_resolution, 0.0, 1.0);
    vec2 uvB = clamp((pixelPos + vec2(dxB, dyB)) / u_resolution, 0.0, 1.0);

    vec4 origCol = texture2D(u_origTex, v_uv);
    
    // Sample glitch noise texture with chromatic split
    vec4 glitchCol = vec4(
      texture2D(u_glitchTex, uvR).r,
      texture2D(u_glitchTex, uvG).g,
      texture2D(u_glitchTex, uvB).b,
      origCol.a
    );

    // Sample previous frame recursive feedback buffer
    vec4 prevCol = vec4(
      texture2D(u_prevTex, uvR).r,
      texture2D(u_prevTex, uvG).g,
      texture2D(u_prevTex, uvB).b,
      1.0
    );

    if (u_isFirstFrame == 1) {
      prevCol = origCol;
    }

    // 100% Burning Feedback Equations:
    // When u_effect is turned all the way up (0.8 -> 1.3), feedback loop explodes into neon burning colors
    float glitchBlend = u_effect;
    vec3 waveCol = origCol.rgb + (glitchCol.rgb - origCol.rgb) * glitchBlend;

    // Recursive feedback intensity
    float feedbackAmount = clamp((u_effect - 0.1) / 1.2, 0.0, 0.94);
    vec3 mixedCol = mix(waveCol, prevCol.rgb, feedbackAmount);

    // Color burning and contrast expansion when effect is turned high
    if (u_effect > 0.7) {
      float burn = (u_effect - 0.7) / 0.6; // 0.0 to 1.0
      // Color channel saturation bloom
      mixedCol = (mixedCol - 0.5) * (1.0 + burn * 1.8) + 0.5;
      mixedCol.r += (dxR - dxG) * 0.008 * burn;
      mixedCol.g += (dyG - dyB) * 0.008 * burn;
      mixedCol.b += (dxB - dxR) * 0.008 * burn;
    }

    gl_FragColor = vec4(clamp(mixedCol, 0.0, 1.0), origCol.a);
  }
`;

// Simple Screen Passthrough Shader (flips Y for canvas display)
const copyFsSource = `
  precision highp float;
  uniform sampler2D u_texture;
  varying vec2 v_uv;
  void main() {
    gl_FragColor = texture2D(u_texture, vec2(v_uv.x, 1.0 - v_uv.y));
  }
`;

function createShader(glCtx, type, source) {
  const shader = glCtx.createShader(type);
  glCtx.shaderSource(shader, source);
  glCtx.compileShader(shader);
  if (!glCtx.getShaderParameter(shader, glCtx.COMPILE_STATUS)) {
    console.error('Shader compile error:', glCtx.getShaderInfoLog(shader));
    glCtx.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(glCtx, vs, fs) {
  const p = glCtx.createProgram();
  glCtx.attachShader(p, vs);
  glCtx.attachShader(p, fs);
  glCtx.linkProgram(p);
  if (!glCtx.getProgramParameter(p, glCtx.LINK_STATUS)) {
    console.error('Program link error:', glCtx.getProgramInfoLog(p));
    return null;
  }
  return p;
}

function initWebGL() {
  try {
    gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false, alpha: false }) ||
         canvas.getContext('experimental-webgl', { preserveDrawingBuffer: true });
  } catch (e) {
    console.warn('WebGL not available', e);
  }

  if (!gl) return false;

  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const copyFs = createShader(gl, gl.FRAGMENT_SHADER, copyFsSource);

  mainProgram = createProgram(gl, vs, fs);
  copyProgram = createProgram(gl, vs, copyFs);

  // Full-screen Quad Buffer
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
    -1,  1,
     1, -1,
     1,  1,
  ]), gl.STATIC_DRAW);

  // Locate Uniforms for Main Program
  uniformLocs = {
    prevTex: gl.getUniformLocation(mainProgram, 'u_prevTex'),
    origTex: gl.getUniformLocation(mainProgram, 'u_origTex'),
    glitchTex: gl.getUniformLocation(mainProgram, 'u_glitchTex'),
    resolution: gl.getUniformLocation(mainProgram, 'u_resolution'),
    time: gl.getUniformLocation(mainProgram, 'u_time'),
    amplitude: gl.getUniformLocation(mainProgram, 'u_amplitude'),
    period: gl.getUniformLocation(mainProgram, 'u_period'),
    effect: gl.getUniformLocation(mainProgram, 'u_effect'),
    isFirstFrame: gl.getUniformLocation(mainProgram, 'u_isFirstFrame')
  };

  origTexture = gl.createTexture();
  glitchTexture = gl.createTexture();

  return true;
}

const isWebGLReady = initWebGL();

// Create FBO texture helper
function createFBO(width, height) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

  return { fb, tex };
}

// ==========================================
// 2. Interactive ASCII Slider Component
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
// 3. Image Sizing & Glitch Setup
// ==========================================
function resizeImageToCanvas(image, maxSize = TARGET_RESOLUTION) {
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

  return {
    canvas: offCanvas,
    ctx: offCtx,
    imageData: offCtx.getImageData(0, 0, width, height),
    width,
    height
  };
}

// Byte-offset wrapping noise map that reproduces the exact color artifacts
function generateGlitchMap(data, w, h) {
  const numPixels = w * h;
  const glitchedPixels = new Uint8ClampedArray(data.length);
  const scale = w / 300.0;

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

  return glitchedPixels;
}

function updateTextures(glitchData) {
  if (!isWebGLReady || !origImageData || !glitchData) return;

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, origTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, imageWidth, imageHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, origImageData.data);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, glitchTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, imageWidth, imageHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, glitchData);
}

async function loadImage(src) {
  if (animationRequestId) {
    cancelAnimationFrame(animationRequestId);
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = function () {
    const processed = resizeImageToCanvas(img, TARGET_RESOLUTION);

    imageWidth = processed.width;
    imageHeight = processed.height;
    origImageData = processed.imageData;

    canvas.width = imageWidth;
    canvas.height = imageHeight;

    if (isWebGLReady) {
      gl.viewport(0, 0, imageWidth, imageHeight);
      // Initialize Ping-Pong FBOs
      const f1 = createFBO(imageWidth, imageHeight);
      fboA = f1.fb;
      fboTexA = f1.tex;

      const f2 = createFBO(imageWidth, imageHeight);
      fboB = f2.fb;
      fboTexB = f2.tex;
    }

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

let isFirstFrame = 1;

function applyGlitch() {
  if (!origImageData) return;

  const glitchData = generateGlitchMap(origImageData.data, imageWidth, imageHeight);
  isFirstFrame = 1;

  if (isWebGLReady) {
    updateTextures(glitchData);
    startPingPongLoop();
  }
}

// ==========================================
// 4. Ping-Pong Feedback Loop (60 FPS GPU)
// ==========================================
function startPingPongLoop() {
  if (animationRequestId) {
    cancelAnimationFrame(animationRequestId);
  }

  let readFBO = { fb: fboA, tex: fboTexA };
  let writeFBO = { fb: fboB, tex: fboTexB };

  const render = (time) => {
    // 1. Pass 1: Render into writeFBO, sampling readFBO (previous frame)
    gl.bindFramebuffer(gl.FRAMEBUFFER, writeFBO.fb);
    gl.viewport(0, 0, imageWidth, imageHeight);
    gl.useProgram(mainProgram);

    // Bind Previous Frame Texture
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, readFBO.tex);
    gl.uniform1i(uniformLocs.prevTex, 2);

    // Bind Original Image Texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, origTexture);
    gl.uniform1i(uniformLocs.origTex, 0);

    // Bind Glitch Noise Texture
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, glitchTexture);
    gl.uniform1i(uniformLocs.glitchTex, 1);

    gl.uniform2f(uniformLocs.resolution, imageWidth, imageHeight);
    gl.uniform1f(uniformLocs.time, time);
    gl.uniform1f(uniformLocs.amplitude, amplitude);
    gl.uniform1f(uniformLocs.period, period);
    gl.uniform1f(uniformLocs.effect, effectIntensity);
    gl.uniform1i(uniformLocs.isFirstFrame, isFirstFrame);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (isFirstFrame === 1) isFirstFrame = 0;

    // 2. Pass 2: Render writeFBO to Canvas Screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, imageWidth, imageHeight);
    gl.useProgram(copyProgram);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, writeFBO.tex);
    const copyTexLoc = gl.getUniformLocation(copyProgram, 'u_texture');
    gl.uniform1i(copyTexLoc, 3);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 3. Swap Ping-Pong Buffers for recursive feedback on next frame
    const temp = readFBO;
    readFBO = writeFBO;
    writeFBO = temp;

    animationRequestId = requestAnimationFrame(render);
  };

  animationRequestId = requestAnimationFrame(render);
}

// Crisp High-Resolution Export
function saveImage() {
  if (!canvas) return;
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = 'glitched-image.png';
  link.click();
}

// ==========================================
// 5. Web Audio Harmonic Synth
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
// 6. Event Listeners Setup
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
