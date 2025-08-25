import { appEvents, debounce, randomButNot } from "./helper-functions.js";

export class TimerCard {
    constructor(element, soundboardManager, dbInstance) {
        this.cardElement = element;
        this.soundboardManager = soundboardManager;
        this.db = dbInstance;
        this.id = parseInt(this.cardElement.dataset.cardId);

        // --- DOM Element References ---
        // TITLE AND DISPLAY
        this.timerTitle = this.cardElement.querySelector('.timer-title');
        this.timerDisplayContainer = this.cardElement.querySelector('.timer-display');
        this.timerDisplay = this.timerDisplayContainer.querySelector('span');
        this.timerProgressOverlay = this.cardElement.querySelector('.timer-progress-overlay');

        // BUTTONS
        this.startPauseBtn = this.cardElement.querySelector('.start-pause-timer-btn');
        this.resetBtn = this.cardElement.querySelector('.reset-timer-btn');

        // SLIDERS & THEIR LABELS
        this.timerMinutesRange = this.cardElement.querySelector('.timer-minutes-range');
        this.timerMinutesValue = this.cardElement.querySelector('.timer-minutes-value');
        this.timerSecondsRange = this.cardElement.querySelector('.timer-seconds-range');
        this.timerSecondsValue = this.cardElement.querySelector('.timer-seconds-value');

        // TIMER OPTIONS SECTION
        this.hideOptionsToggle = this.cardElement.querySelector('.hide-timer-options-toggle');
        this.optionsContainers = this.cardElement.querySelectorAll('.timer-options-container');

        this.modeRadios = this.cardElement.querySelectorAll('.timer-mode-radio');
        this.modeRadios.forEach(radio => {
            radio.name = `timer-mode-${this.id}`;
        });
        this.loopCheckbox = this.cardElement.querySelector('.timer-loop-checkbox');
        this.startSoundLabel = this.cardElement.querySelector('.start-sound-label');
        this.timerStartSoundSelect = this.cardElement.querySelector('.timer-start-sound');
        this.endSoundContainer = this.cardElement.querySelector('.end-sound-container');
        this.timerEndSoundSelect = this.cardElement.querySelector('.timer-end-sound');

        this.removeTimerBtn = this.cardElement.querySelector('.remove-timer-btn');

        // --- State Properties ---
        this.state = {
            title: 'New Timer',
            mode: 'timer', // 'timer' or 'stopwatch'
            isLooping: false,
            isRunning: false,
            optionsHidden: false,
            targetDurationMs: 30000, // Default to 30s
            startTime: null, // Timestamp when the timer was started/resumed
            pauseTime: null, // Timestamp when the timer was paused
            elapsedMs: 0,    // Total elapsed time when paused
            startSoundId: '',
            endSoundId: '',
            endSoundDuration: 0,
            endSoundFileIndex: null, // <-- ADD THIS LINE
            hasPlayedEndSound: false,
        };
        this.animationFrameId = null;
        this.debouncedSave = debounce(() => this.saveState(), 300);
    }

    async init() {
        await this.loadState();
        this.attachListeners();
        this.updateUI();
        this.renderDisplay();
    }

    attachListeners() {
        this.startPauseBtn.addEventListener('click', () => this.handlePlayPause());
        this.resetBtn.addEventListener('click', () => this.reset());
        this.removeTimerBtn.addEventListener('click', () => this.soundboardManager.removeTimer(this.id));

        // Listeners that change state and require a save
        const controlsToListen = [
            this.timerMinutesRange, this.timerSecondsRange, this.hideOptionsToggle,
            this.loopCheckbox, this.timerStartSoundSelect, this.timerEndSoundSelect
        ];
        controlsToListen.forEach(el => el.addEventListener('input', () => this.handleControlChange()));
        controlsToListen.forEach(el => el.addEventListener('change', () => this.handleControlChange()));
        this.modeRadios.forEach(radio => radio.addEventListener('change', () => this.handleControlChange()));
        // Handle the title separately to keep the saving from being every keystroke
        this.timerTitle.addEventListener('blur', () => {
            this.state.title = this.timerTitle.textContent;
            this.saveState();
        });

        // text editable minutes/seconds
        this.timerMinutesValue.addEventListener('blur', (e) => this.handleManualTimeInput(e));
        this.timerSecondsValue.addEventListener('blur', (e) => this.handleManualTimeInput(e));

        appEvents.on('soundButtonDeleted', (data) => this.handleButtonDeletion(data))


    }



    destroy() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
    }

    // ================================================================
    // State Management
    // ================================================================

    async saveState() {
        // If running, calculate current elapsed time before saving
        if (this.state.isRunning) {
            this.state.elapsedMs += Date.now() - this.state.startTime;
            this.state.startTime = Date.now();
        }
        await this.db.save(`timer-${this.id}`, this.state);
    }

    async loadState() {
        const savedState = await this.db.get(`timer-${this.id}`);
        if (savedState) {
            // Merge saved state with defaults
            this.state = { ...this.state, ...savedState };

            // If the timer was running when the page was closed, calculate the time that has passed since.
            if (this.state.isRunning && this.state.startTime) {
                const timePassedSinceSave = Date.now() - this.state.startTime;
                this.state.elapsedMs += timePassedSinceSave;
                this.startTimer();
            } else {
                this.state.isRunning = false; // Ensure it's not running if it wasn't saved as such
            }
        }
        // Ensure dropdowns have a valid value, defaulting to "" (None)
        this.state.startSoundId = this.state.startSoundId || "";
        this.state.endSoundId = this.state.endSoundId || "";
    }

    // ================================================================
    // Event Handlers
    // ================================================================

    startTimer() {
        if (!this.state.isLooping) {
            this.prepareEndSound();
        }
        this.state.startTime = Date.now();
        if (this.state.elapsedMs === 0) { // ONLY play sound on fresh start not every click.
            this.playStartSound();
        }
        this.tick();
    }

    handlePlayPause() {

        const isFinished = this.state.mode === 'timer' && this.state.elapsedMs >= this.state.targetDurationMs;

        if (!this.state.isRunning && isFinished) {
            this.reset();
        }

        this.state.isRunning = !this.state.isRunning; // TOGGLE THE RUNNING STATE

        if (this.state.isRunning) { // REMEMBER WE JUST TOGGLED THE RUNNING STATE
            this.startTimer();
        } else {
            // --- PAUSING ---
            this.state.elapsedMs += Date.now() - this.state.startTime;
            cancelAnimationFrame(this.animationFrameId);
        }
        this.updateUI();
        this.saveState();
    }

    reset() {
        this.state.isRunning = false;
        this.state.elapsedMs = 0;
        this.state.hasPlayedEndSound = false;
        this.state.endSoundDuration = 0;

        this.updateUI();
        this.renderDisplay();
        this.saveState();
    }

    handleControlChange() {
        // Sync state object with UI controls
        this.state.title = this.timerTitle.textContent;
        this.state.targetDurationMs = (parseInt(this.timerMinutesRange.value, 10) * 60 + parseInt(this.timerSecondsRange.value, 10)) * 1000;
        this.state.optionsHidden = this.hideOptionsToggle.checked;
        this.state.isLooping = this.loopCheckbox.checked;
        this.state.mode = this.cardElement.querySelector('.timer-mode-radio:checked').value;
        this.state.startSoundId = this.timerStartSoundSelect.value;
        this.state.endSoundId = this.timerEndSoundSelect.value;

        // Check if the timer is not running before resetting it
        if (!this.state.isRunning) {
            this.reset();
        }

        this.updateUI();

        // Only prepare the end sound if the timer is not running or in loop mode
        if (!this.state.isRunning && !this.state.isLooping) {
            this.prepareEndSound();
        }

        this.debouncedSave();
    }

    handleManualTimeInput(e) {
        const value = parseInt(e.target.value, 10);
        const type = e.target.dataset.type;

        if (type === 'minutes') {
            // Validate minutes to be within a reasonable range (e.g., 0-90)
            let validatedValue = isNaN(value) ? 0 : Math.max(0, Math.min(value, 90));
            this.timerMinutesRange.value = validatedValue;
            this.state.targetDurationMs = (validatedValue * 60 + parseInt(this.timerSecondsRange.value, 10)) * 1000;
        } else if (type === 'seconds') {
            // Validate seconds to be between 0-59
            let validatedValue = isNaN(value) ? 0 : Math.max(0, Math.min(value, 59));
            this.timerSecondsRange.value = validatedValue;
            this.state.targetDurationMs = (parseInt(this.timerMinutesRange.value, 10) * 60 + validatedValue) * 1000;
        }

        this.updateUI();
        // Re-render the display to show the formatted value (e.g., single digit to double)
        this.renderDisplay();

        // Call the debounced save to persist the change
        this.debouncedSave();
    }

    handleButtonDeletion(deletedIndex) {
        let stateChanged = false;
        const startId = parseInt(this.state.startSoundId, 10);
        const endId = parseInt(this.state.endSoundId, 10);

        // Handle Start Sound ID
        if (!isNaN(startId)) {
            if (startId === deletedIndex) {
                this.state.startSoundId = ""; // The selected button was deleted, reset to "None"
                stateChanged = true;
            } else if (startId > deletedIndex) {
                this.state.startSoundId = (startId - 1).toString(); // A button before it was deleted, so shift the index down
                stateChanged = true;
            }
        }

        // Handle End Sound ID
        if (!isNaN(endId)) {
            if (endId === deletedIndex) {
                this.state.endSoundId = ""; // The selected button was deleted, reset to "None"
                stateChanged = true;
            } else if (endId > deletedIndex) {
                this.state.endSoundId = (endId - 1).toString(); // A button before it was deleted, so shift the index down
                stateChanged = true;
            }
        }

        if (stateChanged) {
            this.saveState();
        }
    }

    // ================================================================
    // Core Timer Logic & Rendering
    // ================================================================

    tick() {
        if (!this.state.isRunning) return;

        const currentElapsed = this.state.elapsedMs + (Date.now() - this.state.startTime);

        if (this.state.mode === 'timer') {
            const remainingMs = this.state.targetDurationMs - currentElapsed;

            // Check for end sound trigger
            if (!this.state.isLooping && this.state.endSoundId && !this.state.hasPlayedEndSound && remainingMs <= this.state.endSoundDuration) {
                this.playEndSound();
            }

            // Check for timer completion
            if (remainingMs <= 0) {
                if (this.state.isLooping) {
                    this.state.elapsedMs = 0;
                    this.state.startTime = Date.now()
                    this.playStartSound();
                    // There is no "end sound" when looping and we just use the start sound like it's the only sound
                } else {
                    this.state.isRunning = false;
                    this.state.elapsedMs = this.state.targetDurationMs; // Clamp to the end
                    this.updateUI();
                    this.renderDisplay();
                    this.saveState();
                    return; // Stop the loop
                }
            }
        } else { // Stopwatch mode
            // Check for end sound trigger
            if (!this.state.isLooping && this.state.endSoundId && !this.state.hasPlayedEndSound && this.state.targetDurationMs > 0) {
                const triggerTime = this.state.targetDurationMs - this.state.endSoundDuration;
                if (currentElapsed >= triggerTime) {
                    this.playEndSound();
                }
            }
        }

        this.renderDisplay(currentElapsed);
        this.animationFrameId = requestAnimationFrame(() => this.tick());
    }

    updateUI() {
        // Sync UI controls with the state object
        this.timerTitle.textContent = this.state.title;
        this.timerMinutesRange.value = Math.floor(this.state.targetDurationMs / 60000);
        this.timerSecondsRange.value = Math.floor((this.state.targetDurationMs % 60000) / 1000);

        this.timerMinutesValue.value = this.timerMinutesRange.value;

        this.timerSecondsValue.value = this.timerSecondsRange.value;

        this.hideOptionsToggle.checked = this.state.optionsHidden;
        this.loopCheckbox.checked = this.state.isLooping;
        this.cardElement.querySelector(`.timer-mode-radio[value="${this.state.mode}"]`).checked = true;
        this.timerStartSoundSelect.value = this.state.startSoundId;
        this.timerEndSoundSelect.value = this.state.endSoundId;

        // Update dynamic UI elements
        this.startPauseBtn.textContent = this.state.isRunning ? 'Pause' : 'Start';
        this.startPauseBtn.style.backgroundColor = this.state.isRunning ? 'var(--primary-color)' : 'var(--accent-color)'
        this.startPauseBtn.style.color = this.state.isRunning ? 'var(--primary-color-text)' : 'var(--accent-color-text)'
        this.optionsContainers.forEach(c => c.classList.toggle('hidden-options', this.state.optionsHidden));
        this.timerTitle.contentEditable = !this.state.optionsHidden;
        this.endSoundContainer.style.display = this.state.isLooping ? 'none' : '';
        this.startSoundLabel.textContent = this.state.isLooping ? 'Play Sound:' : 'Start with:';


    }

    renderDisplay(currentElapsed = this.state.elapsedMs) {
        let msToDisplay;
        if (this.state.mode === 'timer') {
            msToDisplay = Math.max(0, this.state.targetDurationMs - currentElapsed);
        } else { // stopwatch
            msToDisplay = currentElapsed;
        }

        // Round UP seconds because this is a soundboard for live broadcast, so it's important to USE the entire last second - displaying 1 rather than 0 helps with that.
        const totalSeconds = Math.ceil(msToDisplay / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        this.timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

        if (this.state.mode === 'timer' && msToDisplay > 0 && msToDisplay < 3000) {
            const progress = 100 - (msToDisplay / 3000) * 100;
            this.timerProgressOverlay.style.width = `${progress}%`;
        } else {
            this.timerProgressOverlay.style.width = '0%';
        }

        // Apply glow effect for finished states
        const isStopwatchFinished = this.state.mode === 'stopwatch' && currentElapsed >= this.state.targetDurationMs && this.state.targetDurationMs > 0;
        const isTimerFinished = this.state.mode === 'timer' && (this.state.targetDurationMs - currentElapsed) <= 0;
        const shouldGlow = isStopwatchFinished || (isTimerFinished && !this.state.isLooping);

        this.cardElement.classList.toggle('hover-glow', shouldGlow);
        this.timerDisplay.classList.toggle('finished', shouldGlow);


    }

    updateTimerSoundSelectors(sounds) {
        // Clear the existing options
        this.timerStartSoundSelect.innerHTML = '<option value="">None</option>';
        this.timerEndSoundSelect.innerHTML = '<option value="">None</option>';

        if (!sounds) return;

        // Populate the dropdowns with all available sounds
        sounds.forEach((sound) => {
            // We'll use the button's unique ID for the value
            if (sound.name !== "Default Name") {
                const optionStart = new Option(sound.name, sound.id);
                const optionEnd = new Option(sound.name, sound.id);
                this.timerStartSoundSelect.add(optionStart);
                this.timerEndSoundSelect.add(optionEnd);
            }
        });

        this.timerStartSoundSelect.value = this.state.startSoundId;
        this.timerEndSoundSelect.value = this.state.endSoundId;
    }

    validateSoundSelections(existingSoundIds) {
        let stateChanged = false;
        const startId = parseInt(this.state.startSoundId, 10);
        const endId = parseInt(this.state.endSoundId, 10);

        // Check if the selected start sound ID is still valid
        if (this.state.startSoundId && !existingSoundIds.includes(startId)) {
            this.state.startSoundId = ""; // Reset to "None"
            stateChanged = true;
        }

        // Check if the selected end sound ID is still valid
        if (this.state.endSoundId && !existingSoundIds.includes(endId)) {
            this.state.endSoundId = ""; // Reset to "None"
            stateChanged = true;
        }

        // If we made a change, save the state. The next render will pick this up.
        if (stateChanged) {
            this.saveState();
        }
    }

    // ================================================================
    // Sound Logic
    // ================================================================

    playStartSound() {
        if (this.state.startSoundId !== "") {
            appEvents.dispatch('sound:togglePlay', {
            soundId: parseInt(this.state.startSoundId, 10)
        });
        }
    }

    playEndSound() {
        if (this.state.endSoundId !== "" && !this.state.hasPlayedEndSound) {
            const buttonId = parseInt(this.state.endSoundId, 10);

            // --- THE FIX: We now include the specific file index we prepared earlier. ---
            appEvents.dispatch('sound:togglePlay', {
                soundId: buttonId,
                fileIndex: this.state.endSoundFileIndex
            });

            this.state.hasPlayedEndSound = true;
        }
    }

    async prepareEndSound() {
        this.state.hasPlayedEndSound = false;
        
        if (this.state.endSoundId === "") {
            this.state.endSoundFileIndex = null;
            this.state.endSoundDuration = 0;
            return;
        }

        const buttonId = parseInt(this.state.endSoundId, 10);

        // --- REWRITE THIS SECTION ---
        // Instead of guessing, we now ask the SoundCard for its plan.
        const soundInfo = await new Promise(resolve => {
            appEvents.dispatch('request:nextSoundInfo', {
                soundId: buttonId,
                callback: (info) => resolve(info)
            });
        });
        
        // Update our state with the definitive information from the SoundCard.
        this.state.endSoundFileIndex = soundInfo.fileIndex;
        this.state.endSoundDuration = soundInfo.duration;
    }

    getAudioDuration(arrayBuffer) {
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
}
