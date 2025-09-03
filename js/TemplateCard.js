import { MSG } from './MSG.js';
export class NEWCARD extends RSSCard {
    /**
     * The constructor for all card types.
     * @param {object} cardData The initial data for the card from the database.
     * @param {import('./SoundboardManager.js').SoundboardManager} soundboardManagerAPI A reference to the main manager.
     * @param {import('./SoundboardDB.js').SoundboardDB} dbInstance A reference to the database.
     */
    constructor(cardData, soundboardManagerAPI, dbInstance) {
        super(cardData, soundboardManagerAPI, dbInstance)


    }

// ======================= OVERRIDE ALL THESE BITCHES OR ELSE =================================

    /**
     * @returns {string} The template ID for the card (e.g., 'timer-card-template').
     */
    get templateId() {
    }

    /**
     * @returns {object} The default data object for the card type.
     */
    Default() {
        return {
            type: 'newcard',
            title: 'New Card'
            // DEFAULT CARD DATA GOES HERE
        }
    }

    /**
     * Placeholder for initializing commands. Child classes MUST implement this.
     */
    _registerCommands() {
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

// ============= CHILD CLASSES SHOULD USE THESE FUNCTIONS, BUT PLEASE DON'T OVERRIDE UNLESS YOU CRAZY =================

    /**
    * Updates the card's data object and saves it to the database. Don't override without good reason.
    */
    async updateData(newData) {
        if (Object.keys(newData).length === 0) {
            return;
        }
        this.data = { ...this.data, ...newData };
        await this.db.save(this.data.id, this.data);
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
            return this.createCommandTicket(); // Return a default, safe ticket
        }

        // get our ticket and validate it
        const ticket = command.preload(options);
        if (ticket && typeof ticket.durationMs === 'number' && typeof ticket.args === 'object'){
            MSG.log(`Preloaded Command: ${command.id}, returning ticket.`,1,ticket)
            // if it's a valid ticket, return it
            return ticket;
        }

        MSG.log(`Command '${commandId}' returned an invalid ticket.`,1,ticket)
        return this.createCommandTicket()

    }

    createCommandTicket(durationMs = 0, args = {}) {
        if (typeof durationMs !== 'number' || typeof args !== 'object' || args === null) {
            console.error('Invalid CommandTicket format. durationMs must be a number and args must be an object.');
            return { durationMs: 0, args: {} };
        }
        return { durationMs, args };
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

}