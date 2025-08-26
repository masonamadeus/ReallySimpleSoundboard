import { appEvents } from './helper-functions.js';

export class RSSCard {
    /**
     * The constructor for all card types.
     * @param {object} cardData The initial data for the card from the database.
     * @param {import('./SoundboardManager.js').SoundboardManager} soundboardManager A reference to the main manager.
     * @param {import('./SoundboardDB.js').SoundboardDB} dbInstance A reference to the database.
     */
    constructor(cardData, soundboardManager, dbInstance) {
        this.data = cardData;
        this.manager = soundboardManager;
        this.db = dbInstance;
        this.id = this.data.id;

        // --- Standardized Lifecycle ---
        this.cardElement = this._createElement();

        this.boundCommandHandler = this._handleCommand.bind(this);
        appEvents.on('card:triggerAction', this.boundCommandHandler);
    }

    /**
     * The private handler for the generic 'card:triggerAction' event.
     */
    _handleCommand({ targetId, action, params }) {
        if (this.id === targetId && typeof this[action] === 'function') {
            this[action](params); // e.g., calls this.togglePlay() on a SoundCard instance
        }
    }


    /**
     * A getter that child classes MUST override to provide their template ID.
     * @returns {string} The template ID for the card (e.g., 'timer-card-template').
     */
    get templateId() {
        throw new Error('Child class must implement templateId getter.');
    }

    /**
     * Returns a list of actions that can be triggered by other cards.
     * Child classes should override this.
     * @returns {Array<{action: string, name: string}>}
     */
    get commands() {
        return []; // Default is not triggerable
    }

    /**
     * Creates the card's main HTML element from a template.
     * @returns {HTMLElement}
     */
    _createElement() {
        const template = document.getElementById(this.templateId);
        if (!template) {
            throw new Error(`Template not found: ${this.templateId}`);
        }
        //@ts-ignore
        const cardElement = template.content.firstElementChild.cloneNode(true);

        cardElement.dataset.cardId = this.data.id;
        cardElement.dataset.cardType = this.data.type;
        cardElement.setAttribute('draggable', this.manager.isRearranging);

        return cardElement;
    }

    /**
     * Updates the card's data object and saves it to the database.
     */
    async updateData(newData) {
        if (Object.keys(newData).length === 0) {
            return;
        }
        this.data = { ...this.data, ...newData };
        await this.db.save(this.data.id, this.data);
    }

    /**
     * Placeholder for attaching event listeners. Child classes MUST implement this.
     */
    attachListeners() {
        // To be implemented by child class
    }

    /**
     * Placeholder for updating the UI. Child classes MUST implement this.
     */
    updateUI() {
        // To be implemented by child class
    }

    /**
     * Placeholder for cleanup logic (e.g., stopping timers or audio).
     * Child classes can override this if they need specific cleanup.
     */
    destroy() {
        // To be implemented by child class if needed
    }

    // Helper method to handle card deletion
    async _handleDeleteCard() {
        const confirmed = await this.manager.showConfirmModal("Are you sure you want to permanently remove this button?");
        if (confirmed) {
            this.destroy();
            this.manager.removeCard(this.data.id);
        }
    }
}