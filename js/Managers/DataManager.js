import { formatBytes, slugify, arrayBufferToBase64, base64ToArrayBuffer } from '../Core/helper-functions.js';
import { SoundboardDB } from '../Core/SoundboardDB.js';
import { MSG } from '../Core/MSG.js';
import { store } from '../Core/StateStore.js';

export class DataManager {
    constructor() {
        this.selectedBoardId = null;
    }

    async init(currentDb, defaultDb) {
        this.defaultDb = defaultDb;
        this.db = currentDb;
        await this.db.openDB();
        this._getDOMElemons();
        this._attachListeners();
    }

// #region DOM ELEMENTS
    _getDOMElemons() {
        // Modals
        this.boardSwitcherModal = document.getElementById('board-switcher-modal');
        this.storageDataModal = document.getElementById('storage-data-modal');
        this.manageBoardsModal = document.getElementById('manage-boards-modal');

        // --- Board Switcher Modal Elements ---
        this.boardSwitcherElements = {
            boardList: this.boardSwitcherModal.querySelector('#board-list'),
            createBtn: this.boardSwitcherModal.querySelector('#create-new-board-btn'),
            newNameInput: this.boardSwitcherModal.querySelector('#new-board-name-input'),
            uploadBtn: this.boardSwitcherModal.querySelector('#upload-board-btn'),
            uploadInput: document.getElementById('upload-board-input'),
            downloadBtn: this.boardSwitcherModal.querySelector('#download-board-btn'),
        };

        // --- Storage & Data Modal Elements ---
        this.storageDataElements = {
            statsContainer: this.storageDataModal.querySelector('.stats-container'),
            dbExplorerContainer: this.storageDataModal.querySelector('#tab-explorer'),
            wipeBoardBtn: this.storageDataModal.querySelector('#wipe-board-btn'),
        };

        // --- Manage Boards Modal Elements ---
        this.manageBoardsElements = {
            boardSelect: this.manageBoardsModal.querySelector('#board-select'),
            fileSummary: this.manageBoardsModal.querySelector('.file-summary'),
            dbViewer: this.manageBoardsModal.querySelector('.db-viewer'),
            deleteBoardBtn: this.manageBoardsModal.querySelector('#delete-board-btn'),
        };
    }

    //#endregion
    // #region Event Listeners
    _attachListeners() {
        // --- Board Switcher Modal ---
        this.boardSwitcherModal.addEventListener('click', (event) => {
            if (event.target === this.boardSwitcherModal) this.closeBoardSwitcher();
        });
        this.boardSwitcherElements.createBtn.addEventListener('click', () => this.createNewBoard());
        this.boardSwitcherElements.uploadBtn.addEventListener('click', () => this.boardSwitcherElements.uploadInput.click());
        this.boardSwitcherElements.uploadInput.addEventListener('change', (e) => this.uploadBoard(e));
        this.boardSwitcherElements.boardList.addEventListener('click', (e) => {
            if (e.target.classList.contains('delete-board-btn')) {
                const boardId = e.target.dataset.boardId;
                this.deleteBoard(boardId);
            }
        });

        this.boardSwitcherElements.downloadBtn.addEventListener('click', () => this.downloadBoard());

        // --- Storage & Data Modal ---
        this.storageDataModal.addEventListener('click', (event) => {
            if (event.target === this.storageDataModal) this.closeStorageData();
        });
        this.storageDataElements.wipeBoardBtn.addEventListener('click', () => this.wipeCurrentBoard());
        this.storageDataModal.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tabName = btn.dataset.tab;
                // Deactivate all tabs and content
                this.storageDataModal.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
                // Activate the clicked tab and its content
                btn.classList.add('active');
                this.storageDataModal.querySelector(`#tab-${tabName}`).classList.add('active');

                // Load content when switching to a tab
                if (tabName === 'basic') this._renderBoardDetails(this.db.boardId);
                if (tabName === 'explorer') this._renderDbExplorer(this.db.boardId);
            });
        });


        // --- Manage Boards Modal ---
        this.manageBoardsModal.addEventListener('click', (event) => {
            if (event.target === this.manageBoardsModal) this.closeManageBoards();
        });

        this.manageBoardsElements.boardSelect.addEventListener('change', (e) => {
            this._renderManageBoardDetails(e.target.value)
        });

        this.manageBoardsElements.deleteBoardBtn.addEventListener('click', () => {
            this.deleteBoard(this.manageBoardsElements.boardSelect.value)
        });

        this.storageDataElements.dbExplorerContainer.addEventListener('click', (e) => {
            this._handleMenuClick(e)
        });

        this.manageBoardsElements.dbViewer.addEventListener('click', (e) => {
            this._handleMenuClick(e)
        });
    }

    async downloadBoard() {
        const boardId = this.db.boardId;
        const originalBtnText = this.boardSwitcherElements.downloadBtn.textContent;
        
        try {
            this.boardSwitcherElements.downloadBtn.textContent = "Packaging...";
            this.boardSwitcherElements.downloadBtn.disabled = true;

            // 1. Get ALL data from the current board's database
            const allData = await SoundboardDB.getDataFromBoard(boardId);

            // 2. Prepare the data for JSON (convert binary to base64)
            const exportData = allData.map(item => {
                if (item.type === 'sound' && item.files && item.files.length > 0) {
                    const convertedFiles = item.files.map(file => ({
                        ...file,
                        // Convert the binary ArrayBuffer to a string for JSON storage
                        arrayBuffer: arrayBufferToBase64(file.arrayBuffer)
                    }));
                    return { ...item, files: convertedFiles };
                }
                return item;
            });

            // 3. Trigger the file download
            const json = JSON.stringify(exportData, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            
            // Generate a nice filename
            const titleItem = allData.find(d => d.id === 'soundboard-title');
            const fileName = titleItem ? slugify(titleItem.title) : `board-${boardId}`;
            
            a.href = url;
            a.download = `RSS_Board_${fileName}_${new Date().toISOString().slice(0,10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

        } catch (err) {
            console.error("Export failed:", err);
            alert("Failed to export board. See console for details.");
        } finally {
            this.boardSwitcherElements.downloadBtn.textContent = originalBtnText;
            this.boardSwitcherElements.downloadBtn.disabled = false;
        }
    }

    // uploadBoard remains largely correct but ensure it redirects to the new board URL correctly
    async uploadBoard(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);

                // Legacy Migration (Simplified for brevity, matches your previous version)
                const isLegacy = data.some(item => typeof item.id === 'number');
                if (isLegacy) {
                    data.forEach(item => {
                        if (typeof item.id === 'number') {
                            item.type = 'sound';
                            item.title = item.name || `Sound ${item.id}`;
                            item.id = `sound-${item.id}`;
                        }
                    });
                }
                
                const titleItem = data.find(item => item.id === 'soundboard-title');
                const suggestedName = titleItem ? titleItem.title : `imported-${Date.now()}`;
                const newBoardName = prompt("Name for imported board:", suggestedName);

                if (!newBoardName) return;

                const newBoardId = slugify(newBoardName);
                const existingBoards = await this.getBoardList();
                if (existingBoards.includes(newBoardId)) {
                    alert("A board with that name already exists.");
                    return;
                }

                // Deserialization: Convert Base64 back to ArrayBuffers
                const deserializedData = data.map(item => {
                    if (item.files && item.files.length > 0) {
                        const deserializedFiles = item.files.map(file => ({
                            ...file,
                            arrayBuffer: base64ToArrayBuffer(file.arrayBuffer)
                        }));
                        return { ...item, files: deserializedFiles };
                    }
                    return item;
                });

                // Save to new DB
                const newDb = new SoundboardDB(newBoardId);
                await newDb.openDB();
                for (const item of deserializedData) {
                    await newDb.save(item.id, item);
                }

                await this.addBoardId(newBoardId);
                window.location.href = `?board=${newBoardId}`;

            } catch (err) {
                alert("Upload failed: Invalid board file.");
                console.error(err);
            }
        };
        reader.readAsText(file);
    }

    _handleMenuClick = (e) => {
            const target = e.target.closest('.has-children');
            if (target && target.parentElement.classList.contains('db-explorer-menu')) {
                // Toggle 'open' class for sub-menu visibility on touch devices
                target.classList.toggle('open');
            }
    };

    /**
     * NEW: Recursively builds a nested HTML <ul> menu from a JavaScript object or array.
     * @param {object|Array} data The data to render.
     * @returns {HTMLUListElement} The generated list element.
     */
    _createRecursiveMenu(data) {
        if (typeof data !== 'object' || data === null) {
            return null;
        }

        const ul = document.createElement('ul');
        ul.className = 'db-explorer-menu';

        // Use Object.entries for arrays and objects
        Object.entries(data).forEach(([key, value]) => {
            const li = document.createElement('li');
            const isObject = typeof value === 'object' && value !== null;
            const hasChildren = isObject && Object.keys(value).length > 0;

            // Create the main label for the list item
            const label = document.createElement('div');
            label.className = 'db-menu-label';
            label.innerHTML = `<strong>${key}:</strong> `;

            if (hasChildren) {
                li.classList.add('has-children');
                label.innerHTML += `<span class="db-value-object">{...}</span>`;
                // Recursively build the sub-menu
                li.appendChild(label);
                li.appendChild(this._createRecursiveMenu(value));
            } else {
                let displayValue;
                if (key === 'arrayBuffer') {
                    displayValue = `<span class="db-value-omitted">...omitted...</span>`;
                } else {
                    let textValue = JSON.stringify(value);
                    if (textValue && textValue.length > 50) {
                        textValue = textValue.substring(0, 50) + '...';
                    }
                    displayValue = `<span class="db-value">${textValue}</span>`;
                }
                label.innerHTML += displayValue;
                li.appendChild(label);
            }
            ul.appendChild(li);
        });

        return ul;
    }

    //#endregion
    // #region Board Switcher Modal
    async openBoardSwitcher() {
        await this._renderBoardList();
        this.boardSwitcherModal.style.display = 'flex';
    }

    closeBoardSwitcher() {
        this.boardSwitcherModal.style.display = 'none';
    }

    async _renderBoardList() {
        const boardIds = await this.getBoardList();
        this.boardSwitcherElements.boardList.innerHTML = ''; // Clear list

        if (!boardIds || boardIds.length === 0) {
            this.boardSwitcherElements.boardList.innerHTML = '<p>No boards found.</p>';
            return;
        }

        boardIds.forEach(id => {
            const item = document.createElement('div');
            item.className = 'board-list-item';
            const link = document.createElement('a');
            link.href = (id === 'default') ? window.location.pathname : `?board=${id}`;
            link.textContent = id;
            item.appendChild(link);

            if (id !== 'default') {
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-board-btn';
                deleteBtn.textContent = 'Delete';
                deleteBtn.dataset.boardId = id;
                item.appendChild(deleteBtn);
            }
            this.boardSwitcherElements.boardList.appendChild(item);
        });
    }
    // #endregion

    // #region Storage & Data Modal
    async openStorageData() {
        // Reset to basic tab first
        this.storageDataModal.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
        this.storageDataModal.querySelector('.tab-btn[data-tab="basic"]').classList.add('active');
        this.storageDataModal.querySelector('#tab-basic').classList.add('active');
        // Then render the details for the current board
        await this._renderBoardDetails(this.db.boardId);
        this.storageDataModal.style.display = 'flex';
    }

    closeStorageData() {
        this.storageDataModal.style.display = 'none';
    }

    async _renderBoardDetails(boardId) {
        const container = this.storageDataElements.statsContainer;
        container.innerHTML = `<p>Loading stats for '${boardId}'...</p>`;
        try {
            const boardData = await SoundboardDB.getDataFromBoard(boardId);
            const soundCards = boardData.filter(d => d.type === 'sound');
            const totalFiles = soundCards.reduce((acc, card) => acc + (card.files ? card.files.length : 0), 0);
            const estimate = await navigator.storage.estimate();

            container.innerHTML = `
                <h3>'${boardId}' Board</h3>
                <div class="stat-line"><span>Sound Cards:</span> <span>${soundCards.length}</span></div>
                <div class="stat-line"><span>Total Audio Files:</span> <span>${totalFiles}</span></div>
                <hr>
                <h3>Storage (All Boards)</h3>
                <div class="stat-line"><span>Usage:</span> <span>${formatBytes(estimate.usage)}</span></div>
                <div class="stat-line"><span>Quota:</span> <span>${formatBytes(estimate.quota)}</span></div>
            `;
        } catch (error) {
            container.innerHTML = `<p class="error">Could not load data for '${boardId}'.</p>`;
            console.error(error);
        }
    }

    async _renderDbExplorer(boardId) {
        const container = this.storageDataElements.dbExplorerContainer;
        container.innerHTML = 'Loading...';
        try {
            const data = await SoundboardDB.getDataFromBoard(boardId);
            const menu = this._createRecursiveMenu(data);
            container.innerHTML = ''; // Clear loading text
            if (menu) {
                container.appendChild(menu);
            }
        } catch (error) {
            container.innerHTML = `<p class="error">Could not load data for '${boardId}'.</p>`;
        }
    }

    async wipeCurrentBoard() {
        const confirm = await MSG.confirm(`Are you sure you want to wipe all data from the '${this.db.boardId}' board? This will leave you with a blank board.`);
        if (!confirm) return;
        await this.db.clear();
        window.location.reload();
    }
    // #endregion

    // #region Manage Boards Modal
    async openManageBoards() {
        await this._populateBoardSelect();
        const selectedBoard = this.manageBoardsElements.boardSelect.value;
        if (selectedBoard) {
            await this._renderManageBoardDetails(selectedBoard);
        }
        this.manageBoardsModal.style.display = 'flex';
    }

    closeManageBoards() {
        this.manageBoardsModal.style.display = 'none';
    }

    async _populateBoardSelect() {
        const boardIds = await this.getBoardList();
        const select = this.manageBoardsElements.boardSelect;
        select.innerHTML = '';
        boardIds.forEach(id => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = id;
            select.appendChild(option);
        });
    }

    async _renderManageBoardDetails(boardId) {
        this.manageBoardsElements.fileSummary.innerHTML = 'Loading...';
        this.manageBoardsElements.dbViewer.innerHTML = 'Loading...';
        try {
            const data = await SoundboardDB.getDataFromBoard(boardId);

            // ... (File Summary logic remains the same) ...
            const soundCards = data.filter(d => d.type === 'sound' && d.files && d.files.length > 0);
            let fileSummaryHtml = `<h4>File Summary for '${boardId}'</h4>`;
            if (soundCards.length === 0) {
                fileSummaryHtml += '<p>No audio files found.</p>';
            } else {
                fileSummaryHtml += '<ul>';
                soundCards.forEach(card => {
                    fileSummaryHtml += `<li><b>${card.title}:</b> ${card.files.length} file(s)</li>`;
                });
                fileSummaryHtml += '</ul>';
            }
            this.manageBoardsElements.fileSummary.innerHTML = fileSummaryHtml;

            // MODIFIED: Use the recursive menu for the DB Viewer
            const menu = this._createRecursiveMenu(data);
            const dbViewerContainer = this.manageBoardsElements.dbViewer;
            dbViewerContainer.innerHTML = ''; // Clear loading text
            if (menu) {
                dbViewerContainer.appendChild(menu);
            }
        } catch (error) {
            this.manageBoardsElements.fileSummary.innerHTML = `<p class="error">Could not load file summary.</p>`;
            this.manageBoardsElements.dbViewer.innerHTML = `<p class="error">Could not load database view.</p>`;
        }
    }
    // #endregion


    // #region Common Board Actions ---
    async createNewBoard() {
        const boardName = this.boardSwitcherElements.newNameInput.value.trim();

        if (!boardName) {
            alert("Please enter a name for the new board.");
            return;
        }

        const boardId = slugify(boardName);
        if (!boardId) {
            alert("Please enter a valid name (letters and numbers).");
            return;
        }

        const existingBoards = await this.getBoardList();
        if (existingBoards.includes(boardId)) {
            alert(`A board named "${boardName}" already exists. Please choose a different name.`);
            return;
        }

        window.location.href = `?board=${boardId}`;
    }

    async uploadBoard(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);


                // ================================================================
                // LEGACY MIGRATION INTERCEPT (V1 -> V2)
                // Detects old integer IDs or flat array layouts
                // ================================================================
                const isLegacy = data.some(item => 
                    typeof item.id === 'number' || 
                    (item.id === 'grid-layout' && Array.isArray(item.layout))
                );

                if (isLegacy) {
                    console.log("Legacy board detected. Migrating data to V2 format...");
                    data.forEach(item => {
                        // 1. Migrate Sound Cards (Integer IDs -> 'sound-X')
                        if (typeof item.id === 'number') {
                            item.type = 'sound';
                            item.title = item.name || `Sound ${item.id}`; // Map 'name' to 'title'
                            delete item.name;
                            item.id = `sound-${item.id}`;
                        }
                        // 2. Migrate existing Timer/Notepad Cards
                        else if (typeof item.id === 'string') {
                            if (item.id.startsWith('timer-')) item.type = 'timer';
                            if (item.id.startsWith('notepad-')) item.type = 'notepad';
                        }

                        // 3. Migrate Grid Layout (Flat Array -> Tree Node Object)
                        if (item.id === 'grid-layout' && Array.isArray(item.layout)) {
                            const newChildren = item.layout.map(oldNode => {
                                let newId = oldNode.id;
                                // Fix the integer references in the layout array
                                if (oldNode.type === 'sound' && typeof oldNode.id === 'number') {
                                    newId = `sound-${oldNode.id}`;
                                }
                                return {
                                    id: String(newId),
                                    type: oldNode.type,
                                    gridSpan: { column: 1, row: 1 },
                                    children: []
                                };
                            });

                            item.layout = {
                                id: 'root',
                                type: 'grid',
                                gridSpan: { column: 1, row: 1 },
                                children: newChildren
                            };
                        }
                    });
                }
                // ================================================================
                
                const titleItem = data.find(item => item.id === 'soundboard-title');
                const suggestedName = titleItem ? titleItem.title : `imported-board-${Date.now()}`;
                const newBoardName = prompt("Please provide a name for this new board.", suggestedName);

                if (!newBoardName) {
                    event.target.value = '';
                    return;
                }

                const newBoardId = slugify(newBoardName);
                const existingBoards = await this.getBoardList();
                if (existingBoards.includes(newBoardId)) {
                    alert(`A board named "${newBoardName}" already exists. Please choose a different name.`);
                    event.target.value = '';
                    return;
                }

                const newDb = new SoundboardDB(newBoardId);
                await newDb.openDB();

                const deserializedData = data.map(item => {
                    if (item.files && item.files.length > 0) {
                        const deserializedFiles = item.files.map(file => ({ ...file, arrayBuffer: base64ToArrayBuffer(file.arrayBuffer) }));
                        return { ...item, files: deserializedFiles };
                    }
                    return item;
                });

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
                event.target.value = '';
            }
        };
        reader.readAsText(file);
    }

    async getBoardList() {
        const listData = await this.defaultDb.get('board-list');
        // Ensure 'default' is always in the list
        const ids = new Set(listData ? listData.ids : []);
        ids.add('default');
        return Array.from(ids);
    }

    async addBoardId(boardId) {
        const boardIds = await this.getBoardList();
        if (!boardIds.includes(boardId)) {
            boardIds.push(boardId);
            await this.defaultDb.save('board-list', { id: 'board-list', ids: boardIds });
        }
    }

    async removeBoardId(boardIdToRemove) {
        let boardIds = await this.getBoardList();
        boardIds = boardIds.filter(id => id !== boardIdToRemove);
        await this.defaultDb.save('board-list', { id: 'board-list', ids: boardIds });
    }

    async deleteBoard(boardId) {
        if (boardId === 'default') {
            alert("The default board cannot be deleted.");
            return;
        }

        const confirm = await MSG.confirm(`Are you sure you want to permanently delete the "${boardId}" board and all its sounds? This cannot be undone.`);
        if (!confirm) return;

        try {
            await SoundboardDB.deleteDatabase(boardId);
            await this.removeBoardId(boardId);

            // Refresh the UI of any open modals
            if (this.boardSwitcherModal.style.display === 'flex') await this._renderBoardList();
            if (this.manageBoardsModal.style.display === 'flex') await this.openManageBoards();


            // If the current board was deleted, redirect.
            if (store.getState().boardId === boardId) {
                window.location.href = window.location.pathname; // Redirect to default
            }

        } catch (error) {
            console.error(`Failed to delete board "${boardId}":`, error);
            alert(`An error occurred while trying to delete the board: ${error.message}`);
        }
    }
    // #endregion
}