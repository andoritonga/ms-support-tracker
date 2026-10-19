// ==========================================
// === CORE APPLICATION LOGIC & STATE ===
// ==========================================

        // Global State Holder
        let allReportLogs = [];
        let filteredLogs = [];
        let currentPage = 1;
        let pageSize = 10;
        let customerListCache = [];

        // Logo URLs
        const LOGO_LIGHT = "/static/logo.png";
        const LOGO_DARK = "/static/logo-dark.png";


        // Helper: Formatter Date YYYY-MM-DD -> 3 August 2026
        function formatDateFormatted(dateStr) {
            if (!dateStr) return '-';
            const parts = dateStr.split('-');
            if (parts.length !== 3) return dateStr;

            const day = parseInt(parts[2], 10);
            const monthIdx = parseInt(parts[1], 10) - 1;
            const year = parts[0];

            const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            return `${day} ${months[monthIdx] || ''} ${year}`;
        }

        // Set Default Date
        document.getElementById('startDate').value = new Date().toISOString().split('T')[0];

        // Dynamic Dark Mode & Logo Toggle Switch
        function toggleDarkMode() {
            const isDark = document.body.getAttribute('data-theme') === 'dark';
            const newTheme = isDark ? 'light' : 'dark';

            document.body.setAttribute('data-theme', newTheme);
            document.getElementById('themeIcon').innerText = isDark ? '🌙' : '☀️';
            document.getElementById('themeText').innerText = isDark ? 'Dark' : 'Light';

            document.getElementById('appLogo').src = isDark ? LOGO_LIGHT : LOGO_DARK;

            const metaTheme = document.getElementById('metaThemeColor');
            if (metaTheme) metaTheme.setAttribute('content', newTheme === 'dark' ? '#0f172a' : '#2434a4');

            if (document.getElementById('dashboardTab').classList.contains('active')) {
                updateDashboardAnalytics();
            }
        }



        // Switching Tabs Function
        function switchTab(tabId, el) {
            document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.nav-tab').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.mobile-nav-item').forEach(btn => btn.classList.remove('active'));

            const targetTab = document.getElementById(tabId);
            if (targetTab) targetTab.classList.add('active');

            if (tabId === 'dashboardTab') {
                const dt = document.querySelector('.nav-tab[onclick*="dashboardTab"]');
                if (dt) dt.classList.add('active');
                const mt = document.getElementById('mobileNavDashboard');
                if (mt) mt.classList.add('active');
                updateDashboardAnalytics();
            } else if (tabId === 'reportTab') {
                const rt = document.querySelector('.nav-tab[onclick*="reportTab"]');
                if (rt) rt.classList.add('active');
                const mt = document.getElementById('mobileNavReport');
                if (mt) mt.classList.add('active');
            }

            // Scroll to top smoothly on tab switch
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }




function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function escapeJsString(str) {
    if (!str) return '';
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;')
        .replace(/\n/g, ' ');
}


        const loading = show => {
            document.getElementById('loading').style.display = show ? 'flex' : 'none';
        };

        const reportLoading = show => {
            document.getElementById('reportLoading').style.display = show ? 'flex' : 'none';
        };

        // Load Dropdown Options
        function updateCustomerDatalist() {
            const datalist = document.getElementById('customerListOptions');
            if (!datalist) return;
            datalist.innerHTML = '';
            const allCusts = new Set(customerListCache || []);
            if (allReportLogs && allReportLogs.length > 0) {
                allReportLogs.forEach(l => {
                    if (l.customer && l.customer.trim()) allCusts.add(l.customer.trim());
                });
            }
            Array.from(allCusts).sort().forEach(c => {
                const opt = document.createElement('option');
                opt.value = c;
                datalist.appendChild(opt);
            });
        }

        function loadCustomers() {
            fetch('/api/customers')
                .then(async res => {
                    const data = await res.json();
                    if (!res.ok) {
                        throw new Error(data.error || data.message || `HTTP ${res.status}`);
                    }
                    return data;
                })
                .then(customers => {
                    if (!Array.isArray(customers)) return;
                    customerListCache = customers;
                    const sel = document.getElementById('customer');
                    const filterSel = document.getElementById('filterCustomer');

                    sel.innerHTML = '';
                    filterSel.innerHTML = '<option value="">All Customers</option>';

                    customers.forEach(c => {
                        sel.appendChild(new Option(c, c));
                        filterSel.appendChild(new Option(c, c));
                    });
                    sel.appendChild(new Option('+ Add Custom Customer...', '__custom__'));

                    updateCustomerDatalist();
                    loadResources();
                })
                .catch(err => {
                    console.error("Error loading customer config: " + err.message);
                });
        }

        function handleCustomerChange(sel) {
            if (sel.value === '__custom__') {
                const customName = prompt('Enter name of custom Customer:');
                if (customName && customName.trim()) {
                    const cleanName = customName.trim();
                    const newOpt = new Option(cleanName, cleanName, true, true);
                    sel.insertBefore(newOpt, sel.lastChild);
                    sel.value = cleanName;
                    updateCustomerDatalist();
                    loadResources();
                } else {
                    sel.selectedIndex = 0;
                    loadResources();
                }
            } else {
                loadResources();
            }
        }

        function loadResources() {
            const customer = document.getElementById('customer').value;
            if (!customer || customer === '__custom__') return;

            fetch(`/api/customer-resources?customer=${encodeURIComponent(customer)}`)
                .then(res => res.json())
                .then(data => {
                    const raisedByList = data.raisedBy || [];
                    fillSelect('raisedBy', raisedByList);

                    // Auto-fill project datalist suggestions
                    const projectList = data.projects || [];
                    const dl = document.getElementById('projectList');
                    if (dl) {
                        dl.innerHTML = '';
                        projectList.forEach(p => {
                            const opt = document.createElement('option');
                            opt.value = p;
                            dl.appendChild(opt);
                        });
                    }
                })
                .catch(err => {
                    console.error("Error loading resources:", err);
                });
        }

        function fillSelect(id, values) {
            const sel = document.getElementById(id);
            if (!sel) return;
            sel.innerHTML = '';
            if (!values || values.length === 0) {
                sel.appendChild(new Option('-- None configured --', ''));
            } else {
                values.forEach(v => sel.appendChild(new Option(v, v)));
            }
            sel.appendChild(new Option('+ Add Custom Name...', '__custom__'));
        }

        function handleRaisedByChange(sel) {
            if (sel.value === '__custom__') {
                const customName = prompt('Enter name of person who raised this ticket:');
                if (customName && customName.trim()) {
                    const cleanName = customName.trim();
                    const newOpt = new Option(cleanName, cleanName, true, true);
                    sel.insertBefore(newOpt, sel.lastChild);
                    sel.value = cleanName;
                } else {
                    sel.selectedIndex = 0;
                }
            }
        }



        function checkSyncStatus() {
            fetch('/api/sync-status')
                .then(res => res.json())
                .then(data => {
                    const icon = document.getElementById('syncIcon');
                    const text = document.getElementById('syncText');
                    const wrapper = text ? text.parentElement : null;
                    const mobIcon = document.getElementById('mobileNavSyncIcon');
                    const mobLabel = document.getElementById('mobileNavSyncLabel');

                    if (data.last_sync_error && data.pending_sync > 0) {
                        icon.innerText = '⚠️';
                        text.innerText = `Pending Sync (${data.pending_sync})`;
                        if (mobIcon) mobIcon.innerText = '⚠️';
                        if (mobLabel) mobLabel.innerText = `Pending (${data.pending_sync})`;
                        if (wrapper) wrapper.title = `Google Sheets Sync: ${data.last_sync_error}\nData Anda tetap tersimpan aman di SQLite lokal.\nKlik tombol ini untuk mencoba sinkronisasi atau tandai tersinkronisasi.`;
                    } else if (data.pending_sync > 0) {
                        icon.innerText = '⏳';
                        text.innerText = `Syncing (${data.pending_sync})`;
                        if (mobIcon) mobIcon.innerText = '⏳';
                        if (mobLabel) mobLabel.innerText = `Syncing (${data.pending_sync})`;
                        if (wrapper) wrapper.title = `${data.pending_sync} perubahan menunggu push ke Google Sheets`;
                    } else {
                        icon.innerText = '☁️';
                        text.innerText = 'Synced';
                        if (mobIcon) mobIcon.innerText = '☁️';
                        if (mobLabel) mobLabel.innerText = 'Synced';
                        if (wrapper) wrapper.title = 'Tersinkronisasi penuh';
                    }
                })
                .catch(() => {});
        }

        function triggerManualSync() {
            const icon = document.getElementById('syncIcon');
            const text = document.getElementById('syncText');
            icon.innerText = '🔄';
            text.innerText = 'Syncing...';
            reportLoading(true);
            fetch('/api/trigger-sync', { method: 'POST' })
                .then(res => res.json())
                .then((resData) => {
                    fetchLogs(false);
                    checkSyncStatus();
                    if (resData.status === 'error') {
                        const ask = confirm(
                            "Koneksi sinkronisasi ke Google Sheets mengalami kendala:\n\n" +
                            (resData.message || "Service account atau izin Google Sheets belum aktif.") +
                            "\n\nCatatan: Seluruh data Anda sudah tersimpan aman di database lokal.\n\nApakah Anda ingin menandai antrian sebagai 'Synced' lokal sekarang?"
                        );
                        if (ask) {
                            fetch('/api/force-resolve-pending-sync', { method: 'POST' })
                                .then(() => checkSyncStatus());
                        }
                    }
                })
                .catch(err => {
                    alert("Error triggering sync: " + err.message);
                    reportLoading(false);
                    checkSyncStatus();
                });
        }



// Close drawer or column visibility dropdown with Escape key
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (typeof closeCustomerDossier === 'function') closeCustomerDossier();
        if (typeof closeColumnVisibilityMenu === 'function') closeColumnVisibilityMenu();
    }
});

// Close column visibility dropdown on click outside
document.addEventListener('click', (e) => {
    const dd = document.getElementById('columnVisibilityDropdown');
    const btn = document.getElementById('btnColumnVisibility');
    if (dd && dd.style.display !== 'none') {
        if (!dd.contains(e.target) && (!btn || !btn.contains(e.target))) {
            dd.style.display = 'none';
        }
    }
});

// Initialize Application
let isAppInitialized = false;
function initApp() {
    if (isAppInitialized) {
        if (typeof fetchLogs === 'function' && (!allReportLogs || allReportLogs.length === 0)) {
            fetchLogs();
        }
        return;
    }
    isAppInitialized = true;

    if (typeof applyColumnVisibilityStyles === 'function') applyColumnVisibilityStyles();
    if (typeof checkRunningModalTimer === 'function') checkRunningModalTimer();
    loadCustomers();
    if (typeof fetchLogs === 'function') fetchLogs();
    checkSyncStatus();
    setInterval(checkSyncStatus, 15000);

    // Contract Helper Listeners (MSIG & ASJ)
    ['customer', 'category', 'clockIn', 'clockOut', 'taskDescription', 'remarks'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                if (typeof updateContractFormHelper === 'function') updateContractFormHelper('add');
            });
            el.addEventListener('change', () => {
                if (typeof updateContractFormHelper === 'function') updateContractFormHelper('add');
            });
        }
    });
    ['editCustomer', 'editCategory', 'editClockIn', 'editClockOut', 'editTaskDescription', 'editRemarks'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                if (typeof updateContractFormHelper === 'function') updateContractFormHelper('edit');
            });
            el.addEventListener('change', () => {
                if (typeof updateContractFormHelper === 'function') updateContractFormHelper('edit');
            });
        }
    });
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('✅ PWA Service Worker registered:', reg.scope))
            .catch(err => console.warn('⚠️ PWA Service Worker registration failed:', err));
    });
}
