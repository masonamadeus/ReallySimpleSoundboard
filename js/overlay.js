const segmentContainer = document.getElementById('segment-container');
const shapeElement = document.getElementById('shape-element');
const titleText = document.getElementById('segment-title-text');

let visualDelayTimeout = null;
let cleanupTimeout = null;
let exitTimeout = null; // NEW: Tracks the graceful exit

const TRANSITIONS = [
    'trans-swipe',
    'trans-flash',
    'trans-circle',
    'trans-box',
    'trans-glitch',
    'trans-radialburst',
    'trans-shockwave'
];

const SHAPES = [
    'shape-burst',
    'shape-blob',
    'shape-star',
    'shape-pill',
    'shape-hexagon',
    'shape-diamond',
    'shape-ticket',
    'shape-arrow',
    'shape-crown',
    'shape-badge',
    'shape-ribbon',
    'shape-jagged'
];

const TRANSITION_DELAYS = {
    'trans-swipe': 350,
    'trans-flash': 50,
    'trans-circle': 300,
    'trans-box': 300,
    'trans-glitch': 40,
    'trans-radialburst': 140,
    'trans-shockwave': 120
};

function restartAnimation(el) {
    el.style.animation = 'none';
    el.offsetHeight;
    el.style.animation = '';
}

// Hard reset (used before triggering a brand new graphic)
function clearOverlayState() {
    clearTimeout(visualDelayTimeout);
    clearTimeout(cleanupTimeout);
    clearTimeout(exitTimeout); // Clear exit timeout too

    segmentContainer.classList.remove('show');

    document.body.classList.remove(
        'overlay-active',
        ...TRANSITIONS
    );

    shapeElement.className = '';

    restartAnimation(shapeElement);
    restartAnimation(segmentContainer);
}

function triggerOverlay(data) {
    // Instantly wipe anything currently on screen
    clearOverlayState();

    document.body.classList.add('overlay-active');

    if (data.cardTitle) {
        titleText.textContent = data.cardTitle;
    }

    if (data.color) {
        document.body.style.setProperty('--theme-color', data.color);
    }

    const transition = TRANSITIONS[
        Math.floor(Math.random() * TRANSITIONS.length)
    ];

    const shape = SHAPES[
        Math.floor(Math.random() * SHAPES.length)
    ];

    document.body.classList.add(transition);
    shapeElement.classList.add(shape);

    requestAnimationFrame(() => {
        visualDelayTimeout = setTimeout(() => {
            segmentContainer.classList.add('show');
        }, TRANSITION_DELAYS[transition] || 150);
    });

    cleanupTimeout = setTimeout(() => {
        document.body.classList.remove(...TRANSITIONS);
    }, 1400);
}

// Graceful exit (used when audio drops or manual stop is clicked)
function stopOverlay() {
    // Clear pending intro animations if stopped extremely early
    clearTimeout(visualDelayTimeout);
    clearTimeout(cleanupTimeout);
    clearTimeout(exitTimeout);

    // 1. Remove 'show' to trigger the 0.55s CSS shrink animation
    segmentContainer.classList.remove('show');
    
    // 2. Start fading out the dark background wash
    document.body.classList.remove('overlay-active');

    // 3. WAIT for the shrink animation to finish before stripping the shape mask
    exitTimeout = setTimeout(() => {
        shapeElement.className = '';
        document.body.classList.remove(...TRANSITIONS);
    }, 600); // 600ms safely covers the 0.55s CSS transition
}

const peer = new Peer('bmrss-obs-overlay-v1');

peer.on('open', id => {
    console.log('[Overlay] Ready:', id);
});

peer.on('connection', conn => {
    console.log('[Overlay] Connected');

    conn.on('data', data => {
        console.log('[Overlay] Incoming:', data);

        switch (data.action) {
            case 'trigger_overlay':
                triggerOverlay(data);
                break;

            case 'stop_overlay':
                stopOverlay();
                break;
        }
    });

    conn.on('close', () => {
        console.log('[Overlay] Disconnected');
    });
});

peer.on('error', err => {
    console.error('[Overlay] Peer Error:', err);
});