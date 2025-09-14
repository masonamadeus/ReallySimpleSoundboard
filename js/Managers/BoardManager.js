import { SoundboardDB } from '../Core/SoundboardDB.js';
import { slugify, arrayBufferToBase64, base64ToArrayBuffer } from '../Core/helper-functions.js';
import { CardRegistry } from '../Core/CardRegistry.js';
import { MSG } from '../Core/MSG.js';

export class BoardManager {
    constructor(soundboardManager) {
        this.manager = soundboardManager;
        this.modal = null;
        this.boardListElement = null;
        this.uploadBoardInput = null;
    }

    init(modal, boardListElement, uploadBoardInput) {
        this.modal = modal;
        this.boardListElement = boardListElement;
        this.uploadBoardInput = uploadBoardInput
        this._attachListeners();
    }

    _attachListeners() {
        this.modal.addEventListener('click', (event) => {
            //@ts-ignore
            if (event.target.id === 'board-switcher-modal') {
                this.close();
            }
        });

        // Update existing listeners and add new ones
        const createBtn = this.modal.querySelector('#create-new-board-btn');
        const downloadBtn = this.modal.querySelector('#download-board-btn');
        const uploadBtn = this.modal.querySelector('#upload-board-btn');

        if (createBtn) createBtn.addEventListener('click', () => this.createNewBoard());
        if (downloadBtn) downloadBtn.addEventListener('click', () => this.downloadBoard());
        if (uploadBtn) uploadBtn.addEventListener('click', () => this.uploadBoardInput.click());

        this.uploadBoardInput.addEventListener('change', (e) => this.uploadBoard(e));
    }

    async open() {
        const boardIds = await BoardManager.getBoardList(); // The static method is still useful
        this.boardListElement.innerHTML = ''; // Clear previous list

        if (boardIds.length === 0) {
            this.boardListElement.innerHTML = '<li><small>No other boards found.</small></li>';
        } else {
            boardIds.forEach(id => {
                const listItem = document.createElement('li');
                const link = document.createElement('a');
                link.textContent = id;
                link.href = (id === 'default') ? window.location.pathname : `?board=${id}`;
                listItem.appendChild(link);

                // Add a delete button for non-default boards
                if (id !== 'default') {
                    const deleteBtn = document.createElement('button');
                    deleteBtn.textContent = 'Delete';
                    deleteBtn.classList.add('delete-board-btn'); // For styling
                    deleteBtn.style.marginLeft = '10px'; // Basic styling
                    deleteBtn.onclick = (e) => {
                        e.preventDefault(); // Prevent navigation
                        this.deleteBoard(id);
                    };
                    listItem.appendChild(deleteBtn);
                }

                this.boardListElement.appendChild(listItem);
            });
        }
        this.modal.style.display = 'flex';
    }

    close() {
        this.modal.style.display = 'none';
    }

    async createNewBoard() {
        const input = this.modal.querySelector('#new-board-name-input');
        // @ts-ignore
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

        const existingBoardIds = await BoardManager.getBoardList();
        if (existingBoardIds.includes(boardId)) {
            alert(`A board with the name "${boardName}" already exists.`);
            return;
        }

        // If all checks pass, redirect to the new board URL.
        // The SoundboardManager will handle creating the new DB on page load.
        window.location.href = `?board=${boardId}`;
    }

    async deleteBoard(boardId) {
        const confirm = await this.manager.confirm(`Are you sure you want to permanently delete the "${boardId}" board and all its sounds? This cannot be undone.`)
        if (!confirm) {
            return;
        }

        try {
            // 1. Delete the IndexedDB database for the board
            await new Promise((resolve, reject) => {
                const deleteRequest = indexedDB.deleteDatabase(boardId);
                deleteRequest.onsuccess = () => {
                    console.log(`Database "${boardId}" deleted successfully.`);
                    resolve(true);
                };
                deleteRequest.onerror = (event) => {
                    console.error(`Error deleting database "${boardId}":`, event);
                    reject(new Error(`Error deleting database.`));
                };
                deleteRequest.onblocked = () => {
                    // This can happen if the DB is still in use in another tab.
                    console.warn(`Deletion of database "${boardId}" is blocked.`);
                    alert(`Could not delete the board because it's open in another tab. Please close other tabs and try again.`);
                    reject(new Error('Deletion blocked.'));
                };
            });

            // 2. Remove the board from the central list
            await BoardManager.removeBoardId(boardId);

            // 3. Refresh the board list in the modal
            await this.open();

            // 4. If the current board was deleted, redirect to the default board
            const currentBoardId = this.manager.getBoardId();
            if (currentBoardId === boardId) {
                window.location.href = window.location.pathname; // Redirect to default
            }

        } catch (error) {
            console.error(`Failed to delete board "${boardId}":`, error);
            alert(`An error occurred while trying to delete the board: ${error.message}`);
        }
    }

    async downloadBoard() {
        const currentDb = new SoundboardDB(this.manager.getBoardId());
        await currentDb.openDB();
        const allData = await currentDb.getAll();

        const titleItem = allData.find(item => item.id === 'soundboard-title');
        const boardTitle = titleItem ? titleItem.title : this.manager.getBoardId();

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
        a.download = `${slugify(boardTitle)}_ReallySimpleSoundboard.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async uploadBoard(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                const titleItem = data.find(item => item.id === 'soundboard-title');
                const suggestedName = titleItem ? titleItem.title : `imported-board-${Date.now()}`;

                const newBoardName = prompt("Please provide a name for this new board.", suggestedName);

                if (!newBoardName) {
                    event.target.value = ''; // Clear the input
                    return; // User cancelled
                }

                const newBoardId = slugify(newBoardName);
                const existingBoards = await BoardManager.getBoardList();
                if (existingBoards.includes(newBoardId)) {
                    alert(`A board named "${newBoardName}" already exists. Please choose a different name.`);
                    event.target.value = ''; // Clear the input
                    return;
                }

                // Create a new DB and populate it
                const newDb = new SoundboardDB(newBoardId);
                await newDb.openDB();

                const deserializedData = data.map(item => {
                    if (item.files && item.files.length > 0) {
                        const deserializedFiles = item.files.map(file => ({ ...file, arrayBuffer: base64ToArrayBuffer(file.arrayBuffer) }));
                        return { ...item, files: deserializedFiles };
                    }
                    return item;
                });

                // Ensure the title matches the new board name
                const newTitleItem = deserializedData.find(item => item.id === 'soundboard-title');
                if (newTitleItem) {
                    newTitleItem.title = newBoardName;
                } else {
                    deserializedData.push({ id: 'soundboard-title', title: newBoardName });
                }

                for (const item of deserializedData) {
                    await newDb.save(item.id, item);
                }

                alert(`Board "${newBoardName}" was successfully created!`);
                window.location.href = `?board=${newBoardId}`;

            } catch (err) {
                alert("Failed to read file. Please ensure it is a valid board JSON file.");
                console.error("Board upload error:", err);
            } finally {
                event.target.value = ''; // Clear the input
            }
        };
        reader.readAsText(file);
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
                    ...CardRegistry.SoundCard.Default(),
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
                    ...CardRegistry.TimerCard.Default(),
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
                newItem = { ...CardRegistry.NotepadCard.Default(), ...item, type: 'notepad' };
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

    // A helper to temporarily open a connection to the default DB
    static _getDefaultDB() {
        const db = new SoundboardDB('default');
        return db.openDB().then(() => db);
    }

    // Gets the list of board IDs from the default DB
    static async getBoardList() {
        const defaultDB = await this._getDefaultDB();
        const listData = await defaultDB.get('board-list');
        return listData ? listData.ids : [];
    }

    // Adds a new board ID to the list in the default DB
    static async addBoardId(boardId) {
        const defaultDB = await this._getDefaultDB();
        const boardIds = await this.getBoardList();
        if (!boardIds.includes(boardId)) {
            boardIds.push(boardId);
            await defaultDB.save('board-list', { id: 'board-list', ids: boardIds });
        }
    }

    static async saveBoardList(boardIds) {
        const defaultDB = await this._getDefaultDB();
        await defaultDB.save('board-list', { id: 'board-list', ids: boardIds });
    }

    static async removeBoardId(boardIdToRemove) {
        const defaultDB = await this._getDefaultDB();
        let boardIds = await this.getBoardList();
        // Filter the list to exclude the board we're removing
        boardIds = boardIds.filter(id => id !== boardIdToRemove);
        // Save the new, shorter list back to the database
        await defaultDB.save('board-list', { id: 'board-list', ids: boardIds });
    }
}
