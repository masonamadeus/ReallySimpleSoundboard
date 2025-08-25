import { appEvents, getContrastColor, debounce, randomButNot } from './helper-functions.js';
import { AudioPlayer } from './AudioPlayer.js';

/**
 * Represents a single sound card component in the soundboard grid.
 * It SHOULD manage its own UI, state, and audio playback.
 */

// NEED TO MOVE DUCKING FUNCTIONALITY IN HERE FROM SOUNDBOARDMANAGER AND MAKE THAT EVENT-DRIVEN

export class SoundCard {
    /**
     * @param {object} buttonData - The configuration object for this sound button.
     * @param {import('./SoundboardManager.js').SoundboardManager} soundboardManager - A reference to the main manager class.
     */
    constructor(buttonData, soundboardManager) {
        this.data = buttonData;
        this.manager = soundboardManager;
        this.db = this.manager.db;

        this.fileMetadata = new Map();
        this.data.files.forEach(fileData => this._processFile(fileData));

        this.player = new AudioPlayer(() => this._handlePlaybackCompletion());

        this.element = this._createElement();

        this._attachListeners();

        this.player.progressOverlay = this.element.querySelector('.progress-overlay');
        this.player.cardElement = this.element; // The player needs a reference to the whole card for the glow effect

        this.boundDurationRequestHandler = this._handleSoundDurationRequest.bind(this);
        appEvents.on('request:soundDuration', this.boundDurationRequestHandler);

        this.boundDataRequestHandler = this._handleDataRequest.bind(this);
        appEvents.on('request:soundData', this.boundDataRequestHandler);

        this.boundTogglePlayHandler = this._handleTogglePlayRequest.bind(this);
        appEvents.on('sound:togglePlay', this.boundTogglePlayHandler);

        this.boundNextSoundInfoHandler = this._handleNextSoundInfoRequest.bind(this);
        appEvents.on('request:nextSoundInfo', this.boundNextSoundInfoHandler);
    }

    _createElement() {
        /** @type {HTMLTemplateElement} */
        const template = document.getElementById('sound-card-template');
        // @ts-ignore
        const card = template.content.firstElementChild.cloneNode(true);

        // --- Populate the template with data ---
        card.dataset.cardType = 'sound';
        card.dataset.cardId = this.data.id;
        card.setAttribute('draggable', this.manager.isRearranging);

        // @ts-ignore
        const button = card.querySelector('.sound-button');
        button.style.backgroundColor = this.data.color;
        button.style.color = getContrastColor(this.data.color);

        card.querySelector('.button-text').textContent = this.data.name;
        
        card.querySelector('.volume-slider').value = this.data.volume;
        
        card.querySelector('.speed-slider').value = this.data.playbackRate;
        card.querySelector('.speed-display').textContent = `${this.data.playbackRate.toFixed(1)}x`;

        return card;
    }

    _attachListeners() {
        this.element.addEventListener('click', (event) => {
            const actionElement = event.target.closest('[data-action]');
            if (!actionElement) return;

            const action = actionElement.dataset.action;
            switch (action) {
                case 'play':
                    this.togglePlay(); // Calls its own method
                    break;
                case 'settings':
                    this.manager.openSettingsModal(this.data.id);
                    break;
            }
        });

        this.element.addEventListener('input', debounce((event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement)) return;

            const action = target.dataset.action;
            const value = parseFloat(target.value);

            switch (action) {
                case 'volume-change':
                    this.data.volume = value;
                    this.player.audio.volume = value;
                    break;
                case 'speed-change':
                    this.data.playbackRate = value;
                    this.player.audio.playbackRate = value;
                    const speedDisplay = this.element.querySelector('.speed-display');
                    if (speedDisplay) {
                        speedDisplay.textContent = `${value.toFixed(1)}x`;
                    }
                    break;
                default:
                    return;
            }
            this.db.save(this.data.id, this.data);
        }, 250));

        this.element.addEventListener('dblclick', (event) => {
            const slider = event.target.closest('input[type="range"][data-action="speed-change"]');
            if (slider instanceof HTMLInputElement) {
                slider.value = '1.0';
                slider.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
    }

    // A cleanup method for when the card is deleted +++
    destroy() {
        // 1. Clean up the audio player (stop sounds, revoke URLs).
        this.player.cleanup();

        // 2. Unsubscribe from the event bus using the stable reference.
        appEvents.off('request:soundDuration', this.boundDurationRequestHandler);
        appEvents.off('sound:togglePlay', this.boundTogglePlayHandler);
        appEvents.off('request:soundData', this.boundDataRequestHandler);
        appEvents.on('request:nextSoundInfo', this.boundNextSoundInfoHandler);
    }
    

    // LOGIC FOR ACTUAL FUNCTIONALITY

    async _processFile(fileData) {
        // Use a unique identifier for the file, like its name + size, to cache results
        const fileId = `${fileData.fileName}-${fileData.arrayBuffer.byteLength}`;
        if (this.fileMetadata.has(fileId)) {
            return this.fileMetadata.get(fileId);
        }

        try {
            const duration = await this._getAudioDuration(fileData.arrayBuffer);
            const metadata = { duration }; // duration in seconds
            this.fileMetadata.set(fileId, metadata);
            return metadata;
        } catch (error) {
            console.error(`Could not get duration for ${fileData.fileName}:`, error);
            this.fileMetadata.set(fileId, { duration: 0 });
            return { duration: 0 };
        }
    }

    /**
     * Responds to a global request for sound duration if the ID matches this card.
     * @param {{soundId: number, fileIndex: number, callback: function(number):void}} data
     */
    _handleSoundDurationRequest({ soundId, fileIndex, callback }) {
        // This is the crucial check: only the correct card will respond.
        if (this.data.id !== soundId) {
            return;
        }

        const durationMs = this.getAudioFileDurationMs(fileIndex);
        const playbackRate = this.data.playbackRate || 1.0;
        const adjustedDuration = durationMs / playbackRate;
        
        // The card itself calls the callback with the result.
        callback(adjustedDuration);
    }

    _handleDataRequest({ soundId, callback }) {
        // If the request is for me, I'll answer it.
        if (this.data.id === soundId) {
            callback(this.data);
        }
    }

    _handleNextSoundInfoRequest({ soundId, callback }) {
        if (this.data.id !== soundId) {
            return; // Not for me.
        }

        const nextFileIndex = this._determineNextFileIndex();
        
        if (nextFileIndex === null) {
            callback({ fileIndex: null, duration: 0 }); // No files to play
            return;
        }

        const durationMs = this.getAudioFileDurationMs(nextFileIndex);
        const adjustedDuration = durationMs / (this.data.playbackRate || 1.0);

        callback({ fileIndex: nextFileIndex, duration: adjustedDuration });
    }

    _determineNextFileIndex() {
        if (this.data.files.length === 0) return null;

        // If looping, it will always replay the current file.
        if (this.data.loop) {
            return this.player.playback.currentFileIndex;
        }

        // If shuffle is on, pick a new random file that isn't the current one.
        if (this.data.shuffle) {
            return randomButNot(0, this.data.files.length, this.player.playback.currentFileIndex);
        }

        // Otherwise, proceed to the next file in order, wrapping around to the start.
        let nextIndex = this.player.playback.currentFileIndex + 1;
        if (nextIndex >= this.data.files.length) {
            nextIndex = 0;
        }
        return nextIndex;
    }


    // Helper to get duration from an ArrayBuffer
    _getAudioDuration(arrayBuffer) {
        return new Promise((resolve, reject) => {
            const blob = new Blob([arrayBuffer]);
            const audio = new Audio();
            const objectURL = URL.createObjectURL(blob);
            audio.addEventListener('loadedmetadata', () => {
                URL.revokeObjectURL(objectURL);
                resolve(audio.duration);
            }, { once: true });
            audio.addEventListener('error', () => {
                URL.revokeObjectURL(objectURL);
                reject(new Error('Failed to load audio for duration calculation.'));
            }, { once: true });
            audio.src = objectURL;
        });
    }

    // +++ ADD: A public method for other components to query duration +++
    /**
     * @param {number} fileIndex The index of the file in the `this.data.files` array.
     * @returns {number} The duration of the audio file in milliseconds.
     */
    getAudioFileDurationMs(fileIndex) {
        const fileData = this.data.files[fileIndex];
        if (!fileData) return 0;

        const fileId = `${fileData.fileName}-${fileData.arrayBuffer.byteLength}`;
        const metadata = this.fileMetadata.get(fileId);
        
        // Duration is stored in seconds, so convert to ms
        return metadata ? metadata.duration * 1000 : 0;
    }

    
    // --- NEW AUDIO LOGIC METHODS ---

   _handleTogglePlayRequest({ soundId, fileIndex }) { // The fileIndex is now received here
        if (this.data.id === soundId) {
            // Pass the specific index along to the main toggle method.
            this.togglePlay({ specificIndex: fileIndex });
        }
    }

    // Modify the togglePlay method to accept the specific index.
    togglePlay({ specificIndex = null } = {}) {
        if (this.data.files.length === 0) return;

        if (this.player.isPlaying) {
            this.player.cleanup();
            this._handlePlaybackCompletion();
        } else {
            let indexToPlay;
            // If a specific index is commanded, we MUST use it.
            if (specificIndex !== null && specificIndex >= 0) {
                indexToPlay = specificIndex;
            } else {
                // Otherwise, we use the normal logic (shuffle, loop, etc.)
                indexToPlay = this._determineNextFileIndex();
            }
            
            if (indexToPlay !== null) {
                this.player.playback.currentFileIndex = indexToPlay;
                this.playFile(indexToPlay);
            }
        }
    }

    playFile(fileIndex) {
        const fileData = this.data.files[fileIndex];
        if (!fileData) {
            console.error(`File not found at index ${fileIndex} for button ${this.data.id}`);
            return;
        }

        this.player.cleanup();
        const blob = new Blob([fileData.arrayBuffer], { type: fileData.mimeType });
        this.player.audio.src = URL.createObjectURL(blob);
        this.player.audio.volume = this.data.volume;
        this.player.audio.playbackRate = this.data.playbackRate;

        this.player.audio.play().catch(e => console.error("Playback error:", e));

        if (this.data.priority) {
            this.manager.handlePriorityDucking(this.data.id);
        }
    }

    _handlePlaybackCompletion() {
        // This logic runs when a sound finishes or is stopped
        if (this.data.priority) {
            this.manager.handlePriorityUnducking();
        }

        if (this.data.loop) {
            this.playFile(this.player.playback.currentFileIndex);
        } else if (this.data.autoplay) {
            this.player.playback.currentFileIndex++;
            if (this.player.playback.currentFileIndex >= this.data.files.length) {
                this.player.playback.currentFileIndex = 0;
            }
            const nextFileIndex = this.data.shuffle
                ? randomButNot(0, this.data.files.length, this.player.playback.currentFileIndex)
                // @ts-ignore
                : this.player.playback.currentFileIndex;
            this.playFile(nextFileIndex);
        } else {
            this.player.playback.currentFileIndex++;
        }
    }
}
