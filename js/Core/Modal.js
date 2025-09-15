export class Modal {
    constructor(title, config, data, commands, allCommands, onSave) {
        this.title = title;
        this.config = config;
        this.data = data;
        this.commands = commands; // Commands specific to the card
        this.allCommands = allCommands; // All commands across all cards
        this.onSave = onSave; // Main save callback for form inputs
        this.modalElement = this._createModalElement();
        this._buildForm();
        this._attachGlobalListeners();
    }

    _createModalElement() {
        const modal = document.createElement('div');
        modal.className = 'modal'; // Keep this for the backdrop
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
            if (e.target === modal) {
                this.close();
            }
        });

        modal.querySelector('.modal-close-btn').addEventListener('click', () => {
            this.close();
        });

        return modal;
    }

    _buildForm() {
        const formContent = this.modalElement.querySelector('.modal-form-content');
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
                    const controlEl = this._createControl(control, group);
                    if (controlEl) groupEl.appendChild(controlEl);
                });
                sectionEl.appendChild(groupEl);
            });
            formContent.appendChild(sectionEl);
        });
    }

    _createControl(control, group) {
        const key = control.key;
        const value = control.value !== undefined? control.value : this.data[key];
        const container = document.createElement('div'); // A container for the control and its label

        // Use a switch for clarity and extensibility
        switch (control.type) {
            case 'text':

            case 'color': {
                const input = document.createElement('input');
                input.type = control.type;
                input.dataset.key = key;

                // For color, the value needs to be a hex code, not a CSS variable
                if (control.type === 'color' && String(value).startsWith('var(')) {
                    const cssVarName = value.match(/--[\w-]+/)[0];
                    input.value = getComputedStyle(document.documentElement).getPropertyValue(cssVarName).trim();
                } else {
                    input.value = value;
                }
                
                return input;
            }

            case 'checkbox': {
                const label = document.createElement('label');
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.dataset.key = key;
                input.checked = value;
                label.appendChild(input);
                label.append(` ${control.label}`); // Add text after the checkbox
                return label;
            }
            
            case 'button': {
                const button = document.createElement('button');
                button.textContent = control.label;
                button.className = control.class || 'accent-color'; // Default class
                button.dataset.action = control.action; // For the event listener
                return button;
            }

            case 'range': {
                const group = document.createElement('div');
                group.className = 'slider-group';

                const labelEl = document.createElement('label');
                labelEl.textContent = control.label;
                group.appendChild(labelEl);

                const input = document.createElement('input');
                input.type = 'range';
                input.dataset.key = key;
                input.min = control.min || 0;
                input.max = control.max || 100;
                input.step = control.step || 1;
                input.value = value;
                group.appendChild(input);

                // Optional value display
                if (control.showValue) {
                    const valueSpan = document.createElement('span');
                    valueSpan.className = 'slider-value';
                    valueSpan.dataset.key = key; // Link to the input
                    valueSpan.textContent = value;
                    group.appendChild(valueSpan);
                }
                return group;
            }

            case 'select': {
                const container = document.createElement('div');
                container.className = 'timer-sound-select'; // Use existing styles

                const label = document.createElement('label');
                label.textContent = control.label;
                container.appendChild(label);

                const select = document.createElement('select');
                select.dataset.key = control.key;
                // Use the appropriate class from your CSS
                select.className = control.key === 'startAction' ? 'timer-start-action' : 'timer-end-action';


                // Add a "None" option by default
                select.add(new Option("None", ""));

                this.allCommands.forEach(command => {
                    // The logic to prevent a card from triggering itself is now more robust,
                    // as it compares against the card's actual ID from the data object.
                    if (command.targetCard === this.data.id) return;
                    select.add(new Option(command.name, command.id));
                });

                // The value is still sourced from the card's data.
                select.value = this.data[control.key]?.commandId || "";
                container.appendChild(select);
                return container;
            }

            case 'radio': {
                const group = document.createElement('div');
                group.className = 'modal-radio-group';
                control.options.forEach(option => {
                    const label = document.createElement('label');
                    const input = document.createElement('input');
                    input.type = 'radio';
                    input.name = key;
                    input.dataset.key = key;
                    input.value = option.value;
                    if (value === option.value) {
                        input.checked = true;
                    }
                    label.appendChild(input);
                    label.append(` ${option.label}`);
                    group.appendChild(label);
                });
                return group;
            }

            case 'list': {
                const listContainer = document.createElement('ul');
                listContainer.className = 'file-list'; // Use the same class for consistent styling
                
                const items = this.data[control.itemSource] || []; // e.g., this.data['files']
                if (items.length === 0) {
                    listContainer.innerHTML = `<li><small>${control.emptyMessage || 'No items.'}</small></li>`;
                    return listContainer;
                }

                items.forEach((item, index) => {
                    const listItem = document.createElement('li');
                    
                    const titleSpan = document.createElement('span');
                    titleSpan.textContent = item[control.itemTitleKey]; // e.g., item['fileName']
                    listItem.appendChild(titleSpan);

                    if (control.actions && control.actions.length > 0) {
                        const buttonContainer = document.createElement('div');
                        buttonContainer.className = 'theme-list-buttons'; // Use theme list class for styling

                        control.actions.forEach(action => {
                            const button = document.createElement('button');
                            button.textContent = action.label;
                            button.className = action.class || 'accent-color';
                            button.dataset.action = action.action;
                            // Use the index as a reliable way to identify the item
                            button.dataset.itemIndex = index; 
                            buttonContainer.appendChild(button);
                        });
                        listItem.appendChild(buttonContainer);
                    }
                    listContainer.appendChild(listItem);
                });

                return listContainer;
            }

            case 'custom-html': {
                const div = document.createElement('div');
                // The config can provide a function that returns the HTML string or a DOM element
                if (typeof control.content === 'function') {
                    div.innerHTML = control.content(this.data);
                } else {
                    div.innerHTML = control.content || '';
                }
                return div;
            }
            
            default: {
                return null;
            }
        }
    }

    _save() {
        const newData = { ...this.data };
        this.modalElement.querySelectorAll('[data-key]').forEach(input => {
            const key = input.dataset.key;

            if (input.tagName === 'SPAN') return;

            if (input.type === 'checkbox') {
                newData[key] = input.checked;
            } else if (input.tagName === 'SELECT') {
                newData[key] = input.value;
            } else if (input.type === 'radio') {
                if (input.checked) {
                    newData[key] = input.value;
                }
            } else {
                newData[key] = input.value;
            }
        });
        this.onSave(newData);
    }
    
    _attachGlobalListeners() {
        this.modalElement.addEventListener('click', (e) => {
            if (e.target === this.modalElement) this.close();
            
            const button = e.target.closest('button[data-action]');
            if (button) {
                const action = button.dataset.action;
                const itemIndex = button.dataset.itemIndex; // Check if it's a list item action

                // If it's a list action, find the list config and fire its callback
                if (itemIndex !== undefined) {
                    for (const section of this.config) {
                        for (const group of section.groups) {
                            const listControl = group.controls.find(c => c.type === 'list');
                            if (listControl) {
                                const actionConfig = listControl.actions.find(a => a.action === action);
                                if (actionConfig && typeof actionConfig.onClick === 'function') {
                                    // Pass the modal instance AND the specific item's index
                                    actionConfig.onClick(this, parseInt(itemIndex, 10));
                                }
                            }
                        }
                    }
                } else {
                    // Handle general modal buttons (like Save, Delete Card, etc.)
                     for (const section of this.config) {
                        for (const group of section.groups) {
                            const control = group.controls.find(c => c.action === action);
                            if (control && typeof control.onClick === 'function') {
                                control.onClick(this);
                            }
                        }
                    }
                }
            }
        });

        // Add a general input listener to trigger the main onSave function for form elements
        this.modalElement.addEventListener('input', (e) => {
            const input = e.target.closest('[data-key]');
            if (input) {
                // If it's a range slider with a value display, update it
                if (input.type === 'range') {
                    const valueSpan = this.modalElement.querySelector(`.slider-value[data-key="${input.dataset.key}"]`);
                    if (valueSpan) {
                        valueSpan.textContent = input.value;
                    }
                }
                this._save();
            }
        });
    }

    // Public method to allow external code to refresh parts of the modal
    refreshContent() {
        this.modalElement.querySelector('.modal-form-content').innerHTML = '';
        this._buildForm();
    }

    open() {
        document.body.appendChild(this.modalElement);
        this.modalElement.style.display = 'flex';
    }

    close() {
        if(this.modalElement) {
            this.modalElement.remove();
            this.modalElement = null;
        }
    }
}