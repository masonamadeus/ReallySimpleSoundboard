import { getAudioDuration, getContrastColor, debounce, randomButNot, lerp } from './helper-functions.js';
import { AudioPlayer } from './AudioPlayer.js';
import { Card } from './RSSCard.js';
import { MSG } from './MSG.js';

// SECRET PHRASE: MASHED PERDADERS

/**
 * Represents a single sound card (sound button) component in the soundboard grid.
 * It SHOULD manage its own UI, state, and audio playback.
 */

// NEED TO MOVE DUCKING FUNCTIONALITY IN HERE FROM SOUNDBOARDMANAGER AND MAKE THAT EVENT-DRIVEN

export class SoundCard extends Card {

    static Default() {
        return {
            type: 'sound',
            title: 'New Sound',
            color: "var(--accent-color)",
            volume: 1.0,
            playbackRate: 1.0,
            shuffle: false,
            loop: false,
            priority: false,
            autoplay: false,
            files: [],
            duckFactor: 0.4,
            duckTime: 350
        };
    }

    get templateId() {
        return 'sound-card-template';
    }

    constructor(cardData, soundboardManager, dbInstance) {
        const completeCardData = { ...SoundCard.Default(), ...cardData };
        super(completeCardData, soundboardManager, dbInstance)

        this.fileMetadata = new Map();
        this.data.files.forEach(fileData => this._processFile(fileData));
        this.player = new AudioPlayer(() => this._handlePlaybackCompletion());
        this.activePriorityPlayers = new Set();

        this.isDucked = false;

        // BINDINGS
        this.boundPriorityPlayHandler = this._handlePriorityPlay.bind(this);
        this.boundPriorityStopHandler = this._handlePriorityStop.bind(this);

        // MODAL BINDINGS
        this.boundHandleModalClick = this._handleModalClick.bind(this);
        this.boundHandleFileInput = this._handleFileInput.bind(this);
        this.boundHandleClearFiles = this._handleClearFiles.bind(this);
        this.boundHandleRemoveFile = this._handleRemoveFile.bind(this);
        this.boundHandleModalFormInput = this._handleModalFormInput.bind(this);
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
         * @property {HTMLTemplateElement} settingsModalTemplate
         * 
         * 
         */

        /** @type {Elements} */
        this.elements = {
            speedDisplay: this.cardElement.querySelector('.speed-display'),
            progressOverlay: this.cardElement.querySelector('.progress-overlay'),
            soundButton: this.cardElement.querySelector('.sound-button'),
            buttonText: this.cardElement.querySelector('.button-text'),
            volumeSlider: this.cardElement.querySelector('.volume-slider'),
            speedSlider: this.cardElement.querySelector('.speed-slider'),
            settingsModalTemplate: document.getElementById('sound-card-template').content.querySelector('.sound-settings-modal')
        };

        this.settings = {};

        // The player needs references to the card and its progress bar for the glow effect
        this.player.progressOverlay = this.elements.progressOverlay;
        this.player.cardElement = this.cardElement;

        this._initialize();
    }

    _initialize() {
        this._checkforMigration();
        this._attachListeners();
        this.updateUI();
    }

    _checkforMigration() {
        // duration in ms needs to be updated if it's not there
        this.data.files.forEach((file, index) => {
            // If a file from the DB is missing the duration, it needs migrating.
            if (file.durationMs === undefined) {
                this.manager.handleCardMigration( {
                    card: this,
                    file: file,
                    fileIndex: index
                });
            }
        });
    }

    _registerCommands() {
        // Register the main "Press" command for the whole card. PROBLEM: TOGGLEPLAY HAS INDETERMINATE DURATION
        this.registerCommand({
            name: "Press",
            execute: this.togglePlay,
            preload: this.getNextPlaybackInfo
        });

        // Register a specific command for each individual sound file
        /*
        this.data.files.forEach((file, index) => {
            this.registerCommand({
                execute: () => this.playFile(index),
                preload: () => this.getFileInfo(index),
                name: `Play: ${file.fileName}`
            });
        }); 
        */
    }

    getFileInfo(index) {
        const file = this.data.files[index];
        if (!file) {
            return this.createCommandTicket(); // Return a default ticket if file not found
        }
        // Creates a standardized ticket with the file's duration and no specific args needed.
        return this.createCommandTicket(file.durationMs || 0, { specificIndex: index });
    }

    getNextPlaybackInfo() {
        const nextIndex = this._determineNextFileIndex();

        if (nextIndex === null) return this.createCommandTicket(0, { specificIndex: null });

        return this.getFileInfo(nextIndex)
    }

    _attachListeners() {
        MSG.on(MSG.is.SOUNDCARD_PRIORITY_STARTED, this.boundPriorityPlayHandler);
        MSG.on(MSG.is.SOUNDCARD_PRIORITY_ENDED, this.boundPriorityStopHandler);


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

        this.elements.soundButton.style.backgroundColor = this.data.color; // Keep original variable for style

        // Use the resolved hex color for the contrast calculation
        this.elements.soundButton.style.color = getContrastColor(this.data.color);

        // Set slider positions
        this.elements.volumeSlider.value = this.data.volume;
        this.elements.speedSlider.value = this.data.playbackRate;

        // Update the speed display text (e.g., "1.5x")
        this.elements.speedDisplay.textContent = `${Number(this.data.playbackRate).toFixed(1)}x`;
    }


    destroy() {
        this.player.cleanup();
        MSG.off(MSG.is.SOUNDCARD_PRIORITY_STARTED, this.boundPriorityPlayHandler);
        MSG.off(MSG.is.SOUNDCARD_PRIORITY_ENDED, this.boundPriorityStopHandler);
        super.destroy();

    }


    // #region DEALING WITH FILES/DATA

    async _processFile(fileData) {
        const fileId = `${fileData.fileName}-${fileData.arrayBuffer.byteLength}`;
        if (this.fileMetadata.has(fileId)) {
            return this.fileMetadata.get(fileId);
        }

        try {
            // Add the duration in MS directly to the fileData object itself
            fileData.durationMs = await getAudioDuration(fileData.arrayBuffer);

            const totalSeconds = fileData.durationMs / 1000;
            const durationMinutes = Math.floor(totalSeconds / 60)
            const durationSeconds = Math.floor(totalSeconds % 60);
            const metadata = {
                durationMinutes: durationMinutes,
                durationSeconds: durationSeconds,
                durationMs: fileData.durationMs,
                fileSize: fileData.arrayBuffer.byteLength / 1024,
                title: fileData.fileName,
            };
            this.fileMetadata.set(fileId, metadata);
            return metadata;
        } catch (error) {
            console.error(`Could not get duration for ${fileData.fileName}:`, error);
            fileData.durationMs = 0;
            this.fileMetadata.set(fileId, { duration: 0 });
            return { duration: 0 };
        }
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

    //#endregion

    // --- AUDIO LOGIC METHODS ---


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
                MSG.say(MSG.is.SOUNDCARD_PRIORITY_ENDED, { cardId: this.data.id });
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
            MSG.say(MSG.is.SOUNDCARD_PRIORITY_STARTED, { cardId: this.data.id });
        }
    }


    _handlePriorityPlay({ cardId }) {

        //add card to the active priority players list
        this.activePriorityPlayers.add(cardId);

        // If a priority sound started, AND it's not me, AND I'm not priority, AND I'm playing...
        if (!this.isDucked && this.data.id !== cardId && !this.data.priority) {
            // ...then I should quiet down.
            this.isDucked = true;
            const targetVolume = this.data.duckFactor * this.data.volume;
            this.lerpVolume(targetVolume, this.data.duckTime); // Duck the volume
        }
    }

    _handlePriorityStop({ cardId }) {
        this.activePriorityPlayers.delete(cardId)
        // When a priority sound stops, I can return to my normal volume.
        if (!this.data.priority && this.isDucked && this.activePriorityPlayers.size === 0) {
            this.isDucked = false;
            this.lerpVolume(this.data.volume, this.data.duckTime);
        }
    }

    /**
 * Handles what happens AFTER a sound finishes playing ON ITS OWN.
 */
    _handlePlaybackCompletion() {
        if (this.data.priority) {
            // Announce the priority sound has finished naturally.
            MSG.say(MSG.is.SOUNDCARD_PRIORITY_ENDED, { cardId: this.data.id });
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

    /**
 * Smoothly transitions the card's volume to a target value over a duration.
 * @param {number} targetVolume The volume to transition to (will be clamped between 0.0 and 1.0).
 * @param {number} duration The duration of the transition in milliseconds.
 */
    lerpVolume(targetVolume, duration) {
        const clampedTarget = Math.max(0, Math.min(1, targetVolume));
        const startVolume = this.player.audio.volume;

        // Use the new generic lerp function
        lerp(startVolume, clampedTarget, duration, (currentVolume) => {
            // This is our callback function, which runs on every animation frame
            this.player.audio.volume = currentVolume;
            this.elements.volumeSlider.value = currentVolume;
        });
    }

    // ===================================
    // SETTINGS MODAL METHODS
    // ==================================

    openSettings() {

        if (this.settingsModal) {
            return;
        }

        this.settingsModal = this.elements.settingsModalTemplate.cloneNode(true);

        this.settings.fileListElement = this.settingsModal.querySelector('.file-list')

        this.settings.colorPicker = this.settingsModal.querySelector('.button-color-picker')
        this.settings.nameInput = this.settingsModal.querySelector('.button-name-input')
        this.settings.shuffleCheckbox = this.settingsModal.querySelector('.shuffle-checkbox')
        this.settings.autoplayCheckbox = this.settingsModal.querySelector('.autoplay-checkbox')
        this.settings.priorityCheckbox = this.settingsModal.querySelector('.priority-checkbox')
        this.settings.loopCheckbox = this.settingsModal.querySelector('.loop-checkbox')


        // Populate the modal with THIS card's data
        let colorValue = this.data.color;
        if (colorValue.startsWith('var(')) {
            const cssVarName = colorValue.match(/--[\w-]+/)[0];
            colorValue = getComputedStyle(document.documentElement).getPropertyValue(cssVarName).trim();
        }

        this.settings.colorPicker.value = colorValue;

        this.settings.nameInput.value = this.data.title;
        this.settings.shuffleCheckbox.checked = this.data.shuffle;
        this.settings.autoplayCheckbox.checked = this.data.autoplay;
        this.settings.priorityCheckbox.checked = this.data.priority;
        this.settings.loopCheckbox.checked = this.data.loop;

        this._renderFileList();
        this._attachModalListeners(); // Attach listeners now that the modal is ready
        document.body.appendChild(this.settingsModal);

        setTimeout(() => {
            this.settingsModal.style.display = 'flex';
        }, 10);
    }

    closeSettings() {
        if (!this.settingsModal) { return; }
        this._removeModalListeners();
        this.settingsModal.remove();
        this.settingsModal = null;
    }

    _renderFileList() {
        this.settings.fileListElement.innerHTML = '';
        if (this.data.files.length === 0) {
            this.settings.fileListElement.innerHTML = '<li><small>No files added yet.</small></li>';
            return;
        }

        this.data.files.forEach((file, index) => {
            const listItem = document.createElement('li');
            listItem.innerHTML = `
                <span>${file.fileName}</span>
                <button data-file-index="${index}" class="remove-file-button">Remove</button>
            `;
            this.settings.fileListElement.appendChild(listItem);
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

    _handleModalFormInput = (e) => {
        const target = e.target;
        const dataKey = target.dataset.key; // Much cleaner!

        if (dataKey) {
            const value = target.type === 'checkbox' ? target.checked : target.value;
            this.updateData({ [dataKey]: value });
        }
    };


    _attachModalListeners() {
        // --- Attach Listeners ---
        this.settingsModal.addEventListener('click', this.boundHandleModalClick);
        this.settingsModal.querySelector('.add-file-input').addEventListener('change', this.boundHandleFileInput);
        this.settingsModal.querySelector('.clear-files-btn').addEventListener('click', this.boundHandleClearFiles);
        this.settingsModal.querySelector('.delete-soundcard-btn').addEventListener('click', this.boundDeleteCard);
        this.settings.fileListElement.addEventListener('click', this.boundHandleRemoveFile);
        this.settingsModal.querySelector('.modal-content').addEventListener('input', this.boundHandleModalFormInput);
    }

    _removeModalListeners() {
        this.settingsModal.removeEventListener('click', this.boundHandleModalClick);
        this.settingsModal.querySelector('.add-file-input').removeEventListener('change', this.boundHandleFileInput);
        this.settingsModal.querySelector('.clear-files-btn').removeEventListener('click', this.boundHandleClearFiles);
        this.settingsModal.querySelector('.delete-soundcard-btn').removeEventListener('click', this.boundDeleteCard);
        this.settings.fileListElement.removeEventListener('click', this.boundHandleRemoveFile);
        this.settingsModal.querySelector('.modal-content').removeEventListener('input', this.boundHandleModalFormInput);
    }

    // Helper method to close modal when clicking the backdrop
    _handleModalClick(event) {
        if (event.target === this.settingsModal) {
            this.closeSettings();
        }
    }



}