import { SoundboardDB } from '../Core/SoundboardDB.js';

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
                this.boardListElement.appendChild(listItem);
            });
        }
        this.modal.style.display = 'flex';
    }

    close() {
        this.modal.style.display = 'none';
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
