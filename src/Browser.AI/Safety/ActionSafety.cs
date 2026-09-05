using Browser.AI.Tools;

namespace Browser.AI.Safety;

public enum ActionRisk { Low, Consequential, Forbidden }
public sealed record ActionAssessment(ActionRisk Risk, string Reason)
{
    public bool RequiresConfirmation => Risk == ActionRisk.Consequential;
}

public static class ActionSafety
{
    public static ActionAssessment Classify(BrowserAction action)
    {
        if (action.Type == BrowserActionType.RequestCredentialAutofill)
            return new(ActionRisk.Consequential, "Fill a saved password into an HTTPS page");
        if (action.SubmitsData)
            return new(ActionRisk.Consequential, action.Description ?? "Submit information to the website");
        if (action.Type == BrowserActionType.Type && LooksSensitive(action.Text))
            return new(ActionRisk.Forbidden, "The model may not type passwords, payment data, or secret tokens");
        if (action.Type is BrowserActionType.Navigate or BrowserActionType.Search or BrowserActionType.Back or BrowserActionType.Forward or BrowserActionType.Reload
            or BrowserActionType.NewTab or BrowserActionType.SwitchTab or BrowserActionType.CloseTab or BrowserActionType.HibernateTab
            or BrowserActionType.SetPinned or BrowserActionType.Bookmark or BrowserActionType.ReadVisibleText or BrowserActionType.ReadOutline
            or BrowserActionType.FindElements or BrowserActionType.Click or BrowserActionType.Type or BrowserActionType.Select or BrowserActionType.Scroll
            or BrowserActionType.ReadSelectedText or BrowserActionType.Wait or BrowserActionType.Complete or BrowserActionType.Fail)
            return new(ActionRisk.Low, "Within the user-requested browser task");
        return new(ActionRisk.Forbidden, "Unknown or unsupported action");
    }

    private static bool LooksSensitive(string? value)
    {
        if (string.IsNullOrEmpty(value)) return false;
        var lower = value.ToLowerInvariant();
        return lower.Contains("password=") || lower.Contains("api_key") || lower.Contains("bearer ") ||
               (value.Replace(" ", "").All(char.IsDigit) && value.Replace(" ", "").Length is >= 13 and <= 19);
    }
}

public interface IActionApproval
{
    Task<bool> ConfirmAsync(BrowserAction action, string origin, ActionAssessment assessment, CancellationToken cancellationToken);
}

