// ==========================================
// === GEMINI AI EXECUTIVE SUMMARY & POLISH ===
// ==========================================

        let currentAISummaryMarkdown = "";

        function getStoredGeminiApiKey() {
            return localStorage.getItem('ms_gemini_api_key') || '';
        }

        function saveGeminiApiKey(key) {
            if (key !== null) {
                localStorage.setItem('ms_gemini_api_key', key.trim());
            }
        }

        function toggleApiKeyVisibility() {
            const input = document.getElementById('geminiApiKeyInput');
            if (!input) return;
            input.type = input.type === 'password' ? 'text' : 'password';
        }

        function openAISummaryModal() {
            const modal = document.getElementById('aiSummaryModal');
            if (!modal) return;

            // Pre-fill API key input if stored
            const apiKeyInput = document.getElementById('geminiApiKeyInput');
            if (apiKeyInput) {
                apiKeyInput.value = getStoredGeminiApiKey();
            }

            // Update badge info with current dashboard period
            const logs = getDashboardFilteredLogs();
            const sDate = document.getElementById('dashStartDate').value;
            const eDate = document.getElementById('dashEndDate').value;
            let periodText = 'All Time';
            if (sDate && eDate) {
                periodText = `${formatDateFormatted(sDate)} to ${formatDateFormatted(eDate)}`;
            } else if (sDate) {
                periodText = `From ${formatDateFormatted(sDate)}`;
            } else if (eDate) {
                periodText = `Until ${formatDateFormatted(eDate)}`;
            }

            const periodBadge = document.getElementById('aiPeriodBadge');
            if (periodBadge) periodBadge.innerText = `📅 Period: ${periodText}`;

            const countBadge = document.getElementById('aiCountBadge');
            if (countBadge) countBadge.innerText = `📊 ${logs.length} Activities`;

            modal.classList.add('active');
        }

        function closeAISummaryModal() {
            const modal = document.getElementById('aiSummaryModal');
            if (modal) modal.classList.remove('active');
        }

        async function generateAISummary() {
            const sDate = document.getElementById('dashStartDate').value || '';
            const eDate = document.getElementById('dashEndDate').value || '';
            const apiKey = getStoredGeminiApiKey();

            const loadingEl = document.getElementById('aiSummaryLoading');
            const bodyEl = document.getElementById('aiSummaryBody');
            const btnRun = document.getElementById('btnRunAISummary');
            const btnCopy = document.getElementById('btnCopyAI');
            const btnPrint = document.getElementById('btnPrintAI');

            if (loadingEl) loadingEl.style.display = 'block';
            if (bodyEl) bodyEl.style.display = 'none';
            if (btnRun) btnRun.disabled = true;

            try {
                const response = await fetch('/api/ai/executive-summary', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        startDate: sDate || null,
                        endDate: eDate || null,
                        apiKey: apiKey || null
                    })
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.detail || `Server returned ${response.status}`);
                }

                const data = await response.json();
                currentAISummaryMarkdown = data.summary || "No summary generated.";

                // Render markdown with marked.js or fallback
                if (window.marked && typeof window.marked.parse === 'function') {
                    bodyEl.innerHTML = window.marked.parse(currentAISummaryMarkdown);
                } else {
                    bodyEl.innerHTML = `<pre style="white-space: pre-wrap; font-family: inherit;">${currentAISummaryMarkdown}</pre>`;
                }

                if (btnCopy) btnCopy.style.display = 'inline-flex';
                if (btnPrint) btnPrint.style.display = 'inline-flex';
            } catch (err) {
                console.error("AI Summary Error:", err);
                bodyEl.innerHTML = `
                    <div style="padding: 24px; text-align: center; color: #ef4444;">
                        <span style="font-size: 2.2rem; display: block; margin-bottom: 8px;">⚠️</span>
                        <h4>Gemini AI Generation Failed</h4>
                        <p style="font-size: 13px; margin: 8px 0 16px; color: var(--muted);">${err.message}</p>
                        <p style="font-size: 12px; color: var(--muted);">Tip: Enter your Gemini API Key in the field above or set <code>GEMINI_API_KEY</code> in the server <code>.env</code> file.</p>
                    </div>
                `;
            } finally {
                if (loadingEl) loadingEl.style.display = 'none';
                if (bodyEl) bodyEl.style.display = 'block';
                if (btnRun) btnRun.disabled = false;
            }
        }

        async function polishFormWithAI(mode) {
            const isEdit = mode === 'edit';
            const btnId = isEdit ? 'btnPolishEdit' : 'btnPolishAdd';
            const descId = isEdit ? 'editTaskDescription' : 'taskDescription';
            const rootId = isEdit ? 'editRootCause' : 'rootCause';
            const solId = isEdit ? 'editSolution' : 'solution';

            const btn = document.getElementById(btnId);
            const descEl = document.getElementById(descId);
            const rootEl = document.getElementById(rootId);
            const solEl = document.getElementById(solId);

            const desc = descEl ? descEl.value.trim() : '';
            const root = rootEl ? rootEl.value.trim() : '';
            const sol = solEl ? solEl.value.trim() : '';

            if (!desc && !root && !sol) {
                alert("Please enter at least Task Description, Root Cause, or Solution before asking Gemini to polish.");
                return;
            }

            const origText = btn ? btn.innerHTML : '';
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = `<span>⏳</span> Polishing...`;
            }

            const apiKey = getStoredGeminiApiKey();

            try {
                const response = await fetch('/api/ai/polish', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        taskDescription: desc,
                        rootCause: root,
                        solution: sol,
                        apiKey: apiKey || null
                    })
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.detail || `Server returned ${response.status}`);
                }

                const data = await response.json();
                if (descEl && data.taskDescription) descEl.value = data.taskDescription;
                if (rootEl && data.rootCause) rootEl.value = data.rootCause;
                if (solEl && data.solution) solEl.value = data.solution;

                if (btn) {
                    btn.innerHTML = `<span>✅</span> Polished!`;
                    setTimeout(() => {
                        btn.innerHTML = origText;
                        btn.disabled = false;
                    }, 2000);
                }
            } catch (err) {
                console.error("AI Polish Error:", err);
                alert("Failed to polish notes with Gemini AI: " + err.message);
                if (btn) {
                    btn.innerHTML = origText;
                    btn.disabled = false;
                }
            }
        }

        function copyAISummary() {
            if (!currentAISummaryMarkdown) return;
            navigator.clipboard.writeText(currentAISummaryMarkdown).then(() => {
                const btn = document.getElementById('btnCopyAI');
                if (btn) {
                    const old = btn.innerHTML;
                    btn.innerHTML = `<span>✅</span> Copied!`;
                    setTimeout(() => btn.innerHTML = old, 1500);
                }
            }).catch(err => {
                alert("Failed to copy markdown: " + err);
            });
        }

        function printAISummary() {
            const bodyEl = document.getElementById('aiSummaryBody');
            if (!bodyEl) return;
            const contentHtml = bodyEl.innerHTML;
            const periodText = document.getElementById('aiPeriodBadge') ? document.getElementById('aiPeriodBadge').innerText : '';

            const printWindow = window.open('', '_blank');
            printWindow.document.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Gemini AI Executive Support Summary</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #1e293b; line-height: 1.6; }
                        h1, h2, h3 { color: #2434a4; }
                        h2 { border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; margin-top: 24px; }
                        table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
                        th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
                        th { background: #f1f5f9; }
                        blockquote { border-left: 4px solid #7c3aed; background: #faf5ff; padding: 10px 16px; margin: 16px 0; }
                        @media print {
                            body { padding: 0; }
                        }
                    </style>
                </head>
                <body>
                    <div style="border-bottom: 2px solid #2434a4; padding-bottom: 12px; margin-bottom: 20px;">
                        <h1 style="margin: 0; font-size: 22px;">Executive Operations & Support Briefing</h1>
                        <p style="margin: 4px 0 0; color: #64748b; font-size: 13px;">${periodText} | Synthesized by Google Gemini AI</p>
                    </div>
                    ${contentHtml}
                    <script>
                        window.onload = function() { window.print(); }
                    <\/script>
                </body>
                </html>
            `);
            printWindow.document.close();
        }
