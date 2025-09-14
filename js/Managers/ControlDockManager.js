import { MSG } from '../Core/MSG.js';
import { store } from '../Core/StateStore.js';
export class ControlDockManager {
    /**
     * Manages the new three-card control dock at the bottom of the screen.
     * @param {import('./SoundboardManager.js').SoundboardManager} soundboardManager
     */
    constructor() {
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
        
        // Subscribe to store updates to reflect rearrange mode changes
        store.subscribe(() => {
            const { isRearranging } = store.getState();
            this.elements.rearrangeBtn.textContent = isRearranging ? 'Done' : 'Rearrange';
        });
    }

    _getDOMLemons() {
        this.elements = {
            rearrangeBtn: document.getElementById('rearrange-mode-btn'),
            cosmeticsBtn: document.getElementById('cosmetics-btn'),
            dataBtn: document.getElementById('manage-data-btn'),
            addCardDockContent: document.querySelector('#add-card-dock .dock-card-content'),
            switchBoardBtn: document.getElementById('board-switcher-btn'),
            storageBtn: document.getElementById('storage-data-btn'),
            manageBoardsBtn: document.getElementById('manage-boards-btn'),
            newNameInput: document.getElementById('new-board-name-input'),
        }
    }

    _attachListeners() {

        this.elements.switchBoardBtn.addEventListener('click', () => MSG.say(MSG.ACTIONS.REQUEST_SWITCH_BOARD));
        this.elements.storageBtn.addEventListener('click', () => MSG.say(MSG.ACTIONS.REQUEST_OPEN_STORAGE_DATA));
        this.elements.manageBoardsBtn.addEventListener('click', () => MSG.say(MSG.ACTIONS.REQUEST_OPEN_MANAGE_BOARDS));
        this.elements.rearrangeBtn.addEventListener('click', () => MSG.say(MSG.ACTIONS.REQUEST_TOGGLE_REARRANGE_MODE));
        this.elements.cosmeticsBtn.addEventListener('click', () => MSG.say(MSG.ACTIONS.REQUEST_OPEN_THEME_MANAGER));


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
                    this.closeCard(card); // Close the card when a button is clicked
                    return; // And stop further processing
                }

                if (this.openCard === card) { // if we're clicking the open card, close it
                    this.closeCard(card); // Use the new closeCard method
                } else {
                    if (this.openCard) { // If another card is open, close it first
                        this.closeCard(this.openCard); // Use the new closeCard method
                    }
                    card.classList.remove('closing'); // Ensure it's not in a closing state
                    card.classList.add('open');
                    this.openCard = card;
                }
            });
        });
        
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

                const tempCard = new CardClass(CardClass.Default());
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
}