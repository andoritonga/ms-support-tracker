// ==========================================================
// === WEEKLY CUSTOMER PERFORMANCE & ISSUE HEALTH REPORT ===
// ==========================================================

        function formatLocalYMD(dateObj) {
            const yr = dateObj.getFullYear();
            const mo = String(dateObj.getMonth() + 1).padStart(2, '0');
            const da = String(dateObj.getDate()).padStart(2, '0');
            return `${yr}-${mo}-${da}`;
        }

        function clearWeeklyPresetActive() {
            ['wkPresetThisWeek', 'wkPresetLastWeek', 'wkPresetLast7', 'wkPresetThisMonth'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.remove('active');
            });
        }

        function applyWeeklyReportPreset(preset, btnEl) {
            clearWeeklyPresetActive();
            if (btnEl) btnEl.classList.add('active');

            const now = new Date();
            const startInput = document.getElementById('slaReportStartDate');
            const endInput = document.getElementById('slaReportEndDate');
            if (!startInput || !endInput) return;

            if (preset === 'thisWeek') {
                // Monday to Sunday of current week
                const day = now.getDay(); // 0 (Sun) to 6 (Sat)
                const diffToMon = day === 0 ? -6 : 1 - day;
                const mon = new Date(now);
                mon.setDate(now.getDate() + diffToMon);
                const sun = new Date(mon);
                sun.setDate(mon.getDate() + 6);
                startInput.value = formatLocalYMD(mon);
                endInput.value = formatLocalYMD(sun);
            } else if (preset === 'lastWeek') {
                const day = now.getDay();
                const diffToLastMon = (day === 0 ? -6 : 1 - day) - 7;
                const lastMon = new Date(now);
                lastMon.setDate(now.getDate() + diffToLastMon);
                const lastSun = new Date(lastMon);
                lastSun.setDate(lastMon.getDate() + 6);
                startInput.value = formatLocalYMD(lastMon);
                endInput.value = formatLocalYMD(lastSun);
            } else if (preset === 'last7Days') {
                const start = new Date(now);
                start.setDate(now.getDate() - 6);
                startInput.value = formatLocalYMD(start);
                endInput.value = formatLocalYMD(now);
            } else if (preset === 'thisMonth') {
                const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
                const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                startInput.value = formatLocalYMD(firstDay);
                endInput.value = formatLocalYMD(lastDay);
            }
            refreshSlaCustomerCounts();
        }

        function getAllAvailableCustomers() {
            const customerSet = new Set();
            if (typeof customerListCache !== 'undefined' && customerListCache && customerListCache.length > 0) {
                customerListCache.forEach(c => { if (c && c.trim()) customerSet.add(c.trim()); });
            }
            if (typeof allReportLogs !== 'undefined' && allReportLogs && allReportLogs.length > 0) {
                allReportLogs.forEach(l => { if (l.customer && l.customer.trim()) customerSet.add(l.customer.trim()); });
            }
            const filterCustEl = document.getElementById('filterCustomer');
            if (filterCustEl && filterCustEl.options) {
                Array.from(filterCustEl.options).forEach(opt => {
                    if (opt.value && opt.value.trim()) customerSet.add(opt.value.trim());
                });
            }
            return Array.from(customerSet).sort((a, b) => a.localeCompare(b));
        }

        function getPeriodCustomerStatsMap() {
            const startDate = (document.getElementById('slaReportStartDate') || {}).value || '';
            const endDate = (document.getElementById('slaReportEndDate') || {}).value || '';
            const targetService = (document.getElementById('slaReportService') || {}).value || 'All';
            const statsMap = {};

            (allReportLogs || []).forEach(log => {
                const cust = (log.customer || '').trim();
                if (!cust) return;
                if (startDate && log.date && log.date < startDate) return;
                if (endDate && log.date && log.date > endDate) return;
                if (targetService !== 'All' && log.services !== targetService) return;

                if (!statsMap[cust]) {
                    statsMap[cust] = { total: 0, issues: 0 };
                }
                statsMap[cust].total += 1;
                if ((log.category || '').trim().toLowerCase() === 'issue') {
                    statsMap[cust].issues += 1;
                }
            });
            return statsMap;
        }

        function renderSlaCustomerChecklist(preserveSelection = true) {
            const listContainer = document.getElementById('slaReportCustomerList');
            if (!listContainer) return;

            const allCustomers = getAllAvailableCustomers();
            const existingCheckboxes = listContainer.querySelectorAll('.sla-cust-checkbox');
            const hadPreviousRender = existingCheckboxes.length > 0;
            const prevSelected = new Set();
            if (preserveSelection && hadPreviousRender) {
                existingCheckboxes.forEach(cb => {
                    if (cb.checked) prevSelected.add(cb.value);
                });
            }

            const statsMap = getPeriodCustomerStatsMap();
            const searchInput = document.getElementById('slaCustomerSearch');
            const currentQuery = searchInput ? (searchInput.value || '').trim().toLowerCase() : '';

            listContainer.innerHTML = '';
            allCustomers.forEach(cust => {
                const isChecked = (!preserveSelection || !hadPreviousRender) ? true : prevSelected.has(cust);
                const st = statsMap[cust] || { total: 0, issues: 0 };

                const itemLabel = document.createElement('label');
                itemLabel.className = 'sla-cust-item';
                itemLabel.setAttribute('data-customer-name', cust.toLowerCase());
                const matchesSearch = !currentQuery || cust.toLowerCase().includes(currentQuery);
                itemLabel.style.cssText = `display: ${matchesSearch ? 'flex' : 'none'}; align-items: center; justify-content: space-between; gap: 6px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--card); cursor: pointer; font-size: 12px; font-weight: 600; color: var(--text); margin: 0; user-select: none; transition: border-color 0.15s;`;

                const leftSpan = document.createElement('span');
                leftSpan.style.cssText = 'display: flex; align-items: center; gap: 7px; min-width: 0; overflow: hidden;';

                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'sla-cust-checkbox';
                cb.value = cust;
                cb.checked = isChecked;
                cb.style.cssText = 'width: 15px; height: 15px; cursor: pointer; flex-shrink: 0; margin: 0;';
                cb.addEventListener('change', updateSlaCustomerSelectionSummary);

                const nameSpan = document.createElement('span');
                nameSpan.textContent = cust;
                nameSpan.title = cust;
                nameSpan.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';

                leftSpan.appendChild(cb);
                leftSpan.appendChild(nameSpan);

                const badgeSpan = document.createElement('span');
                badgeSpan.className = 'sla-cust-stat-badge';
                badgeSpan.setAttribute('data-cust', cust);
                badgeSpan.style.cssText = 'flex-shrink: 0; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 99px;';
                applyCustomerStatBadgeStyle(badgeSpan, st);

                itemLabel.appendChild(leftSpan);
                itemLabel.appendChild(badgeSpan);
                listContainer.appendChild(itemLabel);
            });

            updateSlaCustomerSelectionSummary();
        }

        function applyCustomerStatBadgeStyle(badgeEl, st) {
            if (!badgeEl) return;
            if (st.issues > 0) {
                badgeEl.textContent = `${st.issues} Issue`;
                badgeEl.style.background = '#fee2e2';
                badgeEl.style.color = '#b91c1c';
                badgeEl.title = `${st.issues} Issue, ${st.total - st.issues} Support pada periode ini`;
            } else if (st.total > 0) {
                badgeEl.textContent = `${st.total} Task`;
                badgeEl.style.background = '#e0f2fe';
                badgeEl.style.color = '#0369a1';
                badgeEl.title = `0 Issue, ${st.total} Routine Support pada periode ini`;
            } else {
                badgeEl.textContent = '0 Log';
                badgeEl.style.background = 'rgba(148, 163, 184, 0.15)';
                badgeEl.style.color = 'var(--muted)';
                badgeEl.title = 'Tidak ada issue / aktivitas tercatat pada periode ini (100% Optimal)';
            }
        }

        function refreshSlaCustomerCounts() {
            const listContainer = document.getElementById('slaReportCustomerList');
            if (!listContainer) return;
            const statsMap = getPeriodCustomerStatsMap();
            listContainer.querySelectorAll('.sla-cust-stat-badge').forEach(badgeEl => {
                const cust = badgeEl.getAttribute('data-cust');
                const st = statsMap[cust] || { total: 0, issues: 0 };
                applyCustomerStatBadgeStyle(badgeEl, st);
            });
        }

        function updateSlaCustomerSelectionSummary() {
            const listContainer = document.getElementById('slaReportCustomerList');
            const badge = document.getElementById('slaCustomerSelectedBadge');
            if (!listContainer || !badge) return;
            const allCbs = listContainer.querySelectorAll('.sla-cust-checkbox');
            const checkedCount = Array.from(allCbs).filter(cb => cb.checked).length;
            badge.textContent = `${checkedCount} / ${allCbs.length} dipilih`;
            if (checkedCount === 0) {
                badge.style.background = '#fee2e2';
                badge.style.color = '#b91c1c';
            } else {
                badge.style.background = 'rgba(36, 52, 164, 0.12)';
                badge.style.color = 'var(--primary)';
            }
        }

        function toggleAllSlaCustomers(checked) {
            const listContainer = document.getElementById('slaReportCustomerList');
            if (!listContainer) return;
            listContainer.querySelectorAll('.sla-cust-item').forEach(item => {
                // Only toggle visible items if a search filter is active, or all items if not filtered
                if (item.style.display !== 'none') {
                    const cb = item.querySelector('.sla-cust-checkbox');
                    if (cb) cb.checked = checked;
                }
            });
            updateSlaCustomerSelectionSummary();
        }

        function selectActiveOnlySlaCustomers() {
            const listContainer = document.getElementById('slaReportCustomerList');
            if (!listContainer) return;
            const statsMap = getPeriodCustomerStatsMap();
            listContainer.querySelectorAll('.sla-cust-checkbox').forEach(cb => {
                const st = statsMap[cb.value] || { total: 0, issues: 0 };
                cb.checked = st.total > 0;
            });
            updateSlaCustomerSelectionSummary();
        }

        function filterSlaCustomerChecklist(query) {
            const listContainer = document.getElementById('slaReportCustomerList');
            if (!listContainer) return;
            const q = (query || '').trim().toLowerCase();
            listContainer.querySelectorAll('.sla-cust-item').forEach(item => {
                const name = item.getAttribute('data-customer-name') || '';
                item.style.display = (!q || name.includes(q)) ? 'flex' : 'none';
            });
        }

        function openClientReportModal() {
            const modal = document.getElementById('clientReportModal');
            if (!modal) return;

            // Default to This Week (Mon-Sun) if dates are not yet set
            const startInput = document.getElementById('slaReportStartDate');
            const endInput = document.getElementById('slaReportEndDate');
            if (startInput && endInput && (!startInput.value || !endInput.value)) {
                const btnThisWeek = document.getElementById('wkPresetThisWeek');
                applyWeeklyReportPreset('thisWeek', btnThisWeek);
            }

            const searchInput = document.getElementById('slaCustomerSearch');
            if (searchInput) searchInput.value = '';

            renderSlaCustomerChecklist(true);

            modal.classList.add('active');
        }

        function closeClientReportModal() {
            const modal = document.getElementById('clientReportModal');
            if (modal) modal.classList.remove('active');
        }

        function formatMinsToHoursText(totalMins) {
            const mins = Math.max(0, Math.round(totalMins || 0));
            const h = Math.floor(mins / 60);
            const m = mins % 60;
            if (h === 0) return `${m}m`;
            return `${h}h ${m}m`;
        }

        function generateClientSlaReport() {
            const listContainer = document.getElementById('slaReportCustomerList');
            const allAvailableCustomers = getAllAvailableCustomers();
            let selectedCustomers = [];
            if (listContainer) {
                selectedCustomers = Array.from(listContainer.querySelectorAll('.sla-cust-checkbox:checked'))
                    .map(cb => (cb.value || '').trim())
                    .filter(Boolean);
            } else {
                selectedCustomers = allAvailableCustomers;
            }

            if (selectedCustomers.length === 0) {
                alert('Silakan pilih minimal 1 customer yang ingin di-include ke dalam report.');
                return;
            }

            const selectedSet = new Set(selectedCustomers);
            const isAllSelected = allAvailableCustomers.length > 0 && selectedCustomers.length === allAvailableCustomers.length;
            const isSingleCustomer = selectedCustomers.length === 1;
            const targetCustomer = isSingleCustomer
                ? selectedCustomers[0]
                : (isAllSelected ? 'All' : 'Selected');

            const startDate = (document.getElementById('slaReportStartDate') || {}).value || '';
            const endDate = (document.getElementById('slaReportEndDate') || {}).value || '';
            const targetService = (document.getElementById('slaReportService') || {}).value || 'All';
            const preparedBy = (document.getElementById('slaReportPreparedBy') || {}).value || 'Ando Ritonga – Lead Cloud Managed Services';
            const reportTitle = (document.getElementById('slaReportTitle') || {}).value || 'Weekly Customer Performance & Issue Health Report';
            const customNotes = (document.getElementById('slaReportNotes') || {}).value || '';
            const includeSupportAppendix = (document.getElementById('slaReportIncludeSupport') || {}).checked || false;

            // Filter logs within period & selected customer scope
            const matchedLogs = (allReportLogs || []).filter(log => {
                const logCust = (log.customer || '').trim();
                if (!selectedSet.has(logCust)) return false;
                if (startDate && log.date && log.date < startDate) return false;
                if (endDate && log.date && log.date > endDate) return false;
                if (targetService !== 'All' && log.services !== targetService) return false;
                return true;
            });

            // Split into Issue logs vs Routine Support logs
            const isIssueLog = (l) => (l.category || '').trim().toLowerCase() === 'issue';
            const issueLogs = matchedLogs.filter(isIssueLog);
            const supportLogs = matchedLogs.filter(l => !isIssueLog(l));

            // Customer list to evaluate based on user's checked selection
            const customerList = selectedCustomers.slice().sort((a, b) => a.localeCompare(b));

            // Build Per-Customer Health Matrix
            const customerStats = customerList.map(cust => {
                const cLogs = matchedLogs.filter(l => (l.customer || '').trim() === cust);
                const cIssues = cLogs.filter(isIssueLog);
                const cSupport = cLogs.filter(l => !isIssueLog(l));
                const openIssues = cIssues.filter(l => l.status !== 'Closed').length;
                const closedIssues = cIssues.length - openIssues;
                const issueMins = cIssues.reduce((s, l) => s + (l.durationMinutes || 0), 0);
                const supportMins = cSupport.reduce((s, l) => s + (l.durationMinutes || 0), 0);
                const avgIssueMins = cIssues.length > 0 ? Math.round(issueMins / cIssues.length) : 0;

                // Health State:
                // 0 Issues -> PERFECT
                // >=1 Issues, 0 Open -> MITIGATED
                // >=1 Open Issues -> ACTION_NEEDED
                let healthCode = 'PERFECT';
                if (cIssues.length > 0) {
                    healthCode = openIssues > 0 ? 'ACTION_NEEDED' : 'MITIGATED';
                }

                return {
                    customer: cust,
                    totalCount: cLogs.length,
                    issueCount: cIssues.length,
                    closedIssues,
                    openIssues,
                    supportCount: cSupport.length,
                    issueMins,
                    supportMins,
                    totalMins: issueMins + supportMins,
                    avgIssueMins,
                    healthCode,
                    issues: cIssues
                };
            });

            // Sort Customer Matrix: customers with issues first (open -> resolved), then customers with support activity, then alphabetical
            customerStats.sort((a, b) => {
                if (b.openIssues !== a.openIssues) return b.openIssues - a.openIssues;
                if (b.issueCount !== a.issueCount) return b.issueCount - a.issueCount;
                if (b.supportCount !== a.supportCount) return b.supportCount - a.supportCount;
                return a.customer.localeCompare(b.customer);
            });

            // High-Level KPIs
            const totalCustomersCount = customerStats.length || 1;
            const issueFreeCustomersCount = customerStats.filter(c => c.issueCount === 0).length;
            const customersWithIssuesCount = totalCustomersCount - issueFreeCustomersCount;
            const perfectHealthPct = ((issueFreeCustomersCount / totalCustomersCount) * 100).toFixed(0);

            const totalIssuesCount = issueLogs.length;
            const closedIssuesCount = issueLogs.filter(l => l.status === 'Closed').length;
            const openIssuesCount = totalIssuesCount - closedIssuesCount;

            const totalIssueMins = issueLogs.reduce((s, l) => s + (l.durationMinutes || 0), 0);
            const avgIssueMttrMins = totalIssuesCount > 0 ? Math.round(totalIssueMins / totalIssuesCount) : 0;

            const totalSupportCount = supportLogs.length;
            const totalSupportMins = supportLogs.reduce((s, l) => s + (l.durationMinutes || 0), 0);

            // Format Reporting Period Label
            const periodLabel = (startDate && endDate)
                ? `${formatDateFormatted(startDate)} – ${formatDateFormatted(endDate)}`
                : (startDate ? `From ${formatDateFormatted(startDate)}` : (endDate ? `Until ${formatDateFormatted(endDate)}` : 'All Time'));

            const docId = `WK-RPT-${(targetCustomer === 'All' ? 'ALL' : targetCustomer).replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}-${(startDate || 'ALL').replace(/-/g, '')}`;
            const todayStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

            // =========================================================
            // === GENERATE 3 OFFSCREEN CHARTS FOR VISUAL ANALYTICS ===
            // =========================================================

            // 1. Chart 1: Customer Issue vs Routine Support Breakdown (Includes all recorded customers)
            const chart1List = customerStats;
            const canvasCust = document.createElement('canvas');
            canvasCust.width = 760;
            canvasCust.height = Math.max(420, chart1List.length * 28 + 90);
            new Chart(canvasCust.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: chart1List.map(c => c.customer),
                    datasets: [
                        {
                            label: 'Issues (Incidents)',
                            data: chart1List.map(c => c.issueCount),
                            backgroundColor: '#ef4444',
                            borderRadius: 4
                        },
                        {
                            label: 'Routine Support',
                            data: chart1List.map(c => c.supportCount),
                            backgroundColor: '#3b82f6',
                            borderRadius: 4
                        }
                    ]
                },
                options: {
                    indexAxis: 'y',
                    animation: false,
                    responsive: false,
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: { color: '#0f172a', font: { size: 12, weight: 'bold' } }
                        }
                    },
                    scales: {
                        x: {
                            stacked: true,
                            beginAtZero: true,
                            ticks: { stepSize: 1, color: '#334155', font: { size: 11 } },
                            grid: { color: '#e2e8f0' }
                        },
                        y: {
                            stacked: true,
                            ticks: { color: '#0f172a', font: { size: 11, weight: 'bold' } },
                            grid: { display: false }
                        }
                    }
                }
            });
            const chartCustImg = canvasCust.toDataURL('image/png');

            // 2. Chart 2: Daily Trend (Issues vs Support across the selected period)
            const dateKeys = [];
            if (startDate && endDate && startDate <= endDate) {
                const cur = new Date(startDate + 'T00:00:00');
                const end = new Date(endDate + 'T00:00:00');
                let safety = 0;
                while (cur <= end && safety < 35) {
                    dateKeys.push(formatLocalYMD(cur));
                    cur.setDate(cur.getDate() + 1);
                    safety++;
                }
            } else {
                const uniqueDates = Array.from(new Set(matchedLogs.map(l => l.date).filter(Boolean))).sort();
                uniqueDates.slice(-14).forEach(d => dateKeys.push(d));
            }

            const dailyIssueCounts = dateKeys.map(d => issueLogs.filter(l => l.date === d).length);
            const dailySupportCounts = dateKeys.map(d => supportLogs.filter(l => l.date === d).length);
            const dailyLabels = dateKeys.map(d => {
                const dt = new Date(d + 'T00:00:00');
                if (isNaN(dt.getTime())) return d;
                return dt.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
            });

            const canvasDaily = document.createElement('canvas');
            canvasDaily.width = 760;
            canvasDaily.height = 420;
            new Chart(canvasDaily.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: dailyLabels.length > 0 ? dailyLabels : ['No Dates'],
                    datasets: [
                        {
                            label: 'Issues',
                            data: dailyLabels.length > 0 ? dailyIssueCounts : [0],
                            backgroundColor: '#ef4444',
                            borderRadius: 4
                        },
                        {
                            label: 'Routine Support',
                            data: dailyLabels.length > 0 ? dailySupportCounts : [0],
                            backgroundColor: '#0ea5e9',
                            borderRadius: 4
                        }
                    ]
                },
                options: {
                    animation: false,
                    responsive: false,
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: { color: '#0f172a', font: { size: 12, weight: 'bold' } }
                        }
                    },
                    scales: {
                        x: {
                            ticks: { color: '#0f172a', font: { size: 10.5, weight: 'bold' }, maxRotation: 35, minRotation: 0 },
                            grid: { display: false }
                        },
                        y: {
                            beginAtZero: true,
                            ticks: { stepSize: 1, color: '#334155', font: { size: 11 } },
                            grid: { color: '#e2e8f0' }
                        }
                    }
                }
            });
            const chartDailyImg = canvasDaily.toDataURL('image/png');

            // 3. Chart 3: Issue Distribution by Cloud Service (or 100% Zero-Issue Ring if 0 issues)
            const issueByService = {};
            issueLogs.forEach(l => {
                const s = l.services || 'Other';
                issueByService[s] = (issueByService[s] || 0) + 1;
            });

            const canvasSvc = document.createElement('canvas');
            canvasSvc.width = 520;
            canvasSvc.height = 420;
            const svcKeys = Object.keys(issueByService);
            new Chart(canvasSvc.getContext('2d'), {
                type: 'doughnut',
                data: svcKeys.length > 0 ? {
                    labels: svcKeys.map(k => `${k} (${issueByService[k]})`),
                    datasets: [{
                        data: Object.values(issueByService),
                        backgroundColor: ['#ef4444', '#f97316', '#eab308', '#8b5cf6', '#06b6d4'],
                        borderWidth: 2,
                        borderColor: '#ffffff'
                    }]
                } : {
                    labels: ['100% Optimal (0 Issues)'],
                    datasets: [{
                        data: [1],
                        backgroundColor: ['#10b981'],
                        borderWidth: 2,
                        borderColor: '#ffffff'
                    }]
                },
                options: {
                    animation: false,
                    responsive: false,
                    cutout: '62%',
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { color: '#0f172a', font: { size: 12, weight: 'bold' }, padding: 14 }
                        }
                    }
                }
            });
            const chartSvcImg = canvasSvc.toDataURL('image/png');

            // =========================================================
            // === BUILD HTML TABLES (MATRIX, ISSUES, APPENDIX)      ===
            // =========================================================

            // 1. Customer Performance & Health Summary Matrix Rows
            let matrixRowsHtml = '';
            customerStats.forEach((c, idx) => {
                let badgeHtml = '';
                if (c.healthCode === 'PERFECT') {
                    badgeHtml = '<span style="display:inline-flex; align-items:center; gap:5px; padding:3px 10px; border-radius:99px; background:#dcfce7; color:#15803d; font-weight:800; font-size:11px;">🟢 Optimal (0 Issues)</span>';
                } else if (c.healthCode === 'MITIGATED') {
                    badgeHtml = '<span style="display:inline-flex; align-items:center; gap:5px; padding:3px 10px; border-radius:99px; background:#fef3c7; color:#b45309; font-weight:800; font-size:11px;">🟡 Resolved (' + c.issueCount + ' Issue' + (c.issueCount > 1 ? 's' : '') + ')</span>';
                } else {
                    badgeHtml = '<span style="display:inline-flex; align-items:center; gap:5px; padding:3px 10px; border-radius:99px; background:#fee2e2; color:#b91c1c; font-weight:800; font-size:11px;">🔴 Action Needed (' + c.openIssues + ' Open)</span>';
                }

                const issueCountCell = c.issueCount === 0
                    ? '<span style="color:#16a34a; font-weight:800;">0</span>'
                    : `<span style="color:#dc2626; font-weight:800;">${c.issueCount}</span> <span style="font-size:10.5px; color:#64748b;">(${c.closedIssues} Closed${c.openIssues > 0 ? `, ${c.openIssues} Open` : ''})</span>`;

                let summaryText = '<span style="color:#15803d; font-weight:600;">✓ Zero issues reported — environment operating at 100% normal performance.</span>';
                if (c.issueCount > 0) {
                    const titles = c.issues.map(i => escapeHtml(i.taskDescription || 'Unnamed Issue')).slice(0, 2);
                    const moreCount = c.issues.length > 2 ? ` (+${c.issues.length - 2} more)` : '';
                    summaryText = `<span style="color:#1e293b;">${titles.map(t => `• ${t}`).join('<br>')}${moreCount}</span>`;
                }

                matrixRowsHtml += `
                    <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                        <td style="padding:7px 10px; border:1px solid #e2e8f0; font-size:11.5px; font-weight:700; color:#0f172a;">${escapeHtml(c.customer)}</td>
                        <td style="padding:7px 10px; border:1px solid #e2e8f0; text-align:center; white-space:nowrap;">${badgeHtml}</td>
                        <td style="padding:7px 10px; border:1px solid #e2e8f0; text-align:center; font-size:11.5px; white-space:nowrap;">${issueCountCell}</td>
                        <td style="padding:7px 10px; border:1px solid #e2e8f0; text-align:center; font-size:11.5px; color:#334155;">
                            ${c.supportCount > 0 ? `<strong>${c.supportCount}</strong> <span style="font-size:10px; color:#64748b;">(${formatMinsToHoursText(c.supportMins)})</span>` : '<span style="color:#94a3b8;">0</span>'}
                        </td>
                        <td style="padding:7px 10px; border:1px solid #e2e8f0; font-size:11px; line-height:1.4;">${summaryText}</td>
                    </tr>
                `;
            });

            // 2. Detailed Issue Log Rows (Category = Issue ONLY)
            let issueRowsHtml = '';
            issueLogs.forEach((l, idx) => {
                const durationText = (l.duration && l.duration !== '00:00') ? l.duration : formatMinsToHoursText(l.durationMinutes || 0);
                const statusBadge = l.status === 'Closed'
                    ? '<span style="display:inline-block; padding:3px 8px; border-radius:12px; background:#dcfce7; color:#15803d; font-weight:700; font-size:10.5px;">Closed</span>'
                    : '<span style="display:inline-block; padding:3px 8px; border-radius:12px; background:#fee2e2; color:#b91c1c; font-weight:700; font-size:10.5px;">In Progress</span>';

                issueRowsHtml += `
                    <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#fffafa'};">
                        <td style="padding:7px 10px; border:1px solid #e2e8f0; font-size:11px; white-space:nowrap;">${escapeHtml(l.date || '-')}</td>
                        <td style="padding:7px 10px; border:1px solid #e2e8f0; font-size:11.5px; font-weight:700; color:#0f172a;">${escapeHtml(l.customer || '-')}</td>
                        <td style="padding:7px 10px; border:1px solid #e2e8f0; font-size:11px; font-weight:600; color:#1e3a8a;">
                            ${escapeHtml(l.services || '-')}
                            ${l.project ? `<div style="font-size:9.5px; color:#64748b; font-weight:500; margin-top:2px;">${escapeHtml(l.project)}</div>` : ''}
                        </td>
                        <td style="padding:7px 10px; border:1px solid #e2e8f0; font-size:11.5px;">
                            <strong>${escapeHtml(l.taskDescription || '-')}</strong>
                            ${l.raisedBy ? `<div style="font-size:10px; color:#64748b; margin-top:2px;">PIC: ${escapeHtml(l.raisedBy)}</div>` : ''}
                        </td>
                        <td style="padding:7px 10px; border:1px solid #e2e8f0; font-size:11px; color:#334155;">
                            ${l.rootCause ? `<div><strong style="color:#991b1b;">Root Cause:</strong> ${escapeHtml(l.rootCause)}</div>` : ''}
                            ${l.solution ? `<div style="margin-top:2px;"><strong style="color:#15803d;">Remediation:</strong> ${escapeHtml(l.solution)}</div>` : ''}
                            ${(!l.rootCause && !l.solution) ? '<span style="color:#94a3b8;">-</span>' : ''}
                        </td>
                        <td style="padding:7px 10px; border:1px solid #e2e8f0; font-size:11.5px; text-align:center; font-weight:700; color:#0f172a;">${escapeHtml(durationText)}</td>
                        <td style="padding:7px 10px; border:1px solid #e2e8f0; text-align:center;">${statusBadge}</td>
                    </tr>
                `;
            });

            // 3. Optional Routine Support Appendix Table
            let supportAppendixHtml = '';
            if (includeSupportAppendix && supportLogs.length > 0) {
                let suppRows = '';
                supportLogs.forEach((l, idx) => {
                    const durationText = (l.duration && l.duration !== '00:00') ? l.duration : formatMinsToHoursText(l.durationMinutes || 0);
                    const statusBadge = l.status === 'Closed'
                        ? '<span style="display:inline-block; padding:2px 7px; border-radius:10px; background:#dcfce7; color:#15803d; font-weight:700; font-size:10px;">Closed</span>'
                        : '<span style="display:inline-block; padding:2px 7px; border-radius:10px; background:#fef3c7; color:#b45309; font-weight:700; font-size:10px;">In Progress</span>';
                    suppRows += `
                        <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                            <td style="padding:6px 9px; border:1px solid #e2e8f0; font-size:11px; white-space:nowrap;">${escapeHtml(l.date || '-')}</td>
                            <td style="padding:6px 9px; border:1px solid #e2e8f0; font-size:11px; font-weight:600;">${escapeHtml(l.customer || '-')}</td>
                            <td style="padding:6px 9px; border:1px solid #e2e8f0; font-size:11px;">${escapeHtml(l.services || '-')}</td>
                            <td style="padding:6px 9px; border:1px solid #e2e8f0; font-size:11px;">${escapeHtml(l.taskDescription || '-')}</td>
                            <td style="padding:6px 9px; border:1px solid #e2e8f0; font-size:11px; text-align:center; font-weight:700;">${escapeHtml(durationText)}</td>
                            <td style="padding:6px 9px; border:1px solid #e2e8f0; text-align:center;">${statusBadge}</td>
                        </tr>
                    `;
                });

                supportAppendixHtml = `
                    <div style="margin-top: 22px; page-break-inside: auto;">
                        <h3 style="margin: 0 0 6px 0; font-size: 13px; color: #1e3a8a; text-transform: uppercase; letter-spacing: 0.5px;">
                            3. Appendix: Proactive & Routine Support Activities (${supportLogs.length} Records)
                        </h3>
                        <table>
                            <thead>
                                <tr>
                                    <th style="width: 75px;">Date</th>
                                    <th style="width: 110px;">Customer</th>
                                    <th style="width: 90px;">Service</th>
                                    <th>Support Activity Description</th>
                                    <th style="width: 65px; text-align: center;">Duration</th>
                                    <th style="width: 75px; text-align: center;">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${suppRows}
                            </tbody>
                        </table>
                    </div>
                `;
            }

            const logoSrc = (typeof LOGO_LIGHT !== 'undefined' && LOGO_LIGHT) ? LOGO_LIGHT : '/static/logo.png';

            // Overall Health Banner text for Single vs Multiple/All Customers
            const customerScopeLabel = isSingleCustomer
                ? selectedCustomers[0]
                : (isAllSelected
                    ? `All Managed Clients (${totalCustomersCount})`
                    : (selectedCustomers.length <= 3
                        ? selectedCustomers.join(', ')
                        : `Selected Clients (${totalCustomersCount} Customers)`));

            const kpiHealthValue = !isSingleCustomer
                ? `${issueFreeCustomersCount} / ${totalCustomersCount}`
                : (totalIssuesCount === 0 ? '100% Optimal' : (openIssuesCount === 0 ? 'Resolved' : 'Action Needed'));
            const kpiHealthSub = !isSingleCustomer
                ? `${perfectHealthPct}% Clients Issue-Free (${customersWithIssuesCount} w/ Issue)`
                : (totalIssuesCount === 0 ? 'Zero Issues Recorded' : `${closedIssuesCount}/${totalIssuesCount} Issues Mitigated`);

            const printWindow = window.open('', '_blank');
            if (!printWindow) {
                alert('Popup diblokir oleh browser/PWA. Silakan izinkan pop-up untuk mencetak laporan.');
                return;
            }
            printWindow.document.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>${escapeHtml(reportTitle)} - ${escapeHtml(customerScopeLabel)}</title>
                    <style>
                        @page {
                            size: A4 landscape;
                            margin: 10mm 12mm 10mm 12mm;
                        }
                        body {
                            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                            color: #0f172a;
                            margin: 0;
                            padding: 20px;
                            background: #ffffff;
                            font-size: 12px;
                            line-height: 1.45;
                            -webkit-print-color-adjust: exact;
                            print-color-adjust: exact;
                        }
                        .report-header {
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            border-bottom: 3px solid #2434a4;
                            padding-bottom: 14px;
                            margin-bottom: 16px;
                        }
                        .report-title-box h1 {
                            margin: 0;
                            font-size: 17px;
                            color: #2434a4;
                            font-weight: 800;
                            text-transform: uppercase;
                            letter-spacing: 0.4px;
                        }
                        .report-title-box p {
                            margin: 3px 0 0;
                            color: #64748b;
                            font-size: 11.5px;
                            font-weight: 600;
                        }
                        .meta-grid {
                            display: grid;
                            grid-template-columns: repeat(4, 1fr);
                            gap: 10px;
                            background: #f8fafc;
                            border: 1px solid #e2e8f0;
                            border-radius: 8px;
                            padding: 10px 14px;
                            margin-bottom: 16px;
                        }
                        .meta-item strong {
                            display: block;
                            font-size: 9.5px;
                            text-transform: uppercase;
                            color: #64748b;
                            margin-bottom: 2px;
                        }
                        .meta-item span {
                            font-size: 12.5px;
                            font-weight: 700;
                            color: #0f172a;
                        }
                        .kpi-row {
                            display: grid;
                            grid-template-columns: repeat(4, 1fr);
                            gap: 10px;
                            margin-bottom: 18px;
                        }
                        .kpi-card {
                            border: 1px solid #e2e8f0;
                            border-radius: 8px;
                            padding: 10px 12px;
                            text-align: center;
                            background: #ffffff;
                            box-shadow: 0 1px 2px rgba(0,0,0,0.03);
                        }
                        .kpi-label {
                            font-size: 10px;
                            color: #64748b;
                            font-weight: 700;
                            text-transform: uppercase;
                            margin-bottom: 4px;
                        }
                        .kpi-val {
                            font-size: 19px;
                            font-weight: 800;
                            color: #2434a4;
                        }
                        .kpi-val.success { color: #16a34a; }
                        .kpi-val.danger { color: #dc2626; }
                        .kpi-sub {
                            font-size: 10px;
                            color: #64748b;
                            margin-top: 2px;
                        }
                        .charts-grid {
                            display: grid;
                            grid-template-columns: 1.25fr 1.25fr 0.9fr;
                            gap: 12px;
                            margin-bottom: 18px;
                            page-break-inside: avoid;
                        }
                        .chart-box {
                            border: 1px solid #e2e8f0;
                            border-radius: 8px;
                            padding: 10px;
                            background: #ffffff;
                            text-align: center;
                        }
                        .chart-box h4 {
                            margin: 0 0 8px 0;
                            font-size: 11px;
                            color: #1e3a8a;
                            text-transform: uppercase;
                            letter-spacing: 0.3px;
                        }
                        .chart-box img {
                            width: 100%;
                            height: auto;
                            max-height: 175px;
                            object-fit: contain;
                        }
                        table {
                            width: 100%;
                            table-layout: fixed;
                            border-collapse: collapse;
                            margin-top: 8px;
                            page-break-inside: auto;
                            word-wrap: break-word;
                            overflow-wrap: break-word;
                        }
                        td, th {
                            word-wrap: break-word;
                            overflow-wrap: break-word;
                        }
                        tr {
                            page-break-inside: avoid;
                            page-break-after: auto;
                        }
                        th {
                            background: #1e3a8a;
                            color: #ffffff;
                            font-size: 10.5px;
                            font-weight: 700;
                            padding: 7px 9px;
                            text-align: left;
                            border: 1px solid #1e3a8a;
                        }
                        .notes-box {
                            background: #eff6ff;
                            border-left: 4px solid #0284c7;
                            padding: 9px 14px;
                            border-radius: 0 6px 6px 0;
                            margin-bottom: 16px;
                            font-size: 11.5px;
                            color: #1e293b;
                        }
                        .zero-issue-banner {
                            background: #f0fdf4;
                            border: 1.5px solid #86efac;
                            border-radius: 8px;
                            padding: 14px 18px;
                            text-align: center;
                            color: #166534;
                            font-weight: 700;
                            font-size: 12.5px;
                            margin-top: 8px;
                        }
                        .sign-block {
                            margin-top: 30px;
                            display: grid;
                            grid-template-columns: 1fr 1fr;
                            gap: 40px;
                            page-break-inside: avoid;
                        }
                        .sign-card {
                            border-top: 1px solid #cbd5e1;
                            padding-top: 10px;
                            text-align: center;
                        }
                        .sign-space {
                            height: 55px;
                        }
                        @media print {
                            @page {
                                size: A4 landscape;
                                margin: 10mm 12mm 10mm 12mm;
                            }
                            html, body {
                                width: 100%;
                                max-width: 100%;
                                padding: 0;
                                margin: 0;
                            }
                            .no-print { display: none !important; }
                            button { display: none !important; }
                        }
                    </style>
                </head>
                <body>
                    <div class="no-print" style="margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; background: #e0f2fe; padding: 10px 16px; border-radius: 8px;">
                        <span style="font-weight: 600; color: #0369a1;">📄 Weekly Report Preview: Performance evaluated by Customer Issue occurrence (0 Issues = Perfect Health).</span>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <button onclick="window.print()" style="background:#0284c7; color:#fff; border:none; padding:8px 18px; border-radius:6px; font-weight:700; cursor:pointer;">🖨️ Print / Save PDF</button>
                            <button onclick="window.close()" style="background:#ffffff; color:#475569; border:1px solid #cbd5e1; padding:8px 14px; border-radius:6px; font-weight:700; cursor:pointer;">✕ Close</button>
                        </div>
                    </div>

                    <div class="report-header">
                        <div style="display: flex; align-items: center; gap: 14px;">
                            <img src="${logoSrc}" alt="Logo" style="height: 44px; max-width: 160px; object-fit: contain;" />
                            <div class="report-title-box">
                                <h1>${escapeHtml(reportTitle)}</h1>
                                <p>Cloud Operations Managed Services – Issue-Based Performance Reference</p>
                            </div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-weight: 800; color: #2434a4; font-size: 12.5px;">${escapeHtml(docId)}</div>
                            <div style="color: #64748b; font-size: 10.5px; margin-top: 2px;">Issued: ${escapeHtml(todayStr)}</div>
                        </div>
                    </div>

                    <div class="meta-grid">
                        <div class="meta-item">
                            <strong>Customer Scope</strong>
                            <span>${escapeHtml(customerScopeLabel)}</span>
                        </div>
                        <div class="meta-item">
                            <strong>Reporting Period</strong>
                            <span>${escapeHtml(periodLabel)}</span>
                        </div>
                        <div class="meta-item">
                            <strong>Performance Basis</strong>
                            <span style="color: #0284c7;">Issue Occurrence (0 = Optimal)</span>
                        </div>
                        <div class="meta-item">
                            <strong>Prepared By</strong>
                            <span>${escapeHtml(preparedBy.split('–')[0].split('-')[0].trim())}</span>
                        </div>
                    </div>

                    ${customNotes ? `
                        <div class="notes-box">
                            <strong style="display:block; margin-bottom:2px; color:#0369a1; text-transform:uppercase; font-size:9.5px;">Executive Summary & Operational Highlights:</strong>
                            ${escapeHtml(customNotes)}
                        </div>
                    ` : ''}

                    <!-- SECTION 1: HIGH-LEVEL KPI SUMMARY -->
                    <div class="kpi-row">
                        <div class="kpi-card">
                            <div class="kpi-label">Issue-Free Customers</div>
                            <div class="kpi-val ${customersWithIssuesCount === 0 ? 'success' : ''}">${kpiHealthValue}</div>
                            <div class="kpi-sub">${kpiHealthSub}</div>
                        </div>
                        <div class="kpi-card">
                            <div class="kpi-label">Total Weekly Issues</div>
                            <div class="kpi-val ${totalIssuesCount === 0 ? 'success' : 'danger'}">${totalIssuesCount}</div>
                            <div class="kpi-sub">${totalIssuesCount === 0 ? '100% Perfect Health Week' : `${closedIssuesCount} Closed • ${openIssuesCount} In Progress`}</div>
                        </div>
                        <div class="kpi-card">
                            <div class="kpi-label">Avg. Issue Resolution</div>
                            <div class="kpi-val">${totalIssuesCount === 0 ? '0m' : `${avgIssueMttrMins}m`}</div>
                            <div class="kpi-sub">Total Issue Effort: ${formatMinsToHoursText(totalIssueMins)}</div>
                        </div>
                        <div class="kpi-card">
                            <div class="kpi-label">Routine Support Tasks</div>
                            <div class="kpi-val">${totalSupportCount}</div>
                            <div class="kpi-sub">Proactive Effort: ${formatMinsToHoursText(totalSupportMins)}</div>
                        </div>
                    </div>

                    <!-- SECTION 2: VISUAL GRAPHICS -->
                    <div class="charts-grid">
                        <div class="chart-box">
                            <h4>Customer Issues vs. Support</h4>
                            <img src="${chartCustImg}" alt="Customer Issues vs Support Chart" />
                        </div>
                        <div class="chart-box">
                            <h4>Daily Issue & Support Trend</h4>
                            <img src="${chartDailyImg}" alt="Daily Trend Chart" />
                        </div>
                        <div class="chart-box">
                            <h4>Issues by Cloud Service</h4>
                            <img src="${chartSvcImg}" alt="Service Breakdown Chart" />
                        </div>
                    </div>

                    <!-- SECTION 3: PER-CUSTOMER PERFORMANCE & HEALTH MATRIX -->
                    <div style="margin-top: 10px;">
                        <h3 style="margin: 0 0 4px 0; font-size: 12.5px; color: #1e3a8a; text-transform: uppercase; letter-spacing: 0.4px;">
                            1. Per-Customer Performance & Health Summary (${totalCustomersCount} ${totalCustomersCount === 1 ? 'Customer' : 'Customers'})
                        </h3>
                        <table>
                            <thead>
                                <tr>
                                    <th style="width: 145px;">Customer</th>
                                    <th style="width: 155px; text-align: center;">Performance / Health</th>
                                    <th style="width: 120px; text-align: center;">Issues Recorded</th>
                                    <th style="width: 115px; text-align: center;">Routine Support</th>
                                    <th>Weekly Issue Summary / Operational Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${matrixRowsHtml}
                            </tbody>
                        </table>
                    </div>

                    <!-- SECTION 4: DETAILED ISSUE REFERENCE LOG -->
                    <div style="margin-top: 20px;">
                        <h3 style="margin: 0 0 4px 0; font-size: 12.5px; color: #1e3a8a; text-transform: uppercase; letter-spacing: 0.4px;">
                            2. Detailed Issue Reference Log (${totalIssuesCount} ${totalIssuesCount === 1 ? 'Issue' : 'Issues'})
                        </h3>
                        ${totalIssuesCount === 0 ? `
                            <div class="zero-issue-banner">
                                ✅ Zero Issues Recorded During This Period — All monitored customer environments achieved 100% optimal performance with no service incidents.
                            </div>
                        ` : `
                            <table>
                                <thead>
                                    <tr>
                                        <th style="width: 75px;">Date</th>
                                        <th style="width: 105px;">Customer</th>
                                        <th style="width: 95px;">Service / Project</th>
                                        <th>Issue Description & PIC</th>
                                        <th>Root Cause & Remediation</th>
                                        <th style="width: 60px; text-align: center;">Duration</th>
                                        <th style="width: 72px; text-align: center;">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${issueRowsHtml}
                                </tbody>
                            </table>
                        `}
                    </div>

                    ${supportAppendixHtml}

                    <div class="sign-block">
                        <div class="sign-card">
                            <div style="font-weight: 700; color: #1e3a8a;">Prepared & Verified By:</div>
                            <div style="font-size: 11px; color: #64748b;">Managed Services Support Team</div>
                            <div class="sign-space"></div>
                            <div style="font-weight: 700; font-size: 12px; border-bottom: 1px solid #94a3b8; display: inline-block; min-width: 180px; padding-bottom: 2px;">
                                ${escapeHtml(preparedBy)}
                            </div>
                            <div style="font-size: 10.5px; color: #64748b; margin-top: 4px;">Cloud Managed Services Division</div>
                        </div>
                        <div class="sign-card">
                            <div style="font-weight: 700; color: #1e3a8a;">Acknowledged By:</div>
                            <div style="font-size: 11px; color: #64748b;">${isSingleCustomer ? escapeHtml(selectedCustomers[0]) : 'Management / Operations Lead'}</div>
                            <div class="sign-space"></div>
                            <div style="font-weight: 700; font-size: 12px; border-bottom: 1px solid #94a3b8; display: inline-block; min-width: 180px; padding-bottom: 2px;">
                                Representative Signature
                            </div>
                            <div style="font-size: 10.5px; color: #64748b; margin-top: 4px;">Date: ____ / ____ / ${new Date().getFullYear()}</div>
                        </div>
                    </div>

                    <script>
                        window.onload = function() {
                            setTimeout(() => { window.print(); }, 400);
                        }
                    <\/script>
                </body>
                </html>
            `);
            printWindow.document.close();
            closeClientReportModal();
        }
