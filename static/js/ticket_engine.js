// ==========================================================================
// CONTRACT TICKET ENGINE (MSIG & ASJ MANAGED SERVICES CONTRACTS)
// ==========================================================================

let activeContractClient = 'MSIG'; // Default active contract client tab

function isContractCustomer(customerName) {
    if (!customerName) return false;
    const upper = customerName.toUpperCase();
    return upper.includes('MSIG') || upper.includes('ASJ');
}

function getContractClientName(customerName) {
    if (!customerName) return '';
    const upper = customerName.toUpperCase();
    if (upper.includes('MSIG')) return 'MSIG';
    if (upper.includes('ASJ')) return 'ASJ';
    return '';
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
    let typeCode = 'support_zero';
    let typeName = '0 Tkt (Free)';
    let badgeHtml = '<span class="badge-ticket-burn badge-burn-00">⚪ 0 Tkt</span>';
    let explanation = `Tidak potong kuota tiket (${client} Contract: 0 Tkt)`;

    if (deduction >= 1.0) {
        typeCode = (cat === 'issue') ? 'issue' : 'support_full';
        typeName = `${deduction.toFixed(1)} Tkt`;
        badgeHtml = `<span class="badge-ticket-burn badge-burn-10" title="${client} Contract: Potong ${deduction.toFixed(1)} Tiket">🎫 ${deduction.toFixed(1)} Tkt</span>`;
        explanation = `Potong kuota tiket ${client} ${deduction.toFixed(1)} Tiket`;
    } else if (deduction > 0.0) {
        typeCode = 'support_half';
        typeName = `${deduction.toFixed(1)} Tkt`;
        badgeHtml = `<span class="badge-ticket-burn badge-burn-05" title="${client} Contract: Potong ${deduction.toFixed(1)} Tiket">🎫 ${deduction.toFixed(1)} Tkt</span>`;
        explanation = `Potong kuota tiket ${client} ${deduction.toFixed(1)} Tiket`;
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
    const key = c === 'MSIG' ? 'msig_contract_quota' : `contract_quota_${c}`;
    const saved = localStorage.getItem(key);
    return saved ? parseFloat(saved) : 50;
}

function saveContractQuotaLimit(client, val) {
    const c = client || activeContractClient;
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) {
        const key = c === 'MSIG' ? 'msig_contract_quota' : `contract_quota_${c}`;
        localStorage.setItem(key, num);
        if (c === 'MSIG') {
            localStorage.setItem('contract_quota_MSIG', num);
        }
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

    // Update switcher buttons
    const btnMsig = document.getElementById('btnContractMSIG');
    const btnAsj = document.getElementById('btnContractASJ');
    if (btnMsig) btnMsig.classList.toggle('active', client === 'MSIG');
    if (btnAsj) btnAsj.classList.toggle('active', client === 'ASJ');

    // Update label next to quota input
    const label = document.getElementById('msigQuotaClientLabel');
    if (label) label.innerText = `${client} Quota:`;

    // Refresh quota card display
    if (typeof getDashboardFilteredLogs === 'function') {
        updateContractQuotaCard(getDashboardFilteredLogs(), client);
    }
}

function updateContractQuotaCard(logs, client) {
    const targetClient = client || activeContractClient;
    const clientLogs = (logs || []).filter(l => l.customer && l.customer.toUpperCase().includes(targetClient));
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
    const helperEl = document.getElementById(isAdd ? 'msigAddHelper' : 'msigEditHelper');
    const titleEl = document.getElementById(isAdd ? 'contractAddHelperTitle' : 'contractEditHelperTitle');
    const ticketSelect = document.getElementById(isAdd ? 'ticketDeduction' : 'editTicketDeduction');

    if (!custEl || !helperEl) return;

    const custVal = custEl.value || '';
    const isContract = isContractCustomer(custVal);

    if (!isContract) {
        helperEl.style.display = 'none';
        return;
    }

    const client = getContractClientName(custVal);
    if (titleEl) {
        titleEl.innerText = `Potong Kuota Tiket ${client}:`;
    }

    helperEl.style.display = 'block';

    if (isAdd && ticketSelect) {
        const cat = (catEl ? catEl.value : '').toLowerCase();
        if (cat === 'issue') {
            ticketSelect.value = '1.0';
        }
    }
}

// Backward-compatible alias
function updateMsigFormHelper(mode) {
    updateContractFormHelper(mode);
}
