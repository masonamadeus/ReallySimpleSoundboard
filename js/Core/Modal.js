export class Modal {
    constructor(title, config, data, onSave) {
        this.title = title;
        this.config = config;
        this.data = data;
        this.onSave = onSave; // Main save callback for form inputs
        this.modalElement = this._createModalElement();
        this._buildForm();
        this._attachGlobalListeners();
    }

    _createModalElement() {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>${this.title}</h3>
                <div class="modal-form-content"></div>
                <div class="modal-actions-row">
                    <button class="modal-save-btn accent-color">Save</button>
                </div>
            </div>
        `;

        modal.addEventListener('mousedown', (e) => {
            // Only close if the click starts directly on the backdrop
            if (e.target === modal) {
                this.close();
            }
        });

        // The save button can remain a 'click' event since it's an intentional action
        modal.querySelector('.modal-save-btn').addEventListener('click', () => {
            this._save();
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
                    const controlEl = this._createControl(control);
                    if (controlEl) groupEl.appendChild(controlEl);
                });
                sectionEl.appendChild(groupEl);
            });
            formContent.appendChild(sectionEl);
        });
    }

    _createControl(control) {
        const key = control.key;
        const value = this.data[key];
        const container = document.createElement('div'); // A container for the control and its label

        // Use a switch for clarity and extensibility
        switch (control.type) {
            case 'text':
            case 'color': {
                const label = document.createElement('label');
                label.textContent = control.label;
                const input = document.createElement('input');
                input.type = control.type;
                input.dataset.key = key;
                input.value = value;

                // For the specific 'title-and-color' layout
                if (group.type === 'title-and-color') {
                     container.className = 'title-and-color';
                     if (control.type === 'color') {
                         container.appendChild(input); // Color picker first
                         container.appendChild(label);
                     } else {
                        // This assumes the text input is part of this group, let's make it more robust
                        const textInput = document.createElement('input');
                        textInput.type = 'text';
                        textInput.dataset.key = 'title'; // Assuming the key is 'title'
                        textInput.value = this.data['title'];
                        container.appendChild(textInput);
                     }
                } else {
                    container.appendChild(label);
                    container.appendChild(input);
                }
                return container;
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
            
            default:
                return null;
        }
    }

    _save() {
        const newData = { ...this.data };
        this.modalElement.querySelectorAll('input[data-key]').forEach(input => {
            const key = input.dataset.key;
            if (input.type === 'checkbox') {
                newData[key] = input.checked;
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
            const input = e.target.closest('input[data-key]');
            if (input) {
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