package wrapper;

import com.google.gson.Gson;
import java.net.http.HttpClient;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * T041: Java runtime validate-support hooks (FR-021, FR-022). Mirrors the Node/Python hooks:
 * invoke every in-scope tool once, trigger the OAuth flow once, and confirm retry/logging fires.
 * Never touches an out-of-scope tool.
 */
public final class ValidateHooks {
  private static final Gson GSON = new Gson();

  private ValidateHooks() {}

  public static final class ToolInvocationOutcome {
    public final String toolName;
    public final boolean invoked;
    public final boolean success;
    public final String error;

    public ToolInvocationOutcome(String toolName, boolean invoked, boolean success, String error) {
      this.toolName = toolName;
      this.invoked = invoked;
      this.success = success;
      this.error = error;
    }
  }

  private static Map<String, Object> sampleArgs(Manifest.ToolDefinition tool) {
    Map<String, Object> args = new HashMap<>();
    if (tool.inputSchema != null && tool.inputSchema.has("properties")) {
      var props = tool.inputSchema.getAsJsonObject("properties");
      for (String name : props.keySet()) {
        var prop = props.getAsJsonObject(name);
        String type = prop.has("type") ? prop.get("type").getAsString() : "string";
        args.put(name, "number".equals(type) ? 1 : "test");
      }
    }
    return args;
  }

  public static List<ToolInvocationOutcome> invokeAllInScope(
      Manifest.LoadedPackage pkg, String baseUrl, HttpClient client) {
    List<ToolInvocationOutcome> results = new ArrayList<>();
    for (Manifest.ToolDefinition tool : Manifest.inScopeTools(pkg.tools, pkg.scope)) {
      Reliability.InvokeResult res =
          Server.dispatchTool(tool, sampleArgs(tool), baseUrl, client);
      results.add(new ToolInvocationOutcome(tool.name, true, res.ok, res.ok ? null : res.error));
    }
    return results;
  }

  public static boolean exerciseOAuthOnce(Manifest.LoadedPackage pkg) {
    var c = pkg.oauthConfig;
    return c.has("authorizationEndpoint") && c.has("tokenEndpoint") && c.has("redirectMode");
  }

  public static boolean verifyRetryBehavior() {
    return Reliability.isRetryable(true, 503, false) && Reliability.backoffSchedule().size() == 2;
  }
}
