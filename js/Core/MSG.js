export class EventManager {
    constructor() {
        this.listeners = {};

        // ====================================================================
        // Central Event Contract
        // All component communication MUST use one of the following events.
        // ====================================================================

        this.EVENTS = {
            // Fired AFTER the central state has been updated.
            // UI Managers listen for these to re-render themselves.
            STATE_CHANGED: 'state:changed',
            LAYOUT_CHANGED: 'layout:changed',
            CARDS_CHANGED: 'cards:changed', // For when card data itself changes
            REARRANGE_MODE_CHANGED: 'rearrange:changed', // for toggling rearrange mode
            SOUNDBOARD_DELETED_CARD: 'soundboard:deletedCard', // Legacy, but useful

            // Sound-specific events
            SOUNDCARD_PRIORITY_STARTED: 'soundcard:priorityStarted',
            SOUNDCARD_PRIORITY_ENDED: 'soundcard:priorityEnded',
        };

        this.ACTIONS = {
            // GLOBAL ACTIONS
            REQUEST_CONFIRMATION: 'request:confirmation',
            
            // LAYOUT ACTIONS
            REQUEST_ADD_CARD: 'request:addCard',
            REQUEST_REMOVE_CARD: 'request:removeCard',
            REQUEST_MOVE_CARD: 'request:moveCard',
            REQUEST_RESIZE_CARD: 'request:resizeCard',

            // CARD DATA ACTIONS
            REQUEST_UPDATE_CARD_DATA: 'request:updateCardData',
            REQUEST_REGISTER_COMMANDS: 'request:registerCommands',

            // BOARD ACTIONS
            REQUEST_SWITCH_BOARD: 'request:switchBoard',
            REQUEST_DELETE_BOARD: 'request:deleteBoard',
            REQUEST_CREATE_BOARD: 'request:createBoard',

            // CONTROL DOCK ACTIONS
            REQUEST_OPEN_STORAGE_DATA: 'request:openStorageData',
            REQUEST_OPEN_MANAGE_BOARDS: 'request:openManageBoards',
            REQUEST_TOGGLE_REARRANGE_MODE: 'request:toggleRearrangeMode',
            REQUEST_OPEN_THEME_MANAGER: 'request:openThemeManager',

            // MIGRATION ACTIONS
            MIGRATION_NEEDED_CARD: 'state:migrationNeededCard',
        };

        this.STATE_ACTIONS = {
            INITIALIZE_STATE: 'state:initialize',
            CARD_ADDED: 'state:cardAdded',
            CARD_REMOVED: 'state:cardRemoved',
            LAYOUT_UPDATED: 'state:layoutUpdated',
            REARRANGE_MODE_TOGGLED: 'state:rearrangeModeToggled',
        };


        // For backwards compatibility and ease of access
        this.is = { ...this.EVENTS, ...this.ACTIONS, ...this.STATE_ACTIONS };

        this.debugLevel = 0; // -1 is nothing, 0 is all
    }

    /**
     * Subscribe to an event.
     * @param {string} eventName The name of the event to listen for.
     * @param {Function} listener The callback function to execute.
     */
    on(eventName, listener) {
        if (!this.listeners[eventName]) {
            this.listeners[eventName] = [];
        }
        this.listeners[eventName].push(listener);
    }

    /**
     * Unsubscribe from an event.
     * @param {string} eventName The name of the event.
     * @param {Function} listenerToRemove The specific listener to remove.
     */
    off(eventName, listenerToRemove) {
        if (!this.listeners[eventName]) return;

        this.listeners[eventName] = this.listeners[eventName].filter(
            listener => listener !== listenerToRemove
        );
    }

    /**
     * Dispatch an event to all subscribers.
     * @param {string} eventName The name of the event to dispatch.
     * @param {any} [data] Optional data to pass to the listeners.
     */
    say(eventName, data) {
        if (!this.listeners[eventName]) return;

        this.log(`Event Fired: ${eventName}`, 1, data);
        this.listeners[eventName].forEach(listener => listener(data));
    }

    confirm(message, btnYesText = 'Yes', btnNoText = 'No') {
        return new Promise((resolve) => {
            this.say(this.ACTIONS.REQUEST_CONFIRMATION, {
                message: message,
                btnYesText: btnYesText,
                btnNoText: btnNoText,
                // --------------------------------------------------------------
                // The crucial part: we pass the promise's resolve function as the callback.
                // When the SoundboardManager calls this, it will resolve our promise.
                onConfirm: resolve
            });
        });
    }

    setDebug(lvl) {
        console.log(
            `DEBUG LEVEL CHANGED FROM ${this.debugLevel} TO ${lvl}`);

        this.debugLevel = parseInt(lvl)
    }

    log(string, lvl = 0, obj = null) {
        const formattedString = typeof string === 'string' ? string : JSON.stringify(string);
        if (this.debugLevel === lvl || this.debugLevel === 0) {
            console.groupCollapsed(`DEBUG LVL ${lvl}: ${formattedString}`);
            if (obj !== null) {
                console.log('DATA:', obj);
            }
            console.groupEnd();
        }
    }
}

export const MSG = new EventManager();
