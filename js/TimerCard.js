import { appEvents, debounce, randomButNot } from "./helper-functions.js";
import { RSSCard } from "./RSSCard.js";

export class TimerCard extends RSSCard {

    static getInitialData(newId) {
        return {
            id: newId,
            type: 'timer',
            title: 'New Timer',
            targetDurationMs: 30000, // Changed to 30s default
            elapsedMs: 0,
            isRunning: false,
            isLooping: false,
            mode: 'timer',
            optionsHidden: true,

            // --- UNIFIED STATE OBJECTS ---
            startAction: {
                command: "", // The raw JSON string from the <option> value
                durationMs: 0,
                triggered: false
            },
            endAction: {
                command: "", // The raw JSON string from the <option> value
                durationMs: 0,
                triggered: false
            },

        };
    }

    get templateId() {
        return 'timer-card-template';
    }

    get commands() {
        return [
            { action: 'handlePlayPause', name: 'Start/Pause Timer' },
            { action: 'reset', name: 'Reset Timer' }
        ];
    }

    constructor(cardData, soundboardManager, dbInstance) {
        super(cardData, soundboardManager, dbInstance);

        // TITLE AND DISPLAY
        /** @type {HTMLElement} */
        this.timerTitle = this.cardElement.querySelector('.timer-title');

        /** @type {HTMLElement} */
        this.timerDisplayContainer = this.cardElement.querySelector('.timer-display');

        /** @type {HTMLSpanElement} */
        this.timerDisplay = this.timerDisplayContainer.querySelector('span');

        /** @type {HTMLElement} */
        this.timerProgressContainer = this.cardElement.querySelector('.timer-progress-container');

        /** @type {HTMLElement} */
        this.timerProgressOverlay = this.cardElement.querySelector('.timer-progress-overlay');

        // BUTTONS
        /** @type {HTMLButtonElement} */// START/PAUSE BUTTON
        this.startPauseBtn = this.cardElement.querySelector('.start-pause-timer-btn');

        /** @type {HTMLButtonElement} */// RESET TIMER BUTTON
        this.resetBtn = this.cardElement.querySelector('.reset-timer-btn');

        /** @type {HTMLInputElement} */// REMOVE TIMER BUTTON
        this.removeTimerBtn = this.cardElement.querySelector('.remove-timer-btn');

        // SLIDERS & THEIR LABELS

        /** @type {HTMLInputElement} */
        this.timerMinutesRange = this.cardElement.querySelector('.timer-minutes-range');

        /** @type {HTMLInputElement} */
        this.timerMinutesValue = this.cardElement.querySelector('.timer-minutes-value');

        /** @type {HTMLInputElement} */
        this.timerSecondsRange = this.cardElement.querySelector('.timer-seconds-range');

        /** @type {HTMLInputElement} */
        this.timerSecondsValue = this.cardElement.querySelector('.timer-seconds-value');

        // TIMER OPTIONS SECTION

        /** @type {HTMLInputElement} */
        this.hideOptionsToggle = this.cardElement.querySelector('.hide-timer-options-toggle');

        /** @type {NodeListOf<HTMLElement>} */
        this.optionsContainers = this.cardElement.querySelectorAll('.timer-options-container');

        /** @type {HTMLInputElement} */
        this.loopCheckbox = this.cardElement.querySelector('.timer-loop-checkbox');

        /** @type {NodeListOf<HTMLInputElement>} */
        this.modeRadios = this.cardElement.querySelectorAll('.timer-mode-radio');
        this.modeRadios.forEach(radio => {
            radio.name = `timer-mode-${this.id}`;
        });


        // START SOUNDS SECTION

        /** @type {HTMLElement} */
        this.startActionContainer = this.cardElement.querySelector('.start-action-container');

        /** @type {HTMLLabelElement} */
        this.startActionLabel = this.cardElement.querySelector('.start-action-label');

        /** @type {HTMLSelectElement} */
        this.timerStartActionSelect = this.cardElement.querySelector('.timer-start-action');


        // END SOUNDS SECTION

        /** @type {HTMLElement} */
        this.endActionContainer = this.cardElement.querySelector('.end-action-container');

        /** @type {HTMLLabelElement} */
        this.endActionLabel = this.cardElement.querySelector('.end-action-label');

        /** @type {HTMLSelectElement} */
        this.timerEndSoundSelect = this.cardElement.querySelector('.timer-end-action');


        // BOUND EVENT HANDLERS
        this.boundHandleButtonDeletion = this.handleButtonDeletion.bind(this);
        this.boundPopulateSelectors = this._populateCommandSelectors.bind(this);

        // BOUND DEBOUNCED SAVE
        this.debouncedSave = debounce(() => this.handleControlChange(), 250);

        this.attachListeners();
        this.updateUI();
    }


    attachListeners() {
        this.startPauseBtn.addEventListener('click', () => this.handlePlayPause());
        this.resetBtn.addEventListener('click', () => this.reset());
        this.removeTimerBtn.addEventListener('click', () => this._handleDeleteCard());

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
            this.timerStartActionSelect, this.timerEndSoundSelect
        ];
        immediateChangeControls.forEach(el => el.addEventListener('change', () => this.handleControlChange()));
        this.modeRadios.forEach(radio => radio.addEventListener('change', () => this.handleControlChange()));

        // text editable minutes/seconds (these trigger on 'blur', which is fine)
        this.timerMinutesValue.addEventListener('blur', (e) => this.handleManualTimeInput(e));
        this.timerSecondsValue.addEventListener('blur', (e) => this.handleManualTimeInput(e));


        
        appEvents.on('cardDeleted', this.boundHandleButtonDeletion);

        appEvents.on('update:commands', this.boundPopulateSelectors);
    }

    destroy() {
        // Stop any active animation loops
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        appEvents.off('cardDeleted', this.boundHandleButtonDeletion);
        appEvents.off('update:commands', this.boundPopulateSelectors)
    }

    // ================================================================
    // Event Handlers
    // ================================================================

    startTimer() {
        // 1. Update the state with the current start time
        this.updateData({ startTime: Date.now() });

        // 2. Execute the start action if it exists and hasn't been triggered yet
        const startAction = this.data.startAction;
        if (startAction.command && !startAction.triggered) {
            this._executeCommand(startAction.command);
            // Update the state to mark it as triggered
            const newStartActionState = { ...startAction, triggered: true };
            this.updateData({ startAction: newStartActionState });
        }

        // 3. Start the timer loop
        this.tick();
    }

    handlePlayPause() {
        const isFinished = this.data.mode === 'timer' && this.data.elapsedMs >= this.data.targetDurationMs;

        if (!this.data.isRunning && isFinished) {
            this.reset();
            // After reset, the state is now !isRunning and elapsedMs is 0,
            // so we can just continue to the logic below to start it fresh.
        }

        const newIsRunning = !this.data.isRunning;
        this.updateData({ isRunning: newIsRunning });

        if (newIsRunning) {
            this.startTimer();
        } else {
            // Pausing
            const newElapsedMs = (this.data.elapsedMs || 0) + (Date.now() - this.data.startTime);
            cancelAnimationFrame(this.animationFrameId);
            this.updateData({ elapsedMs: newElapsedMs });
        }
        this.updateUI();
    }

    reset() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Create new, clean action objects with the 'triggered' flag reset
        const newStartAction = { ...this.data.startAction, triggered: false };
        const newEndAction = { ...this.data.endAction, triggered: false };

        this.updateData({
            isRunning: false,
            elapsedMs: 0,
            startAction: newStartAction,
            endAction: newEndAction
        });

        this.updateUI();
    }

    
    handleControlChange() {
        // Read all UI values
        const minutes = parseInt(this.timerMinutesRange.value, 10);
        const seconds = parseInt(this.timerSecondsRange.value, 10);
        const newTargetDurationMs = (minutes * 60 + seconds) * 1000;

        const newStartCommand = this.timerStartActionSelect.value;
        const newEndCommand = this.timerEndSoundSelect.value;

        // Update the simple data properties directly
        this.updateData({
            targetDurationMs: newTargetDurationMs,
            optionsHidden: this.hideOptionsToggle.checked,
            isLooping: this.loopCheckbox.checked,
            mode: this.cardElement.querySelector('.timer-mode-radio:checked').value,
        });

        // Prepare the actions, which will update their own state objects
        this._prepareAction('startAction', newStartCommand);
        this._prepareAction('endAction', newEndCommand);

        this.updateUI();
    }

    handleManualTimeInput(e) {
        const value = parseInt(e.target.value, 10);
        const type = e.target.dataset.type;

        if (type === 'minutes') {
            const validatedValue = isNaN(value) ? 0 : Math.max(0, Math.min(value, 90));
            this.timerMinutesRange.value = String(validatedValue);
        } else if (type === 'seconds') {
            const validatedValue = isNaN(value) ? 0 : Math.max(0, Math.min(value, 59));
            this.timerSecondsRange.value = String(validatedValue);
        }

        this._updateDisplayTextFromSliders();
        this.debouncedSave();
    }

    handleButtonDeletion({ deletedId }) {
        let needsUpdate = false;
        let newStartAction = this.data.startAction;
        let newEndAction = this.data.endAction;

        if (this.data.startAction.command) {
            const command = JSON.parse(this.data.startAction.command);
            if (command.targetId === deletedId) {
                newStartAction = { command: "", durationMs: 0, triggered: false };
                needsUpdate = true;
            }
        }

        if (this.data.endAction.command) {
            const command = JSON.parse(this.data.endAction.command);
            if (command.targetId === deletedId) {
                newEndAction = { command: "", durationMs: 0, triggered: false };
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            this.updateData({ startAction: newStartAction, endAction: newEndAction });
            this.updateUI(); // Refresh the dropdowns to show "None"
        }
    }

    // ================================================================
    // Core Timer Logic & Rendering
    // ================================================================

    tick() {
        if (!this.data.isRunning) return;

        const currentElapsed = (this.data.elapsedMs || 0) + (Date.now() - this.data.startTime);
        const remainingMs = this.data.targetDurationMs - currentElapsed;

        // --- Unified End Action Trigger Logic ---
        const endAction = this.data.endAction;
        if (endAction.command && !endAction.triggered && remainingMs <= endAction.durationMs) {
            this._executeCommand(endAction.command);

            // Use the correct syntax to update the nested 'triggered' flag
            const newEndActionState = { ...endAction, triggered: true };
            this.updateData({ endAction: newEndActionState });
        }

        // --- Unified Timer Completion Logic ---
        if (this.data.mode === 'timer' && remainingMs <= 0) {
            if (this.data.isLooping) {
                this.reset();
                this.handlePlayPause(); // This will auto-start the next loop
            } else {
                this.updateData({ isRunning: false, elapsedMs: this.data.targetDurationMs });
                this.updateUI();
            }
            return; // Stop the loop for this frame
        }

        this.renderDisplay(currentElapsed);
        this.animationFrameId = requestAnimationFrame(() => this.tick());
    }

    _executeCommand(commandString) {
        if (!commandString) return;
        try {
            const commandData = JSON.parse(commandString);
            // Dispatch the clean event with only the necessary data
            appEvents.dispatch('card:triggerAction', {
                targetId: commandData.targetId,
                action: commandData.action
            });
        } catch (e) {
            console.error("Failed to execute command:", e);
        }
    }

    /**
    * Processes a command string from the UI, determines its duration, 
    * and saves the complete action object to the database.
    * @param {'startAction' | 'endAction'} actionType 
    * @param {string} commandString The JSON string from the <option> value.
    */
    async _prepareAction(actionType, commandString) {
        if (!commandString) {
            return this.updateData({ [actionType]: { command: "", durationMs: 0, triggered: false } });
        }

        const command = JSON.parse(commandString);
        let durationMs = 0;

        if (command.hasDuration) {
            const soundInfo = await new Promise(resolve => {
                // Use the clearer event name
                appEvents.dispatch('request:commandDuration', {
                    buttonId: command.targetId,
                    callback: (info) => resolve(info)
                });
            });
            durationMs = soundInfo.duration;
        }

        this.updateData({
            [actionType]: {
                command: commandString,
                durationMs: durationMs,
                triggered: false
            }
        });
    }

    updateUI() {
        // Sync UI controls with the state object
        this.timerTitle.textContent = this.data.title;
        this.timerMinutesRange.value = String(Math.floor(this.data.targetDurationMs / 60000));
        this.timerSecondsRange.value = String(Math.floor((this.data.targetDurationMs % 60000) / 1000));

        this.timerMinutesValue.value = this.timerMinutesRange.value;

        this.timerSecondsValue.value = this.timerSecondsRange.value;

        this.hideOptionsToggle.checked = this.data.optionsHidden;
        this.loopCheckbox.checked = this.data.isLooping;

        /** @type {HTMLInputElement} */
        const timerModeRadio = this.cardElement.querySelector(
            `.timer-mode-radio[value="${this.data.mode}"]`
        );

        timerModeRadio.checked = true;


        this.timerStartActionSelect.value = this.data.startAction.command || "";
        this.timerEndSoundSelect.value = this.data.endAction.command || "";

        // Update dynamic UI elements
        this.startPauseBtn.textContent = this.data.isRunning ? 'Pause' : 'Start';
        this.startPauseBtn.style.backgroundColor = this.data.isRunning ? 'var(--primary-color)' : 'var(--accent-color)'
        this.startPauseBtn.style.color = this.data.isRunning ? 'var(--primary-color-text)' : 'var(--accent-color-text)'
        this.optionsContainers.forEach(c => c.classList.toggle('hidden-options', this.data.optionsHidden));
        this.timerTitle.contentEditable = String(!this.data.optionsHidden)
        this.endActionContainer.style.display = this.data.isLooping ? 'none' : '';
        this.startActionLabel.textContent = this.data.isLooping ? 'Play Sound:' : 'Start with:';

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
        this.timerMinutesValue.value = String(minutes);
        this.timerSecondsValue.value = String(seconds);
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

}
