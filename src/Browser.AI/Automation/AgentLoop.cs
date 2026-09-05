using Browser.AI.Providers;
using Browser.AI.Safety;
using Browser.AI.Tools;

namespace Browser.AI.Automation;

public sealed record ActionResult(bool Success, string Observation, bool IsComplete = false);
public interface IBrowserActionExecutor
{
    string CurrentOrigin { get; }
    Task<ActionResult> ExecuteAsync(BrowserAction action, CancellationToken cancellationToken);
}
public interface IActionAuditSink { Task RecordAsync(BrowserAction action, string origin, ActionResult result, bool confirmationRequired, CancellationToken cancellationToken); }
public sealed record AgentLoopOptions(int MaximumActions = 20, TimeSpan? ActionTimeout = null, TimeSpan? ProviderTimeout = null);
public sealed record AgentProgress(int Step, BrowserAction? Action, string Message);
public sealed record AgentRunResult(bool Success, string Message, int ActionsExecuted);

public sealed class AgentLoop(IAiProvider provider, IBrowserActionExecutor executor, IActionApproval approval, IActionAuditSink audit)
{
    private const string SystemPrompt = """
        You control a browser only through one JSON action at a time. Return a single JSON object.
        Valid types: navigate, search, back, forward, reload, newTab, switchTab, closeTab, hibernateTab,
        setPinned, bookmark, readVisibleText, readOutline, findElements, click, type, select, scroll,
        readSelectedText, requestCredentialAutofill, wait, complete, fail.
        Reference page elements only by temporary elementId. Never request or reproduce passwords, cookies,
        tokens, local storage, hidden HTML, payment numbers, or filesystem access. Set submitsData=true for any
        action that sends data. Use complete or fail to stop.
        """;

    public async Task<AgentRunResult> RunAsync(string goal, AgentLoopOptions options, IProgress<AgentProgress>? progress = null, CancellationToken cancellationToken = default)
    {
        var max = Math.Clamp(options.MaximumActions, 1, 50);
        var actionTimeout = options.ActionTimeout ?? TimeSpan.FromSeconds(20);
        var providerTimeout = options.ProviderTimeout ?? TimeSpan.FromSeconds(60);
        var messages = new List<AiMessage> { new("system", SystemPrompt), new("user", goal) };
        for (var step = 1; step <= max; step++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            progress?.Report(new(step, null, "Thinking"));
            string response;
            using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
            {
                timeout.CancelAfter(providerTimeout);
                try { response = await provider.CompleteAsync(new(messages), timeout.Token); }
                catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return new(false, "The AI provider timed out.", step - 1); }
            }
            if (!BrowserActionParser.TryParse(response, out var action, out var parseError))
                return new(false, parseError ?? "Invalid AI response.", step - 1);
            var requestedAction = action!;

            var assessment = ActionSafety.Classify(requestedAction);
            if (assessment.Risk == ActionRisk.Forbidden) return new(false, assessment.Reason, step - 1);
            if (assessment.RequiresConfirmation && !await approval.ConfirmAsync(requestedAction, executor.CurrentOrigin, assessment, cancellationToken))
                return new(false, "The user declined the consequential action.", step - 1);

            progress?.Report(new(step, requestedAction, requestedAction.Description ?? requestedAction.Type.ToString()));
            ActionResult result;
            using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
            {
                timeout.CancelAfter(actionTimeout);
                try { result = await executor.ExecuteAsync(requestedAction, timeout.Token); }
                catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { result = new(false, "Action timed out."); }
                catch (Exception ex) { result = new(false, $"Action failed: {ex.GetType().Name}"); }
            }
            await audit.RecordAsync(requestedAction, executor.CurrentOrigin, result, assessment.RequiresConfirmation, cancellationToken);
            if (requestedAction.Type == BrowserActionType.Fail) return new(false, requestedAction.Description ?? result.Observation, step);
            if (requestedAction.Type == BrowserActionType.Complete || result.IsComplete) return new(result.Success, requestedAction.Description ?? result.Observation, step);
            messages.Add(new("assistant", response)); messages.Add(new("user", $"Observation: {result.Observation}"));
        }
        return new(false, $"Stopped after the configured limit of {max} actions.", max);
    }
}
