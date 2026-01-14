/**
 * Head Tracking 3D - "Window Into Box" Effect
 * Uses MediaPipe Face Detection + Three.js
 * 
 * Creates a proper parallax box effect where:
 * - The screen acts as a window into a 3D box
 * - Grid walls align exactly to screen edges
 * - A hexagon floats in the center for depth reference
 */

// DOM Elements
const video = document.getElementById('camera-feed');
const faceCanvas = document.getElementById('face-canvas');
const threeCanvas = document.getElementById('three-canvas');
const loadingOverlay = document.getElementById('loading-overlay');
const permissionOverlay = document.getElementById('permission-overlay');
const startBtn = document.getElementById('start-btn');
const instructions = document.getElementById('instructions');
const fpsCounter = document.getElementById('fps-counter');

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
let parallaxStrength = 0.40; // Effect strength multiplier

// Physical Screen Dimensions (in cm) - fixed defaults since UI was removed
let screenWidthCm = 60;
let screenHeightCm = 34;
let viewerDistanceCm = 60;

// Screen Resolution (pixels) - for aspect ratio
let screenResolutionX = 1920;
let screenResolutionY = 1080;

// Box dimensions
const BOX_DEPTH = 100;      // Deep tunnel
const GRID_DIVISIONS = 40;  // Grid line density (adjusted for depth)

// Off-axis projection constants
const nearClip = 0.1;
const farClip = 1000;

// Smoothed head position in cm
let headX = 0, headY = 0;

// Scene objects
let boxGroup;
let hexagon;
let hexagonZ = 1.0; // Default: In front of screen

/**
 * Initialize the application
 */
init();

async function init() {
    setupControls();

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
            await initFaceDetection();
            initThreeJS();

            loadingOverlay.classList.add('hidden');
            instructions.style.display = 'block';
            document.getElementById('sensitivity-controls').style.display = 'flex';

            animate();
        } catch (error) {
            console.error('Initialization error:', error);
            loadingOverlay.querySelector('.loading-text').textContent = 'Error: ' + error.message;
        }
    });
}

/**
 * Setup UI controls
 */
function setupControls() {
    // Float control helper
    const setupFloatControl = (valueId, minusId, plusId, initialValue, setter, step = 0.05, min = 0.01, max = 2.0) => {
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

    // Hexagon Z Position Control (-5.0 to 5.0)
    setupFloatControl('zpos-value', 'zpos-minus', 'zpos-plus', hexagonZ, (val) => {
        hexagonZ = val;
        if (hexagon) hexagon.position.z = hexagonZ;
    }, 0.5, -20.0, 5.0);
}

/**
 * Update box geometry when resolution changes
 */
function updateBoxGeometry() {
    if (!boxGroup) return;

    // Remove old box
    scene.remove(boxGroup);

    // Create new box with updated aspect ratio
    createBox();
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

        // Draw simple face indicator
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

    // Draw box
    faceCtx.strokeStyle = '#a855f7';
    faceCtx.lineWidth = 2;
    faceCtx.strokeRect(x, y, width, height);

    // Draw center point
    faceCtx.fillStyle = '#6366f1';
    faceCtx.beginPath();
    faceCtx.arc(bbox.xCenter * w, bbox.yCenter * h, 5, 0, Math.PI * 2);
    faceCtx.fill();
}

/**
 * Initialize Three.js scene
 */
function initThreeJS() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000); // Pure black for infinite effect

    // Fog for infinite tunnel fade (black, starts at 10, ends at 60)
    scene.fog = new THREE.Fog(0x000000, 10, 60);

    // Camera - we'll manually set the projection matrix
    const aspect = window.innerWidth / window.innerHeight;
    threeCamera = new THREE.PerspectiveCamera(50, aspect, nearClip, farClip);
    threeCamera.position.set(0, 0, 0); // Camera at origin (viewer position)

    // Renderer
    renderer = new THREE.WebGLRenderer({
        canvas: threeCanvas,
        antialias: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
    directionalLight.position.set(2, 3, 4);
    scene.add(directionalLight);

    const pointLight = new THREE.PointLight(0xa855f7, 1.5, 20);
    pointLight.position.set(0, 0, -BOX_DEPTH / 2);
    scene.add(pointLight);

    // Create the box
    createBox();

    // Create hexagon
    createHexagon();

    // Handle resize
    window.addEventListener('resize', onWindowResize);
}

/**
 * Create the 5-sided box (4 walls + back)
 * Walls align exactly to screen edges
 */
function createBox() {
    boxGroup = new THREE.Group();
    boxGroup.name = 'box';

    // Calculate screen aspect ratio
    const aspect = screenResolutionX / screenResolutionY;

    // World units for the "screen window"
    // We use a base size and scale by aspect
    const BASE_SIZE = 4;
    const halfWidth = BASE_SIZE * aspect / 2;
    const halfHeight = BASE_SIZE / 2;

    // Grid material
    const gridMaterial = new THREE.LineBasicMaterial({
        color: 0x6366f1,
        opacity: 0.5,
        transparent: true
    });

    // Glowing edge material
    const edgeMaterial = new THREE.LineBasicMaterial({
        color: 0xa855f7,
        opacity: 0.8,
        transparent: true
    });

    /**
     * Create a grid plane with lines
     */
    function createGridPlane(width, height, divisionsW, divisionsH) {
        const geometry = new THREE.BufferGeometry();
        const points = [];

        // Horizontal lines
        for (let i = 0; i <= divisionsH; i++) {
            const y = (i / divisionsH - 0.5) * height;
            points.push(-width / 2, y, 0);
            points.push(width / 2, y, 0);
        }

        // Vertical lines
        for (let i = 0; i <= divisionsW; i++) {
            const x = (i / divisionsW - 0.5) * width;
            points.push(x, -height / 2, 0);
            points.push(x, height / 2, 0);
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
        return new THREE.LineSegments(geometry, gridMaterial.clone());
    }

    // === LEFT WALL ===
    // Extends from left edge of screen into the scene
    const leftWall = createGridPlane(BOX_DEPTH, halfHeight * 2, GRID_DIVISIONS, 10);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.x = -halfWidth;
    leftWall.position.z = -BOX_DEPTH / 2;
    boxGroup.add(leftWall);

    // === RIGHT WALL ===
    const rightWall = createGridPlane(BOX_DEPTH, halfHeight * 2, GRID_DIVISIONS, 10);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.x = halfWidth;
    rightWall.position.z = -BOX_DEPTH / 2;
    boxGroup.add(rightWall);

    // === BOTTOM WALL (Floor) ===
    const bottomWall = createGridPlane(halfWidth * 2, BOX_DEPTH, 10, GRID_DIVISIONS);
    bottomWall.rotation.x = -Math.PI / 2;
    bottomWall.position.y = -halfHeight;
    bottomWall.position.z = -BOX_DEPTH / 2;
    boxGroup.add(bottomWall);

    // === TOP WALL (Ceiling) ===
    const topWall = createGridPlane(halfWidth * 2, BOX_DEPTH, 10, GRID_DIVISIONS);
    topWall.rotation.x = Math.PI / 2;
    topWall.position.y = halfHeight;
    topWall.position.z = -BOX_DEPTH / 2;
    boxGroup.add(topWall);

    // === BACK WALL ===
    const backWall = createGridPlane(halfWidth * 2, halfHeight * 2, 10, 10);
    backWall.position.z = -BOX_DEPTH;
    boxGroup.add(backWall);

    // === Screen edge frame (glowing border) ===
    const frameGeometry = new THREE.BufferGeometry();
    const framePoints = [
        // Rectangle around screen edge at z=0
        -halfWidth, -halfHeight, 0,
        halfWidth, -halfHeight, 0,
        halfWidth, -halfHeight, 0,
        halfWidth, halfHeight, 0,
        halfWidth, halfHeight, 0,
        -halfWidth, halfHeight, 0,
        -halfWidth, halfHeight, 0,
        -halfWidth, -halfHeight, 0
    ];
    frameGeometry.setAttribute('position', new THREE.Float32BufferAttribute(framePoints, 3));
    const screenFrame = new THREE.LineSegments(frameGeometry, edgeMaterial);
    boxGroup.add(screenFrame);

    scene.add(boxGroup);

    // Store dimensions for projection
    boxGroup.userData = { halfWidth, halfHeight };
}

/**
 * Create a hexagonal prism in the center
 */
function createHexagon() {
    // CylinderGeometry with 6 radial segments = hexagon
    const radius = 0.8;
    const height = 0.4;
    const geometry = new THREE.CylinderGeometry(radius, radius, height, 6);

    const material = new THREE.MeshStandardMaterial({
        color: 0x6366f1,
        metalness: 0.6,
        roughness: 0.2,
        emissive: 0x2a2a5a,
        emissiveIntensity: 0.3
    });

    hexagon = new THREE.Mesh(geometry, material);

    // Position IN FRONT of the screen plane (positive Z = towards viewer)
    // This makes the hexagon appear to float out of the monitor
    hexagon.position.set(0, 0, hexagonZ);
    hexagon.rotation.x = Math.PI / 2; // Face towards camera

    // Add wireframe
    const wireframeMaterial = new THREE.MeshBasicMaterial({
        color: 0xa855f7,
        wireframe: true,
        transparent: true,
        opacity: 0.3
    });
    const wireframe = new THREE.Mesh(geometry, wireframeMaterial);
    hexagon.add(wireframe);

    // Add edge highlight
    const edges = new THREE.EdgesGeometry(geometry);
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xa855f7, linewidth: 2 });
    const edgeLines = new THREE.LineSegments(edges, lineMaterial);
    hexagon.add(edgeLines);

    scene.add(hexagon);
}

/**
 * Update off-axis projection matrix
 * This creates the "window into world" effect (True3D style)
 * 
 * Key principle: The screen IS the window. The camera represents the viewer's eye
 * and only moves laterally. The frustum is adjusted asymmetrically so that
 * the screen edges always align with the viewport edges.
 */
function updateOffAxisProjection() {
    if (!threeCamera || !boxGroup) return;

    // Get box dimensions (this defines our "screen" size in world units)
    const { halfWidth, halfHeight } = boxGroup.userData;

    // Eye position in world units (lateral movement only)
    // The camera/eye is at Z = some distance in front of screen (screen is at Z=0)
    const eyeDistance = 5; // Distance from screen to eye in world units

    // Map normalized face position to world units
    // Uses parallaxStrength multiplier (controlled by UI)
    // X inverted: head left in camera = see more left wall
    const eyeX = -currentX * halfWidth * parallaxStrength;
    const eyeY = currentY * halfHeight * parallaxStrength; // No Y inversion - up is up

    // Off-axis projection calculation
    // Screen corners in world space (screen at Z = 0)
    const screenLeft = -halfWidth;
    const screenRight = halfWidth;
    const screenBottom = -halfHeight;
    const screenTop = halfHeight;

    // Project screen corners onto near plane
    // Similar triangles: nearPlane / eyeDistance = projected / actual
    const nearOverDist = nearClip / eyeDistance;

    const left = (screenLeft - eyeX) * nearOverDist;
    const right = (screenRight - eyeX) * nearOverDist;
    const bottom = (screenBottom - eyeY) * nearOverDist;
    const top = (screenTop - eyeY) * nearOverDist;

    // Set asymmetric frustum - this is the core of the effect!
    threeCamera.projectionMatrix.makePerspective(left, right, bottom, top, nearClip, farClip);
    threeCamera.projectionMatrixInverse.copy(threeCamera.projectionMatrix).invert();

    // Position camera at eye position, looking straight ahead (NO rotation!)
    threeCamera.position.set(eyeX, eyeY, eyeDistance);

    // Critical: Camera looks straight ahead, parallel to Z axis
    // We use a manual rotation matrix instead of lookAt
    threeCamera.rotation.set(0, 0, 0);
    threeCamera.updateMatrixWorld();
}

/**
 * Handle window resize
 */
function onWindowResize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    // Projection matrix is set manually, so we don't need to update aspect
}

/**
 * Animation loop
 */
function animate() {
    requestAnimationFrame(animate);

    // Smooth interpolation towards target position
    currentX += (targetX - currentX) * smoothingAmount;
    currentY += (targetY - currentY) * smoothingAmount;

    // Update off-axis projection for head-coupled perspective
    updateOffAxisProjection();

    // Animate hexagon - gentle rotation and float
    if (hexagon) {
        const time = performance.now() * 0.001;
        hexagon.rotation.z += 0.005;
        hexagon.position.y = Math.sin(time * 0.5) * 0.1;
    }

    renderer.render(scene, threeCamera);

    // FPS tracking
    frameCount++;
    const now = performance.now();
    if (now - lastFpsUpdate >= 500) {
        currentFps = Math.round(frameCount * 1000 / (now - lastFpsUpdate));
        if (fpsCounter) fpsCounter.textContent = currentFps + ' FPS';
        frameCount = 0;
        lastFpsUpdate = now;
    }
}
