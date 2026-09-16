# Glitch Art Playground

A lightweight, standalone recreation of the interactive glitch art canvas and generative synth engine. Built entirely with vanilla HTML5, CSS3, and JavaScript—completely free from Webflow, jQuery, or third-party runtime dependencies.

## Features
- **Centered Canvas Display**: Clean, responsive viewport presentation that preserves aspect ratio instead of stretching full screen.
- **Dynamic Wave Glitch Engine**: Real-time pixel distortion using sinusoidal wave algorithms and random pixel displacement.
- **Harmonic Web Audio Engine**: Interactive sound generator modulating pitch, delay time, and feedback loop gain connected directly to the sliders.
- **Transparent Navbar**: Sleek, minimalist navigation without background blocks.
- **Custom Image Upload**: Load any JPG, PNG, or WebP image to glitch in real time.
- **Souvenir Export**: One-click high-resolution PNG export (`1920x1080`).
- **Completely Self-Contained**: Local assets included in `/assets/` with automatic CDN fallback.

## Project Structure
```
glitch-playground/
├── index.html        # Clean semantic markup
├── style.css         # Modern flexbox layout & custom range sliders
├── main.js           # Glitch canvas loop & Web Audio synth engine
├── assets/
│   ├── default-image.webp
│   └── ambient.mp3
└── README.md
```

## Running Locally
You can run this project with any local HTTP server (required for Web Audio and Canvas cross-origin operations):

### Using Python:
```bash
python -m http.server 8000
```
Then visit `http://localhost:8000`.

### Using Node.js (npx serve):
```bash
npx serve .
```

### Using VS Code / Antigravity:
Right click `index.html` and choose **Open with Live Server**.
