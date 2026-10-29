using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace Browser.App;

public sealed partial class MainWindow
{
    private Brush ChromeBrush(string key)
    {
        var light = _root.ActualTheme == ElementTheme.Light;
        var hex = key switch
        {
            "SutraChromeBrush" => light ? "#F1F4FC" : Browser.Core.Branding.AppBrand.ChromeColor,
            "SutraToolbarBrush" => light ? "#F7F9FF" : "#0D1524",
            "SutraSurfaceBrush" => light ? "#FFFFFF" : Browser.Core.Branding.AppBrand.SurfaceColor,
            "SutraTextBrush" => light ? "#17243A" : "#F4F6FF",
            "SutraTextSecondaryBrush" => light ? "#53627B" : "#AABBDC",
            "SutraAccentBrush" => _vm.Settings.AccentColor,
            _ => "#808080"
        };
        if (key == "SutraBorderBrush") return new SolidColorBrush(light ? Windows.UI.Color.FromArgb(28, 0, 0, 0) : Windows.UI.Color.FromArgb(24, 255, 255, 255));
        return new SolidColorBrush(ColorFromHex(hex));
    }

    private sealed record SettingsSectionInfo(string Title, string Description, UIElement[] Controls);

    private Grid BuildManagerPage(string title, string subtitle, FrameworkElement body, Button[] actions)
    {
        var page = new Grid { Padding = new(32, 24, 32, 20), RowSpacing = 20, MaxWidth = 1440, HorizontalAlignment = HorizontalAlignment.Stretch };
        page.RowDefinitions.Add(new() { Height = GridLength.Auto });
        page.RowDefinitions.Add(new() { Height = GridLength.Auto });
        page.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star) });
        page.RowDefinitions.Add(new() { Height = GridLength.Auto });

        var destinations = new (string Name, Symbol Icon, Func<Task> Open)[]
        {
            ("Library", Symbol.Library, ShowLibrarySearchAsync),
            ("Bookmarks", Symbol.OutlineStar, ShowBookmarksAsync),
            ("History", Symbol.Clock, ShowHistoryAsync),
            ("Reading list", Symbol.Document, ShowReadingListAsync),
            ("Offline", Symbol.SaveLocal, ShowOfflineLibraryAsync),
            ("Notes", Symbol.Edit, ShowNotesManagerAsync),
            ("Downloads", Symbol.Download, ShowDownloadsAsync),
            ("Settings", Symbol.Setting, ShowSettingsAsync)
        };
        var navigation = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        foreach (var destination in destinations)
        {
            var button = ActionButton(destination.Name, destination.Icon, async () => await destination.Open());
            button.Padding = new(12, 8, 12, 8);
            button.BorderThickness = new(0);
            button.Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
            var selected = title.Equals(destination.Name, StringComparison.OrdinalIgnoreCase) ||
                destination.Name == "Offline" && title == "Offline library" || destination.Name == "Notes" && title == "Page notes";
            if (selected) button.Background = ResourceBrush("SubtleFillColorSecondaryBrush");
            AutomationProperties.SetHelpText(button, selected ? "Current section" : $"Open {destination.Name}");
            navigation.Children.Add(button);
        }
        page.Children.Add(new ScrollViewer { Content = navigation, HorizontalScrollMode = ScrollMode.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled });

        var header = new Grid { ColumnSpacing = 20 };
        header.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var heading = new StackPanel { Spacing = 7 };
        var label = new TextBlock { Text = title, FontSize = 28, FontWeight = FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap };
        AutomationProperties.SetHeadingLevel(label, Microsoft.UI.Xaml.Automation.Peers.AutomationHeadingLevel.Level1);
        heading.Children.Add(label);
        heading.Children.Add(new TextBlock { Text = subtitle, FontSize = 14, Opacity = .72, TextWrapping = TextWrapping.Wrap, MaxWidth = 800, HorizontalAlignment = HorizontalAlignment.Left });
        header.Children.Add(heading);
        var close = IconButton(Symbol.Cancel, $"Close {title}");
        close.VerticalAlignment = VerticalAlignment.Top;
        close.Click += (_, _) => HidePage();
        Grid.SetColumn(close, 1); header.Children.Add(close);
        Grid.SetRow(header, 1); page.Children.Add(header);
        Grid.SetRow(body, 2); page.Children.Add(body);
        if (actions.Length > 0)
        {
            var footer = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, HorizontalAlignment = HorizontalAlignment.Right };
            foreach (var action in actions) { action.MinHeight = 38; footer.Children.Add(action); }
            var border = new Border { BorderThickness = new(0, 1, 0, 0), BorderBrush = ResourceBrush("CardStrokeColorDefaultBrush"), Padding = new(0, 14, 0, 0), Child = footer };
            Grid.SetRow(border, 3); page.Children.Add(border);
        }
        page.SizeChanged += (_, e) => page.Padding = e.NewSize.Width < 760 ? new(16, 16, 16, 12) : new(32, 24, 32, 20);
        return page;
    }

    private FrameworkElement BuildSettingsBrowser(StackPanel sections)
    {
        sections.MaxWidth = 850;
        sections.HorizontalAlignment = HorizontalAlignment.Stretch;
        var body = new Grid { RowSpacing = 16 };
        body.RowDefinitions.Add(new() { Height = GridLength.Auto });
        body.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star) });
        var search = new TextBox { PlaceholderText = "Find a setting…", MaxLength = 160, HorizontalAlignment = HorizontalAlignment.Stretch };
        AutomationProperties.SetName(search, "Search settings");
        var searchRow = new Grid { ColumnSpacing = 8 };
        searchRow.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) }); searchRow.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        searchRow.Children.Add(search);
        var clear = IconButton(Symbol.Cancel, "Clear settings search"); clear.Visibility = Visibility.Collapsed;
        clear.Click += (_, _) => { search.Text = string.Empty; search.Focus(FocusState.Keyboard); };
        Grid.SetColumn(clear, 1); searchRow.Children.Add(clear); body.Children.Add(searchRow);
        var layout = new Grid { ColumnSpacing = 20, RowSpacing = 12 };
        layout.ColumnDefinitions.Add(new() { Width = new(190) });
        layout.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        layout.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star) });
        layout.RowDefinitions.Add(new() { Height = new(0) });
        var categories = new ListView { SelectionMode = ListViewSelectionMode.Single, HorizontalContentAlignment = HorizontalAlignment.Stretch };
        AutomationProperties.SetName(categories, "Settings categories");
        categories.Items.Add("All settings");
        foreach (var section in sections.Children.OfType<Border>())
            if (section.Tag is SettingsSectionInfo info) categories.Items.Add(info.Title);
        categories.SelectedIndex = 0;
        var scroll = new ScrollViewer { Content = sections, Padding = new(0, 0, 12, 24), HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
        var results = new Grid();
        results.Children.Add(scroll);
        var empty = EmptyState(Symbol.Find, "No settings found. Try a shorter search or choose another category.");
        empty.Visibility = Visibility.Collapsed;
        results.Children.Add(empty);
        void Filter()
        {
            var query = search.Text.Trim();
            var count = 0;
            foreach (var section in sections.Children.OfType<Border>())
            {
                if (section.Tag is not SettingsSectionInfo info) continue;
                var categoryMatches = categories.SelectedIndex == 0 || Equals(categories.SelectedItem, info.Title);
                var headingMatches = info.Title.Contains(query, StringComparison.OrdinalIgnoreCase) || info.Description.Contains(query, StringComparison.OrdinalIgnoreCase);
                var matched = false;
                foreach (var control in info.Controls)
                {
                    // Search labels only. Never index API keys, endpoints, or other entered values.
                    var label = control switch
                    {
                        TextBox x => x.Header?.ToString(), ComboBox x => x.Header?.ToString(),
                        ToggleSwitch x => x.Header?.ToString(), NumberBox x => x.Header?.ToString(),
                        PasswordBox x => x.Header?.ToString(), _ => info.Title
                    };
                    var visible = headingMatches || (label?.Contains(query, StringComparison.OrdinalIgnoreCase) ?? false);
                    control.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
                    matched |= visible;
                }
                section.Visibility = categoryMatches && matched ? Visibility.Visible : Visibility.Collapsed;
                if (section.Visibility == Visibility.Visible) count++;
            }
            empty.Visibility = count == 0 ? Visibility.Visible : Visibility.Collapsed;
            scroll.ChangeView(null, 0, null, true);
        }
        search.TextChanged += (_, _) => { clear.Visibility = search.Text.Length == 0 ? Visibility.Collapsed : Visibility.Visible; if (search.Text.Length > 0) categories.SelectedIndex = 0; Filter(); };
        search.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Escape) { search.Text = string.Empty; e.Handled = true; } };
        categories.SelectionChanged += (_, _) => Filter();
        layout.Children.Add(categories); Grid.SetColumn(results, 1); layout.Children.Add(results);
        // A category selector replaces the rail in narrow windows and split panes.
        var compactCategories = new ComboBox { ItemsSource = categories.Items, SelectedIndex = 0, HorizontalAlignment = HorizontalAlignment.Stretch, Visibility = Visibility.Collapsed };
        AutomationProperties.SetName(compactCategories, "Settings category");
        compactCategories.SelectionChanged += (_, _) => categories.SelectedIndex = compactCategories.SelectedIndex;
        categories.SelectionChanged += (_, _) => compactCategories.SelectedIndex = categories.SelectedIndex;
        layout.Children.Add(compactCategories);
        body.SizeChanged += (_, e) =>
        {
            var narrow = e.NewSize.Width < 750;
            categories.Visibility = narrow ? Visibility.Collapsed : Visibility.Visible;
            compactCategories.Visibility = narrow ? Visibility.Visible : Visibility.Collapsed;
            layout.ColumnDefinitions[0].Width = narrow ? new(0) : new(190);
            layout.RowDefinitions[0].Height = narrow ? GridLength.Auto : new(1, GridUnitType.Star);
            layout.RowDefinitions[1].Height = narrow ? new(1, GridUnitType.Star) : new(0);
            Grid.SetColumn(compactCategories, 1); Grid.SetRow(results, narrow ? 1 : 0);
        };
        Grid.SetRow(layout, 1); body.Children.Add(layout);
        if (categories.Items.Count > 1) categories.SelectedIndex = 1;
        return body;
    }
}
