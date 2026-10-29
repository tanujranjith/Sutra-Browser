using Browser.Core.Privacy;
using Xunit;

namespace Browser.Core.Tests;

public sealed class YouTubePlaybackFilterTests
{
    [Fact]
    public void OldCachedRulesCannotHidePlayerOrBlockPlaybackMetadata()
    {
        var rules = ContentBlockRuleSet.Parse(BuiltInContentFilters.Rules.Concat(new[]
        {
            "youtube.com##.ad-showing", "youtube.com##.ytp-ad-skip-button", "youtube.com##.ytp-ad-module", "youtube.com##.video-ads",
            "||youtube.com/get_video_info", "||youtubei.googleapis.com/youtubei/v1/next?$xmlhttprequest"
        }));
        Assert.DoesNotContain(".ad-showing", rules.CosmeticSelectorsFor("www.youtube.com"));
        Assert.DoesNotContain(".ytp-ad-skip-button", rules.CosmeticSelectorsFor("www.youtube.com"));
        Assert.DoesNotContain(".ytp-ad-module", rules.CosmeticSelectorsFor("www.youtube.com"));
        Assert.DoesNotContain(".video-ads", rules.CosmeticSelectorsFor("www.youtube.com"));
        Assert.False(rules.ShouldBlock(new Uri("https://youtubei.googleapis.com/youtubei/v1/next?key=test"), "www.youtube.com", "xmlhttprequest"));
        Assert.False(rules.ShouldBlock(new Uri("https://www.youtube.com/get_video_info?video_id=test"), "www.youtube.com", "xmlhttprequest"));
        Assert.Contains("ytd-promoted-video-renderer", rules.CosmeticSelectorsFor("www.youtube.com"));
        Assert.True(rules.ShouldBlock(new Uri("https://www.youtube.com/api/stats/ads?test")));
    }
}
