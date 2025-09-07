import { getAudioDuration, getContrastColor, debounce, randomButNot, lerp } from '../Core/helper-functions.js';
import { AudioPlayer } from '../Core/AudioPlayer.js';
import { Card } from './BaseCard.js';
import { MSG } from '../Core/MSG.js';

/**
 * Represents a single sound card (sound button) component in the soundboard grid.
 * It SHOULD manage its own UI, state, and audio playback.
 */
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
            duckFactor: 0.4, // how much to duck under priority
            duckSpeed: 350, // how long to lerp in ms
            duckOffsetMs: 40,
            unduckOffsetMs: 350 // overlap the ducking window on start/end 
        };
    }

    get templateId() {
        return 'sound-card-template';
    }
    //#region Lifecycle

    constructor(cardData, soundboardManager, dbInstance) {
        super(cardData, soundboardManager, dbInstance)

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

        // GET DOM ELEMENTS
        this._getDOMElemons();


        this.data.files.forEach(fileData => this._processFile(fileData));

        this.player = new AudioPlayer({
            cardElement: this.cardElement,
            progressOverlay: this.elements.progressOverlay,
            onPlay: this.onPlay.bind(this),
            onStop: this.onStop.bind(this),
            onEnded: this.onEnded.bind(this),
            onFlagFired: this.onFlagFired.bind(this),
        })

        this.currentFileIndex = -1;

        this.activePriorityPlayers = new Set();

        this.isDucked = false;
        this.priorityActive = false;
        this.duckStartTimeout = null;

        this.settings = {};

        this._initialize();
    }

    getSettingsConfig() {
        return {
            title: { label: 'Button Title', type: 'text' },
            color: { label: 'Button Color', type: 'color' },
            shuffle: { label: 'Random', type: 'checkbox' },
            autoplay: { label: 'Autoplay', type: 'checkbox' },
            priority: { label: 'Priority', type: 'checkbox' },
            loop: { label: 'Loop', type: 'checkbox' }
        };
    }



    _getDOMElemons() {
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
         */

        /** @type {Elements} */
        this.elements = {
            speedDisplay: this.cardElement.querySelector('.speed-display'),
            progressOverlay: this.cardElement.querySelector('.progress-overlay'),
            soundButton: this.cardElement.querySelector('.sound-button'),
            buttonText: this.cardElement.querySelector('.button-text'),
            volumeSlider: this.cardElement.querySelector('.volume-slider'),
            speedSlider: this.cardElement.querySelector('.speed-slider'),
            //@ts-ignore
            settingsModalTemplate: document.getElementById('sound-card-template').content.querySelector('.sound-settings-modal')
        };
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
                this.manager.handleCardMigration({
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


    //#endregion
    
    //#region Event Listeners
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

    //#endregion
    
    getNextPlaybackInfo() {
        const nextIndex = this._determineNextFileIndex();

        if (nextIndex === null) return new Card.Ticket({
            durationMs: 0,
            args: {
                specificIndex: null
            }
        });

        return this.getFileInfo(nextIndex)
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
        this.player.destroy();
        this.closeSettings();
        clearTimeout(this.duckStartTimeout);
        MSG.off(MSG.is.SOUNDCARD_PRIORITY_STARTED, this.boundPriorityPlayHandler);
        MSG.off(MSG.is.SOUNDCARD_PRIORITY_ENDED, this.boundPriorityStopHandler);
        super.destroy();

    }


    // #region DEALING WITH FILES/DATA

    getFileInfo(index) {
        const file = this.data.files[index];
        if (!file) {
            return new Card.Ticket(); // Return a default ticket if file not found
        }
        // Creates a standardized ticket with the file's duration and no specific args needed.
        return new Card.Ticket({
            durationMs: file.durationMs || 0,
            args: {
                specificIndex: index
            }
        });
    }


    async _processFile(fileData) {
        if (typeof fileData.durationMs === 'number' && fileData.durationMs >= 0) {
            return;
        }

        try {
            // Add the duration in MS directly to the fileData object itself
            fileData.durationMs = await getAudioDuration(fileData.arrayBuffer);

            const totalSeconds = fileData.durationMs / 1000;
            const durationMinutes = Math.floor(totalSeconds / 60)
            const durationSeconds = Math.floor(totalSeconds % 60);

            fileData.durationMinutes = durationMinutes
            fileData.durationSeconds = durationSeconds
            fileData.fileSize = fileData.arrayBuffer.byteLength / 1024
            fileData.title = fileData.fileName


        } catch (error) {
            console.error(`Could not get duration for ${fileData.fileName}:`, error);
            fileData.durationMs = 0;
        }
    }

    _determineNextFileIndex() {
        if (this.data.files.length === 0) return null;

        // If looping, it will always replay the current file.
        if (this.data.loop) {
            return this.currentFileIndex;
        }

        // If shuffle is on, pick a new random file that isn't the current one.
        if (this.data.shuffle) {
            return randomButNot(0, this.data.files.length, this.currentFileIndex);
        }

        // Otherwise, proceed to the next file in order, wrapping around to the start.
        let nextIndex = this.currentFileIndex + 1;
        if (nextIndex >= this.data.files.length) {
            nextIndex = 0;
        }
        return nextIndex;
    }



    //#endregion

    // ================================================================================================
    // #region AUDIO LOGIC METHODS 
    // ================================================================================================

    async playFile(fileIndex) {
        const fileData = this.data.files[fileIndex];
        if (!fileData) {
            console.error(`File not found at index ${fileIndex} for button ${this.data.id}`);
            return;
        }

        try {
            await this.player.play(fileData.arrayBuffer, {
                volume: this.data.volume,
                playbackRate: this.data.playbackRate,
                flagOffsetMs: this.data.unduckOffsetMs
            });
        } catch (error) {
            console.error("Error during playback:", error)
        }
    }

    onPlay() {
         if (this.data.priority) {
        // Always clear any lingering timeout from a previous, uncompleted play attempt
        clearTimeout(this.duckStartTimeout);

        // Set a timeout to DELAY the start of the ducking process
        this.duckStartTimeout = setTimeout(() => {
            this.priorityActive = true;
            MSG.say(MSG.is.SOUNDCARD_PRIORITY_STARTED, { cardId: this.id });
        }, this.data.duckOffsetMs);
    }
    }

    onStop() {
        // This is now the master cleanup handler for all stop scenarios.

        // 1. Always clear the start timeout. If it hasn't fired yet, this prevents it from ever firing.
        clearTimeout(this.duckStartTimeout);

        // 2. If priority mode was successfully activated, send the "ended" signal.
        // This acts as a reliable fallback for manual stops.
        if (this.data.priority && this.priorityActive) {
            this.priorityActive = false; // Prevent this from firing again
            MSG.say(MSG.is.SOUNDCARD_PRIORITY_ENDED, { cardId: this.id });
        }
    }

    // HANDLES WHAT HAPPENS AFTER a sound finishes ON ITS OWN
    onEnded() {
        // This logic should ONLY run when a track finishes naturally.
        if (this.data.loop) {
            this.playFile(this.currentFileIndex);
        } else if (this.data.autoplay) {
            const nextFileIndex = this._determineNextFileIndex();
            if (nextFileIndex !== null) {
                this.currentFileIndex = nextFileIndex;
                this.playFile(nextFileIndex);
            }
        }
    }

    onFlagFired() {
        // This is the PREFERRED "early unduck" signal.
        // It only fires if priority mode was successfully activated (i.e., after the initial delay).
        if (this.data.priority && this.priorityActive) {
            this.priorityActive = false; // Set to false FIRST to prevent onStop from re-firing.
            MSG.say(MSG.is.SOUNDCARD_PRIORITY_ENDED, { cardId: this.id });
        }
    }

    /**
    * Handles playing or stopping the sound. This is the main user interaction point.
     */
    togglePlay({ specificIndex = null } = {}) {
        if (this.data.files.length === 0) return;

        // --- If a sound is playing, the user's click means "STOP". ---
        if (this.player.isPlaying) {
            this.player.stop();
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
            this.currentFileIndex = indexToPlay; // Update our state
            this.playFile(indexToPlay);
        }
    }

    _handlePriorityPlay({ cardId }) {

        //add card to the active priority players list
        this.activePriorityPlayers.add(cardId);


        if (!this.isDucked && this.data.id !== cardId && !this.data.priority) {
            this.duck();
        }
    }

    _handlePriorityStop({ cardId }) {
        this.activePriorityPlayers.delete(cardId)
        // When a priority sound stops, I can return to my normal volume.
        if (!this.data.priority && this.activePriorityPlayers.size === 0) {
            this.unduck();
        }
    }

    duck(factor = this.data.duckFactor, speed = this.data.duckSpeed) {
        if (this.isDucked || this.data.priority) return;
        this.isDucked = true;
        const targetVolume = this.data.volume * factor
        this.lerpVolume(targetVolume, speed)
    }

    unduck(speed = this.data.duckSpeed) {
        if (!this.isDucked) return;
        this.isDucked = false;
        this.lerpVolume(this.data.volume, speed);
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

    //#endregion
    // ==========================================================================================================
    // #region SETTINGS MODAL
    // ==================================

    openSettings() {

        if (this.settingsModal) {
            return;
        }

        this.settingsModal = this.elements.settingsModalTemplate.cloneNode(true);

        // hook into the new modal
        //@ts-ignore
        this.settings.fileListElement = this.settingsModal.querySelector('.file-list')
        //@ts-ignore
        this.settings.colorPicker = this.settingsModal.querySelector('.button-color-picker')
        //@ts-ignore
        this.settings.nameInput = this.settingsModal.querySelector('.button-name-input')
        //@ts-ignore
        this.settings.shuffleCheckbox = this.settingsModal.querySelector('.shuffle-checkbox')
        //@ts-ignore
        this.settings.autoplayCheckbox = this.settingsModal.querySelector('.autoplay-checkbox')
        //@ts-ignore
        this.settings.priorityCheckbox = this.settingsModal.querySelector('.priority-checkbox')
        //@ts-ignore
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
            //@ts-ignore
            this.settingsModal.style.display = 'flex';
        }, 10);
    }

    closeSettings() {
        if (!this.settingsModal) { return; }
        this._removeModalListeners();
        //@ts-ignore
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
            this.player.stop();
            await this.updateData({ files: [] });
            this._renderFileList();
        }
    }

    async _handleRemoveFile(event) {
        if (!event.target.classList.contains('remove-file-button')) return;

        const fileIndex = parseInt(event.target.dataset.fileIndex, 10);
        if (!isNaN(fileIndex)) {
            this.player.stop(); // Stop playback if the removed file was playing
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
        this.settingsModal.addEventListener('click', this.boundHandleModalClick);
        //@ts-ignore
        this.settingsModal.querySelector('.add-file-input').addEventListener('change', this.boundHandleFileInput);
        //@ts-ignore
        this.settingsModal.querySelector('.clear-files-btn').addEventListener('click', this.boundHandleClearFiles);
        //@ts-ignore
        this.settingsModal.querySelector('.delete-soundcard-btn').addEventListener('click', this.boundDeleteCard);
        //@ts-ignore
        this.settings.fileListElement.addEventListener('click', this.boundHandleRemoveFile);
        //@ts-ignore
        this.settingsModal.querySelector('.modal-content').addEventListener('input', this.boundHandleModalFormInput);
    }

    _removeModalListeners() {
        this.settingsModal.removeEventListener('click', this.boundHandleModalClick);
        //@ts-ignore
        this.settingsModal.querySelector('.add-file-input').removeEventListener('change', this.boundHandleFileInput);
        //@ts-ignore
        this.settingsModal.querySelector('.clear-files-btn').removeEventListener('click', this.boundHandleClearFiles);
        //@ts-ignore
        this.settingsModal.querySelector('.delete-soundcard-btn').removeEventListener('click', this.boundDeleteCard);
        //@ts-ignore
        this.settings.fileListElement.removeEventListener('click', this.boundHandleRemoveFile);
        //@ts-ignore
        this.settingsModal.querySelector('.modal-content').removeEventListener('input', this.boundHandleModalFormInput);
    }

    // Helper method to close modal when clicking the backdrop
    _handleModalClick(event) {
        if (event.target === this.settingsModal) {
            this.closeSettings();
        }
    }

    //#endregion

}