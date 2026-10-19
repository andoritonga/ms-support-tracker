// ==========================================
// === KNOWLEDGE BASE AUTO-SUGGEST & SEARCH ===
// ==========================================

        let kbDebounceTimers = {};

        function debounceKbSearch(mode) {
            if (kbDebounceTimers[mode]) {
                clearTimeout(kbDebounceTimers[mode]);
            }
            kbDebounceTimers[mode] = setTimeout(() => {
                triggerKbSearch(mode);
            }, 350);
        }

        async function triggerKbSearch(mode) {
            const isEdit = mode === 'edit';
            const descInput = document.getElementById(isEdit ? 'editTaskDescription' : 'taskDescription');
            const custInput = document.getElementById(isEdit ? 'editCustomer' : 'customer');
            const svcInput = document.getElementById(isEdit ? 'editServices' : 'services');
            const container = document.getElementById(isEdit ? 'kbSuggestionsEdit' : 'kbSuggestionsAdd');

            if (!descInput || !container) return;

            const query = descInput.value.trim();
            const customer = custInput ? custInput.value : '';
            const services = svcInput ? svcInput.value : '';

            if (query.length < 2) {
                container.style.display = 'none';
                container.innerHTML = '';
                return;
            }

            try {
                const params = new URLSearchParams();
                params.set('q', query);
                if (customer) params.set('customer', customer);
                if (services) params.set('services', services);

                const response = await fetch(`/api/knowledge-base/search?${params.toString()}`);
                if (!response.ok) return;

                const data = await response.json();
                const results = data.results || [];

                if (results.length === 0) {
                    container.style.display = 'none';
                    container.innerHTML = '';
                    return;
                }

                renderKbSuggestions(mode, results, query);
            } catch (err) {
                console.warn("KB search failed:", err);
            }
        }

        function closeKbSuggestions(mode) {
            const container = document.getElementById(mode === 'edit' ? 'kbSuggestionsEdit' : 'kbSuggestionsAdd');
            if (container) {
                container.style.display = 'none';
                container.innerHTML = '';
            }
        }

        function renderKbSuggestions(mode, results, query) {
            const container = document.getElementById(mode === 'edit' ? 'kbSuggestionsEdit' : 'kbSuggestionsAdd');
            if (!container) return;

            let cardsHtml = '';
            results.slice(0, 3).forEach((r) => {
                const encRc = encodeURIComponent(r.rootCause || '');
                const encSol = encodeURIComponent(r.solution || '');

                cardsHtml += `
                    <div class="kb-card">
                        <div class="kb-card-top">
                            <span class="kb-card-title">${escapeHtml(r.taskDescription || 'Past Incident')}</span>
                            <div class="kb-card-badges">
                                <span class="kb-badge">${r.customer || 'General'}</span>
                                <span class="kb-badge">${r.services || 'Cloud'}</span>
                            </div>
                        </div>
                        <div class="kb-card-body">
                            ${r.rootCause ? `<div><strong>Root Cause:</strong> ${escapeHtml(r.rootCause)}</div>` : ''}
                            ${r.solution ? `<div style="margin-top:2px;"><strong>Solution:</strong> ${escapeHtml(r.solution)}</div>` : ''}
                        </div>
                        <div style="display: flex; justify-content: flex-end;">
                            <button type="button" class="kb-apply-btn" onclick="applyKbSolution('${mode}', '${encRc}', '${encSol}')">
                                <span>⚡</span> Apply Root Cause & Solution
                            </button>
                        </div>
                    </div>
                `;
            });

            container.innerHTML = `
                <div class="kb-header">
                    <span>💡 Knowledge Base: ${results.length} past resolved issue${results.length > 1 ? 's' : ''} found</span>
                    <button type="button" class="kb-close-btn" onclick="closeKbSuggestions('${mode}')">✕</button>
                </div>
                ${cardsHtml}
            `;
            container.style.display = 'block';
        }

        function applyKbSolution(mode, encRc, encSol) {
            const isEdit = mode === 'edit';
            const rcInput = document.getElementById(isEdit ? 'editRootCause' : 'rootCause');
            const solInput = document.getElementById(isEdit ? 'editSolution' : 'solution');

            const rc = decodeURIComponent(encRc);
            const sol = decodeURIComponent(encSol);

            if (rcInput && rc) {
                rcInput.value = rc;
                rcInput.style.transition = 'background 0.3s ease';
                rcInput.style.background = 'rgba(2, 132, 199, 0.15)';
                setTimeout(() => { rcInput.style.background = ''; }, 800);
            }
            if (solInput && sol) {
                solInput.value = sol;
                solInput.style.transition = 'background 0.3s ease';
                solInput.style.background = 'rgba(2, 132, 199, 0.15)';
                setTimeout(() => { solInput.style.background = ''; }, 800);
            }

            closeKbSuggestions(mode);
        }
