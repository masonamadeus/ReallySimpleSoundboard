export class NotepadCard {
    constructor(element, soundboardManager, dbInstance) {
        this.cardElement = element;
        this.soundboardManager = soundboardManager;
        this.db = dbInstance;
        this.id = parseInt(this.cardElement.dataset.cardId);

        // DOM Elements
        this.contentElement = this.cardElement.querySelector('.notepad-content');
        this.tabsContainer = this.cardElement.querySelector('.notepad-tabs');
        this.addPageButton = this.cardElement.querySelector('.add-page-btn');

        // state
        this.pages = [{ title: 'New Note', content: '' }];
        this.currentPageIndex = 0;
        this.height = null;

        this.attachListeners();
        this.loadState();
    }

    attachListeners() {
        this.contentElement.addEventListener('input', () => {
            this.pages[this.currentPageIndex].content = this.contentElement.value;
            this.saveState();
        });

        this.contentElement.addEventListener('mouseup', () => {
            // Only save if a height style was actually set by resizing
            if (this.contentElement.style.height) {
                this.height = this.contentElement.style.height;
                this.saveState();
            }
        });

        this.addPageButton.addEventListener('click', () => this.addPage());



        this.tabsContainer.addEventListener('click', (e) => {
            // First, handle the delete button action
            if (e.target.classList.contains('delete-page-btn')) {
                const tab = e.target.closest('.notepad-tab');
                if (tab) {
                    this.deletePage(parseInt(tab.dataset.pageIndex));
                }
                return; // Stop processing
            }

            // Now, handle the page switch action
            const tabToSwitchTo = e.target.closest('.notepad-tab');
            if (tabToSwitchTo) {
                const targetIndex = parseInt(tabToSwitchTo.dataset.pageIndex);

                // Only switch pages if the clicked tab is not already the active one.
                if (targetIndex !== this.currentPageIndex) {
                    this.switchPage(targetIndex);
                }
                // If it IS the active tab, we do nothing, which lets you click to edit the title.
            }
        });

        this.tabsContainer.addEventListener('input', (e) => {
            if (e.target.classList.contains('notepad-tab-title')) {
                const tab = e.target.closest('.notepad-tab');
                const pageIndex = parseInt(tab.dataset.pageIndex);
                this.pages[pageIndex].title = e.target.textContent;
                this.saveState();
            }
        });
    }

    async loadState() {
        const state = await this.db.get(`notepad-${this.id}`);
        if (state) {
            this.pages = state.pages.map(p => ({ title: 'Note', content: '', ...p }));
            this.currentPageIndex = state.currentPageIndex;
            this.height = state.height || null; // UPDATED: Load the card's height
        }
        this.render();
    }

    async saveState() {
        const state = {
            pages: this.pages,
            currentPageIndex: this.currentPageIndex,
            height: this.height // UPDATED: Save the card's height
        };
        await this.db.save(`notepad-${this.id}`, state);
    }

    addPage() {
        this.pages.push({ title: 'New Note', content: '' });
        this.currentPageIndex = this.pages.length - 1;
        this.render();
        this.saveState();
    }



    async deletePage(index) {
        // If there is more than one page, just delete the page
        if (this.pages.length > 1) {
            const confirm = await this.soundboardManager.showConfirmModal('Are you sure you want to delete this page?');
            if (!confirm) return;

            this.pages.splice(index, 1);
            if (this.currentPageIndex >= index) {
                this.currentPageIndex = Math.max(0, this.currentPageIndex - 1);
            }
            this.render();
            this.saveState();
        } else {
            // If it's the last page, delete the entire note card
            this.soundboardManager.removeNotepad(this.id);
        }
    }

    switchPage(index) {
        if (index >= 0 && index < this.pages.length) {
            this.currentPageIndex = index;
            this.render();
            this.saveState();
        }
    }

    render() {
        const currentPage = this.pages[this.currentPageIndex];
        this.contentElement.value = currentPage.content;

        if (this.height) {
            this.contentElement.style.height = this.height;
        } else {
            this.contentElement.style.height = '';
        }

        this.tabsContainer.querySelectorAll('.notepad-tab').forEach(tab => tab.remove());

        this.pages.forEach((page, index) => {
            const tab = document.createElement('div');
            tab.className = 'notepad-tab';
            tab.dataset.pageIndex = index;

            const tabTitle = document.createElement('span');
            tabTitle.className = 'notepad-tab-title';
            tabTitle.textContent = page.title;

            // UPDATED: Explicitly use strings for contentEditable for better compatibility
            tabTitle.contentEditable = (index === this.currentPageIndex) ? 'true' : 'false';

            const deleteBtn = document.createElement('span');
            deleteBtn.className = 'delete-page-btn';
            deleteBtn.textContent = 'X';


            tab.appendChild(deleteBtn);
            tab.appendChild(tabTitle);

            if (index === this.currentPageIndex) {
                tab.classList.add('active');
            }
            this.tabsContainer.insertBefore(tab, this.addPageButton);
        });
    }
}

