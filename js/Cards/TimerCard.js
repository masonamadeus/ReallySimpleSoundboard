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

    // #region Settings Modal

     getSettingsConfig() {
        return [
            {
                title: ``,
                groups: [
                    {
                        type: 'title-and-color',
                        controls: [
                            { type: 'text', key: 'title', label: '' }
                        ]
                    },
                    {
                        type: 'radio-group', // A new group type for the mode
                        controls: [
                            {
                                type: 'radio', key: 'mode', options: [
                                    { label: 'Timer', value: 'timer' },
                                    { label: 'Stopwatch', value: 'stopwatch' }
                                ]
                            }
                        ]
                    },
                    {
                        type: 'sliders',
                        controls: [
                            { type: 'range', key: 'minutes', label: 'Minutes', min: 0, max: 90, showValue: true, value: Math.floor(this.data.targetDurationMs / 60000) },
                            { type: 'range', key: 'seconds', label: 'Seconds', min: 0, max: 59, showValue: true, value: Math.floor((this.data.targetDurationMs % 60000) / 1000) }
                        ]
                    },
                    {
                        type: 'checkbox-group',
                        controls: [
                            { type: 'checkbox', key: 'isLooping', label: 'Auto Restart' }
                        ]
                    }
                ]
            },
            {
                title: 'Actions',
                groups: [
                    {
                        type: 'actions-list', // A simple container type
                        controls: [
                            // This now tells the Modal class to build the dropdowns
                            { type: 'command-select', key: 'startAction', label: 'Start with:', itemSource: 'allCommands' },
                            { type: 'command-select', key: 'endAction', label: 'End with:', itemSource: 'allCommands' }
                        ]
                    }
                ]
            },
            {
                title: 'Danger Zone',
                groups: [
                    {
                        type: 'actions-row',
                        controls: [
                            // The onClick function is replaced with a simple 'action' string
                            { type: 'button', label: 'Delete Timer', action: 'delete-card', class: 'danger' }
                        ]
                    }
                ]
            }
        ];
    }

    _handleModalAction(e) {
        const { action } = e.detail;
        if (action === 'delete-card') {
            this._handleDeleteCard();
        }
    }

    async _handleModalInput(e) {
        const { key, value } = e.detail;

        // Create a temporary data object to build the update
        const updatedData = { ...this.data, [key]: value };

        // Re-calculate targetDurationMs if minutes or seconds changed
        if (key === 'minutes' || key === 'seconds') {
            const minutes = key === 'minutes' ? parseInt(value, 10) : Math.floor(this.data.targetDurationMs / 60000);
            const seconds = key === 'seconds' ? parseInt(value, 10) : Math.floor((this.data.targetDurationMs % 60000) / 1000);
            updatedData.targetDurationMs = (minutes * 60 + seconds) * 1000;
        }

        // Re-prepare action objects if they were changed
        if (key === 'startAction') {
            updatedData.startAction = await this._prepareAction(value);
        }
        if (key === 'endAction') {
            updatedData.endAction = await this._prepareAction(value);
        }

        // If the mode changed while the timer wasn't running, reset it.
        if (key === 'mode' && value !== this.data.mode && !this.data.isRunning) {
            this.reset();
        }
        
        // Update the card's state with all the changes
        this.updateData(updatedData);
    }

    //#endregion

}
