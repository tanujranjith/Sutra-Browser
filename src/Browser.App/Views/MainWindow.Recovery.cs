using Browser.Core.Sessions;
using Browser.Core.Tabs;
using Browser.Data.Repositories;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Browser.App;

public sealed partial class MainWindow
{
    private async Task ShowSessionRecoveryAsync()
    {
        if (_isPrivate) { ShowStatus("Session recovery is unavailable in private windows."); return; }
        var snapshots = await _sessionSnapshots.ListAsync(_windowLifetimeCts.Token);
        var list = new ListView { SelectionMode = ListViewSelectionMode.Single, MaxHeight = 240 };
        var tabs = new ListView { SelectionMode = ListViewSelectionMode.Multiple, MaxHeight = 320 };
        BrowserSession? selectedSession = null;
        foreach (var snapshot in snapshots)
        {
            var session = SessionSerializer.Deserialize(snapshot.SessionJson);
            if (session.Tabs.Count == 0) continue;
            list.Items.Add(new ListViewItem { Tag = snapshot, Content = ManagerRow($"{snapshot.SavedAt.LocalDateTime:f} · {snapshot.ProfileName}", $"{session.Tabs.Count} tabs · {snapshot.Reason} · {string.Join(", ", session.Tabs.Take(3).Select(x => x.Title))}") });
        }
        var restore = ActionButton("Open selected tabs", Symbol.OpenFile, () =>
        {
            if (selectedSession is null) return;
            var selected = StartupRecoveryPolicy.SelectTabs(selectedSession, tabs.SelectedItems.Cast<ListViewItem>().Select(item => ((BrowserTabSnapshot)item.Tag).Id));
            if (selected.Tabs.Count > 0) ((App)Application.Current).OpenSessionWindow(selected, _profileName);
        });
        restore.IsEnabled = false;
        tabs.SelectionChanged += (_, _) => restore.IsEnabled = tabs.SelectedItems.Count > 0;
        void Preview(BrowserSession session)
        {
            selectedSession = session; tabs.Items.Clear();
            foreach (var tab in session.Tabs)
                tabs.Items.Add(new ListViewItem { Tag = tab, Content = ManagerRow(tab.Title, tab.Url) });
            restore.IsEnabled = false;
        }
        list.SelectionChanged += (_, _) =>
        {
            if (list.SelectedItem is ListViewItem { Tag: SessionSnapshotRecord snapshot }) Preview(SessionSerializer.Deserialize(snapshot.SessionJson));
        };
        var selectAll = ActionButton("Select all tabs", Symbol.SelectAll, () => tabs.SelectAll());
        var previous = ActionButton("Preview last session", Symbol.Undo, () =>
        {
            list.SelectedItem = null;
            if (_previousSession is not null) Preview(_previousSession);
        });
        previous.IsEnabled = _previousSession?.Tabs.Count > 0;
        var controls = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { previous, selectAll, restore } };
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(list.Items.Count == 0 ? EmptyState(Symbol.Undo, "No automatic snapshots yet. The last session may still be available above.") : list);
        content.Children.Add(new TextBlock { Text = "Tabs in the selected snapshot", FontSize = 18 });
        content.Children.Add(tabs);
        ShowPage("Session recovery", "Choose a snapshot, then select the tabs to reopen in a new window. Pages stay closed until you choose them. Private windows never create snapshots.",
            PageBody(controls, content));
        if (_startupNeedsReview && _previousSession is not null) Preview(_previousSession);
    }
}
