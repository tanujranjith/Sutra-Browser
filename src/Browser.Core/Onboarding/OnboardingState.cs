using System.Text.Json;
using Browser.Core.Settings;

namespace Browser.Core.Onboarding;

public enum OnboardingCompletion
{
    Completed,
    Skipped
}

public sealed record OnboardingState(int Version, OnboardingCompletion Completion, DateTimeOffset RecordedAt)
{
    public const int CurrentVersion = 1;
    public const string StorageKey = "browser.onboarding.v1";

    public static OnboardingState Create(OnboardingCompletion completion, DateTimeOffset? recordedAt = null) =>
        new(CurrentVersion, completion, recordedAt ?? DateTimeOffset.UtcNow);

    public static string Serialize(OnboardingState state) =>
        JsonSerializer.Serialize(state with { Version = CurrentVersion });

    public static bool TryDeserialize(string? value, out OnboardingState? state)
    {
        state = null;
        if (string.IsNullOrWhiteSpace(value)) return false;

        try
        {
            var parsed = JsonSerializer.Deserialize<OnboardingState>(value);
            if (parsed is null || parsed.Version != CurrentVersion || !Enum.IsDefined(parsed.Completion)) return false;
            state = parsed;
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}

public static class OnboardingEligibility
{
    public static bool ShouldShow(
        bool isPrivate,
        bool hasInitialUrl,
        bool isRegularStartupWindow,
        bool hasExistingSettings,
        bool hasExistingSession,
        OnboardingState? state) =>
        !isPrivate &&
        !hasInitialUrl &&
        isRegularStartupWindow &&
        !hasExistingSettings &&
        !hasExistingSession &&
        state is null;

    public static bool IsFinished(OnboardingState? state) => state is not null;
}
