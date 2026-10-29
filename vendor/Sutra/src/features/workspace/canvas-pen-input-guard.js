/*
 * Canvas pen input isolation
 *
 * The drawing layer sits inside the stage shell. Its pointer movements must not
 * bubble into the stage's selection/drag controller, or a selected object can
 * move while the user is trying to draw. Let the draw-layer's own listeners
 * process pen input, but stop those events before they reach the parent.
 */
(function canvasPenInputGuard() {
    'use strict';

    function bindPenInputGuard() {
        var editor = document.getElementById('canvasEditor');
        var drawLayer = document.getElementById('canvasDrawLayer');
        var stageShell = document.getElementById('canvasStageShell');
        if (!editor || !drawLayer || !stageShell || drawLayer.dataset.penInputGuardBound === 'true') return;

        drawLayer.dataset.penInputGuardBound = 'true';
        function isolatePenInput(event) {
            if (editor.dataset.canvasTool === 'pen') event.stopPropagation();
        }

        // The draw layer handles the event first; then the stage-shell boundary
        // prevents it from reaching canvasEditor's parent drag listener.
        // Pointerup is intentionally allowed through so the stage can finish
        // any previous drag cleanly.
        stageShell.addEventListener('pointermove', function (event) {
            if (event.target === drawLayer) isolatePenInput(event);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindPenInputGuard, { once: true });
    } else {
        bindPenInputGuard();
    }
}());
