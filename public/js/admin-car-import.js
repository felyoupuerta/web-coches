// Luxe Imports - Importación de fichas de vehículo desde una URL externa.
// Vive en un archivo externo (no inline) por la CSP estricta del servidor.
(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', initCarImport);

    // Estado local de las imágenes ya descargadas por el servidor para este alta.
    let importedImages = [];

    function initCarImport() {
        const btn = document.getElementById('import-url-btn');
        const urlInput = document.getElementById('import-url-input');
        const statusEl = document.getElementById('import-url-status');
        const form = document.getElementById('car-form');

        if (!btn || !urlInput || !form) return;

        const csrfMeta = document.querySelector('meta[name="csrf-token"]');
        const csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';

        btn.addEventListener('click', async () => {
            const url = urlInput.value.trim();
            if (!url) {
                setStatus(statusEl, 'Pega primero la URL del anuncio.', 'error');
                return;
            }

            btn.disabled = true;
            setStatus(statusEl, 'Importando datos del vehículo, puede tardar unos segundos...', 'info');

            try {
                const response = await fetch('/admin/cars/importar-url', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': csrfToken
                    },
                    body: JSON.stringify({ url, _csrf: csrfToken })
                });

                const payload = await response.json();

                if (!response.ok || !payload.ok) {
                    setStatus(statusEl, payload.error || 'No se pudo importar la ficha. Rellena el formulario manualmente.', 'error');
                    return;
                }

                applyImportedData(payload.data, form);
                setStatus(statusEl, `Datos importados correctamente (${payload.data.imagenes.length} foto(s)). Revisa y completa lo que falte antes de registrar.`, 'success');
            } catch (err) {
                setStatus(statusEl, 'No se ha podido contactar con el servidor. Inténtalo de nuevo.', 'error');
            } finally {
                btn.disabled = false;
            }
        });
    }

    function applyImportedData(data, form) {
        setFieldValue(form, 'marca', data.marca);
        setFieldValue(form, 'modelo', data.modelo);
        setFieldValue(form, 'ano', data.ano);
        setFieldValue(form, 'kilometros', data.kilometros);
        setFieldValue(form, 'precio', data.precio);
        setFieldValue(form, 'motor', data.motor);
        setFieldValue(form, 'potencia', data.potencia);
        setSelectValue(form, 'combustible', data.combustible);
        setSelectValue(form, 'transmision', data.transmision);
        setFieldValue(form, 'descripcion', data.descripcion);

        importedImages = Array.isArray(data.imagenes) ? data.imagenes : [];
        renderImportedImages();
    }

    function setFieldValue(form, name, value) {
        if (value === null || value === undefined || value === '') return;
        const field = form.elements[name];
        if (field) field.value = value;
    }

    function setSelectValue(form, name, value) {
        const select = form.elements[name];
        if (!select || !value) return;
        const hasOption = Array.from(select.options).some(opt => opt.value === value);
        if (hasOption) select.value = value;
    }

    function renderImportedImages() {
        const wrapper = document.getElementById('imported-images-preview');
        const grid = document.getElementById('imported-images-grid');
        const hiddenInput = document.getElementById('imagenes-importadas-input');
        if (!wrapper || !grid || !hiddenInput) return;

        grid.innerHTML = '';
        importedImages.forEach((src, index) => {
            const cell = document.createElement('div');
            cell.className = 'thumbnail';
            cell.style.position = 'relative';

            const img = document.createElement('img');
            img.src = src;
            img.alt = `Foto importada ${index + 1}`;
            cell.appendChild(img);

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'btn btn-danger btn-xs';
            removeBtn.textContent = '✕';
            removeBtn.style.position = 'absolute';
            removeBtn.style.top = '2px';
            removeBtn.style.right = '2px';
            removeBtn.setAttribute('aria-label', 'Quitar esta foto importada');
            removeBtn.addEventListener('click', () => {
                importedImages.splice(index, 1);
                renderImportedImages();
            });
            cell.appendChild(removeBtn);

            grid.appendChild(cell);
        });

        wrapper.hidden = importedImages.length === 0;
        hiddenInput.value = JSON.stringify(importedImages);
    }

    function setStatus(el, message, kind) {
        el.textContent = message;
        el.classList.remove('import-status-error', 'import-status-success');
        if (kind === 'error') el.classList.add('import-status-error');
        if (kind === 'success') el.classList.add('import-status-success');
    }
})();
