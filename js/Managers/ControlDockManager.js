export class ControlDockManager {
    /**
     * Manages the new three-card control dock at the bottom of the screen.
     * @param {import('./SoundboardManager.js').SoundboardManager} soundboardManager
     */
    constructor(soundboardManager) {
        this.manager = soundboardManager; // Reference to the main manager
        this.openCard = null; // Tracks which card is currently open
        this.dockContainer = null; // the control dock container
        this.cards = null; // The control cards
        this.cardRegistry = null;
    }

    /**
     * Initializes the dock by attaching all necessary event listeners.
     */
    init(dockElement, controlCards, cardRegistry) {
        this.dockContainer = dockElement;
        this.cards = controlCards;
        this.cardRegistry = cardRegistry
        this._getDOMLemons();
        this._attachListeners();
        this._populateAddCardDock();
    }

    _getDOMLemons() {
        this.elements = {
            rearrangeBtn: document.getElementById('rearrange-mode-btn'),
            downloadConfigBtn: document.getElementById('download-config-btn'),
            uploadConfigBtn: document.getElementById('upload-config-btn'),
            cosmeticsBtn: document.getElementById('cosmetics-btn'),
            storageBtn: document.getElementById('db-manager-btn'),
            switchBoardBtn: document.getElementById('switch-board-btn'),
            addCardDockContent: document.querySelector('#add-card-dock .dock-card-content'),
        }
    }

    _attachListeners() {
        const addCardDock = document.getElementById('add-card-dock');

        // Auto-close the dock when dragging a sticker from it
        addCardDock.addEventListener('dragstart', () => {
            if (this.openCard === addCardDock) {
                this.closeCard(addCardDock);
            }
        });

        this.cards.forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('button')) {
                    return;
                }

                if (this.openCard === card) {
                    this.closeCard(card); // Use the new closeCard method
                } else {
                    if (this.openCard) {
                        this.closeCard(this.openCard); // Use the new closeCard method
                    }
                    card.classList.remove('closing'); // Ensure it's not in a closing state
                    card.classList.add('open');
                    this.openCard = card;
                }
            });
        });


        // --- Relocated Button Listeners ---
        this.elements.rearrangeBtn.addEventListener('click', () => this.manager.toggleRearrangeMode());
        this.elements.downloadConfigBtn.addEventListener('click', () => this.manager.downloadConfig());
        this.elements.uploadConfigBtn.addEventListener('click', () => document.getElementById('upload-config-input').click());
        this.elements.cosmeticsBtn.addEventListener('click', () => this.manager.themeManager.open());
        this.elements.storageBtn.addEventListener('click', () => this.manager.showDbManagerModal());
        this.elements.switchBoardBtn.addEventListener('click', () => this.manager.boardManager.open());

        
        const addCardContent = this.elements.addCardDockContent;
        addCardContent.addEventListener('wheel', (event) => {
            const { scrollTop, scrollHeight, clientHeight } = addCardContent;
            const delta = event.deltaY; // How much and in which direction the user is scrolling

            // Check if we are at the bottom and scrolling down
            if ((scrollTop + clientHeight >= scrollHeight) && delta > 0) {
                event.preventDefault(); // Stop the page from scrolling down
            }

            // Check if we are at the top and scrolling up
            if (scrollTop === 0 && delta < 0) {
                event.preventDefault(); // Stop the page from scrolling up
            }
        }, {passive: false});
    }

    async _populateAddCardDock() {
        this.elements.addCardDockContent.innerHTML = '';
        const cardTypes = this.cardRegistry.getRegisteredTypes();

        for (const type of cardTypes) {
            const CardClass = this.cardRegistry.get(type);
            if (CardClass) {
                // Create a container for the sticker and its label ---
                const container = document.createElement('div');
                container.className = 'sticker-container';

                const tempCard = new CardClass(CardClass.Default(), this.manager.managerAPI, null);
                const stickerElement = tempCard.cardElement;

                // --- (All stickerElement modifications remain the same) ---
                stickerElement.classList.add('card-sticker');
                stickerElement.removeAttribute('data-card-id');
                stickerElement.dataset.cardType = type;
                stickerElement.setAttribute('draggable', true);

                // Add an explicit height to fix the Notepad preview
                if (type === 'notepad') {
                    stickerElement.style.height = '150px';
                }

                const shield = stickerElement.querySelector('.interaction-shield') || document.createElement('div');
                shield.className = 'interaction-shield';
                shield.style.display = 'block';
                stickerElement.appendChild(shield);

                // --- Create and add the label ---
                const label = document.createElement('span');
                label.className = 'sticker-label';
                label.textContent = CardClass.name.replace('Card', ''); // e.g., "SoundCard" -> "Sound"

                // --- Append sticker and label to the container ---
                container.appendChild(stickerElement);
                //container.appendChild(label);

                // --- Append the whole container to the dock ---
                this.elements.addCardDockContent.appendChild(container);
            }
        }
    }

    closeCard(cardElement) {
        cardElement.classList.add('closing');

        // Listen for the transition to end
        cardElement.addEventListener('transitionend', () => {
            cardElement.classList.remove('open', 'closing');
        }, { once: true }); // Important: { once: true } removes the listener after it runs

        if (this.openCard === cardElement) {
            this.openCard = null;
        }
    }

    /**
     * Updates the text of the rearrange button based on the mode.
     * @param {boolean} isRearranging - The current state of rearrange mode.
     */
    updateRearrangeButton(isRearranging) {
        if (this.elements.rearrangeBtn) {
            this.elements.rearrangeBtn.textContent = isRearranging ? 'Done' : 'Rearrange';
        }
    }
}