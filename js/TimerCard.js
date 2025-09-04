import { debounce, randomButNot } from "./helper-functions.js";
import { Card } from "./-Card.js";
import { MSG } from './MSG.js';

export class TimerCard extends Card {

    static Default() {
        return {
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
                commandId: "", // The raw JSON string from the <option> value
                durationMs: 0,
                args: {}
            },
            endAction: {
                commandId: "", // The raw JSON string from the <option> value
                durationMs: 0,
                args: {}
            },

        };
    }

    get templateId() {
        return 'timer-card-template';
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


        // START ACTIONS SECTION
        /** @type {HTMLElement} */
        this.startActionContainer = this.cardElement.querySelector('.start-action-container');

        /** @type {HTMLLabelElement} */
        this.startActionLabel = this.cardElement.querySelector('.start-action-label');

        /** @type {HTMLSelectElement} */
        this.timerStartActionSelect = this.cardElement.querySelector('.timer-start-action');


        // END ACTIONS SECTION
        /** @type {HTMLElement} */
        this.endActionContainer = this.cardElement.querySelector('.end-action-container');

        /** @type {HTMLLabelElement} */
        this.endActionLabel = this.cardElement.querySelector('.end-action-label');

        /** @type {HTMLSelectElement} */
        this.timerEndActionSelect = this.cardElement.querySelector('.timer-end-action');


        // DEBOUNCED SAVE FOR SLIDER VALUES
        this.debouncedSliderSave = debounce(() => this.handleSliderChange(), 200)

        // BOUND EVENT HANDLER - why?? I forget??
        this.boundHandleButtonDeletion = this.handleButtonDeletion.bind(this);

        this._initialize();
    }

    _registerCommands() {
        this.registerCommand({
            name: "Start/Pause",
            preload: null,
            execute: this.handlePlayPause
        });

        this.registerCommand({
            name: "Reset",
            preload: null,
            execute: this.reset
        })
    }

    _initialize(){
        this._attachListeners();
        this.updateUI();
        if (this.data.isRunning){
            this.tick();
        }
    }

    _attachListeners() {

        // MAIN CARD CONTROL BUTTONS
        this.startPauseBtn.addEventListener('click', () => this.handlePlayPause());
        this.resetBtn.addEventListener('click', () => this.reset());
        this.removeTimerBtn.addEventListener('click', () => this._handleDeleteCard());


        // OPTIONS/SETTINGS THAT ARE SIMPLE TOGGLES
         const immediateChangeControls = [
            this.hideOptionsToggle,
            this.loopCheckbox,
        ];
        immediateChangeControls.forEach(el => el.addEventListener('change', () => this.handleSettingsChange()));
        this.modeRadios.forEach(radio => radio.addEventListener('change', () => this.handleSettingsChange()));

        // The action dropdowns use their dedicated, more expensive handler.
        this.timerStartActionSelect.addEventListener('change', () => this.handleActionChange());
        this.timerEndActionSelect.addEventListener('change', () => this.handleActionChange());


        // SLIDERS

        this.timerMinutesRange.addEventListener('input', () => {
            this._updateDisplayTextFromSliders();
            this.debouncedSliderSave()
        });
        this.timerSecondsRange.addEventListener('input', () => {
            this._updateDisplayTextFromSliders();
            this.debouncedSliderSave();
        });
       

        // TEXT EDITABLE minutes/seconds/title (these trigger on 'blur', which is fine)
        this.timerMinutesValue.addEventListener('blur', (e) => this.handleManualTimeInput(e));
        this.timerSecondsValue.addEventListener('blur', (e) => this.handleManualTimeInput(e));
        this.timerTitle.addEventListener('blur', (e) => {
            //@ts-ignore
            const newTitle = e.target.textContent.trim();
            if (newTitle !== this.data.title) {
                this.updateData({ title: newTitle });
            }
        });

        MSG.on(MSG.is.SOUNDBOARD_DELETED_CARD, this.boundHandleButtonDeletion);
    }

    destroy() {
        // Stop any active animation loops
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        MSG.off(MSG.is.SOUNDBOARD_DELETED_CARD, this.boundHandleButtonDeletion);
        super.destroy();
    }

    // ================================================================
    // Event Handlers
    // ================================================================

    onCommandsChanged(allCommands){
        this.populateCommandSelectors(allCommands);
    }

    populateCommandSelectors(availableCommands) {
        const startActionSelect = this.timerStartActionSelect;
        const endActionSelect = this.timerEndActionSelect;

        startActionSelect.innerHTML = '<option value="">None</option>';
        endActionSelect.innerHTML = '<option value="">None</option>';

        // The 'command' variable is now one of our rich Command Objects
        availableCommands.forEach(command => {
            // A timer cannot trigger its own commands
            if (command.targetCard === this.id) return;

            const option = document.createElement('option');
            // Use the new properties for display text and value
            option.textContent = command.name;
            option.value = command.id;

            startActionSelect.add(option);
            //@ts-ignore
            endActionSelect.add(option.cloneNode(true));
        });

        // Restore the selection using the correct property from our state
        startActionSelect.value = this.data.startAction.commandId || "";
        endActionSelect.value = this.data.endAction.commandId || "";
    }


    async _prepareAction(actionType, commandId) {
        // If the selection is "None", clear the action
        if (!commandId) {
            return this.updateData({ [actionType]: { commandId: "", durationMs: 0, indexToPlay: 0, triggered: false } });
        }

        let durationMs = 0;
        let args = {};

        const ticket = await this.preloadCommand(commandId);

        if (ticket){
            durationMs = ticket.durationMs;
            args = ticket.args;
        }

        // Save the new, simple state.
        await this.updateData({
            [actionType]: {
                commandId: commandId,
                durationMs: durationMs,
                args: args,
                triggered: false
            }
        });
    }

    /**
     * Handles changes to settings like duration, looping, or mode.
     * This is lightweight and does NOT re-prepare actions.
     */
    async handleSettingsChange() {
        //@ts-ignore
        const newMode = this.cardElement.querySelector('.timer-mode-radio:checked').value

        if (newMode != this.data.mode && !this.data.isRunning){
            this.reset();
        }

        await this.updateData({
            optionsHidden: this.hideOptionsToggle.checked,
            isLooping: this.loopCheckbox.checked,
            mode: newMode,
        });

        this.updateUI();
    }

    async handleSliderChange() {
        const minutes = parseInt(this.timerMinutesRange.value, 10);
        const seconds = parseInt(this.timerSecondsRange.value, 10);

        await this.updateData({
            targetDurationMs: (minutes * 60 + seconds) * 1000,
        });
    }

    /**
     * Handles changes ONLY from the start/end action dropdowns.
     * This is the ONLY place we should prepare actions.
     */
    async handleActionChange() {
        const newStartCommandId = this.timerStartActionSelect.value;
        const newEndCommandId = this.timerEndActionSelect.value;

        // Run both async preparations in parallel.
        await Promise.all([
            this._prepareAction('startAction', newStartCommandId),
            this._prepareAction('endAction', newEndCommandId)
        ]);
        
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
        this.debouncedSliderSave();
    }

    /**
    * Updates ONLY the timer's text display based on current slider values.
    * This is lightweight and can be called rapidly without performance issues.
    */
    _updateDisplayTextFromSliders() {
        const minutes = parseInt(this.timerMinutesRange.value, 10);
        const seconds = parseInt(this.timerSecondsRange.value, 10);
        if (this.data.mode === 'timer'){
            this.timerDisplay.textContent =
            `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
        // Also sync the number input box next to the slider
        this.timerMinutesValue.value = String(minutes);
        this.timerSecondsValue.value = String(seconds);
    }

    handleButtonDeletion({ deletedId }) {
    let needsUpdate = false;
    let newStartAction = { ...this.data.startAction };
    let newEndAction = { ...this.data.endAction };

    // Check if the start action's command is tied to the deleted card
    if (newStartAction.commandId && newStartAction.commandId.startsWith(deletedId)) {
        newStartAction = { commandId: "", durationMs: 0, indexToPlay: 0, triggered: false };
        needsUpdate = true;
    }

    // Check if the end action's command is tied to the deleted card
    if (newEndAction.commandId && newEndAction.commandId.startsWith(deletedId)) {
        newEndAction = { commandId: "", durationMs: 0, indexToPlay: 0, triggered: false };
        needsUpdate = true;
    }

    if (needsUpdate) {
        this.updateData({ startAction: newStartAction, endAction: newEndAction }).then(() => {
            this.updateUI(); // Refresh the dropdowns to show "None"
        });
    }
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



    // ================================================================
    // Core Timer Logic & Rendering
    // ================================================================

    startTimer() {
        // 1. Update the state with the current start time
        this.updateData({ startTime: Date.now() });

        // 2. Execute the start action if it exists and hasn't been triggered yet
        const startAction = this.data.startAction;
        if (startAction.commandId && !startAction.triggered) {
            this.executeCommand(startAction.commandId, startAction.args);
            // Update the state to mark it as triggered
            const newStartActionState = { ...startAction, triggered: true };
            this.updateData({ startAction: newStartActionState });
        }

        // 3. Start the timer loop
        this.tick();
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

    tick() {
        if (!this.data.isRunning) return;

        const currentElapsed = (this.data.elapsedMs || 0) + (Date.now() - this.data.startTime);
        const remainingMs = this.data.targetDurationMs - currentElapsed;

        // --- Unified End Action Trigger Logic ---
        const endAction = this.data.endAction;
        if (endAction.commandId && !endAction.triggered && remainingMs <= endAction.durationMs) {
            MSG.log(`Triggering End Action from ${this.data.title}`)
            this.executeCommand(endAction.commandId, endAction.args);
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


        this.timerStartActionSelect.value = this.data.startAction.commandId || "";
        this.timerEndActionSelect.value = this.data.endAction.commandId || "";

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

}
