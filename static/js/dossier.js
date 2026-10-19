// ==========================================
// === CUSTOMER DOSSIER DRAWER & HISTORICAL INSIGHTS ===
// ==========================================

        let currentDossierCustomer = null;

        function escapeJsString(str) {
            if (!str) return '';
            return String(str)
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "\\'")
                .replace(/"/g, '&quot;')
                .replace(/\n/g, ' ');
        }

        function openSelectedCustomerDossier() {
            const filterEl = document.getElementById('filterCustomer');
            const val = filterEl ? filterEl.value : '';
            if (!val) {
                alert("Silakan pilih customer pada filter terlebih dahulu, atau klik nama customer pada tabel laporan!");
                return;
            }
            openCustomerDossier(val);
        }

        function openCustomerDossier(customerName) {
            customerName = (customerName || '').trim();
            if (!customerName) return;

            currentDossierCustomer = customerName;
            document.getElementById('dossierCustomerName').innerText = customerName;

            const cLogs = allReportLogs.filter(l => (l.customer || '').trim().toLowerCase() === customerName.toLowerCase());

            // 1. Month and All-Time KPI Calculations
            const now = new Date();
            const thisMonthPrefix = now.toISOString().substring(0, 7);
            const monthName = now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
            document.getElementById('dossierActiveMonthLabel').innerText = `Periode: ${monthName}`;

            const thisMonthLogs = cLogs.filter(l => l.date && l.date.startsWith(thisMonthPrefix));
            document.getElementById('dossierKpiMonthCount').innerText = thisMonthLogs.length;

            let totalMinutes = 0;
            let inProgressCount = 0;
            let closedCount = 0;

            cLogs.forEach(l => {
                totalMinutes += (l.durationMinutes || 0);
                if (l.status === 'Closed') {
                    closedCount++;
                } else {
                    inProgressCount++;
                }
            });

            const totalHours = Math.floor(totalMinutes / 60);
            const remMins = totalMinutes % 60;
            document.getElementById('dossierKpiTotalHours').innerText = `${totalHours}h ${remMins}m`;
            document.getElementById('dossierKpiInProgress').innerText = inProgressCount;
            document.getElementById('dossierKpiClosed').innerText = closedCount;

            // 2. Contract Quota Section (if MSIG or ASJ)
            const msigSection = document.getElementById('dossierMsigQuotaSection');
            const contractClient = typeof getContractClientName === 'function' ? getContractClientName(customerName) : (customerName.toUpperCase().includes('MSIG') ? 'MSIG' : (customerName.toUpperCase().includes('ASJ') ? 'ASJ' : ''));
            if (contractClient) {
                msigSection.style.display = 'block';
                const titleEl = document.getElementById('dossierContractTitle');
                if (titleEl) titleEl.innerText = `${contractClient} Contract Ticket Consumption`;
                let totalBurn = 0.0;
                cLogs.forEach(l => {
                    const c = typeof calculateContractTicketBurn === 'function' ? calculateContractTicketBurn(l) : calculateMsigTicketBurn(l);
                    totalBurn += c.ticketBurn;
                });
                const quotaLimit = typeof getContractQuotaLimit === 'function' ? getContractQuotaLimit(contractClient) : getMsigQuotaLimit();
                const remaining = Math.max(0, quotaLimit - totalBurn);
                const percent = quotaLimit > 0 ? Math.min(100, Math.round((totalBurn / quotaLimit) * 100)) : 0;

                document.getElementById('dossierMsigPercentBadge').innerText = `${percent}% (${totalBurn.toFixed(1)} / ${quotaLimit} Tiket)`;
                document.getElementById('dossierMsigBurnedText').innerText = totalBurn.toFixed(1);
                document.getElementById('dossierMsigRemainingText').innerText = remaining.toFixed(1);

                const progressBar = document.getElementById('dossierMsigProgressBar');
                if (progressBar) {
                    progressBar.style.width = `${percent}%`;
                    if (percent >= 90) {
                        progressBar.style.background = '#ef4444';
                    } else if (percent >= 70) {
                        progressBar.style.background = '#f59e0b';
                    } else {
                        progressBar.style.background = '#3b82f6';
                    }
                }
            } else {
                msigSection.style.display = 'none';
            }

            // 3. Active Work (In Progress)
            const activeContainer = document.getElementById('dossierActiveTasksContainer');
            const inProgressList = cLogs.filter(l => l.status === 'In Progress');
            document.getElementById('dossierActiveCountBadge').innerText = inProgressList.length;

            if (inProgressList.length === 0) {
                activeContainer.innerHTML = `
                    <div style="text-align: center; padding: 14px; color: var(--muted); font-size: 11.5px; background: var(--input-bg); border-radius: 8px;">
                        ✨ Tidak ada pekerjaan aktif yang tertunda untuk klien ini. Semua beres!
                    </div>
                `;
            } else {
                let activeHtml = '';
                inProgressList.forEach(task => {
                    const durText = task.duration && task.duration !== '00:00' ? task.duration : `${Math.floor((task.durationMinutes || 0) / 60)}h ${(task.durationMinutes || 0) % 60}m`;
                    activeHtml += `
                        <div class="dossier-task-item">
                            <div class="dossier-task-header">
                                <div style="font-size: 11px; font-weight: 700; color: #b45309; background: #fef3c7; padding: 2px 7px; border-radius: 4px;">
                                    ⏳ ${task.date || '-'}
                                </div>
                                <div style="display: flex; gap: 6px;">
                                    <button type="button" class="btn-secondary" style="padding: 2px 8px; font-size: 10.5px; font-weight: 700; background: #dcfce7; color: #15803d; border-color: #86efac; cursor: pointer;" onclick="quickCloseDossierTask(${task.rowId})" title="Tandai tiket ini selesai (Closed)">
                                        ✓ Selesai
                                    </button>
                                    <button type="button" class="btn-secondary" style="padding: 2px 8px; font-size: 10.5px; cursor: pointer;" onclick="closeCustomerDossier(); openEditModal(${task.rowId});" title="Edit detail tiket">
                                        ✏️
                                    </button>
                                </div>
                            </div>
                            <div style="font-size: 12.5px; font-weight: 700; color: var(--text);">
                                ${task.taskDescription || '-'}
                            </div>
                            <div style="display: flex; gap: 6px; flex-wrap: wrap; font-size: 10.5px; color: var(--muted);">
                                ${task.project ? `<span class="dossier-badge-chip" title="Project ID">📁 ${task.project}</span>` : ''}
                                ${task.services ? `<span class="dossier-badge-chip">🛠️ ${task.services}</span>` : ''}
                                ${task.category ? `<span class="dossier-badge-chip">🏷️ ${task.category}</span>` : ''}
                                ${task.raisedBy ? `<span class="dossier-badge-chip">👤 ${task.raisedBy}</span>` : ''}
                                <span class="dossier-badge-chip">⏱️ ${durText}</span>
                            </div>
                        </div>
                    `;
                });
                activeContainer.innerHTML = activeHtml;
            }

            // 4. Top Services & Frequent Contacts
            const serviceCounts = {};
            const contactCounts = {};

            cLogs.forEach(l => {
                if (l.services) {
                    serviceCounts[l.services] = (serviceCounts[l.services] || 0) + 1;
                }
                if (l.raisedBy && l.raisedBy.trim() && l.raisedBy !== '-') {
                    const rb = l.raisedBy.trim();
                    contactCounts[rb] = (contactCounts[rb] || 0) + 1;
                }
            });

            const topServices = Object.entries(serviceCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);
            const topContacts = Object.entries(contactCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);

            const servicesContainer = document.getElementById('dossierTopServicesContainer');
            if (topServices.length === 0) {
                servicesContainer.innerHTML = '<div style="font-size: 11px; color: var(--muted);">-</div>';
            } else {
                servicesContainer.innerHTML = topServices.map(([svc, count]) => `
                    <div style="display: flex; justify-content: space-between; align-items: center; background: var(--card-bg); border: 1px solid var(--border); padding: 5px 9px; border-radius: 6px; font-size: 11px;">
                        <span style="font-weight: 600; color: var(--text);">${svc}</span>
                        <span style="font-weight: 800; color: var(--primary);">${count}x</span>
                    </div>
                `).join('');
            }

            const contactsContainer = document.getElementById('dossierTopContactsContainer');
            if (topContacts.length === 0) {
                contactsContainer.innerHTML = '<div style="font-size: 11px; color: var(--muted);">-</div>';
            } else {
                contactsContainer.innerHTML = topContacts.map(([contact, count]) => `
                    <div style="display: flex; justify-content: space-between; align-items: center; background: var(--card-bg); border: 1px solid var(--border); padding: 5px 9px; border-radius: 6px; font-size: 11px;">
                        <span style="font-weight: 600; color: var(--text);">${contact}</span>
                        <span style="font-weight: 800; color: #10b981;">${count}x</span>
                    </div>
                `).join('');
            }

            // 5. Recent History Timeline (First 7 logs)
            const timelineContainer = document.getElementById('dossierTimelineContainer');
            const recentLogs = cLogs.slice(0, 7);

            if (recentLogs.length === 0) {
                timelineContainer.innerHTML = '<div style="font-size: 11px; color: var(--muted);">Belum ada riwayat aktivitas.</div>';
            } else {
                let timelineHtml = '';
                recentLogs.forEach(l => {
                    const isClosed = l.status === 'Closed';
                    const durText = l.duration && l.duration !== '00:00' ? l.duration : `${Math.floor((l.durationMinutes || 0) / 60)}h ${(l.durationMinutes || 0) % 60}m`;
                    const msigBurn = typeof calculateContractTicketBurn === 'function' ? calculateContractTicketBurn(l) : calculateMsigTicketBurn(l);

                    timelineHtml += `
                        <div class="dossier-timeline-item">
                            <div class="dossier-timeline-dot ${isClosed ? 'closed' : 'progress'}"></div>
                            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; margin-bottom: 2px;">
                                <span style="font-weight: 700; color: var(--muted);">${l.date || '-'}</span>
                                <span style="font-weight: 700; font-size: 10px; padding: 2px 6px; border-radius: 4px; ${isClosed ? 'background:#dcfce7; color:#15803d;' : 'background:#fef3c7; color:#b45309;'}">${l.status || 'In Progress'}</span>
                            </div>
                            ${l.project ? `
                                <div style="font-size: 11px; margin-bottom: 3px;">
                                    <span style="font-size: 10px; font-weight: 600; color: var(--muted);">Project ID:</span> 
                                    <code style="font-size: 10.5px; font-weight: 600; color: var(--primary); background: var(--input-bg); padding: 1px 5px; border-radius: 4px; border: 1px solid var(--border);">${l.project}</code>
                                </div>
                            ` : ''}
                            <div style="font-size: 12px; font-weight: 700; color: var(--text); margin-bottom: 3px;">
                                ${l.taskDescription || '-'}
                            </div>
                            ${(l.rootCause || l.solution) ? `
                                <div style="font-size: 10.5px; color: var(--muted); margin-bottom: 4px; background: var(--input-bg); padding: 4px 8px; border-radius: 4px; border-left: 2px solid var(--primary);">
                                    ${l.rootCause ? `<div><em>RC:</em> ${l.rootCause}</div>` : ''}
                                    ${l.solution ? `<div><em>Solusi:</em> ${l.solution}</div>` : ''}
                                </div>
                            ` : ''}
                            <div style="display: flex; gap: 5px; flex-wrap: wrap; font-size: 10px;">
                                ${l.services ? `<span class="dossier-badge-chip">${l.services}</span>` : ''}
                                <span class="dossier-badge-chip">⏱️ ${durText}</span>
                                ${(msigBurn.isContract || msigBurn.isMsig) ? msigBurn.badgeHtml : ''}
                            </div>
                        </div>
                    `;
                });
                timelineContainer.innerHTML = timelineHtml;
            }

            // Show drawer
            document.getElementById('dossierBackdrop').classList.add('active');
            document.getElementById('customerDossierDrawer').classList.add('active');
        }

        function closeCustomerDossier() {
            const drawer = document.getElementById('customerDossierDrawer');
            const backdrop = document.getElementById('dossierBackdrop');
            if (drawer) drawer.classList.remove('active');
            if (backdrop) backdrop.classList.remove('active');
            currentDossierCustomer = null;
        }

        function dossierActionAddLog() {
            const cust = currentDossierCustomer;
            closeCustomerDossier();
            openAddModal();
            if (cust) {
                const custInp = document.getElementById('customer');
                if (custInp) {
                    custInp.value = cust;
                    onCustomerChange();
                }
            }
        }

        function dossierActionFilterTable() {
            const cust = currentDossierCustomer;
            closeCustomerDossier();
            if (cust) {
                const filterEl = document.getElementById('filterCustomer');
                if (filterEl) {
                    let exists = false;
                    for (let opt of filterEl.options) {
                        if (opt.value.toLowerCase() === cust.toLowerCase()) {
                            filterEl.value = opt.value;
                            exists = true;
                            break;
                        }
                    }
                    if (!exists) {
                        const newOpt = document.createElement('option');
                        newOpt.value = cust;
                        newOpt.innerText = cust;
                        newOpt.selected = true;
                        filterEl.appendChild(newOpt);
                    }
                    onManualFilterChange();
                }
            }
        }

        function quickCloseDossierTask(rowId) {
            fetch('/api/update-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rowId: rowId, status: 'Closed' })
            })
                .then(res => res.json())
                .then(() => {
                    const log = allReportLogs.find(l => l.rowId === rowId);
                    if (log) log.status = 'Closed';
                    applyFilters();
                    updateDashboardAnalytics();
                    if (currentDossierCustomer) {
                        openCustomerDossier(currentDossierCustomer);
                    }
                })
                .catch(err => {
                    alert('Gagal update status: ' + err.message);
                });
        }

// Ensure application is initialized once all modular scripts are evaluated
if (typeof initApp === 'function') {
    initApp();
}
