using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Browser.Core.Passwords;

namespace Browser.Platform.Windows.Security;

public sealed class DpapiCredentialStore : ISecureCredentialStore
{
    private readonly string _directory;
    private readonly string _keyPath;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public DpapiCredentialStore(string directory)
    {
        _directory = directory;
        _keyPath = Path.Combine(directory, "master.key");
        Directory.CreateDirectory(directory);
    }

    public async Task SaveAsync(Guid id, CredentialSecret secret, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(secret.Username); ArgumentNullException.ThrowIfNull(secret.Password);
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var key = GetOrCreateKey();
            try
            {
                var plaintext = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(secret));
                try
                {
                    var nonce = RandomNumberGenerator.GetBytes(12); var tag = new byte[16]; var cipher = new byte[plaintext.Length];
                    using (var aes = new AesGcm(key, tag.Length)) aes.Encrypt(nonce, plaintext, cipher, tag, id.ToByteArray());
                    var record = new byte[1 + nonce.Length + tag.Length + cipher.Length]; record[0] = 1;
                    Buffer.BlockCopy(nonce, 0, record, 1, nonce.Length); Buffer.BlockCopy(tag, 0, record, 13, tag.Length); Buffer.BlockCopy(cipher, 0, record, 29, cipher.Length);
                    await File.WriteAllBytesAsync(PathFor(id), record, cancellationToken);
                    CryptographicOperations.ZeroMemory(cipher);
                }
                finally { CryptographicOperations.ZeroMemory(plaintext); }
            }
            finally { CryptographicOperations.ZeroMemory(key); }
        }
        finally { _gate.Release(); }
    }

    public async Task<CredentialSecret?> GetAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var path = PathFor(id); if (!File.Exists(path)) return null;
            var record = await File.ReadAllBytesAsync(path, cancellationToken);
            if (record.Length < 30 || record[0] != 1) throw new CryptographicException("The secure credential record is invalid.");
            var key = GetOrCreateKey(); var plain = new byte[record.Length - 29];
            try
            {
                using (var aes = new AesGcm(key, 16)) aes.Decrypt(record.AsSpan(1,12), record.AsSpan(29), record.AsSpan(13,16), plain, id.ToByteArray());
                return JsonSerializer.Deserialize<CredentialSecret>(plain);
            }
            finally { CryptographicOperations.ZeroMemory(key); CryptographicOperations.ZeroMemory(plain); CryptographicOperations.ZeroMemory(record); }
        }
        finally { _gate.Release(); }
    }

    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try { var path = PathFor(id); if (File.Exists(path)) File.Delete(path); }
        finally { _gate.Release(); }
    }

    private byte[] GetOrCreateKey()
    {
        if (File.Exists(_keyPath)) return ProtectedData.Unprotect(File.ReadAllBytes(_keyPath), null, DataProtectionScope.CurrentUser);
        var key = RandomNumberGenerator.GetBytes(32);
        try { File.WriteAllBytes(_keyPath, ProtectedData.Protect(key, null, DataProtectionScope.CurrentUser)); return key.ToArray(); }
        finally { CryptographicOperations.ZeroMemory(key); }
    }
    private string PathFor(Guid id) => Path.Combine(_directory, id.ToString("N") + ".vault");
}

