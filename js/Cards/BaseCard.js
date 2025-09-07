import { MSG } from '../Core/MSG.js';
import { Modal } from '../Core/Modal.js'
//#region TICKET CLASS
class Ticket {
    /**
     * @param {object} options
     * @param {number} [options.durationMs=0] - The duration of the command in milliseconds.
     * @param {object} [options.args={}] - Any specific arguments needed for the execute step.
     */
    constructor({ durationMs = 0, args = {} } = {}) {

        // durationMs: the duration in milliseconds
        if (typeof durationMs !== 'number') {
            console.error('Invalid CommandTicket: durationMs must be a number.');
            this.durationMs = 0;
        } else {
            this.durationMs = durationMs;
        }

        // args: arguments for the execute function
        if (typeof args !== 'object' || args === null) {
            console.error('Invalid CommandTicket: args must be an object.');
            this.args = {};
        } else {
            this.args = args;
        }
    }
}
//#endregion

//#region CARD CLASS
// what if we changed how we handle 'type' entirely, by making indexedDB create a store based on the class name of whatever card
export class Card {

    // Make the PreloadTicket class available to child cards because imports are annoying asf
    static Ticket = Ticket;
    
    /**
     * The constructor for all card types.
     * @param cardData The initial data for the card from the database.
     * @param soundboardManagerAPI A reference to the main manager.
     * @param dbInstance A reference to the database.
     */
    constructor(cardData, soundboardManagerAPI, dbInstance) {
        //@ts-ignore This class is only ever extended, we can guarantee there's always a constructor.
        const defaultData = this.constructor.Default();
        this.data = { ...defaultData, ...cardData };
        this.manager = soundboardManagerAPI;
        this.db = dbInstance;
        this.id = this.data.id;

        this.cardElement = this._createElement();

        // INIT COMMAND LOGIC
        this.commands = []; // THIS card's commands
        this.allCommands = []; // Everyone ELSE'S commands.
        this._rebuildCommands();

    }

// ======================= OVERRIDE ALL THESE BITCHES OR ELSE =================================
//#region Override Methods
    /**
     * A getter that child classes MUST override to provide their template ID.
     * @returns {string} The template ID for the card (e.g., 'timer-card-template').
     */
    get templateId() {
        throw new Error('Child class must implement templateId getter.');
    }

    /**
     * A static method that child classes MUST implement to provide default data.
     * @returns {object} The default data object for the card type.
     */
    Default() {
        throw new Error('Child class must implement static Default method.');
    }

    /**
     * Placeholder for initializing commands. Child classes MUST implement this if they provide commands.
     */
    _registerCommands() {
    }

     /**
     * This method is called by the SoundboardManager whenever the global
     * command list is updated.
     * @param {Array<object>} allCommands The fresh list of all available commands.
     */
    onCommandsChanged(allCommands) {
        // Child classes can implement this
    }

    /**
     * Placeholder for attaching event listeners. Child classes MUST implement this.
     */
    _attachListeners() {
        throw new Error('Child class must implement _attachListeners method.')
    }

    /**
     * Placeholder for updating the UI. Child classes MUST implement this.
     */
    updateUI() {
        throw new Error('Child class must implement updateUI method.')
    }


    /**
     * Placeholder for cleanup logic (e.g., stopping timers or audio).
     */
    destroy() {
    }

    //#endregion

    //#region Settings Modal

    getSettingsConfig() {
        // Return null or an empty object if a card has no settings
        return null;
    }

    // Add this generic helper method to open the modal
    _openSettingsModal() {
        const config = this.getSettingsConfig();
        if (!config) return;

        // The Modal takes the title, the config object, the current data, and a save callback
        const modal = new Modal(
            `${this.data.title} Settings`,
            config,
            this.data,
            (newData) => this.updateData(newData) // Pass the updateData method as the callback
        );
        modal.open();
    }

    //#endregion

// ============= COMMAND LOGIC =================
//#region Command Logic

    _rebuildCommands() {
        this.commands = [];
        this._registerCommands();
        this.manager.registerCardCommands(this.id, this.commands);
    }

    registerCommand({ name, preload, execute }) {
        const command = {
            id: `${this.id}:${name}`,
            targetCard: this.id,
            name: `${name}: ${this.data.title}`,
            preload: preload ? preload.bind(this) : () => ({ durationMs: 0, args: {} }),
            execute: execute ? execute.bind(this) : () => { }
        };
        this.commands.push(command);
    }

    /**
    * Preloads the data for a given command ID, with optional custom parameters.
    * @param {string} commandId The unique ID of the command to preload.
    * @param {object} options An optional object of parameters for the preload.
    * @returns {object | null} The preloaded data "ticket", or null if not found.
    */
    preloadCommand(commandId, options = {}) {
        const command = this.getCommand(commandId);

        // if we're missing a preload command or it's not a function
        if (!command || typeof command.preload !== 'function') {
            return new Ticket(); // Return a default, safe ticket
        }

        // get our ticket and validate it
        const ticket = command.preload(options);
        if (ticket instanceof Ticket){
            MSG.log(`Preloaded Command: ${command.id}, returning ticket.`,1,ticket)
            // if it's a valid ticket, return it
            return ticket;
        }

        MSG.log(`Command '${commandId}' returned an invalid ticket.`,1,ticket)
        return new Ticket

    }

    /**
    * Executes a command with preloaded arguments.
    * @param {string} commandId The unique ID of the command to execute.
    * @param {object} ticket The "ticket" of arguments from the preload step.
    */
    executeCommand(commandId, ticket) {
        const command = this.getCommand(commandId);
        return command?.execute(ticket);
    }

    getCommand(commandId){
        const command = this.allCommands.find(c => c.id === commandId);
        if (!command) {
            MSG.log(`No Command found with ID: ${commandId}`,1);
            return;
        }
        
        const targetCard = this.manager.getCardById(command.targetCard);
        if (!targetCard) {
            MSG.log(`No card found matching: ${command.targetCard}`,1, command.targetCard);
            return;
        }

        if (!command.preload){
            MSG.log(`Command ${commandId} has no preload method defined.`,1);
            return
        }

        if (!command.execute){
            MSG.log(`Command ${commandId} has no execute method defined.`,1);
            return
        }

        return command;
    }

    refreshAvailableCommands(allCommands) {
        this.allCommands = allCommands;
        // This calls the function provided by the subclass (e.g., populateCommandSelectors).
        this.onCommandsChanged(this.allCommands);
    }

    //#endregion

    // ========================================================================================================
    // DADDY LEVEL METHODS
    // #region Data Management

    static create(CardClass, managerAPI, db) {
        const type = CardClass.Default().type; // Get type from the default data
        if (!type) throw new Error("Card's Default() method must include a 'type' property.");

        const newId = `${type}-${crypto.randomUUID()}`
        const defaultData = CardClass.Default();
        const newCardData = {
            ...defaultData,
            id: newId,
        };
        return new CardClass(newCardData, managerAPI, db);
    }

    async updateData(newData) {
        if (Object.keys(newData).length === 0) {
            return;
        }

        const oldTitle = this.data.title;
        this.data = { ...this.data, ...newData };
        await this.db.save(this.data.id, this.data);

        if (this.data.title !== oldTitle){
            this._rebuildCommands();
        }
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
        cardElement.setAttribute('draggable', this.manager.isRearrangeMode());

        return cardElement;
    } 

    // Helper method to handle card deletion
    async _handleDeleteCard() {
        const confirmed = await this.manager.showConfirmModal("Are you sure you want to permanently remove this card?");
        if (confirmed) {
            this.destroy();
            this.manager.removeCard(this.data.id);
        }
    }

    //#endregion
}
