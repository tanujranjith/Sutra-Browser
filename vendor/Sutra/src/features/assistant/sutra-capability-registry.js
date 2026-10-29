// Sutra Capability Registry — declarative metadata for every certified action.
//
// This is the formal "what can the assistant do, who owns it, and how safe is
// it" registry. It is intentionally SEPARATE from the executor/validator/preview
// logic (those live in flow-assistant.js, which already owns one apply pipeline).
// Here we declare, per certified action type:
//   - domain      : the owning feature area
//   - scope       : the minimum Workspace Access the action needs to operate
//                   ('none' | 'currentView' | 'workspace')
//   - readOnly    : never mutates workspace state
//   - reversible  : has a safe undo path
//   - destructive : removes data — always requires explicit confirmation
//
// flow-assistant.js merges this metadata into getActionDefinition(), so adding a
// new certified action means: (1) an ACTION_CATALOG entry + applier in
// flow-assistant, and (2) one CAPABILITIES row here. Tests assert the two stay
// in lockstep, so a new action can't ship without declaring its domain/scope.
//
// Public surface: window.SutraCapabilityRegistry (+ module.exports for tests).
(function () {
    'use strict';

    const VERSION = '1.0.0';

    const DOMAINS = {
        navigation: 'Navigation',
        tasks: 'Planner tasks',
        homework: 'Homework',
        notes: 'Notes & pages',
        canvas: 'Canvas',
        slides: 'Slides',
        courses: 'Course Hub',
        timeline: 'Timeline',
        review: 'Review & flashcards',
        study: 'Study (Cram / AP)',
        testing: 'Testing Hub',
        planning: 'Plans',
        grades: 'Grade Planner',
        college: 'College',
        focus: 'Focus & utilities',
        theme: 'Themes',
        memory: 'Assistant Memory',
        assistant: 'Assistant'
    };

    const SCOPES = ['none', 'currentView', 'workspace'];

    // type -> { domain, scope, readOnly?, reversible?, destructive? }
    const CAPABILITIES = {
        // Navigation
        navigate: { domain: 'navigation', scope: 'none' },
        navigate_to_course: { domain: 'navigation', scope: 'none' },
        navigate_to_all_due: { domain: 'navigation', scope: 'none' },
        open_class_dashboard: { domain: 'navigation', scope: 'none' },
        open_source_object: { domain: 'navigation', scope: 'workspace' },
        run_deadline_radar: { domain: 'navigation', scope: 'none' },

        // Notes
        insert_text: { domain: 'notes', scope: 'currentView', reversible: true },
        replace_selection: { domain: 'notes', scope: 'currentView', reversible: true },
        edit_note_patch: { domain: 'notes', scope: 'workspace', reversible: true },
        rename_note_heading: { domain: 'notes', scope: 'workspace', reversible: true },
        move_note_blocks: { domain: 'notes', scope: 'workspace', reversible: true },
        deduplicate_note: { domain: 'notes', scope: 'workspace', reversible: true },
        split_note: { domain: 'notes', scope: 'workspace', reversible: true },
        merge_notes: { domain: 'notes', scope: 'workspace', reversible: true },
        apply_note_tags: { domain: 'notes', scope: 'workspace', reversible: true },
        create_note_backlink: { domain: 'notes', scope: 'workspace', reversible: true },
        convert_selection_to_fields: { domain: 'notes', scope: 'currentView', reversible: true },
        create_page: { domain: 'notes', scope: 'none', reversible: true },
        append_note_text: { domain: 'notes', scope: 'currentView', reversible: true },
        create_note_from_response: { domain: 'notes', scope: 'currentView', reversible: true },
        link_workspace_objects: { domain: 'notes', scope: 'workspace' },

        // Canvas
        canvas_add_sticky: { domain: 'canvas', scope: 'currentView' },
        canvas_add_text: { domain: 'canvas', scope: 'currentView' },
        canvas_create_task_from_selection: { domain: 'canvas', scope: 'currentView' },
        canvas_create_note_from_selection: { domain: 'canvas', scope: 'currentView' },
        canvas_group_selection: { domain: 'canvas', scope: 'currentView' },
        canvas_create_board: { domain: 'canvas', scope: 'none', reversible: true },
        canvas_edit_board: { domain: 'canvas', scope: 'currentView', reversible: true },

        // Slides
        slides_create_deck: { domain: 'slides', scope: 'none', reversible: true },
        slides_edit_deck: { domain: 'slides', scope: 'currentView', reversible: true },

        // Planner tasks
        create_task: { domain: 'tasks', scope: 'none', reversible: true },
        update_task_status: { domain: 'tasks', scope: 'workspace', reversible: true },
        reschedule_tasks: { domain: 'tasks', scope: 'workspace', reversible: true },
        change_task_priority: { domain: 'tasks', scope: 'workspace', reversible: true },

        // Testing Hub exams (distinct from tasks/homework)
        update_exam_status: { domain: 'testing', scope: 'workspace', reversible: true },

        // Homework
        create_homework: { domain: 'homework', scope: 'none', reversible: true },
        add_assignment_milestones: { domain: 'homework', scope: 'workspace' },

        // Course Hub
        create_course: { domain: 'courses', scope: 'none' },
        create_assignment_for_course: { domain: 'courses', scope: 'workspace' },
        add_resource_link_to_course: { domain: 'courses', scope: 'workspace' },
        link_note_to_course: { domain: 'courses', scope: 'workspace' },
        archive_course: { domain: 'courses', scope: 'workspace' },

        // Timeline
        create_timeline_block: { domain: 'timeline', scope: 'currentView', reversible: true },
        update_timeline_block: { domain: 'timeline', scope: 'workspace', reversible: true },
        delete_timeline_block: { domain: 'timeline', scope: 'workspace', reversible: true, destructive: true },
        schedule_existing_item: { domain: 'timeline', scope: 'workspace' },
        schedule_review_session: { domain: 'timeline', scope: 'workspace' },

        // Review & study
        create_review_deck: { domain: 'review', scope: 'none', reversible: true },
        add_review_cards: { domain: 'review', scope: 'workspace' },
        convert_note_to_study_system: { domain: 'review', scope: 'currentView' },
        create_cram_session: { domain: 'study', scope: 'none' },

        // Planning
        create_study_plan: { domain: 'planning', scope: 'workspace' },
        create_exam_plan: { domain: 'planning', scope: 'workspace' },
        create_assignment_plan: { domain: 'planning', scope: 'workspace' },
        create_action_plan: { domain: 'planning', scope: 'workspace' },
        plan_week: { domain: 'planning', scope: 'workspace' },
        plan_day: { domain: 'planning', scope: 'workspace' },
        triage_deadlines: { domain: 'planning', scope: 'workspace' },
        create_recovery_plan: { domain: 'planning', scope: 'workspace' },
        repair_plan: { domain: 'planning', scope: 'workspace', readOnly: true },
        import_assignments: { domain: 'planning', scope: 'none' },

        // Grades (deterministic local math — read-only)
        run_grade_what_if: { domain: 'grades', scope: 'workspace', readOnly: true },
        solve_target_grade: { domain: 'grades', scope: 'workspace', readOnly: true },
        rank_missing_work_by_grade_impact: { domain: 'grades', scope: 'workspace', readOnly: true },
        explain_grade_risk: { domain: 'grades', scope: 'workspace', readOnly: true },

        // College
        create_college_task: { domain: 'college', scope: 'none', reversible: true },

        // Focus & utilities
        start_focus_session: { domain: 'focus', scope: 'none' },
        run_weekly_review: { domain: 'focus', scope: 'workspace', reversible: true },
        create_quick_capture_item: { domain: 'focus', scope: 'none' },
        change_context_depth: { domain: 'assistant', scope: 'none' },

        // Assistant Memory
        create_memory: { domain: 'memory', scope: 'none', reversible: true },
        update_memory: { domain: 'memory', scope: 'none', reversible: true },
        promote_memory_to_note: { domain: 'memory', scope: 'none', reversible: true },
        enable_memory: { domain: 'memory', scope: 'none', reversible: true },
        disable_memory: { domain: 'memory', scope: 'none', reversible: true },
        delete_memory: { domain: 'memory', scope: 'none', reversible: true, destructive: true },
        clear_expired_memories: { domain: 'memory', scope: 'none', reversible: true },
        clear_temporary_memories: { domain: 'memory', scope: 'none', reversible: true },
        open_memory_manager: { domain: 'memory', scope: 'none', readOnly: true }
    };

    function get(type) {
        const cap = CAPABILITIES[type];
        if (!cap) return null;
        return Object.assign({
            type,
            domain: cap.domain,
            domainLabel: DOMAINS[cap.domain] || cap.domain,
            scope: cap.scope || 'none',
            readOnly: !!cap.readOnly,
            reversible: !!cap.reversible,
            destructive: !!cap.destructive
        }, {});
    }

    function list() { return Object.keys(CAPABILITIES).slice().sort(); }

    function byDomain(domain) {
        return list().filter(t => CAPABILITIES[t].domain === domain);
    }

    function domains() { return Object.assign({}, DOMAINS); }

    function requiredScope(type) {
        const c = CAPABILITIES[type];
        return c ? (c.scope || 'none') : 'none';
    }

    // Is the action permitted under the user's current Workspace Access depth?
    // depth: 'minimal' | 'currentView' | 'workspace'. Navigation/none-scope
    // actions are always allowed; deeper scopes require an equal/greater depth.
    function isAllowedUnderDepth(type, depth) {
        const need = requiredScope(type);
        if (need === 'none') return true;
        const order = { minimal: 0, currentView: 1, workspace: 2 };
        const have = order[depth] != null ? order[depth] : 1;
        const want = need === 'workspace' ? 2 : (need === 'currentView' ? 1 : 0);
        return have >= want;
    }

    const api = {
        VERSION,
        DOMAINS,
        SCOPES: SCOPES.slice(),
        get,
        list,
        byDomain,
        domains,
        requiredScope,
        isAllowedUnderDepth
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.SutraCapabilityRegistry = api;
    }
})();
