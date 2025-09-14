import { Card } from '../Cards/BaseCard.js';
import { MSG } from '../Core/MSG.js';
import { SoundboardDB } from '../Core/SoundboardDB.js';
import { GridManager, Layout, LayoutNode } from './LayoutManager.js';
import { BoardManager } from './BoardManager.js';
import { ThemeManager } from './ThemeManager.js';
import { CardRegistry } from '../Core/CardRegistry.js';
import { ControlDockManager } from './ControlDockManager.js';
import {
    getAudioDuration, formatIdAsTitle, formatBytes,
    debounce
} from '../Core/helper-functions.js';




// ====================================================================
// SECTION: Application Manager Class
// Manages the state and business logic of the soundboard.
// UI interactions trigger methods on this manager.
// ====================================================================

export class SoundboardManager {

    //#region Constructor
    constructor(dbInstance) {
        this.db = dbInstance;
        this.allCards = new Map();
        this.allCardCommands = new Map();
        this.migrationQueue = [];
        this.isMigrating = false;
        this.GRID_LAYOUT_KEY = 'grid-layout';
        this.layout = new Layout();
        this.isRearranging = false;

        this.managerAPI = {
            getCardById: (id) => this.getCardById(id),
            getAllCards: () => this.allCards,
            getBoardId: () => this.db.boardId,
            showConfirmModal: (message) => this.showConfirmModal(message),
            confirm: (message) => this.showConfirmModal(message),
            registerCardCommands: (cardId, commands) => this.registerCardCommands(cardId, commands),
            handleCardCommand: (command) => this.handleCardCommand(command),
            handleCardMigration: (task) => this.handleCardMigration(task),
            toggleRearrangeMode: () => this.toggleRearrangeMode(),
            openThemeManager: () => this.themeManager.open(),
            openDbManager: () => this.dbManager.open(),
            openBoardManager: () => this.boardManager.open(),
            isRearranging: () => this.getRearrangeMode(),
            getLayout: () => this.layout,
        };
        
    }

    //#endregion

    // #region Lifecycle

    setDependencies({ themeManager, gridManager, controlDockManager, boardManager, dbManager, cardRegistry }) {
        this.themeManager = themeManager;
        this.gridManager = gridManager;
        this.controlDock = controlDockManager;
        this.boardManager = boardManager;
        this.dbManager = dbManager;
        this.cardRegistry = cardRegistry;
    }

    // This new method handles all data loading and setup.
    async load() {
        this._getDOMLemons();
        this._attachManagerListeners();

        const urlParams = new URLSearchParams(window.location.search);
        const boardId = urlParams.get('board') || 'default';
        await BoardManager.addBoardId(boardId);

        await this._loadBoardData();
        this._attachGlobalEventListeners();
    }
    

    _getDOMLemons(){
        this.elements = {
            soundboardGrid: document.getElementById('soundboard-grid'),
            controlDock: document.getElementById('control-dock'),
            controlDockCards: document.querySelectorAll('.control-dock-card'),
            boardSwitcherModal: document.getElementById('board-switcher-modal'),
            boardList: document.getElementById('board-list')
        }
    }

    async _loadBoardData() {
        await this.loadTitle();
        await this.initBugMovement();
        await this.loadCardsAndLayout();
        await this.broadcastAllCommands();
    }
    // #endregion

    // #region Card Management

    // ADD CARD
    async addCard(type, parentId = 'root', index = -1) { // Add parentId and default it to 'root'
        const CardClass = await this.cardRegistry.get(type);
        if (!CardClass) return;

        const newCardInstance = Card.create(CardClass, this.managerAPI, this.db);
        this.allCards.set(newCardInstance.id, newCardInstance);
        await this.db.save(newCardInstance.id, newCardInstance.data);

        const newNode = new LayoutNode(newCardInstance.id, newCardInstance.data.type);

        const parentNode = this.layout.findNode(parentId) || this.layout;
        const insertIndex = index === -1 ? parentNode.children.length : index;
        
        // Use the new, more specific insertNode call
        this.layout.insertNode(newNode, parentId, insertIndex);

        await this.saveLayout(this.layout);
        MSG.say(MSG.EVENTS.LAYOUT_CHANGED)
    }

    // MOVE CARD
    async moveCard(cardId, newParentId, newIndex) {
        const { node } = this.layout.findNodeAndParent(cardId);
        if (node) {
            this.layout.removeNode(cardId);
            this.layout.insertNode(node, newParentId, newIndex);

            await this.saveLayout(this.layout);
            MSG.say(MSG.EVENTS.LAYOUT_CHANGED);
        }
    }

    /** RESIZE A CARD */
    async resizeCard(cardId, newGridSpan) {
        const node = this.layout.findNode(cardId);
        if (node) {
            node.gridSpan = newGridSpan;

            await this.saveLayout(this.layout);
            MSG.say(MSG.EVENTS.LAYOUT_CHANGED);
        }
    }


    /**
    * Safely removes a card from the application by its unique ID.
    * @param {string} cardIdToRemove The unique ID of the card to be removed.
    **/
    async removeCard(cardIdToRemove) {
        const cardInstance = this.allCards.get(cardIdToRemove);
        if (!cardInstance) return;

        // Perform card-specific cleanup
        if (typeof cardInstance.destroy === 'function') {
            cardInstance.destroy();
        }

        this.unregisterCardCommands(cardInstance.id);

        // Remove from state and DB
        this.allCards.delete(cardIdToRemove);
        await this.db.delete(cardIdToRemove);

        // Tell the GridManager to remove the node from its layout
        this.layout.removeNode(cardIdToRemove);
        
        // Save the updated layout
        await this.saveLayout(this.layout);

        // Update the layout
        MSG.say(MSG.EVENTS.LAYOUT_CHANGED)
    }

    async updateCardData(cardId, newData) {
        const cardInstance = this.allCards.get(cardId);
        if (!cardInstance) return;

        const oldTitle = cardInstance.data.title;

        // 1. Update the in-memory state
        cardInstance.data = { ...cardInstance.data, ...newData };

        // 2. Save the updated data to the database
        await this.db.save(cardInstance.id, cardInstance.data);

        // 3. If the title changed, the card's command names need to be rebroadcast
        if (newData.title && newData.title !== oldTitle) {
            // This is a great example of centralizing logic. The card doesn't
            // need to know about commands; it just reports a data change.
            cardInstance._rebuildCommands();
        }

        // 4. Tell the specific card instance to update its UI
        cardInstance.updateUI();
    }

    getCardById(id) {
        return this.allCards.get(id);
    }

    async loadCardsAndLayout() {
        this.allCards.clear();

        const [allCardData, savedLayoutData] = await Promise.all([
            this.db._dbRequest(this.db.CARDS_STORE, 'readonly', 'getAll'),
            this.db.get(this.GRID_LAYOUT_KEY)
        ]);

        // First, create all card instances from the data
        await Promise.all(allCardData.map(async (cardData) => {
            const CardClass = await this.cardRegistry.get(cardData.type);
            if (CardClass) {
                const cardInstance = new CardClass(cardData, this.managerAPI, this.db);
                this.allCards.set(cardInstance.id, cardInstance);
            }
        }));

        let currentLayout;
        if (savedLayoutData && savedLayoutData.layout && savedLayoutData.layout.children) {
            // "Rehydrate" the plain layout object from the DB into our Layout classes
            currentLayout = Layout.rehydrate(savedLayoutData.layout);
        } else {
            // If no layout is saved, create a default one from the existing cards
            const children = allCardData.map(cd => new LayoutNode(cd.id, cd.type));
            currentLayout = new Layout(children);
            await this.saveLayout(currentLayout); // Save the newly generated layout
        }

        this.layout = currentLayout;
        
        // Finally, delegate the rendering task to the GridManager via event
        MSG.say(MSG.EVENTS.LAYOUT_CHANGED)
    }

    // #endregion

    // #region Layout
    getLayout(){
        return this.layout;
    }


    toggleRearrangeMode() {
        this.isRearranging = !this.isRearranging;
        // Broadcast the change to all listeners
        MSG.say(MSG.EVENTS.REARRANGE_MODE_CHANGED, this.isRearranging);
    }
    /**
     * Saves the current layout state to the database
     * @param {Layout} layout The new layout object
     */
    async saveLayout(layout) {
        // Convert class instances to plain objects for DB storage
        const serializableLayout = JSON.parse(JSON.stringify(layout));
        await this.db.save(this.GRID_LAYOUT_KEY, { id: this.GRID_LAYOUT_KEY, layout: serializableLayout });
    }
    // #endregion

    // #region Command Bus
    /**
     * Called by cards to register or update their commands in the central registry.
     * @param {string} cardId The ID of the card registering its commands.
     * @param {object[]} commands An array of the card's command objects.
     */
    registerCardCommands(cardId, commands) {
        this.allCardCommands.set(cardId, commands);
        this.broadcastAllCommands();
        //MSG.log(`Registered Card Commands for ${cardId}`)
    }

    /**
     * Called when a card is removed to clean up the registry.
     * @param {string} cardId The ID of the card to unregister.
     */
    unregisterCardCommands(cardId) {
        this.allCardCommands.delete(cardId);
        this.broadcastAllCommands();
        //MSG.log(`Unregistered Card Commands for ${cardId}`)
    }

    /**
     * Notifies all cards that the list of available commands has changed.
     * This is debounced to prevent event storms during rapid updates.
     */
    broadcastAllCommands = debounce(() => {
        const commandList = [];
        // Flatten the map's values into a single array for subscribers
        for (const commands of this.allCardCommands.values()) {
            commandList.push(...commands);
        }

        // Notify each card
        for (const card of this.allCards.values()) {
            if (typeof card.onCommandsChanged === 'function') {
                card.refreshAvailableCommands(commandList);
            }
        }
    }, 600); // Debounce by 600ms

    handleCardCommand(command) {
        MSG.log(`SoundboardManager.handleCardCommand(${command})`)
        const targetCard = this.allCards.get(command.targetCard);
        if (targetCard && typeof targetCard[command.handler] === 'function') {
            // Use the properties directly from the command object
            return targetCard[command.handler](...(command.args || []));
        } else {
            MSG.log(`Invalid command: ${command}\nTarget Card: ${targetCard}`, 1)
        }
    }
    // #endregion

    // #region UI & Modals
    getRearrangeMode(){
        return this.gridManager.isRearranging;
    }

    showConfirmModal(message, btnYesText = 'Yes', btnNoText = 'No') {
        return new Promise(resolve => {
            const modal = document.getElementById('confirm-modal');
            const messageEl = document.getElementById('confirm-modal-message');
            const yesBtn = document.getElementById('confirm-yes-btn');
            const noBtn = document.getElementById('confirm-no-btn');
            messageEl.textContent = message;
            yesBtn.textContent = btnYesText;
            noBtn.textContent = btnNoText;
            const handler = (e) => {
                if (e.target === yesBtn) resolve(true);
                else if (e.target === noBtn) resolve(false);
                yesBtn.removeEventListener('click', handler);
                noBtn.removeEventListener('click', handler);
                modal.style.display = 'none';
            };
            yesBtn.addEventListener('click', handler);
            noBtn.addEventListener('click', handler);
            modal.style.display = 'flex';
            modal.style.zIndex = '1001';
        });
    }

    // #endregion

    // #region Data Management
    
    // Maybe this should be in BoardManager.js?
    async loadTitle() {
        const titleData = await this.db.get('soundboard-title');

        if (titleData && titleData.title) {
            // If a title is already saved in the database, use it.
            document.getElementById('soundboard-title').textContent = titleData.title;
        } else {
            // NEW: If no title is saved, get the board ID from the URL
            // and use that as the default title.
            const urlParams = new URLSearchParams(window.location.search);
            const boardId = formatIdAsTitle(urlParams.get('board')) || 'The Bug & Moss "Really Simple" Soundboard';
            document.getElementById('soundboard-title').textContent = boardId;
            document.title = boardId + " | B&M RSS";
        }
    }

  
    // #endregion

    // #region Event Listeners

    // MANAGER LISTENERS
    _attachManagerListeners() {
        // Listen for a card's request to be removed
        MSG.on(MSG.ACTIONS.REQUEST_REMOVE_CARD, (data) => this.removeCard(data.cardId));

        // Listen for a request to add a new card
        MSG.on(MSG.ACTIONS.REQUEST_ADD_CARD, (data) => this.addCard(data.type, data.targetParentId, data.index));

        // Listen for requests to update a card's data
        MSG.on(MSG.ACTIONS.REQUEST_UPDATE_CARD_DATA, (data) => this.updateCardData(data.cardId, data.newData));

        // Listen for requests to move a card
        MSG.on(MSG.ACTIONS.REQUEST_MOVE_CARD, (data) => this.moveCard(data.cardId, data.newParentId, data.newIndex));

        // Liten for requests to resize a card
        MSG.on(MSG.ACTIONS.REQUEST_RESIZE_CARD, (data) => this.resizeCard(data.cardId, data.newGridSpan));

    }

    // GLOBAL EVENT LISTENERS
    _attachGlobalEventListeners() {

        // SOUNDBOARD TITLE
        document.getElementById('soundboard-title').addEventListener('blur', (e) => {
            //@ts-ignore
            const newTitle = e.target.textContent.trim();
            document.title = newTitle + " | B&M RSS";
            this.db.save('soundboard-title', { id: 'soundboard-title', title: newTitle });
        });


        // HELPFUL BUG

        document.getElementById('help-bug-btn').addEventListener('click', () => {
            document.getElementById('help-modal').style.display = 'flex';
        });

        document.getElementById('help-modal').addEventListener('click', (event) => {
            //@ts-ignore
            if (event.target.id === 'help-modal') {
                document.getElementById('help-modal').style.display = 'none';
            }
        });
        document.querySelector('.help-accordion').addEventListener('click', (e) => {
            //@ts-ignore
            if (e.target.classList.contains('accordion-header')) {
                const activeHeader = document.querySelector('.accordion-header.active');
                // Close the already active header if it's not the one that was clicked
                if (activeHeader && activeHeader !== e.target) {
                    activeHeader.classList.remove('active');
                    activeHeader.nextElementSibling.classList.remove('active');
                }

                //@ts-ignore Toggle the clicked header and its content 
                e.target.classList.toggle('active');
                //@ts-ignore
                const content = e.target.nextElementSibling;
                content.classList.toggle('active');
            }
        });

        // SERVICE WORKER
        // WORKER IN SERVICE
        // TREAT HIM NICELY
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./service-worker.js').then(registration => {
                    console.log('ServiceWorker registration successful');
                }).catch(err => {
                    console.log('ServiceWorker registration failed: ', err);
                });
            });
        }
    }
    // #endregion

    // #region Migration & Compatibility
    handleCardMigration(task) {
        this.migrationQueue.push(task);
        // If the processor isn't already running, kick it off.
        if (!this.isMigrating) {
            this.isMigrating = true;
            console.log("Starting background data migration for audio durations...");
            this._processMigrationQueue();
        }
    }

    async _processMigrationQueue() { // currently this is only for the duration in the soundcards but will expand as needed
        if (this.migrationQueue.length === 0) {
            this.isMigrating = false;
            console.log("Audio duration migration complete.");
            this.broadcastAllCommands(); // Broadcast updated commands once done
            return;
        }

        const task = this.migrationQueue.shift();
        try {
            
            const durationInMs = await getAudioDuration(task.file.arrayBuffer);

            // Update the data on the card instance
            task.card.data.files[task.fileIndex].durationMs = durationInMs;

            // Save the entire updated card data back to the database
            await task.card.db.save(task.card.id, task.card.data);
        } catch (e) {
            console.error(`Failed to migrate duration for file in card ${task.card.id}:`, e);
        }

        // Process the next item on a brief timeout to keep the UI responsive
        setTimeout(() => this._processMigrationQueue(), 100);
    }
    // #endregion

    // #region Bug's Corner
    /*
       /\    
      /  \   
     /    \  
    /------\ 
    |      |  BUG'S HOUSE
    |______| 
    */

    // Metaphorically speaking, the Helper Bug IS the SoundboardManager. She lives here <3

    async initBugMovement() {
        /**@ts-ignore @type {HTMLInputElement} */
        const checkbox = document.getElementById('toggle-bug-movement-checkbox');
        const bug = document.getElementById('help-bug-btn');

        // Load the state and set the initial UI
        const state = await this.db.get("bug-movement");
        const isStill = state ? state.state : false; // Default to false (bug is moving)
        checkbox.checked = isStill;

        // Invert the logic: if the bug is 'still', remove the 'bug-moving' class
        bug.classList.toggle('bug-moving', !isStill);

        // Attach the single listener for all future changes
        checkbox.addEventListener('change', async () => {
            const isNowStill = checkbox.checked;
            await this.db.save("bug-movement", { id: "bug-movement", state: isNowStill });
            bug.classList.toggle('bug-moving', !isNowStill);
        });
    }
    //#endregion

}