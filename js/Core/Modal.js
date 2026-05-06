// ReallySimpleSoundboard/js/Core/Modal.js

export class Modal {
    /**
     * @param {string} title - The title displayed at the top of the modal.
     * @param {HTMLElement} contentElement - The DOM element containing the custom settings UI.
     */
    constructor(title, contentElement) {
        this.title = title;
        this.modalElement = this._createModalElement(contentElement);
    }

    _createModalElement(contentElement) {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex'; // Modals are visible by default when created
        
        modal.innerHTML = `
            <div class="modal-content rss-modal">
                <div class="modal-header">
                    <h3>${this.title}</h3>
                </div>
                <div class="modal-body">
                    </div>
                <div class="modal-actions-row" style="margin-top: 2rem;">
                     <button class="modal-close-btn highlight-color">Close</button>
                </div>
            </div>
        `;

        // Inject the custom HTML passed from the Card
        modal.querySelector('.modal-body').appendChild(contentElement);

        // Click outside to close
        modal.addEventListener('mousedown', (e) => {
            if (e.target === modal) this.close();
        });

        // Click close button to close
        modal.querySelector('.modal-close-btn').addEventListener('click', () => this.close());
        
        document.body.appendChild(modal);
        return modal;
    }

    close() {
        if (this.modalElement) {
            this.modalElement.remove();
            this.modalElement = null;
        }
    }
}