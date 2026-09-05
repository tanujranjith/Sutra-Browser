using Browser.AI.Automation;
using Browser.AI.Providers;
using Browser.AI.Safety;
using Browser.AI.Tools;
using Xunit;

namespace Browser.AI.Tests;

public sealed class ParsingAndSafetyTests
{
    [Fact] public void ParsesValidAction(){Assert.True(BrowserActionParser.TryParse("{\"type\":\"navigate\",\"url\":\"https://example.com\"}",out var a,out _));Assert.Equal(BrowserActionType.Navigate,a!.Type);}
    [Fact] public void RejectsMalformedAndIncompleteActions(){Assert.False(BrowserActionParser.TryParse("not json",out _,out _));Assert.False(BrowserActionParser.TryParse("{\"type\":\"click\"}",out _,out _));}
    [Theory]
    [InlineData("{\"type\":\"navigate\",\"url\":\"file:///private\"}")]
    [InlineData("{\"type\":\"navigate\",\"url\":\"https://user:password@example.com\"}")]
    [InlineData("{\"type\":\"wait\",\"milliseconds\":50}")]
    [InlineData("{\"type\":\"select\",\"elementId\":\"e1\"}")]
    public void RejectsUnsafeOrIncompleteActionInputs(string json) => Assert.False(BrowserActionParser.TryParse(json, out _, out _));
    [Fact] public void CredentialAndSubmissionRequireConfirmation(){Assert.True(ActionSafety.Classify(new(BrowserActionType.RequestCredentialAutofill)).RequiresConfirmation);Assert.True(ActionSafety.Classify(new(BrowserActionType.Click,SubmitsData:true)).RequiresConfirmation);Assert.False(ActionSafety.Classify(new(BrowserActionType.Scroll)).RequiresConfirmation);}
    [Fact] public void SecretsAreDenied(){Assert.Equal(ActionRisk.Forbidden,ActionSafety.Classify(new(BrowserActionType.Type,Text:"password=secret",ElementId:"e1")).Risk);}
}

public sealed class AgentLoopTests
{
    [Fact]
    public async Task StopsAtActionLimit()
    {
        var loop=new AgentLoop(new ConstantProvider("{\"type\":\"scroll\"}"),new Executor(),new Approval(true),new Audit());
        var result=await loop.RunAsync("scroll forever",new(3,TimeSpan.FromSeconds(1),TimeSpan.FromSeconds(1)));
        Assert.False(result.Success);Assert.Equal(3,result.ActionsExecuted);Assert.Contains("limit",result.Message);
    }

    [Fact]
    public async Task EnforcesActionTimeout()
    {
        var loop=new AgentLoop(new ConstantProvider("{\"type\":\"scroll\"}"),new SlowExecutor(),new Approval(true),new Audit());
        var result=await loop.RunAsync("test",new(1,TimeSpan.FromMilliseconds(10),TimeSpan.FromSeconds(1)));
        Assert.False(result.Success);Assert.Equal(1,result.ActionsExecuted);
    }

    [Fact]
    public async Task DeclinedConfirmationStopsBeforeExecution()
    {
        var executor=new Executor();var loop=new AgentLoop(new ConstantProvider("{\"type\":\"requestCredentialAutofill\"}"),executor,new Approval(false),new Audit());
        var result=await loop.RunAsync("login",new(3));Assert.False(result.Success);Assert.Equal(0,executor.Count);
    }

    private sealed class ConstantProvider(string response):IAiProvider{public string Name=>"test";public bool IsRemote=>false;public Task<string> CompleteAsync(AiRequest r,CancellationToken c)=>Task.FromResult(response);}
    private class Executor:IBrowserActionExecutor{public int Count;public string CurrentOrigin=>"https://example.com";public virtual Task<ActionResult> ExecuteAsync(BrowserAction a,CancellationToken c){Count++;return Task.FromResult(new ActionResult(true,"ok"));}}
    private sealed class SlowExecutor:Executor{public override async Task<ActionResult> ExecuteAsync(BrowserAction a,CancellationToken c){await Task.Delay(1000,c);return new(true,"late");}}
    private sealed class Approval(bool allow):IActionApproval{public Task<bool> ConfirmAsync(BrowserAction a,string o,ActionAssessment s,CancellationToken c)=>Task.FromResult(allow);}
    private sealed class Audit:IActionAuditSink{public Task RecordAsync(BrowserAction a,string o,ActionResult r,bool c,CancellationToken ct)=>Task.CompletedTask;}
}
