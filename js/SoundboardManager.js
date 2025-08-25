import { AudioPlayer } from './AudioPlayer.js';
import { TimerCard } from './TimerCard.js';
import { NotepadCard } from './NotepadCard.js';
import { SoundCard } from './SoundCard.js';
import { SoundboardDB } from './SoundboardDB.js';
import { BoardManager } from './BoardManager.js';
import { ThemeManager } from './ThemeManager.js';
import {
    appEvents, arrayBufferToBase64, base64ToArrayBuffer,
    loadGoogleFonts, slugify, formatIdAsTitle, formatBytes,
    getContrastColor, debounce, randomButNot
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

        this.buttonsData = [];
        this.timerCards = [];
        this.notepadCards = [];
        this.soundCards = new Map();

        this.gridLayout = [];
        this.GRID_LAYOUT_KEY = 'grid-layout';
        this.activeModalIndex = null;
        this.isRearranging = false;
        this.draggedItem = null;

        this.themeManager = new ThemeManager(this.db, new SoundboardDB('default'), this);


    }

    // ================================================================
    // Core Manager Methods
    // ================================================================

    async initialize() {
        loadGoogleFonts(['Wellfleet']);
        await this.db.openDB();

        const urlParams = new URLSearchParams(window.location.search);
        const boardId = urlParams.get('board') || 'default';
        await BoardManager.addBoardId(boardId);

        await this._loadBoardData();
        this.attachGlobalEventListeners();
        this.renderGrid();
    }

    async _loadBoardData() {
        await this.loadTitle();
        await this.themeManager.init();
        await this.loadStateFromDB(); // Loads sound buttons
        await this.loadTimers();
        await this.loadNotepads();
        await this.initBugMovement();
        await this.loadLayout();

    }

    async createNewBoard() {
        const input = document.getElementById('new-board-name-input');
        if (input == null ){ return; }
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

    // load the grid layout from DB or create a default.
    async loadLayout() {
        const layoutData = await this.db.get(this.GRID_LAYOUT_KEY);
        if (layoutData && Array.isArray(layoutData.layout)) {
            this.gridLayout = layoutData.layout;
        } else {
            this._generateDefaultLayout();
            await this._saveLayout();
        }
    }

    // save the current grid layout to DB.
    async _saveLayout() {
        await this.db.save(this.GRID_LAYOUT_KEY, { id: this.GRID_LAYOUT_KEY, layout: this.gridLayout });
    }

    // create a default layout if none exists.
    _generateDefaultLayout() {
        this.gridLayout = [
            { type: 'sound', id: 0 },
            { type: 'sound', id: 1 },
            { type: 'sound', id: 2 },
            { type: 'sound', id: 3 },
            { type: 'timer', id: 0 },
            { type: 'control', id: 'control-card' }
        ];
    }

    async loadNotepads() {
        const notepadCountData = await this.db.get('notepadCount');
        const numNotepads = notepadCountData ? notepadCountData.count : 0;
        const notepadTemplate = document.getElementById('notepad-card-template');

        for (let i = 0; i < numNotepads; i++) {
            // Find the highest existing ID to avoid collisions
            const existingIds = this.notepadCards.map(n => n.id);
            const nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : i;

            const newCard = notepadTemplate.content.cloneNode(true).querySelector('.notepad-card');
            newCard.dataset.cardType = 'notepad';
            newCard.dataset.cardId = nextId;
            this.notepadCards.push(new NotepadCard(newCard, this, this.db));
        }
    }

    // Add this new method to add a notepad
    async addNotepad() {
        const existingIds = this.notepadCards.map(n => n.id);
        const nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 0;

        const newCard = document.getElementById('notepad-card-template').content.cloneNode(true).querySelector('.notepad-card');
        newCard.dataset.cardType = 'notepad';
        newCard.dataset.cardId = nextId;

        this.notepadCards.push(new NotepadCard(newCard, this, this.db));

        const controlCardIndex = this.gridLayout.findIndex(item => item.type === 'control');
        this.gridLayout.splice(controlCardIndex, 0, { type: 'notepad', id: nextId });

        await this.db.save('notepadCount', { id: 'notepadCount', count: this.notepadCards.length });
        await this._saveLayout();
        this.renderGrid();
    }

    async removeNotepad(idToRemove) {
        const confirmed = await this.showConfirmModal('Are you sure you want to delete this note?');
        if (!confirmed) return;

        this.notepadCards = this.notepadCards.filter(n => n.id !== idToRemove);
        this.gridLayout = this.gridLayout.filter(item => !(item.type === 'notepad' && item.id === idToRemove));

        await this.db.delete(`notepad-${idToRemove}`);
        await this.db.save('notepadCount', { id: 'notepadCount', count: this.notepadCards.length });
        await this._saveLayout();
        this.renderGrid();
    }

    async loadTimers() {
        const timerCountData = await this.db.get('timerCount');
        const numTimers = timerCountData ? timerCountData.count : 0;
        const timerTemplate = document.getElementById('timer-card-template');

        // Use Promise.all to initialize all timers in parallel for speed
        const timerPromises = [];
        for (let i = 0; i < numTimers; i++) {
            const timerId = i; // This might need to be more robust if IDs aren't sequential
            const newCard = timerTemplate.content.cloneNode(true).querySelector('.timer-card');
            newCard.dataset.cardType = 'timer';
            newCard.dataset.cardId = timerId;

            const timerInstance = new TimerCard(newCard, this, this.db);
            this.timerCards.push(timerInstance);
            timerPromises.push(timerInstance.init()); // Add the init promise to the array
        }
        await Promise.all(timerPromises); // Wait for all timers to be initialized
    }

    async addTimer() {
        const nextTimerIndex = this.timerCards.length > 0 ? Math.max(...this.timerCards.map(t => t.id)) + 1 : 0;
        const newCard = document.getElementById('timer-card-template').content.cloneNode(true).querySelector('.timer-card');
        newCard.dataset.cardType = 'timer';
        newCard.dataset.cardId = nextTimerIndex;

        const newTimer = new TimerCard(newCard, this, this.db);
        this.timerCards.push(newTimer);
        await newTimer.init(); // Await initialization before proceeding

        const controlCardIndex = this.gridLayout.findIndex(item => item.type === 'control');
        this.gridLayout.splice(controlCardIndex, 0, { type: 'timer', id: nextTimerIndex });

        await this.db.save('timerCount', { id: 'timerCount', count: this.timerCards.length });
        await this._saveLayout();
        this.renderGrid();
    }

    async removeTimer(idToRemove) {
        const confirmed = await this.showConfirmModal('Are you sure you want to delete this timer?');
        if (!confirmed) return;

        const timerInstance = this.timerCards.find(t => t.id === idToRemove);
        if (timerInstance) {
            timerInstance.destroy(); // Clean up the animation frame loop
        }

        this.timerCards = this.timerCards.filter(t => t.id !== idToRemove);
        this.gridLayout = this.gridLayout.filter(item => !(item.type === 'timer' && item.id === idToRemove));

        await this.db.delete(`timer-${idToRemove}`);
        await this.db.save('timerCount', { id: 'timerCount', count: this.timerCards.length });
        await this._saveLayout();
        this.renderGrid();
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


    async loadStateFromDB() {
        const soundData = await this.db._dbRequest(this.db.SOUNDS_STORE, 'readonly', 'getAll');
        let configData = await this.db.get(this.db.CONFIG_KEY);
        if (!configData) {
            configData = { id: this.db.CONFIG_KEY, numButtons: 4 };
            await this.db.save(configData.id, configData);

            // Set the default number of timers to 1
            await this.db.save('timerCount', { id: 'timerCount', count: 1 });
        }

        const numButtons = configData.numButtons;
        const soundDataMap = new Map(soundData.map(item => [item.id, item]));

        this.buttonsData = [];
        for (let i = 0; i < numButtons; i++) {
            const data = soundDataMap.get(i) || this._getInitialButtonData(i);
            this.buttonsData.push(data);
        }
    }

    async addButton() {
        const nextIndex = this.buttonsData.length;
        const newButtonData = this._getInitialButtonData(nextIndex);
        this.buttonsData.push(newButtonData);

        // Add the new button to the layout and re-render.
        const controlCardIndex = this.gridLayout.findIndex(item => item.type === 'control');
        if (controlCardIndex > -1) {
            this.gridLayout.splice(controlCardIndex, 0, { type: 'sound', id: nextIndex });
        } else {
            this.gridLayout.push({ type: 'sound', id: nextIndex });
        }

        await this.db.save(this.db.CONFIG_KEY, { id: this.db.CONFIG_KEY, numButtons: this.buttonsData.length });
        await this._saveLayout();
        this.renderGrid();
    }

    async removeLastButton() {
        if (this.buttonsData.length > 1) {
            const lastIndex = this.buttonsData.length - 1;
            this.buttonsData.pop();
            if (this.players.has(lastIndex)) {
                this.players.get(lastIndex).cleanup();
                this.players.delete(lastIndex);
            }
            await this.db.delete(lastIndex);
            await this.db.save(this.db.CONFIG_KEY, { id: this.db.CONFIG_KEY, numButtons: this.buttonsData.length });

            // RRemove from layout and re-render.
            this.gridLayout = this.gridLayout.filter(item => !(item.type === 'sound' && item.id === lastIndex));
            await this._saveLayout();
            this.renderGrid();
        }
    }

    // belongs to soundcard
    async updateButton(index, newData) {
        this.buttonsData[index] = { ...this.buttonsData[index], ...newData };
        await this.db.save(index, this.buttonsData[index]);
        this.renderGrid();
    }

    // ================================================================
    // UI Rendering Methods - will need significant revisit during refactor away from grid-based IDs to unique ones.
    // ================================================================

    renderGrid() {
        this.soundboardGrid.innerHTML = '';

        this.gridLayout.forEach(item => {
            let cardElement = null;
            if (item.type === 'sound') {
                const buttonData = this.buttonsData.find(b => b.id === item.id);
                if (buttonData) {
                    // Create a new SoundCard instance and get its element
                    const soundCard = new SoundCard(buttonData, this);
                    this.soundCards.set(buttonData.id, soundCard);
                    cardElement = soundCard.element;
                }
            } else if (item.type === 'timer') {
                const timerInstance = this.timerCards.find(t => t.id === item.id);
                if (timerInstance) {
                    cardElement = timerInstance.cardElement;
                }
            } else if (item.type === 'control') {
                cardElement = this.controlCardElement;
                cardElement.style.display = 'flex';
            } else if (item.type === 'notepad') {
                const noteInstance = this.notepadCards.find(n => n.id === item.id);
                if (noteInstance) {
                    cardElement = noteInstance.cardElement;
                }
            }

            if (cardElement) {
                this.soundboardGrid.appendChild(cardElement);
            }
        });

        this.timerCards.forEach(timer => timer.updateTimerSoundSelectors(this.buttonsData));
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

        document.getElementById('add-notepad-btn').addEventListener('click', () => this.addNotepad());
        document.getElementById('add-btn-plus').addEventListener('click', () => this.addButton());
        document.getElementById('remove-button-modal').addEventListener('click', () => this._handleRemoveButton());
        document.getElementById('add-timer-btn').addEventListener('click', () => this.addTimer());
        document.getElementById('rearrange-mode-btn').addEventListener('click', () => this.toggleRearrangeMode());
        document.getElementById('download-config-btn').addEventListener('click', () => this.downloadConfig());
        document.getElementById('upload-config-btn').addEventListener('click', () => document.getElementById('upload-config-input').click());
        document.getElementById('upload-config-input').addEventListener('change', (e) => this.uploadConfig(e));
        document.getElementById('db-manager-btn').addEventListener('click', () => this.showDbManagerModal());

        document.getElementById('switch-board-btn').addEventListener('click', () => this.openBoardSwitcherModal());
        document.getElementById('create-new-board-btn').addEventListener('click', () => this.createNewBoard());

        // listener to close the board switcher modal when clicking the background
        document.getElementById('board-switcher-modal').addEventListener('click', (event) => {
            if (event.target.id === 'board-switcher-modal') {
                document.getElementById('board-switcher-modal').style.display = 'none';
            }
        });


        document.getElementById('settings-modal').addEventListener('click', (event) => {
            if (event.target.id === 'settings-modal') this.closeSettingsModal();
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

        document.getElementById('button-name-input').addEventListener('input', (e) => this.updateModalButtonData('name', e.target.value));
        document.getElementById('button-color-picker').addEventListener('input', (e) => this.updateModalButtonData('color', e.target.value));
        document.getElementById('add-file-input').addEventListener('change', (e) => this.addFilesToModalButton(e));
        document.getElementById('clear-files-btn').addEventListener('click', () => this.clearModalButtonFiles());
        document.getElementById('shuffle-checkbox').addEventListener('change', (e) => this.updateModalButtonData('shuffle', e.target.checked));
        document.getElementById('autoplay-checkbox').addEventListener('change', (e) => this.updateModalButtonData('autoplay', e.target.checked));
        document.getElementById('priority-checkbox').addEventListener('change', (e) => this.updateModalButtonData('priority', e.target.checked));
        document.getElementById('loop-checkbox').addEventListener('change', (e) => this.updateModalButtonData('loop', e.target.checked));


        // COSMETICS MODAL LISTENERS
        document.getElementById('cosmetics-btn').addEventListener('click', () => this.themeManager.open());

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
            const fromType = this.draggedItem.dataset.cardType;
            const fromId = fromType === 'control' ? 'control-card' : parseInt(this.draggedItem.dataset.cardId);
            const toType = targetCard.dataset.cardType;
            const toId = toType === 'control' ? 'control-card' : parseInt(targetCard.dataset.cardId);

            const fromIndex = this.gridLayout.findIndex(item => item.type === fromType && item.id === fromId);
            const toIndex = this.gridLayout.findIndex(item => item.type === toType && item.id === toId);

            if (fromIndex > -1 && toIndex > -1) {
                [this.gridLayout[fromIndex], this.gridLayout[toIndex]] = [this.gridLayout[toIndex], this.gridLayout[fromIndex]];
                await this._saveLayout();
                this.renderGrid();
            }
        }
    }

    handleDragEnd() {
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

    // =====================================================
    // PLAYBACK LOGIC (WHICH SHOULD BE MOVED TO SOUNDCARD CLASS)
    // =====================================================

    handlePriorityDucking(priorityCardId) {
        this.soundCards.forEach(card => {
            // Duck any card that is NOT the priority card, is NOT itself a priority card, and is currently playing
            if (card.data.id !== priorityCardId && !card.data.priority && card.player.isPlaying) {
                // This is a simple volume drop. A fancier version could fade the volume.
                card.player.audio.volume = card.data.volume * 0.4;
            }
        });
    }

    handlePriorityUnducking() {
        // Check if any *other* priority sounds are still playing
        const isOtherPriorityPlaying = Array.from(this.soundCards.values())
            .some(card => card.data.priority && card.player.isPlaying);

        // If no other priority sounds are playing, restore the volume on ducked cards
        if (!isOtherPriorityPlaying) {
            this.soundCards.forEach(card => {
                if (!card.data.priority) {
                    // Restore volume
                    card.player.audio.volume = card.data.volume;
                }
            });
        }
    }

    // what is this doing here? this should be handled by soundcard class
    _getInitialButtonData(index) {
        return {
            id: index,
            name: `Button ${index + 1}`,
            color: "var(--accent-color)",
            volume: 1.0,
            playbackRate: 1.0,
            shuffle: false,
            loop: false,
            priority: false,
            files: []
        };
    }

    


    // ================================================================
    // Settings Modal Methods - These probably should ALL be moved to the soundcard class?
    // ================================================================

    openSettingsModal(index) {
        this.activeModalIndex = index;
        const buttonData = this.buttonsData[index];
        const modal = document.getElementById('settings-modal');

        const colorPicker = document.getElementById('button-color-picker');
        let colorValue = this.buttonsData[index].color;

        // Check if the stored color is a CSS variable
        if (colorValue.startsWith('var(')) {
            // Extract the variable name (e.g., '--accent-color') from the string.
            const cssVarName = colorValue.match(/--[\w-]+/)[0];

            // Get the computed style from the root element and retrieve the variable's value.
            colorValue = getComputedStyle(document.documentElement).getPropertyValue(cssVarName).trim();
        }

        // 3. Set the color picker's value to the resolved hex code.
        colorPicker.value = colorValue;

        document.getElementById('button-name-input').value = buttonData.name;
        document.getElementById('shuffle-checkbox').checked = buttonData.shuffle;
        document.getElementById('autoplay-checkbox').checked = buttonData.autoplay;
        document.getElementById('priority-checkbox').checked = buttonData.priority;
        document.getElementById('loop-checkbox').checked = buttonData.loop;
        this._renderFileList(buttonData.files);

        modal.style.display = 'flex';
    }

    //belongs in soundcard class
    closeSettingsModal() {
        const modal = document.getElementById('settings-modal');
        modal.style.display = 'none';
        this.activeModalIndex = null;
        this.renderGrid();
    }

    // belongs in soundcard class
    updateModalButtonData(key, value) {
        if (this.activeModalIndex !== null) {
            const buttonData = this.buttonsData[this.activeModalIndex];
            buttonData[key] = value;
            this.updateButton(this.activeModalIndex, buttonData);
        }
    }


    // Should move this to SoundCard class
    _renderFileList(files) {
        const fileListElement = document.getElementById('file-list');
        fileListElement.innerHTML = ''; // Clear the list first

        if (files.length === 0) {
            const emptyItem = document.createElement('li');
            emptyItem.innerHTML = '<small>No files added yet.</small>';
            fileListElement.appendChild(emptyItem);
            return;
        }

        files.forEach((file, index) => {
            const listItem = document.createElement('li');
            // The button is now just part of the HTML string. The single,
            // delegated listener on the parent list will handle its click.
            listItem.innerHTML = `
            <span>${file.fileName}</span>
            <button data-file-index="${index}" class="remove-file-button">Remove</button>
        `;
            fileListElement.appendChild(listItem);
        });
    }


// should be moved to soundcard class during refactor & decouple from grid-based IDs
    async addFilesToModalButton(event) {
        if (this.activeModalIndex === null) return;
        const files = event.target.files;
        if (files.length === 0) return;

        const buttonData = this.buttonsData[this.activeModalIndex];
        // +++ ADD: Get the actual SoundCard instance +++
        const soundCard = this.soundCards.get(this.activeModalIndex);

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const arrayBuffer = await file.arrayBuffer();
            const fileData = { fileName: file.name, mimeType: file.type, arrayBuffer: arrayBuffer };
            buttonData.files.push(fileData);

            // +++ ADD: Tell the SoundCard to process the new file +++
            if (soundCard) {
                await soundCard._processFile(fileData);
            }
        }
        await this.updateButton(this.activeModalIndex, buttonData);
        this._renderFileList(buttonData.files);
    }

    // also need to move to soundcard class
    async clearModalButtonFiles() {
        const confirmed = await this.showConfirmModal("Are you sure you want to clear all audio files for this button?");
        if (confirmed && this.activeModalIndex !== null) {
            const buttonData = this.buttonsData[this.activeModalIndex];
            const player = this._getAudioPlayer(this.activeModalIndex);
            player.cleanup();
            buttonData.files = [];
            await this.db.save(this.activeModalIndex, buttonData);
            this._renderFileList(buttonData.files);
        }
    }

    // also belongs in soundcard class
    async removeFileFromModalButton(event) {
        const fileIndex = parseInt(event.target.dataset.fileIndex);
        if (!isNaN(fileIndex)) {
            const buttonData = this.buttonsData[this.activeModalIndex];
            if (!buttonData || !buttonData.files) return;
            const player = this._getAudioPlayer(this.activeModalIndex);
            if (player) { player.cleanup(); }
            buttonData.files.splice(fileIndex, 1);
            if (buttonData.files.length > 0) { player.playback.currentFileIndex = 0; }
            await this.db.save(this.activeModalIndex, buttonData);
            this._renderFileList(buttonData.files);
        }
    }

    // ================================================================
    // Global Functionality Methods
    // ================================================================

    // Should this be moved to ThemeManager class?
    async openBoardSwitcherModal() {
        const boardIds = await BoardManager.getBoardList(); // UPDATED
        const boardListElement = document.getElementById('board-list');
        const modal = document.getElementById('board-switcher-modal');

        boardListElement.innerHTML = ''; // Clear previous list

        if (boardIds.length === 0) {
            boardListElement.innerHTML = '<li><small>No other boards found. Create one by adding "?board=board-name" to the URL.</small></li>';
        } else {
            boardIds.forEach(id => {
                const listItem = document.createElement('li');
                const link = document.createElement('a');
                link.textContent = id;
                // The 'default' board links to the base URL
                link.href = (id === 'default') ? window.location.pathname : `?board=${id}`;
                listItem.appendChild(link);
                boardListElement.appendChild(listItem);
            });
        }

        modal.style.display = 'flex';
    }

    // This should be in soundcard class?
    async _handleRemoveButton() {
        if (this.activeModalIndex === null) return;
        const confirmed = await this.showConfirmModal("Are you sure you want to permanently remove this button?");
        if (confirmed) {
            await this.removeButton(this.activeModalIndex);
        }
    }

    // This goes with the handler, probably should move into soundcard class?
    async removeButton(indexToRemove) {
        if (this.buttonsData.length <= 1) {
            return;
        }

        appEvents.dispatch('soundButtonDeleted',{deletedIndex: indexToRemove});

        if (this.soundCards.has(indexToRemove)) {
            this.soundCards.get(indexToRemove).destroy(); 
            this.soundCards.delete(indexToRemove);
        }

        // Remove from layout
        this.gridLayout = this.gridLayout.filter(item => !(item.type === 'sound' && item.id === indexToRemove));

        // Re-index subsequent button IDs in both data and layout
        this.buttonsData.forEach((button, i) => {
            if (i >= indexToRemove) button.id = i;
        });
        this.gridLayout.forEach(item => {
            if (item.type === 'sound' && item.id > indexToRemove) {
                item.id--;
            }
        });

        // Clear and re-write the database to maintain consistency
        await this.db._dbRequest(this.db.SOUNDS_STORE, 'readwrite', 'clear');
        for (const button of this.buttonsData) {
            await this.db.save(button.id, button);
        }

        await this.db.save(this.db.CONFIG_KEY, { id: this.db.CONFIG_KEY, numButtons: this.buttonsData.length });
        await this._saveLayout();

        this.closeSettingsModal();
        this.renderGrid();
    }

    // We need to revisit once we have moved away from position-based IDs to event-driven interaction and unique IDs
    // We'll have to make sure our data structure works when everything is decoupled
    // Also, in the future once this is complete, we should create a way for boards saved from previous versions of the app can still upload
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

        const soundData = await this.db._dbRequest(this.db.SOUNDS_STORE, 'readonly', 'getAll');
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
        const soundData = await this.db._dbRequest(this.db.SOUNDS_STORE, 'readonly', 'getAll');
        fileListEl.innerHTML = '';
        if (soundData.length === 0) {
            fileListEl.innerHTML = '<li><small>No sounds found.</small></li>';
            return;
        }

        soundData.forEach(item => {
            const li = document.createElement('li');
            li.textContent = `Button ${item.id + 1}: ${item.files.length} file(s)`;
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