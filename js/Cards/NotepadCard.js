import { Card } from "./BaseCard.js";

export class NotepadCard extends Card {

    static Default() {
        return {
            type: 'notepad',
            pages: [{ title: 'New Note', content: '' }],
            currentPageIndex: 0,
            height: '200px'
        };
    }

    get title() {
        return this.data.pages[this.data.currentPageIndex].title;
    }

    constructor(cardData, soundboardManager, dbInstance) {
        super(cardData, soundboardManager, dbInstance);

        this.dropdown = this.cardElement.querySelector('.notepad-page-dropdown');
        this.selectedTitle = this.cardElement.querySelector('.selected-title');
        this.dropdownList = this.cardElement.querySelector('.dropdown-list');
        this.contentElement = this.cardElement.querySelector('.notepad-content');
        this.deletePageButton = this.cardElement.querySelector('.delete-page-btn');

        this._initialize();
    }

    get templateId() {
        return 'notepad-card-template';
    }

    _initialize() {
        this._attachListeners();
        this.updateUI();
    }

    _attachListeners() {
        // --- Event listeners for the main card content ---
        this.contentElement.addEventListener('input', () => this.saveContent());
        this.contentElement.addEventListener('mouseup', () => this.saveHeight());
        this.deletePageButton.addEventListener('click', () => this.deletePage());

        // --- Event listeners for the custom dropdown ---
        const dropdownSelected = this.dropdown.querySelector('.dropdown-selected');
        
        dropdownSelected.addEventListener('click', () => this.dropdown.classList.toggle('open'));
        dropdownSelected.addEventListener('dblclick', () => this.startRename());
        
        this.selectedTitle.addEventListener('blur', () => this.finishRename());
        this.selectedTitle.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.finishRename();
            }
        });

        // Use event delegation for the list of pages
        this.dropdownList.addEventListener('click', (e) => {
            const target = e.target;
            if (target.classList.contains('page-option')) {
                const newIndex = parseInt(target.dataset.pageIndex, 10);
                this.switchPage(newIndex);
            } else if (target.classList.contains('add-page-option')) {
                this.addPage();
            }
            this.dropdown.classList.remove('open');
        });

        // Close dropdown if user clicks outside of it
        document.addEventListener('click', (e) => {
            if (!this.dropdown.contains(e.target)) {
                this.dropdown.classList.remove('open');
            }
        });
    }
    
    // --- Data Management Methods ---
    saveContent() {
        this.data.pages[this.data.currentPageIndex].content = this.contentElement.value;
        this.updateData({ pages: this.data.pages });
    }

    saveHeight() {
        if (this.contentElement.style.height) {
            this.updateData({ height: this.contentElement.style.height });
        }
    }

    addPage() {
        const newPageIndex = this.data.pages.length;
        this.data.pages.push({ title: `Note ${newPageIndex + 1}`, content: '' });
        this.switchPage(newPageIndex);
    }

    startRename() {
        this.dropdown.classList.remove('open');
        this.selectedTitle.contentEditable = 'true';
        this.selectedTitle.focus();
        document.execCommand('selectAll', false, null); // Select all text
    }

    finishRename() {
        if (this.selectedTitle.isContentEditable) {
            this.selectedTitle.contentEditable = 'false';
            const newTitle = this.selectedTitle.textContent.trim();
            if (newTitle && newTitle !== this.title) {
                this.data.pages[this.data.currentPageIndex].title = newTitle;
                this.updateUI(); // Refresh the whole UI
                this.updateData({ pages: this.data.pages });
            } else {
                this.selectedTitle.textContent = this.title; // Revert if empty
            }
        }
    }

    async deletePage() {
        if (this.data.pages.length <= 1) {
            return this._handleDeleteCard(); // Ask to delete the whole card if it's the last page
        }

        const confirm = await this.manager.showConfirmModal(`Are you sure you want to delete "${this.title}"?`);
        if (!confirm) return;

        const indexToDelete = this.data.currentPageIndex;
        this.data.pages.splice(indexToDelete, 1);
        
        // Adjust the current index to a valid one before switching
        const newIndex = Math.min(indexToDelete, this.data.pages.length - 1);
        this.data.currentPageIndex = newIndex;

        this.updateUI(); // Update UI before saving
        this.updateData({ pages: this.data.pages, currentPageIndex: newIndex });
    }

    switchPage(index) {
        if (index >= 0 && index < this.data.pages.length) {
            this.data.currentPageIndex = index;
            this.updateUI();
            this.updateData({ currentPageIndex: this.data.currentPageIndex });
        }
    }

    updateUI() {
        const currentPage = this.data.pages[this.data.currentPageIndex];
        
        this.selectedTitle.textContent = currentPage.title;
        this.contentElement.value = currentPage.content;
        this.contentElement.style.height = this.data.height || '';

        // --- Re-render the custom dropdown list ---
        this.dropdownList.innerHTML = ''; // Clear existing
        this.data.pages.forEach((page, index) => {
            const option = document.createElement('div');
            option.className = 'page-option';
            option.textContent = page.title;
            option.dataset.pageIndex = index;
            this.dropdownList.appendChild(option);
        });

        // Add the "Add Page" action to the bottom of the list
        const addOption = document.createElement('div');
        addOption.className = 'add-page-option';
        addOption.textContent = 'Add New Page...';
        this.dropdownList.appendChild(addOption);
    }
}

