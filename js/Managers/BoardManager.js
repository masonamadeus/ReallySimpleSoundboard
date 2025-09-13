import { SoundboardDB } from '../Core/SoundboardDB.js';
import { slugify } from '../Core/helper-functions.js';
export class BoardManager {
    constructor(soundboardManager) {
        this.manager = soundboardManager;
        this.modal = null;
        this.boardListElement = null;
    }

    init(modal, boardListElement){
        this.modal = modal;
        this.boardListElement = boardListElement;
        this._attachListeners();
    }

    _attachListeners() {
        this.modal.addEventListener('click', (event) => {
            //@ts-ignore
            if (event.target.id === 'board-switcher-modal') {
                this.close();
            }
        });

        const createBtn = this.modal.querySelector('#create-new-board-btn');
        if (createBtn) {
            createBtn.addEventListener('click', () => this.createNewBoard());
        }
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
