// ==========================================
// === CLIENT SLA & MONTHLY REPORT GENERATOR ===
// ==========================================

        function openClientReportModal() {
            const modal = document.getElementById('clientReportModal');
            if (!modal) return;

            // Populate Customer Select
            const custSelect = document.getElementById('slaReportCustomer');
            if (custSelect) {
                const customers = new Set();
                if (customerListCache && customerListCache.length > 0) {
                    customerListCache.forEach(c => customers.add(c));
                }
                if (allReportLogs && allReportLogs.length > 0) {
                    allReportLogs.forEach(l => { if (l.customer) customers.add(l.customer); });
                }

                custSelect.innerHTML = '<option value="All">All Active Clients (Consolidated)</option>';
                Array.from(customers).sort().forEach(c => {
                    custSelect.innerHTML += `<option value="${c}">${c}</option>`;
                });
            }

            // Set default month to current YYYY-MM
            const monthInput = document.getElementById('slaReportMonth');
            if (monthInput && !monthInput.value) {
                const now = new Date();
                const yr = now.getFullYear();
                const mo = String(now.getMonth() + 1).padStart(2, '0');
                monthInput.value = `${yr}-${mo}`;
            }

            modal.classList.add('active');
        }

        function closeClientReportModal() {
            const modal = document.getElementById('clientReportModal');
            if (modal) modal.classList.remove('active');
        }

        function generateClientSlaReport() {
            const targetCustomer = document.getElementById('slaReportCustomer').value || 'All';
            const selectedMonth = document.getElementById('slaReportMonth').value || '';
            const targetService = document.getElementById('slaReportService').value || 'All';
            const slaTarget = document.getElementById('slaReportTarget').value || '99.5%';
            const preparedBy = document.getElementById('slaReportPreparedBy').value || 'Ando Ritonga – Lead Cloud Managed Services';
            const reportTitle = document.getElementById('slaReportTitle').value || 'Monthly Managed Services Support & SLA Delivery Report';
            const customNotes = document.getElementById('slaReportNotes').value || '';

            // Filter activities
            const matchedLogs = allReportLogs.filter(log => {
                if (targetCustomer !== 'All' && log.customer !== targetCustomer) return false;
                if (selectedMonth && log.date && !log.date.startsWith(selectedMonth)) return false;
                if (targetService !== 'All' && log.services !== targetService) return false;
                return true;
            });

            if (matchedLogs.length === 0) {
                if (!confirm(`No activity records found for Customer: "${targetCustomer}" in Period: "${selectedMonth}". Do you still want to generate an empty report template?`)) {
                    return;
                }
            }

            // Calculations
            const totalCount = matchedLogs.length;
            const closedCount = matchedLogs.filter(l => l.status === 'Closed').length;
            const inProgressCount = totalCount - closedCount;
            const slaAchieved = totalCount > 0 ? ((closedCount / totalCount) * 100).toFixed(1) : "100.0";
            
            const totalMinutes = matchedLogs.reduce((sum, l) => sum + (l.durationMinutes || 0), 0);
            const totalHours = Math.floor(totalMinutes / 60);
            const remMinutes = totalMinutes % 60;
            const avgMins = totalCount > 0 ? Math.round(totalMinutes / totalCount) : 0;

            // Service Breakdown
            const serviceCounts = {};
            matchedLogs.forEach(l => {
                const s = l.services || 'General';
                serviceCounts[s] = (serviceCounts[s] || 0) + 1;
            });

            // Month text format: "2026-09" -> "September 2026"
            let monthLabel = selectedMonth;
            if (selectedMonth) {
                const [y, m] = selectedMonth.split('-');
                const dateObj = new Date(parseInt(y), parseInt(m) - 1, 1);
                monthLabel = dateObj.toLocaleString('en-US', { month: 'long', year: 'numeric' });
            }

            const docId = `XL-SLA-${(targetCustomer === 'All' ? 'ALL' : targetCustomer).replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}-${(selectedMonth || 'ALL').replace('-', '')}`;
            const todayStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

            // Table rows
            let rowsHtml = '';
            matchedLogs.forEach((l, idx) => {
                const durationText = (l.duration && l.duration !== '00:00') ? l.duration : `${Math.floor((l.durationMinutes || 0) / 60)}h ${(l.durationMinutes || 0) % 60}m`;
                const statusBadge = l.status === 'Closed' 
                    ? '<span style="display:inline-block; padding:3px 8px; border-radius:12px; background:#dcfce7; color:#15803d; font-weight:700; font-size:11px;">Closed</span>'
                    : '<span style="display:inline-block; padding:3px 8px; border-radius:12px; background:#fef3c7; color:#b45309; font-weight:700; font-size:11px;">In Progress</span>';

                const lMsig = calculateMsigTicketBurn(l);
                const lMsigBadge = lMsig.isMsig ? `<div style="font-size:10px; margin-top:3px; font-weight:700; color:${lMsig.ticketBurn > 0 ? '#1e40af' : '#64748b'};">${lMsig.ticketBurn > 0 ? `🎫 ${lMsig.ticketBurn.toFixed(1)} Tkt` : '⚪ 0 Tkt'}</div>` : '';

                rowsHtml += `
                    <tr style="background:${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                        <td style="padding:7px 10px; border:1px solid #e2e8f0; font-size:11.5px; white-space:nowrap;">${l.date || '-'}</td>
                        <td style="padding:7px 10px; border:1px solid #e2e8f0; font-size:11.5px; font-weight:600; color:#1e3a8a;">${l.services || '-'}</td>
                        <td style="padding:7px 10px; border:1px solid #e2e8f0; font-size:11.5px;">
                            ${l.category || '-'}
                            ${lMsigBadge}
                        </td>
                        <td style="padding:7px 10px; border:1px solid #e2e8f0; font-size:11.5px;">
                            <strong>${l.taskDescription || '-'}</strong>
                            ${l.project ? `<div style="font-size:10px; color:#64748b; margin-top:2px;">Project: ${l.project}</div>` : ''}
                        </td>
                        <td style="padding:7px 10px; border:1px solid #e2e8f0; font-size:11px; color:#334155;">
                            ${l.rootCause ? `<div><em>Root Cause:</em> ${l.rootCause}</div>` : ''}
                            ${l.solution ? `<div><em>Action:</em> ${l.solution}</div>` : ''}
                            ${(!l.rootCause && !l.solution) ? '-' : ''}
                        </td>
                        <td style="padding:7px 10px; border:1px solid #e2e8f0; font-size:11.5px; text-align:center; font-weight:700; color:#0f172a;">${durationText}</td>
                        <td style="padding:7px 10px; border:1px solid #e2e8f0; text-align:center;">${statusBadge}</td>
                    </tr>
                `;
            });

            // Services breakdown summary chips
            let serviceSummaryHtml = '';
            for (const [svc, count] of Object.entries(serviceCounts)) {
                serviceSummaryHtml += `
                    <div style="background:#f1f5f9; border:1px solid #cbd5e1; border-radius:6px; padding:6px 12px; font-size:12px; font-weight:600; display:inline-flex; align-items:center; gap:8px;">
                        <span>${svc}:</span> <span style="color:#0284c7; font-weight:800;">${count} tickets</span>
                    </div>
                `;
            }

            // Contract Ticket Consumption Breakdown (for MSIG & ASJ reports)
            let msigContractSummaryHtml = '';
            const contractClientsList = ['MSIG', 'ASJ'];
            contractClientsList.forEach(cName => {
                const clientLogsInReport = matchedLogs.filter(l => l.customer && l.customer.toUpperCase().includes(cName));
                if (clientLogsInReport.length > 0) {
                    let issues = 0, suppHalf = 0, suppFull = 0, suppZero = 0;
                    let totalBurn = 0.0;

                    clientLogsInReport.forEach(l => {
                        const c = calculateContractTicketBurn(l);
                        totalBurn += c.ticketBurn;
                        if (c.typeCode === 'issue') issues++;
                        else if (c.typeCode === 'support_half') suppHalf++;
                        else if (c.typeCode === 'support_full') suppFull++;
                        else suppZero++;
                    });

                    msigContractSummaryHtml += `
                        <div style="margin: 18px 0; border: 1.5px solid #2563eb; border-radius: 8px; background: #eff6ff; padding: 14px 18px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #bfdbfe; padding-bottom: 8px; margin-bottom: 12px;">
                                <div style="font-size: 13.5px; font-weight: 800; color: #1e40af;">
                                    🎫 ${cName} Managed Services Contract – Ticket Quota Consumption
                                </div>
                                <div style="font-size: 14px; font-weight: 800; color: #1e3a8a;">
                                    Total Deducted: <span style="background: #2563eb; color: #ffffff; padding: 3px 10px; border-radius: 6px;">${totalBurn.toFixed(1)} Tickets</span>
                                </div>
                            </div>
                            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; text-align: center;">
                                <div style="background: #ffffff; border: 1px solid #dbeafe; border-radius: 6px; padding: 8px;">
                                    <div style="font-size: 10.5px; color: #64748b; font-weight: 700; text-transform: uppercase;">Issues (1.0x)</div>
                                    <div style="font-size: 16px; font-weight: 800; color: #ef4444; margin-top: 2px;">${issues} <small style="font-size: 11px; font-weight: 600; color: #64748b;">(${issues * 1.0} tkts)</small></div>
                                </div>
                                <div style="background: #ffffff; border: 1px solid #dbeafe; border-radius: 6px; padding: 8px;">
                                    <div style="font-size: 10.5px; color: #64748b; font-weight: 700; text-transform: uppercase;">Support ≤ 4h (0.5x)</div>
                                    <div style="font-size: 16px; font-weight: 800; color: #0284c7; margin-top: 2px;">${suppHalf} <small style="font-size: 11px; font-weight: 600; color: #64748b;">(${(suppHalf * 0.5).toFixed(1)} tkts)</small></div>
                                </div>
                                <div style="background: #ffffff; border: 1px solid #dbeafe; border-radius: 6px; padding: 8px;">
                                    <div style="font-size: 10.5px; color: #64748b; font-weight: 700; text-transform: uppercase;">Support > 4h (1.0x)</div>
                                    <div style="font-size: 16px; font-weight: 800; color: #6366f1; margin-top: 2px;">${suppFull} <small style="font-size: 11px; font-weight: 600; color: #64748b;">(${suppFull * 1.0} tkts)</small></div>
                                </div>
                                <div style="background: #ffffff; border: 1px solid #dbeafe; border-radius: 6px; padding: 8px;">
                                    <div style="font-size: 10.5px; color: #64748b; font-weight: 700; text-transform: uppercase;">Non-Changes (0x)</div>
                                    <div style="font-size: 16px; font-weight: 800; color: #10b981; margin-top: 2px;">${suppZero} <small style="font-size: 11px; font-weight: 600; color: #64748b;">(Free)</small></div>
                                </div>
                            </div>
                            <div style="margin-top: 8px; font-size: 10.5px; color: #3b82f6; font-style: italic;">
                                * ${cName} Contract Rules: Issues are charged 1.0 ticket flat. Support involving Changes/CR is charged 0.5 ticket (effort ≤ 4h) or 1.0 ticket (effort > 4h). General inquiries/guidance without changes are not charged against ticket quota.
                            </div>
                        </div>
                    `;
                }
            });

            const printWindow = window.open('', '_blank');
            printWindow.document.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>${reportTitle} - ${targetCustomer}</title>
                    <style>
                        @page {
                            size: A4;
                            margin: 15mm 12mm 15mm 12mm;
                        }
                        body {
                            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                            color: #0f172a;
                            margin: 0;
                            padding: 24px;
                            background: #ffffff;
                            font-size: 12px;
                            line-height: 1.5;
                        }
                        .report-header {
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            border-bottom: 3px solid #2434a4;
                            padding-bottom: 16px;
                            margin-bottom: 20px;
                        }
                        .report-title-box h1 {
                            margin: 0;
                            font-size: 18px;
                            color: #2434a4;
                            font-weight: 800;
                            text-transform: uppercase;
                            letter-spacing: 0.5px;
                        }
                        .report-title-box p {
                            margin: 4px 0 0;
                            color: #64748b;
                            font-size: 12px;
                            font-weight: 600;
                        }
                        .meta-grid {
                            display: grid;
                            grid-template-columns: repeat(4, 1fr);
                            gap: 10px;
                            background: #f8fafc;
                            border: 1px solid #e2e8f0;
                            border-radius: 8px;
                            padding: 12px 16px;
                            margin-bottom: 20px;
                        }
                        .meta-item strong {
                            display: block;
                            font-size: 10px;
                            text-transform: uppercase;
                            color: #64748b;
                            margin-bottom: 2px;
                        }
                        .meta-item span {
                            font-size: 13px;
                            font-weight: 700;
                            color: #0f172a;
                        }
                        .kpi-row {
                            display: grid;
                            grid-template-columns: repeat(4, 1fr);
                            gap: 12px;
                            margin-bottom: 20px;
                        }
                        .kpi-card {
                            border: 1px solid #e2e8f0;
                            border-radius: 8px;
                            padding: 12px 14px;
                            text-align: center;
                            background: #ffffff;
                            box-shadow: 0 1px 3px rgba(0,0,0,0.04);
                        }
                        .kpi-label {
                            font-size: 10.5px;
                            color: #64748b;
                            font-weight: 700;
                            text-transform: uppercase;
                            margin-bottom: 4px;
                        }
                        .kpi-val {
                            font-size: 20px;
                            font-weight: 800;
                            color: #2434a4;
                        }
                        .kpi-val.success {
                            color: #16a34a;
                        }
                        .kpi-sub {
                            font-size: 10.5px;
                            color: #64748b;
                            margin-top: 2px;
                        }
                        table {
                            width: 100%;
                            border-collapse: collapse;
                            margin-top: 14px;
                            page-break-inside: auto;
                        }
                        tr {
                            page-break-inside: avoid;
                            page-break-after: auto;
                        }
                        th {
                            background: #1e3a8a;
                            color: #ffffff;
                            font-size: 11px;
                            font-weight: 700;
                            padding: 8px 10px;
                            text-align: left;
                            border: 1px solid #1e3a8a;
                        }
                        .sign-block {
                            margin-top: 36px;
                            display: grid;
                            grid-template-columns: 1fr 1fr;
                            gap: 40px;
                            page-break-inside: avoid;
                        }
                        .sign-card {
                            border-top: 1px solid #cbd5e1;
                            padding-top: 12px;
                            text-align: center;
                        }
                        .sign-space {
                            height: 65px;
                        }
                        .notes-box {
                            background: #eff6ff;
                            border-left: 4px solid #0284c7;
                            padding: 10px 14px;
                            border-radius: 0 6px 6px 0;
                            margin-bottom: 20px;
                            font-size: 12px;
                            color: #1e293b;
                        }
                        @media print {
                            body { padding: 0; }
                            .no-print { display: none; }
                            button { display: none; }
                        }
                    </style>
                </head>
                <body>
                    <div class="no-print" style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; background: #e0f2fe; padding: 10px 16px; border-radius: 8px;">
                        <span style="font-weight: 600; color: #0369a1;">📄 Preview Mode: Ready for printing or saving to PDF.</span>
                        <button onclick="window.print()" style="background:#0284c7; color:#fff; border:none; padding:8px 18px; border-radius:6px; font-weight:700; cursor:pointer;">🖨️ Print / Save PDF</button>
                    </div>

                    <div class="report-header">
                        <div style="display: flex; align-items: center; gap: 16px;">
                            <img src="/static/logo.png" alt="Cloud Operations" style="height: 48px; max-width: 170px; object-fit: contain;" />
                            <div class="report-title-box">
                                <h1>${reportTitle}</h1>
                                <p>Cloud Operations Managed Services</p>
                            </div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-weight: 800; color: #2434a4; font-size: 13px;">${docId}</div>
                            <div style="color: #64748b; font-size: 11px; margin-top: 2px;">Issued: ${todayStr}</div>
                        </div>
                    </div>

                    <div class="meta-grid">
                        <div class="meta-item">
                            <strong>Client Organization</strong>
                            <span>${targetCustomer === 'All' ? 'All Managed Accounts' : targetCustomer}</span>
                        </div>
                        <div class="meta-item">
                            <strong>Reporting Period</strong>
                            <span>${monthLabel}</span>
                        </div>
                        <div class="meta-item">
                            <strong>SLA Commitment</strong>
                            <span style="color: #16a34a;">${slaTarget}</span>
                        </div>
                        <div class="meta-item">
                            <strong>Lead Specialist</strong>
                            <span>${preparedBy.split('–')[0].split('-')[0].trim()}</span>
                        </div>
                    </div>

                    ${customNotes ? `
                        <div class="notes-box">
                            <strong style="display:block; margin-bottom:3px; color:#0369a1; text-transform:uppercase; font-size:10px;">Executive Scope & Operations Note:</strong>
                            ${customNotes}
                        </div>
                    ` : ''}

                    <div class="kpi-row">
                        <div class="kpi-card">
                            <div class="kpi-label">Support Hours Rendered</div>
                            <div class="kpi-val">${totalHours}h ${remMinutes}m</div>
                            <div class="kpi-sub">Total Duration Logged</div>
                        </div>
                        <div class="kpi-card">
                            <div class="kpi-label">SLA Resolution Rate</div>
                            <div class="kpi-val success">${slaAchieved}%</div>
                            <div class="kpi-sub">Target: ${slaTarget}</div>
                        </div>
                        <div class="kpi-card">
                            <div class="kpi-label">Tasks / Incidents</div>
                            <div class="kpi-val">${totalCount}</div>
                            <div class="kpi-sub">${closedCount} Closed &bull; ${inProgressCount} In Progress</div>
                        </div>
                        <div class="kpi-card">
                            <div class="kpi-label">Avg. Task Duration</div>
                            <div class="kpi-val">${avgMins}m</div>
                            <div class="kpi-sub">Per Ticket Turnaround</div>
                        </div>
                    </div>

                    ${serviceSummaryHtml ? `
                        <div style="margin-bottom: 14px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <span style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Platform Workload:</span>
                            ${serviceSummaryHtml}
                        </div>
                    ` : ''}

                    ${msigContractSummaryHtml}

                    <div style="margin-top: 18px;">
                        <h3 style="margin: 0 0 6px 0; font-size: 13px; color: #1e3a8a; text-transform: uppercase; letter-spacing: 0.5px;">
                            Detailed Activity & Task Log (${totalCount} Records)
                        </h3>
                        <table>
                            <thead>
                                <tr>
                                    <th style="width: 75px;">Date</th>
                                    <th style="width: 90px;">Service</th>
                                    <th style="width: 75px;">Category</th>
                                    <th>Task Description & Context</th>
                                    <th>Root Cause & Remediation</th>
                                    <th style="width: 65px; text-align: center;">Duration</th>
                                    <th style="width: 75px; text-align: center;">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rowsHtml || '<tr><td colspan="7" style="text-align:center; padding:20px; color:#64748b;">No activity logs for this selection.</td></tr>'}
                            </tbody>
                        </table>
                    </div>

                    <div class="sign-block">
                        <div class="sign-card">
                            <div style="font-weight: 700; color: #1e3a8a;">Delivered & Verified By:</div>
                            <div style="font-size: 11px; color: #64748b;">Managed Services Support</div>
                            <div class="sign-space"></div>
                            <div style="font-weight: 700; font-size: 12px; border-bottom: 1px solid #94a3b8; display: inline-block; min-width: 180px; padding-bottom: 2px;">
                                ${preparedBy}
                            </div>
                            <div style="font-size: 10.5px; color: #64748b; margin-top: 4px;">Cloud Managed Services Division</div>
                        </div>
                        <div class="sign-card">
                            <div style="font-weight: 700; color: #1e3a8a;">Acknowledged & Accepted By:</div>
                            <div style="font-size: 11px; color: #64748b;">${targetCustomer === 'All' ? 'Client Organization' : targetCustomer}</div>
                            <div class="sign-space"></div>
                            <div style="font-weight: 700; font-size: 12px; border-bottom: 1px solid #94a3b8; display: inline-block; min-width: 180px; padding-bottom: 2px;">
                                Representative Signature
                            </div>
                            <div style="font-size: 10.5px; color: #64748b; margin-top: 4px;">Date: ____ / ____ / 2026</div>
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
