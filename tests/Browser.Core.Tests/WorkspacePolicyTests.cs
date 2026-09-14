using Browser.Core.Sessions;
using Browser.Core.Tabs;
using Browser.Core.Workspaces;
using Xunit;

namespace Browser.Core.Tests;

public sealed class WorkspacePolicyTests
{
    [Fact]
    public void TemplateInstancesHaveIndependentIdentitiesAndPreserveRelationships()
    {
        var group = new TabGroup { Name = "Research" };
        var one = new BrowserTab { Url = "https://example.com", GroupId = group.Id };
        var two = new BrowserTab { Url = "https://example.org", GroupId = group.Id };
        var template = new BrowserSession([one.ToSnapshot(), two.ToSnapshot()], two.Id, DateTimeOffset.UtcNow, [one.Id, two.Id], [group.ToSnapshot()]);
        var first = WorkspacePolicy.Instantiate(template, "Study"); var second = WorkspacePolicy.Instantiate(template, "Study");
        Assert.Empty(first.Tabs.Select(x => x.Id).Intersect(second.Tabs.Select(x => x.Id)));
        Assert.Equal(first.Tabs[1].Id, first.ActiveTabId); Assert.Equal(first.Tabs.Select(x => x.Id), first.SplitTabIds);
        Assert.All(first.Tabs, x => { Assert.Equal(first.Groups![0].Id, x.GroupId); Assert.Equal("Study", x.WorkspaceName); });
        Assert.NotEqual(group.Id, first.Groups![0].Id); Assert.Equal(two.Id, template.ActiveTabId);
    }
}
