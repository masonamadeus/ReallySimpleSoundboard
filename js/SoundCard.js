import { appEvents, getContrastColor, debounce, randomButNot } from './helper-functions.js';
import { AudioPlayer } from './AudioPlayer.js';
import { RSSCard } from './RSSCard.js';

/**
 * Represents a single sound card (sound button) component in the soundboard grid.
 * It SHOULD manage its own UI, state, and audio playback.
 */

// NEED TO MOVE DUCKING FUNCTIONALITY IN HERE FROM SOUNDBOARDMANAGER AND MAKE THAT EVENT-DRIVEN

export class SoundCard extends RSSCard {

    static getInitialData(newId) {
        return {
            id: newId,
            type: 'sound',
            title: 'New Sound',
            color: "var(--accent-color)",
            volume: 1.0,
            playbackRate: 1.0,
            shuffle: false,
            loop: false,
            priority: false,
            autoplay: false,
            files: []
        };
    }

    get templateId() {
        return 'sound-card-template';
    }

    get commands() {
        return [
            {action: 'togglePlay', name: "Play/Stop Sound", hasDuration: true}
        ]
    }

    constructor(cardData, soundboardManager, dbInstance) {
        super(cardData, soundboardManager, dbInstance)

        this.fileMetadata = new Map();
        this.data.files.forEach(fileData => this._processFile(fileData));
        this.player = new AudioPlayer(() => this._handlePlaybackCompletion());

        // BINDINGS
        this.boundDurationRequestHandler = this._handleSoundDurationRequest.bind(this);
        this.boundDataRequestHandler = this._handleDataRequest.bind(this);
        this.boundTogglePlayHandler = this._handleTogglePlayRequest.bind(this);
        this.boundNextDurationInfoHandler = this._handleNextDurationInfoRequest.bind(this);
        this.boundPriorityPlayHandler = this._handlePriorityPlay.bind(this);
        this.boundPriorityStopHandler = this._handlePriorityStop.bind(this);

        // MODAL BINDINGS
        this.boundHandleModalClick = this._handleModalClick.bind(this);
        this.boundHandleFileInput = this._handleFileInput.bind(this);
        this.boundHandleClearFiles = this._handleClearFiles.bind(this);
        this.boundHandleRemoveFile = this._handleRemoveFile.bind(this);
        this.boundDeleteCard = this._handleDeleteCard.bind(this);

        // DOM REFERENCES
        /**
         * @typedef {object} Elements
         * @property {HTMLInputElement} speedDisplay
         * @property {HTMLElement} progressOverlay
         * @property {HTMLButtonElement} soundButton
         * @property {HTMLSpanElement} buttonText
         * @property {HTMLInputElement} volumeSlider
         * @property {HTMLInputElement} speedSlider
         * @property {HTMLElement} settingsModal
         * @property {HTMLInputElement} colorPicker
         * @property {HTMLInputElement} nameInput
         * @property {HTMLInputElement} shuffleCheckbox
         * @property {HTMLInputElement} autoplayCheckbox
         * @property {HTMLInputElement} priorityCheckbox
         * @property {HTMLInputElement} loopCheckbox
         * @property {HTMLElement} fileListElement
         */

        /** @type {Elements} */
        this.elements = {
            speedDisplay: this.cardElement.querySelector('.speed-display'),
            progressOverlay: this.cardElement.querySelector('.progress-overlay'),
            soundButton: this.cardElement.querySelector('.sound-button'),
            buttonText: this.cardElement.querySelector('.button-text'),
            volumeSlider: this.cardElement.querySelector('.volume-slider'),
            speedSlider: this.cardElement.querySelector('.speed-slider'),
            settingsModal: this.cardElement.querySelector('.sound-settings-modal'),
            colorPicker: this.cardElement.querySelector('.button-color-picker'),
            nameInput: this.cardElement.querySelector('.button-name-input'),
            shuffleCheckbox: this.cardElement.querySelector('.shuffle-checkbox'),
            autoplayCheckbox: this.cardElement.querySelector('.autoplay-checkbox'),
            priorityCheckbox: this.cardElement.querySelector('.priority-checkbox'),
            loopCheckbox: this.cardElement.querySelector('.loop-checkbox'),
            fileListElement: this.cardElement.querySelector('.file-list')
        };
        
        // The player needs references to the card and its progress bar for the glow effect
        this.player.progressOverlay = this.elements.progressOverlay;
        this.player.cardElement = this.cardElement;

        this._attachListeners();
        this.updateUI();
    }

    _attachListeners() {

        appEvents.on('request:commandDuration', this.boundNextDurationInfoHandler);
        appEvents.on('sound:priorityPlayStarted', this.boundPriorityPlayHandler);
        appEvents.on('sound:priorityPlayEnded', this.boundPriorityStopHandler);


        this.cardElement.addEventListener('click', (event) => {
            //@ts-ignore
            const actionElement = event.target.closest('[data-action]');
            if (!actionElement) return;

            const action = actionElement.dataset.action;
            switch (action) {
                case 'play':
                    this.togglePlay(); // Calls its own method
                    break;
                case 'settings':
                    this.openSettings();
                    break;
            }
        });

        this.cardElement.addEventListener('input', debounce((event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement)) return;

            const action = target.dataset.action;
            const value = parseFloat(target.value);
            switch (action) {
                case 'volume-change':
                    this.player.audio.volume = value; // Apply the change immediately
                    this.updateData({ volume: value }); // Use our helper to save
                    break;
                case 'speed-change':
                    this.player.audio.playbackRate = value; // Apply the change immediately
                    this.elements.speedDisplay.textContent = `${value.toFixed(1)}x`;

                    this.updateData({ playbackRate: value }); // Use our helper to save
                    break;
                default:
                    return;
            }
        }, 50));


        this.cardElement.addEventListener('dblclick', (event) => {
            //@ts-ignore
            const slider = event.target.closest('input[type="range"][data-action="speed-change"]');
            if (slider instanceof HTMLInputElement) {
                slider.value = '1.0';
                slider.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
    }

    updateUI() {

        // Set button text and color
        this.elements.buttonText.textContent = this.data.title;
        this.elements.soundButton.style.backgroundColor = this.data.color;

        // Automatically set a contrasting text color for readability
        this.elements.soundButton.style.color = getContrastColor(this.data.color);

        // Set slider positions
        this.elements.volumeSlider.value = this.data.volume;
        this.elements.speedSlider.value = this.data.playbackRate;

        // Update the speed display text (e.g., "1.5x")
        this.elements.speedDisplay.textContent = `${Number(this.data.playbackRate).toFixed(1)}x`;
    }


    destroy() {
        this.player.cleanup();
        appEvents.off('request:commandDuration', this.boundNextDurationInfoHandler);
        appEvents.off('sound:priorityPlayStarted', this.boundPriorityPlayHandler);
        appEvents.off('sound:priorityPlayEnded', this.boundPriorityStopHandler);

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
     * @param {{buttonId: number, fileIndex: number, callback: function(number):void}} data
     */
    _handleSoundDurationRequest({ buttonId, fileIndex, callback }) {
        // This is the crucial check: only the correct card will respond.
        if (this.data.id !== buttonId) {
            return;
        }

        const durationMs = this.getAudioFileDurationMs(fileIndex);
        const playbackRate = this.data.playbackRate || 1.0;
        const adjustedDuration = durationMs / playbackRate;

        // The card itself calls the callback with the result.
        callback(adjustedDuration);
    }

    _handleDataRequest({ buttonId, callback }) {
        // If the request is for me, I'll answer it.
        if (this.data.id === buttonId) {
            callback(this.data);
        }
    }

    _handleNextDurationInfoRequest({ buttonId, callback }) {
        if (this.data.id !== buttonId) {
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

    _handleTogglePlayRequest({ buttonId, fileIndex }) { // The fileIndex is now received here
        if (this.data.id === buttonId) {
            // Pass the specific index along to the main toggle method.
            this.togglePlay({ specificIndex: fileIndex });
        }
    }

    // Modify the togglePlay method to accept the specific index.
    /**
 * Handles playing or stopping the sound. This is the main user interaction point.
 */
    togglePlay({ specificIndex = null } = {}) {
        if (this.data.files.length === 0) return;

        // --- If a sound is playing, the user's click means "STOP". ---
        if (this.player.isPlaying) {
            this.player.cleanup(); // Stops audio and resets the progress overlay.

            // If it was a priority sound, announce that it has stopped.
            if (this.data.priority) {
                appEvents.dispatch('sound:priorityPlayEnded', { cardId: this.data.id });
            }

            // That's it. We just stop. We don't advance the index or trigger autoplay.
            // The currentFileIndex remains, so the next click will correctly determine the *next* file.
            return;
        }

        // --- If no sound is playing, the user's click means "PLAY". ---
        let indexToPlay;
        if (specificIndex !== null) {
            indexToPlay = specificIndex; // A specific file is requested (e.g., from a Timer)
        } else {
            indexToPlay = this._determineNextFileIndex(); // Find the next file based on settings
        }

        if (indexToPlay !== null) {
            this.player.playback.currentFileIndex = indexToPlay; // Update our state
            this.playFile(indexToPlay);
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
            // ANNOUNCE to all other components that a priority sound has started.
            appEvents.dispatch('sound:priorityPlayStarted', { cardId: this.data.id });
        }
    }


    _handlePriorityPlay({ cardId }) {
        // If a priority sound started, AND it's not me, AND I'm not priority, AND I'm playing...
        if (this.data.id !== cardId && !this.data.priority && this.player.isPlaying) {
            // ...then I should quiet down.
            this.player.audio.volume = this.data.volume * 0.4; // Duck the volume
        }
    }

    _handlePriorityStop() {
        // When a priority sound stops, I can return to my normal volume.
        // We don't need to check for other priority sounds; if another one is playing,
        // this card would have remained ducked anyway. This is simpler and effective.
        if (!this.data.priority) {
            this.player.audio.volume = this.data.volume;
        }
    }

    /**
 * Handles what happens AFTER a sound finishes playing ON ITS OWN.
 */
    _handlePlaybackCompletion() {
        if (this.data.priority) {
            // Announce the priority sound has finished naturally.
            appEvents.dispatch('sound:priorityPlayEnded', { cardId: this.data.id });
        }

        if (this.data.loop) {
            this.playFile(this.player.playback.currentFileIndex); // Replay the current file
        } else if (this.data.autoplay) {
            const nextFileIndex = this._determineNextFileIndex(); // Find the next file
            if (nextFileIndex !== null) {
                this.player.playback.currentFileIndex = nextFileIndex; // Update state
                this.playFile(nextFileIndex); // Play it
            }
        }
        // If neither loop nor autoplay is on, do nothing. The sound just stops.
    }


    // ===================================
    // SETTINGS MODAL METHODS
    // ==================================

    openSettings() {
        // Populate the modal with THIS card's data
        let colorValue = this.data.color;
        if (colorValue.startsWith('var(')) {
            const cssVarName = colorValue.match(/--[\w-]+/)[0];
            colorValue = getComputedStyle(document.documentElement).getPropertyValue(cssVarName).trim();
        }
        this.elements.colorPicker.value = colorValue;

        this.elements.nameInput.value = this.data.title;
        this.elements.shuffleCheckbox.checked = this.data.shuffle;
        this.elements.autoplayCheckbox.checked = this.data.autoplay;
        this.elements.priorityCheckbox.checked = this.data.priority;
        this.elements.loopCheckbox.checked = this.data.loop;

        this._renderFileList();
        this._attachModalListeners(); // Attach listeners now that the modal is ready
        this.elements.settingsModal.style.display = 'flex';
    }

    closeSettings() {
        this._removeModalListeners();
        this.elements.settingsModal.style.display = 'none';
    }

    _renderFileList() {
        this.elements.fileListElement.innerHTML = '';
        if (this.data.files.length === 0) {
            this.elements.fileListElement.innerHTML = '<li><small>No files added yet.</small></li>';
            return;
        }

        this.data.files.forEach((file, index) => {
            const listItem = document.createElement('li');
            listItem.innerHTML = `
                <span>${file.fileName}</span>
                <button data-file-index="${index}" class="remove-file-button">Remove</button>
            `;
            this.elements.fileListElement.appendChild(listItem);
        });
    }

    async _handleFileInput(event) {
        const files = Array.from(event.target.files);
        for (const file of files) {
            const arrayBuffer = await file.arrayBuffer();
            const fileData = { fileName: file.name, mimeType: file.type, arrayBuffer: arrayBuffer };
            await this._processFile(fileData);
            this.data.files.push(fileData);
        }
        await this.updateData({ files: this.data.files });
        this._renderFileList();
        event.target.value = ''; // Clear the input
    }

    async _handleClearFiles() {
        const confirmed = await this.manager.showConfirmModal("Are you sure you want to clear all audio files for this button?");
        if (confirmed) {
            this.player.cleanup();
            await this.updateData({ files: [] });
            this._renderFileList();
        }
    }

    async _handleRemoveFile(event) {
        if (!event.target.classList.contains('remove-file-button')) return;

        const fileIndex = parseInt(event.target.dataset.fileIndex, 10);
        if (!isNaN(fileIndex)) {
            this.player.cleanup(); // Stop playback if the removed file was playing
            this.data.files.splice(fileIndex, 1);
            await this.updateData({ files: this.data.files });
            this._renderFileList();
        }
    }

    _handleModalInputChange(event) {
        const target = event.target;
        const key = target.dataset.key;
        if (!key) return;

        const value = target.type === 'checkbox' ? target.checked : target.value;
        this.updateData({ [key]: value });
    }

    _attachModalListeners() {

        // This function handles all form inputs in the modal
        this.boundHandleModalFormInput = (e) => {
            const target = e.target;
            // The keyMap now maps CLASS names to data properties
            const keyMap = {
                'button-name-input': 'title',
                'button-color-picker': 'color',
                'shuffle-checkbox': 'shuffle',
                'autoplay-checkbox': 'autoplay',
                'priority-checkbox': 'priority',
                'loop-checkbox': 'loop'
            };

            // Find which class from our map the target element has
            const matchingClass = Object.keys(keyMap).find(cls => target.classList.contains(cls));

            if (matchingClass) {
                // Use the found class to get the correct data property key (e.g., 'name')
                const dataKey = keyMap[matchingClass];
                const value = target.type === 'checkbox' ? target.checked : target.value;

                this.updateData({ [dataKey]: value }).then(() => {
                    this.updateUI(); // This will now correctly run and update the title
                });
            }
        };

        // --- Attach Listeners ---
        this.elements.settingsModal.addEventListener('click', this.boundHandleModalClick);
        this.elements.settingsModal.querySelector('.add-file-input').addEventListener('change', this.boundHandleFileInput);
        this.elements.settingsModal.querySelector('.clear-files-btn').addEventListener('click', this.boundHandleClearFiles);
        this.elements.settingsModal.querySelector('.delete-soundcard-btn').addEventListener('click', this.boundDeleteCard);
        this.elements.fileListElement.addEventListener('click', this.boundHandleRemoveFile);

        // Listen for changes on any of the setting inputs
        this.elements.settingsModal.querySelector('.modal-content').addEventListener('input', this.boundHandleModalFormInput);
    }

    _removeModalListeners() {
        this.elements.settingsModal.removeEventListener('click', this.boundHandleModalClick);
        this.elements.settingsModal.querySelector('.add-file-input').removeEventListener('change', this.boundHandleFileInput);
        this.elements.settingsModal.querySelector('.clear-files-btn').removeEventListener('click', this.boundHandleClearFiles);
        this.elements.settingsModal.querySelector('.delete-soundcard-btn').removeEventListener('click', this.boundDeleteCard);
        this.elements.fileListElement.removeEventListener('click', this.boundHandleRemoveFile);
        this.elements.settingsModal.querySelector('.modal-content').removeEventListener('input', this.boundHandleModalFormInput);
    }

    // Helper method to close modal when clicking the backdrop
    _handleModalClick(event) {
        if (event.target === this.elements.settingsModal) {
            this.closeSettings();
        }
    }



}