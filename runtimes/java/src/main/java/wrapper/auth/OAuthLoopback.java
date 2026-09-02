package wrapper.auth;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * T055: OAuth 2.1 + PKCE loopback flow for the Java runtime (FR-014, FR-016). Mirrors the
 * Node/Python loopback flow. Built on Nimbus oauth2-oidc-sdk in production; the PKCE/URL
 * machinery here is JDK-only so it is testable without a live IdP.
 */
public final class OAuthLoopback {
  private static final SecureRandom RNG = new SecureRandom();

  private OAuthLoopback() {}

  public static final class TokenSet {
    public final String accessToken;
    public final String refreshToken;
    public final long expiresAt;

    public TokenSet(String accessToken, String refreshToken, long expiresAt) {
      this.accessToken = accessToken;
      this.refreshToken = refreshToken;
      this.expiresAt = expiresAt;
    }
  }

  public static String[] generatePkce() throws Exception {
    byte[] v = new byte[32];
    RNG.nextBytes(v);
    String verifier = Base64.getUrlEncoder().withoutPadding().encodeToString(v);
    byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.UTF_8));
    String challenge = Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
    return new String[] {verifier, challenge};
  }

  public static String buildAuthorizationUrl(
      Map<String, Object> config, String redirectUri, String challenge, String state) {
    StringBuilder sb = new StringBuilder(String.valueOf(config.get("authorizationEndpoint")));
    sb.append("?response_type=code");
    sb.append("&client_id=").append(enc(String.valueOf(config.get("clientId"))));
    sb.append("&redirect_uri=").append(enc(redirectUri));
    sb.append("&code_challenge=").append(enc(challenge));
    sb.append("&code_challenge_method=S256");
    sb.append("&state=").append(enc(state));
    return sb.toString();
  }

  private static String enc(String s) {
    return URLEncoder.encode(s, StandardCharsets.UTF_8);
  }

  /** Run the loopback flow. tokenExchanger allows injecting a fake exchange in tests. */
  public static TokenSet runLoopbackFlow(Map<String, Object> config, TokenExchanger exchanger)
      throws Exception {
    String[] pkce = generatePkce();
    String verifier = pkce[0];
    String challenge = pkce[1];
    String state = Long.toHexString(RNG.nextLong());

    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    int port = server.getAddress().getPort();
    String redirectUri = "http://127.0.0.1:" + port + "/callback";
    CompletableFuture<TokenSet> future = new CompletableFuture<>();

    server.createContext(
        "/callback",
        exchange -> {
          Map<String, String> params = queryParams(exchange.getRequestURI());
          String code = params.get("code");
          String returnedState = params.get("state");
          byte[] resp = "<h1>Authorized. You may close this window.</h1>".getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(code != null && state.equals(returnedState) ? 200 : 400, resp.length);
          exchange.getResponseBody().write(resp);
          exchange.close();
          if (code != null && state.equals(returnedState)) {
            try {
              future.complete(exchanger.exchange(code, verifier, redirectUri));
            } catch (Exception e) {
              future.completeExceptionally(e);
            }
          }
        });
    server.start();

    String authUrl = buildAuthorizationUrl(config, redirectUri, challenge, state);
    System.err.println("Open this URL to authorize:\n" + authUrl);

    try {
      return future.get();
    } finally {
      server.stop(0);
    }
  }

  private static Map<String, String> queryParams(URI uri) {
    Map<String, String> out = new java.util.HashMap<>();
    String q = uri.getQuery();
    if (q != null) {
      for (String pair : q.split("&")) {
        String[] kv = pair.split("=", 2);
        out.put(kv[0], kv.length > 1 ? java.net.URLDecoder.decode(kv[1], StandardCharsets.UTF_8) : "");
      }
    }
    return out;
  }

  /** Default token exchange over HTTP (production path). */
  public static TokenExchanger httpExchanger(Map<String, Object> config, HttpClient client) {
    return (code, verifier, redirectUri) -> {
      String body =
          "grant_type=authorization_code&code=" + enc(code) + "&redirect_uri=" + enc(redirectUri)
              + "&client_id=" + enc(String.valueOf(config.get("clientId"))) + "&code_verifier=" + enc(verifier);
      HttpRequest req =
          HttpRequest.newBuilder()
              .uri(URI.create(String.valueOf(config.get("tokenEndpoint"))))
              .header("content-type", "application/x-www-form-urlencoded")
              .POST(HttpRequest.BodyPublishers.ofString(body))
              .build();
      HttpResponse<String> resp = client.send(req, HttpResponse.BodyHandlers.ofString());
      com.google.gson.JsonObject j =
          new com.google.gson.Gson().fromJson(resp.body(), com.google.gson.JsonObject.class);
      long expiresIn = j.has("expires_in") ? j.get("expires_in").getAsLong() : 3600L;
      return new TokenSet(
          j.get("access_token").getAsString(),
          j.has("refresh_token") ? j.get("refresh_token").getAsString() : null,
          System.currentTimeMillis() + expiresIn * 1000L);
    };
  }

  public interface TokenExchanger {
    TokenSet exchange(String code, String verifier, String redirectUri) throws Exception;
  }
}
