/**
 * zpennachi
 * High-Performance Hardware-Accelerated WebGL Glitch & Wave Distortion Engine
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
let currentImageSource = null;

// Target high-definition resolution (800x800 for crystal-clear fidelity & 60fps GPU performance)
const TARGET_RESOLUTION = 800;

const defaultImageUrl = './assets/default-image.webp';
const defaultImageFallback = 'https://cdn.prod.website-files.com/643af806354c783eb866d160/645123b173e3c023c2af5543_06_Seeing-the-forest-for-the-trees.webp';

// ==========================================
// 1. WebGL Shader Sources & Engine
// ==========================================
let gl = null;
let program = null;
let origTexture = null;
let glitchTexture = null;
let uniformLocations = {};
let origImageData = null;
let glitchImageData = null;
let imageWidth = 0;
let imageHeight = 0;

const vsSource = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
    v_uv = (a_position + 1.0) * 0.5;
    v_uv.y = 1.0 - v_uv.y; // Flip Y for WebGL texture orientation
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const fsSource = `
  precision highp float;
  uniform sampler2D u_origTex;
  uniform sampler2D u_glitchTex;
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_amplitude;
  uniform float u_period;
  uniform float u_effect;
  varying vec2 v_uv;

  void main() {
    float safePeriod = u_period == 0.0 ? 0.0001 : u_period;
    float freq1 = 6.28318530718 / safePeriod;
    float freq2 = 6.28318530718 / (safePeriod / 1.5);

    vec2 pixelPos = v_uv * u_resolution;
    float x = pixelPos.x;
    float y = pixelPos.y;

    // Scale amplitude relative to base resolution for consistent visual displacement
    float ampScaled = u_amplitude * (u_resolution.x / 300.0);

    float dx = ampScaled * sin(freq1 * (x + u_time / 2000.0)) * sin(freq1 * (y + u_time / 2000.0));
    float dy = ampScaled * sin(freq2 * (x + u_time / 3000.0)) * sin(freq2 * (y + u_time / 30000.0));

    vec2 samplePos = clamp((pixelPos + vec2(dx, dy)) / u_resolution, 0.0, 1.0);

    vec4 origCol = texture2D(u_origTex, v_uv);
    vec4 glitchCol = texture2D(u_glitchTex, samplePos);

    // Dynamic lerp extrapolation for intense rainbow & saturation effects
    vec4 finalCol = origCol + (glitchCol - origCol) * u_effect;

    gl_FragColor = vec4(clamp(finalCol.rgb, 0.0, 1.0), origCol.a);
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

function initWebGL() {
  try {
    gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: true, alpha: false }) ||
         canvas.getContext('experimental-webgl', { preserveDrawingBuffer: true });
  } catch (e) {
    console.warn('WebGL not supported, falling back to 2D canvas', e);
  }

  if (!gl) return false;

  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    return false;
  }

  gl.useProgram(program);

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

  const posAttrLoc = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(posAttrLoc);
  gl.vertexAttribPointer(posAttrLoc, 2, gl.FLOAT, false, 0, 0);

  // Locate Uniforms
  uniformLocations = {
    origTex: gl.getUniformLocation(program, 'u_origTex'),
    glitchTex: gl.getUniformLocation(program, 'u_glitchTex'),
    resolution: gl.getUniformLocation(program, 'u_resolution'),
    time: gl.getUniformLocation(program, 'u_time'),
    amplitude: gl.getUniformLocation(program, 'u_amplitude'),
    period: gl.getUniformLocation(program, 'u_period'),
    effect: gl.getUniformLocation(program, 'u_effect')
  };

  origTexture = gl.createTexture();
  glitchTexture = gl.createTexture();

  return true;
}

const isWebGLReady = initWebGL();

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
// 3. Image Sizing & Glitch Texture Setup
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

function generateGlitchMap(data, w, h) {
  const numPixels = (w * h);
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

function updateTextures() {
  if (!isWebGLReady || !origImageData || !glitchImageData) return;

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
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, imageWidth, imageHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, glitchImageData);
}

async function loadImage(src) {
  if (animationRequestId) {
    cancelAnimationFrame(animationRequestId);
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = function () {
    currentImageSource = img;
    const processed = resizeImageToCanvas(img, TARGET_RESOLUTION);

    imageWidth = processed.width;
    imageHeight = processed.height;
    origImageData = processed.imageData;

    canvas.width = imageWidth;
    canvas.height = imageHeight;

    if (isWebGLReady) {
      gl.viewport(0, 0, imageWidth, imageHeight);
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

function applyGlitch() {
  if (!origImageData) return;

  glitchImageData = generateGlitchMap(origImageData.data, imageWidth, imageHeight);

  if (isWebGLReady) {
    updateTextures();
    startWebGLAnimationLoop();
  } else {
    start2DFallbackAnimationLoop();
  }
}

// ==========================================
// 4. Animation Loops (WebGL 60fps & 2D Fallback)
// ==========================================
function startWebGLAnimationLoop() {
  if (animationRequestId) {
    cancelAnimationFrame(animationRequestId);
  }

  gl.useProgram(program);
  gl.uniform1i(uniformLocations.origTex, 0);
  gl.uniform1i(uniformLocations.glitchTex, 1);
  gl.uniform2f(uniformLocations.resolution, imageWidth, imageHeight);

  const render = (time) => {
    gl.uniform1f(uniformLocations.time, time);
    gl.uniform1f(uniformLocations.amplitude, amplitude);
    gl.uniform1f(uniformLocations.period, period);
    gl.uniform1f(uniformLocations.effect, effectIntensity);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    animationRequestId = requestAnimationFrame(render);
  };

  animationRequestId = requestAnimationFrame(render);
}

function start2DFallbackAnimationLoop() {
  if (animationRequestId) {
    cancelAnimationFrame(animationRequestId);
  }

  const ctx2d = canvas.getContext('2d');
  const numPixels = imageWidth * imageHeight;
  const lerp = (a, b, t) => a + (b - a) * t;
  const waveImageData = new ImageData(new Uint8ClampedArray(glitchImageData), imageWidth, imageHeight);

  let frameCount = 0;
  const animate = () => {
    frameCount++;
    if (frameCount % 2 === 0) {
      const safePeriod = period === 0 ? 0.001 : period;
      const freq1 = (2 * Math.PI) / safePeriod;
      const freq2 = (2 * Math.PI) / (safePeriod / 1.5);
      const now = Date.now();
      const orig = origImageData.data;

      for (let i = 0; i < numPixels; i++) {
        const offset = i * 4;
        const x = i % imageWidth;
        const y = Math.floor(i / imageWidth);
        const dx = Math.round(amplitude * Math.sin(freq1 * (x + now / 2000)) * Math.sin(freq1 * (y + now / 2000)));
        const dy = Math.round(amplitude * Math.sin(freq2 * (x + now / 3000)) * Math.sin(freq2 * (y + now / 30000)));
        const x2 = Math.max(0, Math.min(imageWidth - 1, x + dx));
        const y2 = Math.max(0, Math.min(imageHeight - 1, y + dy));
        const offset2 = (y2 * imageWidth + x2) * 4;

        for (let j = 0; j < 4; j++) {
          waveImageData.data[offset + j] = lerp(orig[offset + j], glitchImageData[offset2 + j], effectIntensity);
        }
      }
      ctx2d.putImageData(waveImageData, 0, 0);
    }
    animationRequestId = requestAnimationFrame(animate);
  };

  animate();
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
