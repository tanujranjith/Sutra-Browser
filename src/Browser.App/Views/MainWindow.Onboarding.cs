using Browser.Core.Branding;
using Browser.Core.Onboarding;
using Browser.Core.Settings;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace Browser.App;

public sealed partial class MainWindow
{
    private const string OnboardingPageTitle = "Welcome to Sutra";
    private const string OnboardingPageUrl = "sutra://page/welcometosutra";
    private BrowserSettings _onboardingDraftSettings = new();
    private readonly HashSet<string> _onboardingChecklist = new(StringComparer.OrdinalIgnoreCase);
    private int _onboardingStep;
    private bool _onboardingInProgress;

    private async Task ShowOnboardingAsync(bool restart)
    {
        if (_isPrivate)
        {
            ShowStatus("Onboarding is available in a normal Sutra window.", InfoBarSeverity.Informational);
            return;
        }

        if (restart || !_onboardingInProgress)
        {
            _onboardingDraftSettings = _vm.Settings;
            _onboardingChecklist.Clear();
            _onboardingStep = 0;
            _onboardingInProgress = true;
        }

        ShowOnboardingStep();
        await Task.CompletedTask;
    }

    private void ShowOnboardingStep()
    {
        var (subtitle, body, actions) = _onboardingStep switch
        {
            0 => BuildOnboardingWelcome(),
            1 => BuildOnboardingPrivacy(),
            2 => BuildOnboardingImport(),
            3 => BuildOnboardingCopilot(),
            _ => BuildOnboardingChecklist()
        };

        ShowPage(OnboardingPageTitle, subtitle, body, actions);
    }

    private (string Subtitle, FrameworkElement Body, Button[] Actions) BuildOnboardingWelcome()
    {
        var body = OnboardingPanel();
        body.Children.Add(new SymbolIcon(Symbol.Home) { Width = 52, Height = 52, Opacity = .86, HorizontalAlignment = HorizontalAlignment.Center });
        body.Children.Add(new TextBlock
        {
            Text = "A calmer, more capable place to browse.",
            FontSize = 28,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap
        });
        body.Children.Add(new TextBlock
        {
            Text = $"Take a minute to choose your privacy defaults, learn where {AppBrand.AssistantName} sends page content, and try the features that make Sutra feel like yours.",
            FontSize = 16,
            Opacity = .72,
            MaxWidth = 650,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap
        });
        body.Children.Add(OnboardingFeatureCard(Symbol.ProtectedDocument, "Private by design", "Protection, local history, and AI sharing are visible choices—not hidden assumptions."));
        body.Children.Add(OnboardingFeatureCard(Symbol.Tag, "Organize without clutter", "Use tabs, bookmarks, reading lists, workspaces, and profiles when you need them."));
        body.Children.Add(OnboardingFeatureCard(Symbol.Message, $"{AppBrand.AssistantName} on your terms", $"Keep {AppBrand.AssistantName} local with Ollama or choose a remote OpenAI-compatible provider later."));

        return ("Let’s make Sutra fit the way you browse.", body,
        [
            OnboardingButton("Skip for now", Symbol.Cancel, SkipOnboardingAsync),
            OnboardingButton("Get started", Symbol.Forward, () => { _onboardingStep = 1; ShowOnboardingStep(); return Task.CompletedTask; })
        ]);
    }

    private (string Subtitle, FrameworkElement Body, Button[] Actions) BuildOnboardingPrivacy()
    {
        var adBlocking = new ToggleSwitch { Header = "Block ads and trackers", IsOn = _onboardingDraftSettings.AdBlockingEnabled };
        var cosmetic = new ToggleSwitch { Header = "Hide blocked ad containers", IsOn = _onboardingDraftSettings.CosmeticFilteringEnabled };
        var cleanLinks = new ToggleSwitch { Header = "Remove common tracking parameters from copied links", IsOn = _onboardingDraftSettings.RemoveTrackingParametersFromCopiedLinks };
        var history = new ToggleSwitch { Header = "Record local browsing history", IsOn = _onboardingDraftSettings.HistoryEnabled };
        var body = OnboardingPanel();
        body.Children.Add(OnboardingSection("Protection and history", "These choices apply to normal windows. Private windows do not save browsing history or AI action logs.", adBlocking, cosmetic, cleanLinks, history));
        body.Children.Add(OnboardingFeatureCard(Symbol.ProtectedDocument, "What stays local", "Sutra keeps these settings, bookmarks, and history on this device. You can change them any time in Settings."));

        async Task ContinueAsync()
        {
            _onboardingDraftSettings = SettingsValidator.Validate(_onboardingDraftSettings with
            {
                AdBlockingEnabled = adBlocking.IsOn,
                CosmeticFilteringEnabled = cosmetic.IsOn,
                RemoveTrackingParametersFromCopiedLinks = cleanLinks.IsOn,
                HistoryEnabled = history.IsOn
            });
            _onboardingStep = 2;
            ShowOnboardingStep();
            await Task.CompletedTask;
        }

        return ("Choose the privacy defaults you want from day one.", body,
        [
            OnboardingButton("Back", Symbol.Back, () => { _onboardingStep = 0; ShowOnboardingStep(); return Task.CompletedTask; }),
            OnboardingButton("Skip for now", Symbol.Cancel, SkipOnboardingAsync),
            OnboardingButton("Continue", Symbol.Forward, ContinueAsync)
        ]);
    }

    private (string Subtitle, FrameworkElement Body, Button[] Actions) BuildOnboardingImport()
    {
        var body = OnboardingPanel();
        body.Children.Add(OnboardingSection("Bring over your bookmarks", "Optional. Sutra reads only a local Chrome bookmark file or a bookmark HTML export. It does not import passwords, cookies, extensions, or browsing sessions.",
            OnboardingButton("Import from Chrome", Symbol.Download, ImportChromeBookmarksAsync),
            OnboardingButton("Import bookmark HTML", Symbol.Download, () => ImportBookmarksAsync(RefreshBookmarkBarAsync, RefreshBookmarkBarAsync))));
        body.Children.Add(OnboardingFeatureCard(Symbol.Download, "You can do this later", "Import browser data remains available from the Sutra menu whenever you are ready."));

        return ("Bring your bookmarks with you—or start fresh.", body,
        [
            OnboardingButton("Back", Symbol.Back, () => { _onboardingStep = 1; ShowOnboardingStep(); return Task.CompletedTask; }),
            OnboardingButton("Skip import", Symbol.Cancel, () => { _onboardingStep = 3; ShowOnboardingStep(); return Task.CompletedTask; }),
            OnboardingButton("Continue", Symbol.Forward, () => { _onboardingStep = 3; ShowOnboardingStep(); return Task.CompletedTask; })
        ]);
    }

    private (string Subtitle, FrameworkElement Body, Button[] Actions) BuildOnboardingCopilot()
    {
        var provider = new ComboBox
        {
            Header = $"{AppBrand.AssistantName} provider",
            ItemsSource = Enum.GetNames<AiProviderKind>(),
            SelectedItem = _onboardingDraftSettings.AiProvider.ToString(),
            MinWidth = 300
        };
        var explanation = new TextBlock { TextWrapping = TextWrapping.Wrap, Opacity = .7 };
        void UpdateExplanation()
        {
            explanation.Text = provider.SelectedItem?.ToString() == nameof(AiProviderKind.Ollama)
                ? $"Ollama keeps the provider local to your device. Page text is sent only to the local model when you invoke {AppBrand.AssistantName}."
                : $"An OpenAI-compatible provider is remote. Visible page text is sent only after you invoke {AppBrand.AssistantName}, and credentials are configured later in Settings.";
        }
        provider.SelectionChanged += (_, _) => UpdateExplanation();
        UpdateExplanation();

        var body = OnboardingPanel();
        body.Children.Add(OnboardingSection($"{AppBrand.AssistantName}, clearly explained", "Choose the provider you want Sutra to use. This step never asks for an API key or sends page content.", provider, explanation));
        body.Children.Add(OnboardingFeatureCard(Symbol.Message, "You are always in control", $"{AppBrand.AssistantName} starts only when you ask it to act. Private windows require a separate, explicit enablement."));

        async Task ContinueAsync()
        {
            if (Enum.TryParse<AiProviderKind>(provider.SelectedItem?.ToString(), out var selected))
                _onboardingDraftSettings = _onboardingDraftSettings with { AiProvider = selected };
            _onboardingStep = 4;
            ShowOnboardingStep();
            await Task.CompletedTask;
        }

        return ($"Choose where {AppBrand.AssistantName} should process your requests.", body,
        [
            OnboardingButton("Back", Symbol.Back, () => { _onboardingStep = 2; ShowOnboardingStep(); return Task.CompletedTask; }),
            OnboardingButton("Skip for now", Symbol.Cancel, SkipOnboardingAsync),
            OnboardingButton("Continue", Symbol.Forward, ContinueAsync)
        ]);
    }

    private (string Subtitle, FrameworkElement Body, Button[] Actions) BuildOnboardingChecklist()
    {
        var body = OnboardingPanel();
        body.Children.Add(new TextBlock
        {
            Text = "Try a few things now. Every item is optional, and you can finish whenever you are ready.",
            FontSize = 16,
            Opacity = .72,
            TextWrapping = TextWrapping.Wrap
        });
        body.Children.Add(OnboardingChecklistRow("new-tab", "Open a new tab", "Keep the onboarding page open and create a ready-to-use tab.", Symbol.Add,
            () => { NewTab(activate: false); ShowStatus("A new tab is ready beside onboarding."); return Task.CompletedTask; }));
        body.Children.Add(OnboardingChecklistRow("private-window", "Try private browsing", "Open a separate private window. Its history and AI action log stay out of normal storage.", Symbol.ProtectedDocument,
            () => { OpenPrivateWindow(); return Task.CompletedTask; }));
        body.Children.Add(OnboardingChecklistRow("bookmark", "Save a bookmark", "Open a sample page in the background, then use Ctrl+D or the bookmark button when you are ready.", Symbol.OutlineStar,
            () => { NewTab("https://example.com", activate: false); ShowStatus("A sample page is ready. Use Ctrl+D to bookmark it."); return Task.CompletedTask; }));
        body.Children.Add(OnboardingChecklistRow("copilot", $"Open {AppBrand.AssistantName}", $"See the {AppBrand.AssistantName} panel and its local-versus-remote privacy indicator.", Symbol.Message,
            async () => { if (!_vm.IsCopilotOpen) await ToggleCopilotAsync(); }));
        body.Children.Add(OnboardingFeatureCard(Symbol.Home, "You can revisit this anytime", "Open the browser menu and choose Welcome to Sutra to see this walkthrough again."));

        return ("A quick tour of the controls you will use most.", body,
        [
            OnboardingButton("Back", Symbol.Back, () => { _onboardingStep = 3; ShowOnboardingStep(); return Task.CompletedTask; }),
            OnboardingButton("Skip for now", Symbol.Cancel, SkipOnboardingAsync),
            OnboardingButton("Finish setup", Symbol.Accept, FinishOnboardingAsync)
        ]);
    }

    private FrameworkElement OnboardingChecklistRow(string key, string title, string detail, Symbol symbol, Func<Task> action)
    {
        var check = new CheckBox { IsChecked = _onboardingChecklist.Contains(key), VerticalAlignment = VerticalAlignment.Top };
        check.Checked += (_, _) => _onboardingChecklist.Add(key);
        check.Unchecked += (_, _) => _onboardingChecklist.Remove(key);
        var text = new StackPanel { Spacing = 3 };
        text.Children.Add(new TextBlock { Text = title, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
        text.Children.Add(new TextBlock { Text = detail, Opacity = .67, TextWrapping = TextWrapping.Wrap });
        var content = new Grid { ColumnSpacing = 12 };
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        content.Children.Add(check);
        Grid.SetColumn(text, 1); content.Children.Add(text);
        var button = OnboardingButton("Try it", symbol, action);
        Grid.SetColumn(button, 2); content.Children.Add(button);
        return new Border { Child = content, Padding = new(14), CornerRadius = new(10), BorderThickness = new(1), BorderBrush = ResourceBrush("CardStrokeColorDefaultBrush"), Background = ResourceBrush("CardBackgroundFillColorDefaultBrush") };
    }

    private static StackPanel OnboardingPanel() => new()
    {
        Spacing = 14,
        MaxWidth = 760,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center
    };

    private static Border OnboardingSection(string title, string description, params UIElement[] controls) => SettingsSection(title, description, controls);

    private static Border OnboardingFeatureCard(Symbol symbol, string title, string detail)
    {
        var layout = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        layout.Children.Add(new SymbolIcon(symbol) { Width = 28, Height = 28, Opacity = .8, VerticalAlignment = VerticalAlignment.Top });
        var text = new StackPanel { Spacing = 3 };
        text.Children.Add(new TextBlock { Text = title, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
        text.Children.Add(new TextBlock { Text = detail, Opacity = .67, TextWrapping = TextWrapping.Wrap });
        layout.Children.Add(text);
        return new Border { Child = layout, Padding = new(14), CornerRadius = new(10), BorderThickness = new(1), BorderBrush = ResourceBrush("CardStrokeColorDefaultBrush"), Background = ResourceBrush("CardBackgroundFillColorDefaultBrush") };
    }

    private static Button OnboardingButton(string text, Symbol symbol, Func<Task> action)
    {
        var button = new Button
        {
            Content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Children = { new SymbolIcon(symbol), new TextBlock { Text = text } } },
            CornerRadius = new(8)
        };
        button.Click += async (_, _) =>
        {
            try { await action(); }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Onboarding action failed: {ex.GetType().Name}");
            }
        };
        return button;
    }

    private async Task SkipOnboardingAsync()
    {
        if (!await SaveOnboardingStateAsync(OnboardingCompletion.Skipped)) return;
        CloseOnboardingTab();
        ShowStatus("Onboarding skipped. You can reopen Welcome to Sutra from the browser menu.", InfoBarSeverity.Informational, 6500);
    }

    private async Task FinishOnboardingAsync()
    {
        var previousSettings = _vm.Settings;
        try
        {
            var updatedSettings = SettingsValidator.Validate(_onboardingDraftSettings);
            _vm.Settings = updatedSettings;
            await SaveSettingsSafeAsync();
            ApplyTheme();
            ApplyCustomization();
            ApplyTabLayout();
            await RefreshBookmarkBarAsync();
            if (!await SaveOnboardingStateAsync(OnboardingCompletion.Completed)) return;
            CloseOnboardingTab();
            ShowStatus("Sutra is ready. You can reopen onboarding from the browser menu.", InfoBarSeverity.Success, 6500);
        }
        catch (Exception ex)
        {
            _vm.Settings = previousSettings;
            System.Diagnostics.Debug.WriteLine($"Onboarding save failed: {ex.GetType().Name}");
            ShowStatus("Sutra could not save onboarding choices. Your existing settings are unchanged.", InfoBarSeverity.Error, 6500);
        }
    }

    private async Task<bool> SaveOnboardingStateAsync(OnboardingCompletion completion)
    {
        try
        {
            await _appState.SetAsync(OnboardingState.StorageKey, OnboardingState.Serialize(OnboardingState.Create(completion)));
            _onboardingInProgress = false;
            return true;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Onboarding state save failed: {ex.GetType().Name}");
            ShowStatus("Sutra could not save onboarding state. Please try again.", InfoBarSeverity.Error, 6500);
            return false;
        }
    }

    private void CloseOnboardingTab()
    {
        var tab = _vm.Tabs.FirstOrDefault(x => x.Url.Equals(OnboardingPageUrl, StringComparison.OrdinalIgnoreCase));
        if (tab is not null) CloseTab(tab);
    }
}
