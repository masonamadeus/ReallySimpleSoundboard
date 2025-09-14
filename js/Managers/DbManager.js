import { SoundboardDB } from '../Core/SoundboardDB.js';
import { formatBytes } from '../Core/helper-functions.js';

export class DbManager {
    constructor(soundboardManagerAPI) {
        this.manager = soundboardManagerAPI;
    }

    async init(currentDb) {
        this.db = currentDb;
        await this.db.openDB();
        this._getDOMElemons();
        this._attachListeners();
    }

    _getDOMElemons() {
        this.modal = document.getElementById('db-manager-modal');
        this.stats = {
            buttonCount: document.getElementById('db-button-count'),
            usage: document.getElementById('db-usage'),
            quota: document.getElementById('db-quota'),
        };
        this.fileList = document.getElementById('db-file-list');
        this.persistentStorageCheckbox = document.getElementById('persistent-storage-checkbox');
        this.clearDbBtn = document.getElementById('clear-database-btn');
    }

    _attachListeners() {
        this.modal.addEventListener('click', (event) => {
            if (event.target === this.modal) this.close();
        });

        this.persistentStorageCheckbox.addEventListener('change', (e) => {
            if (e.target.checked) this._requestPersistentStorage();
        });

        this.clearDbBtn.addEventListener('click', () => this._handleClearDatabase());
    }

    async open() {
        await this._updateDbStats();
        await this._updateDbFileList();
        await this._updatePersistenceUI();

        const boardId = this.manager.getBoardId();
        this.clearDbBtn.textContent = boardId === 'default'
            ? 'Reset Default Board...'
            : `Delete '${boardId}' Board...`;
        
        this.modal.style.display = 'flex';
    }

    close() {
        this.modal.style.display = 'none';
    }

    async _updateDbStats() {
        const allCards = await this.db._dbRequest(this.db.CARDS_STORE, 'readonly', 'getAll');
        const soundCards = allCards.filter(c => c.type === 'sound');
        this.stats.buttonCount.textContent = soundCards.length;

        if (navigator.storage && navigator.storage.estimate) {
            const { quota, usage } = await navigator.storage.estimate();
            this.stats.usage.textContent = formatBytes(usage);
            this.stats.quota.textContent = formatBytes(quota);
        } else {
            this.stats.usage.textContent = 'N/A';
            this.stats.quota.textContent = 'N/A';
        }
    }

    async _updateDbFileList() {
        const allCards = await this.db._dbRequest(this.db.CARDS_STORE, 'readonly', 'getAll');
        const soundCards = allCards.filter(c => c.type === 'sound');
        
        this.fileList.innerHTML = '';
        if (soundCards.length === 0) {
            this.fileList.innerHTML = '<li><small>No sounds found.</small></li>';
            return;
        }

        soundCards.forEach(item => {
            const li = document.createElement('li');
            li.textContent = `Button "${item.title}": ${item.files.length} file(s)`;
            this.fileList.appendChild(li);
        });
    }
    
    async _updatePersistenceUI() {
        if (navigator.storage && navigator.storage.persisted) {
            this.persistentStorageCheckbox.parentElement.style.display = '';
            const isPersisted = await navigator.storage.persisted();
            this.persistentStorageCheckbox.checked = isPersisted;
            this.persistentStorageCheckbox.disabled = isPersisted;
        } else {
            this.persistentStorageCheckbox.parentElement.style.display = 'none';
        }
    }

    async _requestPersistentStorage() {
        if (navigator.storage && navigator.storage.persist) {
            const isPersisted = await navigator.storage.persisted();
            if (!isPersisted) {
                const granted = await navigator.storage.persist();
                console.log(granted ? "Persistent storage granted!" : "Persistent storage denied.");
            }
        }
    }

    async _handleClearDatabase() {
        const boardId = this.manager.getBoardId();
        if (boardId === 'default') {
            const confirmed = await this.manager.confirm("This will wipe all cards and settings from the default board but will PRESERVE your list of other boards. Are you sure?");
            if (confirmed) {
                const boardList = await BoardManager.getBoardList();
                await this.db.clear();
                await BoardManager.saveBoardList(boardList);
                window.location.reload();
            }
        } else {
            const confirmed = await this.manager.confirm(`This will permanently delete the entire "${boardId}" board. Are you sure?`);
            if (confirmed) {
                await this.db.clear();
                await BoardManager.removeBoardId(boardId);
                window.location.href = window.location.pathname;
            }
        }
    }
}