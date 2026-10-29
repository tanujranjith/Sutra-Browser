using Xunit;

// These fixtures clear SQLite's process-wide connection pools during cleanup.
// Run them serially so cleanup cannot dispose another fixture's active handle.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
