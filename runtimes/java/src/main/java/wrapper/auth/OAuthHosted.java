package wrapper.auth;

import java.util.Map;

/**
 * T058: OAuth 2.1 + PKCE hosted-redirect flow for the Java runtime (FR-014, FR-016). Mirrors the
 * Node/Python hosted flow: authorization uses a configured public redirect URI.
 */
public final class OAuthHosted {
  private OAuthHosted() {}

  public static final class HostedFlowState {
    public final String authorizationUrl;
    public final String verifier;
    public final String state;
    public final String redirectUri;

    public HostedFlowState(String authorizationUrl, String verifier, String state, String redirectUri) {
      this.authorizationUrl = authorizationUrl;
      this.verifier = verifier;
      this.state = state;
      this.redirectUri = redirectUri;
    }
  }

  public static HostedFlowState beginHostedFlow(Map<String, Object> config) throws Exception {
    if (!"hosted".equals(config.get("redirectMode")) || config.get("hostedRedirectUri") == null) {
      throw new IllegalArgumentException(
          "hosted flow requires redirectMode 'hosted' and a hostedRedirectUri");
    }
    String[] pkce = OAuthLoopback.generatePkce();
    String state = Long.toHexString(new java.security.SecureRandom().nextLong());
    String redirectUri = String.valueOf(config.get("hostedRedirectUri"));
    String url = OAuthLoopback.buildAuthorizationUrl(config, redirectUri, pkce[1], state);
    return new HostedFlowState(url, pkce[0], state, redirectUri);
  }

  public static OAuthLoopback.TokenSet completeHostedFlow(
      Map<String, Object> config,
      HostedFlowState flow,
      String code,
      String returnedState,
      OAuthLoopback.TokenExchanger exchanger)
      throws Exception {
    if (!flow.state.equals(returnedState)) {
      throw new IllegalStateException("state mismatch");
    }
    return exchanger.exchange(code, flow.verifier, flow.redirectUri);
  }
}
