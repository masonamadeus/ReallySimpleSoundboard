export class AudioPlayer {
    /**
     * @param {object} options
     * @param {HTMLElement} options.cardElement - The UI element for feedback (glow).
     * @param {HTMLElement} options.progressOverlay - The UI element for the progress bar.
     * @param {() => void} [options.onPlay] - Optional: Callback when playback starts.
     * @param {() => void} [options.onStop] - Optional: Callback when playback stops.
     * @param {() => void} [options.onEnded] - Optional: Callback when playback finishes naturally.
     * @param {() => void} [options.onFlagFired] - Optional: Callback for the timed flag event.
     */
    constructor({ cardElement, progressOverlay, onPlay, onStop, onEnded, onFlagFired }) {
        // --- Dependencies & State ---
        this.elements = { cardElement, progressOverlay };
        this.callbacks = { onPlay, onStop, onEnded, onFlagFired }; // Store all callbacks.

        this.audio = new Audio();
        this.isPlaying = false;
        this.rafId = null;
        this._monitor = {
            flagOffsetS: 0,
            hasFiredFlag: false,
        };

        this._setupListeners();
    }

    // --- Public API ---

    /**
     * Plays audio from an ArrayBuffer.
     * @param {ArrayBuffer} arrayBuffer The audio data to play.
     * @param {object} [options] Playback options.
     * @param {number} [options.volume=1]
     * @param {number} [options.playbackRate=1]
     * @param {number} [options.flagOffsetMs=0] Milliseconds from the end to fire the onFlagFired callback.
     * @returns {Promise<number>} A promise that resolves with the audio duration in milliseconds.
     */
    play(arrayBuffer, options = {}) {
        this.stop(); // Stop any previous playback first.

        return new Promise(resolve => {
            const blob = new Blob([arrayBuffer]);
            this.audio.src = URL.createObjectURL(blob);
            this.audio.volume = options.volume ?? 1.0;
            this.audio.playbackRate = options.playbackRate ?? 1.0;
            
            // Set up monitoring state for this playback session
            this._monitor.flagOffsetS = (options.flagOffsetMs ?? 0) / 1000;
            this._monitor.hasFiredFlag = false;

            this.audio.onloadedmetadata = () => {
                this.audio.play().catch(e => console.error("Audio playback failed:", e));
                resolve(this.audio.duration * 1000);
            };
        });
    }

    /**
     * Stops playback, cleans up the monitoring loop, and notifies the owner.
     */
    stop() {
        this.audio.pause();
        this.audio.currentTime = 0; // Reset position

        

        this._stopMonitoring();
        this._monitor.hasFiredFlag = false;

        if (this.audio.src) {
            URL.revokeObjectURL(this.audio.src);
        }

        this._resetUI();
    }

    /**
     * Completely destroys the player, removing all event listeners to prevent memory leaks.
     */
    destroy() {
        this.stop();
        // Nullify listeners to break circular references and prevent memory leaks
        this.audio.onplaying = null;
        this.audio.onpause = null;
        this.audio.onended = null;
        this.owner = null; // Break the reference to the owner
    }

    // --- Private Methods ---

    /**
     * A safe helper to fire a provided callback if it exists.
     * @param {'onPlay' | 'onStop' | 'onEnded' | 'onFlagFired'} callbackName
     * @param {any[]} args
     */
    _fireCallback(callbackName, ...args) {
        if (this.callbacks[callbackName] && typeof this.callbacks[callbackName] === 'function') {
            //@ts-ignore
            this.callbacks[callbackName](...args);
        }
    }

    _setupListeners() {
        this.audio.onplaying = () => {
            this.isPlaying = true;
            this.elements.cardElement.classList.add('hover-glow');
            this._startMonitoring();
            this._fireCallback('onPlay');
        };

        this.audio.onpause = () => { // Covers both manual stops and natural ends
            this.isPlaying = false;
            this._stopMonitoring();
            this._resetUI();
            this._fireCallback('onStop');
        };

        this.audio.onended = () => {
            // note: onpause fires first 
            // so we don't have to worry about state here
            this._fireCallback('onEnded');
        };
    }

    _startMonitoring() {
        this._stopMonitoring(); // Ensure no previous loop is running

        const monitorLoop = () => {
            if (this.audio.paused) {
                this._stopMonitoring();
                return;
            }

            const currentTime = this.audio.currentTime;
            const duration = this.audio.duration;
            const playbackRate = this.audio.playbackRate;

            // This calculation is now resilient to playback speed changes.
            // It checks the actual time left, not a pre-calculated value.
            const remainingTime = (duration - currentTime) / playbackRate;
            this._updateProgressUI(currentTime, duration);

            // Check if the flag should be fired
            if (!this._monitor.hasFiredFlag && this._monitor.flagOffsetS > 0) {
                if (remainingTime <= this._monitor.flagOffsetS) {
                    this._fireCallback('onFlagFired');
                    this._monitor.hasFiredFlag = true;
                }
            }
            
            this.rafId = requestAnimationFrame(monitorLoop);
        };
        this.rafId = requestAnimationFrame(monitorLoop);
    }
    
    _stopMonitoring() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    _updateProgressUI(currentTime, duration) {
        if (this.elements.progressOverlay && duration > 0) {
            const progress = (currentTime / duration) * 100;
            this.elements.progressOverlay.style.width = `${progress}%`;
        }
    }

    _resetUI() {
        if (this.elements.progressOverlay) this.elements.progressOverlay.style.width = '0%';
        if (this.elements.cardElement) this.elements.cardElement.classList.remove('hover-glow');
    }
}