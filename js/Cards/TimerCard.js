import { debounce, randomButNot } from "../Core/helper-functions.js";
import { Card } from "./BaseCard.js";
import { MSG } from '../Core/MSG.js';

export class TimerCard extends Card {

    static Default() {
        return {
            type: 'timer',
            title: 'New Timer',
            targetDurationMs: 30000, // 30s default
            elapsedMs: 0,
            isRunning: false,
            isLooping: false,
            mode: 'timer',

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

    //#region Constructor

    constructor(cardData) {
        super(cardData);

        // A much shorter list of DOM elements!
        this.timerTitle = this.cardElement.querySelector('.timer-title');
        this.timerDisplay = this.cardElement.querySelector('.timer-display span');
        this.timerProgressOverlay = this.cardElement.querySelector('.timer-progress-overlay');
        this.startPauseBtn = this.cardElement.querySelector('.start-pause-timer-btn');
        this.animationFrameId = null;

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

    _initialize() {
        this._attachListeners();
        this.updateUI();
        if (this.data.isRunning) {
            this.updateData({ startTime: Date.now() });
            this.tick();
        }
    }

    _attachListeners() {
        this.cardElement.addEventListener('click', (event) => {
            const actionElement = event.target.closest('[data-action]');
            if (!actionElement) return;

            const action = actionElement.dataset.action;
            switch (action) {
                case 'start-pause':
                    this.handlePlayPause();
                    break;
                case 'reset':
                    this.reset();
                    break;
                case 'settings':
                    this.openSettings();
                    break;
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




    async _prepareAction(commandId) {
        if (!commandId) {
            return { commandId: "", durationMs: 0, args: {}, triggered: false };
        }

        const ticket = await this.preloadCommand(commandId);
        return {
            commandId: commandId,
            durationMs: ticket.durationMs,
            args: ticket.args,
            triggered: false
        };
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
        const isFinished = (this.data.mode === 'timer' && this.data.elapsedMs >= this.data.targetDurationMs) ||
            (this.data.mode === 'stopwatch' && this.data.targetDurationMs > 0 && this.data.elapsedMs >= this.data.targetDurationMs);

        if (!this.data.isRunning && isFinished) {
            this.reset();
        }

        const newIsRunning = !this.data.isRunning;
        const dataToUpdate = { isRunning: newIsRunning };

        if (newIsRunning) {
            // If we are starting the timer, also set the start time.
            dataToUpdate.startTime = Date.now();

            this.updateData(dataToUpdate);
            this.startTimer();
        } else {
            // If we are pausing, calculate the new elapsed time.
            cancelAnimationFrame(this.animationFrameId);
            dataToUpdate.elapsedMs = (this.data.elapsedMs || 0) + (Date.now() - this.data.startTime);

            this.updateData(dataToUpdate);
        }

        this.updateUI();
    }



    // ================================================================
    // Core Timer Logic & Rendering
    // ================================================================

    startTimer() {
        const startAction = this.data.startAction;
        if (startAction.commandId && !startAction.triggered) {
            this.executeCommand(startAction.commandId, startAction.args);
            const newStartActionState = { ...startAction, triggered: true };
            // This is the only updateData call left in this function.
            this.updateData({ startAction: newStartActionState });
        }
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
        const endAction = this.data.endAction;

        // --- End Action Trigger Logic (for pre-firing the sound) ---
        if (endAction.commandId && !endAction.triggered && remainingMs <= endAction.durationMs) {
            MSG.log(`Triggering End Action from ${this.data.title}`)
            this.executeCommand(endAction.commandId, endAction.args);
            const newEndActionState = { ...endAction, triggered: true };
            this.updateData({ endAction: newEndActionState });
        }

        const isTimerFinished = this.data.mode === 'timer' && remainingMs <= 0;
        const isStopwatchFinished = this.data.mode === 'stopwatch' && this.data.targetDurationMs > 0 && currentElapsed >= this.data.targetDurationMs;

        if (isTimerFinished || isStopwatchFinished) {

            if (endAction.commandId && !endAction.triggered) {
                MSG.log(`Fallback End Action Fired from ${this.data.title}`)
                this.executeCommand(endAction.commandId, endAction.args);
            }

            if (this.data.isLooping) {
                this.reset();
                this.handlePlayPause(); // This will auto-start the next loop
            } else {
                this.updateData({ isRunning: false, elapsedMs: this.data.targetDurationMs });
                this.updateUI();
            }
            return; // IMPORTANT: Stop the loop for this frame
        }



        this.renderDisplay(currentElapsed);
        this.animationFrameId = requestAnimationFrame(() => this.tick());
    }



    renderDisplay(currentElapsed = this.data.elapsedMs) {
        console.log('renderdisplay')
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


        // Update dynamic UI elements
        this.startPauseBtn.textContent = this.data.isRunning ? 'Pause' : 'Start';
        this.startPauseBtn.style.backgroundColor = this.data.isRunning ? 'var(--primary-color)' : 'var(--accent-color)'
        this.startPauseBtn.style.color = this.data.isRunning ? 'var(--primary-color-text)' : 'var(--accent-color-text)'

        this.renderDisplay();

    }

    getSettingsDOM() {
        // 1. Clone the template
        const template = document.getElementById('timer-settings-template');
        const settingsDOM = template.content.cloneNode(true);

        // 2. Grab references to the inputs (Notice we dropped the span displays)
        const titleInput = settingsDOM.querySelector('.setting-title');
        const modeTimerRadio = settingsDOM.querySelector('.setting-mode-timer');
        const modeStopwatchRadio = settingsDOM.querySelector('.setting-mode-stopwatch');
        const minutesInput = settingsDOM.querySelector('.setting-minutes');
        const secondsInput = settingsDOM.querySelector('.setting-seconds');
        const loopCheck = settingsDOM.querySelector('.setting-loop');
        const startSelect = settingsDOM.querySelector('.setting-start-action');
        const endSelect = settingsDOM.querySelector('.setting-end-action');

        // 3. Populate current data
        titleInput.value = this.data.title;
        loopCheck.checked = this.data.isLooping;

        if (this.data.mode === 'stopwatch') {
            modeStopwatchRadio.checked = true;
        } else {
            modeTimerRadio.checked = true;
        }

        // Calculate and set initial minutes and seconds into the inputs
        const currentMinutes = Math.floor(this.data.targetDurationMs / 60000);
        const currentSeconds = Math.floor((this.data.targetDurationMs % 60000) / 1000);
        minutesInput.value = currentMinutes;
        secondsInput.value = currentSeconds;

        // 4. Populate Command Selectors (Dropdowns)
        const populateSelect = (selectEl, currentValue) => {
            selectEl.add(new Option('None', '')); 
            this.allCommands.forEach(cmd => {
                const option = new Option(cmd.name, cmd.id);
                selectEl.add(option);
            });
            selectEl.value = currentValue || '';
        };

        populateSelect(startSelect, this.data.startAction?.commandId);
        populateSelect(endSelect, this.data.endAction?.commandId);

        // 5. Attach DIRECT Event Listeners
        titleInput.addEventListener('input', (e) => {
            this.updateData({ title: e.target.value });
            this.timerTitle.textContent = e.target.value;
        });

        // Time logic: Update targetDurationMs whenever either input is typed in
        const updateTime = () => {
            // Parse values. If they temporarily delete the number (empty string), treat as 0
            const mins = parseInt(minutesInput.value, 10) || 0;
            const secs = parseInt(secondsInput.value, 10) || 0;
            
            const newDurationMs = (mins * 60 + secs) * 1000;
            this.updateData({ targetDurationMs: newDurationMs });
            
            // If not running, update the display on the card instantly behind the modal
            if (!this.data.isRunning) {
                this.data.targetDurationMs = newDurationMs; 
                this.renderDisplay(); 
            }
        };

        // Validation logic: Fix weird numbers when the user clicks away (blurs)
        const formatAndClampTime = () => {
            let mins = parseInt(minutesInput.value, 10) || 0;
            let secs = parseInt(secondsInput.value, 10) || 0;
            
            if (mins < 0) mins = 0;
            if (secs < 0) secs = 0;
            if (secs > 59) secs = 59; // Stop seconds from going over 59
            
            minutesInput.value = mins;
            secondsInput.value = secs;
            
            updateTime();
        };

        // 'input' fires as they type for instant feedback
        minutesInput.addEventListener('input', updateTime);
        secondsInput.addEventListener('input', updateTime);
        
        // 'change' fires when they click away, perfect for clamping wild numbers
        minutesInput.addEventListener('change', formatAndClampTime);
        secondsInput.addEventListener('change', formatAndClampTime);

        // Mode and Loop logic
        const handleModeChange = (e) => {
            const newMode = e.target.value;
            this.updateData({ mode: newMode });
            if (newMode !== this.data.mode && !this.data.isRunning) {
                this.reset();
            }
        };
        modeTimerRadio.addEventListener('change', handleModeChange);
        modeStopwatchRadio.addEventListener('change', handleModeChange);
        loopCheck.addEventListener('change', (e) => this.updateData({ isLooping: e.target.checked }));

        // Command Actions logic
        startSelect.addEventListener('change', async (e) => {
            const action = await this._prepareAction(e.target.value);
            this.updateData({ startAction: action });
        });

        endSelect.addEventListener('change', async (e) => {
            const action = await this._prepareAction(e.target.value);
            this.updateData({ endAction: action });
        });

        // Delete Button
        settingsDOM.querySelector('.delete-card-btn').addEventListener('click', () => {
            this._handleDeleteCard();
            if (this.settingsModal) this.settingsModal.close();
        });

        return settingsDOM;
    }


}
