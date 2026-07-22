// Luxe Imports - Landing "Importación a la Carta": wizard de búsqueda +
// calculadora de costes. Vive en un archivo externo (no inline) para
// respetar la CSP estricta de la aplicación (ver public/js/main.js).
(function () {
    'use strict';

    // Estimaciones orientativas de coste de importación. Ajustables aquí sin
    // tocar el resto del código; se muestran siempre junto a un disclaimer
    // de "no vinculante" en la propia vista.
    const TRANSPORTE_ESTIMADO = 950;
    const GESTION_ITV_HOMOLOGACION = 650;
    const HONORARIOS_GESTION = 1200;
    const WHATSAPP_NUMBER = '34600000000'; // Placeholder: sustituir por el nº real antes de publicar

    let wizardGoToStep = null;

    document.addEventListener('DOMContentLoaded', () => {
        initWizard();
        initCalculator();
    });

    function formatEUR(amount) {
        return Math.round(amount).toLocaleString('es-ES') + ' €';
    }

    // --- WIZARD "BÚSQUEDA A LA CARTA" ---
    function initWizard() {
        const form = document.getElementById('wizard-form');
        if (!form) return;

        const steps = Array.from(form.querySelectorAll('.wizard-step'));
        const progressSteps = Array.from(form.querySelectorAll('.wizard-progress-step'));
        const prevBtn = form.querySelector('[data-wizard-prev]');
        const nextBtn = form.querySelector('[data-wizard-next]');
        const submitBtn = form.querySelector('[data-wizard-submit]');
        if (steps.length === 0) return;

        const hasErrors = form.dataset.hasErrors === 'true';
        let currentIndex = 0;

        function goToStep(index) {
            currentIndex = Math.max(0, Math.min(index, steps.length - 1));

            steps.forEach((step, i) => step.classList.toggle('active', i === currentIndex));
            progressSteps.forEach((item, i) => {
                item.classList.toggle('active', i === currentIndex);
                item.classList.toggle('completed', i < currentIndex);
            });

            if (prevBtn) prevBtn.style.display = currentIndex === 0 ? 'none' : 'inline-flex';
            if (nextBtn) nextBtn.style.display = currentIndex === steps.length - 1 ? 'none' : 'inline-flex';
            if (submitBtn) submitBtn.style.display = currentIndex === steps.length - 1 ? 'inline-flex' : 'none';
        }

        // Si el formulario vuelve con errores de validación del servidor, se
        // muestran todos los pasos a la vez (sin navegación JS) para que el
        // usuario vea de un vistazo qué campo debe corregir.
        if (hasErrors) {
            wizardGoToStep = null;
            return;
        }

        form.classList.add('wizard-ready');

        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                const currentStep = steps[currentIndex];
                const invalidField = currentStep.querySelector(':invalid');
                if (invalidField) {
                    invalidField.reportValidity();
                    return;
                }
                goToStep(currentIndex + 1);
            });
        }

        if (prevBtn) {
            prevBtn.addEventListener('click', () => goToStep(currentIndex - 1));
        }

        goToStep(0);
        wizardGoToStep = goToStep;
    }

    // --- CALCULADORA INTERACTIVA DE IMPORTACIÓN ---
    function initCalculator() {
        const precioInput = document.getElementById('calc-precio');
        const co2Select = document.getElementById('calc-co2');
        if (!precioInput || !co2Select) return;

        const outPrecio = document.getElementById('calc-out-precio');
        const outTransporte = document.getElementById('calc-out-transporte');
        const outGestion = document.getElementById('calc-out-gestion');
        const outImpuesto = document.getElementById('calc-out-impuesto');
        const outHonorarios = document.getElementById('calc-out-honorarios');
        const outTotal = document.getElementById('calc-out-total');
        const whatsappBtn = document.getElementById('calc-whatsapp-btn');
        const saveBtn = document.getElementById('calc-save-btn');

        let lastTotal = 0;

        function recalculate() {
            const precio = Math.max(0, parseFloat(precioInput.value) || 0);
            const co2Pct = parseFloat(co2Select.value) || 0;
            const impuestoMatriculacion = precio * (co2Pct / 100);
            const total = precio + TRANSPORTE_ESTIMADO + GESTION_ITV_HOMOLOGACION + impuestoMatriculacion + HONORARIOS_GESTION;

            outPrecio.textContent = formatEUR(precio);
            outTransporte.textContent = formatEUR(TRANSPORTE_ESTIMADO);
            outGestion.textContent = formatEUR(GESTION_ITV_HOMOLOGACION);
            outImpuesto.textContent = formatEUR(impuestoMatriculacion);
            outHonorarios.textContent = formatEUR(HONORARIOS_GESTION);
            outTotal.textContent = formatEUR(total);

            lastTotal = total;

            if (whatsappBtn) {
                const mensaje = 'Hola, quiero pedir presupuesto de importación. Cálculo estimado: '
                    + 'Precio origen ' + formatEUR(precio) + ', '
                    + 'Transporte ' + formatEUR(TRANSPORTE_ESTIMADO) + ', '
                    + 'Gestión ITV/homologación ' + formatEUR(GESTION_ITV_HOMOLOGACION) + ', '
                    + 'Impuesto de Matriculación ' + formatEUR(impuestoMatriculacion) + ', '
                    + 'Honorarios ' + formatEUR(HONORARIOS_GESTION) + '. '
                    + 'Total estimado: ' + formatEUR(total) + '.';
                whatsappBtn.setAttribute('href', 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(mensaje));
            }
        }

        precioInput.addEventListener('input', recalculate);
        co2Select.addEventListener('change', recalculate);
        recalculate();

        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                const presupuestoField = document.getElementById('presupuesto');
                if (presupuestoField) {
                    presupuestoField.value = Math.round(lastTotal);
                }

                if (wizardGoToStep) {
                    wizardGoToStep(2); // Paso 3 (índice 2): Presupuesto y extras
                }

                const wizardSection = document.getElementById('wizard-busqueda');
                if (wizardSection) {
                    wizardSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        }
    }

})();
