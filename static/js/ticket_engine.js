// ==========================================================================
// CONTRACT TICKET ENGINE (MSIG LIFE & ASURANSI SIMAS JIWA CONTRACTS)
// ==========================================================================

let activeContractClient = 'MSIG'; // Default active contract client tab

let contractConfigCache = {
    quotas: { MSIG: 50, ASJ: 50 },
    clients: {
        MSIG: { code: 'MSIG', label: 'MSIG Life', quota: 50 },
        ASJ: { code: 'ASJ', label: 'Asuransi Simas Jiwa', quota: 50 }
    },
    customerMap: {}
};

function getContractDisplayName(clientCode) {
    if (!clientCode) return '';
    const code = String(clientCode).toUpperCase();
    if (contractConfigCache && contractConfigCache.clients && contractConfigCache.clients[code]) {
        return contractConfigCache.clients[code].label || code;
    }
    if (code === 'MSIG') return 'MSIG Life';
    if (code === 'ASJ') return 'Asuransi Simas Jiwa';
    return code;
}

function isContractCustomer(customerName) {
    if (!customerName) return false;
    return getContractClientName(customerName) !== '';
}

function getContractClientName(customerName) {
    if (!customerName) return '';
    const upper = String(customerName).trim().toUpperCase();
    if (contractConfigCache && contractConfigCache.customerMap && contractConfigCache.customerMap[upper]) {
        return contractConfigCache.customerMap[upper];
    }
    if (upper.includes('MSIG') || upper.includes('MITSUI SUMITOMO')) return 'MSIG';
    if (upper.includes('ASJ') || upper.includes('SIMAS JIWA') || upper.includes('ASURANSI SIMAS')) return 'ASJ';
    return '';
}

function renderContractClientButtons() {
    const container = document.getElementById('contractClientToggleContainer');
    if (!container || !contractConfigCache || !contractConfigCache.clients) return;
    const entries = Object.values(contractConfigCache.clients);
    if (entries.length === 0) return;

    container.innerHTML = '';
    entries.forEach(clientObj => {
        const code = clientObj.code;
        const label = clientObj.label || code;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-contract-toggle' + (code === activeContractClient ? ' active' : '');
        btn.id = `btnContract${code}`;
        btn.setAttribute('data-client', code);
        btn.innerText = label;
        btn.onclick = () => switchContractClient(code);
        container.appendChild(btn);
    });
}

function loadContractConfig() {
    localStorage.removeItem('contract_quota_ACTIVITIES');
    fetch('/api/contract-config')
        .then(res => res.ok ? res.json() : null)
        .then(data => {
            if (!data) return;
            if (data.quotas) {
                delete data.quotas.ACTIVITIES;
                contractConfigCache.quotas = Object.assign({ MSIG: 50, ASJ: 50 }, data.quotas);
            }
            if (data.clients) {
                delete data.clients.ACTIVITIES;
                contractConfigCache.clients = data.clients;
            }
            if (data.customerMap) {
                contractConfigCache.customerMap = data.customerMap;
            }

            if (!contractConfigCache.clients[activeContractClient]) {
                activeContractClient = 'MSIG';
            }

            // Sync server-side quotas into localStorage cache
            for (const [code, qVal] of Object.entries(contractConfigCache.quotas)) {
                const num = parseFloat(qVal);
                if (!isNaN(num) && num > 0) {
                    localStorage.setItem(`contract_quota_${code}`, num);
                    if (code === 'MSIG') {
                        localStorage.setItem('msig_contract_quota', num);
                    }
                }
            }

            renderContractClientButtons();

            if (typeof getDashboardFilteredLogs === 'function') {
                updateContractQuotaCard(getDashboardFilteredLogs(), activeContractClient);
            }
        })
        .catch(err => console.warn('Could not load contract config:', err));
}

function calculateContractTicketBurn(item) {
    if (!item || !item.customer) {
        return {
            isContract: false,
            isMsig: false,
            isAsj: false,
            client: '',
            ticketBurn: 0.0,
            typeCode: 'none',
            type: 'Standard',
            badgeHtml: '',
            explanation: ''
        };
    }

    const client = getContractClientName(item.customer);
    if (!client) {
        return {
            isContract: false,
            isMsig: false,
            isAsj: false,
            client: '',
            ticketBurn: 0.0,
            typeCode: 'none',
            type: 'Standard',
            badgeHtml: '',
            explanation: ''
        };
    }

    const isMsig = client === 'MSIG';
    const isAsj = client === 'ASJ';

    let deduction = 0.0;
    if (item.ticketDeduction !== undefined && item.ticketDeduction !== null) {
        try {
            deduction = parseFloat(item.ticketDeduction) || 0.0;
        } catch (e) {
            deduction = 0.0;
        }
    }

    const cat = (item.category || '').toLowerCase();
    const displayClient = getContractDisplayName(client);
    let typeCode = 'support_zero';
    let typeName = '0 Tkt (Free)';
    let badgeHtml = '<span class="badge-ticket-burn badge-burn-00">⚪ 0 Tkt</span>';
    let explanation = `Tidak potong kuota tiket (${displayClient} Contract: 0 Tkt)`;

    if (deduction >= 1.0) {
        typeCode = (cat === 'issue') ? 'issue' : 'support_full';
        typeName = `${deduction.toFixed(1)} Tkt`;
        badgeHtml = `<span class="badge-ticket-burn badge-burn-10" title="${displayClient} Contract: Potong ${deduction.toFixed(1)} Tiket">🎫 ${deduction.toFixed(1)} Tkt</span>`;
        explanation = `Potong kuota tiket ${displayClient} ${deduction.toFixed(1)} Tiket`;
    } else if (deduction > 0.0) {
        typeCode = 'support_half';
        typeName = `${deduction.toFixed(1)} Tkt`;
        badgeHtml = `<span class="badge-ticket-burn badge-burn-05" title="${displayClient} Contract: Potong ${deduction.toFixed(1)} Tiket">🎫 ${deduction.toFixed(1)} Tkt</span>`;
        explanation = `Potong kuota tiket ${displayClient} ${deduction.toFixed(1)} Tiket`;
    }

    return {
        isContract: true,
        isMsig: isMsig,
        isAsj: isAsj,
        client: client,
        ticketBurn: deduction,
        typeCode: typeCode,
        type: typeName,
        badgeHtml: badgeHtml,
        explanation: explanation
    };
}

// Backward-compatible alias for existing templates/calls
function calculateMsigTicketBurn(item) {
    return calculateContractTicketBurn(item);
}

function changeTicketDeduction(rowId, val, selectEl) {
    const numVal = parseFloat(val) || 0.0;
    if (selectEl) {
        selectEl.className = 'ticket-select ' + (numVal >= 1.0 ? 'burn-10' : (numVal > 0.0 ? 'burn-05' : 'burn-00'));
    }

    const logItem = (typeof allReportLogs !== 'undefined') ? allReportLogs.find(l => l.rowId === rowId) : null;
    if (logItem) logItem.ticketDeduction = numVal;

    const filtItem = (typeof filteredLogs !== 'undefined') ? filteredLogs.find(l => l.rowId === rowId) : null;
    if (filtItem) filtItem.ticketDeduction = numVal;

    if (typeof getDashboardFilteredLogs === 'function') {
        updateContractQuotaCard(getDashboardFilteredLogs(), activeContractClient);
    }

    fetch('/api/update-ticket-deduction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowId: rowId, ticketDeduction: numVal })
    })
        .then(res => {
            if (!res.ok) throw new Error("Gagal menyimpan perubahan kuota tiket");
            return res.json();
        })
        .catch(err => {
            alert('Gagal update kuota tiket: ' + err.message);
            if (typeof fetchLogs === 'function') fetchLogs();
        });
}

function getContractQuotaLimit(client) {
    const c = client || activeContractClient;
    if (contractConfigCache && contractConfigCache.quotas && contractConfigCache.quotas[c]) {
        const cachedQ = parseFloat(contractConfigCache.quotas[c]);
        if (!isNaN(cachedQ) && cachedQ > 0) return cachedQ;
    }
    const key = c === 'MSIG' ? 'msig_contract_quota' : `contract_quota_${c}`;
    const saved = localStorage.getItem(key);
    return saved ? parseFloat(saved) : 50;
}

function saveContractQuotaLimit(client, val) {
    const c = client || activeContractClient;
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) {
        if (contractConfigCache && contractConfigCache.quotas) {
            contractConfigCache.quotas[c] = num;
        }
        const key = c === 'MSIG' ? 'msig_contract_quota' : `contract_quota_${c}`;
        localStorage.setItem(key, num);
        if (c === 'MSIG') {
            localStorage.setItem('contract_quota_MSIG', num);
        }
        fetch('/api/contract-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client: c, quota: num })
        }).catch(err => console.warn('Could not persist quota to server:', err));
    }
}

// Backward-compatible aliases for quota inputs
function getMsigQuotaLimit() {
    return getContractQuotaLimit(activeContractClient);
}

function saveMsigQuotaLimit() {
    const input = document.getElementById('msigQuotaLimit');
    if (!input) return;
    const val = parseFloat(input.value);
    if (!isNaN(val) && val > 0) {
        saveContractQuotaLimit(activeContractClient, val);
        if (typeof updateDashboardAnalytics === 'function') {
            updateDashboardAnalytics();
        }
    }
}

function switchContractClient(client) {
    activeContractClient = client;

    // Update switcher buttons dynamically
    document.querySelectorAll('#contractClientToggleContainer .btn-contract-toggle').forEach(btn => {
        const btnClient = btn.getAttribute('data-client');
        btn.classList.toggle('active', btnClient === client);
    });

    // Update label next to quota input
    const label = document.getElementById('msigQuotaClientLabel');
    if (label) label.innerText = `${getContractDisplayName(client)} Quota:`;

    // Refresh quota card display
    if (typeof getDashboardFilteredLogs === 'function') {
        updateContractQuotaCard(getDashboardFilteredLogs(), client);
    }
}

function updateContractQuotaCard(logs, client) {
    const targetClient = client || activeContractClient;
    const clientLogs = (logs || []).filter(l => l.customer && getContractClientName(l.customer) === targetClient);
    const card = document.getElementById('msigQuotaCard');
    if (!card) return;

    let totalBurn = 0.0;
    let countIssue = 0;
    let countSupportHalf = 0;
    let countSupportFull = 0;
    let countSupportZero = 0;

    clientLogs.forEach(l => {
        const res = calculateContractTicketBurn(l);
        totalBurn += res.ticketBurn;
        if (res.typeCode === 'issue') countIssue++;
        else if (res.typeCode === 'support_half') countSupportHalf++;
        else if (res.typeCode === 'support_full') countSupportFull++;
        else countSupportZero++;
    });

    const quotaLimit = getContractQuotaLimit(targetClient);
    const quotaInput = document.getElementById('msigQuotaLimit');
    if (quotaInput && document.activeElement !== quotaInput) {
        quotaInput.value = quotaLimit;
    }

    const remaining = Math.max(0, quotaLimit - totalBurn);
    const percent = quotaLimit > 0 ? Math.min(100, Math.round((totalBurn / quotaLimit) * 100)) : 0;

    const usedEl = document.getElementById('msigTicketsUsedText');
    const remainEl = document.getElementById('msigTicketsRemainingText');
    const pctEl = document.getElementById('msigQuotaPercentText');

    if (usedEl) usedEl.innerText = totalBurn.toFixed(1);
    if (remainEl) remainEl.innerText = remaining.toFixed(1);
    if (pctEl) pctEl.innerText = `${percent}%`;

    const fillBar = document.getElementById('msigProgressBarFill');
    if (fillBar) {
        fillBar.style.width = `${percent}%`;
        if (percent >= 90) {
            fillBar.style.background = 'linear-gradient(90deg, #f59e0b, #ef4444)';
        } else if (percent >= 70) {
            fillBar.style.background = 'linear-gradient(90deg, #3b82f6, #f59e0b)';
        } else {
            fillBar.style.background = 'linear-gradient(90deg, #10b981, #06b6d4)';
        }
    }

    const elIssue = document.getElementById('msigCountIssue');
    const elHalf = document.getElementById('msigCountSupportHalf');
    const elFull = document.getElementById('msigCountSupportFull');
    const elZero = document.getElementById('msigCountSupportZero');

    if (elIssue) elIssue.innerHTML = `${countIssue} <small style="font-weight: normal; font-size: 11px;">(${countIssue * 1.0} tkts)</small>`;
    if (elHalf) elHalf.innerHTML = `${countSupportHalf} <small style="font-weight: normal; font-size: 11px;">(${(countSupportHalf * 0.5).toFixed(1)} tkts)</small>`;
    if (elFull) elFull.innerHTML = `${countSupportFull} <small style="font-weight: normal; font-size: 11px;">(${countSupportFull * 1.0} tkts)</small>`;
    if (elZero) elZero.innerHTML = `${countSupportZero} <small style="font-weight: normal; font-size: 11px;">(Free)</small>`;
}

// Backward-compatible alias
function updateMsigQuotaCard(logs) {
    updateContractQuotaCard(logs, activeContractClient);
}

function updateContractFormHelper(mode) {
    const isAdd = mode === 'add';
    const custEl = document.getElementById(isAdd ? 'customer' : 'editCustomer');
    const catEl = document.getElementById(isAdd ? 'category' : 'editCategory');
    const clockInEl = document.getElementById(isAdd ? 'clockIn' : 'editClockIn');
    const clockOutEl = document.getElementById(isAdd ? 'clockOut' : 'editClockOut');
    const helperEl = document.getElementById(isAdd ? 'msigAddHelper' : 'msigEditHelper');
    const titleEl = document.getElementById(isAdd ? 'contractAddHelperTitle' : 'contractEditHelperTitle');
    const reasonEl = document.getElementById(isAdd ? 'msigAddReasonText' : 'msigEditReasonText');
    const ticketSelect = document.getElementById(isAdd ? 'ticketDeduction' : 'editTicketDeduction');

    if (!custEl || !helperEl) return;

    const custVal = custEl.value || '';
    const isContract = isContractCustomer(custVal);

    if (!isContract) {
        helperEl.style.display = 'none';
        return;
    }

    const client = getContractClientName(custVal);
    const clientDisplay = getContractDisplayName(client);
    if (titleEl) {
        titleEl.innerText = `Potong Kuota Tiket ${clientDisplay}:`;
    }

    helperEl.style.display = 'block';

    // Calculate duration if Clock In and Clock Out are filled
    let durationMins = 0;
    if (clockInEl && clockOutEl && clockInEl.value && clockOutEl.value) {
        const t1 = new Date(clockInEl.value).getTime();
        const t2 = new Date(clockOutEl.value).getTime();
        if (!isNaN(t1) && !isNaN(t2)) {
            let diff = Math.round((t2 - t1) / 60000);
            if (diff < 0) diff += 1440;
            if (diff > 0) durationMins = diff;
        }
    }

    const cat = (catEl ? catEl.value : '').toLowerCase();
    if (reasonEl) {
        if (durationMins > 0) {
            const hrs = Math.floor(durationMins / 60);
            const mins = durationMins % 60;
            const durLabel = hrs > 0 ? `${hrs}j ${mins}m` : `${mins}m`;
            if (cat === 'issue') {
                reasonEl.innerText = `Durasi: ${durLabel} • Issue = 1.0 Tiket`;
            } else if (durationMins > 240) {
                reasonEl.innerText = `Durasi: ${durLabel} (> 4 jam) • Support Changes >4h = 1.0 Tiket`;
            } else {
                reasonEl.innerText = `Durasi: ${durLabel} (≤ 4 jam) • Support Changes ≤4h = 0.5 Tiket / Non-Changes = 0 Tiket`;
            }
        } else {
            reasonEl.innerText = cat === 'issue'
                ? 'Kategori Issue otomatis direkomendasikan 1.0 Tiket'
                : 'Tentukan kuota tiket (0 / 0.5 / 1.0 Tkt) untuk log ini';
        }
    }

    if (isAdd && ticketSelect) {
        if (cat === 'issue') {
            ticketSelect.value = '1.0';
        } else if (durationMins > 240 && ticketSelect.value === '0.5') {
            ticketSelect.value = '1.0';
        }
    }
}

// Backward-compatible alias
function updateMsigFormHelper(mode) {
    updateContractFormHelper(mode);
}
