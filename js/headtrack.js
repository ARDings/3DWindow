/**
 * Head Tracking 3D - "Window Into Box" Effect
 * Uses MediaPipe Face Detection + Three.js
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// DOM Elements
const video = document.getElementById('camera-feed');
const faceCanvas = document.getElementById('face-canvas');
const threeCanvas = document.getElementById('three-canvas');
const loadingOverlay = document.getElementById('loading-overlay');
const permissionOverlay = document.getElementById('permission-overlay');
const startBtn = document.getElementById('start-btn');
const instructions = document.getElementById('instructions');
const fpsCounter = document.getElementById('fps-counter');
const controlsPanel = document.getElementById('sensitivity-controls');

// FPS tracking
let frameCount = 0;
let lastFpsUpdate = performance.now();
let currentFps = 0;

// Face Detection
let faceDetection;
let camera;
const faceCtx = faceCanvas.getContext('2d');

// Three.js
let scene, threeCamera, renderer;
let targetX = 0, targetY = 0;
let currentX = 0, currentY = 0;

// Settings
let smoothingAmount = 0.15;  // Lower = smoother
let parallaxStrength = 0.20; // Effect strength multiplier

// Box dimensions
const BOX_DEPTH = 100;      // Deep tunnel
const GRID_DIVISIONS = 40;  // Grid line density

// Off-axis projection constants
const nearClip = 0.1;
const farClip = 1000;

// Scene objects
let boxGroup;
let worldGroup; // Group for everything to flip it
let model; // The GLB Model
let modelZ = 1.0; // Default Z position
let modelBaseScale = 1.0; // Logical scale to fit screen
let modelUserScale = 1.0; // User adjusted scale
let modelOffsetX = 0.10; // User X offset
let modelOffsetY = 0.0; // User Y offset
let modelOffsetZ = 1.50; // User Z offset

// Frame settings
let frameWidth = 0.0;
let frameColor = '#a855f7'; // Purple default for visibility
let frameGroup; // Holds the 4 sides of the frame
let instructionsMesh; // 3D Text Mesh

/**
 * Initialize the application
 */
init();

async function init() {
    setupControls();
    setupKeyboardEvents();
    setupFileUpload();

    // Show permission overlay first
    loadingOverlay.classList.add('hidden');
    permissionOverlay.style.display = 'flex';

    startBtn.addEventListener('click', async () => {
        permissionOverlay.style.display = 'none';
        loadingOverlay.classList.remove('hidden');
        loadingOverlay.querySelector('.loading-text').textContent = 'Initializing Camera...';

        try {
            await initCamera();
            loadingOverlay.querySelector('.loading-text').textContent = 'Loading Face Detection...';
            // Face Detection is still global/script-tag based
            await initFaceDetection();
            initThreeJS();

            loadingOverlay.classList.add('hidden');
            // instructions.style.display = 'block'; // Moved to 3D
            controlsPanel.style.display = 'flex';

            animate();
        } catch (error) {
            console.error('Initialization error:', error);
            loadingOverlay.querySelector('.loading-text').textContent = 'Error: ' + error.message;
        }
    });
}

/**
 * Setup File Upload
 */
function setupFileUpload() {
    const fileInput = document.getElementById('model-upload');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const url = URL.createObjectURL(file);
                loadModel(url);
            }
        });
    }
}

/**
 * Setup Keyboard Events (Toggle Controls)
 */
function setupKeyboardEvents() {
    window.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'k') {
            const visitorCounter = document.querySelector('.visitor-counter');
            const cameraContainer = document.querySelector('.camera-container');
            const repoLink = document.querySelector('.repo-link');

            if (controlsPanel.style.display === 'none') {
                controlsPanel.style.display = 'flex';
                if (instructionsMesh) instructionsMesh.visible = true;
                if (visitorCounter) visitorCounter.style.display = 'flex';
                if (cameraContainer) cameraContainer.style.display = 'block';
                if (repoLink) repoLink.style.display = 'block';
            } else {
                controlsPanel.style.display = 'none';
                if (instructionsMesh) instructionsMesh.visible = false;
                if (visitorCounter) visitorCounter.style.display = 'none';
                if (cameraContainer) cameraContainer.style.display = 'none';
                if (repoLink) repoLink.style.display = 'none';
            }
        }
    });
}

/**
 * Setup UI controls
 */
function setupControls() {
    // Float control helper
    const setupFloatControl = (valueId, minusId, plusId, initialValue, setter, step = 0.05, min = 0.01, max = 5.0) => {
        const valEl = document.getElementById(valueId);
        const minBtn = document.getElementById(minusId);
        const plusBtn = document.getElementById(plusId);

        if (valEl && minBtn && plusBtn) {
            valEl.textContent = initialValue.toFixed(2);

            minBtn.addEventListener('click', () => {
                let newVal = parseFloat(valEl.textContent) - step;
                newVal = Math.max(min, Math.min(max, newVal));
                setter(newVal);
                valEl.textContent = newVal.toFixed(2);
            });

            plusBtn.addEventListener('click', () => {
                let newVal = parseFloat(valEl.textContent) + step;
                newVal = Math.max(min, Math.min(max, newVal));
                setter(newVal);
                valEl.textContent = newVal.toFixed(2);
            });
        }
    };

    // Strength Control (0.1 - 2.0)
    setupFloatControl('strength-value', 'strength-minus', 'strength-plus', parallaxStrength, (val) => {
        parallaxStrength = val;
    }, 0.05, 0.1, 2.0);

    // Smoothing Control (0.01 - 0.50)
    setupFloatControl('smoothing-value', 'smoothing-minus', 'smoothing-plus', smoothingAmount, (val) => {
        smoothingAmount = val;
    }, 0.01, 0.01, 0.50);

    // Scale Control (0.1 - 5.0)
    setupFloatControl('scale-value', 'scale-minus', 'scale-plus', modelUserScale, (val) => {
        modelUserScale = val;
        updateModelTransform();
    }, 0.1, 0.1, 5.0);

    // Position X Control (-5.0 to 5.0)
    setupFloatControl('pos-x-value', 'pos-x-minus', 'pos-x-plus', modelOffsetX, (val) => {
        modelOffsetX = val;
        updateModelTransform();
    }, 0.1, -5.0, 5.0);

    // Position Y Control (-5.0 to 5.0)
    setupFloatControl('pos-y-value', 'pos-y-minus', 'pos-y-plus', modelOffsetY, (val) => {
        modelOffsetY = val;
        updateModelTransform();
    }, 0.1, -5.0, 5.0);

    // Position Z Control (-5.0 to 5.0)
    setupFloatControl('pos-z-value', 'pos-z-minus', 'pos-z-plus', modelOffsetZ, (val) => {
        modelOffsetZ = val;
        updateModelTransform();
    }, 0.1, -10.0, 5.0);

    // Frame Width Control (0.0 to 2.0)
    setupFloatControl('frame-w-value', 'frame-w-minus', 'frame-w-plus', frameWidth, (val) => {
        frameWidth = val;
        updateFrame();
    }, 0.05, 0.0, 2.0);

    // Frame Color Control
    const colorPicker = document.getElementById('frame-color');
    if (colorPicker) {
        colorPicker.value = frameColor;
        colorPicker.addEventListener('input', (e) => {
            frameColor = e.target.value;
            updateFrame();
        });
    }
}

/**
 * Create or Update the Frame (Rand)
 */
function updateFrame() {
    // If no box created yet, we can't size the frame
    if (!boxGroup || !worldGroup) return;

    if (!frameGroup) {
        frameGroup = new THREE.Group();
        worldGroup.add(frameGroup); // Attach to world so it stays with the box
    }

    // Clear old frame
    while (frameGroup.children.length > 0) {
        const child = frameGroup.children[0];
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
        frameGroup.remove(child);
    }

    console.log('Update Frame:', frameWidth, frameColor);

    if (frameWidth <= 0.001) return; // Hidden

    const { halfWidth, halfHeight } = boxGroup.userData;
    const mat = new THREE.MeshBasicMaterial({ color: frameColor, side: THREE.DoubleSide });

    // Z-Offset to prevent Z-fighting and ensure visibility
    const zPos = 0.02;

    // We create 4 planes growing INWARDS from the edge
    // 1. Top
    const topGeo = new THREE.PlaneGeometry(halfWidth * 2, frameWidth);
    const topMesh = new THREE.Mesh(topGeo, mat);
    topMesh.position.set(0, halfHeight - frameWidth / 2, zPos);
    frameGroup.add(topMesh);

    // 2. Bottom
    const botGeo = new THREE.PlaneGeometry(halfWidth * 2, frameWidth);
    const botMesh = new THREE.Mesh(botGeo, mat);
    botMesh.position.set(0, -halfHeight + frameWidth / 2, zPos);
    frameGroup.add(botMesh);

    // 3. Left
    const sideHeight = (halfHeight * 2) - (2 * frameWidth);
    const leftGeo = new THREE.PlaneGeometry(frameWidth, sideHeight);
    const leftMesh = new THREE.Mesh(leftGeo, mat);
    leftMesh.position.set(-halfWidth + frameWidth / 2, 0, zPos);
    frameGroup.add(leftMesh);

    // 4. Right
    const rightGeo = new THREE.PlaneGeometry(frameWidth, sideHeight);
    const rightMesh = new THREE.Mesh(rightGeo, mat);
    rightMesh.position.set(halfWidth - frameWidth / 2, 0, zPos);
    frameGroup.add(rightMesh);
}

/**
 * Update Model Transform (Scale & Position)
 */
function updateModelTransform() {
    if (!model) return;
    const s = modelBaseScale * modelUserScale;
    model.scale.set(s, s, s);

    // Apply position offsets
    // Note: World is rotated 180 deg, so X and Y axes are inverted relative to screen
    // We invert the applied values so (+) button moves object Right/Up on screen
    model.position.x = -modelOffsetX;

    // Y is updated in animate() to combine with floating effect

    // Z is Depth. 0 is center. worldGroup is rotated 180 Y? No 180 Z.
    // So Z axis is NOT inverted regarding Back/Front? 
    // Normal ThreeJS: -Z is into screen (Far), +Z is out (Near).
    // Rotate Z 180 changes X and Y. Z direction stays same relative to camera?
    // Let's test. If User wants "Forward", they usually mean Closer.
    // If I press (+), I expect it to come closer (+Z).
    // Let's just add it.
    model.position.z = modelZ + modelOffsetZ;
}

/**
 * Initialize camera stream
 */
async function initCamera() {
    const constraints = [
        { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } },
        { video: { facingMode: 'user' } },
        { video: true }
    ];

    let stream = null;
    let error = null;

    for (const constraint of constraints) {
        try {
            stream = await navigator.mediaDevices.getUserMedia(constraint);
            break;
        } catch (e) {
            error = e;
        }
    }

    if (!stream) throw error || new Error('Could not access camera');

    video.srcObject = stream;
    video.play().catch(e => console.log('Autoplay prevented:', e));

    await new Promise(resolve => video.onloadedmetadata = resolve);

    faceCanvas.width = video.videoWidth;
    faceCanvas.height = video.videoHeight;
}

/**
 * Initialize MediaPipe Face Detection
 */
async function initFaceDetection() {
    // Global FaceDetection object from script tag
    faceDetection = new FaceDetection({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`
    });

    faceDetection.setOptions({
        model: 'short',
        minDetectionConfidence: 0.5
    });

    faceDetection.onResults(onFaceResults);

    camera = new Camera(video, {
        onFrame: async () => {
            await faceDetection.send({ image: video });
        },
        width: 1280,
        height: 720
    });

    await camera.start();
}

/**
 * Handle face detection results
 */
function onFaceResults(results) {
    faceCtx.clearRect(0, 0, faceCanvas.width, faceCanvas.height);

    if (results.detections.length > 0) {
        const detection = results.detections[0];
        const bbox = detection.boundingBox;

        // Convert to -1 to 1 range (center = 0)
        // X is inverted because camera is mirrored
        targetX = (bbox.xCenter - 0.5) * 2;
        targetY = (bbox.yCenter - 0.5) * 2;

        drawFaceIndicator(bbox);
    }
}

/**
 * Draw simple face detection indicator
 */
function drawFaceIndicator(bbox) {
    const w = faceCanvas.width;
    const h = faceCanvas.height;

    const x = bbox.xCenter * w - (bbox.width * w / 2);
    const y = bbox.yCenter * h - (bbox.height * h / 2);
    const width = bbox.width * w;
    const height = bbox.height * h;

    faceCtx.strokeStyle = '#a855f7';
    faceCtx.lineWidth = 2;
    faceCtx.strokeRect(x, y, width, height);
}

/**
 * Initialize Three.js scene
 */
function initThreeJS() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    scene.fog = new THREE.Fog(0x000000, 10, 60);

    // Camera
    const aspect = window.innerWidth / window.innerHeight;
    threeCamera = new THREE.PerspectiveCamera(50, aspect, nearClip, farClip);
    threeCamera.position.set(0, 0, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({
        canvas: threeCanvas,
        antialias: true,
        alpha: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(2, 3, 4);
    scene.add(directionalLight);

    // Fill light
    const pLight = new THREE.PointLight(0xa855f7, 2, 20);
    pLight.position.set(0, -2, 0);
    scene.add(pLight);

    // World Group (to flip everything)
    worldGroup = new THREE.Group();
    // Rotate 180 degrees on Z to fix "upside down" issue
    worldGroup.rotation.z = Math.PI;
    scene.add(worldGroup);

    // Create the box
    createBox();

    // Load Default Model
    loadModel('assets/GLB/water_splash_spiral.glb');

    window.addEventListener('resize', onWindowResize);
}

/**
 * Load GLB Model
 */
function loadModel(url) {
    const loader = new GLTFLoader();

    loader.load(url, (gltf) => {
        // Remove old model if exists
        if (model) {
            worldGroup.remove(model);

            // Optional: Dispose geometry/materials to free memory
            model.traverse((child) => {
                if (child.isMesh) {
                    child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                        else child.material.dispose();
                    }
                }
            });
        }

        model = gltf.scene;

        // Normalize size
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        // Base scale to fit ~1.5 units
        if (maxDim > 0) {
            modelBaseScale = 1.5 / maxDim;
        } else {
            modelBaseScale = 1.0;
        }

        updateModelTransform();

        // Add to worldGroup
        worldGroup.add(model);
        console.log('Model loaded:', url);

    }, undefined, (error) => {
        console.error('An error occurred loading the model:', error);
        alert('Fehler beim Laden (CORS?). Nutze einen lokalen Server!');
    });
}

/**
 * Create the 5-sided box
 */
function createBox() {
    boxGroup = new THREE.Group();
    boxGroup.name = 'box';

    const aspect = 1920 / 1080;
    const BASE_SIZE = 4;
    const halfWidth = BASE_SIZE * aspect / 2;
    const halfHeight = BASE_SIZE / 2;

    const gridMaterial = new THREE.LineBasicMaterial({
        color: 0x6366f1, opacity: 0.5, transparent: true
    });
    const edgeMaterial = new THREE.LineBasicMaterial({
        color: 0xa855f7, opacity: 0.8, transparent: true
    });

    function createGridPlane(width, height, divisionsW, divisionsH) {
        const geometry = new THREE.BufferGeometry();
        const points = [];
        for (let i = 0; i <= divisionsH; i++) {
            const y = (i / divisionsH - 0.5) * height;
            points.push(-width / 2, y, 0, width / 2, y, 0);
        }
        for (let i = 0; i <= divisionsW; i++) {
            const x = (i / divisionsW - 0.5) * width;
            points.push(x, -height / 2, 0, x, height / 2, 0);
        }
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
        return new THREE.LineSegments(geometry, gridMaterial.clone());
    }

    // Walls
    const leftW = createGridPlane(BOX_DEPTH, halfHeight * 2, GRID_DIVISIONS, 10);
    leftW.rotation.y = Math.PI / 2; leftW.position.set(-halfWidth, 0, -BOX_DEPTH / 2);
    boxGroup.add(leftW);

    const rightW = createGridPlane(BOX_DEPTH, halfHeight * 2, GRID_DIVISIONS, 10);
    rightW.rotation.y = -Math.PI / 2; rightW.position.set(halfWidth, 0, -BOX_DEPTH / 2);
    boxGroup.add(rightW);

    const floor = createGridPlane(halfWidth * 2, BOX_DEPTH, 10, GRID_DIVISIONS);
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, -halfHeight, -BOX_DEPTH / 2);
    boxGroup.add(floor);

    const ceil = createGridPlane(halfWidth * 2, BOX_DEPTH, 10, GRID_DIVISIONS);
    ceil.rotation.x = Math.PI / 2; ceil.position.set(0, halfHeight, -BOX_DEPTH / 2);
    boxGroup.add(ceil);

    const back = createGridPlane(halfWidth * 2, halfHeight * 2, 10, 10);
    back.position.z = -BOX_DEPTH;
    boxGroup.add(back);

    worldGroup.add(boxGroup);
    boxGroup.userData = { halfWidth, halfHeight };

    updateFrame(); // Initialize frame
    createInstructions(); // Add 3D text
}

/**
 * Create 3D Instructions at Z=0
 */
function createInstructions() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 4096; // Huge width to prevent clipping
    canvas.height = 512;

    // Draw Text
    ctx.fillStyle = 'rgba(0,0,0,0)'; // Transparent details
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear

    ctx.font = 'bold 50px Inter, sans-serif'; // Slightly larger font for better quality
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Shadow
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    const text1 = "Move your head left, right, up, down to see the 3D box effect.";
    const text2 = "Press 'K' to toggle controls.";

    ctx.fillText(text1, canvas.width / 2, canvas.height / 2 - 40);
    ctx.fillText(text2, canvas.width / 2, canvas.height / 2 + 40);

    const texture = new THREE.CanvasTexture(canvas);
    // texture.minFilter = THREE.LinearFilter; // Fix possible resizing artifacts? No defaults are usually ok for this size.

    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide
    });

    // Aspect ratio of canvas
    const aspect = canvas.width / canvas.height;
    const height = 0.5; // World units height (reduced from 1.0)
    const width = height * aspect;

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);

    // Position at Top Center Z=0
    // Box Top is at boxGroup.userData.halfHeight
    const { halfHeight } = boxGroup.userData;

    // Position slightly below top edge
    mesh.position.set(0, halfHeight - 0.8, 0); // Z=0

    // Fix mirroring: Scale X = -1
    mesh.scale.x = -1;

    // It should be part of worldGroup so it rotates with it
    worldGroup.add(mesh);
    instructionsMesh = mesh; // Store for toggling
}

/**
 * Update off-axis projection matrix
 */
function updateOffAxisProjection() {
    if (!threeCamera || !boxGroup) return;

    const { halfWidth, halfHeight } = boxGroup.userData;
    const eyeDistance = 5;

    // Map normalized face position to world units
    const eyeX = -currentX * halfWidth * parallaxStrength;
    const eyeY = currentY * halfHeight * parallaxStrength;

    const nearOverDist = nearClip / eyeDistance;
    const left = (-halfWidth - eyeX) * nearOverDist;
    const right = (halfWidth - eyeX) * nearOverDist;
    const bottom = (-halfHeight - eyeY) * nearOverDist;
    const top = (halfHeight - eyeY) * nearOverDist;

    threeCamera.projectionMatrix.makePerspective(left, right, bottom, top, nearClip, farClip);
    threeCamera.projectionMatrixInverse.copy(threeCamera.projectionMatrix).invert();
    threeCamera.position.set(eyeX, eyeY, eyeDistance);
    threeCamera.rotation.set(0, 0, 0);
    threeCamera.updateMatrixWorld();
}

function onWindowResize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    currentX += (targetX - currentX) * smoothingAmount;
    currentY += (targetY - currentY) * smoothingAmount;

    updateOffAxisProjection();

    // Gentle float for model
    if (model) {
        const time = performance.now() * 0.001;
        model.rotation.y += 0.005;

        // Base Y is -0.5. 
        // User Offset: (+) means UP on screen -> Decrements Y in inverted world.
        // Float: Adds sine wave.
        model.position.y = -0.5 - modelOffsetY + Math.sin(time * 0.5) * 0.05;
    }

    renderer.render(scene, threeCamera);

    // FPS
    frameCount++;
    const now = performance.now();
    if (now - lastFpsUpdate >= 500) {
        currentFps = Math.round(frameCount * 1000 / (now - lastFpsUpdate));
        if (fpsCounter) fpsCounter.textContent = currentFps + ' FPS';
        frameCount = 0; lastFpsUpdate = now;
    }
}
