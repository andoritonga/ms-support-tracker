// ==========================================
// === ACTIVITIES MANAGEMENT & TABLE LOGIC ===
// ==========================================

        // === MODAL ADD ACTIVITY TIME MODES (MANUAL VS TIMER) ===
        let activeTimeMode = 'manual'; // 'manual' or 'timer'
        let modalTimerInterval = null;

        function switchTimeMode(mode) {
            activeTimeMode = mode;
            const manualBtn = document.getElementById('modeManualBtn');
            const timerBtn = document.getElementById('modeTimerBtn');
            const manualInBox = document.getElementById('manualClockInBox');
            const manualOutBox = document.getElementById('manualClockOutBox');
            const timerPanel = document.getElementById('timerPanelBox');

            if (mode === 'manual') {
                if (manualBtn) manualBtn.classList.add('active');
                if (timerBtn) timerBtn.classList.remove('active');
                if (manualInBox) manualInBox.style.display = 'block';
                if (manualOutBox) manualOutBox.style.display = 'block';
                if (timerPanel) timerPanel.style.display = 'none';
            } else {
                if (timerBtn) timerBtn.classList.add('active');
                if (manualBtn) manualBtn.classList.remove('active');
                if (manualInBox) manualInBox.style.display = 'none';
                if (manualOutBox) manualOutBox.style.display = 'none';
                if (timerPanel) timerPanel.style.display = 'block';
                checkRunningModalTimer();
            }
        }

        const pad2 = n => String(n).padStart(2, '0');
        const toDateTimeLocalStr = (d) => {
            const year = d.getFullYear();
            const month = pad2(d.getMonth() + 1);
            const day = pad2(d.getDate());
            const hours = pad2(d.getHours());
            const minutes = pad2(d.getMinutes());
            return `${year}-${month}-${day}T${hours}:${minutes}`;
        };

        function startModalTimer() {
            const now = Date.now();
            localStorage.setItem('ms_modal_timer_start', now.toString());

            const d = new Date(now);
            document.getElementById('clockIn').value = toDateTimeLocalStr(d);
            document.getElementById('startDate').value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

            renderModalTimerRunning(now);
        }

        function renderModalTimerRunning(startTime) {
            const box = document.getElementById('modalTimerBox');
            const statusText = document.getElementById('modalTimerStatusText');
            const timestamps = document.getElementById('modalTimerTimestamps');
            const btnStart = document.getElementById('btnModalTimerStart');
            const btnStop = document.getElementById('btnModalTimerStop');
            const btnReset = document.getElementById('btnModalTimerReset');

            if (box) box.classList.add('running');
            const startDate = new Date(startTime);
            const timeStr = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            if (statusText) statusText.innerText = 'Tracking In Progress';
            if (timestamps) timestamps.innerText = `Clocked In at ${timeStr}`;

            if (btnStart) btnStart.style.display = 'none';
            if (btnStop) btnStop.style.display = 'inline-flex';
            if (btnReset) btnReset.style.display = 'inline-flex';

            if (modalTimerInterval) clearInterval(modalTimerInterval);
            const tick = () => {
                const elapsedSecs = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
                const hrs = Math.floor(elapsedSecs / 3600);
                const mins = Math.floor((elapsedSecs % 3600) / 60);
                const secs = elapsedSecs % 60;
                const formatted = `${pad2(hrs)}:${pad2(mins)}:${pad2(secs)}`;
                const disp = document.getElementById('modalTimerDisplay');
                if (disp) disp.innerText = formatted;

                const addText = document.getElementById('btnAddActivityText');
                if (addText) addText.innerText = `Add Activity (⏱️ ${formatted})`;
            };
            tick();
            modalTimerInterval = setInterval(tick, 1000);
        }

        function stopModalTimer() {
            const savedStartStr = localStorage.getItem('ms_modal_timer_start');
            const startTime = savedStartStr ? parseInt(savedStartStr, 10) : Date.now();
            const stopTime = Date.now();

            if (modalTimerInterval) clearInterval(modalTimerInterval);
            localStorage.removeItem('ms_modal_timer_start');

            const startObj = new Date(startTime);
            const stopObj = new Date(stopTime);

            document.getElementById('startDate').value = `${startObj.getFullYear()}-${pad2(startObj.getMonth() + 1)}-${pad2(startObj.getDate())}`;
            document.getElementById('clockIn').value = toDateTimeLocalStr(startObj);
            document.getElementById('clockOut').value = toDateTimeLocalStr(stopObj);

            const diffMins = Math.max(1, Math.round((stopTime - startTime) / 60000));
            const hrs = Math.floor(diffMins / 60);
            const remMins = diffMins % 60;
            const durStr = hrs > 0 ? `${hrs}h ${remMins}m` : `${remMins}m`;

            const box = document.getElementById('modalTimerBox');
            const statusText = document.getElementById('modalTimerStatusText');
            const timestamps = document.getElementById('modalTimerTimestamps');
            const btnStart = document.getElementById('btnModalTimerStart');
            const btnStop = document.getElementById('btnModalTimerStop');
            const btnReset = document.getElementById('btnModalTimerReset');

            if (box) box.classList.remove('running');
            if (statusText) statusText.innerText = 'Time Recorded';
            if (timestamps) timestamps.innerText = `${startObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} → ${stopObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${durStr})`;

            if (btnStart) {
                btnStart.style.display = 'inline-flex';
                btnStart.innerHTML = '<span>▶</span> Record Another Session';
            }
            if (btnStop) btnStop.style.display = 'none';
            if (btnReset) btnReset.style.display = 'inline-flex';

            const addText = document.getElementById('btnAddActivityText');
            if (addText) addText.innerText = 'Add Activity';
        }

        function resetModalTimer() {
            if (confirm("Reset current timer?")) {
                if (modalTimerInterval) clearInterval(modalTimerInterval);
                localStorage.removeItem('ms_modal_timer_start');
                resetModalTimerUI();
                document.getElementById('clockIn').value = '';
                document.getElementById('clockOut').value = '';
            }
        }

        function resetModalTimerUI() {
            const box = document.getElementById('modalTimerBox');
            const statusText = document.getElementById('modalTimerStatusText');
            const timestamps = document.getElementById('modalTimerTimestamps');
            const btnStart = document.getElementById('btnModalTimerStart');
            const btnStop = document.getElementById('btnModalTimerStop');
            const btnReset = document.getElementById('btnModalTimerReset');

            if (box) box.classList.remove('running');
            if (statusText) statusText.innerText = 'Timer Ready';
            if (timestamps) timestamps.innerText = 'Click Start to begin tracking this task';
            const disp = document.getElementById('modalTimerDisplay');
            if (disp) disp.innerText = '00:00:00';

            if (btnStart) {
                btnStart.style.display = 'inline-flex';
                btnStart.innerHTML = '<span>▶</span> Start Timer';
            }
            if (btnStop) btnStop.style.display = 'none';
            if (btnReset) btnReset.style.display = 'none';

            const addText = document.getElementById('btnAddActivityText');
            if (addText) addText.innerText = 'Add Activity';
        }

        function checkRunningModalTimer() {
            const saved = localStorage.getItem('ms_modal_timer_start');
            if (saved) {
                renderModalTimerRunning(parseInt(saved, 10));
            }
        }

        // Modal Add Controls
        function openAddModal() {
            document.getElementById('msg').innerText = '';

            if (localStorage.getItem('ms_modal_timer_start')) {
                switchTimeMode('timer');
            } else {
                switchTimeMode('manual');
            }

            const ticketSel = document.getElementById('ticketDeduction');
            if (ticketSel) ticketSel.value = '0';
            updateMsigFormHelper('add');

            document.getElementById('addModal').classList.add('active');
        }

        function closeAddModal() {
            document.getElementById('addModal').classList.remove('active');
        }


        // Submit Form Activity
        function submitForm() {
            let remarksVal = document.getElementById('remarks').value;
            const custVal = document.getElementById('customer').value || '';
            const isContract = typeof isContractCustomer === 'function' ? isContractCustomer(custVal) : custVal.toUpperCase().includes('MSIG');
            const ticketDeductionVal = isContract && document.getElementById('ticketDeduction')
                ? parseFloat(document.getElementById('ticketDeduction').value || 0)
                : 0.0;

            const payload = {
                customer: document.getElementById('customer').value,
                date: document.getElementById('startDate').value,
                raisedBy: document.getElementById('raisedBy').value,
                services: document.getElementById('services').value,
                category: document.getElementById('category').value,
                project: document.getElementById('project').value,
                taskDescription: document.getElementById('taskDescription').value,
                rootCause: document.getElementById('rootCause').value,
                solution: document.getElementById('solution').value,
                clockIn: document.getElementById('clockIn').value,
                clockOut: document.getElementById('clockOut').value,
                status: document.getElementById('status').value,
                remarks: remarksVal,
                ticketDeduction: ticketDeductionVal
            };

            loading(true);
            fetch('/api/submit-activity', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(res => {
                    if (!res.ok) throw new Error("Network response error");
                    return res.json();
                })
                .then(() => {
                    document.getElementById('msg').style.color = '#16a34a';
                    document.getElementById('msg').innerText = 'Activity recorded!';
                    loading(false);

                    document.getElementById('project').value = '';
                    document.getElementById('taskDescription').value = '';
                    document.getElementById('rootCause').value = '';
                    document.getElementById('solution').value = '';
                    document.getElementById('remarks').value = '';
                    document.getElementById('clockIn').value = '';
                    document.getElementById('clockOut').value = '';
                    document.getElementById('startDate').value = new Date().toISOString().split('T')[0];
                    if (modalTimerInterval) clearInterval(modalTimerInterval);
                    localStorage.removeItem('ms_modal_timer_start');
                    resetModalTimerUI();
                    switchTimeMode('manual');

                    setTimeout(() => {
                        closeAddModal();
                        fetchLogs();
                    }, 800);
                })
                .catch(err => {
                    document.getElementById('msg').style.color = '#dc2626';
                    document.getElementById('msg').innerText = err.message;
                    loading(false);
                });
        }



        function fetchLogs(forcePull = false) {
            reportLoading(true);
            const sortOrder = document.getElementById('sortOrderSelect') ? document.getElementById('sortOrderSelect').value : 'sheet_desc';
            const url = `/api/activity-logs?refresh=${forcePull ? 'true' : 'false'}&order_by=${encodeURIComponent(sortOrder)}`;

            fetch(url)
                .then(async res => {
                    const data = await res.json();
                    if (!res.ok) {
                        throw new Error(data.error || data.message || `HTTP ${res.status}`);
                    }
                    return data;
                })
                .then(logs => {
                    if (!Array.isArray(logs)) {
                        throw new Error(logs.error || "Data format error: expected array of logs");
                    }
                    allReportLogs = logs;
                    updateCustomerDatalist();
                    applyFilters();
                    updateDashboardAnalytics();
                    reportLoading(false);
                    if (forcePull) {
                        checkSyncStatus();
                    }
                })
                .catch(err => {
                    console.error("Error fetching activity logs:", err);
                    reportLoading(false);
                    const tbody = document.getElementById('reportTbody');
                    if (tbody && (!allReportLogs || allReportLogs.length === 0)) {
                        tbody.innerHTML = `<tr><td colspan="${getVisibleColumnCount()}" style="text-align: center; color: #dc2626; padding: 24px;">⚠️ Gagal memuat data: ${err.message}</td></tr>`;
                    }
                });
        }

        function onSortOrderChange() {
            fetchLogs(false);
        }



        // Preset Filter Handlers
        function applyPreset(presetType, btnElement) {
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));

            const todayStr = new Date().toISOString().split('T')[0];
            const customerSel = document.getElementById('filterCustomer');
            const statusSel = document.getElementById('filterStatus');
            const startInp = document.getElementById('filterStartDate');
            const endInp = document.getElementById('filterEndDate');
            const searchInp = document.getElementById('searchKeyword');

            if (presetType === 'today') {
                statusSel.value = '';
                startInp.value = todayStr;
                endInp.value = todayStr;
                searchInp.value = '';
                btnElement.classList.add('active');
            } else if (presetType === 'pending') {
                statusSel.value = 'In Progress';
                startInp.value = '';
                endInp.value = '';
                searchInp.value = '';
                btnElement.classList.add('active');
            } else if (presetType === 'thisMonth') {
                const now = new Date();
                const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
                const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

                statusSel.value = '';
                startInp.value = firstDay;
                endInp.value = lastDay;
                searchInp.value = '';
                btnElement.classList.add('active');
            } else if (presetType === 'reset') {
                customerSel.value = '';
                statusSel.value = '';
                startInp.value = '';
                endInp.value = '';
                searchInp.value = '';
            }

            applyFilters();
        }

        function onManualFilterChange() {
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
            applyFilters();
        }

        // Filtering Functions
        function applyFilters() {
            const customer = document.getElementById('filterCustomer').value;
            const status = document.getElementById('filterStatus').value;
            const startDate = document.getElementById('filterStartDate').value;
            const endDate = document.getElementById('filterEndDate').value;
            const keyword = document.getElementById('searchKeyword').value.toLowerCase();

            filteredLogs = allReportLogs.filter(log => {
                const matchCustomer = !customer || log.customer === customer;
                const matchStatus = !status || log.status === status;
                const matchKeyword = !keyword || (log.taskDescription && log.taskDescription.toLowerCase().includes(keyword)) || (log.project && log.project.toLowerCase().includes(keyword));

                let matchDate = true;
                if (startDate && log.date) matchDate = matchDate && (log.date >= startDate);
                if (endDate && log.date) matchDate = matchDate && (log.date <= endDate);

                return matchCustomer && matchStatus && matchKeyword && matchDate;
            });

            currentPage = 1;
            renderReportTable();
        }

        function changePageSize() {
            pageSize = parseInt(document.getElementById('pageSizeSelect').value, 10);
            currentPage = 1;
            renderReportTable();
        }

        function changePage(direction) {
            const maxPages = Math.ceil(filteredLogs.length / pageSize) || 1;
            currentPage += direction;
            if (currentPage < 1) currentPage = 1;
            if (currentPage > maxPages) currentPage = maxPages;


            renderReportTable();
        }

        // === COLUMN VISIBILITY TOGGLE LOGIC ===
        const DEFAULT_COLUMN_VISIBILITY = {
            customer: true,
            date: true,
            raisedBy: true,
            services: true,
            category: true,
            taskDescription: true,
            duration: true,
            status: true,
            action: true
        };

        function getColumnVisibilityConfig() {
            try {
                const stored = localStorage.getItem('ms_column_visibility');
                if (stored) {
                    return Object.assign({}, DEFAULT_COLUMN_VISIBILITY, JSON.parse(stored));
                }
            } catch (e) {
                console.error("Error reading column visibility config:", e);
            }
            return Object.assign({}, DEFAULT_COLUMN_VISIBILITY);
        }

        function saveColumnVisibilityConfig(config) {
            try {
                localStorage.setItem('ms_column_visibility', JSON.stringify(config));
            } catch (e) {
                console.error("Error saving column visibility config:", e);
            }
        }

        function getVisibleColumnCount() {
            const config = getColumnVisibilityConfig();
            let count = 1; // 1 for col-expand
            for (const key of Object.keys(DEFAULT_COLUMN_VISIBILITY)) {
                if (config[key] !== false) count++;
            }
            return count;
        }

        function applyColumnVisibilityStyles() {
            const config = getColumnVisibilityConfig();
            let css = '';
            for (const [col, isVis] of Object.entries(config)) {
                if (isVis === false) {
                    css += `th.col-${col}, td.col-${col} { display: none !important; }\n`;
                }
            }
            let styleTag = document.getElementById('columnVisibilityStyle');
            if (!styleTag) {
                styleTag = document.createElement('style');
                styleTag.id = 'columnVisibilityStyle';
                document.head.appendChild(styleTag);
            }
            styleTag.textContent = css;

            // Update any existing detail-row colspan
            const count = getVisibleColumnCount();
            document.querySelectorAll('#reportTbody tr.detail-row td').forEach(td => {
                td.colSpan = count;
            });
            const emptyTd = document.querySelector('#reportTbody td[colspan]');
            if (emptyTd && emptyTd.parentElement.classList.contains('main-row') === false && emptyTd.parentElement.classList.contains('detail-row') === false) {
                emptyTd.colSpan = count;
            }
        }

        function syncColumnVisibilityCheckboxes() {
            const config = getColumnVisibilityConfig();
            document.querySelectorAll('#columnVisibilityDropdown input[data-col]').forEach(cb => {
                const col = cb.getAttribute('data-col');
                cb.checked = config[col] !== false;
            });
        }

        function toggleColumnVisibilityMenu(e) {
            if (e) e.stopPropagation();
            const dd = document.getElementById('columnVisibilityDropdown');
            if (!dd) return;
            const isOpen = dd.style.display !== 'none';
            if (!isOpen) {
                syncColumnVisibilityCheckboxes();
                dd.style.display = 'flex';
            } else {
                dd.style.display = 'none';
            }
        }

        function closeColumnVisibilityMenu() {
            const dd = document.getElementById('columnVisibilityDropdown');
            if (dd) dd.style.display = 'none';
        }

        function toggleColumn(checkbox) {
            const col = checkbox.getAttribute('data-col');
            const config = getColumnVisibilityConfig();
            config[col] = checkbox.checked;
            saveColumnVisibilityConfig(config);
            applyColumnVisibilityStyles();
        }

        function resetColumnVisibility() {
            localStorage.removeItem('ms_column_visibility');
            syncColumnVisibilityCheckboxes();
            applyColumnVisibilityStyles();
        }

        // Render Table Content & Mobile Cards
        function renderReportTable() {
            const tbody = document.getElementById('reportTbody');
            const mobileContainer = document.getElementById('reportMobileCards');
            tbody.innerHTML = '';
            if (mobileContainer) mobileContainer.innerHTML = '';

            const totalItems = filteredLogs.length;

            if (totalItems === 0) {
                tbody.innerHTML = `<tr><td colspan="${getVisibleColumnCount()}" style="text-align: center; color: var(--muted); padding: 24px;">No records found.</td></tr>`;
                if (mobileContainer) {
                    mobileContainer.innerHTML = `<div class="mcard-empty"><div style="font-size: 32px; margin-bottom: 8px;">🔍</div>Tidak ada catatan aktivitas yang sesuai filter.</div>`;
                }
                document.getElementById('paginationInfo').innerText = 'Showing 0 of 0 entries';
                document.getElementById('pageIndicator').innerText = 'Page 1 of 1';
                document.getElementById('prevBtn').disabled = true;
                document.getElementById('nextBtn').disabled = true;
                return;
            }

            const startIdx = (currentPage - 1) * pageSize;
            const endIdx = Math.min(startIdx + pageSize, totalItems);
            const pageLogs = filteredLogs.slice(startIdx, endIdx);

            pageLogs.forEach((item) => {
                const statusClass = item.status === 'Closed' ? 'status-closed' : 'status-in-progress';
                const detailRowId = `detail-${item.rowId}`;
                const formattedDate = formatDateFormatted(item.date);
                const msigCalc = typeof calculateContractTicketBurn === 'function' ? calculateContractTicketBurn(item) : calculateMsigTicketBurn(item);
                const isContract = msigCalc.isContract || msigCalc.isMsig || (item.customer && (item.customer.toUpperCase().includes('MSIG') || item.customer.toUpperCase().includes('ASJ')));
                const isMsig = isContract; // for template backward-compatibility
                const contractClient = msigCalc.client || (item.customer && item.customer.toUpperCase().includes('ASJ') ? 'ASJ' : 'MSIG');
                const msigBadge = isContract ? `<div style="margin-top: 4px;">${msigCalc.badgeHtml}</div>` : '';

                // 1. Desktop Table Row
                const trMain = document.createElement('tr');
                trMain.className = 'main-row';
                trMain.onclick = (e) => {
                    if (e.target.tagName !== 'SELECT' && e.target.tagName !== 'OPTION') {
                        toggleDetailRow(detailRowId, trMain.querySelector('.expand-icon'));
                    }
                };

                trMain.innerHTML = `
          <td class="td-center col-expand"><span class="expand-icon" style="font-size: 10px;">▶</span></td>
          <td class="td-center col-customer">
            ${item.customer ? `
              <span class="customer-dossier-trigger" onclick="openCustomerDossier('${escapeJsString(item.customer)}'); event.stopPropagation();" title="Buka Dossier & Riwayat ${item.customer}">
                <strong>${item.customer}</strong>
                <span class="dossier-mini-icon">🗂️</span>
              </span>
            ` : '-'}
          </td>
          <td class="td-center col-date" style="white-space: nowrap;">${formattedDate}</td>
          <td class="td-center col-raisedBy">${item.raisedBy || '-'}</td>
          <td class="td-center col-services">${item.services || '-'}</td>
          <td class="td-center col-category">
            <div>${item.category || '-'}</div>
            ${isMsig ? `
              <select class="ticket-select burn-${(item.ticketDeduction || 0) == 0.5 ? '05' : ((item.ticketDeduction || 0) >= 1.0 ? '10' : '00')}"
                      title="Ubah Kuota Tiket Terpotong"
                      onclick="event.stopPropagation()"
                      onchange="changeTicketDeduction(${item.rowId}, parseFloat(this.value), this)">
                <option value="0" ${(item.ticketDeduction || 0) == 0 ? 'selected' : ''}>⚪ 0 Tkt</option>
                <option value="0.5" ${(item.ticketDeduction || 0) == 0.5 ? 'selected' : ''}>🎫 0.5 Tkt</option>
                <option value="1.0" ${(item.ticketDeduction || 0) >= 1.0 ? 'selected' : ''}>🎫 1.0 Tkt</option>
              </select>
            ` : ''}
          </td>
          <td class="td-left col-taskDescription">${item.taskDescription || '-'}</td>
          <td class="td-center col-duration"><strong>${item.duration || '00:00'}</strong></td>
          <td class="td-center col-status">
            <select class="status-select ${statusClass}" onchange="changeStatus(${item.rowId}, this.value, this)">
              <option value="In Progress" ${item.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
              <option value="Closed" ${item.status === 'Closed' ? 'selected' : ''}>Closed</option>
            </select>
          </td>
          <td class="td-center col-action">
            <select class="action-select" onchange="handleActionChange(${item.rowId}, this.value, this)">
              <option value="" disabled selected>⚡ Select</option>
              <option value="edit">✏️ Edit</option>
              <option value="delete">🗑️ Delete</option>
            </select>
          </td>
        `;

                const trDetail = document.createElement('tr');
                trDetail.id = detailRowId;
                trDetail.className = 'detail-row';
                trDetail.innerHTML = `
          <td colspan="${getVisibleColumnCount()}">
            <div class="detail-box">
              <div class="detail-item"><strong>Project / GCP ID:</strong> ${item.project || 'N/A'}</div>
              <div class="detail-item"><strong>Clock In / Out:</strong> ${item.clockIn || '-'} &nbsp;➔&nbsp; ${item.clockOut || '-'}</div>
              <div class="detail-item"><strong>Root Cause:</strong> ${item.rootCause || 'N/A'}</div>
              <div class="detail-item"><strong>Solution:</strong> ${item.solution || 'N/A'}</div>
              <div class="detail-item" style="grid-column: 1 / -1;"><strong>Remarks:</strong> ${item.remarks || 'None'}</div>
              ${isContract ? `<div class="detail-item" style="grid-column: 1 / -1; background: rgba(59, 130, 246, 0.08); border-left: 3px solid #3b82f6; padding: 6px 12px; border-radius: 6px;"><strong>🎫 ${contractClient} Contract Ticket Deduction:</strong> <span style="font-weight: 800; color: #1e40af;">${msigCalc.ticketBurn.toFixed(1)} Ticket</span> &nbsp;—&nbsp; <span style="color: var(--muted);">${msigCalc.explanation}</span></div>` : ''}
            </div>
          </td>
        `;

                tbody.appendChild(trMain);
                tbody.appendChild(trDetail);

                // 2. Mobile App Card
                if (mobileContainer) {
                    const card = document.createElement('div');
                    card.className = `mcard ${statusClass}`;
                    card.id = `mcard-${item.rowId}`;

                    card.innerHTML = `
                        <div class="mcard-top">
                            <div class="mcard-customer-info">
                                <span class="mcard-customer-badge" onclick="openCustomerDossier('${escapeJsString(item.customer)}'); event.stopPropagation();">
                                    <strong>${escapeHtml(item.customer || '-')}</strong> <span class="dossier-mini-icon">🗂️</span>
                                </span>
                                <span class="mcard-date-badge">${formattedDate}</span>
                            </div>
                            <div class="mcard-top-right">
                                <span class="mcard-duration-badge">⏱️ ${item.duration || '00:00'}</span>
                                <select class="mcard-status-select ${statusClass}" onchange="changeStatus(${item.rowId}, this.value, this)">
                                    <option value="In Progress" ${item.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                                    <option value="Closed" ${item.status === 'Closed' ? 'selected' : ''}>Closed</option>
                                </select>
                            </div>
                        </div>

                        <div class="mcard-task-desc" onclick="toggleMobileCardDetail(${item.rowId})">
                            ${escapeHtml(item.taskDescription || '-')}
                        </div>

                        <div class="mcard-tags">
                            <span class="mcard-tag">☁️ ${escapeHtml(item.services || '-')}</span>
                            <span class="mcard-tag">🏷️ ${escapeHtml(item.category || '-')}</span>
                            ${item.raisedBy ? `<span class="mcard-tag">👤 ${escapeHtml(item.raisedBy)}</span>` : ''}
                            ${isMsig ? `
                                <select class="ticket-select burn-${(item.ticketDeduction || 0) == 0.5 ? '05' : ((item.ticketDeduction || 0) >= 1.0 ? '10' : '00')}"
                                        title="Ubah Kuota Tiket Terpotong"
                                        onclick="event.stopPropagation()"
                                        onchange="changeTicketDeduction(${item.rowId}, parseFloat(this.value), this)">
                                    <option value="0" ${(item.ticketDeduction || 0) == 0 ? 'selected' : ''}>⚪ 0 Tkt</option>
                                    <option value="0.5" ${(item.ticketDeduction || 0) == 0.5 ? 'selected' : ''}>🎫 0.5 Tkt</option>
                                    <option value="1.0" ${(item.ticketDeduction || 0) >= 1.0 ? 'selected' : ''}>🎫 1.0 Tkt</option>
                                </select>
                            ` : ''}
                        </div>

                        <!-- Expandable Details Drawer -->
                        <div class="mcard-details-panel" id="mcardDetail-${item.rowId}" style="display: none;">
                            <div class="mcard-detail-item"><strong>📌 Project / GCP:</strong> ${escapeHtml(item.project || 'N/A')}</div>
                            <div class="mcard-detail-item"><strong>⏰ Clock In/Out:</strong> ${item.clockIn || '-'} ➔ ${item.clockOut || '-'}</div>
                            ${item.rootCause ? `<div class="mcard-detail-item"><strong>🔍 Root Cause:</strong> ${escapeHtml(item.rootCause)}</div>` : ''}
                            ${item.solution ? `<div class="mcard-detail-item"><strong>💡 Solution:</strong> ${escapeHtml(item.solution)}</div>` : ''}
                            ${item.remarks ? `<div class="mcard-detail-item"><strong>📝 Remarks:</strong> ${escapeHtml(item.remarks)}</div>` : ''}
                            ${isContract ? `<div class="mcard-detail-item msig-note"><strong>🎫 Kuota ${contractClient}:</strong> ${msigCalc.ticketBurn.toFixed(1)} Ticket — ${msigCalc.explanation}</div>` : ''}
                        </div>

                        <div class="mcard-footer">
                            <button type="button" class="mcard-expand-btn" onclick="toggleMobileCardDetail(${item.rowId})">
                                <span id="mcardExpandIcon-${item.rowId}">Detail ▾</span>
                            </button>
                            <div class="mcard-action-btns">
                                <button type="button" class="mcard-btn-action edit" onclick="openEditModal(${item.rowId})" title="Edit Log">✏️ Edit</button>
                                <button type="button" class="mcard-btn-action delete" onclick="confirmDelete(${item.rowId})" title="Hapus Log">🗑️</button>
                            </div>
                        </div>
                    `;
                    mobileContainer.appendChild(card);
                }
            });

            applyColumnVisibilityStyles();

            const maxPages = Math.ceil(totalItems / pageSize);
            document.getElementById('paginationInfo').innerText = `Showing ${startIdx + 1} - ${endIdx} of ${totalItems} entries`;
            document.getElementById('pageIndicator').innerText = `Page ${currentPage} of ${maxPages}`;

            document.getElementById('prevBtn').disabled = currentPage === 1;
            document.getElementById('nextBtn').disabled = currentPage === maxPages;
        }

        // Toggle Mobile Activity Card Details
        function toggleMobileCardDetail(rowId) {
            const panel = document.getElementById(`mcardDetail-${rowId}`);
            const icon = document.getElementById(`mcardExpandIcon-${rowId}`);
            if (!panel) return;
            if (panel.style.display === 'none' || !panel.style.display) {
                panel.style.display = 'block';
                if (icon) icon.innerText = 'Tutup ▴';
            } else {
                panel.style.display = 'none';
                if (icon) icon.innerText = 'Detail ▾';
            }
        }

        // Mobile Search Sync Functions
        function syncMobileSearch(val) {
            const searchInput = document.getElementById('searchKeyword');
            const clearBtn = document.getElementById('btnMobileSearchClear');
            if (searchInput) {
                searchInput.value = val;
                onManualFilterChange();
            }
            if (clearBtn) {
                clearBtn.style.display = val ? 'flex' : 'none';
            }
        }

        function clearMobileSearch() {
            const mobInput = document.getElementById('mobileSearchInput');
            const clearBtn = document.getElementById('btnMobileSearchClear');
            if (mobInput) mobInput.value = '';
            if (clearBtn) clearBtn.style.display = 'none';
            syncMobileSearch('');
        }

        // Toggle Mobile Filter Accordion
        function toggleMobileFilters() {
            const bar = document.getElementById('filterBarContainer');
            const icon = document.getElementById('mobileFilterToggleIcon');
            if (!bar) return;
            const isOpen = bar.classList.contains('mobile-expanded');
            if (isOpen) {
                bar.classList.remove('mobile-expanded');
                if (icon) icon.innerText = '▾';
            } else {
                bar.classList.add('mobile-expanded');
                if (icon) icon.innerText = '▴';
            }
        }

        // Set Mobile View Mode (Cards vs Table)
        function setMobileViewMode(mode) {
            const tableEl = document.querySelector('.table-responsive');
            const cardsEl = document.getElementById('reportMobileCards');
            const cardBtn = document.getElementById('mviewCardBtn');
            const tableBtn = document.getElementById('mviewTableBtn');

            if (mode === 'table') {
                if (tableEl) tableEl.classList.add('force-show');
                if (cardsEl) cardsEl.classList.add('force-hide');
                if (cardBtn) cardBtn.classList.remove('active');
                if (tableBtn) tableBtn.classList.add('active');
            } else {
                if (tableEl) tableEl.classList.remove('force-show');
                if (cardsEl) cardsEl.classList.remove('force-hide');
                if (cardBtn) cardBtn.classList.add('active');
                if (tableBtn) tableBtn.classList.remove('active');
            }
        }

        function handleActionChange(rowId, actionValue, selectElement) {
            if (actionValue === 'edit') {
                openEditModal(rowId);
            } else if (actionValue === 'delete') {
                confirmDelete(rowId);
            }
            selectElement.value = '';
        }

        function toggleDetailRow(rowId, iconEl) {
            const detailRow = document.getElementById(rowId);
            if (detailRow.classList.contains('open')) {
                detailRow.classList.remove('open');
                iconEl.innerText = '▶';
            } else {
                detailRow.classList.add('open');
                iconEl.innerText = '▼';
            }
        }

        // Quick Status Update
        function changeStatus(rowId, newStatus, selectElement) {
            selectElement.className = 'status-select ' + (newStatus === 'Closed' ? 'status-closed' : 'status-in-progress');

            fetch('/api/update-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rowId: rowId, status: newStatus })
            })
                .then(res => res.json())
                .then(() => {
                    const log = allReportLogs.find(l => l.rowId === rowId);
                    if (log) log.status = newStatus;
                    applyFilters();
                    updateDashboardAnalytics();
                })
                .catch(err => {
                    alert('Failed to update status: ' + err.message);
                    fetchLogs();
                });
        }

        // Helper: Normalize various date/time formats from Sheets/DB into YYYY-MM-DDTHH:mm for <input type="datetime-local">
        function normalizeToDateTimeLocal(val, fallbackDate) {
            if (!val) return '';
            const str = String(val).trim();
            if (!str || str === '-') return '';

            // 1. Already ISO-like: YYYY-MM-DDTHH:mm or YYYY-MM-DD HH:mm
            const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T\s](\d{1,2}):(\d{2})/);
            if (isoMatch) {
                const [, y, m, d, hh, mm] = isoMatch;
                return `${y}-${pad2(m)}-${pad2(d)}T${pad2(hh)}:${pad2(mm)}`;
            }

            // 2. DD/MM/YYYY HH:mm or DD-MM-YYYY HH:mm
            const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})[T\s]+(\d{1,2}):(\d{2})/);
            if (dmyMatch) {
                const [, d, m, y, hh, mm] = dmyMatch;
                return `${y}-${pad2(m)}-${pad2(d)}T${pad2(hh)}:${pad2(mm)}`;
            }

            // 3. Time-only or string containing HH:mm (combine with fallbackDate)
            const timeMatch = str.match(/(\d{1,2}):(\d{2})/);
            if (timeMatch) {
                const hh = pad2(timeMatch[1]);
                const mm = pad2(timeMatch[2]);
                let datePart = (fallbackDate && /^\d{4}-\d{2}-\d{2}$/.test(fallbackDate.trim()))
                    ? fallbackDate.trim()
                    : new Date().toISOString().split('T')[0];
                return `${datePart}T${hh}:${mm}`;
            }

            return '';
        }

        // Modal Edit Functions
        function openEditModal(rowId) {
            const log = allReportLogs.find(l => l.rowId === rowId);
            if (!log) return;

            document.getElementById('editRowId').value = log.rowId;
            document.getElementById('editCustomer').value = log.customer;
            document.getElementById('editDate').value = log.date;
            document.getElementById('editRaisedBy').value = log.raisedBy;
            document.getElementById('editServices').value = log.services || 'Google Cloud';
            document.getElementById('editCategory').value = log.category;
            document.getElementById('editProject').value = log.project || '';
            document.getElementById('editTaskDescription').value = log.taskDescription;
            document.getElementById('editRootCause').value = log.rootCause;
            document.getElementById('editSolution').value = log.solution;

            const normIn = normalizeToDateTimeLocal(log.clockIn, log.date);
            let normOut = normalizeToDateTimeLocal(log.clockOut, log.date);

            // Handle past-midnight when original values were time-only
            if (normIn && normOut && normOut < normIn && !/^\d{4}-\d{1,2}-\d{1,2}/.test(String(log.clockOut || '').trim())) {
                const outDateObj = new Date(normOut);
                if (!isNaN(outDateObj.getTime())) {
                    outDateObj.setDate(outDateObj.getDate() + 1);
                    normOut = toDateTimeLocalStr(outDateObj);
                }
            }

            document.getElementById('editClockIn').value = normIn;
            document.getElementById('editClockOut').value = normOut;
            document.getElementById('editStatus').value = log.status;
            document.getElementById('editRemarks').value = log.remarks;

            const deductionVal = (log.ticketDeduction !== undefined && log.ticketDeduction !== null) ? parseFloat(log.ticketDeduction) : 0.0;
            const editTicketEl = document.getElementById('editTicketDeduction');
            if (editTicketEl) {
                editTicketEl.value = (deductionVal === 0.5) ? '0.5' : (deductionVal >= 1.0 ? '1.0' : '0');
            }
            updateMsigFormHelper('edit');

            document.getElementById('editModal').classList.add('active');
        }

        function closeEditModal() {
            document.getElementById('editModal').classList.remove('active');
        }

        function saveEditModal() {
            let remarksVal = document.getElementById('editRemarks').value;
            const editCustVal = document.getElementById('editCustomer').value || '';
            const isContractEdit = typeof isContractCustomer === 'function' ? isContractCustomer(editCustVal) : editCustVal.toUpperCase().includes('MSIG');
            const editTicketDeductionVal = isContractEdit && document.getElementById('editTicketDeduction')
                ? parseFloat(document.getElementById('editTicketDeduction').value || 0)
                : 0.0;

            const payload = {
                rowId: parseInt(document.getElementById('editRowId').value, 10),
                customer: document.getElementById('editCustomer').value,
                date: document.getElementById('editDate').value,
                raisedBy: document.getElementById('editRaisedBy').value,
                services: document.getElementById('editServices').value,
                category: document.getElementById('editCategory').value,
                project: document.getElementById('editProject').value,
                taskDescription: document.getElementById('editTaskDescription').value,
                rootCause: document.getElementById('editRootCause').value,
                solution: document.getElementById('editSolution').value,
                clockIn: document.getElementById('editClockIn').value,
                clockOut: document.getElementById('editClockOut').value,
                status: document.getElementById('editStatus').value,
                remarks: remarksVal,
                ticketDeduction: editTicketDeductionVal
            };

            reportLoading(true);
            closeEditModal();

            fetch('/api/update-record', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(res => res.json())
                .then(() => {
                    fetchLogs();
                })
                .catch(err => {
                    alert('Failed to update record: ' + err.message);
                    reportLoading(false);
                });
        }

        // Delete Record Function
        function confirmDelete(rowId) {
            if (confirm('Are you sure you want to delete this activity record permanently?')) {
                reportLoading(true);
                fetch(`/api/delete-record/${rowId}`, { method: 'DELETE' })
                    .then(res => res.json())
                    .then(() => {
                        fetchLogs();
                    })
                    .catch(err => {
                        alert('Failed to delete record: ' + err.message);
                        reportLoading(false);
                    });
            }
        }

