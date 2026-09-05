using System.Collections.ObjectModel;
using Browser.Core.Settings;
using Browser.Core.Tabs;
using CommunityToolkit.Mvvm.ComponentModel;

namespace Browser.App.ViewModels;

public sealed partial class MainWindowViewModel : ObservableObject
{
    public ObservableCollection<BrowserTab> Tabs { get; } = [];
    public Stack<BrowserTabSnapshot> RecentlyClosed { get; } = [];
    [ObservableProperty] private BrowserTab? selectedTab;
    [ObservableProperty] private BrowserSettings settings = new();
    [ObservableProperty] private string statusText = "Ready";
    [ObservableProperty] private bool isCopilotOpen;

    public void Add(BrowserTab tab, bool activate = true)
    {
        var index = tab.IsPinned ? Tabs.TakeWhile(x => x.IsPinned).Count() : Tabs.Count;
        Tabs.Insert(index, tab); if (activate) SelectedTab = tab;
    }

    public BrowserTab? Close(BrowserTab tab)
    {
        var index=Tabs.IndexOf(tab); if(index<0)return SelectedTab;
        RecentlyClosed.Push(tab.ToSnapshot()); Tabs.RemoveAt(index);
        if (ReferenceEquals(SelectedTab,tab)) SelectedTab=Tabs.Count==0?null:Tabs[Math.Min(index,Tabs.Count-1)];
        return SelectedTab;
    }

    /// <summary>Removes a tab without placing it in Recently Closed.</summary>
    public BrowserTab? RemoveWithoutHistory(BrowserTab tab)
    {
        var index = Tabs.IndexOf(tab);
        if (index < 0) return SelectedTab;
        Tabs.RemoveAt(index);
        if (ReferenceEquals(SelectedTab, tab)) SelectedTab = Tabs.Count == 0 ? null : Tabs[Math.Min(index, Tabs.Count - 1)];
        return SelectedTab;
    }

    /// <summary>Removes a transient browser-owned UI tab without placing it in Recently Closed.</summary>
    public BrowserTab? RemoveTransient(BrowserTab tab) => RemoveWithoutHistory(tab);

    public BrowserTab? Reopen()
    {
        if(!RecentlyClosed.TryPop(out var snapshot))return null;var tab=BrowserTab.FromSnapshot(snapshot);tab.IsHibernated=false;Add(tab);return tab;
    }
}
