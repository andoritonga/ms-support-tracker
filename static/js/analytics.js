// ==========================================
// === ANALYTICS & EXECUTIVE REPORTING ===
// ==========================================

let customerChartInstance = null;
let serviceChartInstance = null;
let categoryChartInstance = null;
let trendChartInstance = null;
let trendRangeMode = (typeof window !== 'undefined' && window.innerWidth <= 768) ? '7d' : 'full';

        function toggleDashActionsMenu(e) {
            if (e) e.stopPropagation();
            const menu = document.getElementById('dashMobileActionsMenu');
            const chevron = document.getElementById('dashMobileChevron');
            if (!menu) return;
            const isOpen = menu.classList.toggle('open');
            if (chevron) chevron.style.transform = isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
        }

        function closeDashActionsMenu() {
            const menu = document.getElementById('dashMobileActionsMenu');
            const chevron = document.getElementById('dashMobileChevron');
            if (menu) menu.classList.remove('open');
            if (chevron) chevron.style.transform = 'rotate(0deg)';
        }

        document.addEventListener('click', (e) => {
            const menu = document.getElementById('dashMobileActionsMenu');
            const btn = document.getElementById('dashMobileActionsBtn');
            if (menu && menu.classList.contains('open')) {
                if (!menu.contains(e.target) && (!btn || !btn.contains(e.target))) {
                    closeDashActionsMenu();
                }
            }
        });

        function setTrendRangeMode(mode) {
            trendRangeMode = mode;
            const b7 = document.getElementById('btnTrend7d');
            const b14 = document.getElementById('btnTrend14d');
            const bFull = document.getElementById('btnTrendFull');
            if (b7) b7.classList.toggle('active', mode === '7d');
            if (b14) b14.classList.toggle('active', mode === '14d');
            if (bFull) bFull.classList.toggle('active', mode === 'full');
            renderAnalyticsCharts(getDashboardFilteredLogs());
        }

        function syncTrendToggleButtons() {
            const b7 = document.getElementById('btnTrend7d');
            const b14 = document.getElementById('btnTrend14d');
            const bFull = document.getElementById('btnTrendFull');
            if (b7) b7.classList.toggle('active', trendRangeMode === '7d');
            if (b14) b14.classList.toggle('active', trendRangeMode === '14d');
            if (bFull) bFull.classList.toggle('active', trendRangeMode === 'full');
        }

        // === EXCEL EXPORT LOGIC ===
        function exportToExcel(records, sheetTitle, filePrefix) {
            if (!records || records.length === 0) {
                alert("No activity records available to export.");
                return;
            }

            const excelData = records.map((log, idx) => ({
                "No": idx + 1,
                "Customer": sanitizeSpreadsheetCell(log.customer || ""),
                "Date": sanitizeSpreadsheetCell(log.date || ""),
                "Raised By": sanitizeSpreadsheetCell(log.raisedBy || ""),
                "Services": sanitizeSpreadsheetCell(log.services || ""),
                "Category": sanitizeSpreadsheetCell(log.category || ""),
                "Project": sanitizeSpreadsheetCell(log.project || ""),
                "Task Description": sanitizeSpreadsheetCell(log.taskDescription || ""),
                "Root Cause": sanitizeSpreadsheetCell(log.rootCause || ""),
                "Solution": sanitizeSpreadsheetCell(log.solution || ""),
                "Clock In": sanitizeSpreadsheetCell(log.clockIn || ""),
                "Clock Out": sanitizeSpreadsheetCell(log.clockOut || ""),
                "Duration": sanitizeSpreadsheetCell(log.duration || "00:00"),
                "Duration (Minutes)": log.durationMinutes || 0,
                "Status": sanitizeSpreadsheetCell(log.status || "In Progress"),
                "Remarks": sanitizeSpreadsheetCell(log.remarks || ""),
                "Ticket Deduction": log.ticketDeduction !== undefined && log.ticketDeduction !== null ? log.ticketDeduction : 0.0
            }));

            const ws = XLSX.utils.json_to_sheet(excelData);

            ws['!cols'] = [
                { wch: 6 },
                { wch: 18 },
                { wch: 13 },
                { wch: 18 },
                { wch: 16 },
                { wch: 12 },
                { wch: 22 },
                { wch: 45 },
                { wch: 35 },
                { wch: 35 },
                { wch: 18 },
                { wch: 18 },
                { wch: 12 },
                { wch: 16 },
                { wch: 14 },
                { wch: 28 },
                { wch: 16 }
            ];

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, sheetTitle || "Activities");

            const todayStr = new Date().toISOString().split('T')[0];
            const filename = `${filePrefix || 'MS_Activities'}_${todayStr}.xlsx`;
            XLSX.writeFile(wb, filename);
        }

        function exportTableExcel() {
            const listToExport = (filteredLogs && filteredLogs.length > 0) ? filteredLogs : allReportLogs;
            exportToExcel(listToExport, "Activity Report", "MS_Activity_Report");
        }

        function exportDashboardExcel() {
            const dashLogs = getDashboardFilteredLogs();
            exportToExcel(dashLogs, "Dashboard Analytics", "MS_Dashboard_Activities");
        }



        // DASHBOARD DATE FILTERING LOGIC
        function getDashboardFilteredLogs() {
            const sDate = document.getElementById('dashStartDate').value;
            const eDate = document.getElementById('dashEndDate').value;

            return allReportLogs.filter(log => {
                let match = true;
                if (sDate && log.date) match = match && (log.date >= sDate);
                if (eDate && log.date) match = match && (log.date <= eDate);
                return match;
            });
        }

        function resetDashboardFilter() {
            document.getElementById('dashStartDate').value = '';
            document.getElementById('dashEndDate').value = '';
            updateDashboardAnalytics();
        }

        function updateDashboardAnalytics() {
            const logs = getDashboardFilteredLogs();

            const totalMinutes = logs.reduce((sum, log) => sum + (log.durationMinutes || 0), 0);
            const totalHours = Math.floor(totalMinutes / 60);
            const remMins = totalMinutes % 60;

            document.getElementById('statTotal').innerText = logs.length;
            document.getElementById('statHours').innerText = `${totalHours}h ${remMins}m`;
            document.getElementById('statInProgress').innerText = logs.filter(l => l.status === 'In Progress').length;
            document.getElementById('statClosed').innerText = logs.filter(l => l.status === 'Closed').length;

            if (typeof updateMsigQuotaCard === 'function') {
                try {
                    updateMsigQuotaCard(logs);
                } catch (err) {
                    console.error("Error updating contract quota card:", err);
                }
            }

            try {
                renderAnalyticsCharts(logs);
            } catch (err) {
                console.error("Error rendering analytics charts:", err);
            }
        }



        // EXECUTIVE SUMMARY PRINT / PDF GENERATOR
        function generateExecutiveSummary() {
            const logs = getDashboardFilteredLogs();
            const sDate = document.getElementById('dashStartDate').value ? formatDateFormatted(document.getElementById('dashStartDate').value) : 'All Time';
            const eDate = document.getElementById('dashEndDate').value ? formatDateFormatted(document.getElementById('dashEndDate').value) : 'Present';

            const totalLogs = logs.length;
            const totalMins = logs.reduce((sum, log) => sum + (log.durationMinutes || 0), 0);
            const hours = Math.floor(totalMins / 60);
            const mins = totalMins % 60;
            const avgMins = totalLogs > 0 ? Math.round(totalMins / totalLogs) : 0;
            const avgHours = Math.floor(avgMins / 60);
            const avgRemMins = avgMins % 60;

            const inProgress = logs.filter(l => l.status === 'In Progress').length;
            const closed = logs.filter(l => l.status === 'Closed').length;

            const custSummary = {};
            logs.forEach(l => {
                if (!l.customer) return;
                if (!custSummary[l.customer]) custSummary[l.customer] = { count: 0, mins: 0 };
                custSummary[l.customer].count += 1;
                custSummary[l.customer].mins += (l.durationMinutes || 0);
            });

            let topCustomer = '-';
            let maxCustMins = 0;
            for (const [cust, val] of Object.entries(custSummary)) {
                if (val.mins > maxCustMins) {
                    maxCustMins = val.mins;
                    topCustomer = cust;
                }
            }

            const serviceSummary = {};
            logs.forEach(l => {
                if (!l.services) return;
                serviceSummary[l.services] = (serviceSummary[l.services] || 0) + 1;
            });

            const catSummary = {};
            logs.forEach(l => {
                if (!l.category) return;
                catSummary[l.category] = (catSummary[l.category] || 0) + 1;
            });

            let custHtml = '';
            for (const [cust, val] of Object.entries(custSummary)) {
                const cH = Math.floor(val.mins / 60);
                const cM = val.mins % 60;
                const pct = totalMins > 0 ? ((val.mins / totalMins) * 100).toFixed(1) : 0;
                custHtml += `
          <tr>
            <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0; font-weight:600;">${escapeHtml(cust)}</td>
            <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0; text-align:center;">${val.count}</td>
            <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0; text-align:center; font-weight:700; color:#2434a4;">${cH}h ${cM}m</td>
            <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0; text-align:center;">${pct}%</td>
          </tr>`;
            }

            let taskHtml = '';
            logs.forEach(l => {
                const statusBg = l.status === 'Closed' ? '#f0fdf4' : '#fffbeb';
                const statusColor = l.status === 'Closed' ? '#15803d' : '#b45309';
                taskHtml += `<tr>
          <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0; white-space:nowrap;">${escapeHtml(formatDateFormatted(l.date))}</td>
          <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0; font-weight:600;">${escapeHtml(l.customer || '-')}</td>
          <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0;">${escapeHtml(l.raisedBy || '-')}</td>
          <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0;">${escapeHtml(l.services || '-')}</td>
          <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0;">${escapeHtml(l.category || '-')}</td>
          <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0;">${escapeHtml(l.taskDescription || '-')}</td>
          <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0; text-align:center; font-weight:700;">${escapeHtml(l.duration || '00:00')}</td>
          <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0; text-align:center;">
            <span style="background:${statusBg}; color:${statusColor}; padding:3px 8px; border-radius:99px; font-size:10px; font-weight:700;">${escapeHtml(l.status || '-')}</span>
          </td>
        </tr>`;
            });

            // 1. Customer Chart
            const printCustCanvas = document.createElement('canvas');
            printCustCanvas.width = 1200;
            printCustCanvas.height = 600;
            new Chart(printCustCanvas.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: Object.keys(custSummary),
                    datasets: [{
                        label: 'Hours Spent',
                        data: Object.values(custSummary).map(v => (v.mins / 60).toFixed(1)),
                        backgroundColor: '#4f46e5',
                        borderRadius: 6
                    }]
                },
                options: {
                    animation: false,
                    responsive: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { color: '#0f172a', font: { size: 14, weight: 'bold' } }, grid: { display: false } },
                        y: { beginAtZero: true, ticks: { color: '#0f172a', font: { size: 14 } }, grid: { color: '#e2e8f0' } }
                    }
                }
            });

            // 2. Service Chart
            const printSvcCanvas = document.createElement('canvas');
            printSvcCanvas.width = 800;
            printSvcCanvas.height = 600;
            new Chart(printSvcCanvas.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: Object.keys(serviceSummary),
                    datasets: [{
                        label: 'Total Logs',
                        data: Object.values(serviceSummary),
                        backgroundColor: '#0284c7',
                        borderRadius: 6
                    }]
                },
                options: {
                    animation: false,
                    responsive: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { color: '#0f172a', font: { size: 14, weight: 'bold' } }, grid: { display: false } },
                        y: { beginAtZero: true, ticks: { color: '#0f172a', font: { size: 14 }, stepSize: 1 }, grid: { color: '#e2e8f0' } }
                    }
                }
            });

            // 3. Category Chart
            const printCatCanvas = document.createElement('canvas');
            printCatCanvas.width = 800;
            printCatCanvas.height = 600;
            new Chart(printCatCanvas.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: Object.keys(catSummary),
                    datasets: [{
                        data: Object.values(catSummary),
                        backgroundColor: ['#ff2d8f', '#4f46e5', '#38bdf8', '#fbbf24']
                    }]
                },
                options: {
                    animation: false,
                    responsive: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { color: '#0f172a', font: { size: 14, weight: 'bold' } } }
                    }
                }
            });

            const custChartImg = printCustCanvas.toDataURL('image/png');
            const svcChartImg = printSvcCanvas.toDataURL('image/png');
            const catChartImg = printCatCanvas.toDataURL('image/png');

            const printWin = window.open('', '_blank');
            printWin.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Executive Summary Report - Cloud Operations</title>
          <style>
            @page { size: A4 landscape; margin: 10mm 12mm; }
            body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color: #0f172a; line-height: 1.4; margin: 0; padding: 15px; background: #ffffff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .report-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #2434a4; padding-bottom: 14px; margin-bottom: 18px; }
            .logo-title { font-size: 22px; font-weight: 800; color: #2434a4; letter-spacing: -0.02em; }
            .logo-sub { font-size: 11px; color: #64748b; font-weight: 700; text-transform: uppercase; }
            .report-meta { text-align: right; font-size: 11px; color: #475569; }
            
            .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
            .kpi-card { border: 1px solid #cbd5e1; border-radius: 10px; padding: 12px; text-align: center; background: #f8fafc; }
            .kpi-label { font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
            .kpi-num { font-size: 20px; font-weight: 800; color: #2434a4; margin-top: 3px; }

            .highlight-box { background: #f0f7ff; border-left: 4px solid #0284c7; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; font-size: 11px; }
            .highlight-box ul { margin: 4px 0 0 16px; padding: 0; }

            .charts-row-top { margin-bottom: 16px; page-break-inside: avoid; }
            .charts-row-bottom { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 24px; page-break-inside: avoid; }
            .chart-box { border: 1px solid #cbd5e1; border-radius: 10px; padding: 12px; text-align: center; background: #ffffff; }
            .chart-box h4 { margin: 0 0 8px 0; font-size: 11px; color: #0f172a; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; }
            .chart-box img { width: 100%; height: auto; max-height: 200px; object-fit: contain; }

            h3 { font-size: 12px; color: #0f172a; margin: 20px 0 10px 0; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #e2e8f0; padding-bottom: 4px; }
            table { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-bottom: 20px; }
            th { background: #f1f5f9; padding: 8px 10px; border-bottom: 2px solid #cbd5e1; text-align: left; text-transform: uppercase; font-size: 9.5px; color: #334155; font-weight: 700; }
            tr { page-break-inside: avoid; }
          </style>
        </head>
        <body>
          <div class="report-header">
            <div>
              <div class="logo-title">Cloud Operations</div>
              <div class="logo-sub">Managed Service Executive Support Summary</div>
            </div>
            <div class="report-meta">
              <strong>Reporting Period:</strong> ${escapeHtml(sDate)} – ${escapeHtml(eDate)}<br/>
              <strong>Generated Date:</strong> ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
          </div>

          <div class="kpi-grid">
            <div class="kpi-card">
              <div class="kpi-label">Total Activities</div>
              <div class="kpi-num">${totalLogs}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Total Support Time</div>
              <div class="kpi-num" style="color: #ff2d8f;">${hours}h ${mins}m</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Avg. Handle Time</div>
              <div class="kpi-num" style="color: #0284c7;">${avgHours > 0 ? avgHours + 'h ' : ''}${avgRemMins}m</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Closed Rate</div>
              <div class="kpi-num" style="color: #15803d;">${totalLogs > 0 ? ((closed / totalLogs) * 100).toFixed(0) : 0}%</div>
            </div>
          </div>

          <div class="highlight-box">
            <strong style="font-size:12px; color:#0369a1;">📌 Key Operational Insights:</strong>
            <ul>
              <li><strong>Highest Service Demand:</strong> <strong>${escapeHtml(topCustomer)}</strong> generated the highest support volume, accounting for <strong>${totalMins > 0 ? ((maxCustMins / totalMins) * 100).toFixed(1) : 0}%</strong> of total support hours.</li>
              <li><strong>Resolution Status:</strong> <strong>${closed}</strong> activity logs have been successfully closed, while <strong>${inProgress}</strong> tasks remain in progress.</li>
              <li><strong>Average Resolution:</strong> Tasks require an average handling time of <strong>${avgHours > 0 ? avgHours + 'h ' : ''}${avgRemMins} minutes</strong>.</li>
            </ul>
          </div>

          <div class="charts-row-top">
            <div class="chart-box">
              <h4>Support Hours Distribution by Customer</h4>
              <img src="${custChartImg}" />
            </div>
          </div>

          <div class="charts-row-bottom">
            <div class="chart-box">
              <h4>Logs Breakdown by Service</h4>
              <img src="${svcChartImg}" />
            </div>
            <div class="chart-box">
              <h4>Category Breakdown</h4>
              <img src="${catChartImg}" />
            </div>
          </div>

          <h3>Support Workload Summary by Customer</h3>
          <table>
            <thead>
              <tr>
                <th>Customer Name</th>
                <th style="text-align:center;">Total Tasks</th>
                <th style="text-align:center;">Spent Duration</th>
                <th style="text-align:center;">Workload Share (%)</th>
              </tr>
            </thead>
            <tbody>${custHtml || '<tr><td colspan="4" style="text-align:center; padding:10px;">No activity data recorded</td></tr>'}</tbody>
          </table>

          <h3>Activity Logs Breakdown (${totalLogs} Total Records)</h3>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Customer</th>
                <th>Raised By</th>
                <th>Services</th>
                <th>Category</th>
                <th>Task Description</th>
                <th style="text-align:center;">Duration</th>
                <th style="text-align:center;">Status</th>
              </tr>
            </thead>
            <tbody>${taskHtml || '<tr><td colspan="8" style="text-align:center; padding:10px;">No activity data recorded</td></tr>'}</tbody>
          </table>

          <script>
            window.onload = function() {
              setTimeout(function() { window.print(); }, 400);
            }
          <\/script>
        </body>
        </html>
      `);
            printWin.document.close();
        }


        // Render Chart.js Analytics
        let _chartJsFallbackLoading = false;
        function ensureChartJsLoaded(onReady) {
            if (typeof Chart !== 'undefined') {
                onReady();
                return;
            }
            if (_chartJsFallbackLoading) return;
            _chartJsFallbackLoading = true;
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
            script.crossOrigin = 'anonymous';
            script.onload = () => {
                _chartJsFallbackLoading = false;
                if (typeof Chart !== 'undefined') onReady();
            };
            script.onerror = () => {
                _chartJsFallbackLoading = false;
                console.error('Failed to load Chart.js from CDN.');
            };
            document.head.appendChild(script);
        }

        function renderCustomerLeaderboardMobile(customerStatsList, totalMinutesAll) {
            const container = document.getElementById('customerLeaderboardMobile');
            const badge = document.getElementById('customerTotalBadge');
            if (badge) {
                badge.innerText = `${customerStatsList.length} ${customerStatsList.length === 1 ? 'Customer' : 'Customers'}`;
            }
            if (!container) return;

            if (!customerStatsList || customerStatsList.length === 0) {
                container.innerHTML = `<div class="cust-lb-empty">No customer activity in selected period</div>`;
                return;
            }

            const maxMins = Math.max(...customerStatsList.map(c => c.mins), 1);
            const gradients = [
                'linear-gradient(90deg, #6366f1, #8b5cf6)',
                'linear-gradient(90deg, #ff2d8f, #f43f5e)',
                'linear-gradient(90deg, #06b6d4, #3b82f6)',
                'linear-gradient(90deg, #10b981, #14b8a6)',
                'linear-gradient(90deg, #f59e0b, #eab308)'
            ];

            container.innerHTML = customerStatsList.map((item, idx) => {
                const hrs = Math.floor(item.mins / 60);
                const remM = item.mins % 60;
                const durationLabel = hrs > 0 ? `${hrs}h ${remM}m` : `${remM}m`;
                const sharePct = totalMinutesAll > 0 ? ((item.mins / totalMinutesAll) * 100).toFixed(1) : '0.0';
                const barWidth = Math.max((item.mins / maxMins) * 100, 6).toFixed(1);
                const grad = gradients[idx % gradients.length];
                const rankBadge = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
                const safeCustJs = escapeJsString(item.customer);

                return `
                    <div class="cust-lb-item" onclick="if(typeof openCustomerDossier==='function') openCustomerDossier('${safeCustJs}')">
                        <div class="cust-lb-top">
                            <div class="cust-lb-name-wrap">
                                <span class="cust-lb-rank">${rankBadge}</span>
                                <span class="cust-lb-name">${escapeHtml(item.customer)}</span>
                                <span class="cust-lb-logs-pill">${item.count} ${item.count === 1 ? 'log' : 'logs'}</span>
                            </div>
                            <div class="cust-lb-metrics">
                                <span class="cust-lb-hours">${durationLabel}</span>
                                <span class="cust-lb-pct">${sharePct}%</span>
                            </div>
                        </div>
                        <div class="cust-lb-bar-bg">
                            <div class="cust-lb-bar-fill" style="width: ${barWidth}%; background: ${grad};"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function renderAnalyticsCharts(logsToRender) {
            const logs = logsToRender || allReportLogs;
            if (!logs) return;

            syncTrendToggleButtons();

            // 1. Hours & Logs per Customer (Sorted Highest to Lowest)
            const customerStatsMap = {};
            let totalCustMinutes = 0;
            logs.forEach(log => {
                if (log.customer) {
                    const mins = log.durationMinutes || 0;
                    totalCustMinutes += mins;
                    if (!customerStatsMap[log.customer]) {
                        customerStatsMap[log.customer] = { customer: log.customer, mins: 0, count: 0 };
                    }
                    customerStatsMap[log.customer].mins += mins;
                    customerStatsMap[log.customer].count += 1;
                }
            });

            const sortedCustomers = Object.values(customerStatsMap).sort((a, b) => b.mins - a.mins);

            // Always update Mobile Native Leaderboard (works even before Chart.js finishes loading)
            renderCustomerLeaderboardMobile(sortedCustomers, totalCustMinutes);

            if (typeof Chart === 'undefined') {
                ensureChartJsLoaded(() => {
                    renderAnalyticsCharts(getDashboardFilteredLogs());
                });
                return;
            }

            const isDark = document.body.getAttribute('data-theme') === 'dark';
            const textColor = isDark ? '#f8fafc' : '#0f172a';
            const isMobileView = window.innerWidth <= 768;

            if (customerChartInstance) customerChartInstance.destroy();
            customerChartInstance = new Chart(document.getElementById('customerChart').getContext('2d'), {
                type: 'bar',
                data: {
                    labels: sortedCustomers.map(c => c.customer),
                    datasets: [{
                        label: 'Hours Spent',
                        data: sortedCustomers.map(c => (c.mins / 60).toFixed(1)),
                        backgroundColor: '#6366f1',
                        borderRadius: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { color: textColor } },
                        y: { beginAtZero: true, ticks: { color: textColor } }
                    }
                }
            });

            // 2. Logs Breakdown by Service
            const serviceMap = {};
            logs.forEach(log => {
                if (log.services) serviceMap[log.services] = (serviceMap[log.services] || 0) + 1;
            });

            if (serviceChartInstance) serviceChartInstance.destroy();
            serviceChartInstance = new Chart(document.getElementById('serviceChart').getContext('2d'), {
                type: 'bar',
                data: {
                    labels: Object.keys(serviceMap),
                    datasets: [{
                        label: 'Total Logs',
                        data: Object.values(serviceMap),
                        backgroundColor: '#38bdf8',
                        borderRadius: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { color: textColor } },
                        y: { beginAtZero: true, ticks: { color: textColor, stepSize: 1 } }
                    }
                }
            });

            // 3. Category Breakdown
            const categoryMap = {};
            logs.forEach(log => {
                if (log.category) categoryMap[log.category] = (categoryMap[log.category] || 0) + 1;
            });

            if (categoryChartInstance) categoryChartInstance.destroy();
            categoryChartInstance = new Chart(document.getElementById('categoryChart').getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: Object.keys(categoryMap),
                    datasets: [{
                        data: Object.values(categoryMap),
                        backgroundColor: ['#ff2d8f', '#6366f1', '#38bdf8', '#fbbf24']
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom', labels: { color: textColor } } }
                }
            });

            // 4. Daily Activity Trend (Supports 7D, 14D, and Full Month)
            const sDateInp = document.getElementById('dashStartDate').value;
            const eDateInp = document.getElementById('dashEndDate').value;
            const refDate = sDateInp ? new Date(sDateInp) : new Date();

            const currentYear = refDate.getFullYear();
            const currentMonth = refDate.getMonth();

            const prevMonthDate = new Date(currentYear, currentMonth - 1, 1);
            const prevYear = prevMonthDate.getFullYear();
            const prevMonth = prevMonthDate.getMonth();

            const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
            const fullDayLabels = Array.from({ length: daysInMonth }, (_, i) => isMobileView ? `${i + 1}` : `Day ${i + 1}`);

            const currentMonthData = new Array(daysInMonth).fill(0);
            const prevMonthData = new Array(daysInMonth).fill(0);

            allReportLogs.forEach(log => {
                if (!log.date) return;
                const d = new Date(log.date);
                const lYear = d.getFullYear();
                const lMonth = d.getMonth();
                const lDay = d.getDate();

                if (lYear === currentYear && lMonth === currentMonth) {
                    if (lDay <= daysInMonth) currentMonthData[lDay - 1] += 1;
                } else if (lYear === prevYear && lMonth === prevMonth) {
                    if (lDay <= daysInMonth) prevMonthData[lDay - 1] += 1;
                }
            });

            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const currentLabel = `${monthNames[currentMonth]} ${currentYear}`;
            const prevLabel = `${monthNames[prevMonth]} ${prevYear}`;

            // Determine anchor day for 7D / 14D window
            const now = new Date();
            let endDayIdx = daysInMonth;
            if (eDateInp) {
                const ed = new Date(eDateInp);
                if (ed.getFullYear() === currentYear && ed.getMonth() === currentMonth) {
                    endDayIdx = ed.getDate();
                }
            } else if (now.getFullYear() === currentYear && now.getMonth() === currentMonth) {
                endDayIdx = now.getDate();
            } else {
                // Find last day with activity in currentMonthData, fallback to daysInMonth
                for (let i = daysInMonth - 1; i >= 0; i--) {
                    if (currentMonthData[i] > 0) {
                        endDayIdx = i + 1;
                        break;
                    }
                }
            }

            let startIdx = 0;
            let endIdx = daysInMonth;
            if (trendRangeMode === '7d') {
                endIdx = Math.min(Math.max(endDayIdx, 7), daysInMonth);
                startIdx = Math.max(0, endIdx - 7);
            } else if (trendRangeMode === '14d') {
                endIdx = Math.min(Math.max(endDayIdx, 14), daysInMonth);
                startIdx = Math.max(0, endIdx - 14);
            }

            const slicedLabels = (trendRangeMode === 'full')
                ? fullDayLabels
                : Array.from({ length: endIdx - startIdx }, (_, i) => `${startIdx + i + 1} ${monthNames[currentMonth]}`);
            const slicedCurrentData = currentMonthData.slice(startIdx, endIdx);
            const slicedPrevData = prevMonthData.slice(startIdx, endIdx);

            document.getElementById('trendChartTitle').innerText = `Daily Activity Trend (${currentLabel} vs ${prevLabel})`;

            if (trendChartInstance) trendChartInstance.destroy();
            trendChartInstance = new Chart(document.getElementById('trendChart').getContext('2d'), {
                type: 'line',
                data: {
                    labels: slicedLabels,
                    datasets: [
                        {
                            label: `${currentLabel}`,
                            data: slicedCurrentData,
                            borderColor: '#ff2d8f',
                            backgroundColor: 'rgba(255, 45, 143, 0.12)',
                            fill: true,
                            tension: 0.35,
                            pointRadius: isMobileView && trendRangeMode === 'full' ? 2 : 3.5,
                            pointHoverRadius: 5
                        },
                        {
                            label: `${prevLabel}`,
                            data: slicedPrevData,
                            borderColor: '#6366f1',
                            backgroundColor: 'rgba(99, 102, 241, 0.05)',
                            borderDash: [5, 5],
                            fill: false,
                            tension: 0.35,
                            pointRadius: isMobileView && trendRangeMode === 'full' ? 1.5 : 2.5
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: { color: textColor, boxWidth: 14, font: { weight: 'bold', size: 11 } }
                        }
                    },
                    scales: {
                        x: {
                            ticks: {
                                color: textColor,
                                autoSkip: true,
                                maxTicksLimit: isMobileView ? (trendRangeMode === '7d' ? 7 : 8) : 16,
                                maxRotation: 0,
                                minRotation: 0,
                                font: { size: isMobileView ? 10 : 11, weight: '600' }
                            }
                        },
                        y: { beginAtZero: true, ticks: { color: textColor, stepSize: 1 } }
                    }
                }
            });
        }

