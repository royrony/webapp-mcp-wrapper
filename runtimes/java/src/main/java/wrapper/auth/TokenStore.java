package wrapper.auth;

import com.google.gson.Gson;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.security.spec.KeySpec;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * T061: RuntimeAuthSession token store for the Java runtime (FR-014; research.md #4). Uses a JCEKS
 * {@link KeyStore} for local secure storage (the JVM's idiomatic OS-keychain equivalent) and an
 * AES-GCM encrypted file for hosted mode. Tokens never touch logs/reports (Principle V).
 */
public final class TokenStore {
  private static final Gson GSON = new Gson();
  private static final SecureRandom RNG = new SecureRandom();

  public interface Store {
    void save(String session, OAuthLoopback.TokenSet tokens) throws Exception;

    OAuthLoopback.TokenSet load(String session) throws Exception;

    void clear(String session) throws Exception;

    String backend();
  }

  private TokenStore() {}

  /** JCEKS KeyStore-backed store for local/stdio mode. */
  public static final class KeyStoreTokenStore implements Store {
    private final Path path;
    private final char[] password;

    public KeyStoreTokenStore(Path path, char[] password) {
      this.path = path;
      this.password = password;
    }

    private KeyStore loadKs() throws Exception {
      KeyStore ks = KeyStore.getInstance("JCEKS");
      if (Files.exists(path)) {
        try (var in = Files.newInputStream(path)) {
          ks.load(in, password);
        }
      } else {
        ks.load(null, password);
      }
      return ks;
    }

    @Override
    public void save(String session, OAuthLoopback.TokenSet tokens) throws Exception {
      KeyStore ks = loadKs();
      byte[] json = GSON.toJson(tokens).getBytes(StandardCharsets.UTF_8);
      SecretKeySpec entry = new SecretKeySpec(Base64.getEncoder().encode(json), "RAW");
      ks.setKeyEntry(session, entry, password, null);
      try (var out = Files.newOutputStream(path)) {
        ks.store(out, password);
      }
    }

    @Override
    public OAuthLoopback.TokenSet load(String session) throws Exception {
      KeyStore ks = loadKs();
      if (!ks.containsAlias(session)) {
        return null;
      }
      var key = ks.getKey(session, password);
      byte[] json = Base64.getDecoder().decode(key.getEncoded());
      return GSON.fromJson(new String(json, StandardCharsets.UTF_8), OAuthLoopback.TokenSet.class);
    }

    @Override
    public void clear(String session) throws Exception {
      KeyStore ks = loadKs();
      if (ks.containsAlias(session)) {
        ks.deleteEntry(session);
        try (var out = Files.newOutputStream(path)) {
          ks.store(out, password);
        }
      }
    }

    @Override
    public String backend() {
      return "os-keychain";
    }
  }

  /** AES-256-GCM encrypted-file store for hosted mode. */
  public static final class EncryptedFileTokenStore implements Store {
    private final Path path;
    private final byte[] key;

    public EncryptedFileTokenStore(Path path, String secret) throws Exception {
      if (secret == null || secret.isEmpty()) {
        throw new IllegalArgumentException("EncryptedFileTokenStore requires a non-empty secret");
      }
      this.path = path;
      SecretKeyFactory f = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
      KeySpec spec =
          new PBEKeySpec(secret.toCharArray(), "webapp-mcp-wrapper-salt".getBytes(StandardCharsets.UTF_8), 65536, 256);
      this.key = f.generateSecret(spec).getEncoded();
    }

    private java.util.Map<String, String> readAll() {
      try {
        return GSON.fromJson(Files.readString(path), java.util.Map.class);
      } catch (IOException | RuntimeException e) {
        return new java.util.HashMap<>();
      }
    }

    @Override
    public void save(String session, OAuthLoopback.TokenSet tokens) throws Exception {
      byte[] iv = new byte[12];
      RNG.nextBytes(iv);
      Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
      c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
      byte[] ct = c.doFinal(GSON.toJson(tokens).getBytes(StandardCharsets.UTF_8));
      String blob = Base64.getEncoder().encodeToString(iv) + "." + Base64.getEncoder().encodeToString(ct);
      var all = readAll();
      all.put(session, blob);
      Files.writeString(path, GSON.toJson(all));
    }

    @Override
    public OAuthLoopback.TokenSet load(String session) throws Exception {
      String blob = readAll().get(session);
      if (blob == null) {
        return null;
      }
      String[] parts = blob.split("\\.");
      byte[] iv = Base64.getDecoder().decode(parts[0]);
      byte[] ct = Base64.getDecoder().decode(parts[1]);
      Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
      c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
      byte[] pt = c.doFinal(ct);
      return GSON.fromJson(new String(pt, StandardCharsets.UTF_8), OAuthLoopback.TokenSet.class);
    }

    @Override
    public void clear(String session) throws Exception {
      var all = readAll();
      all.remove(session);
      Files.writeString(path, GSON.toJson(all));
    }

    @Override
    public String backend() {
      return "encrypted-file";
    }
  }
}
