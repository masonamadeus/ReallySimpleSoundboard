import { debounce } from '../Core/helper-functions.js';
// we shoudl do debouncing here


export class Modal {
    constructor(title, config, data) {
        this.title = title;
        this.config = config;
        this.data = data;
        this.modalElement = this._createModalElement();
        this._buildForm();
        this._attachGlobalListeners();
    }

    _createModalElement() {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex'; // Modals are visible by default now
        modal.innerHTML = `
            <div class="modal-content rss-modal">
                <div class="modal-header">
                    <h3>${this.title}</h3>
                </div>
                <div class="modal-form-content"></div>
                <div class="modal-actions-row">
                     <button class="modal-close-btn highlight-color">Close</button>
                </div>
            </div>
        `;

        modal.addEventListener('mousedown', (e) => {
            if (e.target === modal) this.close();
        });

        modal.querySelector('.modal-close-btn').addEventListener('click', () => this.close());
        document.body.appendChild(modal);
        return modal;
    }

    _buildForm() {
        const formContent = this.modalElement.querySelector('.modal-form-content');
        formContent.innerHTML = ''; // Clear existing content

        this.config.forEach(section => {
            const sectionEl = document.createElement('div');
            sectionEl.className = 'modal-section';
            if (section.title) {
                const titleEl = document.createElement('h4');
                titleEl.textContent = section.title;
                sectionEl.appendChild(titleEl);
            }

            section.groups.forEach(group => {
                const groupEl = document.createElement('div');
                groupEl.className = `modal-form-group modal-group-${group.type || 'default'}`;
                group.controls.forEach(control => {
                    const controlEl = this._createControl(control);
                    if (controlEl) groupEl.appendChild(controlEl);
                });
                sectionEl.appendChild(groupEl);
            });
            formContent.appendChild(sectionEl);
        });
    }

    _createControl(control) {
        // The value from the card's data for this specific control
        const value = this.data[control.key];
        const container = document.createElement('div'); // A container for the control and its label

        switch (control.type) {
            case 'text':
            case 'color': {
                const input = document.createElement('input');
                input.type = control.type;
                input.dataset.key = control.key;
                input.value = value;
                // Handle CSS variables for color pickers
                if (control.type === 'color' && String(value).startsWith('var(')) {
                    const cssVarName = value.match(/--[\w-]+/)[0];
                    input.value = getComputedStyle(document.documentElement).getPropertyValue(cssVarName).trim();
                }
                return input;
            }

            case 'checkbox': {
                const label = document.createElement('label');
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.dataset.key = control.key;
                input.checked = value;
                label.appendChild(input);
                label.append(` ${control.label}`); // Use append to add text after the element
                return label;
            }

            case 'button': {
                const button = document.createElement('button');
                button.textContent = control.label;
                button.className = control.class || 'accent-color';
                button.dataset.action = control.action; // Use data-action for events
                return button;
            }

            case 'range': {
                container.className = 'slider-group';
                const label = document.createElement('label');
                label.textContent = control.label;
                const input = document.createElement('input');
                input.type = 'range';
                input.dataset.key = control.key;
                input.min = control.min || 0;
                input.max = control.max || 100;
                input.step = control.step || 1;
                input.value = value;
                const valueSpan = document.createElement('span');
                valueSpan.className = 'slider-value';
                valueSpan.dataset.key = control.key;
                valueSpan.textContent = value;
                container.appendChild(label);
                container.appendChild(input);
                container.appendChild(valueSpan);
                return container;
            }

            case 'select': {
                container.className = 'select-group';
                const label = document.createElement('label');
                label.textContent = control.label;
                const select = document.createElement('select');
                select.dataset.key = control.key;

                (control.options || []).forEach(opt => {
                    const option = new Option(opt.label, opt.value);
                    select.add(option);
                });

                select.value = value || '';
                container.appendChild(label);
                container.appendChild(select);
                return container;
            }

            case 'command-select': {
                container.className = 'select-group';
                 const label = document.createElement('label');
                label.textContent = control.label;
                const select = document.createElement('select');
                select.dataset.key = control.key;
                // Add a default "None" option
                const defaultOption = new Option('None', '');
                select.add(defaultOption);
                // Populate from all available commands
                this.data.allCommands.forEach(cmd => {
                    const option = new Option(cmd.name, cmd.id);
                    select.add(option);
                });
                select.value = value?.commandId || '';
                container.appendChild(label);
                container.appendChild(select);
                return container;
            }

            case 'radio': {
                // Radio buttons are grouped by their 'key'. The container is created by the group.
                (control.options || []).forEach(opt => {
                    const label = document.createElement('label');
                    const input = document.createElement('input');
                    input.type = 'radio';
                    input.dataset.key = control.key;
                    input.name = control.key; // This groups the radio buttons
                    input.value = opt.value;
                    if (opt.value === value) {
                        input.checked = true;
                    }
                    label.appendChild(input);
                    label.append(` ${opt.label}`);
                    container.appendChild(label);
                });
                return container;
            }

            case 'list': {
                const listContainer = document.createElement('ul');
                listContainer.className = 'file-list';
                const items = this.data[control.itemSource] || [];
                if (items.length === 0) {
                    listContainer.innerHTML = `<li><small>${control.emptyMessage || 'No items.'}</small></li>`;
                } else {
                    items.forEach((item, index) => {
                        const li = document.createElement('li');
                        li.textContent = item[control.itemTitleKey] || `Item ${index + 1}`;
                        control.actions.forEach(action => {
                            const button = document.createElement('button');
                            button.textContent = action.label;
                            button.className = action.class || '';
                            button.dataset.action = action.action;
                            button.dataset.itemIndex = index; // Critical for identifying which item was clicked
                            li.appendChild(button);
                        });
                        listContainer.appendChild(li);
                    });
                }
                return listContainer;
            }
        }
        return null;
    }

    /**
     * Re-renders the modal's form content. Useful for dynamic lists.
     */
    rebuild() {
        this._buildForm();
    }

    close() {
        if (this.modalElement) {
            this.modalElement.remove();
            this.modalElement = null;
        }
    }

    _attachGlobalListeners() {
        this.modalElement.addEventListener('click', (e) => {
            if (e.target === this.modalElement) this.close();
            
            const button = e.target.closest('button[data-action]');
            if (button) {
                const action = button.dataset.action;
                const itemIndex = button.dataset.itemIndex;

                // Dispatch a custom event for any action button click
                this.modalElement.dispatchEvent(new CustomEvent('modal-action', {
                    bubbles: true,
                    composed: true,
                    detail: {
                        action: action,
                        itemIndex: itemIndex ? parseInt(itemIndex, 10) : undefined
                    }
                }));
            }
        });

        // Add a general input listener to dispatch an event on any form change
        this.modalElement.addEventListener('input', (e) => {
            const input = e.target.closest('[data-key]');
            if (input) {
                const key = input.dataset.key;
                let value;

                if (input.type === 'checkbox') {
                    value = input.checked;
                } else {
                    value = input.value;
                }
                
                // Dispatch a custom event with the key and new value
                this.modalElement.dispatchEvent(new CustomEvent('modal-input', {
                    bubbles: true,
                    composed: true,
                    detail: { key, value }
                }));

                // If it's a range slider with a value display, update it
                if (input.type === 'range') {
                    const valueSpan = this.modalElement.querySelector(`.slider-value[data-key="${key}"]`);
                    if (valueSpan) {
                        valueSpan.textContent = value;
                    }
                }
            }
        });
    }
}
