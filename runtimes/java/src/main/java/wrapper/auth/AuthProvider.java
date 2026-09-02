package wrapper.auth;

import java.util.Map;
import java.util.function.Supplier;

/**
 * T062 + T067: OAuth-authenticated dispatch wiring + api-key fallback for the Java runtime. Mirrors
 * runtimes/node/src/auth/auth-provider.ts. Produces the token supplier the server attaches to every
 * tool call.
 */
public final class AuthProvider {
  private AuthProvider() {}

  /** Build a token supplier from the package's OAuth config. Returns null token when unauthenticated. */
  public static Supplier<String> create(
      Map<String, Object> config, String mode, String session, String apiKey, TokenStore.Store store) {
    Object fallback = config.get("fallback");
    if (fallback instanceof Map<?, ?> fb && "api-key".equals(fb.get("mode")) && apiKey != null) {
      return () -> apiKey;
    }
    return () -> {
      try {
        OAuthLoopback.TokenSet existing = store.load(session);
        long now = System.currentTimeMillis();
        if (existing != null && existing.expiresAt > now + 30_000L) {
          return existing.accessToken;
        }
        if ("stdio".equals(mode)) {
          OAuthLoopback.TokenSet tokens =
              OAuthLoopback.runLoopbackFlow(
                  config, OAuthLoopback.httpExchanger(config, java.net.http.HttpClient.newHttpClient()));
          store.save(session, tokens);
          return tokens.accessToken;
        }
        return existing != null ? existing.accessToken : null;
      } catch (Exception e) {
        return null;
      }
    };
  }
}
