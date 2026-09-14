namespace Browser.Core.Tabs;

/// <summary>
/// Tree tabs (#13). A tab may name one parent tab; roots have no parent.
/// Persisted data is untrusted, so every repair is deterministic and bounded:
/// missing parents are detached, self-parents are detached, cycles are broken
/// by detaching the latest tab in the cycle, and depth is capped.
/// </summary>
public static class TreeTabPolicy
{
    public const int MaximumDepth = 8;

    /// <summary>Repairs parent links. Input order is preserved; output is bounded to the input size.</summary>
    public static IReadOnlyList<BrowserTabSnapshot> NormalizeParents(IEnumerable<BrowserTabSnapshot>? tabs)
    {
        var list = (tabs ?? []).Where(x => x is not null && x.Id != Guid.Empty).ToList();
        if (list.Count == 0) return [];
        var byId = list.GroupBy(x => x.Id).ToDictionary(g => g.Key, g => g.First());
        // First pass: drop self-parents and missing parents.
        var repaired = list.Select(tab =>
            tab.ParentId is { } parent && parent != Guid.Empty && parent != tab.Id && byId.ContainsKey(parent)
                ? tab
                : tab with { ParentId = null }).ToList();
        byId = repaired.GroupBy(x => x.Id).ToDictionary(g => g.Key, g => g.First());
        // Second pass: break cycles deterministically by walking from each tab.
        var detached = new HashSet<Guid>();
        foreach (var tab in repaired)
        {
            var seen = new HashSet<Guid> { tab.Id };
            var current = tab.ParentId;
            while (current is { } parentId && byId.TryGetValue(parentId, out var parent))
            {
                if (!seen.Add(parentId))
                {
                    detached.Add(tab.Id);
                    break;
                }
                if (detached.Contains(parentId))
                {
                    detached.Add(tab.Id);
                    break;
                }
                current = parent.ParentId;
                if (seen.Count > repaired.Count + 2) { detached.Add(tab.Id); break; }
            }
        }
        // Third pass: enforce maximum depth by climbing from roots.
        var depth = new Dictionary<Guid, int>();
        int Depth(Guid id)
        {
            if (depth.TryGetValue(id, out var cached)) return cached;
            var chain = new List<Guid>();
            var current = id;
            while (true)
            {
                if (depth.TryGetValue(current, out var known))
                {
                    for (var i = chain.Count - 1; i >= 0; i--) depth[chain[i]] = ++known;
                    return depth[id];
                }
                if (!byId.TryGetValue(current, out var tab) || tab.ParentId is null || detached.Contains(current))
                {
                    var d = 0;
                    for (var i = chain.Count - 1; i >= 0; i--) depth[chain[i]] = ++d;
                    depth.TryAdd(current, 0);
                    return depth.GetValueOrDefault(id, 0);
                }
                if (chain.Contains(current))
                {
                    detached.Add(current);
                    for (var i = chain.Count - 1; i >= 0; i--) depth.TryAdd(chain[i], 0);
                    return 0;
                }
                chain.Add(current);
                current = tab.ParentId.Value;
                if (chain.Count > repaired.Count + 2) { detached.Add(id); return 0; }
            }
        }
        foreach (var tab in repaired) Depth(tab.Id);
        return repaired.Select(tab =>
        {
            if (detached.Contains(tab.Id)) return tab with { ParentId = null };
            if (depth.GetValueOrDefault(tab.Id, 0) >= MaximumDepth) return tab with { ParentId = null };
            return tab;
        }).ToList();
    }

    public static IReadOnlyList<BrowserTabSnapshot> Roots(IEnumerable<BrowserTabSnapshot> tabs)
    {
        var live = tabs.ToHashSet();
        return tabs.Where(x => x.ParentId is null || !live.Any(y => y.Id == x.ParentId)).ToList();
    }

    public static IReadOnlyList<BrowserTabSnapshot> Children(IEnumerable<BrowserTabSnapshot> tabs, Guid parentId) =>
        tabs.Where(x => x.ParentId == parentId).ToList();

    /// <summary>Depth of a tab: roots are 0. Returns 0 for unknown ids. Bounded and cycle-safe.</summary>
    public static int GetDepth(IEnumerable<BrowserTabSnapshot> tabs, Guid id)
    {
        var byId = tabs.Where(x => x is not null).GroupBy(x => x.Id).ToDictionary(g => g.Key, g => g.First());
        var depth = 0;
        var seen = new HashSet<Guid>();
        var current = id;
        while (byId.TryGetValue(current, out var tab) && tab.ParentId is { } parent && seen.Add(current) && depth <= MaximumDepth + 1)
        {
            depth++;
            current = parent;
        }
        return Math.Min(depth, MaximumDepth + 1);
    }

    /// <summary>True when the tab is hidden because an ancestor is collapsed.</summary>
    public static bool IsHiddenByCollapse(IEnumerable<BrowserTabSnapshot> tabs, Guid id)
    {
        var byId = tabs.Where(x => x is not null).GroupBy(x => x.Id).ToDictionary(g => g.Key, g => g.First());
        var seen = new HashSet<Guid>();
        var current = id;
        while (byId.TryGetValue(current, out var tab) && seen.Add(current))
        {
            if (tab.ParentId is not { } parent) return false;
            if (byId.TryGetValue(parent, out var parentTab) && parentTab.IsTreeCollapsed) return true;
            current = parent;
        }
        return false;
    }

    /// <summary>All descendant ids of a parent, bounded and cycle-safe. Used to keep tree moves together.</summary>
    public static IReadOnlySet<Guid> Descendants(IEnumerable<BrowserTabSnapshot> tabs, Guid parentId)
    {
        var byParent = tabs.Where(x => x?.ParentId is not null).GroupBy(x => x.ParentId!.Value)
            .ToDictionary(g => g.Key, g => g.Select(x => x.Id).ToList());
        var result = new HashSet<Guid>();
        var stack = new Stack<Guid>();
        stack.Push(parentId);
        while (stack.Count > 0 && result.Count < 1000)
        {
            var current = stack.Pop();
            if (!byParent.TryGetValue(current, out var children)) continue;
            foreach (var child in children)
            {
                if (child == parentId || !result.Add(child)) continue;
                stack.Push(child);
            }
        }
        result.Remove(parentId);
        return result;
    }
}
