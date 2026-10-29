using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using Windows.System;

namespace Browser.App;

public sealed partial class MainWindow
{
    private TextBox? _findInput;
    private CoreWebView2Find? _pageFind;
    private Action? _detachPageFind;
    private int _findGeneration;
    private readonly SemaphoreSlim _findGate = new(1, 1);
    private string _lastFindQuery = "";

    private void CloseFindBar(bool restoreFocus = true)
    {
        _findGeneration++;
        _detachPageFind?.Invoke(); _detachPageFind = null;
        try { _pageFind?.Stop(); } catch { }
        _pageFind = null;
        _findInput = null;
        _findBar.Child = null;
        _findBar.Visibility = Visibility.Collapsed;
        if (restoreFocus) CurrentWebView()?.Focus(FocusState.Programmatic);
    }

    private void ShowFindBar()
    {
        if (_findInput is not null) { _findInput.Focus(FocusState.Keyboard); _findInput.SelectAll(); return; }
        var web = CurrentWebView();
        if (web?.CoreWebView2 is not { } core) { ShowStatus("Open a web page to search its text."); return; }
        try { _pageFind = core.Find; }
        catch { ShowStatus("Page search needs a newer WebView2 Runtime.", InfoBarSeverity.Warning); return; }
        var find = _pageFind;
        var input = new TextBox { PlaceholderText = "Find in page", MaxLength = 500, Width = Math.Max(140, Math.Min(260, _browserHost.ActualWidth - 220)), Text = _lastFindQuery };
        _findInput = input;
        AutomationProperties.SetName(input, "Find in page");
        var count = new TextBlock { Text = "Type to find", MinWidth = 88, VerticalAlignment = VerticalAlignment.Center, Opacity = .75 };
        AutomationProperties.SetLiveSetting(count, Microsoft.UI.Xaml.Automation.Peers.AutomationLiveSetting.Polite);
        var matchCase = new CheckBox { Content = "Match case" };
        var wholeWord = new CheckBox { Content = "Whole words" };
        void UpdateCount()
        {
            if (_pageFind != find || _findInput != input) return;
            try { count.Text = input.Text.Length == 0 ? "Type to find" : find.MatchCount == 0 ? "No matches" : $"{Math.Max(1, find.ActiveMatchIndex)} of {find.MatchCount}"; } catch { count.Text = "Unavailable"; }
        }
        Windows.Foundation.TypedEventHandler<CoreWebView2Find, object> changed = (_, _) => UpdateCount();
        find.MatchCountChanged += changed; find.ActiveMatchIndexChanged += changed;
        _detachPageFind = () => { try { find.MatchCountChanged -= changed; find.ActiveMatchIndexChanged -= changed; } catch { } };
        async Task Search()
        {
            var generation = ++_findGeneration;
            try
            {
                await Task.Delay(150, _windowLifetimeCts.Token);
                if (generation != _findGeneration || _pageFind != find) return;
                await _findGate.WaitAsync(_windowLifetimeCts.Token);
                try
                {
                    if (generation != _findGeneration || _pageFind != find) return;
                    _lastFindQuery = input.Text;
                    find.Stop();
                    if (input.Text.Length == 0) { UpdateCount(); return; }
                    var options = core.Environment.CreateFindOptions();
                    options.FindTerm = input.Text; options.IsCaseSensitive = matchCase.IsChecked == true;
                    options.ShouldMatchWord = wholeWord.IsChecked == true;
                    options.ShouldHighlightAllMatches = true; options.SuppressDefaultFindDialog = true;
                    await find.StartAsync(options);
                    if (_pageFind != find) { try { find.Stop(); } catch { } return; }
                    if (generation == _findGeneration) UpdateCount();
                }
                finally { _findGate.Release(); }
            }
            catch (OperationCanceledException) { }
            catch { if (_findInput == input) count.Text = "Unavailable"; }
        }
        void Step(bool previous) { try { if (previous) find.FindPrevious(); else find.FindNext(); UpdateCount(); } catch { } }
        input.TextChanged += async (_, _) => await Search();
        matchCase.Click += async (_, _) => await Search(); wholeWord.Click += async (_, _) => await Search();
        input.KeyDown += (_, e) =>
        {
            if (e.Key == VirtualKey.Enter) { Step(Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Shift).HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down)); e.Handled = true; }
            else if (e.Key == VirtualKey.Escape) { CloseFindBar(); e.Handled = true; }
        };
        var previous = IconButton(Symbol.Up, "Previous match (Shift+Enter)"); previous.Click += (_, _) => Step(true);
        var next = IconButton(Symbol.Forward, "Next match (Enter)"); next.Click += (_, _) => Step(false);
        var close = IconButton(Symbol.Cancel, "Close find bar (Escape)"); close.Click += (_, _) => CloseFindBar();
        var content = new StackPanel { Spacing = 6 };
        content.KeyDown += (_, e) => { if (e.Key == VirtualKey.Escape) { CloseFindBar(); e.Handled = true; } };
        content.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, Children = { input, count, close } });
        content.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Children = { matchCase, wholeWord, previous, next } });
        _findBar.Child = content; _findBar.Visibility = Visibility.Visible;
        input.Focus(FocusState.Keyboard); input.SelectAll();
        if (input.Text.Length > 0) ObserveUiCallback("Page search", Search);
    }
}
