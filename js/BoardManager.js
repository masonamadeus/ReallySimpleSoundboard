import { SoundboardDB } from './SoundboardDB.js';

export class BoardManager {
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
