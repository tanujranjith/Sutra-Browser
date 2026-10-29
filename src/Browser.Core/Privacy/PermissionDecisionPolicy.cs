namespace Browser.Core.Privacy;

public enum PermissionChoice { Dismissed, Allow, Block }
public sealed record PermissionDecision(bool Allowed, string? RememberedDecision);

public static class PermissionDecisionPolicy
{
    public static PermissionDecision Resolve(bool isPrivate, bool isCurrentDocument, bool remember, PermissionChoice choice)
    {
        if (!isCurrentDocument || choice == PermissionChoice.Dismissed) return new(false, null);
        var allowed = choice == PermissionChoice.Allow;
        return new(allowed, !isPrivate && remember ? allowed ? "Allow" : "Deny" : null);
    }
}
