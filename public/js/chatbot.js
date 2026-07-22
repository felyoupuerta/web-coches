
(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', initChatbot);

    function initChatbot() {
        const toggle = document.getElementById('chatbot-toggle');
        const panel = document.getElementById('chatbot-panel');
        const closeBtn = document.getElementById('chatbot-close');
        const form = document.getElementById('chatbot-form');
        const input = document.getElementById('chatbot-input');
        const messages = document.getElementById('chatbot-messages');

        if (!toggle || !panel || !form) return;

        const csrfMeta = document.querySelector('meta[name="csrf-token"]');
        const csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';

        toggle.addEventListener('click', () => {
            const isOpen = panel.hidden;
            panel.hidden = !isOpen;
            panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
            toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            if (isOpen) input.focus();
        });

        closeBtn.addEventListener('click', () => {
            panel.hidden = true;
            panel.setAttribute('aria-hidden', 'true');
            toggle.setAttribute('aria-expanded', 'false');
        });

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const pregunta = input.value.trim();
            if (!pregunta) return;

            addMessage(pregunta, 'user');
            input.value = '';
            input.disabled = true;
            const loadingEl = addMessage('Consultando el catálogo...', 'bot', true);

            try {
                const response = await fetch('/api/chatbot', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': csrfToken
                    },
                    body: JSON.stringify({ pregunta, _csrf: csrfToken })
                });

                const data = await response.json();
                loadingEl.remove();

                if (!response.ok) {
                    addMessage(data.error || 'El asistente no está disponible ahora mismo.', 'bot');
                } else {
                    addMessage(data.respuesta, 'bot');
                }
            } catch (err) {
                loadingEl.remove();
                addMessage('No se ha podido contactar con el asistente. Inténtalo de nuevo en unos segundos.', 'bot');
            } finally {
                input.disabled = false;
                input.focus();
            }
        });

        function addMessage(text, sender, isLoading) {
            const bubble = document.createElement('div');
            bubble.className = 'chatbot-msg chatbot-msg-' + sender + (isLoading ? ' chatbot-msg-loading' : '');
            bubble.textContent = text;
            messages.appendChild(bubble);
            messages.scrollTop = messages.scrollHeight;
            return bubble;
        }
    }
})();
