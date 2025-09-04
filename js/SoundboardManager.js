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
        this.controlCardElement = document.getElementById('control-card');

        this.allCards = new Map(); // Stores all card instances, keyed by their unique ID.
        this.allCardCommands = new Map(); // Stores all card commands, keyed by the card ID

        this.gridLayout = { id: 'root', type: 'grid-container', children: [] };
        this.GRID_LAYOUT_KEY = 'grid-layout';
        this.isRearranging = false;
        this.draggedItem = null;
        this.draggedItemData = null;
        this.dropIndicator = null;


        this.themeManager = new ThemeManager(this.db, new SoundboardDB('default'), this);
        this.boardManager = new BoardManager();

        this.migrationQueue = [];
        this.isMigrating = false;


        this.managerAPI = {
            getCardById: this.getCardById.bind(this),
            showConfirmModal: this.showConfirmModal.bind(this),
            removeCard: this.removeCard.bind(this),
            registerCardCommands: this.registerCardCommands.bind(this),
            handleCardCommand: this.handleCardCommand.bind(this),
            handleCardMigration: this.handleCardMigration.bind(this),
            getIsRearranging: () => this.isRearranging // Use a getter for properties
        };

        //@ts-ignore -- this will be replaced with our CardRegistry.js eventually
        this.cardRegistry = new Map([
            ['sound', SoundCard],
            ['notepad', NotepadCard],
            ['timer', TimerCard]
        ]);

    }

    async initialize() {
        loadGoogleFonts(['Wellfleet']);
        await this.db.openDB();

        // I SUSPECT THIS SHOULD MOVE TO BOARDMANAGER - we need to rethink boardmanager more
        const urlParams = new URLSearchParams(window.location.search);
        const boardId = urlParams.get('board') || 'default';
        await BoardManager.addBoardId(boardId);
        await this._loadBoardData();

        this.createDropIndicator();
        this.attachGlobalEventListeners();
    }

    // #region LOADING AND SETTING UP THE BOARD ===============================================

    async _loadBoardData() {
        await this.loadTitle();
        await this.themeManager.init();
        await this.initBugMovement();
        await this.loadCards();
        await this.broadcastAllCommands();
    }

    createDropIndicator() {
        this.dropIndicator = document.createElement('div');
        this.dropIndicator.id = 'drop-indicator';
        this.dropIndicator.style.display = 'none'; // Initially hidden
        this.soundboardGrid.appendChild(this.dropIndicator);
    }

    toggleRearrangeMode() {
        this.isRearranging = !this.isRearranging;
        const btn = document.getElementById('rearrange-mode-btn');
        const grid = document.getElementById('soundboard-grid');
        grid.classList.toggle('rearrange-mode', this.isRearranging);
        btn.textContent = this.isRearranging ? 'Done Rearranging' : 'Rearrange';
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


    // SHOULD THIS ALSO BE IN BOARDMANAGER?
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


    // ================================================================
    // #region Event Handling -- will need a lot of cleanup after refactor is finished
    // ================================================================

    attachGlobalEventListeners() {

        // SOUNDBOARD TITLE
        document.getElementById('soundboard-title').addEventListener('blur', (e) => {
            //@ts-ignore
            const newTitle = e.target.textContent.trim();
            document.title = newTitle + " | B&M RSS";
            this.db.save('soundboard-title', { id: 'soundboard-title', title: newTitle });
        });

        // DRAG HANDLERS
        this.soundboardGrid.addEventListener('dragstart', (e) => this.handleDragStart(e));
        this.soundboardGrid.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.soundboardGrid.addEventListener('dragenter', (e) => this.handleDragEnter(e));
        this.soundboardGrid.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        this.soundboardGrid.addEventListener('drop', (e) => this.handleDrop(e));
        this.soundboardGrid.addEventListener('dragend', (e) => this.handleDragEnd(e));


        // CONTROL CARD LISTENERS

        document.getElementById('flip-to-settings-btn').addEventListener('click', () => {
            this.controlCardElement.classList.add('is-flipped');
        });

        document.getElementById('flip-to-main-btn').addEventListener('click', () => {
            this.controlCardElement.classList.remove('is-flipped');
        });

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

    //#endregion

    // #region Drag&Drop Handlers
    handleDragStart(event) {
        if (!this.isRearranging || !event.target.closest('.sound-card')) {
            event.preventDefault();
            return;
        }

        this.draggedItem = event.target.closest('.sound-card');

        event.dataTransfer.effectAllowed = 'move';
        // Use a generic identifier for the drag data.
        event.dataTransfer.setData('text/plain', this.draggedItem.dataset.cardId);
        setTimeout(() => {
            this.draggedItem.classList.add('dragging');
        }, 0);
    }

    handleDragOver(event) {
        event.preventDefault();
    }

    handleDragEnter(event) {
        if (!this.isRearranging) return;
        const targetCard = event.target.closest('.sound-card');
        if (targetCard && targetCard !== this.draggedItem) {
            targetCard.classList.add('drag-over');
        }
    }

    handleDragLeave(event) {
        const targetCard = event.target.closest('.sound-card');
        if (targetCard && targetCard !== this.draggedItem) {
            if (!targetCard.contains(event.relatedTarget)) {
                targetCard.classList.remove('drag-over');
            }
        }
    }


    async handleDrop(event) {
        event.preventDefault();
        if (!this.isRearranging || !this.draggedItem) return;

        const targetCard = event.target.closest('.sound-card');
        if (targetCard && targetCard !== this.draggedItem) {

            const fromId = this.draggedItem.dataset.cardId;
            const toId = targetCard.dataset.cardId;

            const fromIndex = this.gridLayout.findIndex(item => item.id === fromId);
            const toIndex = this.gridLayout.findIndex(item => item.id === toId);

            if (fromIndex > -1 && toIndex > -1) {
                // Swap the items in the layout array
                [this.gridLayout[fromIndex], this.gridLayout[toIndex]] = [this.gridLayout[toIndex], this.gridLayout[fromIndex]];
                await this.updateGrid();
                this.renderGrid(); // Re-render the grid in the new order
            }
        }
    }

    handleDragEnd(e) {
        if (this.draggedItem) {
            this.draggedItem.classList.remove('dragging');
            this.draggedItem = null;
            this.soundboardGrid.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        }
    }


    // #region Card Management Methods ======================================


    getCardById(id) {
        return this.allCards.get(id);
    }

    async loadCards() {
        this.allCards.clear();

        // 1. Fetch all card and layout data from the database concurrently.
        const [allCardData, layoutData] = await Promise.all([
            this.db._dbRequest(this.db.CARDS_STORE, 'readonly', 'getAll'),
            this.db.get(this.GRID_LAYOUT_KEY)
        ]);

        // 2. Create an instance for each card loaded from the database.
        allCardData.forEach(cardData => {
            const CardClass = this.cardRegistry.get(cardData.type);
            if (CardClass) {
                const cardInstance = new CardClass(cardData, this.managerAPI, this.db);
                this.allCards.set(cardInstance.id, cardInstance);
            }
        });

        // 3. Set the grid layout. If no layout is saved, create a default one.
        if (layoutData && Array.isArray(layoutData.layout)) {
            this.gridLayout = layoutData.layout;
        } else {
            // Fallback: create a layout from all loaded cards.
            this.gridLayout = allCardData.map(cd => ({ type: cd.type, id: cd.id }));
            this.gridLayout.push({ type: 'control', id: 'control-card' });
            await this.updateGrid();
        }

        // 4. Render the UI a single time with the fully loaded state.
        this.renderGrid();
    }

    async addCard(type) {

        const CardClass = this.cardRegistry.get(type);
        if (!CardClass) {
            console.error(`Unknown Card Type: ${type}`);
            return;
        }

        // Create the new card instance
        const newCardInstance = Card.create(CardClass, this.managerAPI, this.db);

        // Add to manager's allCards list
        this.allCards.set(newCardInstance.id, newCardInstance);

        // Add to layout state...
        const controlCardIndex = this.gridLayout.children.findIndex(item => item.id === 'control-card');

        const newItem = { type: newCardInstance.data.type, id: newCardInstance.id };
        if (controlCardIndex !== -1) {
            this.gridLayout.children.splice(controlCardIndex, 0, newItem);
        } else {
            this.gridLayout.children.push(newItem);
        }

        // Persist the changes (this is the async part).
        await this.db.save(newCardInstance.id, newCardInstance.data);
        await this.updateGrid();
        this.renderGrid();
    }

    /**
    * Safely removes a card from the application by its unique ID.
    * @param {string} cardIdToRemove The unique ID of the card to be removed.
    **/
    async removeCard(cardIdToRemove) {
        const cardInstance = this.allCards.get(cardIdToRemove);
        if (!cardInstance) {
            console.error(`Attempted to remove a card that does not exist: ${cardIdToRemove}`);
            return;
        }

        // 1. Perform cleanup on the instance itself.
        if (typeof cardInstance.destroy === 'function') {
            cardInstance.destroy();
        }
        this.unregisterCardCommands(cardInstance.id);

        // 2. Remove from in-memory state and database.
        this.allCards.delete(cardIdToRemove);
        await this.db.delete(cardIdToRemove);

        // 3. Create the new layout by filtering out the removed card.
        const newGridLayout = this.gridLayout.filter(item => item.id !== cardIdToRemove);

        // 4. Call updateGrid to save the new layout and re-render.
        await this.updateGrid(newGridLayout);
        MSG.log(`Successfully removed card: ${cardIdToRemove}`);
    }

    async updateGrid(newGridLayout = this.gridLayout) {
        // 1. Update the in-memory layout state.
        this.gridLayout = newGridLayout;

        // 2. Persist the new layout to the database.
        await this.db.save(this.GRID_LAYOUT_KEY, { id: this.GRID_LAYOUT_KEY, layout: this.gridLayout });

        // 3. Re-render the UI to reflect the changes.
        this.renderGrid();
    }



    renderGrid() {
        this.soundboardGrid.innerHTML = '';
        this.gridLayout.forEach(item => {
            let cardElement = null;
            if (item.type === 'control') {
                cardElement = this.controlCardElement;
                cardElement.style.display = 'flex';
            } else {
                const cardInstance = this.allCards.get(item.id);
                if (cardInstance) {
                    cardElement = cardInstance.cardElement;
                }
            }

            if (cardElement) {
                this.soundboardGrid.appendChild(cardElement);
            }
        });
    }

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


    // #endregion

    // #endregion Drag&Drop Handlers

    // #region Global Functionality Methods - e.g., adding/removing cards, downloading/uploading config, etc.
    // ==============================================================================================================


    // we should create a way for boards saved from previous versions of the app can still upload
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

    // Same concerns as downloadconfig obviously
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

    //#endregion

    // #region Modal Manager Methods

    // This should probably stay here in SoundboardManager because it's a generic UI component.
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

    // Considering moving this to SoundboardDB since it's related to the DB
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

    // #region Compatibility Helpers ===================================================================================

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
            const durationInSeconds = await getAudioDuration(task.file.arrayBuffer);
            const durationInMs = durationInSeconds * 1000;

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

}