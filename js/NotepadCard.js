import { Card } from "./RSSCard.js";

export class NotepadCard extends Card {

    static Default() {
        return {
            type: 'notepad',
            pages: [{ title: 'New Note', content: '' }],
            currentPageIndex: 0,
            height: '200px' // A sensible default height
        };
                        
    }

    get title() {
        return  this.data.pages[this.data.currentPageIndex].title
    }

    constructor(cardData, soundboardManager, dbInstance) {
        super(cardData, soundboardManager, dbInstance)

        // DOM Elements
        //@ts-ignore
        this.contentElement = this.cardElement.querySelector('.notepad-content');
        //@ts-ignore
        this.tabsContainer = this.cardElement.querySelector('.notepad-tabs');
        //@ts-ignore
        this.addPageButton = this.cardElement.querySelector('.add-page-btn');

        this._initialize();
    }

    get templateId() {
        return 'notepad-card-template';
    }

    _initialize(){
        this._attachListeners();
        this.updateUI();
    }

    _attachListeners() {

        this.contentElement.addEventListener('input', () => {
            this.data.pages[this.data.currentPageIndex].content = this.contentElement.value;
            this.updateData({pages: this.data.pages})
        });

        this.contentElement.addEventListener('mouseup', () => {
            // Only save if a height style was actually set by resizing
            if (this.contentElement.style.height) {
                this.data.height = this.contentElement.style.height;
                this.updateData({height: this.data.height});
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
                if (targetIndex !== this.data.currentPageIndex) {
                    this.switchPage(targetIndex);
                }
                // If it IS the active tab, we do nothing, which lets you click to edit the title.
            }
        });

        // renaming a tab title
        this.tabsContainer.addEventListener('input', (e) => {
            if (e.target.classList.contains('notepad-tab-title')) {
                const tab = e.target.closest('.notepad-tab');
                const pageIndex = parseInt(tab.dataset.pageIndex);
                this.data.pages[pageIndex].title = e.target.textContent;
                this.updateData({pages: this.data.pages})
            }
        });
    }

    addPage() {
        this.data.pages.push({ title: 'New Note', content: '' });
        this.data.currentPageIndex = this.data.pages.length - 1;
        this.updateUI();
        this.updateData({pages: this.data.pages, currentPageIndex: this.data.currentPageIndex});
    }



    async deletePage(index) {
        // If there is more than one page, just delete the page
        if (this.data.pages.length > 1) {
            const confirm = await this.manager.showConfirmModal('Are you sure you want to delete this page?');
            if (!confirm) return;

            this.data.pages.splice(index, 1);
            if (this.data.currentPageIndex >= index) {
                this.data.currentPageIndex = Math.max(0, this.data.currentPageIndex - 1);
            }
            this.updateData({pages: this.data.pages, currentPageIndex: this.data.currentPageIndex});
            this.updateUI();
        } else {
            // If it's the last page, delete the entire note card
            this.manager.removeCard(this.id)
        }
    }

    switchPage(index) {
        if (index >= 0 && index < this.data.pages.length) {
            this.data.currentPageIndex = index;
            this.updateData({currentPageIndex: this.data.currentPageIndex});
            this.updateUI();
        }
    }

    updateUI() {
        const currentPage = this.data.pages[this.data.currentPageIndex];
        this.contentElement.value = currentPage.content;

        if (this.data.height) {
            this.contentElement.style.height = this.data.height;
        } else {
            this.contentElement.style.height = '';
        }

        this.tabsContainer.querySelectorAll('.notepad-tab').forEach(tab => tab.remove());

        this.data.pages.forEach((page, index) => {
            const tab = document.createElement('div');
            tab.className = 'notepad-tab';
            tab.dataset.pageIndex = index;

            const tabTitle = document.createElement('span');
            tabTitle.className = 'notepad-tab-title';
            tabTitle.textContent = page.title;

            // UPDATED: Explicitly use strings for contentEditable for better compatibility
            tabTitle.contentEditable = (index === this.data.currentPageIndex) ? 'true' : 'false';

            const deleteBtn = document.createElement('span');
            deleteBtn.className = 'delete-page-btn';
            deleteBtn.textContent = 'X';


            tab.appendChild(deleteBtn);
            tab.appendChild(tabTitle);

            if (index === this.data.currentPageIndex) {
                tab.classList.add('active');
            }
            this.tabsContainer.insertBefore(tab, this.addPageButton);
        });
    }
}

