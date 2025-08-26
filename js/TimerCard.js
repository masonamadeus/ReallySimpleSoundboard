import { appEvents, debounce, randomButNot } from "./helper-functions.js";
import { RSSCard } from "./RSSCard.js";

export class TimerCard extends RSSCard {

    static getInitialData(newId) {
        return {
            id: newId,
            type: 'timer',
            title: 'New Timer',
            targetDurationMs: 300000,
            elapsedMs: 0,
            isRunning: false,
            endbuttonId: "",
            startbuttonId: "",
            hasPressedEndButton: false,
            endSoundDuration: 0,
            endSoundFileIndex: null,
            isLooping: false,
            mode: 'timer',
            optionsHidden: true
        };
    }

    get templateId() {
        return 'timer-card-template';
    }

    constructor(cardData, soundboardManager, dbInstance) {
        super(cardData, soundboardManager, dbInstance);

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

        this.debouncedSave = debounce(() => this.handleControlChange(), 250);

        this.attachListeners();
        this.updateUI();
    }


    attachListeners() {
        this.startPauseBtn.addEventListener('click', () => this.handlePlayPause());
        this.resetBtn.addEventListener('click', () => this.reset());
        this.removeTimerBtn.addEventListener('click', () => this._handleDeleteCard(this.id));

        // debounce the sliders to prevent unnecessary database writes.
        this.timerMinutesRange.addEventListener('input', () => {
            this._updateDisplayTextFromSliders();
            this.debouncedSave();
        });
        this.timerSecondsRange.addEventListener('input', () => {
            this._updateDisplayTextFromSliders();
            this.debouncedSave();
        });

        // These don't need debouncing unless someone is using AHK to be a psychopath lol
        const immediateChangeControls = [
            this.hideOptionsToggle, this.loopCheckbox,
            this.timerStartSoundSelect, this.timerEndSoundSelect
        ];
        immediateChangeControls.forEach(el => el.addEventListener('change', () => this.handleControlChange()));
        this.modeRadios.forEach(radio => radio.addEventListener('change', () => this.handleControlChange()));

        // text editable minutes/seconds (these trigger on 'blur', which is fine)
        this.timerMinutesValue.addEventListener('blur', (e) => this.handleManualTimeInput(e));
        this.timerSecondsValue.addEventListener('blur', (e) => this.handleManualTimeInput(e));


        this.boundHandleButtonDeletion = this.handleButtonDeletion.bind(this);
        appEvents.on('cardDeleted', this.boundHandleButtonDeletion);
    }

    destroy() {
        // Stop any active animation loops
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        appEvents.off('cardDeleted', this.boundHandleButtonDeletion);
    }

    // ================================================================
    // Event Handlers
    // ================================================================

    startTimer() {
        if (!this.data.isLooping) {
            this.prepareEndSound();
        }
        this.updateData({ startTime: Date.now() })

        if (this.data.elapsedMs === 0) { // ONLY play sound on fresh start not every click.
            this.playStartSound();
        }
        this.tick();
    }

    handlePlayPause() {
        const isFinished = this.data.mode === 'timer' && this.data.elapsedMs >= this.data.targetDurationMs;

        // If the timer is done, the "Start" button should function as a "Reset and Start".
        if (!this.data.isRunning && isFinished) {
            this.reset().then(() => this.startTimer()); // Chain start after reset completes
            return;
        }

        const newIsRunning = !this.data.isRunning;
        this.updateData({ isRunning: newIsRunning }); // Update state immediately

        if (newIsRunning) {
            this.startTimer(); // This will set startTime and begin the tick
        } else {
            // Pausing: calculate new elapsed time and cancel the animation frame
            const newElapsedMs = (this.data.elapsedMs || 0) + (Date.now() - this.data.startTime);
            cancelAnimationFrame(this.animationFrameId);
            this.updateData({ elapsedMs: newElapsedMs });
        }
        this.updateUI();
    }

    reset() {

        const newData = {
            isRunning: false,
            elapsedMs: 0,
            hasPressedEndButton: false,
            endSoundDuration: 0
        }

        this.updateData(newData);
        this.updateUI();
    }

    handleControlChange() {
        // 1. Read all values from the UI controls.
        const minutes = parseInt(this.timerMinutesRange.value, 10);
        const seconds = parseInt(this.timerSecondsRange.value, 10);
        const newTargetDurationMs = (minutes * 60 + seconds) * 1000;

        // 2. Batch all state changes into one object.
        const newData = {
            targetDurationMs: newTargetDurationMs,
            optionsHidden: this.hideOptionsToggle.checked,
            isLooping: this.loopCheckbox.checked,
            mode: this.cardElement.querySelector('.timer-mode-radio:checked').value,
            startbuttonId: this.timerStartSoundSelect.value,
            endbuttonId: this.timerEndSoundSelect.value,
        };

        // 3. Update the data and then refresh the UI.
        //    We'll call updateData directly without the broken debounce.
        this.updateData(newData).then(() => {
            this.updateUI();
            // Reset the timer's progress if it's not running
            if (!this.data.isRunning) {
                this.reset();
            }
        });
    }

    handleManualTimeInput(e) {
        const value = parseInt(e.target.value, 10);
        const type = e.target.dataset.type;

        if (type === 'minutes') {
            const validatedValue = isNaN(value) ? 0 : Math.max(0, Math.min(value, 90));
            this.timerMinutesRange.value = validatedValue;
        } else if (type === 'seconds') {
            const validatedValue = isNaN(value) ? 0 : Math.max(0, Math.min(value, 59));
            this.timerSecondsRange.value = validatedValue;
        }

        this._updateDisplayTextFromSliders();
        this.debouncedSave();
    }

    handleButtonDeletion(deletedId) {
        let newData = {};
        if (this.data.startSoundId === deletedId) {
            newData.startSoundId = ""; // The selected sound was deleted, reset to "None"
        }
        if (this.data.endSoundId === deletedId) {
            newData.endSoundId = ""; // The selected sound was deleted, reset to "None"
        }

        // Only update if a change is needed
        if (Object.keys(newData).length > 0) {
            this.updateData(newData);
        }
    }

    // ================================================================
    // Core Timer Logic & Rendering
    // ================================================================

    tick() {
        if (!this.data.isRunning) return;

        // This calculation is for display only; no need to save it every frame.
        const currentElapsed = (this.data.elapsedMs || 0) + (Date.now() - this.data.startTime);

        if (this.data.mode === 'timer') {
            const remainingMs = this.data.targetDurationMs - currentElapsed;

            // Check for end sound trigger (no state change here, just an action)
            if (!this.data.isLooping && this.data.endbuttonId && !this.data.hasPressedEndButton && remainingMs <= this.data.endSoundDuration) {
                this.playEndSound();
            }

            // Check for timer completion (this is a major state change)
            if (remainingMs <= 0) {
                if (this.data.isLooping) {

                    this.updateData({
                        elapsedMs: 0,
                        startTime: Date.now()
                    });
                    this.playStartSound();
                } else {

                    this.updateData({
                        isRunning: false,
                        elapsedMs: this.data.targetDurationMs // Clamp to the end
                    });

                    this.updateUI();
                    return; // Stop the animation loop
                }
            }
        } else { // Stopwatch mode
            // Check for end sound trigger
            if (!this.data.isLooping && this.data.endbuttonId && !this.data.hasPressedEndButton && this.data.targetDurationMs > 0) {
                const triggerTime = this.data.targetDurationMs - this.data.endSoundDuration;
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
        this.timerTitle.textContent = this.data.title;
        this.timerMinutesRange.value = Math.floor(this.data.targetDurationMs / 60000);
        this.timerSecondsRange.value = Math.floor((this.data.targetDurationMs % 60000) / 1000);

        this.timerMinutesValue.value = this.timerMinutesRange.value;

        this.timerSecondsValue.value = this.timerSecondsRange.value;

        this.hideOptionsToggle.checked = this.data.optionsHidden;
        this.loopCheckbox.checked = this.data.isLooping;
        this.cardElement.querySelector(`.timer-mode-radio[value="${this.data.mode}"]`).checked = true;
        this.timerStartSoundSelect.value = this.data.startbuttonId;
        this.timerEndSoundSelect.value = this.data.endbuttonId;

        // Update dynamic UI elements
        this.startPauseBtn.textContent = this.data.isRunning ? 'Pause' : 'Start';
        this.startPauseBtn.style.backgroundColor = this.data.isRunning ? 'var(--primary-color)' : 'var(--accent-color)'
        this.startPauseBtn.style.color = this.data.isRunning ? 'var(--primary-color-text)' : 'var(--accent-color-text)'
        this.optionsContainers.forEach(c => c.classList.toggle('hidden-options', this.data.optionsHidden));
        this.timerTitle.contentEditable = !this.data.optionsHidden;
        this.endSoundContainer.style.display = this.data.isLooping ? 'none' : '';
        this.startSoundLabel.textContent = this.data.isLooping ? 'Play Sound:' : 'Start with:';

        this.renderDisplay();

    }

    /**
 * Updates ONLY the timer's text display based on current slider values.
 * This is lightweight and can be called rapidly without performance issues.
 */
    _updateDisplayTextFromSliders() {
        const minutes = parseInt(this.timerMinutesRange.value, 10);
        const seconds = parseInt(this.timerSecondsRange.value, 10);
        this.timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        // Also sync the number input box next to the slider
        this.timerMinutesValue.value = minutes;
        this.timerSecondsValue.value = seconds;
    }

    renderDisplay(currentElapsed = this.data.elapsedMs) {
        let msToDisplay;
        if (this.data.mode === 'timer') {
            msToDisplay = Math.max(0, this.data.targetDurationMs - currentElapsed);
        } else { // stopwatch
            msToDisplay = currentElapsed;
        }

        // Round UP seconds because this is a soundboard for live broadcast, so it's important to USE the entire last second - displaying 1 rather than 0 helps with that.
        const totalSeconds = Math.ceil(msToDisplay / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        this.timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

        if (this.data.mode === 'timer' && msToDisplay > 0 && msToDisplay < 3000) {
            const progress = 100 - (msToDisplay / 3000) * 100;
            this.timerProgressOverlay.style.width = `${progress}%`;
        } else {
            this.timerProgressOverlay.style.width = '0%';
        }

        // Apply glow effect for finished states
        const isStopwatchFinished = this.data.mode === 'stopwatch' && currentElapsed >= this.data.targetDurationMs && this.data.targetDurationMs > 0;
        const isTimerFinished = this.data.mode === 'timer' && (this.data.targetDurationMs - currentElapsed) <= 0;
        const shouldGlow = isStopwatchFinished || (isTimerFinished && !this.data.isLooping);

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

        this.timerStartSoundSelect.value = this.data.startbuttonId;
        this.timerEndSoundSelect.value = this.data.endbuttonId;
    }

    validateSoundSelections(existingbuttonIds) {
        let newData = {}
        const startId = parseInt(this.data.startbuttonId, 10);
        const endId = parseInt(this.data.endbuttonId, 10);

        // Check if the selected start sound ID is still valid
        if (this.data.startbuttonId && !existingbuttonIds.includes(startId)) {
            newData.startbuttonId = ""; // Reset to "None"

        }

        // Check if the selected end sound ID is still valid
        if (this.data.endbuttonId && !existingbuttonIds.includes(endId)) {
            newData.endbuttonId = ""; // Reset to "None"

        }

        this.updateData(newData)
    }

    // ================================================================
    // Sound Logic
    // ================================================================

    playStartSound() {
        if (this.data.startbuttonId !== "") {
            appEvents.dispatch('sound:togglePlay', {
                buttonId: this.data.startbuttonId
            });
        }
    }

    playEndSound() {
        if (this.data.endbuttonId !== "" && !this.data.hasPressedEndButton) {

            appEvents.dispatch('sound:togglePlay', {
                buttonId: this.data.endButtonId,
                fileIndex: this.data.endSoundFileIndex
            });

            // Use updateData to persist this change
            this.updateData({ hasPressedEndButton: true });
        }
    }

    async prepareEndSound() {
        this.data.hasPressedEndButton = false;

        if (this.data.endbuttonId === "") {

            this.updateData({
                endSoundFileIndex: null,
                endSoundDuration: 0,
                hasPlayedEndSound: false
            });

            return;
        }

        const soundInfo = await new Promise(resolve => {
            appEvents.dispatch('request:nextSoundInfo', {
                buttonId: this.data.endButtonId,
                callback: (info) => resolve(info)
            });
        });

        this.updateData({
            endSoundFileIndex: soundInfo.fileIndex,
            endSoundDuration: soundInfo.duration,
            hasPlayedEndSound: false
        });
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
