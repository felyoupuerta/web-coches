// Luxe Imports - Interacciones de cliente.
// Vive en un archivo externo (no inline) a propósito: permite una Content-
// Security-Policy estricta en el servidor sin 'unsafe-inline' en script-src.
(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', () => {
        initIcons();
        initMobileMenu();
        initGallery();
        initConfirmForms();
    });

    function initIcons() {
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    function initMobileMenu() {
        const menuToggle = document.querySelector('.menu-toggle');
        const navMenu = document.querySelector('.nav-menu');
        if (!menuToggle || !navMenu) return;

        menuToggle.addEventListener('click', () => {
            const isActive = navMenu.classList.toggle('active');
            menuToggle.setAttribute('aria-expanded', isActive ? 'true' : 'false');
            const icon = menuToggle.querySelector('i');
            if (icon) {
                icon.setAttribute('data-lucide', isActive ? 'x' : 'menu');
            }
            if (window.lucide) window.lucide.createIcons();
        });
    }

    // Galería de la ficha de vehículo: cambia la imagen principal al pulsar
    // una miniatura, usando data-image en vez de onclick inline (CSP).
    function initGallery() {
        const mainImage = document.getElementById('main-gallery-img');
        const thumbnails = document.querySelectorAll('.thumbnail[data-image]');
        if (!mainImage || thumbnails.length === 0) return;

        const selectThumbnail = (thumb) => {
            mainImage.setAttribute('src', thumb.dataset.image);
            thumbnails.forEach((t) => t.classList.remove('active'));
            thumb.classList.add('active');
        };

        thumbnails.forEach((thumb) => {
            thumb.addEventListener('click', () => selectThumbnail(thumb));
            // Accesibilidad: las miniaturas son focuseables (role="button"),
            // así que también deben responder a Enter/Espacio por teclado.
            thumb.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectThumbnail(thumb);
                }
            });
        });
    }

    // Confirmación nativa antes de enviar formularios destructivos
    // (eliminar coche, gasto o usuario), vía data-confirm en vez de
    // onsubmit inline (CSP).
    function initConfirmForms() {
        document.querySelectorAll('form[data-confirm]').forEach((form) => {
            form.addEventListener('submit', (event) => {
                if (!window.confirm(form.dataset.confirm)) {
                    event.preventDefault();
                }
            });
        });
    }

})();
