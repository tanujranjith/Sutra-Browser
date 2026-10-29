(() => {
    const SECTION_DEFAULTS = {
        projects: { filter: 'active', sort: 'due', view: 'cards' },
        clients: { filter: 'all', sort: 'recent', view: 'cards' },
        invoices: { filter: 'all', sort: 'due', view: 'list' },
        finance: { filter: 'all', sort: 'recent', view: 'list' },
        opportunities: { filter: 'open', sort: 'value', view: 'stage' },
        meetings: { filter: 'week', sort: 'date', view: 'list' },
        proposals: { filter: 'active', sort: 'recent', view: 'list' },
        tasks: { filter: 'today', sort: 'due', view: 'list' },
        documents: { filter: 'all', sort: 'recent', view: 'list' },
        goals: { filter: 'active', sort: 'progress', view: 'cards' },
        notes: { filter: 'all', sort: 'recent', view: 'cards' }
    };
    const COLLECTION_BY_ENTITY = {
        project: 'projects',
        client: 'clients',
        invoice: 'invoices',
        finance: 'finance',
        opportunity: 'opportunities',
        meeting: 'meetings',
        proposal: 'proposals',
        task: 'tasks',
        document: 'documents',
        goal: 'goals',
        note: 'notes'
    };
    const QUICK_ACTIONS = [
        { label: 'New Project', entity: 'project', icon: 'fa-briefcase' },
        { label: 'New Client', entity: 'client', icon: 'fa-address-card' },
        { label: 'New Invoice', entity: 'invoice', icon: 'fa-file-invoice-dollar' },
        { label: 'New Income Entry', entity: 'finance', icon: 'fa-arrow-trend-up', defaults: { type: 'income', category: 'revenue' } },
        { label: 'New Expense', entity: 'finance', icon: 'fa-receipt', defaults: { type: 'expense', category: 'software' } },
        { label: 'New Meeting', entity: 'meeting', icon: 'fa-calendar-check' },
        { label: 'New Proposal', entity: 'proposal', icon: 'fa-file-signature', defaults: { type: 'proposal' } },
        { label: 'New Contract', entity: 'proposal', icon: 'fa-file-contract', defaults: { type: 'contract' } },
        { label: 'New Follow-Up', entity: 'task', icon: 'fa-bell', defaults: { category: 'Follow-Up' } },
        { label: 'Open Business Note', action: 'focus-note', icon: 'fa-note-sticky' }
    ];
    const PROJECT_STATUS_OPTIONS = [['planning', 'Planning'], ['active', 'Active'], ['waiting', 'Waiting'], ['blocked', 'Blocked'], ['at-risk', 'At Risk'], ['completed', 'Completed'], ['archived', 'Archived']];
    const CLIENT_STATUS_OPTIONS = [['lead', 'Lead'], ['qualified', 'Qualified'], ['active', 'Active'], ['waiting', 'Waiting'], ['past-client', 'Past Client'], ['dormant', 'Dormant']];
    const PRIORITY_OPTIONS = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['urgent', 'Urgent']];
    const INVOICE_STATUS_OPTIONS = [['draft', 'Draft'], ['sent', 'Sent'], ['paid', 'Paid'], ['canceled', 'Canceled']];
    const FINANCE_TYPE_OPTIONS = [['income', 'Income'], ['expense', 'Expense']];
    const FINANCE_CATEGORY_OPTIONS = [['software', 'Software'], ['travel', 'Travel'], ['equipment', 'Equipment'], ['marketing', 'Marketing'], ['office', 'Office'], ['contractors', 'Contractors'], ['subscriptions', 'Subscriptions'], ['education', 'Education'], ['revenue', 'Revenue'], ['consulting', 'Consulting'], ['product-sales', 'Product Sales'], ['miscellaneous', 'Miscellaneous']];
    const OPPORTUNITY_STAGE_OPTIONS = [['lead', 'Lead'], ['contacted', 'Contacted'], ['proposal-sent', 'Proposal Sent'], ['negotiation', 'Negotiation'], ['won', 'Won'], ['lost', 'Lost']];
    const MEETING_STATUS_OPTIONS = [['scheduled', 'Scheduled'], ['confirmed', 'Confirmed'], ['completed', 'Completed'], ['canceled', 'Canceled']];
    const PROPOSAL_STATUS_OPTIONS = [['draft', 'Draft'], ['sent', 'Sent'], ['viewed', 'Viewed'], ['accepted', 'Accepted'], ['rejected', 'Rejected'], ['expired', 'Expired']];
    const TASK_STATUS_OPTIONS = [['todo', 'To Do'], ['in-progress', 'In Progress'], ['waiting', 'Waiting'], ['completed', 'Completed']];
    const DOCUMENT_KIND_OPTIONS = [['proposal', 'Proposal'], ['contract', 'Contract'], ['receipt', 'Receipt'], ['brand-file', 'Brand File'], ['deliverable', 'Deliverable'], ['template', 'Template'], ['reference', 'Reference']];
    const GOAL_KIND_OPTIONS = [['revenue', 'Revenue Target'], ['client-count', 'Client Count'], ['project-completion', 'Project Completion'], ['outreach', 'Outreach Goal'], ['expense-cap', 'Expense Cap']];
    const NOTE_KIND_OPTIONS = [['general', 'General'], ['meeting', 'Meeting'], ['client', 'Client'], ['deal', 'Deal'], ['project', 'Project'], ['invoice-follow-up', 'Invoice Follow-Up']];
    const PAYMENT_METHOD_OPTIONS = [['bank-transfer', 'Bank Transfer'], ['card', 'Card'], ['cash', 'Cash'], ['ach', 'ACH'], ['paypal', 'PayPal'], ['stripe', 'Stripe'], ['check', 'Check'], ['wire', 'Wire'], ['other', 'Other']];
    const NOTE_TEMPLATES = Object.freeze({
        meeting: {
            label: 'Meeting Recap',
            body: 'Meeting recap\n\nDate:\nAttendees:\nObjective:\n\nAgenda\n- \n\nKey decisions\n- \n\nAction register\n- Owner: | Task: | Due:\n- Owner: | Task: | Due:\n\nRisks / blockers\n- \n\nNext checkpoint\n- Date:\n'
        },
        'one-on-one': {
            label: '1:1 Check-In',
            body: '1:1 check-in\n\nDate:\nParticipants:\n\nWins since last sync\n- \n\nRoadblocks\n- \n\nSupport needed\n- \n\nGrowth goals\n- \n\nAction agreements\n- Owner: | Task: | Due:\n'
        },
        sales: {
            label: 'Sales Discovery',
            body: 'Sales discovery call\n\nProspect:\nStage:\nDate:\n\nPain points\n- \n\nBudget / timeline clues\n- Budget:\n- Timeline:\n\nOffer discussed\n- \n\nObjections\n- \n\nNext step\n- Owner:\n- Date:\n'
        },
        brief: {
            label: 'Project Brief',
            body: 'Project brief\n\nProject:\nClient:\nOwner:\n\nObjective\n- \n\nSuccess criteria\n- \n\nScope\n- In scope:\n- Out of scope:\n\nDeliverables\n- \n\nTimeline\n- Kickoff:\n- Review:\n- Delivery:\n'
        },
        proposal: {
            label: 'Proposal Draft',
            body: 'Proposal draft\n\nClient:\nPrepared by:\nDate:\n\nProblem statement\n- \n\nApproach\n- \n\nTimeline\n- Phase 1:\n- Phase 2:\n\nInvestment\n- \n\nOpen questions\n- \n'
        },
        'scope-change': {
            label: 'Scope Change',
            body: 'Scope change note\n\nProject:\nRequested by:\nDate:\n\nRequested change\n- \n\nImpact assessment\n- Timeline impact:\n- Cost impact:\n- Risk impact:\n\nDecision\n- Approved / Rejected / Pending\n\nFollow-up actions\n- Owner: | Task: | Due:\n'
        },
        invoice: {
            label: 'Invoice Follow-Up',
            body: 'Invoice follow-up\n\nClient:\nInvoice number:\nAmount:\nDue date:\n\nCurrent status\n- \n\nMessage draft\n- \n\nEscalation plan\n- Reminder 1:\n- Reminder 2:\n\nNext chase date\n- \n'
        },
        onboarding: {
            label: 'Client Onboarding',
            body: 'Client onboarding checklist\n\nClient:\nKickoff date:\nOwner:\n\nChecklist\n- Contract signed\n- Kickoff scheduled\n- Access received\n- Deliverables clarified\n- Payment terms confirmed\n- Communication cadence aligned\n\nNotes\n- \n'
        },
        weekly: {
            label: 'Weekly Ops Review',
            body: 'Weekly operations review\n\nWeek:\nOwner:\n\nTop wins\n- \n\nPipeline and delivery risks\n- \n\nCash and invoice watchlist\n- \n\nPriority focus for next week\n- \n'
        },
        handoff: {
            label: 'Project Handoff',
            body: 'Project handoff note\n\nProject:\nOutgoing owner:\nIncoming owner:\nDate:\n\nCurrent status\n- \n\nPending decisions\n- \n\nOpen risks\n- \n\nImmediate next actions\n- Owner: | Task: | Due:\n'
        },
        feedback: {
            label: 'Client Feedback Log',
            body: 'Client feedback log\n\nClient:\nDate:\nChannel:\n\nFeedback highlights\n- \n\nSentiment\n- Positive / Mixed / Negative\n\nRequested changes\n- \n\nResponse plan\n- Owner: | Task: | Due:\n'
        },
        retro: {
            label: 'Retrospective',
            body: 'Retrospective\n\nPeriod:\nFacilitator:\n\nWhat worked\n- \n\nWhat did not work\n- \n\nThemes\n- \n\nImprovement experiments\n- Owner: | Experiment: | Review date:\n'
        },
        outreach: {
            label: 'Outreach Sequence',
            body: 'Outreach sequence\n\nTarget account:\nGoal:\nOwner:\n\nTouch plan\n- Touch 1 (date/channel):\n- Touch 2 (date/channel):\n- Touch 3 (date/channel):\n\nMessage angles\n- \n\nOutcome tracking\n- Response:\n- Next step:\n'
        },
        sop: {
            label: 'SOP Draft',
            body: 'Standard operating procedure\n\nProcess name:\nOwner:\nVersion:\n\nPurpose\n- \n\nWhen to use\n- \n\nProcedure steps\n1. \n2. \n3. \n\nQuality checks\n- \n\nEscalation path\n- \n'
        }
    });
    const NOTE_TEMPLATE_QUICK_KEYS = Object.freeze(['meeting', 'sales', 'brief', 'proposal', 'invoice', 'onboarding', 'weekly', 'retro']);
    const NOTE_TEMPLATE_MODES = Object.freeze([
        ['replace', 'Replace Draft'],
        ['append', 'Append Below'],
        ['prepend', 'Insert Above']
    ]);
    const SECTION_VIEW_OPTIONS = {
        projects: ['cards', 'list', 'compact', 'status', 'client'],
        clients: ['cards', 'list', 'status', 'company'],
        finance: ['list', 'category', 'month'],
        opportunities: ['stage', 'list'],
        notes: ['cards', 'list']
    };

    function nowIso() {
        return new Date().toISOString();
    }

    function getPreference(path, fallbackValue) {
        if (typeof getWorkspacePreference === 'function') {
            return getWorkspacePreference(path, fallbackValue);
        }
        return fallbackValue;
    }

    function getBusinessPreferenceSnapshot() {
        const defaultViewRaw = String(getPreference('business.defaultView', 'cards') || 'cards').toLowerCase();
        const defaultView = ['cards', 'list', 'compact'].includes(defaultViewRaw) ? defaultViewRaw : 'cards';
        return {
            defaultView,
            compactCards: getPreference('business.compactCards', false) === true || defaultView === 'compact',
            showAnalytics: getPreference('business.showAnalytics', true) !== false,
            showActivity: getPreference('business.showActivity', true) !== false,
            showDeadlines: getPreference('business.showDeadlines', true) !== false
        };
    }

    function resolveSectionViewByPreference(section, preferredView, fallbackView) {
        const options = SECTION_VIEW_OPTIONS[section];
        if (!Array.isArray(options) || options.length === 0) return fallbackView;
        const preferred = String(preferredView || '').toLowerCase();
        if (preferred === 'compact' && options.includes('compact')) return 'compact';
        if (preferred === 'list' && options.includes('list')) return 'list';
        if (preferred === 'cards' && options.includes('cards')) return 'cards';
        return options.includes(fallbackView) ? fallbackView : options[0];
    }

    function getRoot() {
        return document.getElementById('businessDashboardRoot');
    }

    function getModal() {
        return document.getElementById('businessEntityModal');
    }

    function getWorkspace() {
        if (typeof normalizeBusinessWorkspace === 'function') {
            businessWorkspace = normalizeBusinessWorkspace(businessWorkspace);
        }
        return businessWorkspace;
    }

    function getUiState() {
        if (!businessUiState || typeof businessUiState !== 'object') {
            businessUiState = typeof getDefaultBusinessUiState === 'function'
                ? getDefaultBusinessUiState()
                : { search: '', compact: false, detail: { entityType: '', entityId: '', tab: 'summary' }, modal: null, sections: {}, focusQuickNote: false };
        }
        if (!businessUiState.detail) businessUiState.detail = { entityType: '', entityId: '', tab: 'summary' };
        if (!businessUiState.sections || typeof businessUiState.sections !== 'object') businessUiState.sections = {};
        if (!NOTE_TEMPLATES[String(businessUiState.selectedTemplate || '').toLowerCase()]) businessUiState.selectedTemplate = 'meeting';
        if (!NOTE_TEMPLATE_MODES.some(([value]) => value === businessUiState.templateMode)) businessUiState.templateMode = 'replace';
        const prefSnapshot = getBusinessPreferenceSnapshot();
        Object.keys(SECTION_DEFAULTS).forEach(section => {
            if (!businessUiState.sections[section]) {
                const defaults = { ...SECTION_DEFAULTS[section] };
                defaults.view = resolveSectionViewByPreference(section, prefSnapshot.defaultView, defaults.view);
                businessUiState.sections[section] = defaults;
            }
        });
        if (businessUiState.defaultViewPreference !== prefSnapshot.defaultView) {
            Object.keys(SECTION_DEFAULTS).forEach(section => {
                const sectionState = businessUiState.sections[section];
                if (!sectionState) return;
                sectionState.view = resolveSectionViewByPreference(section, prefSnapshot.defaultView, sectionState.view);
            });
            businessUiState.defaultViewPreference = prefSnapshot.defaultView;
        }
        businessUiState.compact = prefSnapshot.compactCards === true;
        return businessUiState;
    }

    function getSectionState(section) {
        const state = getUiState();
        if (!state.sections[section]) state.sections[section] = { ...(SECTION_DEFAULTS[section] || { filter: 'all', sort: 'recent', view: 'list' }) };
        return state.sections[section];
    }

    function getCollection(entityType) {
        const workspace = getWorkspace();
        return workspace[COLLECTION_BY_ENTITY[entityType]] || [];
    }

    function getEntity(entityType, entityId) {
        return getCollection(entityType).find(item => String(item.id) === String(entityId)) || null;
    }

    function cloneValue(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function saveWorkspace() {
        if (typeof persistAppData === 'function') persistAppData();
    }

    function setDetail(entityType, entityId, tab = 'summary') {
        const state = getUiState();
        state.detail = { entityType, entityId, tab };
    }

    function clearDetail() {
        const state = getUiState();
        state.detail = { entityType: '', entityId: '', tab: 'summary' };
    }

    function updateCollection(entityType, updater) {
        const workspace = getWorkspace();
        const key = COLLECTION_BY_ENTITY[entityType];
        if (!key) return;
        workspace[key] = updater(Array.isArray(workspace[key]) ? workspace[key].slice() : []);
        saveWorkspace();
    }

    function currency(value, currencyCode) {
        const workspace = getWorkspace();
        const code = String(currencyCode || workspace.currency || 'USD').trim().toUpperCase() || 'USD';
        const amount = normalizeFiniteNumber(value, 0);
        try {
            return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
        } catch (error) {
            return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
    }

    function shortDate(value) {
        const parsed = typeof parseComparableDate === 'function' ? parseComparableDate(value) : new Date(value);
        if (!parsed || Number.isNaN(parsed.getTime())) return 'No date';
        return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(parsed);
    }

    function longDate(value) {
        const parsed = typeof parseComparableDate === 'function' ? parseComparableDate(value) : new Date(value);
        if (!parsed || Number.isNaN(parsed.getTime())) return 'No date';
        return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
    }

    function relativeDueLabel(value) {
        const parsed = typeof parseComparableDate === 'function' ? parseComparableDate(value) : new Date(value);
        if (!parsed || Number.isNaN(parsed.getTime())) return 'No date';
        const todayDate = typeof today === 'function' && typeof parseComparableDate === 'function' ? parseComparableDate(today()) : new Date();
        todayDate.setHours(0, 0, 0, 0);
        parsed.setHours(0, 0, 0, 0);
        const diff = Math.round((parsed.getTime() - todayDate.getTime()) / 86400000);
        if (diff === 0) return 'Today';
        if (diff === 1) return 'Tomorrow';
        if (diff === -1) return 'Yesterday';
        if (diff < 0) return `${Math.abs(diff)}d overdue`;
        return `In ${diff}d`;
    }

    function percent(value, total) {
        if (!total) return 0;
        return Math.max(0, Math.min(100, (value / total) * 100));
    }

    function sum(list, getter) {
        return (Array.isArray(list) ? list : []).reduce((total, item) => total + normalizeFiniteNumber(getter(item), 0), 0);
    }

    function slugLabel(value) {
        return String(value || '')
            .split('-')
            .map(part => part ? part.charAt(0).toUpperCase() + part.slice(1) : '')
            .join(' ')
            .trim();
    }

    function escapeText(value) {
        return typeof escapeHtml === 'function' ? escapeHtml(value) : String(value || '');
    }

    function invoiceTotal(invoice) {
        return Math.max(0, normalizeFiniteNumber(invoice && invoice.amount, 0) + normalizeFiniteNumber(invoice && invoice.taxAmount, 0) - normalizeFiniteNumber(invoice && invoice.discount, 0));
    }

    function invoiceStatus(invoice) {
        const status = String(invoice && invoice.status || 'draft').toLowerCase();
        if (status === 'paid' || status === 'canceled' || status === 'draft') return status;
        const due = typeof parseComparableDate === 'function' ? parseComparableDate(invoice && invoice.dueDate) : new Date(invoice && invoice.dueDate);
        const todayDate = typeof parseComparableDate === 'function' && typeof today === 'function' ? parseComparableDate(today()) : new Date();
        if (!due || Number.isNaN(due.getTime())) return 'sent';
        due.setHours(0, 0, 0, 0);
        todayDate.setHours(0, 0, 0, 0);
        const diff = Math.round((due.getTime() - todayDate.getTime()) / 86400000);
        if (diff < 0) return 'overdue';
        if (diff <= 7) return 'due-soon';
        return 'sent';
    }

    function isOpenOpportunity(item) {
        const stage = String(item && item.stage || '').toLowerCase();
        return stage && stage !== 'won' && stage !== 'lost';
    }

    // Human label for where a proposal/contract sits in its response timeline.
    function proposalResponseLabel(item) {
        const status = String(item && item.status || '').toLowerCase();
        if (['accepted', 'rejected', 'expired'].includes(status)) {
            return `${slugLabel(status)}${item.responseDate ? ` ${shortDate(item.responseDate)}` : ''}`;
        }
        if (item && item.dateSent) {
            if (item.responseDate) {
                const due = daysUntil(item.responseDate);
                if (due !== null) return due < 0 ? `Response overdue ${Math.abs(due)}d` : (due === 0 ? 'Response due today' : `Response due in ${due}d`);
            }
            const sent = daysUntil(item.dateSent);
            return sent !== null ? `Awaiting ${Math.abs(sent)}d` : 'Awaiting response';
        }
        return 'Draft';
    }

    function monthKey(value) {
        const parsed = typeof parseComparableDate === 'function' ? parseComparableDate(value) : new Date(value);
        if (!parsed || Number.isNaN(parsed.getTime())) return '';
        const year = parsed.getFullYear();
        const month = `${parsed.getMonth() + 1}`.padStart(2, '0');
        return `${year}-${month}`;
    }

    function buildMonthSeries(count = 6) {
        const now = new Date();
        now.setDate(1);
        const months = [];
        for (let index = count - 1; index >= 0; index -= 1) {
            const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
            const key = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}`;
            months.push({
                key,
                label: new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date)
            });
        }
        return months;
    }

    function belongsToCurrentMonth(value) {
        return monthKey(value) === monthKey(typeof today === 'function' ? today() : nowIso());
    }

    function isSameDay(value, reference = (typeof today === 'function' ? today() : nowIso())) {
        return monthKey(value) === monthKey(reference) && String(value || '').slice(8, 10) === String(reference || '').slice(8, 10);
    }

    function daysUntil(value) {
        const parsed = typeof parseComparableDate === 'function' ? parseComparableDate(value) : new Date(value);
        const baseline = typeof parseComparableDate === 'function' && typeof today === 'function' ? parseComparableDate(today()) : new Date();
        if (!parsed || Number.isNaN(parsed.getTime())) return null;
        parsed.setHours(0, 0, 0, 0);
        baseline.setHours(0, 0, 0, 0);
        return Math.round((parsed.getTime() - baseline.getTime()) / 86400000);
    }

    function deadlineBucket(value) {
        const diff = daysUntil(value);
        if (diff === null) return 'later';
        if (diff < 0) return 'overdue';
        if (diff === 0) return 'today';
        if (diff === 1) return 'tomorrow';
        if (diff <= 7) return 'this-week';
        if (diff <= 14) return 'next-week';
        return 'later';
    }

    // Operator-grade project health score (0-100) derived only from local
    // signals: due dates, status, milestones, blockers, priority, open tasks,
    // and unpaid invoices. Returns { score, tone, label, factors[] }.
    function projectHealth(project, related) {
        const status = String(project && project.status || '').toLowerCase();
        if (['completed', 'archived'].includes(status)) {
            return { score: 100, tone: 'success', label: 'Done', factors: [] };
        }
        const factors = [];
        let score = 100;
        const overdueBy = daysUntil(project.dueDate);
        if (overdueBy !== null && overdueBy < 0) { score -= Math.min(40, 12 + Math.abs(overdueBy)); factors.push(`Overdue ${Math.abs(overdueBy)}d`); }
        else if (overdueBy !== null && overdueBy <= 3) { score -= 8; factors.push('Due very soon'); }
        if (status === 'blocked') { score -= 25; factors.push('Blocked'); }
        if (status === 'at-risk') { score -= 20; factors.push('Marked at risk'); }
        if (status === 'waiting') { score -= 8; factors.push('Waiting on input'); }
        if (project.riskFlag) { score -= 12; factors.push('Risk flag set'); }
        const overdueMilestones = (project.milestones || []).filter(m => m.date && String(m.status || '').toLowerCase() !== 'completed' && (daysUntil(m.date) || 0) < 0).length;
        if (overdueMilestones) { score -= Math.min(20, overdueMilestones * 8); factors.push(`${overdueMilestones} milestone${overdueMilestones > 1 ? 's' : ''} overdue`); }
        const overdueSubtasks = (project.subtasks || []).filter(s => String(s.status || '').toLowerCase() !== 'completed' && s.dueDate && (daysUntil(s.dueDate) || 0) < 0).length;
        if (overdueSubtasks) { score -= Math.min(15, overdueSubtasks * 5); factors.push(`${overdueSubtasks} overdue subtask${overdueSubtasks > 1 ? 's' : ''}`); }
        const projectTasks = (related && related.projectTasks.get(project.id)) || [];
        const overdueTasks = projectTasks.filter(t => String(t.status || '').toLowerCase() !== 'completed' && t.dueDate && (daysUntil(t.dueDate) || 0) < 0).length;
        if (overdueTasks) { score -= Math.min(18, overdueTasks * 6); factors.push(`${overdueTasks} overdue task${overdueTasks > 1 ? 's' : ''}`); }
        const projectInvoices = (related && related.projectInvoices.get(project.id)) || [];
        const overdueInvoices = projectInvoices.filter(inv => invoiceStatus(inv) === 'overdue').length;
        if (overdueInvoices) { score -= Math.min(20, overdueInvoices * 10); factors.push(`${overdueInvoices} overdue invoice${overdueInvoices > 1 ? 's' : ''}`); }
        const completion = normalizeFiniteNumber(project.completionPercent, 0);
        if (['high', 'urgent'].includes(String(project.priority || '').toLowerCase()) && completion < 30 && overdueBy !== null && overdueBy <= 14) {
            score -= 6; factors.push('High priority, low progress');
        }
        const est = normalizeFiniteNumber(project.estimatedHours, 0);
        const logged = normalizeFiniteNumber(project.loggedHours, 0);
        if (est > 0 && logged > est * 1.1) { score -= 8; factors.push('Over estimated hours'); }
        score = Math.max(0, Math.min(100, Math.round(score)));
        const tone = score >= 75 ? 'success' : score >= 50 ? 'warning' : 'danger';
        const label = score >= 75 ? 'Healthy' : score >= 50 ? 'Watch' : 'At risk';
        return { score, tone, label, factors };
    }

    function buildModel() {
        const workspace = getWorkspace();
        const ui = getUiState();
        const preferences = getBusinessPreferenceSnapshot();
        const refs = {
            clients: new Map(workspace.clients.map(item => [item.id, item])),
            projects: new Map(workspace.projects.map(item => [item.id, item])),
            invoices: new Map(workspace.invoices.map(item => [item.id, item])),
            finance: new Map(workspace.finance.map(item => [item.id, item])),
            opportunities: new Map(workspace.opportunities.map(item => [item.id, item])),
            meetings: new Map(workspace.meetings.map(item => [item.id, item])),
            proposals: new Map(workspace.proposals.map(item => [item.id, item])),
            tasks: new Map(workspace.tasks.map(item => [item.id, item])),
            documents: new Map(workspace.documents.map(item => [item.id, item])),
            goals: new Map(workspace.goals.map(item => [item.id, item])),
            notes: new Map(workspace.notes.map(item => [item.id, item]))
        };
        const related = {
            projectInvoices: new Map(),
            projectMeetings: new Map(),
            projectTasks: new Map(),
            projectNotes: new Map(),
            projectDocuments: new Map(),
            clientProjects: new Map(),
            clientInvoices: new Map(),
            clientMeetings: new Map(),
            clientNotes: new Map(),
            clientProposals: new Map(),
            clientTasks: new Map(),
            clientOpportunities: new Map()
        };
        const pushRelated = (map, key, value) => {
            if (!key) return;
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(value);
        };
        workspace.projects.forEach(project => pushRelated(related.clientProjects, project.clientId, project));
        workspace.invoices.forEach(invoice => {
            pushRelated(related.projectInvoices, invoice.projectId, invoice);
            pushRelated(related.clientInvoices, invoice.clientId, invoice);
        });
        workspace.meetings.forEach(meeting => {
            pushRelated(related.projectMeetings, meeting.projectId, meeting);
            pushRelated(related.clientMeetings, meeting.clientId, meeting);
        });
        workspace.tasks.forEach(task => {
            pushRelated(related.projectTasks, task.projectId, task);
            pushRelated(related.clientTasks, task.clientId, task);
        });
        workspace.notes.forEach(note => {
            pushRelated(related.projectNotes, note.projectId, note);
            pushRelated(related.clientNotes, note.clientId, note);
        });
        workspace.documents.forEach(documentItem => pushRelated(related.projectDocuments, documentItem.projectId, documentItem));
        workspace.proposals.forEach(proposal => pushRelated(related.clientProposals, proposal.clientId, proposal));
        workspace.opportunities.forEach(opportunity => pushRelated(related.clientOpportunities, opportunity.clientId, opportunity));

        const monthlyIncome = workspace.finance.filter(item => item.type === 'income' && belongsToCurrentMonth(item.date));
        const monthlyExpenses = workspace.finance.filter(item => item.type === 'expense' && belongsToCurrentMonth(item.date));
        const paidInvoicesWithoutFinance = workspace.invoices.filter(item => invoiceStatus(item) === 'paid' && !workspace.finance.some(financeRow => financeRow.invoiceId === item.id));
        const overdueInvoices = workspace.invoices.filter(item => invoiceStatus(item) === 'overdue');
        const dueSoonInvoices = workspace.invoices.filter(item => invoiceStatus(item) === 'due-soon');
        const activeProjects = workspace.projects.filter(item => !['completed', 'archived'].includes(String(item.status || '').toLowerCase()));
        const atRiskProjects = workspace.projects.filter(item => item.riskFlag || String(item.status || '').toLowerCase() === 'at-risk' || String(item.status || '').toLowerCase() === 'blocked');
        const openOpportunities = workspace.opportunities.filter(isOpenOpportunity);
        const thisWeekMeetings = workspace.meetings.filter(item => {
            const diff = daysUntil(item.date);
            return diff !== null && diff >= 0 && diff <= 7 && String(item.status || '').toLowerCase() !== 'canceled';
        });
        const todayTasks = workspace.tasks.filter(item => isSameDay(item.dueDate) && String(item.status || '').toLowerCase() !== 'completed');
        const recentActivity = workspace.activity.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        const recentActivityCount = recentActivity.filter(item => {
            const parsed = typeof parseComparableDate === 'function' ? parseComparableDate(item.createdAt) : new Date(item.createdAt);
            if (!parsed || Number.isNaN(parsed.getTime())) return false;
            return (Date.now() - parsed.getTime()) <= 7 * 86400000;
        }).length;

        const deadlines = [];
        workspace.projects.forEach(project => {
            if (project.dueDate && !['completed', 'archived'].includes(String(project.status || '').toLowerCase())) {
                deadlines.push({ entityType: 'project', entityId: project.id, type: 'Project', title: project.name || 'Untitled project', date: project.dueDate, bucket: deadlineBucket(project.dueDate), status: project.status, clientId: project.clientId, projectId: project.id, nextAction: project.nextStep || 'Review status' });
            }
            (project.milestones || []).forEach(milestone => {
                if (milestone.date && String(milestone.status || '').toLowerCase() !== 'completed') {
                    deadlines.push({ entityType: 'project', entityId: project.id, type: 'Milestone', title: milestone.title || 'Milestone', date: milestone.date, bucket: deadlineBucket(milestone.date), status: milestone.status, clientId: project.clientId, projectId: project.id, nextAction: milestone.notes || 'Confirm delivery milestone' });
                }
            });
        });
        workspace.invoices.forEach(invoice => {
            if (invoice.dueDate && !['paid', 'canceled'].includes(String(invoice.status || '').toLowerCase())) {
                deadlines.push({ entityType: 'invoice', entityId: invoice.id, type: 'Invoice', title: invoice.title || invoice.invoiceNumber || 'Invoice', date: invoice.dueDate, bucket: deadlineBucket(invoice.dueDate), status: invoiceStatus(invoice), clientId: invoice.clientId, projectId: invoice.projectId, nextAction: 'Send payment reminder' });
            }
        });
        workspace.clients.forEach(client => {
            if (client.nextFollowUpDate) {
                deadlines.push({ entityType: 'client', entityId: client.id, type: 'Follow-Up', title: client.name || client.company || 'Client follow-up', date: client.nextFollowUpDate, bucket: deadlineBucket(client.nextFollowUpDate), status: client.status, clientId: client.id, projectId: '', nextAction: 'Reach out and update relationship status' });
            }
        });
        workspace.meetings.forEach(meeting => {
            if (meeting.date && String(meeting.status || '').toLowerCase() !== 'canceled') {
                deadlines.push({ entityType: 'meeting', entityId: meeting.id, type: 'Meeting', title: meeting.title || 'Meeting', date: meeting.date, time: meeting.time, bucket: deadlineBucket(meeting.date), status: meeting.status, clientId: meeting.clientId, projectId: meeting.projectId, nextAction: meeting.followUpActions || 'Prepare agenda' });
            }
        });
        workspace.proposals.forEach(proposal => {
            if (proposal.responseDate && !['accepted', 'rejected', 'expired'].includes(String(proposal.status || '').toLowerCase())) {
                deadlines.push({ entityType: 'proposal', entityId: proposal.id, type: proposal.type === 'contract' ? 'Contract' : 'Proposal', title: proposal.title || 'Proposal', date: proposal.responseDate, bucket: deadlineBucket(proposal.responseDate), status: proposal.status, clientId: proposal.clientId, projectId: proposal.projectId, nextAction: 'Follow up on response' });
            }
        });
        workspace.tasks.forEach(task => {
            if (task.dueDate && String(task.status || '').toLowerCase() !== 'completed') {
                deadlines.push({ entityType: 'task', entityId: task.id, type: 'Task', title: task.title || 'Task', date: task.dueDate, bucket: deadlineBucket(task.dueDate), status: task.status, clientId: task.clientId, projectId: task.projectId, nextAction: task.notes || 'Move task forward' });
            }
        });
        deadlines.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
        const trailingMonths = buildMonthSeries(6);
        const averageIncome = trailingMonths.length
            ? trailingMonths.reduce((total, month) => total + sum(workspace.finance.filter(item => item.type === 'income' && monthKey(item.date) === month.key), item => item.amount), 0) / trailingMonths.length
            : 0;
        const averageExpense = trailingMonths.length
            ? trailingMonths.reduce((total, month) => total + sum(workspace.finance.filter(item => item.type === 'expense' && monthKey(item.date) === month.key), item => item.amount), 0) / trailingMonths.length
            : 0;
        const mostActiveClient = (() => {
            const scores = new Map();
            const bump = (clientId) => {
                if (!clientId) return;
                scores.set(clientId, (scores.get(clientId) || 0) + 1);
            };
            workspace.meetings.filter(item => belongsToCurrentMonth(item.date)).forEach(item => bump(item.clientId));
            workspace.notes.filter(item => belongsToCurrentMonth(item.updatedAt || item.createdAt)).forEach(item => bump(item.clientId));
            workspace.invoices.filter(item => belongsToCurrentMonth(item.updatedAt || item.issueDate)).forEach(item => bump(item.clientId));
            const best = Array.from(scores.entries()).sort((a, b) => b[1] - a[1])[0];
            return best ? { clientId: best[0], count: best[1] } : null;
        })();

        const healthByProject = new Map();
        workspace.projects.forEach(project => healthByProject.set(project.id, projectHealth(project, related)));
        const healthAtRisk = activeProjects.filter(project => {
            const h = healthByProject.get(project.id);
            return h && h.score < 50;
        }).length;
        // A deliberately small, deterministic operating queue. It reuses the
        // existing deadline and health signals rather than inventing a second
        // task system, so every card still opens its canonical Business record.
        const queuePriority = { overdue: 120, today: 110, tomorrow: 95, 'this-week': 75, 'next-week': 55, later: 30 };
        const queued = new Map();
        const addQueueItem = (item) => {
            if (!item || !item.entityType || !item.entityId) return;
            const id = `${item.entityType}:${item.entityId}`;
            const current = queued.get(id);
            if (!current || item.priority > current.priority || (item.priority === current.priority && String(item.date || '') < String(current.date || ''))) queued.set(id, item);
        };
        deadlines.forEach(item => addQueueItem({
            ...item,
            priority: (queuePriority[item.bucket] || 0) + (item.type === 'Invoice' && item.bucket === 'overdue' ? 12 : 0),
            reason: item.bucket === 'overdue' ? 'Overdue — unblock it first' : item.bucket === 'today' ? 'Due today' : item.nextAction || 'Review next step'
        }));
        activeProjects.forEach(project => {
            const health = healthByProject.get(project.id);
            if (!health || health.score >= 50) return;
            addQueueItem({
                entityType: 'project', entityId: project.id, type: 'Project', title: project.name || 'Untitled project', date: project.dueDate || '',
                priority: 105 - health.score, reason: health.factors[0] || 'Project health needs attention', health
            });
        });
        const nextActions = Array.from(queued.values()).sort((a, b) => b.priority - a.priority || String(a.date || '').localeCompare(String(b.date || '')) || String(a.title).localeCompare(String(b.title))).slice(0, 6);
        // Probability-weighted pipeline + conversion (operator pipeline view).
        const weightedPipeline = sum(openOpportunities, item => normalizeFiniteNumber(item.value, 0) * (normalizeFiniteNumber(item.probability, 0) / 100));
        const wonCount = workspace.opportunities.filter(item => String(item.stage || '').toLowerCase() === 'won').length;
        const lostCount = workspace.opportunities.filter(item => String(item.stage || '').toLowerCase() === 'lost').length;
        const conversionRate = (wonCount + lostCount) ? Math.round((wonCount / (wonCount + lostCount)) * 100) : 0;

        return {
            workspace,
            ui,
            preferences,
            refs,
            related,
            deadlines,
            recentActivity,
            healthByProject,
            nextActions,
            metrics: {
                activeProjects: activeProjects.length,
                atRiskProjects: atRiskProjects.length,
                totalClients: workspace.clients.length,
                newLeads: workspace.clients.filter(item => ['lead', 'qualified'].includes(String(item.status || '').toLowerCase())).length,
                openInvoices: workspace.invoices.filter(item => !['paid', 'canceled'].includes(String(item.status || '').toLowerCase())).length,
                overdueInvoices: overdueInvoices.length,
                monthlyIncome: sum(monthlyIncome, item => item.amount) + sum(paidInvoicesWithoutFinance.filter(item => belongsToCurrentMonth(item.paidDate || item.updatedAt)), invoiceTotal),
                monthlyExpenses: sum(monthlyExpenses, item => item.amount),
                netCashFlow: sum(monthlyIncome, item => item.amount) - sum(monthlyExpenses, item => item.amount),
                upcomingDeadlines: deadlines.filter(item => ['today', 'tomorrow', 'this-week', 'next-week'].includes(item.bucket)).length,
                meetingsThisWeek: thisWeekMeetings.length,
                tasksDueToday: todayTasks.length,
                pipelineValue: sum(openOpportunities, item => item.value),
                weightedPipeline,
                conversionRate,
                healthAtRisk,
                recentActivityCount
            },
            contexts: {
                overdueInvoiceAmount: sum(overdueInvoices, invoiceTotal),
                projectsDueThisWeek: activeProjects.filter(item => {
                    const diff = daysUntil(item.dueDate);
                    return diff !== null && diff >= 0 && diff <= 7;
                }).length,
                topExpenseCategory: (() => {
                    const bucket = new Map();
                    monthlyExpenses.forEach(item => bucket.set(item.category || 'miscellaneous', (bucket.get(item.category || 'miscellaneous') || 0) + item.amount));
                    return Array.from(bucket.entries()).sort((a, b) => b[1] - a[1])[0] || ['miscellaneous', 0];
                })(),
                averageIncome,
                averageExpense,
                mostActiveClient
            }
        };
    }

    function pillTone(status) {
        const value = String(status || '').toLowerCase();
        if (['paid', 'completed', 'accepted', 'won', 'active', 'confirmed', 'ready'].includes(value)) return 'success';
        if (['overdue', 'blocked', 'at-risk', 'canceled', 'rejected', 'lost', 'expired'].includes(value)) return 'danger';
        if (['due-soon', 'draft', 'sent', 'lead', 'qualified', 'waiting', 'todo'].includes(value)) return 'warning';
        return 'neutral';
    }

    function renderPill(label, tone) {
        return `<span class="business-chip tone-${escapeText(tone || pillTone(label))}">${escapeText(label)}</span>`;
    }

    function renderEmptyState(title, subtitle, actionLabel, entityType) {
        return `
            <div class="empty-state business-empty-state">
                <div class="empty-title">${escapeText(title)}</div>
                <div class="empty-subtitle">${escapeText(subtitle)}</div>
                ${actionLabel && entityType ? `<button class="neumo-btn business-empty-action" type="button" data-biz-action="open-modal" data-entity="${escapeText(entityType)}">${escapeText(actionLabel)}</button>` : ''}
            </div>
        `;
    }

    function renderSectionHead(title, subtitle, section, actionLabel, entityType, extraControls = '') {
        const state = getSectionState(section);
        return `
            <div class="business-card-head business-section-head">
                <div>
                    <h3>${escapeText(title)}</h3>
                    <p>${escapeText(subtitle)}</p>
                </div>
                <div class="business-head-controls">
                    ${extraControls}
                    ${actionLabel && entityType ? `<button class="neumo-btn business-add-btn" type="button" data-biz-action="open-modal" data-entity="${escapeText(entityType)}">+ ${escapeText(actionLabel)}</button>` : ''}
                </div>
            </div>
            <div class="business-section-toolbar">
                <select class="modal-input business-inline-select" data-biz-control="filter" data-section="${escapeText(section)}">${renderFilterOptions(section, state.filter)}</select>
                <select class="modal-input business-inline-select" data-biz-control="view" data-section="${escapeText(section)}">${renderViewOptions(section, state.view)}</select>
                <select class="modal-input business-inline-select" data-biz-control="sort" data-section="${escapeText(section)}">${renderSortOptions(section, state.sort)}</select>
            </div>
        `;
    }

    function renderFilterOptions(section, active) {
        const filters = {
            projects: [['all', 'All'], ['active', 'Active'], ['at-risk', 'At Risk'], ['completed', 'Completed'], ['overdue', 'Overdue'], ['high-priority', 'High Priority']],
            clients: [['all', 'All'], ['leads', 'Leads'], ['active', 'Active Clients'], ['past', 'Past Clients'], ['follow-up', 'Follow-Up Due'], ['high-value', 'High Value'], ['stale', 'No Recent Contact']],
            invoices: [['all', 'All'], ['open', 'Open'], ['due-soon', 'Due Soon'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['draft', 'Draft']],
            finance: [['all', 'All'], ['income', 'Income'], ['expense', 'Expenses'], ['tax', 'Tax Relevant']],
            opportunities: [['open', 'Open'], ['won', 'Won'], ['lost', 'Lost'], ['high-value', 'High Value']],
            meetings: [['week', 'This Week'], ['upcoming', 'Upcoming'], ['completed', 'Completed'], ['canceled', 'Canceled']],
            proposals: [['active', 'Active'], ['sent', 'Sent'], ['accepted', 'Accepted'], ['rejected', 'Rejected']],
            tasks: [['today', 'Today'], ['upcoming', 'Upcoming'], ['overdue', 'Overdue'], ['completed', 'Completed']],
            documents: [['all', 'All'], ['contracts', 'Contracts'], ['receipts', 'Receipts'], ['deliverables', 'Deliverables']],
            goals: [['active', 'Active'], ['complete', 'Complete']],
            notes: [['all', 'All'], ['pinned', 'Pinned'], ['meeting', 'Meeting Notes'], ['recent', 'Recent']]
        };
        return (filters[section] || [['all', 'All']]).map(([value, label]) => `<option value="${escapeText(value)}"${value === active ? ' selected' : ''}>${escapeText(label)}</option>`).join('');
    }

    function renderViewOptions(section, active) {
        const views = {
            projects: [['cards', 'Cards'], ['list', 'List'], ['compact', 'Compact'], ['status', 'By Status'], ['client', 'By Client']],
            clients: [['cards', 'Cards'], ['list', 'List'], ['status', 'By Status'], ['company', 'By Company']],
            finance: [['list', 'List'], ['category', 'By Category'], ['month', 'By Month']],
            opportunities: [['stage', 'Pipeline'], ['list', 'List']],
            notes: [['cards', 'Cards'], ['list', 'List']]
        };
        return (views[section] || [['list', 'List']]).map(([value, label]) => `<option value="${escapeText(value)}"${value === active ? ' selected' : ''}>${escapeText(label)}</option>`).join('');
    }

    function renderSortOptions(section, active) {
        const options = {
            projects: [['due', 'Due Date'], ['priority', 'Priority'], ['recent', 'Recent'], ['name', 'Name']],
            clients: [['recent', 'Recent'], ['name', 'Name'], ['balance', 'Balance']],
            invoices: [['due', 'Due Date'], ['amount', 'Amount'], ['recent', 'Recent']],
            finance: [['recent', 'Recent'], ['amount', 'Amount'], ['category', 'Category']],
            opportunities: [['value', 'Value'], ['close', 'Expected Close'], ['recent', 'Recent']],
            meetings: [['date', 'Date'], ['recent', 'Recent']],
            proposals: [['recent', 'Recent'], ['value', 'Value']],
            tasks: [['due', 'Due Date'], ['priority', 'Priority'], ['recent', 'Recent']],
            documents: [['recent', 'Recent'], ['name', 'Name']],
            goals: [['progress', 'Progress'], ['due', 'Due Date']],
            notes: [['recent', 'Recent'], ['name', 'Title']]
        };
        return (options[section] || [['recent', 'Recent']]).map(([value, label]) => `<option value="${escapeText(value)}"${value === active ? ' selected' : ''}>${escapeText(label)}</option>`).join('');
    }

    function renderNoteTemplateQuickButtons(activeKey) {
        return NOTE_TEMPLATE_QUICK_KEYS
            .map(key => {
                const template = NOTE_TEMPLATES[key];
                if (!template) return '';
                const isActive = key === activeKey;
                return `<button class="neumo-btn business-mini-btn${isActive ? ' active' : ''}" type="button" data-biz-action="apply-template" data-template="${escapeText(key)}">${escapeText(template.label || key)}</button>`;
            })
            .join('');
    }

    function renderNoteTemplateOptions(activeKey) {
        return Object.entries(NOTE_TEMPLATES)
            .map(([key, value]) => `<option value="${escapeText(key)}"${key === activeKey ? ' selected' : ''}>${escapeText(value && value.label ? value.label : key)}</option>`)
            .join('');
    }

    function renderNoteTemplateModeOptions(activeMode) {
        return NOTE_TEMPLATE_MODES
            .map(([value, label]) => `<option value="${escapeText(value)}"${value === activeMode ? ' selected' : ''}>${escapeText(label)}</option>`)
            .join('');
    }

    function searchMatches(item, extraText = '') {
        const query = String(getUiState().search || '').trim().toLowerCase();
        if (!query) return true;
        const haystack = `${JSON.stringify(item || {})} ${extraText}`.toLowerCase();
        return haystack.includes(query);
    }

    function sortList(items, sortMode, resolver) {
        const list = items.slice();
        const sorters = resolver || {};
        const sorter = sorters[sortMode];
        if (!sorter) return list;
        return list.sort(sorter);
    }

    function openEntityModal(entityType, entityId = '', defaults = {}) {
        const state = getUiState();
        state.modal = { entityType, entityId, defaults: cloneValue(defaults || {}) };
        renderModal();
    }

    function clientLabel(model, clientId, fallback = 'Unassigned') {
        const client = model.refs.clients.get(clientId);
        return client ? (client.name || client.company || fallback) : fallback;
    }

    function projectLabel(model, projectId, fallback = 'Unlinked') {
        const project = model.refs.projects.get(projectId);
        return project ? (project.name || fallback) : fallback;
    }

    function clientBalance(model, clientId) {
        return sum(model.related.clientInvoices.get(clientId) || [], invoice => invoiceStatus(invoice) === 'paid' ? 0 : invoiceTotal(invoice));
    }

    function renderRecordActions(entityType, entityId, actions) {
        return `
            <div class="business-item-actions">
                ${actions.map(action => `<button class="neumo-btn business-mini-btn${action.danger ? ' danger' : ''}" type="button" data-biz-action="${escapeText(action.action)}" data-entity="${escapeText(entityType)}" data-id="${escapeText(entityId)}"${action.value ? ` data-value="${escapeText(action.value)}"` : ''}>${escapeText(action.label)}</button>`).join('')}
            </div>
        `;
    }

    function renderOverview(model) {
        const contexts = model.contexts;
        const metrics = model.metrics;
        const cards = [
            ['Active Projects', metrics.activeProjects, `${contexts.projectsDueThisWeek} due this week`, 'Planning, active, waiting, or blocked'],
            ['Projects At Risk', metrics.atRiskProjects, `${metrics.healthAtRisk} low health by score`, 'Blocked, slipping, or low health'],
            ['Total Clients', metrics.totalClients, `${model.workspace.clients.filter(item => item.company).length} company relationships`, model.contexts.mostActiveClient ? `${clientLabel(model, model.contexts.mostActiveClient.clientId)} is most active this month` : 'Leads, active clients, and past work'],
            ['New Leads', metrics.newLeads, `${model.workspace.opportunities.filter(isOpenOpportunity).length} active opportunities`, 'Qualified and ready-to-close relationships'],
            ['Open Invoices', metrics.openInvoices, `${currency(sum(model.workspace.invoices.filter(item => !['paid', 'canceled'].includes(String(item.status || '').toLowerCase())), invoiceTotal))} outstanding`, 'Receivables still in motion'],
            ['Overdue Invoices', metrics.overdueInvoices, `${currency(contexts.overdueInvoiceAmount)} overdue total`, 'Collections needing follow-up'],
            ['Monthly Income', metrics.monthlyIncome, metrics.monthlyIncome >= metrics.monthlyExpenses ? 'Above expenses this month' : 'Below monthly expenses', 'Income logged this month'],
            ['Monthly Expenses', metrics.monthlyExpenses, `${slugLabel(contexts.topExpenseCategory[0])} is top category`, 'Operating spend this month'],
            ['Net Cash Flow', metrics.netCashFlow, metrics.netCashFlow >= 0 ? 'Positive this month' : 'Negative this month', 'Income minus expenses'],
            ['Upcoming Deadlines', metrics.upcomingDeadlines, `${model.deadlines.filter(item => item.bucket === 'today').length} due today`, 'Projects, meetings, invoices, and follow-ups'],
            ['Meetings This Week', metrics.meetingsThisWeek, `${model.workspace.meetings.filter(item => String(item.status || '').toLowerCase() === 'completed').length} completed overall`, 'Calls and check-ins on the calendar'],
            ['Tasks Due Today', metrics.tasksDueToday, `${model.workspace.tasks.filter(item => String(item.status || '').toLowerCase() !== 'completed').length} open business tasks`, 'Operations tasks due now'],
            ['Pipeline Value', metrics.pipelineValue, `${currency(metrics.weightedPipeline)} weighted · ${metrics.conversionRate}% win`, 'Open opportunities and probability-weighted value'],
            ['Recent Activity Count', metrics.recentActivityCount, `${model.recentActivity.slice(0, 1).map(item => item.title || item.description || 'No recent updates')[0] || 'No recent updates'}`, 'Activity logged in the last 7 days']
        ];
        return `
            <article class="glass-card business-card business-hero-card">
                <div class="business-card-head business-hero-head">
                    <div>
                        <h3>Overview</h3>
                        <p>Business health, quick actions, and search across the operating workspace.</p>
                    </div>
                    <div class="business-head-controls business-global-controls">
                        <input class="modal-input business-search-input" type="search" placeholder="Search business records" value="${escapeText(model.ui.search || '')}" data-biz-control="search">
                        <button class="neumo-btn business-density-toggle${model.ui.compact ? ' active' : ''}" type="button" data-biz-action="toggle-compact">${model.ui.compact ? 'Expanded' : 'Compact'}</button>
                    </div>
                </div>
                <div class="business-overview-grid">
                    ${cards.map(([label, value, meta, detail]) => `
                        <article class="business-metric">
                            <span class="business-metric-label">${escapeText(label)}</span>
                            <strong>${formatMetricValue(label, value)}</strong>
                            <span class="business-metric-meta">${escapeText(meta)}</span>
                            <span class="business-metric-context">${escapeText(detail)}</span>
                        </article>
                    `).join('')}
                </div>
                <div class="business-quick-actions">
                    ${QUICK_ACTIONS.map(action => `
                        <button class="neumo-btn business-quick-action" type="button" data-biz-action="${action.action || 'open-modal'}"${action.entity ? ` data-entity="${escapeText(action.entity)}"` : ''}${action.defaults ? ` data-defaults="${escapeText(JSON.stringify(action.defaults))}"` : ''}>
                            <i class="fas ${escapeText(action.icon)}" aria-hidden="true"></i>
                            <span>${escapeText(action.label)}</span>
                        </button>
                    `).join('')}
                </div>
            </article>
        `;
    }

    function renderAnalytics(model) {
        const months = buildMonthSeries(6);
        const financeSeries = months.map(month => ({
            label: month.label,
            income: sum(model.workspace.finance.filter(item => item.type === 'income' && monthKey(item.date) === month.key), item => item.amount),
            expense: sum(model.workspace.finance.filter(item => item.type === 'expense' && monthKey(item.date) === month.key), item => item.amount)
        }));
        const maxFinance = Math.max(1, ...financeSeries.flatMap(item => [item.income, item.expense]));
        const invoiceCounts = ['paid', 'sent', 'due-soon', 'overdue', 'draft'].map(status => ({
            label: slugLabel(status),
            value: model.workspace.invoices.filter(item => invoiceStatus(item) === status).length
        }));
        const projectCounts = PROJECT_STATUS_OPTIONS.map(option => ({
            label: option[1],
            value: model.workspace.projects.filter(item => String(item.status || '').toLowerCase() === option[0]).length
        })).filter(item => item.value > 0);
        const pipelineCounts = OPPORTUNITY_STAGE_OPTIONS.map(option => ({
            label: option[1],
            value: sum(model.workspace.opportunities.filter(item => String(item.stage || '').toLowerCase() === option[0]), item => item.value)
        })).filter(item => item.value > 0);
        const hasFinanceData = financeSeries.some(item => item.income > 0 || item.expense > 0);
        const hasInvoiceData = invoiceCounts.some(item => item.value > 0);
        return `
            <div class="business-analytics-grid">
                <article class="glass-card business-card business-chart-card">
                    <div class="business-card-head"><h3>Income vs Expenses</h3></div>
                    ${hasFinanceData
                        ? `<div class="business-chart business-bar-chart">
                        ${financeSeries.map(item => `
                            <div class="business-bar-group">
                                <div class="business-bar-pair">
                                    <span class="business-bar income" style="height:${Math.max(8, percent(item.income, maxFinance))}%"></span>
                                    <span class="business-bar expense" style="height:${Math.max(8, percent(item.expense, maxFinance))}%"></span>
                                </div>
                                <span class="business-bar-label">${escapeText(item.label)}</span>
                            </div>
                        `).join('')}
                    </div>`
                        : '<p class="business-muted-copy business-chart-empty">No income or expense entries yet.</p>'}
                </article>
                <article class="glass-card business-card business-chart-card">
                    <div class="business-card-head"><h3>Paid vs Unpaid Invoices</h3></div>
                    ${hasInvoiceData
                        ? `<div class="business-stacked-list">
                        ${invoiceCounts.map(item => `<div class="business-stacked-row"><span>${escapeText(item.label)}</span><strong>${escapeText(String(item.value))}</strong></div>`).join('')}
                    </div>`
                        : '<p class="business-muted-copy business-chart-empty">No invoice data yet.</p>'}
                </article>
                <article class="glass-card business-card business-chart-card">
                    <div class="business-card-head"><h3>Project Status Distribution</h3></div>
                    <div class="business-distribution-list">
                        ${projectCounts.length ? projectCounts.map(item => `<div class="business-distribution-row"><span>${escapeText(item.label)}</span><div class="business-distribution-bar"><span style="width:${percent(item.value, model.workspace.projects.length || 1)}%"></span></div><strong>${escapeText(String(item.value))}</strong></div>`).join('') : '<p class="business-muted-copy">No project status data yet.</p>'}
                    </div>
                </article>
                <article class="glass-card business-card business-chart-card">
                    <div class="business-card-head"><h3>Pipeline Stage Distribution</h3></div>
                    <div class="business-distribution-list">
                        ${pipelineCounts.length ? pipelineCounts.map(item => `<div class="business-distribution-row"><span>${escapeText(item.label)}</span><div class="business-distribution-bar accent"><span style="width:${percent(item.value, Math.max(1, model.metrics.pipelineValue))}%"></span></div><strong>${currency(item.value)}</strong></div>`).join('') : '<p class="business-muted-copy">No opportunity data yet.</p>'}
                    </div>
                </article>
            </div>
        `;
    }

    function formatMetricValue(label, value) {
        const text = String(label || '').toLowerCase();
        if (typeof value === 'number' && (text.includes('income') || text.includes('expenses') || text.includes('cash') || text.includes('pipeline'))) {
            return currency(value);
        }
        return escapeText(String(value));
    }

    function projectList(model) {
        const state = getSectionState('projects');
        const list = model.workspace.projects.filter(item => searchMatches(item, clientLabel(model, item.clientId)));
        const filtered = list.filter(item => {
            const status = String(item.status || '').toLowerCase();
            if (state.filter === 'active') return ['planning', 'active', 'waiting', 'blocked', 'at-risk'].includes(status);
            if (state.filter === 'at-risk') return item.riskFlag || ['blocked', 'at-risk'].includes(status);
            if (state.filter === 'completed') return status === 'completed';
            if (state.filter === 'overdue') return daysUntil(item.dueDate) !== null && daysUntil(item.dueDate) < 0 && status !== 'completed';
            if (state.filter === 'high-priority') return ['high', 'urgent'].includes(String(item.priority || '').toLowerCase());
            return true;
        });
        return sortList(filtered, state.sort, {
            due: (a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')),
            priority: (a, b) => ['urgent', 'high', 'medium', 'low'].indexOf(String(a.priority || '').toLowerCase()) - ['urgent', 'high', 'medium', 'low'].indexOf(String(b.priority || '').toLowerCase()),
            recent: (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
            name: (a, b) => String(a.name || '').localeCompare(String(b.name || ''))
        });
    }

    function renderOperatingQueue(model) {
        const items = model.nextActions || [];
        return `
            <article class="glass-card business-card business-side-card business-operating-queue">
                <div class="business-card-head">
                    <div><h3>Run the business</h3><p>The next few local actions with the highest operational urgency.</p></div>
                </div>
                ${items.length ? `<div class="business-list">${items.map(item => `
                    <article class="business-item-card compact business-queue-item">
                        <div class="business-item-top"><strong>${escapeText(item.title)}</strong>${renderPill(item.bucket ? slugLabel(item.bucket) : (item.health ? item.health.label : item.type))}</div>
                        <div class="business-item-sub">${escapeText(item.reason || item.nextAction || 'Review next step')}</div>
                        <div class="business-item-meta"><span>${escapeText(item.date ? relativeDueLabel(item.date) : 'No date')}</span><span>${escapeText(item.type)}</span></div>
                        <div class="business-item-actions">
                            <button class="neumo-btn business-mini-btn" type="button" data-biz-action="select-detail" data-entity="${escapeText(item.entityType)}" data-id="${escapeText(item.entityId)}">Open</button>
                            ${item.entityType === 'task' ? `<button class="neumo-btn business-mini-btn" type="button" data-biz-action="mark-complete" data-entity="task" data-id="${escapeText(item.entityId)}">Complete</button>` : ''}
                        </div>
                    </article>
                `).join('')}</div>` : renderEmptyState('No urgent actions', 'As work, invoices, and follow-ups gain dates, the most urgent items will appear here.', 'New Project', 'project')}
            </article>
        `;
    }

    function renderProjectCard(model, project, compact = false) {
        const projectInvoices = model.related.projectInvoices.get(project.id) || [];
        const projectMeetings = model.related.projectMeetings.get(project.id) || [];
        const projectNotes = model.related.projectNotes.get(project.id) || [];
        const statusLabel = slugLabel(project.status);
        const health = (model.healthByProject && model.healthByProject.get(project.id)) || projectHealth(project, model.related);
        return `
            <article class="business-item-card${compact ? ' compact' : ''}" data-biz-action="select-detail" data-entity="project" data-id="${escapeText(project.id)}">
                <div class="business-item-top">
                    <div>
                        <strong>${escapeText(project.name || 'Untitled project')}</strong>
                        <div class="business-item-sub">${escapeText(project.description || project.nextStep || 'No project summary yet.')}</div>
                    </div>
                    ${renderPill(statusLabel)}
                </div>
                <div class="business-item-meta">
                    <span>${escapeText(clientLabel(model, project.clientId))}</span>
                    <span>${escapeText(relativeDueLabel(project.dueDate))}</span>
                    <span>${escapeText(slugLabel(project.priority || 'medium'))}</span>
                    <span>${escapeText(`${project.completionPercent || 0}% complete`)}</span>
                </div>
                <div class="business-item-meta">
                    <span>${currency(project.budget || 0)} budget</span>
                    <span>${currency(project.actualRevenue || 0)} actual</span>
                    <span>${escapeText(`${project.loggedHours || 0}/${project.estimatedHours || 0}h`)}</span>
                    <span>${escapeText(`${projectInvoices.length} invoices`)}</span>
                    <span>${escapeText(`${projectMeetings.length} meetings`)}</span>
                    <span>${escapeText(`${projectNotes.length} notes`)}</span>
                </div>
                <div class="business-health">
                    <div class="business-health-top"><span class="business-health-label">Health</span>${renderPill(`${health.label} · ${health.score}`, health.tone)}</div>
                    <div class="business-health-bar"><span class="tone-${escapeText(health.tone)}" style="width:${health.score}%"></span></div>
                    ${health.factors.length ? `<div class="business-health-factors">${escapeText(health.factors.slice(0, 3).join(' · '))}</div>` : ''}
                </div>
                ${renderRecordActions('project', project.id, [
                    { label: 'Edit', action: 'open-modal' },
                    { label: 'Complete', action: 'mark-complete' },
                    { label: 'Duplicate', action: 'duplicate-entity' },
                    { label: 'Archive', action: 'archive-entity' },
                    { label: 'Delete', action: 'delete-entity', danger: true }
                ])}
            </article>
        `;
    }

    function renderProjects(model) {
        const state = getSectionState('projects');
        const items = projectList(model);
        const groupBy = state.view === 'status'
            ? (item => slugLabel(item.status))
            : state.view === 'client'
                ? (item => clientLabel(model, item.clientId))
                : null;
        const content = !items.length
            ? renderEmptyState('No projects yet', 'Create your first project to track deadlines, priorities, linked invoices, and next actions.', 'Project', 'project')
            : groupBy
                ? Array.from(items.reduce((map, item) => {
                    const key = groupBy(item) || 'Unassigned';
                    if (!map.has(key)) map.set(key, []);
                    map.get(key).push(item);
                    return map;
                }, new Map()).entries()).map(([label, group]) => `
                    <div class="business-group">
                        <div class="business-group-title">${escapeText(label)} <span>${escapeText(String(group.length))}</span></div>
                        <div class="business-list">${group.map(item => renderProjectCard(model, item, state.view === 'compact' || model.preferences.compactCards)).join('')}</div>
                    </div>
                `).join('')
                : `<div class="business-list">${items.map(item => renderProjectCard(model, item, state.view === 'compact' || model.preferences.compactCards)).join('')}</div>`;
        return `
            <article class="glass-card business-card business-section-card">
                ${renderSectionHead('Projects / Work Tracker', 'Track scope, milestones, revenue, risk, and linked delivery context.', 'projects', 'Project', 'project')}
                ${content}
            </article>
        `;
    }

    function clientList(model) {
        const state = getSectionState('clients');
        const list = model.workspace.clients.filter(item => searchMatches(item, `${item.company} ${item.industry}`));
        const filtered = list.filter(item => {
            const status = String(item.status || '').toLowerCase();
            if (state.filter === 'leads') return ['lead', 'qualified'].includes(status);
            if (state.filter === 'active') return status === 'active';
            if (state.filter === 'past') return status === 'past-client';
            if (state.filter === 'follow-up') return ['today', 'tomorrow', 'this-week', 'overdue'].includes(deadlineBucket(item.nextFollowUpDate));
            if (state.filter === 'high-value') return clientBalance(model, item.id) >= 3000 || sum(model.related.clientProjects.get(item.id) || [], project => project.actualRevenue) >= 5000;
            if (state.filter === 'stale') return !item.lastContactDate || (daysUntil(item.lastContactDate) !== null && daysUntil(item.lastContactDate) < -21);
            return true;
        });
        return sortList(filtered, state.sort, {
            recent: (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
            name: (a, b) => String(a.name || a.company || '').localeCompare(String(b.name || b.company || '')),
            balance: (a, b) => clientBalance(model, b.id) - clientBalance(model, a.id)
        });
    }

    function renderClientCard(model, client) {
        const projects = model.related.clientProjects.get(client.id) || [];
        const invoices = model.related.clientInvoices.get(client.id) || [];
        const meetings = model.related.clientMeetings.get(client.id) || [];
        return `
            <article class="business-item-card" data-biz-action="select-detail" data-entity="client" data-id="${escapeText(client.id)}">
                <div class="business-item-top">
                    <div>
                        <strong>${escapeText(client.name || client.company || 'Unnamed client')}</strong>
                        <div class="business-item-sub">${escapeText(client.company || client.role || client.industry || 'Independent relationship')}</div>
                    </div>
                    ${renderPill(slugLabel(client.status))}
                </div>
                <div class="business-item-meta">
                    <span>${escapeText(client.email || 'No email')}</span>
                    <span>${escapeText(client.phone || 'No phone')}</span>
                    <span>${escapeText(client.location || 'No location')}</span>
                </div>
                <div class="business-item-meta">
                    <span>${escapeText(`${projects.length} projects`)}</span>
                    <span>${escapeText(`${invoices.length} invoices`)}</span>
                    <span>${escapeText(`${meetings.length} meetings`)}</span>
                    <span>${currency(clientBalance(model, client.id))} outstanding</span>
                </div>
                ${renderRecordActions('client', client.id, [
                    { label: 'Edit', action: 'open-modal' },
                    { label: 'Follow-Up', action: 'quick-follow-up' },
                    { label: 'Invoice', action: 'quick-invoice' },
                    { label: 'Project', action: 'quick-project' },
                    { label: 'Delete', action: 'delete-entity', danger: true }
                ])}
            </article>
        `;
    }

    function renderClients(model) {
        const state = getSectionState('clients');
        const items = clientList(model);
        const groupBy = state.view === 'status'
            ? (item => slugLabel(item.status))
            : state.view === 'company'
                ? (item => item.company || 'Independent')
                : null;
        const content = !items.length
            ? renderEmptyState('No clients yet', 'Add a client to connect projects, invoices, meetings, proposals, and notes.', 'Client', 'client')
            : groupBy
                ? Array.from(items.reduce((map, item) => {
                    const key = groupBy(item);
                    if (!map.has(key)) map.set(key, []);
                    map.get(key).push(item);
                    return map;
                }, new Map()).entries()).map(([label, group]) => `
                    <div class="business-group">
                        <div class="business-group-title">${escapeText(label)} <span>${escapeText(String(group.length))}</span></div>
                        <div class="business-list">${group.map(item => renderClientCard(model, item)).join('')}</div>
                    </div>
                `).join('')
                : `<div class="business-list">${items.map(item => renderClientCard(model, item)).join('')}</div>`;
        return `
            <article class="glass-card business-card business-section-card">
                ${renderSectionHead('Clients / Contacts', 'A lightweight CRM for lead stages, follow-ups, balance, and relationship context.', 'clients', 'Client', 'client')}
                ${content}
            </article>
        `;
    }

    function invoiceList(model) {
        const state = getSectionState('invoices');
        const list = model.workspace.invoices.filter(item => searchMatches(item, `${clientLabel(model, item.clientId)} ${projectLabel(model, item.projectId)}`));
        const filtered = list.filter(item => {
            const status = invoiceStatus(item);
            if (state.filter === 'open') return !['paid', 'canceled'].includes(String(item.status || '').toLowerCase());
            if (state.filter === 'paid') return status === 'paid';
            if (state.filter === 'due-soon') return status === 'due-soon';
            if (state.filter === 'overdue') return status === 'overdue';
            if (state.filter === 'draft') return status === 'draft';
            return true;
        });
        return sortList(filtered, state.sort, {
            due: (a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')),
            amount: (a, b) => invoiceTotal(b) - invoiceTotal(a),
            recent: (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
        });
    }

    // Prominent, actionable nudge when invoices are past due. The count + total
    // are already computed in buildModel().metrics; this elevates them from a
    // quiet stat into a call to action at the top of the workspace.
    function renderOverdueInvoiceBanner(model) {
        const count = model.metrics.overdueInvoices || 0;
        if (count <= 0) return '';
        const amount = (model.contexts && model.contexts.overdueInvoiceAmount) || 0;
        return `
            <article class="glass-card business-card business-overdue-banner" role="alert">
                <div class="business-overdue-icon"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i></div>
                <div class="business-overdue-copy">
                    <strong>${count} invoice${count > 1 ? 's' : ''} overdue</strong>
                    <span>${currency(amount)} outstanding — follow up to get paid.</span>
                </div>
                <button class="neumo-btn business-overdue-btn" type="button" data-biz-action="review-overdue-invoices">Review overdue</button>
            </article>`;
    }

    function renderInvoices(model) {
        const items = invoiceList(model);
        return `
            <article id="business-invoices-section" class="glass-card business-card business-section-card">
                ${renderSectionHead('Invoices / Payments', 'Track invoice lifecycles, due soon logic, overdue balances, and payment state.', 'invoices', 'Invoice', 'invoice')}
                <div class="business-inline-summary">
                    <span>${currency(sum(model.workspace.invoices.filter(item => invoiceStatus(item) === 'paid'), invoiceTotal))} paid</span>
                    <span>${currency(sum(model.workspace.invoices.filter(item => ['sent', 'due-soon', 'overdue', 'draft'].includes(invoiceStatus(item))), invoiceTotal))} unpaid</span>
                    <span>${model.workspace.invoices.filter(item => invoiceStatus(item) === 'overdue').length} overdue</span>
                </div>
                ${items.length ? `<div class="business-list">${items.map(invoice => `
                    <article class="business-item-card" data-biz-action="select-detail" data-entity="invoice" data-id="${escapeText(invoice.id)}">
                        <div class="business-item-top">
                            <div>
                                <strong>${escapeText(invoice.title || invoice.invoiceNumber || 'Untitled invoice')}</strong>
                                <div class="business-item-sub">${escapeText(clientLabel(model, invoice.clientId))}</div>
                            </div>
                            ${renderPill(slugLabel(invoiceStatus(invoice)), invoiceStatus(invoice))}
                        </div>
                        <div class="business-item-meta">
                            <span>${currency(invoiceTotal(invoice), invoice.currency)}</span>
                            <span>${escapeText(`Due ${longDate(invoice.dueDate)}`)}</span>
                            <span>${escapeText(projectLabel(model, invoice.projectId, 'No linked project'))}</span>
                        </div>
                        ${renderRecordActions('invoice', invoice.id, [
                            { label: 'Edit', action: 'open-modal' },
                            { label: 'Sent', action: 'set-status', value: 'sent' },
                            { label: 'Paid', action: 'set-status', value: 'paid' },
                            { label: 'Unpaid', action: 'set-status', value: 'draft' },
                            { label: 'Delete', action: 'delete-entity', danger: true }
                        ])}
                    </article>
                `).join('')}</div>` : renderEmptyState('No invoices yet', 'Create invoices to track due soon, overdue, paid, and draft balances.', 'Invoice', 'invoice')}
            </article>
        `;
    }

    function financeList(model) {
        const state = getSectionState('finance');
        const list = model.workspace.finance.filter(item => searchMatches(item, `${clientLabel(model, item.clientId)} ${projectLabel(model, item.projectId)} ${item.category}`));
        const filtered = list.filter(item => {
            if (state.filter === 'income') return item.type === 'income';
            if (state.filter === 'expense') return item.type === 'expense';
            if (state.filter === 'tax') return !!item.taxRelevant;
            return true;
        });
        return sortList(filtered, state.sort, {
            recent: (a, b) => String(b.date || '').localeCompare(String(a.date || '')),
            amount: (a, b) => b.amount - a.amount,
            category: (a, b) => String(a.category || '').localeCompare(String(b.category || ''))
        });
    }

    function renderFinance(model) {
        const state = getSectionState('finance');
        const items = financeList(model);
        const grouped = state.view === 'category' || state.view === 'month'
            ? Array.from(items.reduce((map, item) => {
                const key = state.view === 'month' ? monthKey(item.date) || 'Undated' : slugLabel(item.category || 'miscellaneous');
                if (!map.has(key)) map.set(key, []);
                map.get(key).push(item);
                return map;
            }, new Map()).entries())
            : null;
        return `
            <article class="glass-card business-card business-section-card">
                ${renderSectionHead('Income / Expenses', 'Local-first cash flow tracking with category, tax, client, and project links.', 'finance', 'Entry', 'finance')}
                <div class="business-inline-summary">
                    <span>${currency(model.metrics.monthlyIncome)} income this month</span>
                    <span>${currency(model.metrics.monthlyExpenses)} expenses this month</span>
                    <span>${currency(model.metrics.netCashFlow)} net</span>
                    <span>${currency(model.contexts.averageIncome)} avg income</span>
                    <span>${currency(model.contexts.averageExpense)} avg expense</span>
                </div>
                ${items.length ? (grouped ? grouped.map(([label, group]) => `
                    <div class="business-group">
                        <div class="business-group-title">${escapeText(label)} <span>${currency(sum(group, item => item.amount))}</span></div>
                        <div class="business-list">${group.map(entry => `
                            <article class="business-item-card" data-biz-action="select-detail" data-entity="finance" data-id="${escapeText(entry.id)}">
                                <div class="business-item-top">
                                    <strong>${escapeText(slugLabel(entry.category || 'miscellaneous'))}</strong>
                                    ${renderPill(slugLabel(entry.type))}
                                </div>
                                <div class="business-item-meta">
                                    <span>${currency(entry.amount)}</span>
                                    <span>${escapeText(longDate(entry.date))}</span>
                                    <span>${escapeText(clientLabel(model, entry.clientId))}</span>
                                </div>
                            </article>
                        `).join('')}</div>
                    </div>
                `).join('') : `<div class="business-list">${items.map(entry => `
                    <article class="business-item-card" data-biz-action="select-detail" data-entity="finance" data-id="${escapeText(entry.id)}">
                        <div class="business-item-top">
                            <div>
                                <strong>${escapeText(slugLabel(entry.category || 'miscellaneous'))}</strong>
                                <div class="business-item-sub">${escapeText(entry.notes || entry.subcategory || 'No finance notes yet.')}</div>
                            </div>
                            ${renderPill(slugLabel(entry.type))}
                        </div>
                        <div class="business-item-meta">
                            <span>${currency(entry.amount)}</span>
                            <span>${escapeText(longDate(entry.date))}</span>
                            <span>${escapeText(projectLabel(model, entry.projectId, clientLabel(model, entry.clientId)))}</span>
                        </div>
                        ${renderRecordActions('finance', entry.id, [
                            { label: 'Edit', action: 'open-modal' },
                            { label: 'Duplicate', action: 'duplicate-entity' },
                            { label: 'Delete', action: 'delete-entity', danger: true }
                        ])}
                    </article>
                `).join('')}</div>`) : renderEmptyState('No finance entries yet', 'Log income and expenses to see business cash flow, category breakdowns, and recent financial trends.', 'Entry', 'finance')}
            </article>
        `;
    }

    function renderOpportunities(model) {
        const state = getSectionState('opportunities');
        let items = model.workspace.opportunities.filter(item => searchMatches(item, `${item.company} ${clientLabel(model, item.clientId)}`));
        items = items.filter(item => {
            if (state.filter === 'open') return isOpenOpportunity(item);
            if (state.filter === 'won') return String(item.stage || '').toLowerCase() === 'won';
            if (state.filter === 'lost') return String(item.stage || '').toLowerCase() === 'lost';
            if (state.filter === 'high-value') return item.value >= 3000;
            return true;
        });
        items = sortList(items, state.sort, {
            value: (a, b) => b.value - a.value,
            close: (a, b) => String(a.expectedCloseDate || '').localeCompare(String(b.expectedCloseDate || '')),
            recent: (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
        });
        const columns = OPPORTUNITY_STAGE_OPTIONS.map(option => [option[1], items.filter(item => String(item.stage || '').toLowerCase() === option[0])]);
        return `
            <article class="glass-card business-card business-section-card">
                ${renderSectionHead('Pipeline / Opportunities', 'Track deal stages, expected close timing, probability, and weighted pipeline value.', 'opportunities', 'Opportunity', 'opportunity')}
                <div class="business-pipeline-summary">
                    <div><span>Open pipeline</span><strong>${currency(model.metrics.pipelineValue)}</strong></div>
                    <div><span>Weighted by probability</span><strong>${currency(model.metrics.weightedPipeline)}</strong></div>
                    <div><span>Win rate</span><strong>${escapeText(String(model.metrics.conversionRate))}%</strong></div>
                </div>
                ${items.length ? (state.view === 'stage'
                    ? `<div class="business-board">${columns.map(([label, group]) => `
                        <div class="business-board-column">
                            <div class="business-board-head"><span>${escapeText(label)}</span><strong>${currency(sum(group, item => item.value))}</strong></div>
                            <div class="business-list">${group.length ? group.map(item => `
                                <article class="business-item-card compact" data-biz-action="select-detail" data-entity="opportunity" data-id="${escapeText(item.id)}">
                                    <div class="business-item-top"><strong>${escapeText(item.name || 'Opportunity')}</strong>${renderPill(`${item.probability || 0}%`, 'neutral')}</div>
                                    <div class="business-item-meta"><span>${currency(item.value)}</span><span>${escapeText(relativeDueLabel(item.expectedCloseDate))}</span></div>
                                </article>
                            `).join('') : '<div class="business-muted-copy">No deals</div>'}</div>
                        </div>
                    `).join('')}</div>`
                    : `<div class="business-list">${items.map(item => `
                        <article class="business-item-card" data-biz-action="select-detail" data-entity="opportunity" data-id="${escapeText(item.id)}">
                            <div class="business-item-top"><strong>${escapeText(item.name || 'Opportunity')}</strong>${renderPill(slugLabel(item.stage))}</div>
                            <div class="business-item-meta"><span>${currency(item.value)}</span><span>${escapeText(item.company || clientLabel(model, item.clientId))}</span><span>${escapeText(`${item.probability || 0}% probability`)}</span></div>
                            ${renderRecordActions('opportunity', item.id, [
                                { label: 'Edit', action: 'open-modal' },
                                { label: 'Proposal', action: 'proposal-from-opportunity' },
                                { label: 'Delete', action: 'delete-entity', danger: true }
                            ])}
                        </article>
                    `).join('')}</div>`)
                    : renderEmptyState('No opportunities yet', 'Add leads and opportunities to track stage movement, follow-ups, and expected value.', 'Opportunity', 'opportunity')}
            </article>
        `;
    }

    function renderMeetings(model) {
        const state = getSectionState('meetings');
        let items = model.workspace.meetings.filter(item => searchMatches(item, `${clientLabel(model, item.clientId)} ${projectLabel(model, item.projectId)} ${item.purpose}`));
        items = items.filter(item => {
            const status = String(item.status || '').toLowerCase();
            if (state.filter === 'week') return ['today', 'tomorrow', 'this-week'].includes(deadlineBucket(item.date));
            if (state.filter === 'upcoming') return ['today', 'tomorrow', 'this-week', 'next-week'].includes(deadlineBucket(item.date));
            if (state.filter === 'completed') return status === 'completed';
            if (state.filter === 'canceled') return status === 'canceled';
            return true;
        });
        items = sortList(items, state.sort, {
            date: (a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.time || '').localeCompare(String(b.time || '')),
            recent: (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
        });
        return `
            <article class="glass-card business-card business-section-card">
                ${renderSectionHead('Meetings / Calls', 'Keep meetings, follow-up actions, links, and purpose tied to the right client or project.', 'meetings', 'Meeting', 'meeting')}
                ${items.length ? `<div class="business-list">${items.map(item => `
                    <article class="business-item-card" data-biz-action="select-detail" data-entity="meeting" data-id="${escapeText(item.id)}">
                        <div class="business-item-top"><strong>${escapeText(item.title || 'Meeting')}</strong>${renderPill(slugLabel(item.status))}</div>
                        <div class="business-item-meta"><span>${escapeText(`${longDate(item.date)}${item.time ? `, ${item.time}` : ''}`)}</span><span>${escapeText(clientLabel(model, item.clientId))}</span><span>${escapeText(item.location || 'No location')}</span></div>
                        ${item.purpose ? `<div class="business-item-sub">${escapeText(item.purpose)}</div>` : ''}
                        ${item.agenda ? `<div class="business-meeting-line"><strong>Agenda:</strong> ${escapeText(item.agenda)}</div>` : ''}
                        ${item.decisions ? `<div class="business-meeting-line"><strong>Decisions:</strong> ${escapeText(item.decisions)}</div>` : ''}
                        <div class="business-item-sub">${escapeText(item.followUpActions ? `Follow-ups: ${item.followUpActions}` : (item.purpose ? '' : 'No follow-up actions yet.'))}</div>
                        ${renderRecordActions('meeting', item.id, [
                            { label: 'Edit', action: 'open-modal' },
                            { label: 'Schedule', action: 'schedule-meeting' },
                            { label: 'Create Note', action: 'quick-note' },
                            { label: 'Delete', action: 'delete-entity', danger: true }
                        ])}
                    </article>
                `).join('')}</div>` : renderEmptyState('No meetings scheduled', 'Schedule meetings and calls to attach notes, follow-ups, and relationship history.', 'Meeting', 'meeting')}
            </article>
        `;
    }

    function renderTasks(model) {
        const state = getSectionState('tasks');
        let items = model.workspace.tasks.filter(item => searchMatches(item, `${clientLabel(model, item.clientId)} ${projectLabel(model, item.projectId)} ${item.category}`));
        items = items.filter(item => {
            const status = String(item.status || '').toLowerCase();
            const bucket = deadlineBucket(item.dueDate);
            if (state.filter === 'today') return bucket === 'today' && status !== 'completed';
            if (state.filter === 'upcoming') return ['tomorrow', 'this-week', 'next-week'].includes(bucket) && status !== 'completed';
            if (state.filter === 'overdue') return bucket === 'overdue' && status !== 'completed';
            if (state.filter === 'completed') return status === 'completed';
            return true;
        });
        items = sortList(items, state.sort, {
            due: (a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')),
            priority: (a, b) => ['urgent', 'high', 'medium', 'low'].indexOf(String(a.priority || '').toLowerCase()) - ['urgent', 'high', 'medium', 'low'].indexOf(String(b.priority || '').toLowerCase()),
            recent: (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
        });
        return `
            <article class="glass-card business-card business-section-card">
                ${renderSectionHead('Business Tasks / Operations', 'Run follow-ups, ops work, internal admin, and delivery tasks from one queue.', 'tasks', 'Task', 'task')}
                ${items.length ? `<div class="business-list">${items.map(item => `
                    <article class="business-item-card" data-biz-action="select-detail" data-entity="task" data-id="${escapeText(item.id)}">
                        <div class="business-item-top"><strong>${escapeText(item.title || 'Task')}</strong>${renderPill(slugLabel(item.status))}</div>
                        <div class="business-item-meta"><span>${escapeText(item.category || 'General')}</span><span>${escapeText(relativeDueLabel(item.dueDate))}</span><span>${escapeText(slugLabel(item.priority || 'medium'))}</span></div>
                        <div class="business-item-sub">${escapeText(item.notes || `${clientLabel(model, item.clientId)} ${projectLabel(model, item.projectId)}`)}</div>
                        ${renderRecordActions('task', item.id, [
                            { label: 'Edit', action: 'open-modal' },
                            { label: 'Done', action: 'set-status', value: 'completed' },
                            { label: 'Delete', action: 'delete-entity', danger: true }
                        ])}
                    </article>
                `).join('')}</div>` : renderEmptyState('No business tasks yet', 'Add tasks for follow-ups, admin, deliverables, and operational work.', 'Task', 'task')}
            </article>
        `;
    }

    function renderProposals(model) {
        const state = getSectionState('proposals');
        let items = model.workspace.proposals.filter(item => searchMatches(item, `${clientLabel(model, item.clientId)} ${projectLabel(model, item.projectId)}`));
        items = items.filter(item => {
            const status = String(item.status || '').toLowerCase();
            if (state.filter === 'active') return !['accepted', 'rejected', 'expired'].includes(status);
            if (state.filter === 'sent') return ['sent', 'viewed'].includes(status);
            if (state.filter === 'accepted') return status === 'accepted';
            if (state.filter === 'rejected') return status === 'rejected';
            return true;
        });
        items = sortList(items, state.sort, {
            recent: (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
            value: (a, b) => b.value - a.value
        });
        return `
            <article class="glass-card business-card business-section-card">
                ${renderSectionHead('Proposals / Contracts', 'Track offers, contracts, responses, value, and linked project or invoice context.', 'proposals', 'Proposal', 'proposal')}
                ${items.length ? `<div class="business-list">${items.map(item => `
                    <article class="business-item-card" data-biz-action="select-detail" data-entity="proposal" data-id="${escapeText(item.id)}">
                        <div class="business-item-top"><strong>${escapeText(item.title || slugLabel(item.type))}</strong>${renderPill(slugLabel(item.status))}</div>
                        <div class="business-item-meta"><span>${escapeText(clientLabel(model, item.clientId))}</span><span>${currency(item.value)}</span><span>${escapeText(item.dateSent ? `Sent ${shortDate(item.dateSent)}` : 'Not sent')}</span><span>${escapeText(proposalResponseLabel(item))}</span></div>
                        ${renderRecordActions('proposal', item.id, [
                            { label: 'Edit', action: 'open-modal' },
                            { label: 'Invoice', action: 'invoice-from-proposal' },
                            { label: 'Delete', action: 'delete-entity', danger: true }
                        ])}
                    </article>
                `).join('')}</div>` : renderEmptyState('No proposals or contracts yet', 'Keep proposals and contracts linked to the right clients, projects, and invoices.', 'Proposal', 'proposal')}
            </article>
        `;
    }

    function renderNotes(model) {
        const state = getSectionState('notes');
        let items = model.workspace.notes.filter(item => searchMatches(item, `${clientLabel(model, item.clientId)} ${projectLabel(model, item.projectId)} ${item.body}`));
        items = items.filter(item => {
            if (state.filter === 'pinned') return !!item.pinned;
            if (state.filter === 'meeting') return item.kind === 'meeting';
            if (state.filter === 'recent') return (Date.now() - new Date(item.updatedAt || item.createdAt || nowIso()).getTime()) <= 14 * 86400000;
            return true;
        });
        items = sortList(items, state.sort, {
            recent: (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
            name: (a, b) => String(a.title || '').localeCompare(String(b.title || ''))
        });
        return `
            <article class="glass-card business-card business-section-card business-notes-card">
                <div class="business-card-head business-section-head">
                    <div>
                        <h3>Quick Business Notes</h3>
                        <p>Autosaved quick capture plus pinned note snippets, templates, meeting notes, and linked follow-up context.</p>
                    </div>
                    <div class="business-head-controls">
                        <button class="neumo-btn business-add-btn" type="button" data-biz-action="save-quick-note">Save Draft as Note</button>
                    </div>
                </div>
                <div class="business-notes-layout">
                    <div class="business-quick-draft">
                        <div class="business-template-row">
                            ${renderNoteTemplateQuickButtons(model.ui.selectedTemplate || 'meeting')}
                        </div>
                        <div class="business-template-controls">
                            <select class="modal-input business-inline-select" data-biz-control="template-key">${renderNoteTemplateOptions(model.ui.selectedTemplate || 'meeting')}</select>
                            <select class="modal-input business-inline-select" data-biz-control="template-mode">${renderNoteTemplateModeOptions(model.ui.templateMode || 'replace')}</select>
                            <button class="neumo-btn business-mini-btn" type="button" data-biz-action="apply-selected-template">Apply Template</button>
                        </div>
                        <p class="business-template-hint">Use mode controls to replace the draft or insert template content above/below your current notes.</p>
                        <textarea class="modal-input business-notes-input" id="bizQuickCaptureInput" rows="10" placeholder="Capture meeting notes, deal updates, blockers, priorities, and follow-ups...">${escapeText(model.workspace.quickCapture || '')}</textarea>
                        <div class="business-draft-meta">
                            <span data-biz-quick-capture-status>${model.workspace.quickCaptureUpdatedAt ? `Autosaved ${longDate(model.workspace.quickCaptureUpdatedAt)}` : 'Autosaves locally as you type'}</span>
                            <button class="neumo-btn business-mini-btn" type="button" data-biz-action="clear-quick-note">Clear</button>
                        </div>
                    </div>
                    <div class="business-notes-list">
                        <div class="business-section-toolbar">
                            <select class="modal-input business-inline-select" data-biz-control="filter" data-section="notes">${renderFilterOptions('notes', state.filter)}</select>
                            <select class="modal-input business-inline-select" data-biz-control="view" data-section="notes">${renderViewOptions('notes', state.view)}</select>
                            <select class="modal-input business-inline-select" data-biz-control="sort" data-section="notes">${renderSortOptions('notes', state.sort)}</select>
                        </div>
                        ${items.length ? `<div class="business-list">${items.map(item => `
                            <article class="business-item-card" data-biz-action="select-detail" data-entity="note" data-id="${escapeText(item.id)}">
                                <div class="business-item-top"><strong>${escapeText(item.title || slugLabel(item.kind))}</strong>${item.pinned ? renderPill('Pinned', 'accent') : renderPill(slugLabel(item.kind), 'neutral')}</div>
                                <div class="business-item-sub">${escapeText((item.body || '').slice(0, 160) || 'No note body yet.')}</div>
                            </article>
                        `).join('')}</div>` : renderEmptyState('No saved business notes yet', 'Save quick capture drafts into reusable linked notes for meetings, clients, projects, and invoice follow-ups.', 'Note', 'note')}
                    </div>
                </div>
            </article>
        `;
    }

    function renderDocuments(model) {
        const state = getSectionState('documents');
        let items = model.workspace.documents.filter(item => searchMatches(item, `${clientLabel(model, item.clientId)} ${projectLabel(model, item.projectId)} ${item.kind}`));
        items = items.filter(item => {
            const kind = String(item.kind || '').toLowerCase();
            if (state.filter === 'contracts') return kind === 'contract';
            if (state.filter === 'receipts') return kind === 'receipt';
            if (state.filter === 'deliverables') return kind === 'deliverable';
            return true;
        });
        items = sortList(items, state.sort, {
            recent: (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
            name: (a, b) => String(a.title || '').localeCompare(String(b.title || ''))
        });
        return `
            <article class="glass-card business-card business-section-card">
                ${renderSectionHead('Documents / Assets', 'Maintain a local index of proposals, contracts, receipts, deliverables, templates, and references.', 'documents', 'Document', 'document')}
                ${items.length ? `<div class="business-list">${items.map(item => `
                    <article class="business-item-card" data-biz-action="select-detail" data-entity="document" data-id="${escapeText(item.id)}">
                        <div class="business-item-top"><strong>${escapeText(item.title || 'Document')}</strong>${renderPill(slugLabel(item.kind))}</div>
                        <div class="business-item-meta"><span>${escapeText(clientLabel(model, item.clientId))}</span><span>${escapeText(projectLabel(model, item.projectId))}</span><span>${escapeText(item.link || 'Local index only')}</span></div>
                    </article>
                `).join('')}</div>` : renderEmptyState('No documents indexed yet', 'Track contracts, receipts, deliverables, templates, and references in a lightweight local index.', 'Document', 'document')}
            </article>
        `;
    }

    function renderGoals(model) {
        const state = getSectionState('goals');
        let items = model.workspace.goals.filter(item => searchMatches(item, `${item.kind} ${item.notes}`));
        items = items.filter(item => {
            const progress = percent(item.currentValue, Math.max(1, item.targetValue));
            if (state.filter === 'active') return progress < 100;
            if (state.filter === 'complete') return progress >= 100;
            return true;
        });
        items = sortList(items, state.sort, {
            progress: (a, b) => percent(b.currentValue, Math.max(1, b.targetValue)) - percent(a.currentValue, Math.max(1, a.targetValue)),
            due: (a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || ''))
        });
        return `
            <article class="glass-card business-card business-section-card">
                ${renderSectionHead('Goals / Targets', 'Track revenue, client count, completion, outreach, and expense-cap targets.', 'goals', 'Goal', 'goal')}
                ${items.length ? `<div class="business-goal-grid">${items.map(item => `
                    <article class="business-item-card business-goal-card" data-biz-action="select-detail" data-entity="goal" data-id="${escapeText(item.id)}">
                        <div class="business-item-top"><strong>${escapeText(item.title || slugLabel(item.kind))}</strong>${renderPill(`${Math.round(percent(item.currentValue, Math.max(1, item.targetValue)))}%`, 'accent')}</div>
                        <div class="business-progress"><span style="width:${percent(item.currentValue, Math.max(1, item.targetValue))}%"></span></div>
                        <div class="business-item-meta"><span>${currency(item.currentValue)}</span><span>of ${currency(item.targetValue)}</span><span>${escapeText(slugLabel(item.period || 'monthly'))}</span></div>
                    </article>
                `).join('')}</div>` : renderEmptyState('No goals yet', 'Set revenue, client, outreach, or expense targets to keep the workspace pointed at outcomes.', 'Goal', 'goal')}
            </article>
        `;
    }

    function relatedActivity(model, entityType, entityId) {
        return model.recentActivity.filter(item => item.entityType === entityType && String(item.entityId) === String(entityId)).slice(0, 8);
    }

    function renderLinkedGroup(title, entityType, items) {
        if (!items || !items.length) return '';
        return `
            <div class="business-group">
                <div class="business-group-title">${escapeText(title)} <span>${escapeText(String(items.length))}</span></div>
                <div class="business-list">
                    ${items.slice(0, 6).map(item => `
                        <article class="business-item-card compact" data-biz-action="select-detail" data-entity="${escapeText(entityType)}" data-id="${escapeText(item.id)}">
                            <strong>${escapeText(item.name || item.title || item.invoiceNumber || item.category || 'Linked record')}</strong>
                            <div class="business-item-meta"><span>${escapeText(item.dueDate ? relativeDueLabel(item.dueDate) : item.date ? longDate(item.date) : slugLabel(item.status || item.stage || item.kind || 'linked'))}</span></div>
                        </article>
                    `).join('')}
                </div>
            </div>
        `;
    }

    function detailLinks(model, entityType, item) {
        if (entityType === 'project') {
            return [
                renderLinkedGroup('Invoices', 'invoice', model.related.projectInvoices.get(item.id) || []),
                renderLinkedGroup('Meetings', 'meeting', model.related.projectMeetings.get(item.id) || []),
                renderLinkedGroup('Tasks', 'task', model.related.projectTasks.get(item.id) || []),
                renderLinkedGroup('Notes', 'note', model.related.projectNotes.get(item.id) || []),
                renderLinkedGroup('Documents', 'document', model.related.projectDocuments.get(item.id) || [])
            ].join('');
        }
        if (entityType === 'client') {
            return [
                renderLinkedGroup('Projects', 'project', model.related.clientProjects.get(item.id) || []),
                renderLinkedGroup('Invoices', 'invoice', model.related.clientInvoices.get(item.id) || []),
                renderLinkedGroup('Meetings', 'meeting', model.related.clientMeetings.get(item.id) || []),
                renderLinkedGroup('Proposals', 'proposal', model.related.clientProposals.get(item.id) || []),
                renderLinkedGroup('Tasks', 'task', model.related.clientTasks.get(item.id) || []),
                renderLinkedGroup('Notes', 'note', model.related.clientNotes.get(item.id) || [])
            ].join('');
        }
        return '';
    }

    function renderDetailPanel(model) {
        const detail = model.ui.detail || {};
        const item = detail.entityType && detail.entityId ? getEntity(detail.entityType, detail.entityId) : null;
        if (!item) {
            const focusItems = [
                `${model.metrics.overdueInvoices} overdue invoices`,
                `${model.metrics.atRiskProjects} at-risk projects`,
                `${model.metrics.tasksDueToday} tasks due today`,
                `${model.metrics.meetingsThisWeek} meetings this week`
            ];
            return `
                <article class="glass-card business-card business-detail-card">
                    <div class="business-card-head"><h3>Detail Panel</h3></div>
                    <div class="business-detail-empty">
                        <strong>Select any record to inspect linked details.</strong>
                        <p>Projects, clients, invoices, notes, meetings, and goals all open here with related context.</p>
                        <div class="business-focus-list">${focusItems.map(itemText => `<span>${escapeText(itemText)}</span>`).join('')}</div>
                    </div>
                </article>
            `;
        }
        const summaryRows = Object.entries(item).filter(([key]) => !['id', 'createdAt', 'updatedAt', 'notes', 'body', 'milestones', 'subtasks'].includes(key)).slice(0, 10);
        const activityRows = relatedActivity(model, detail.entityType, detail.entityId);
        return `
            <article class="glass-card business-card business-detail-card">
                <div class="business-card-head business-section-head">
                    <div>
                        <h3>Detail Panel</h3>
                        <p>${escapeText(slugLabel(detail.entityType))} summary, links, and recent activity.</p>
                    </div>
                    <div class="business-head-controls">
                        <button class="neumo-btn business-mini-btn" type="button" data-biz-action="open-modal" data-entity="${escapeText(detail.entityType)}" data-id="${escapeText(detail.entityId)}">Edit</button>
                        <button class="neumo-btn business-mini-btn" type="button" data-biz-action="clear-detail">Close</button>
                    </div>
                </div>
                <div class="business-detail-tabs">
                    <button class="business-detail-tab${detail.tab === 'summary' ? ' active' : ''}" type="button" data-biz-action="detail-tab" data-value="summary">Summary</button>
                    <button class="business-detail-tab${detail.tab === 'links' ? ' active' : ''}" type="button" data-biz-action="detail-tab" data-value="links">Links</button>
                    <button class="business-detail-tab${detail.tab === 'activity' ? ' active' : ''}" type="button" data-biz-action="detail-tab" data-value="activity">Activity</button>
                </div>
                ${detail.tab === 'activity'
                    ? `<div class="business-list">${activityRows.length ? activityRows.map(row => `<article class="business-item-card compact"><strong>${escapeText(row.title || row.description || 'Activity')}</strong><div class="business-item-meta"><span>${escapeText(longDate(row.createdAt))}</span></div></article>`).join('') : '<p class="business-muted-copy">No activity logged for this record yet.</p>'}</div>`
                    : detail.tab === 'links'
                        ? (detailLinks(model, detail.entityType, item) || '<p class="business-muted-copy">No linked records yet.</p>')
                        : `<div class="business-detail-grid">
                            ${summaryRows.map(([key, value]) => `<div class="business-detail-row"><span>${escapeText(slugLabel(key))}</span><strong>${escapeText(Array.isArray(value) ? value.join(', ') : String(value || 'None'))}</strong></div>`).join('')}
                            ${item.body ? `<div class="business-detail-note">${escapeText(item.body)}</div>` : ''}
                            ${Array.isArray(item.milestones) && item.milestones.length ? `<div class="business-group"><div class="business-group-title">Milestones</div><div class="business-list">${item.milestones.map(milestone => `<article class="business-item-card compact"><strong>${escapeText(milestone.title)}</strong><div class="business-item-meta"><span>${escapeText(longDate(milestone.date))}</span>${renderPill(slugLabel(milestone.status))}</div></article>`).join('')}</div></div>` : ''}
                            ${Array.isArray(item.subtasks) && item.subtasks.length ? `<div class="business-group"><div class="business-group-title">Subtasks</div><div class="business-list">${item.subtasks.map(task => `<article class="business-item-card compact"><strong>${escapeText(task.title)}</strong><div class="business-item-meta"><span>${escapeText(relativeDueLabel(task.dueDate))}</span>${renderPill(slugLabel(task.status))}</div></article>`).join('')}</div></div>` : ''}
                        </div>`
                }
            </article>
        `;
    }

    function renderRecentActivityCard(model) {
        return `
            <article class="glass-card business-card business-side-card">
                <div class="business-card-head"><h3>Recent Activity</h3></div>
                ${model.recentActivity.length ? `<div class="business-list">${model.recentActivity.slice(0, 8).map(item => `
                    <article class="business-item-card compact">
                        <strong>${escapeText(item.title || item.description || 'Activity')}</strong>
                        <div class="business-item-sub">${escapeText(item.description || 'Business record updated')}</div>
                        <div class="business-item-meta"><span>${escapeText(longDate(item.createdAt))}</span></div>
                    </article>
                `).join('')}</div>` : '<p class="business-muted-copy">No business activity yet. New edits and status changes will appear here.</p>'}
            </article>
        `;
    }

    function renderDeadlinesCard(model) {
        const groups = ['today', 'tomorrow', 'this-week', 'next-week', 'overdue'];
        return `
            <article class="glass-card business-card business-side-card">
                <div class="business-card-head"><h3>Deadlines / Upcoming</h3></div>
                ${model.deadlines.length ? groups.map(group => {
                    const label = slugLabel(group);
                    const items = model.deadlines.filter(item => item.bucket === group).slice(0, 4);
                    if (!items.length) return '';
                    return `
                        <div class="business-group">
                            <div class="business-group-title">${escapeText(label)} <span>${escapeText(String(items.length))}</span></div>
                            <div class="business-list">${items.map(item => `
                                <article class="business-item-card compact" data-biz-action="select-detail" data-entity="${escapeText(item.entityType)}" data-id="${escapeText(item.entityId)}">
                                    <div class="business-item-top"><strong>${escapeText(item.title)}</strong>${renderPill(item.type)}</div>
                                    <div class="business-item-meta"><span>${escapeText(longDate(item.date))}</span>${item.time ? `<span>${escapeText(item.time)}</span>` : ''}</div>
                                    <div class="business-item-sub">${escapeText(item.nextAction || 'Review next step')}</div>
                                </article>
                            `).join('')}</div>
                        </div>
                    `;
                }).join('') : renderEmptyState('No upcoming deadlines', 'You are clear for now.', '', '')}
            </article>
        `;
    }

    function createRow(entityType, seed = {}) {
        const creators = {
            project: typeof createBusinessProjectRow === 'function' ? createBusinessProjectRow : (value => value),
            client: typeof createBusinessClientRow === 'function' ? createBusinessClientRow : (value => value),
            invoice: typeof createBusinessInvoiceRow === 'function' ? createBusinessInvoiceRow : (value => value),
            finance: typeof createBusinessFinanceRow === 'function' ? createBusinessFinanceRow : (value => value),
            opportunity: typeof createBusinessOpportunityRow === 'function' ? createBusinessOpportunityRow : (value => value),
            meeting: typeof createBusinessMeetingRow === 'function' ? createBusinessMeetingRow : (value => value),
            proposal: typeof createBusinessProposalRow === 'function' ? createBusinessProposalRow : (value => value),
            task: typeof createBusinessTaskRow === 'function' ? createBusinessTaskRow : (value => value),
            document: typeof createBusinessDocumentRow === 'function' ? createBusinessDocumentRow : (value => value),
            goal: typeof createBusinessGoalRow === 'function' ? createBusinessGoalRow : (value => value),
            note: typeof createBusinessNoteRow === 'function' ? createBusinessNoteRow : (value => value)
        };
        return creators[entityType] ? creators[entityType](seed) : { ...seed };
    }

    function renderSelectOptions(options, active, includeBlank = true, blankLabel = 'Select') {
        const base = includeBlank ? [`<option value="">${escapeText(blankLabel)}</option>`] : [];
        return base.concat((options || []).map(([value, label]) => `<option value="${escapeText(value)}"${String(value) === String(active || '') ? ' selected' : ''}>${escapeText(label)}</option>`)).join('');
    }

    function relationOptions(model, entityType) {
        return getCollection(entityType).map(item => [item.id, item.name || item.title || item.invoiceNumber || item.company || item.category || item.kind || item.type || 'Untitled']);
    }

    function entityFormConfig(model, entityType) {
        const dynamic = {
            clients: relationOptions(model, 'client'),
            projects: relationOptions(model, 'project'),
            invoices: relationOptions(model, 'invoice'),
            meetings: relationOptions(model, 'meeting'),
            proposals: relationOptions(model, 'proposal')
        };
        const sharedLinked = [
            { key: 'clientId', label: 'Client', type: 'select', options: dynamic.clients },
            { key: 'projectId', label: 'Project', type: 'select', options: dynamic.projects }
        ];
        const configs = {
            project: [
                { key: 'name', label: 'Project Name', type: 'text', required: true },
                sharedLinked[0],
                { key: 'status', label: 'Status', type: 'select', options: PROJECT_STATUS_OPTIONS },
                { key: 'priority', label: 'Priority', type: 'select', options: PRIORITY_OPTIONS },
                { key: 'startDate', label: 'Start Date', type: 'date' },
                { key: 'dueDate', label: 'Due Date', type: 'date' },
                { key: 'budget', label: 'Budget', type: 'number', step: '0.01' },
                { key: 'actualRevenue', label: 'Actual Revenue', type: 'number', step: '0.01' },
                { key: 'estimatedHours', label: 'Estimated Hours', type: 'number', step: '0.25' },
                { key: 'loggedHours', label: 'Logged Hours', type: 'number', step: '0.25' },
                { key: 'completionPercent', label: 'Completion %', type: 'number', step: '1' },
                { key: 'category', label: 'Category', type: 'text' },
                { key: 'nextStep', label: 'Next Step', type: 'text', wide: true },
                { key: 'tags', label: 'Tags', type: 'text', wide: true, placeholder: 'Comma-separated tags' },
                { key: 'description', label: 'Description', type: 'textarea', wide: true }
            ],
            client: [
                { key: 'name', label: 'Name', type: 'text', required: true },
                { key: 'company', label: 'Company', type: 'text' },
                { key: 'email', label: 'Email', type: 'text' },
                { key: 'phone', label: 'Phone', type: 'text' },
                { key: 'role', label: 'Role', type: 'text' },
                { key: 'status', label: 'Status', type: 'select', options: CLIENT_STATUS_OPTIONS },
                { key: 'source', label: 'Source', type: 'text' },
                { key: 'industry', label: 'Industry', type: 'text' },
                { key: 'location', label: 'Location', type: 'text' },
                { key: 'website', label: 'Website', type: 'text' },
                { key: 'relationshipType', label: 'Relationship Type', type: 'text' },
                { key: 'lastContactDate', label: 'Last Contact', type: 'date' },
                { key: 'nextFollowUpDate', label: 'Next Follow-Up', type: 'date' },
                { key: 'tags', label: 'Tags', type: 'text', wide: true, placeholder: 'Comma-separated tags' },
                { key: 'notes', label: 'Notes', type: 'textarea', wide: true }
            ],
            invoice: [
                { key: 'invoiceNumber', label: 'Invoice ID', type: 'text' },
                { key: 'title', label: 'Invoice Title', type: 'text', required: true },
                sharedLinked[0],
                sharedLinked[1],
                { key: 'amount', label: 'Amount', type: 'number', step: '0.01' },
                { key: 'issueDate', label: 'Issue Date', type: 'date' },
                { key: 'dueDate', label: 'Due Date', type: 'date' },
                { key: 'status', label: 'Status', type: 'select', options: INVOICE_STATUS_OPTIONS },
                { key: 'paidDate', label: 'Paid Date', type: 'date' },
                { key: 'paymentMethod', label: 'Payment Method', type: 'select', options: PAYMENT_METHOD_OPTIONS },
                { key: 'taxAmount', label: 'Tax', type: 'number', step: '0.01' },
                { key: 'discount', label: 'Discount', type: 'number', step: '0.01' },
                { key: 'lineItemsText', label: 'Line Items', type: 'textarea', wide: true, placeholder: 'Design Retainer | 1200' },
                { key: 'notes', label: 'Notes', type: 'textarea', wide: true }
            ],
            finance: [
                { key: 'type', label: 'Type', type: 'select', options: FINANCE_TYPE_OPTIONS },
                { key: 'category', label: 'Category', type: 'select', options: FINANCE_CATEGORY_OPTIONS },
                { key: 'subcategory', label: 'Subcategory', type: 'text' },
                { key: 'amount', label: 'Amount', type: 'number', step: '0.01' },
                { key: 'date', label: 'Date', type: 'date' },
                sharedLinked[0],
                sharedLinked[1],
                { key: 'invoiceId', label: 'Linked Invoice', type: 'select', options: dynamic.invoices },
                { key: 'paymentMethod', label: 'Payment Method', type: 'select', options: PAYMENT_METHOD_OPTIONS },
                { key: 'notes', label: 'Notes', type: 'textarea', wide: true }
            ],
            opportunity: [
                { key: 'name', label: 'Opportunity Name', type: 'text', required: true },
                sharedLinked[0],
                { key: 'company', label: 'Company', type: 'text' },
                { key: 'value', label: 'Value', type: 'number', step: '0.01' },
                { key: 'stage', label: 'Stage', type: 'select', options: OPPORTUNITY_STAGE_OPTIONS },
                { key: 'expectedCloseDate', label: 'Expected Close', type: 'date' },
                { key: 'probability', label: 'Probability %', type: 'number', step: '1' },
                { key: 'nextFollowUpDate', label: 'Next Follow-Up', type: 'date' },
                { key: 'notes', label: 'Notes', type: 'textarea', wide: true }
            ],
            meeting: [
                { key: 'title', label: 'Title', type: 'text', required: true },
                { key: 'date', label: 'Date', type: 'date' },
                { key: 'time', label: 'Time', type: 'time' },
                sharedLinked[0],
                sharedLinked[1],
                { key: 'location', label: 'Location / Link', type: 'text' },
                { key: 'purpose', label: 'Purpose', type: 'text' },
                { key: 'status', label: 'Status', type: 'select', options: MEETING_STATUS_OPTIONS },
                { key: 'agenda', label: 'Agenda', type: 'textarea', wide: true },
                { key: 'decisions', label: 'Decisions', type: 'textarea', wide: true },
                { key: 'followUpActions', label: 'Follow-Up Actions', type: 'textarea', wide: true },
                { key: 'notes', label: 'Notes', type: 'textarea', wide: true }
            ],
            proposal: [
                { key: 'title', label: 'Title', type: 'text', required: true },
                sharedLinked[0],
                sharedLinked[1],
                { key: 'type', label: 'Type', type: 'text' },
                { key: 'status', label: 'Status', type: 'select', options: PROPOSAL_STATUS_OPTIONS },
                { key: 'dateSent', label: 'Date Sent', type: 'date' },
                { key: 'responseDate', label: 'Response Date', type: 'date' },
                { key: 'value', label: 'Value', type: 'number', step: '0.01' },
                { key: 'invoiceId', label: 'Linked Invoice', type: 'select', options: dynamic.invoices },
                { key: 'notes', label: 'Notes', type: 'textarea', wide: true }
            ],
            task: [
                { key: 'title', label: 'Task Title', type: 'text', required: true },
                sharedLinked[0],
                sharedLinked[1],
                { key: 'dueDate', label: 'Due Date', type: 'date' },
                { key: 'priority', label: 'Priority', type: 'select', options: PRIORITY_OPTIONS },
                { key: 'status', label: 'Status', type: 'select', options: TASK_STATUS_OPTIONS },
                { key: 'category', label: 'Category', type: 'text' },
                { key: 'notes', label: 'Notes', type: 'textarea', wide: true }
            ],
            document: [
                { key: 'title', label: 'Document Title', type: 'text', required: true },
                { key: 'kind', label: 'Type', type: 'select', options: DOCUMENT_KIND_OPTIONS },
                sharedLinked[0],
                sharedLinked[1],
                { key: 'invoiceId', label: 'Linked Invoice', type: 'select', options: dynamic.invoices },
                { key: 'proposalId', label: 'Linked Proposal', type: 'select', options: dynamic.proposals },
                { key: 'link', label: 'Link / Path', type: 'text', wide: true },
                { key: 'status', label: 'Status', type: 'text' },
                { key: 'notes', label: 'Notes', type: 'textarea', wide: true }
            ],
            goal: [
                { key: 'title', label: 'Goal Title', type: 'text', required: true },
                { key: 'kind', label: 'Goal Type', type: 'select', options: GOAL_KIND_OPTIONS },
                { key: 'targetValue', label: 'Target', type: 'number', step: '0.01' },
                { key: 'currentValue', label: 'Current', type: 'number', step: '0.01' },
                { key: 'period', label: 'Period', type: 'text' },
                { key: 'dueDate', label: 'Due Date', type: 'date' },
                { key: 'notes', label: 'Notes', type: 'textarea', wide: true }
            ],
            note: [
                { key: 'title', label: 'Note Title', type: 'text', required: true },
                { key: 'kind', label: 'Type', type: 'select', options: NOTE_KIND_OPTIONS },
                sharedLinked[0],
                sharedLinked[1],
                { key: 'meetingId', label: 'Linked Meeting', type: 'select', options: dynamic.meetings },
                { key: 'invoiceId', label: 'Linked Invoice', type: 'select', options: dynamic.invoices },
                { key: 'body', label: 'Body', type: 'textarea', wide: true }
            ]
        };
        return configs[entityType] || [];
    }

    function fieldValue(item, field) {
        if (!item) return '';
        if (field.key === 'tags') return Array.isArray(item.tags) ? item.tags.join(', ') : String(item.tags || '');
        if (field.key === 'lineItemsText') return Array.isArray(item.lineItems) ? item.lineItems.map(line => `${line.label}${line.amount ? ` | ${line.amount}` : ''}`).join('\n') : '';
        return item[field.key] ?? '';
    }

    function renderField(field, item) {
        const value = fieldValue(item, field);
        const wideClass = field.wide ? ' business-form-field-wide' : '';
        if (field.type === 'textarea') {
            return `<label class="business-form-field${wideClass}"><span>${escapeText(field.label)}</span><textarea class="modal-input" name="${escapeText(field.key)}" rows="${field.rows || 4}" placeholder="${escapeText(field.placeholder || '')}">${escapeText(value)}</textarea></label>`;
        }
        if (field.type === 'select') {
            return `<label class="business-form-field${wideClass}"><span>${escapeText(field.label)}</span><select class="modal-input" name="${escapeText(field.key)}">${renderSelectOptions(field.options, value, true, 'Select')}</select></label>`;
        }
        return `<label class="business-form-field${wideClass}"><span>${escapeText(field.label)}</span><input class="modal-input" type="${escapeText(field.type || 'text')}" name="${escapeText(field.key)}" value="${escapeText(value)}" placeholder="${escapeText(field.placeholder || '')}"${field.step ? ` step="${escapeText(field.step)}"` : ''}${field.required ? ' required' : ''}></label>`;
    }

    function recordActivity(entry) {
        const workspace = getWorkspace();
        const row = typeof createBusinessActivityRow === 'function'
            ? createBusinessActivityRow({ id: typeof generateId === 'function' ? generateId() : nowIso(), createdAt: nowIso(), ...entry })
            : { id: nowIso(), createdAt: nowIso(), ...entry };
        workspace.activity = [row, ...(workspace.activity || [])].slice(0, 160);
    }

    function syncInvoiceFinance(invoice) {
        if (!invoice) return;
        const workspace = getWorkspace();
        const existingIndex = workspace.finance.findIndex(item => item.invoiceId === invoice.id && item.source === 'invoice-payment');
        if (String(invoice.status || '').toLowerCase() !== 'paid') {
            if (existingIndex >= 0) workspace.finance.splice(existingIndex, 1);
            return;
        }
        const seed = {
            id: existingIndex >= 0 ? workspace.finance[existingIndex].id : (typeof generateId === 'function' ? generateId() : nowIso()),
            type: 'income',
            category: 'revenue',
            subcategory: 'Invoice Payment',
            amount: invoiceTotal(invoice),
            date: invoice.paidDate || today(),
            notes: `Auto-created from ${invoice.title || invoice.invoiceNumber || 'invoice payment'}`,
            clientId: invoice.clientId,
            projectId: invoice.projectId,
            invoiceId: invoice.id,
            paymentMethod: invoice.paymentMethod,
            source: 'invoice-payment'
        };
        const row = createRow('finance', seed);
        if (existingIndex >= 0) workspace.finance.splice(existingIndex, 1, row);
        else workspace.finance.unshift(row);
    }

    function closeModal() {
        const modal = getModal();
        const state = getUiState();
        state.modal = null;
        if (!modal) return;
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        if (!document.querySelector('.modal.active')) document.body.classList.remove('modal-open');
    }

    function renderModal() {
        const modal = getModal();
        const state = getUiState();
        if (!modal) return;
        if (!state.modal) {
            closeModal();
            return;
        }
        const model = buildModel();
        const entityType = state.modal.entityType;
        const existing = state.modal.entityId ? getEntity(entityType, state.modal.entityId) : null;
        const draft = createRow(entityType, { ...(existing || {}), ...(state.modal.defaults || {}) });
        const title = `${existing ? 'Edit' : 'New'} ${slugLabel(entityType)}`;
        document.getElementById('businessEntityModalTitle').textContent = title;
        document.getElementById('businessEntityModalEyebrow').textContent = slugLabel(entityType);
        document.getElementById('businessEntityForm').innerHTML = `
            <input type="hidden" name="id" value="${escapeText(existing ? existing.id : '')}">
            <input type="hidden" name="entityType" value="${escapeText(entityType)}">
            <div class="business-form-grid">
                ${entityFormConfig(model, entityType).map(field => renderField(field, draft)).join('')}
            </div>
        `;
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
        if (typeof window.refreshCustomSelects === 'function') window.refreshCustomSelects(modal);
        if (typeof window.refreshCustomDates === 'function') window.refreshCustomDates(modal);
    }

    function saveEntityFromForm(form) {
        const data = new FormData(form);
        const entityType = String(data.get('entityType') || '').trim();
        const id = String(data.get('id') || '').trim();
        const payload = {};
        data.forEach((value, key) => {
            if (key === 'entityType' || key === 'id') return;
            payload[key] = value;
        });
        const row = createRow(entityType, { ...(id ? { ...getEntity(entityType, id) } : {}), ...payload, id: id || (typeof generateId === 'function' ? generateId() : nowIso()), updatedAt: nowIso() });
        if (!row.name && !row.title && entityType !== 'finance' && entityType !== 'goal') {
            if (typeof showToast === 'function') showToast(`${slugLabel(entityType)} title is required.`);
            return false;
        }
        updateCollection(entityType, list => {
            const next = list.slice();
            const index = next.findIndex(item => String(item.id) === String(row.id));
            if (index >= 0) next.splice(index, 1, row);
            else next.unshift(row);
            return next;
        });
        if (entityType === 'invoice') syncInvoiceFinance(row);
        recordActivity({
            type: id ? 'updated' : 'created',
            entityType,
            entityId: row.id,
            title: `${slugLabel(entityType)} ${id ? 'updated' : 'created'}`,
            description: row.name || row.title || row.invoiceNumber || row.category || 'Business record updated',
            clientId: row.clientId || '',
            projectId: row.projectId || ''
        });
        saveWorkspace();
        setDetail(entityType, row.id);
        closeModal();
        render();
        return true;
    }

    async function deleteEntity(entityType, entityId) {
        const record = getEntity(entityType, entityId);
        if (!record) return;
        if (typeof showCustomConfirmDialog === 'function') {
            const confirmed = await showCustomConfirmDialog({
                title: `Delete ${slugLabel(entityType)}?`,
                message: 'This removes the business record from your local workspace.',
                confirmText: 'Delete',
                cancelText: 'Cancel',
                confirmVariant: 'danger'
            });
            if (!confirmed) return;
        }
        updateCollection(entityType, list => list.filter(item => String(item.id) !== String(entityId)));
        if (entityType === 'invoice') updateCollection('finance', list => list.filter(item => !(item.invoiceId === entityId && item.source === 'invoice-payment')));
        recordActivity({
            type: 'deleted',
            entityType,
            entityId,
            title: `${slugLabel(entityType)} deleted`,
            description: record.name || record.title || record.invoiceNumber || record.category || 'Business record removed',
            clientId: record.clientId || '',
            projectId: record.projectId || ''
        });
        if (getUiState().detail.entityId === entityId) clearDetail();
        saveWorkspace();
        render();
    }

    function duplicateEntity(entityType, entityId) {
        const record = getEntity(entityType, entityId);
        if (!record) return;
        const copy = cloneValue(record);
        copy.id = typeof generateId === 'function' ? generateId() : nowIso();
        if (copy.name) copy.name = `${copy.name} Copy`;
        if (copy.title) copy.title = `${copy.title} Copy`;
        if (copy.invoiceNumber) copy.invoiceNumber = `${copy.invoiceNumber}-COPY`;
        copy.createdAt = nowIso();
        copy.updatedAt = nowIso();
        updateCollection(entityType, list => [createRow(entityType, copy), ...list]);
        recordActivity({ type: 'duplicated', entityType, entityId: copy.id, title: `${slugLabel(entityType)} duplicated`, description: copy.name || copy.title || 'Copy created', clientId: copy.clientId || '', projectId: copy.projectId || '' });
        saveWorkspace();
        setDetail(entityType, copy.id);
        render();
    }

    function setStatus(entityType, entityId, value) {
        const record = getEntity(entityType, entityId);
        if (!record) return;
        const key = entityType === 'project' || entityType === 'client' || entityType === 'invoice' || entityType === 'meeting' || entityType === 'proposal' || entityType === 'task' ? 'status' : entityType === 'opportunity' ? 'stage' : 'status';
        record[key] = value;
        if (entityType === 'project' && value === 'completed') record.completionPercent = 100;
        if (entityType === 'invoice' && value === 'paid' && !record.paidDate) record.paidDate = typeof today === 'function' ? today() : '';
        updateCollection(entityType, list => list.map(item => String(item.id) === String(entityId) ? createRow(entityType, { ...item, ...record, updatedAt: nowIso() }) : item));
        if (entityType === 'invoice') syncInvoiceFinance(record);
        recordActivity({ type: 'status', entityType, entityId, title: `${slugLabel(entityType)} ${slugLabel(value)}`, description: record.name || record.title || 'Status updated', clientId: record.clientId || '', projectId: record.projectId || '' });
        saveWorkspace();
        render();
    }

    function saveQuickNote() {
        const workspace = getWorkspace();
        const body = String(workspace.quickCapture || '').trim();
        if (!body) {
            if (typeof showToast === 'function') showToast('Quick business note is empty.');
            return;
        }
        const title = body.split('\n')[0].slice(0, 60) || 'Business note';
        const row = createRow('note', { id: typeof generateId === 'function' ? generateId() : nowIso(), title, kind: 'general', body, createdAt: nowIso(), updatedAt: nowIso() });
        updateCollection('note', list => [row, ...list]);
        workspace.quickCapture = '';
        workspace.quickCaptureUpdatedAt = nowIso();
        recordActivity({ type: 'created', entityType: 'note', entityId: row.id, title: 'Business note saved', description: title });
        saveWorkspace();
        setDetail('note', row.id);
        render();
    }

    function getNoteTemplate(templateKey) {
        const key = String(templateKey || '').trim().toLowerCase();
        if (!key) return null;
        return NOTE_TEMPLATES[key] ? { key, ...NOTE_TEMPLATES[key] } : null;
    }

    function normalizeTemplateMode(modeRaw) {
        const normalized = String(modeRaw || '').trim().toLowerCase();
        return NOTE_TEMPLATE_MODES.some(([value]) => value === normalized) ? normalized : 'replace';
    }

    function applyTemplate(templateKey, modeRaw) {
        const template = getNoteTemplate(templateKey);
        if (!template) return;
        const state = getUiState();
        const mode = normalizeTemplateMode(modeRaw || state.templateMode);
        const workspace = getWorkspace();
        const existing = String(workspace.quickCapture || '');
        const body = String(template.body || '');
        let nextValue = body;
        if (mode === 'append' && existing.trim()) {
            nextValue = `${existing.replace(/\s+$/, '')}\n\n---\n\n${body.replace(/^\s+/, '')}`;
        } else if (mode === 'prepend' && existing.trim()) {
            nextValue = `${body.replace(/\s+$/, '')}\n\n---\n\n${existing.replace(/^\s+/, '')}`;
        }
        workspace.quickCapture = nextValue;
        workspace.quickCaptureUpdatedAt = nowIso();
        state.selectedTemplate = template.key;
        state.templateMode = mode;
        saveWorkspace();
        state.focusQuickNote = true;
        render();
    }

    function renderSearchableSections(model) {
        return `
            ${renderProjects(model)}
            ${renderOpportunities(model)}
            ${renderClients(model)}
            ${renderInvoices(model)}
            ${renderFinance(model)}
            ${renderMeetings(model)}
            ${renderTasks(model)}
            ${renderProposals(model)}
            ${renderNotes(model)}
            ${renderDocuments(model)}
            ${renderGoals(model)}
        `;
    }

    function captureResultsScroll(results) {
        const saved = new Map();
        results.querySelectorAll('[id]').forEach(element => {
            if (element.scrollTop || element.scrollLeft) saved.set(element.id, { top: element.scrollTop, left: element.scrollLeft });
        });
        return saved;
    }

    function refreshSearchableSections() {
        const root = getRoot();
        const results = root && root.querySelector('[data-business-search-results]');
        if (!results) { render(); return; }
        const rootTop = root.scrollTop;
        const rootLeft = root.scrollLeft;
        const pageX = window.scrollX;
        const pageY = window.scrollY;
        const scrollState = captureResultsScroll(results);
        const model = buildModel();
        results.innerHTML = renderSearchableSections(model); // sutra-allow-html: escaped developer templates for results only; the search input shell remains mounted
        scrollState.forEach((position, id) => {
            const element = document.getElementById(id);
            if (element) { element.scrollTop = position.top; element.scrollLeft = position.left; }
        });
        root.scrollTop = rootTop;
        root.scrollLeft = rootLeft;
        if (window.scrollX !== pageX || window.scrollY !== pageY) window.scrollTo(pageX, pageY);
        if (typeof window.refreshCustomSelects === 'function') window.refreshCustomSelects(results);
        if (typeof window.refreshCustomDates === 'function') window.refreshCustomDates(results);
    }

    function render() {
        const root = getRoot();
        if (!root) return;
        const model = buildModel();
        root.classList.toggle('business-pref-compact', model.preferences.compactCards === true);
        root.classList.toggle('business-pref-list', model.preferences.defaultView === 'list');
        root.innerHTML = `
            <div class="business-dashboard-grid">
                <div class="business-main-column">
                    ${renderOverview(model)}
                    ${renderOverdueInvoiceBanner(model)}
                    ${model.preferences.showAnalytics ? renderAnalytics(model) : ''}
                    <div class="business-search-results" data-business-search-results>
                        ${renderSearchableSections(model)}
                    </div>
                </div>
                <div class="business-side-column">
                    ${renderOperatingQueue(model)}
                    ${renderDetailPanel(model)}
                    ${model.preferences.showActivity ? renderRecentActivityCard(model) : ''}
                    ${model.preferences.showDeadlines ? renderDeadlinesCard(model) : ''}
                </div>
            </div>
        `;
        if (typeof window.refreshCustomSelects === 'function') window.refreshCustomSelects(root);
        if (typeof window.refreshCustomDates === 'function') window.refreshCustomDates(root);
        renderModal();
        if (model.ui.focusQuickNote) {
            const input = document.getElementById('bizQuickCaptureInput');
            if (input) input.focus();
            model.ui.focusQuickNote = false;
        }
    }

    function handleClick(event) {
        const control = event.target.closest('[data-biz-action]');
        if (!control) return;
        const action = control.dataset.bizAction || '';
        const entityType = control.dataset.entity || '';
        const entityId = control.dataset.id || '';
        if (action === 'open-modal') {
            let defaults = {};
            if (control.dataset.defaults) {
                try { defaults = JSON.parse(control.dataset.defaults); } catch (error) { defaults = {}; }
            }
            openEntityModal(entityType, entityId, defaults);
            return;
        }
        if (action === 'delete-entity') return deleteEntity(entityType, entityId);
        if (action === 'duplicate-entity') return duplicateEntity(entityType, entityId);
        if (action === 'archive-entity') return setStatus(entityType, entityId, 'archived');
        if (action === 'mark-complete') return setStatus(entityType, entityId, 'completed');
        if (action === 'set-status') return setStatus(entityType, entityId, control.dataset.value || '');
        if (action === 'select-detail') return (() => { setDetail(entityType, entityId, 'summary'); render(); if (typeof isCompactViewport === 'function' && isCompactViewport()) document.querySelector('.business-detail-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); })();
        if (action === 'clear-detail') return (() => { clearDetail(); render(); })();
        if (action === 'review-overdue-invoices') return (() => {
            getSectionState('invoices').filter = 'overdue';
            render();
            const section = document.getElementById('business-invoices-section');
            if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        })();
        if (action === 'detail-tab') return (() => { getUiState().detail.tab = control.dataset.value || 'summary'; render(); })();
        if (action === 'toggle-compact') return (() => { getUiState().compact = !getUiState().compact; render(); })();
        if (action === 'focus-note') return (() => { getUiState().focusQuickNote = true; render(); })();
        if (action === 'apply-template') return applyTemplate(control.dataset.template || '', getUiState().templateMode || 'replace');
        if (action === 'apply-selected-template') {
            const state = getUiState();
            return applyTemplate(state.selectedTemplate || 'meeting', state.templateMode || 'replace');
        }
        if (action === 'save-quick-note') return saveQuickNote();
        if (action === 'clear-quick-note') return (() => { const workspace = getWorkspace(); workspace.quickCapture = ''; workspace.quickCaptureUpdatedAt = nowIso(); saveWorkspace(); render(); })();
        if (action === 'quick-follow-up') return openEntityModal('task', '', { clientId: entityId, category: 'Follow-Up', dueDate: typeof today === 'function' ? today() : '' });
        if (action === 'quick-invoice') return openEntityModal('invoice', '', { clientId: entityId });
        if (action === 'quick-project') return openEntityModal('project', '', { clientId: entityId });
        if (action === 'quick-note') return openEntityModal('note', '', { meetingId: entityId });
        if (action === 'schedule-meeting') {
            const meeting = getEntity('meeting', entityId);
            if (!meeting || !meeting.date) { if (typeof showToast === 'function') showToast('Add a meeting date first to schedule it.'); return; }
            if (typeof scheduleGenericItemAsBlock === 'function') {
                scheduleGenericItemAsBlock({ title: meeting.title || 'Meeting', date: meeting.date, dueTime: meeting.time || '', category: 'meeting' });
            }
            return;
        }
        if (action === 'proposal-from-opportunity') {
            const opportunity = getEntity('opportunity', entityId);
            return openEntityModal('proposal', '', opportunity ? { clientId: opportunity.clientId, value: opportunity.value, title: `${opportunity.name || 'Opportunity'} Proposal` } : {});
        }
        if (action === 'invoice-from-proposal') {
            const proposal = getEntity('proposal', entityId);
            return openEntityModal('invoice', '', proposal ? { clientId: proposal.clientId, projectId: proposal.projectId, amount: proposal.value, title: proposal.title } : {});
        }
    }

    let businessSearchComposing = false;

    function handleInput(event) {
        if (event.target.matches('[data-biz-control="search"]')) {
            getUiState().search = String(event.target.value || '');
            if (!businessSearchComposing && !event.isComposing) refreshSearchableSections();
            return;
        }
        if (event.target.id === 'bizQuickCaptureInput') {
            const workspace = getWorkspace();
            workspace.quickCapture = String(event.target.value || '');
            workspace.quickCaptureUpdatedAt = nowIso();
            saveWorkspace();
            const status = document.querySelector('[data-biz-quick-capture-status]');
            if (status) status.textContent = `Autosaved ${longDate(workspace.quickCaptureUpdatedAt)}`;
        }
    }

    function handleCompositionStart(event) {
        if (event.target.matches('[data-biz-control="search"]')) businessSearchComposing = true;
    }

    function handleCompositionEnd(event) {
        if (!event.target.matches('[data-biz-control="search"]')) return;
        businessSearchComposing = false;
        getUiState().search = String(event.target.value || '');
        refreshSearchableSections();
    }

    function handleChange(event) {
        const control = event.target.dataset.bizControl || '';
        if (control === 'template-key') {
            const state = getUiState();
            const candidate = String(event.target.value || '').trim().toLowerCase();
            if (NOTE_TEMPLATES[candidate]) state.selectedTemplate = candidate;
            render();
            return;
        }
        if (control === 'template-mode') {
            getUiState().templateMode = normalizeTemplateMode(event.target.value || 'replace');
            render();
            return;
        }
        const section = event.target.dataset.section || '';
        if (!control || !section) return;
        getSectionState(section)[control] = String(event.target.value || '');
        render();
    }

    const handleEntitySubmit = event => {
        event.preventDefault();
        saveEntityFromForm(event.currentTarget);
    };
    const handleEntityCancel = () => closeModal();
    const handleModalBackdrop = event => {
        if (event.target === getModal()) closeModal();
    };
    const handleDocumentKeydown = event => {
        if (event.key === 'Escape' && getModal()?.classList.contains('active')) closeModal();
    };

    function init() {
        const root = document.getElementById('view-business');
        if (!root) return;
        if (root.dataset.businessBound === 'true') {
            render();
            return;
        }
        root.dataset.businessBound = 'true';
        root.addEventListener('click', handleClick);
        root.addEventListener('input', handleInput);
        root.addEventListener('compositionstart', handleCompositionStart);
        root.addEventListener('compositionend', handleCompositionEnd);
        root.addEventListener('change', handleChange);
        document.getElementById('businessEntityForm')?.addEventListener('submit', handleEntitySubmit);
        document.getElementById('businessEntityCancelBtn')?.addEventListener('click', handleEntityCancel);
        document.getElementById('businessEntityModalClose')?.addEventListener('click', handleEntityCancel);
        getModal()?.addEventListener('click', handleModalBackdrop);
        document.addEventListener('keydown', handleDocumentKeydown);
        render();
    }

    function teardown() {
        const root = document.getElementById('view-business');
        if (root) {
            root.removeEventListener('click', handleClick);
            root.removeEventListener('input', handleInput);
            root.removeEventListener('compositionstart', handleCompositionStart);
            root.removeEventListener('compositionend', handleCompositionEnd);
            root.removeEventListener('change', handleChange);
            delete root.dataset.businessBound;
        }
        document.getElementById('businessEntityForm')?.removeEventListener('submit', handleEntitySubmit);
        document.getElementById('businessEntityCancelBtn')?.removeEventListener('click', handleEntityCancel);
        document.getElementById('businessEntityModalClose')?.removeEventListener('click', handleEntityCancel);
        getModal()?.removeEventListener('click', handleModalBackdrop);
        document.removeEventListener('keydown', handleDocumentKeydown);
        closeModal();
    }

    // Compact summary for the Sutra Assistant / Intelligence context. Bounded,
    // local-only, and never sent anywhere except the user's configured provider.
    function getAssistantSummary() {
        try {
            const model = buildModel();
            const m = model.metrics;
            const lowHealth = Array.from(model.healthByProject.entries())
                .map(([id, h]) => ({ name: (model.refs.projects.get(id) || {}).name || 'Project', score: h.score }))
                .filter(p => p.score < 50)
                .sort((a, b) => a.score - b.score)
                .slice(0, 5);
            return {
                activeProjects: m.activeProjects,
                atRiskProjects: m.atRiskProjects,
                healthAtRisk: m.healthAtRisk,
                overdueInvoices: m.overdueInvoices,
                openInvoices: m.openInvoices,
                monthlyIncome: Math.round(m.monthlyIncome),
                monthlyExpenses: Math.round(m.monthlyExpenses),
                netCashFlow: Math.round(m.netCashFlow),
                pipelineValue: Math.round(m.pipelineValue),
                weightedPipeline: Math.round(m.weightedPipeline),
                conversionRate: m.conversionRate,
                meetingsThisWeek: m.meetingsThisWeek,
                tasksDueToday: m.tasksDueToday,
                upcomingDeadlines: m.upcomingDeadlines,
                lowHealthProjects: lowHealth,
                nextDeadlines: model.deadlines.slice(0, 3).map(d => ({ type: d.type, title: d.title, date: d.date, bucket: d.bucket }))
            };
        } catch (err) { return null; }
    }

    window.NoteFlowBusiness = {
        currency,
        getDeadlines: (limit = 8) => buildModel().deadlines.slice(0, Math.max(1, limit)),
        getAssistantSummary,
        openEntity: (type, defaults) => { try { openEntityModal(type, '', defaults || {}); } catch (err) { /* non-critical */ } },
        render,
        init,
        teardown
    };
})();
