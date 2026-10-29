using Browser.Core.Branding;
using Microsoft.UI;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace Browser.App;

public sealed partial class MainWindow
{
    private Border? _sutraCapturePanel;
    private bool _sutraCaptureSaving;

    private Task ShowSutraCapturePanelAsync(bool deadline)
    {
        if (_isPrivate) return Task.CompletedTask;
        var (pageTitle, url) = CurrentPageCapture();
        if (string.IsNullOrWhiteSpace(url))
        {
            ShowStatus("Open a web page before creating a Sutra item.", InfoBarSeverity.Warning);
            return Task.CompletedTask;
        }
        if (_sutraCaptureSaving) return Task.CompletedTask;
        CloseSutraCapturePanel();
        if (_workspaceSidePanelOpen) CloseSutraSidePanel();
        _activeCaptureAction = deadline ? "Add Deadline" : "Create Homework";
        RefreshDesktopSidebar();
        var content = new StackPanel { Spacing = 10, Padding = new(22) };
        var header = new Grid();
        header.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var brand = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, VerticalAlignment = VerticalAlignment.Center };
        brand.Children.Add(new Image { Source = new BitmapImage(new Uri(AppBrand.DesktopIconUri)), Width = 28, Height = 28 });
        brand.Children.Add(new TextBlock { Text = AppBrand.ShortName, FontSize = 23, FontFamily = new FontFamily("Georgia"), FontWeight = FontWeights.Bold });
        header.Children.Add(brand);
        var close = IconButton(Symbol.Cancel, "Close capture");
        close.Click += (_, _) => CloseSutraCapturePanel();
        Grid.SetColumn(close, 1); header.Children.Add(close); content.Children.Add(header);
        content.Children.Add(new TextBlock { Text = deadline ? "Add Deadline" : "Add to Homework", FontSize = 24, FontWeight = FontWeights.SemiBold });
        content.Children.Add(new TextBlock { Text = "Review the details before saving.", FontSize = 14, Foreground = ChromeBrush("SutraTextSecondaryBrush"), TextWrapping = TextWrapping.Wrap });
        var source = new StackPanel { Spacing = 5 };
        source.Children.Add(new TextBlock { Text = pageTitle, FontSize = 14, FontWeight = FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap, MaxLines = 2 });
        source.Children.Add(new TextBlock { Text = new Uri(url).Host, FontSize = 12, Foreground = ChromeBrush("SutraTextSecondaryBrush"), TextTrimming = TextTrimming.CharacterEllipsis });
        var sourceCard = new Grid { ColumnSpacing = 12 };
        sourceCard.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        sourceCard.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        if (_vm.SelectedTab is { } sourceTab) sourceCard.Children.Add(TabIcon(sourceTab, 36));
        Grid.SetColumn(source, 1); sourceCard.Children.Add(source);
        content.Children.Add(new Border { Child = sourceCard, Padding = new(14), CornerRadius = new(9), BorderThickness = new(1), BorderBrush = ChromeBrush("SutraBorderBrush"), Background = ChromeBrush("SutraSurfaceBrush") });
        var course = new TextBox { Header = "Class (optional)", PlaceholderText = "Class name", MaxLength = 120 };
        var title = new TextBox { Header = "Title", Text = pageTitle, MaxLength = 300 };
        var date = new CalendarDatePicker { Header = deadline ? "Deadline" : "Due date", PlaceholderText = "Choose a date", HorizontalAlignment = HorizontalAlignment.Stretch };
        var time = new TimePicker { Header = "Time (optional)", SelectedTime = null, HorizontalAlignment = HorizontalAlignment.Stretch };
        content.Children.Add(course); content.Children.Add(title);
        content.Children.Add(date); content.Children.Add(time);
        var difficulty = "medium";
        var levels = new Grid { ColumnSpacing = 4 };
        var levelButtons = new List<Button>();
        foreach (var value in new[] { "Easy", "Medium", "Hard" })
        {
            levels.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
            var button = new Button { Content = value, Height = 36, HorizontalAlignment = HorizontalAlignment.Stretch, CornerRadius = new(8) };
            AutomationProperties.SetName(button, value + " difficulty");
            void UpdateLevels()
            {
                foreach (var item in levelButtons)
                {
                    var selected = item.Content.ToString()!.ToLowerInvariant() == difficulty;
                    item.Background = selected ? ChromeBrush("SutraAccentBrush") : new SolidColorBrush(Colors.Transparent);
                    item.BorderThickness = new(0);
                    AutomationProperties.SetHelpText(item, selected ? "Selected" : "Choose difficulty");
                }
            }
            button.Click += (_, _) => { difficulty = value.ToLowerInvariant(); UpdateLevels(); };
            Grid.SetColumn(button, levelButtons.Count); levelButtons.Add(button); levels.Children.Add(button); UpdateLevels();
        }
        content.Children.Add(new TextBlock { Text = "Difficulty", FontSize = 14 }); content.Children.Add(levels);
        var notes = new TextBox { Header = "Notes (optional)", PlaceholderText = "Add a reminder or important details", AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, Height = 84, MaxLength = 2000 };
        content.Children.Add(notes);
        var error = new TextBlock { TextWrapping = TextWrapping.Wrap, Foreground = new SolidColorBrush(ColorFromHex("#FFB4B4")), Visibility = Visibility.Collapsed };
        AutomationProperties.SetLiveSetting(error, Microsoft.UI.Xaml.Automation.Peers.AutomationLiveSetting.Polite);
        content.Children.Add(error);
        var save = new Button { Content = deadline ? "Add Deadline" : "Add to Homework", Height = 44, HorizontalAlignment = HorizontalAlignment.Stretch, CornerRadius = new(8), Background = ChromeBrush("SutraAccentBrush"), Foreground = new SolidColorBrush(Colors.White), FontWeight = FontWeights.SemiBold };
        async Task SaveAsync(bool sourceOnly)
        {
            if (_sutraCaptureSaving) return;
            error.Visibility = Visibility.Collapsed;
            if (string.IsNullOrWhiteSpace(title.Text)) { error.Text = "Enter a title before saving."; error.Visibility = Visibility.Visible; title.Focus(FocusState.Programmatic); return; }
            if (time.SelectedTime is not null && date.Date is null) { error.Text = "Choose a date to go with the time."; error.Visibility = Visibility.Visible; return; }
            _sutraCaptureSaving = true;
            foreach (var control in content.Children.OfType<Control>().Concat(levelButtons)) control.IsEnabled = false;
            close.IsEnabled = false;
            var originalLabel = save.Content;
            save.Content = "Saving…";
            try
            {
                await EnsureSutraWorkspaceAsync();
                var ok = sourceOnly
                    ? await SendSutraCommandAsync("capture.source", new { title = title.Text.Trim(), url, note = notes.Text, excerpt = "" })
                    : await SendSutraCommandAsync(deadline ? "capture.deadline" : "capture.homework", new
                    {
                        title = title.Text.Trim(), courseName = course.Text.Trim(), dueDate = date.Date?.ToString("yyyy-MM-dd") ?? "",
                        dueTime = time.SelectedTime is { } selectedTime ? $"{selectedTime.Hours:00}:{selectedTime.Minutes:00}" : "",
                        difficulty, notes = notes.Text, url
                    });
                if (ok)
                {
                    _sutraCaptureSaving = false;
                    CloseSutraCapturePanel();
                    ShowStatus(sourceOnly ? "Source saved to Sutra Notes." : deadline ? "Deadline saved to Sutra." : "Saved to Sutra Homework.", InfoBarSeverity.Success);
                }
                else { error.Text = "Sutra could not save this item. Your details are still here."; error.Visibility = Visibility.Visible; }
            }
            finally { _sutraCaptureSaving = false; foreach (var control in content.Children.OfType<Control>().Concat(levelButtons)) control.IsEnabled = true; close.IsEnabled = true; save.Content = originalLabel; }
        }
        save.Click += async (_, _) => await SaveAsync(false); content.Children.Add(save);
        var linkOnly = new Button { Content = "Save link only", HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Background = new SolidColorBrush(Colors.Transparent), BorderThickness = new(0) };
        linkOnly.Click += async (_, _) => await SaveAsync(true); content.Children.Add(linkOnly);
        var scroll = new ScrollViewer { Content = content, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
        _sutraCapturePanel = new Border
        {
            Child = scroll, Width = 400, MaxWidth = Math.Max(280, _browserHost.ActualWidth - 24),
            HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Stretch,
            Margin = new(12), CornerRadius = new(12), BorderThickness = new(1), BorderBrush = ChromeBrush("SutraBorderBrush"), Background = ChromeBrush("SutraChromeBrush")
        };
        AutomationProperties.SetName(_sutraCapturePanel, deadline ? "Add Deadline" : "Add to Homework");
        var panel = _sutraCapturePanel;
        void FitPanel(object sender, SizeChangedEventArgs args) => panel.MaxWidth = Math.Max(220, _browserHost.ActualWidth - 24);
        _browserHost.SizeChanged += FitPanel;
        panel.Unloaded += (_, _) => _browserHost.SizeChanged -= FitPanel;
        Grid.SetColumn(_sutraCapturePanel, 1); Grid.SetRow(_sutraCapturePanel, 2); Canvas.SetZIndex(_sutraCapturePanel, 28);
        _contentGrid.Children.Add(_sutraCapturePanel);
        title.Focus(FocusState.Programmatic);
        return Task.CompletedTask;
    }

    private void CloseSutraCapturePanel()
    {
        if (_sutraCaptureSaving) return;
        if (_sutraCapturePanel is not null) _contentGrid.Children.Remove(_sutraCapturePanel);
        _sutraCapturePanel = null;
        _activeCaptureAction = null;
        RefreshDesktopSidebar();
    }
}
