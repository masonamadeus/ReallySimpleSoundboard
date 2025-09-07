export class Modal {
    constructor(title, config, data, onSave) {
        this.title = title;
        this.config = config;
        this.data = data;
        this.onSave = onSave;
        this.modalElement = this._createModalElement();
        this._buildForm();
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
        modal.addEventListener('click', (e) => {
            if (e.target === modal) this.close();
        });
        modal.querySelector('.modal-save-btn').addEventListener('click', () => {
            this._save();
            this.close();
        });
        return modal;
    }

    _buildForm() {
        const formContent = this.modalElement.querySelector('.modal-form-content');
        for (const key in this.config) {
            const setting = this.config[key];
            const group = document.createElement('div');
            group.className = 'modal-form-group';
            
            const label = document.createElement('label');
            label.textContent = setting.label;
            
            const input = document.createElement('input');
            input.type = setting.type;
            input.dataset.key = key;
            input.value = this.data[key];
            if (setting.type === 'checkbox') {
                input.checked = this.data[key];
            }
            
            group.appendChild(label);
            group.appendChild(input);
            formContent.appendChild(group);
        }
    }

    _save() {
        const newData = { ...this.data };
        this.modalElement.querySelectorAll('input').forEach(input => {
            const key = input.dataset.key;
            if (input.type === 'checkbox') {
                newData[key] = input.checked;
            } else {
                newData[key] = input.value;
            }
        });
        this.onSave(newData);
    }

    open() {
        document.body.appendChild(this.modalElement);
        this.modalElement.style.display = 'flex';
    }

    close() {
        this.modalElement.remove();
    }
}