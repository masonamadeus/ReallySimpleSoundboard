import { AudioPlayer } from './AudioPlayer.js';
import { TimerCard } from './TimerCard.js';
import { NotepadCard } from './NotepadCard.js';
import { SoundCard } from './SoundCard.js';
import { SoundboardDB } from './SoundboardDB.js';
import { BoardManager } from './BoardManager.js';
import { ThemeManager } from './ThemeManager.js';
import {
    appEvents, arrayBufferToBase64, base64ToArrayBuffer,
    loadGoogleFonts, slugify, formatIdAsTitle, formatBytes
} from './helper-functions.js';

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
        this.gridLayout = [];
        this.GRID_LAYOUT_KEY = 'grid-layout';
        this.isRearranging = false;
        this.draggedItem = null;
        this.themeManager = new ThemeManager(this.db, new SoundboardDB('default'), this);
        this.boardManager = new BoardManager();
    }

    async initialize() {
        loadGoogleFonts(['Wellfleet']);
        await this.db.openDB();

        const urlParams = new URLSearchParams(window.location.search);
        const boardId = urlParams.get('board') || 'default';
        await BoardManager.addBoardId(boardId);

        await this._loadBoardData();
        this.attachGlobalEventListeners();
        // The grid is rendered by _loadBoardData now
    }

    // --- REFACTOR: Streamline the entire loading process ---
    async _loadBoardData() {
        await this.loadTitle();
        await this.themeManager.init();
        await this.initBugMovement();

        // This single method now handles loading all card data and the layout.
        await this.loadCardsAndLayout();
    }

    
    async loadCardsAndLayout() {
        this.soundboardGrid.innerHTML = ''; // Clear the grid
        this.allCards.clear(); // Clear the instance map

        try {
            const [allCardData, layoutData] = await Promise.all([
                this.db._dbRequest(this.db.CARDS_STORE, 'readonly', 'getAll'),
                this.db.get(this.GRID_LAYOUT_KEY)
            ]);

            allCardData.forEach(cardData => {
                let cardInstance;
                switch (cardData.type) {
                    case 'sound':
                        cardInstance = new SoundCard(cardData, this, this.db);
                        break;
                    case 'notepad':
                        cardInstance = new NotepadCard(cardData, this, this.db);
                        break;
                    case 'timer':
                        cardInstance = new TimerCard(cardData, this, this.db);
                        break;
                    default:
                        console.error(`Unknown card type: ${cardData.type}`);
                        return;
                }
                this.allCards.set(cardData.id, cardInstance);
            });

            if (layoutData && Array.isArray(layoutData.layout)) {
                this.gridLayout = layoutData.layout;
            } else {
                this.gridLayout = allCardData.map(cd => ({ type: cd.type, id: cd.id }));
                this.gridLayout.push({ type: 'control', id: 'control-card' });
                await this._saveLayout();
            }
            
            this.renderGrid();
            
            // NEW: After all cards are instantiated and rendered, broadcast commands.
            this._broadcastAvailableCommands(); 

        } catch (error) {
            console.error("Failed to load cards and layout:", error);
        }
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
        
        // REMOVED: The old, inefficient way of updating timers one-by-one is gone.
        // We now use the event broadcast pattern.
    }

    /**
     * Gathers all available commands from every card instance and broadcasts them
     * via a single global event.
     * @private
     */
    _broadcastAvailableCommands() {
        const allAvailableCommands = [];
        for (const card of this.allCards.values()) {
            // Use the `commands` getter from the RSSCard interface
            const cardCommands = card.commands; 
            
            if (cardCommands && cardCommands.length > 0) {
                allAvailableCommands.push({
                    cardId: card.id,
                    cardName: card.data.title, // Use the user-facing title
                    cardType: card.data.type,
                    commands: cardCommands
                });
            }
        }
        
        // Dispatch the single event with the complete payload.
        appEvents.dispatch('update:commands', allAvailableCommands);
    }

    async addCard(type, initialData = {}) {
        const newId = `${type}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        let cardData;

        // Create the default data object for the new card
        switch (type) {
            case 'sound':
                cardData = SoundCard.getInitialData(newId);
                break;
            case 'notepad':
                cardData = NotepadCard.getInitialData(newId);
                break;
            case 'timer':
                cardData = TimerCard.getInitialData(newId);
                break;
            default:
                console.error(`Attempted to add unknown card type: ${type}`);
                return;
        }

        this.gridLayout.push({ type: type, id: newId });
        
        await Promise.all([
            this.db.save(newId, cardData),
            this._saveLayout()
        ]);
        // 08262025
        // Instead of reloading everything, we can instantiate the card and broadcast.
        // For simplicity and consistency, the full reload is fine, but for optimization:
        // 1. Create the new card instance.
        // 2. Add it to `this.allCards`.
        // 3. Append its element to the grid.
        // 4. Then, call `_broadcastAvailableCommands()` to update all timers.
        // The current implementation re-runs loadCardsAndLayout, which works perfectly.
        await this.loadCardsAndLayout();
    }



    async createNewBoard() {
        const input = document.getElementById('new-board-name-input');
        if (input == null) { return; }
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

    // save the current grid layout to DB.
    async _saveLayout() {
        await this.db.save(this.GRID_LAYOUT_KEY, { id: this.GRID_LAYOUT_KEY, layout: this.gridLayout });
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
    // Event Handling -- will need a lot of cleanup after refactor is finished
    // ================================================================

    attachGlobalEventListeners() {

        document.getElementById('soundboard-title').addEventListener('blur', (e) => {
            const newTitle = e.target.textContent.trim();
            document.title = newTitle + " | B&M RSS";
            this.db.save('soundboard-title', { id: 'soundboard-title', title: newTitle });
        });

        this.soundboardGrid.addEventListener('dragstart', (e) => this.handleDragStart(e));
        this.soundboardGrid.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.soundboardGrid.addEventListener('dragenter', (e) => this.handleDragEnter(e));
        this.soundboardGrid.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        this.soundboardGrid.addEventListener('drop', (e) => this.handleDrop(e));
        this.soundboardGrid.addEventListener('dragend', (e) => this.handleDragEnd(e));

        // NEW ADD CARDS METHOD
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
            if (event.target.id === 'board-switcher-modal') {
                document.getElementById('board-switcher-modal').style.display = 'none';
            }
        });

        document.getElementById('db-manager-modal').addEventListener('click', (event) => {
            if (event.target.id === 'db-manager-modal') this.closeDbManagerModal();
        });
        document.getElementById('persistent-storage-checkbox').addEventListener('change', (e) => {
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
            if (event.target.id === 'help-modal') {
                document.getElementById('help-modal').style.display = 'none';
            }
        });
        document.querySelector('.help-accordion').addEventListener('click', (e) => {
            if (e.target.classList.contains('accordion-header')) {
                const activeHeader = document.querySelector('.accordion-header.active');
                // Close the already active header if it's not the one that was clicked
                if (activeHeader && activeHeader !== e.target) {
                    activeHeader.classList.remove('active');
                    activeHeader.nextElementSibling.classList.remove('active');
                }

                // Toggle the clicked header and its content
                e.target.classList.toggle('active');
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

    // DRAG & DROP HANDLERS ===================
    handleDragStart(event) {
        if (!this.isRearranging) return;
        this.draggedItem = event.target.closest('.sound-card');
        if (!this.draggedItem) return;
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
                await this._saveLayout();
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

    toggleRearrangeMode() {
        this.isRearranging = !this.isRearranging;
        const btn = document.getElementById('rearrange-mode-btn');
        const grid = document.getElementById('soundboard-grid');
        grid.classList.toggle('rearrange-mode', this.isRearranging);
        btn.textContent = this.isRearranging ? 'Done Rearranging' : 'Rearrange';

        grid.querySelectorAll('.sound-card').forEach(card => {
            card.setAttribute('draggable', this.isRearranging);
        });
    }


    // ================================================================
    // Global Functionality Methods
    // ================================================================

    /**
 * Safely removes a card from the application by its unique ID.
 * @param {string} cardIdToRemove The unique ID of the card to be removed.
 */
    async removeCard(cardIdToRemove) {
        const cardInstance = this.allCards.get(cardIdToRemove);
        if (!cardInstance) {
            console.error(`Attempted to remove a card that does not exist: ${cardIdToRemove}`);
            return;
        }

        // 1. Clean up the card instance (e.g., stop audio, clear intervals).
        if (typeof cardInstance.destroy === 'function') {
            cardInstance.destroy();
        }

        // 2. Remove the card from the DOM.
        cardInstance.cardElement.remove();

        // 3. Remove the card from our in-memory state.
        this.allCards.delete(cardIdToRemove);

        // 4. Update the grid layout.
        this.gridLayout = this.gridLayout.filter(item => item.id !== cardIdToRemove);

        // 5. Persist the changes to the database.
        await this.db.delete(cardIdToRemove);
        await this._saveLayout();

        // 6. Notify other components (like Timers) that a card was removed.
        appEvents.dispatch('cardDeleted', { deletedId: cardIdToRemove });

        console.log(`Successfully removed card: ${cardIdToRemove}`);
    }


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
                const data = JSON.parse(e.target.result);
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



    // ================================================================
    // Modal Manager Methods
    // ================================================================

    // if we end up making each class own its modals, this should go with SoundBoardDB?
    async showDbManagerModal() {
        this.updateDbStats();
        this.updateDbFileList();

        const checkbox = document.getElementById('persistent-storage-checkbox');
        // The persistent storage option may never work, and might not need to exist.
        if (navigator.storage && navigator.storage.persisted) {
            checkbox.parentElement.style.display = ''; // Ensure it's visible
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
            modal.style.zIndex = 1001;
        });
    }



    // Metaphorically speaking, the Helper Bug IS the SoundboardManager. She lives here <3

    async initBugMovement() {
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