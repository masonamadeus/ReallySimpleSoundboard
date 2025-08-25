export class AudioPlayer {
    /**
     * @param {() => void} onEndedCallback - A function to call when audio playback finishes.
     */
    constructor(onEndedCallback) {
        this.audio = new Audio();
        this.isPlaying = false;
        this.playback = {
            currentFileIndex: 0,
        };
        this.progressOverlay = null; // A reference to the progress bar element
        this.cardElement = null; // a reference to the card element itself
        this.onEnded = onEndedCallback; // The callback function
        this._setupListeners();
    }

    _setupListeners() {
        this.audio.onplaying = () => {
            this.isPlaying = true;
            if (this.cardElement) {
                this.cardElement.classList.add('hover-glow');
            }
        };
        this.audio.onpause = () => {
            this.isPlaying = false;
            this._resetProgress();
        };
        this.audio.onended = () => {
            this.isPlaying = false;
            this._resetProgress();
            this.audio.currentTime = 0;
            // Call the provided callback function
            if (this.onEnded) {
                this.onEnded();
            }
        };
        this.audio.ontimeupdate = () => this._updateProgress();
    }

    _updateProgress() {
        if (this.progressOverlay && this.audio.duration > 0) {
            const progress = (this.audio.currentTime / this.audio.duration) * 100;
            this.progressOverlay.style.width = `${progress}%`;
        }
    }

    _resetProgress() {
        if (this.progressOverlay) {
            this.progressOverlay.style.width = '0%';
        }
        if (this.cardElement) {
            this.cardElement.classList.remove('hover-glow');
        }
    }

    cleanup() {
        this.audio.pause();
        if (this.audio.src) {
            URL.revokeObjectURL(this.audio.src);
            this.audio.src = '';
            this.audio.load();
        }
        this.isPlaying = false;
        this._resetProgress();
    }
}
