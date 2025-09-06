import { AudioPlayer } from './AudioPlayer.js';
import { Card } from './-Card.js';
import { SoundboardDB } from './SoundboardDB.js';
import { BoardManager } from './BoardManager.js';
import { ThemeManager } from './ThemeManager.js';
import {
    getAudioDuration, arrayBufferToBase64, base64ToArrayBuffer,
    loadGoogleFonts, slugify, formatIdAsTitle, formatBytes,
    debounce
} from './helper-functions.js';
import { MSG } from './MSG.js';
import { GridManager, Layout, LayoutNode } from './LayoutManager.js';
import { CardRegistry } from './CardRegistry.js';

// we will get rid of the following once we implement CardRegistry.js
import { SoundCard } from './SoundCard.js';
import { NotepadCard } from './NotepadCard.js';
import { TimerCard } from './TimerCard.js';

// ====================================================================
// SECTION: Application Manager Class
// Manages the state and business logic of the soundboard.
// UI interactions trigger methods on this manager.
// ====================================================================

export class SoundboardManager {
    constructor(dbInstance) {
        this.db = dbInstance;
        this.soundboardGrid = document.getElementById('soundboard-grid');
        this.controlDock = document.getElementById('control-dock');

        this.managerAPI = {
            getCardById: this.getCardById.bind(this),
            showConfirmModal: this.showConfirmModal.bind(this),
            removeCard: this.removeCard.bind(this),
            registerCardCommands: this.registerCardCommands.bind(this),
            handleCardCommand: this.handleCardCommand.bind(this),
            handleCardMigration: this.handleCardMigration.bind(this),
            getIsRearranging: () => this.gridManager.isRearranging // Use a getter for properties
        };

        this.allCards = new Map(); // Stores all card instances, keyed by their unique ID.
        this.allCardCommands = new Map(); // Stores all card commands, keyed by the card ID

        this.gridManager = new GridManager(
            this.soundboardGrid,
            this.controlDock,
            this.allCards,
            this.db,
            (newLayout) => this.saveLayout(newLayout),
            (type, parentId, index) => this.addCard(type, parentId, index)
        );

        this.GRID_LAYOUT_KEY = 'grid-layout';

        this.migrationQueue = [];
        this.isMigrating = false;
        
        this.themeManager = new ThemeManager(this.db, new SoundboardDB('default'), this.managerAPI);
        this.boardManager = new BoardManager();

        
    }

    // #region Lifecycle
    async initialize() {
        loadGoogleFonts(['Wellfleet']);
        await this.db.openDB();

        // I SUSPECT THIS SHOULD MOVE TO BOARDMANAGER - we need to rethink boardmanager more
        const urlParams = new URLSearchParams(window.location.search);
        const boardId = urlParams.get('board') || 'default';
        await BoardManager.addBoardId(boardId);
        await this._loadBoardData();

        this.attachGlobalEventListeners();
    }

    async _loadBoardData() {
        await this.loadTitle();
        await this.themeManager.init();
        await this.initBugMovement();
        await this.loadCardsAndLayout();
        await this.broadcastAllCommands();
    }
    // #endregion

    // #region Card Management
    async addCard(type, parentId = 'root', index = -1) { // Add parentId and default it to 'root'
        const CardClass = CardRegistry.get(type);
        if (!CardClass) return;

        const newCardInstance = Card.create(CardClass, this.managerAPI, this.db);
        this.allCards.set(newCardInstance.id, newCardInstance);
        await this.db.save(newCardInstance.id, newCardInstance.data);

        const newNode = new LayoutNode(newCardInstance.id, newCardInstance.data.type);

        const parentNode = this.gridManager.layout.findNode(parentId) || this.gridManager.layout;
        const insertIndex = index === -1 ? parentNode.children.length : index;
        
        // Use the new, more specific insertNode call
        this.gridManager.layout.insertNode(newNode, parentId, insertIndex);

        await this.saveLayout(this.gridManager.layout);
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
        this.gridManager.layout.removeNode(cardIdToRemove);
        
        // Save the updated layout, which also re-renders the grid
        await this.saveLayout(this.gridManager.layout);
    }

    async loadCardsAndLayout() {
        this.allCards.clear();

        const [allCardData, savedLayoutData] = await Promise.all([
            this.db._dbRequest(this.db.CARDS_STORE, 'readonly', 'getAll'),
            this.db.get(this.GRID_LAYOUT_KEY)
        ]);

        // First, create all card instances from the data
        await Promise.all(allCardData.map(async (cardData) => {
            const CardClass = await CardRegistry.get(cardData.type);
            if (CardClass) {
                const cardInstance = new CardClass(cardData, this.managerAPI, this.db);
                this.allCards.set(cardInstance.id, cardInstance);
            }
        }));

        let currentLayout;
        if (savedLayoutData && savedLayoutData.layout && savedLayoutData.layout.children) {
            // "Rehydrate" the plain layout object from the DB into our Layout classes
            const children = savedLayoutData.layout.children.map(node => new LayoutNode(node.id, node.type, node.children || []));
            currentLayout = new Layout(children);
        } else {
            // If no layout is saved, create a default one from the existing cards
            const children = allCardData.map(cd => new LayoutNode(cd.id, cd.type));
            currentLayout = new Layout(children);
            await this.saveLayout(currentLayout); // Save the newly generated layout
        }
        
        // Finally, delegate the rendering task to the GridManager
        this.gridManager.render(currentLayout);
    }

    getCardById(id) {
        return this.allCards.get(id);
    }
    // #endregion

    // #region Layout
    toggleRearrangeMode() {
        const isEnabled = !this.gridManager.isRearranging;
        this.gridManager.setRearrangeMode(isEnabled);
        
        const btn = document.getElementById('rearrange-mode-btn');
        btn.textContent = isEnabled ? 'Done Rearranging' : 'Rearrange';
    }

    /**
     * Saves the current layout state to the database and triggers a re-render.
     * This method is used as the callback for GridManager.
     * @param {Layout} layout The new layout object from the GridManager.
     */
    async saveLayout(layout) {
        // Convert class instances to plain objects for DB storage
        const serializableLayout = JSON.parse(JSON.stringify(layout));
        await this.db.save(this.GRID_LAYOUT_KEY, { id: this.GRID_LAYOUT_KEY, layout: serializableLayout });
        
        // Tell the GridManager to render the final, saved state to ensure UI consistency
        this.gridManager.render(layout);
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
    showConfirmModal(message) {
        return new Promise(resolve => {
            const modal = document.getElementById('confirm-modal');
            const messageEl = document.getElementById('confirm-modal-message');
            const yesBtn = document.getElementById('confirm-yes-btn');
            const noBtn = document.getElementById('confirm-no-btn');
            messageEl.textContent = message;
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

    async showDbManagerModal() {
        this.updateDbStats();
        this.updateDbFileList();

        /**@ts-ignore @type {HTMLInputElement} */
        const checkbox = document.getElementById('persistent-storage-checkbox');
        const clearDbBtn = document.getElementById('clear-database-btn');
        const boardId = this.db.boardId;

        if (boardId === 'default') {
            clearDbBtn.textContent = 'Reset Default Board...';
        } else {
            clearDbBtn.textContent = `Delete '${boardId}' Board...`;
        }

        // The persistent storage option may never work, and might not need to exist?
        if (navigator.storage && navigator.storage.persisted) {
            checkbox.parentElement.style.display = '';
            const isPersisted = await navigator.storage.persisted();
            checkbox.checked = isPersisted;
            checkbox.disabled = isPersisted;
        } else {
            // If the API isn't supported, hide the option entirely.
            checkbox.parentElement.style.display = 'none';
        }


        document.getElementById('db-manager-modal').style.display = 'flex';
    }

    closeDbManagerModal() {
        document.getElementById('db-manager-modal').style.display = 'none';
    }
    // #endregion

    // #region Data Management
    async downloadConfig() {
        const allData = await this.db.getAll();
        const soundboardTitle = document.getElementById('soundboard-title').textContent.trim();
        const serializableData = allData.map(item => {
            if (item.files && item.files.length > 0) {
                const serializableFiles = item.files.map(file => ({ ...file, arrayBuffer: arrayBufferToBase64(file.arrayBuffer) }));
                return { ...item, files: serializableFiles };
            }
            return item;
        });
        const json = JSON.stringify(serializableData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${Date.now()}_${soundboardTitle}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async uploadConfig(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                //@ts-ignore
                let data = JSON.parse(e.target.result);

                // migration logic for legacy users
                if (data.length > 0 && typeof data[0].id === 'number') {
                    console.log("Old configuration file detected. Migrating to new format...");
                    data = this.migrateAndSeparateConfig(data);
                }
                const confirmed = await this.showConfirmModal("This will overwrite your current soundboard configuration. Are you sure?");
                if (confirmed) {
                    const deserializedData = data.map(item => {
                        if (item.files && item.files.length > 0) {
                            const deserializedFiles = item.files.map(file => ({ ...file, arrayBuffer: base64ToArrayBuffer(file.arrayBuffer) }));
                            return { ...item, files: deserializedFiles };
                        }
                        return item;
                    });

                    await this.db.clear();
                    for (const item of deserializedData) {
                        await this.db.save(item.id, item);
                    }

                    await this._loadBoardData();
                    alert("Configuration uploaded successfully!");
                    window.location.reload();
                }
            } catch (e) {
                alert("Failed to read file. Please ensure it is a valid JSON configuration file.");
                console.error("Upload error:", e);
            }
        };
        reader.readAsText(file);
    }

    async createNewBoard() {
        // @ts-ignore
        const input = document.getElementById('new-board-name-input');
        if (input == null) { return; }
        //@ts-ignore
        const boardName = input.value.trim();

        if (!boardName) {
            alert("Please enter a name for the new board.");
            return;
        }

        const boardId = slugify(boardName);
        if (!boardId) {
            alert("Please enter a valid name (letters and numbers).");
            return;
        }

        const existingBoardIds = await BoardManager.getBoardList(); // UPDATED
        if (existingBoardIds.includes(boardId)) {
            alert(`A board with the ID "${boardId}" already exists.`);
            return;
        }

        window.location.href = `?board=${boardId}`;
    }

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

    // dunno if this does anything really
    async requestPersistentStorage() {
        if (navigator.storage && navigator.storage.persist) {
            const isPersisted = await navigator.storage.persisted();
            if (!isPersisted) {
                const granted = await navigator.storage.persist();
                if (granted) {
                    console.log("Persistent storage granted!");
                } else {
                    console.log("Persistent storage denied.");
                }
            } else {
                console.log("Persistent storage already granted.");
            }
        }
    }

    async updateDbStats() {
        const dbSizeEl = document.getElementById('db-usage');
        const dbQuotaEl = document.getElementById('db-quota');
        const dbButtonCountEl = document.getElementById('db-button-count');

        const soundData = (await this.db._dbRequest(this.db.CARDS_STORE, 'readonly', 'getAll')).filter(c => c.type === 'sound');
        dbButtonCountEl.textContent = soundData.length;

        if (navigator.storage && navigator.storage.estimate) {
            const { quota, usage } = await navigator.storage.estimate();
            dbSizeEl.textContent = formatBytes(usage);
            dbQuotaEl.textContent = formatBytes(quota);
        } else {
            dbSizeEl.textContent = 'N/A';
            dbQuotaEl.textContent = 'N/A';
        }
    }

    async updateDbFileList() {
        const fileListEl = document.getElementById('db-file-list');
        const soundData = (await this.db._dbRequest(this.db.CARDS_STORE, 'readonly', 'getAll')).filter(c => c.type === 'sound');

        fileListEl.innerHTML = '';
        if (soundData.length === 0) {
            fileListEl.innerHTML = '<li><small>No sounds found.</small></li>';
            return;
        }

        soundData.forEach(item => {
            const li = document.createElement('li');
            li.textContent = `Button "${item.title}": ${item.files.length} file(s)`;
            fileListEl.appendChild(li);
        });
    }

    async handleClearDatabase() {
        const urlParams = new URLSearchParams(window.location.search);
        const boardId = urlParams.get('board') || 'default';

        if (boardId === 'default') {
            // --- NEW LOGIC FOR WIPING THE DEFAULT BOARD ---
            const confirmed = await this.showConfirmModal("This will wipe all cards and settings from the default board but will PRESERVE your list of other boards. Are you sure?");
            if (confirmed) {
                try {
                    // 1. Read the board list and keep it in memory.
                    const boardList = await BoardManager.getBoardList();

                    // 2. Clear both object stores completely.
                    await this.db.clear();

                    // 3. Write the board list back to the now-empty database.
                    await BoardManager.saveBoardList(boardList);

                    // 4. Reload the page to show the fresh default board.
                    window.location.reload();

                } catch (e) {
                    console.error("Failed to wipe default board:", e);
                }
            }
        } else {
            // --- EXISTING LOGIC FOR DELETING OTHER BOARDS ---
            const confirmed = await this.showConfirmModal(`This will permanently delete the entire "${boardId}" board. Are you sure?`);
            if (confirmed) {
                try {
                    await this.db.clear();
                    await BoardManager.removeBoardId(boardId);
                    window.location.href = window.location.pathname;
                } catch (e) {
                    console.error("Failed to clear database:", e);
                }
            }
        }
    }
    // #endregion

    // #region Event Listeners
    attachGlobalEventListeners() {

        // SOUNDBOARD TITLE
        document.getElementById('soundboard-title').addEventListener('blur', (e) => {
            //@ts-ignore
            const newTitle = e.target.textContent.trim();
            document.title = newTitle + " | B&M RSS";
            this.db.save('soundboard-title', { id: 'soundboard-title', title: newTitle });
        });

        // CONTROL CARD LISTENERS
        document.getElementById('add-sound-btn').addEventListener('click', () => {
            this.addCard('sound');
        });
        document.getElementById('add-notepad-btn').addEventListener('click', () => {
            this.addCard('notepad');
        });
        document.getElementById('add-timer-btn').addEventListener('click', () => {
            this.addCard('timer');
        });
        document.getElementById('rearrange-mode-btn').addEventListener('click', () => this.toggleRearrangeMode());
        document.getElementById('download-config-btn').addEventListener('click', () => this.downloadConfig());
        document.getElementById('upload-config-btn').addEventListener('click', () => document.getElementById('upload-config-input').click());
        document.getElementById('upload-config-input').addEventListener('change', (e) => this.uploadConfig(e));
        document.getElementById('db-manager-btn').addEventListener('click', () => this.showDbManagerModal());
        document.getElementById('create-new-board-btn').addEventListener('click', () => this.createNewBoard());

        // listener to close the board switcher modal when clicking the background
        document.getElementById('board-switcher-modal').addEventListener('click', (event) => {
            //@ts-ignore
            if (event.target.id === 'board-switcher-modal') {
                document.getElementById('board-switcher-modal').style.display = 'none';
            }
        });

        document.getElementById('db-manager-modal').addEventListener('click', (event) => {
            //@ts-ignore
            if (event.target.id === 'db-manager-modal') this.closeDbManagerModal();
        });
        document.getElementById('persistent-storage-checkbox').addEventListener('change', (e) => {
            //@ts-ignore
            if (e.target.checked) {
                this.requestPersistentStorage();
            }
            // Note: Browsers do not currently allow you to programmatically "un-persist" storage.
            // The user must do this through browser settings. This also might not work at all lol.
        });
        document.getElementById('clear-database-btn').addEventListener('click', () => this.handleClearDatabase());



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


    /**
     * Detects an old configuration format and migrates it to the new structure.
     * It separates cards from config items and updates their data models.
     * @param {Array<Object>} oldData - The raw data array from the old JSON file.
     * @returns {Array<Object>} A new array with data in the modern format.
     */
    migrateAndSeparateConfig(oldData) {
        const migratedData = [];
        const idMap = new Map(); // To track old numeric IDs and their new prefixed string IDs

        // First pass: Process all cards and create an ID map
        oldData.forEach(item => {
            let newItem = { ...item }; // Start with a copy

            // --- Migrate Sound Cards ---
            if (typeof item.id === 'number' && item.files) {
                const newId = `sound-${item.id}`;
                // Use a composite key to avoid collisions: "sound-0"
                idMap.set(`sound-${item.id}`, newId);
                newItem = {
                    ...SoundCard.Default(),
                    ...item,
                    id: newId,
                    title: item.name,
                    type: 'sound'
                };
                delete newItem.name;
            }
            // --- Migrate Timer Cards ---
            else if (item.id.startsWith && item.id.startsWith('timer-')) {
                const oldIdNumeric = item.id.split('-')[1];
                // Use a composite key: "timer-0"
                idMap.set(`timer-${oldIdNumeric}`, item.id);
                newItem = {
                    ...TimerCard.Default(),
                    ...item,
                    type: 'timer',
                    startAction: { command: item.startSound || "", durationMs: 0, triggered: false },
                    endAction: { command: item.endSound || "", durationMs: item.endSoundDuration || 0, triggered: false }
                };
                // Clean up old properties
                delete newItem.startSoundId; delete newItem.endSoundId; delete newItem.endSoundDuration;
                delete newItem.startSound; delete newItem.endSound;
            }
            // --- Migrate Notepad Cards ---
            else if (item.id.startsWith && item.id.startsWith('notepad-')) {
                const oldIdNumeric = item.id.split('-')[1];
                // Use a composite key: "notepad-0"
                idMap.set(`notepad-${oldIdNumeric}`, item.id);
                newItem = { ...NotepadCard.Default(), ...item, type: 'notepad' };
            }

            migratedData.push(newItem);
        });

        // Second pass: Update the grid-layout with the new IDs
        const gridLayoutItem = migratedData.find(item => item.id === 'grid-layout');
        if (gridLayoutItem) {
            gridLayoutItem.layout = gridLayoutItem.layout.map(layoutItem => {
                // Look up using the same composite key structure
                const newId = idMap.get(`${layoutItem.type}-${layoutItem.id}`);
                if (newId) {
                    return { ...layoutItem, id: newId };
                }
                return layoutItem; // Keep items like 'control-card' as is
            });
        }

        // Filter out any non-card config items that were processed in the first pass
        return migratedData.filter(item => item.type || item.id === 'grid-layout' || item.id === 'soundboard-title');
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