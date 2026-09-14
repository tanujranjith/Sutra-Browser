using Microsoft.UI.Xaml.Controls;
using Windows.ApplicationModel.DataTransfer;

namespace Browser.App;

public sealed partial class MainWindow
{
    private void EnableBookmarkReordering(Button button, long id, bool folder)
    {
        const string itemKey = "SutraBookmarkOrderId";
        const string kindKey = "SutraBookmarkOrderKind";
        const string profileKey = "SutraBookmarkOrderProfile";
        var kind = folder ? "folder" : "bookmark";
        button.CanDrag = true; button.AllowDrop = true;
        button.DragStarting += (_, e) =>
        {
            e.Data.Properties[itemKey] = id.ToString(System.Globalization.CultureInfo.InvariantCulture);
            e.Data.Properties[kindKey] = kind; e.Data.Properties[profileKey] = _profileName;
            e.Data.RequestedOperation = DataPackageOperation.Move;
        };
        bool SameLibrary(DataPackageView data) =>
            data.Properties.TryGetValue(kindKey, out var value) && Equals(value, kind) &&
            data.Properties.TryGetValue(profileKey, out var profile) && profile is string name && name.Equals(_profileName, StringComparison.OrdinalIgnoreCase);
        button.DragOver += (_, e) =>
        {
            e.AcceptedOperation = SameLibrary(e.DataView) ? DataPackageOperation.Move : DataPackageOperation.None;
            e.DragUIOverride.Caption = "Move before this item";
            e.Handled = true;
        };
        button.Drop += async (_, e) =>
        {
            e.Handled = true;
            if (!SameLibrary(e.DataView) || !e.DataView.Properties.TryGetValue(itemKey, out var value) || value is not string text || !long.TryParse(text, out var moving)) return;
            try { await _bookmarks.MoveBeforeAsync(moving, id, folder, _windowLifetimeCts.Token); await RefreshBookmarkBarAsync(); }
            catch (OperationCanceledException) { }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Bookmark ordering: {ex.GetType().Name}"); ShowStatus("The bookmark order could not be saved.", InfoBarSeverity.Warning); }
        };
    }
}
