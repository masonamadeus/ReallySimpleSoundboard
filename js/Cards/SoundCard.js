import { getAudioDuration, getContrastColor, debounce, randomButNot, lerp } from '../Core/helper-functions.js';
import { AudioPlayer } from '../Core/AudioPlayer.js';
import { Card } from './BaseCard.js';
import { MSG } from '../Core/MSG.js';
import { Modal } from '../Core/Modal.js';
import {store} from '../Core/StateStore.js';

// Setup a global WebRTC peer to talk to OBS
const peer = new Peer();
let obsConnection = null;

peer.on('open', () => {
    // Connect to the specific ID we will assign to the OBS overlay
    obsConnection = peer.connect('bmrss-obs-overlay-v1');
    
    obsConnection.on('open', () => {
        console.log("Connected to OBS Overlay!");
    });
});

const globalAudioCtx = new (window.AudioContext || window.webkitAudioContext)();

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
            showOverlay: false,
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

    constructor(cardData) {
        super(cardData)

        // BINDINGS
        this.boundPriorityPlayHandler = this._handlePriorityPlay.bind(this);
        this.boundPriorityStopHandler = this._handlePriorityStop.bind(this);

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

        this.analyser = globalAudioCtx.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.8;
        
        try {
            // Route this specific card's audio through our analyzer
            this.mediaSource = globalAudioCtx.createMediaElementSource(this.player.audio);
            this.mediaSource.connect(this.analyser);
            this.analyser.connect(globalAudioCtx.destination);
        } catch(e) {
            console.error("Audio Routing Error:", e);
        }
        
        this.isMonitoringOverlay = false; // Tracks the loop state

        this.currentFileIndex = -1;

        this.activePriorityPlayers = new Set();

        this.isDucked = false;
        this.priorityActive = false;
        this.duckStartTimeout = null;

        this.settings = {};

        this._initialize();
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
        };
    }

    _initialize() {
        this._attachListeners();
        this.updateUI();
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

    startOverlayMonitor() {
        this.isMonitoringOverlay = true;
        let silenceTimer = 0;
        let lastFrameTime = performance.now();
        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

        const BED_VOLUME_THRESHOLD = 110; // 0-255 (Adjust if it hides too early/late)
        const TIME_TO_WAIT_MS = 2000; 

        const checkLevel = () => {
            if (!this.isMonitoringOverlay) return;

            const now = performance.now();
            const deltaTime = now - lastFrameTime;
            lastFrameTime = now;

            this.analyser.getByteFrequencyData(dataArray);
            
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            let averageVolume = sum / dataArray.length;

            if (averageVolume <= BED_VOLUME_THRESHOLD) {
                silenceTimer += deltaTime;
                if (silenceTimer >= TIME_TO_WAIT_MS) {
                    
                    // IT'S QUIET! TELL OBS TO HIDE THE GRAPHIC!
                    if (obsConnection && obsConnection.open) {
                        obsConnection.send({ action: 'stop_overlay', cardId: this.id });
                    }
                    this.isMonitoringOverlay = false; 
                    return; 
                }
            } else {
                silenceTimer = 0; 
            }

            requestAnimationFrame(checkLevel);
        };
        
        requestAnimationFrame(checkLevel);
    }

 

    // Helper to render the file list inside the settings modal
    _renderSettingsFileList(listElement) {
        listElement.innerHTML = ''; // Clear it out
        if (this.data.files.length === 0) {
            listElement.innerHTML = `<li><small>No audio files yet.</small></li>`;
            return;
        }

        this.data.files.forEach((file, index) => {
            const li = document.createElement('li');
            li.innerHTML = `
            <span>${file.fileName}</span>
            <button class="danger remove-file-btn" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;">Remove</button>
        `;

            // Attach listener directly to this specific remove button
            li.querySelector('.remove-file-btn').addEventListener('click', () => {
                this._handleRemoveFile(index);
                this._renderSettingsFileList(listElement); // Re-render list after removal
            });

            listElement.appendChild(li);
        });
    }


    destroy() {
        this.player.destroy();
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
        if (!fileData) return;

        // 1. Instantly beam the audio binary, color, and TITLE to OBS via WebRTC
        if (this.data.showOverlay && obsConnection && obsConnection.open) {
            obsConnection.send({
                action: 'trigger_overlay',
                color: this.data.color, 
                cardTitle: this.data.title, 
                audioBuffer: fileData.arrayBuffer 
            });
        }

        // 2. Delay the audible playback to the streamer/mixer by 800ms
        setTimeout(async () => {
            try {
                await this.player.play(fileData.arrayBuffer, {
                    volume: this.data.volume,
                    playbackRate: this.data.playbackRate,
                    flagOffsetMs: this.data.unduckOffsetMs
                });
            } catch (error) {
                console.error("Error during playback:", error)
            }
        }, 0); 
    }

    onPlay() {
        // Wake up audio context (browsers require this)
        if (globalAudioCtx.state === 'suspended') {
            globalAudioCtx.resume();
        }

        // Trigger the volume detection!
        if (this.data.showOverlay) {
            this.startOverlayMonitor();
        }

        if (this.data.priority) {
            clearTimeout(this.duckStartTimeout);
            this.duckStartTimeout = setTimeout(() => {
                this.priorityActive = true;
                MSG.say(MSG.is.SOUNDCARD_PRIORITY_STARTED, { cardId: this.id });
            }, this.data.duckOffsetMs);
        }
    }

    onStop() {
        // Kill the analyzer loop
        this.isMonitoringOverlay = false;

        clearTimeout(this.duckStartTimeout);

        // Tell OBS to shrink away (Your existing code already does this nicely!)
        if (obsConnection && obsConnection.open) {
            obsConnection.send({
                action: 'stop_overlay',
                cardId: this.id
            });
        }

        if (this.data.priority && this.priorityActive) {
            this.priorityActive = false; 
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

    /**
     * Overrides BaseCard's method to provide the custom DOM for SoundCard settings.
     */
    getSettingsDOM() {
        // 1. Clone the template
        const template = document.getElementById('sound-settings-template');
        const settingsDOM = template.content.cloneNode(true);

        // 2. Grab references to the UI elements
        const titleInput = settingsDOM.querySelector('.setting-title');
        const colorInput = settingsDOM.querySelector('.setting-color');
        const shuffleCheck = settingsDOM.querySelector('.setting-shuffle');
        const autoplayCheck = settingsDOM.querySelector('.setting-autoplay');
        const priorityCheck = settingsDOM.querySelector('.setting-priority');
        const loopCheck = settingsDOM.querySelector('.setting-loop');
        const overlayCheck = settingsDOM.querySelector('.setting-overlay');
        const fileListEl = settingsDOM.querySelector('.settings-file-list');

        // 3. Populate current data
        titleInput.value = this.data.title;
        
        let colorValue = this.data.color;
        if (colorValue.startsWith('var(')) {
            const cssVarName = colorValue.match(/--[\w-]+/)[0];
            colorValue = getComputedStyle(document.documentElement).getPropertyValue(cssVarName).trim();
        }
        colorInput.value = colorValue;

        shuffleCheck.checked = this.data.shuffle;
        autoplayCheck.checked = this.data.autoplay;
        priorityCheck.checked = this.data.priority;
        loopCheck.checked = this.data.loop;
        overlayCheck.checked = this.data.showOverlay;

        // 4. Attach DIRECT event listeners to inputs
        titleInput.addEventListener('input', (e) => {
            this.updateData({ title: e.target.value });
            this.elements.buttonText.textContent = e.target.value; 
        });

        colorInput.addEventListener('input', (e) => {
            this.updateData({ color: e.target.value });
            this.elements.soundButton.style.backgroundColor = e.target.value;
        });

        shuffleCheck.addEventListener('change', (e) => this.updateData({ shuffle: e.target.checked }));
        autoplayCheck.addEventListener('change', (e) => this.updateData({ autoplay: e.target.checked }));
        priorityCheck.addEventListener('change', (e) => this.updateData({ priority: e.target.checked }));
        loopCheck.addEventListener('change', (e) => this.updateData({ loop: e.target.checked }));
        overlayCheck.addEventListener('change', (e) => this.updateData({ showOverlay: e.target.checked }));

        // 5. Attach listeners to Buttons
        settingsDOM.querySelector('.delete-card-btn').addEventListener('click', () => {
            this._handleDeleteCard(); // Destroys the card and tells the manager
            if (this.settingsModal) this.settingsModal.close(); // Close modal immediately
        });

        // NOTICE: We pass the fileListEl directly into these functions!
        settingsDOM.querySelector('.add-file-btn').addEventListener('click', () => this._handleAddFileClick(fileListEl));
        settingsDOM.querySelector('.clear-files-btn').addEventListener('click', () => this._handleClearFiles(fileListEl));

        // 6. Initial render of the file list
        this._renderSettingsFileList(fileListEl);

        return settingsDOM;
    }

    /**
     * Fixes the add file logic by accepting the <ul> element and re-rendering it manually
     */
    _handleAddFileClick(fileListEl) {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'audio/*';
        fileInput.multiple = true;
        
        fileInput.onchange = async (event) => {
            const files = Array.from(event.target.files);
            const newFilesData = [...this.data.files]; 

            for (const file of files) {
                const arrayBuffer = await file.arrayBuffer();
                const fileData = { fileName: file.name, mimeType: file.type, arrayBuffer: arrayBuffer };
                await this._processFile(fileData);
                newFilesData.push(fileData);
            }
            
            // Save data via MSG system
            await this.updateData({ files: newFilesData });
            
            // Re-render the HTML list instantly! No massive generic Modal.rebuild() needed.
            this._renderSettingsFileList(fileListEl); 
        };
        
        fileInput.click();
    }

    async _handleClearFiles(fileListEl) {
        const confirmed = await MSG.confirm("Are you sure you want to clear all audio files for this button?");
        if (confirmed) {
            this.player.stop();
            await this.updateData({ files: [] });
            this._renderSettingsFileList(fileListEl); // Manually clear the UI list
        }
    }

    async _handleRemoveFile(index, fileListEl) {
        this.player.stop();
        const newFiles = [...this.data.files];
        newFiles.splice(index, 1);
        await this.updateData({ files: newFiles });
        this._renderSettingsFileList(fileListEl); // Manually re-render the UI list
    }

    _renderSettingsFileList(listElement) {
        listElement.innerHTML = ''; 
        
        if (this.data.files.length === 0) {
            listElement.innerHTML = `<li><small>No audio files yet.</small></li>`;
            return;
        }

        this.data.files.forEach((file, index) => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span>${file.fileName}</span>
                <button class="danger remove-file-btn" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;">Remove</button>
            `;
            
            // Add a direct listener to the specific "remove" button for this file
            li.querySelector('.remove-file-btn').addEventListener('click', () => {
                this._handleRemoveFile(index, listElement);
            });

            listElement.appendChild(li);
        });
    }

    //#endregion

}