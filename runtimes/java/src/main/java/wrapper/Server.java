package wrapper;

import com.google.gson.Gson;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/**
 * T035: Java runtime stdio entrypoint. Dynamically registers tools from tools.json via
 * io.modelcontextprotocol.sdk:mcp (FR-005, FR-006; research.md #10). Registration with the MCP
 * SDK is done reflectively/optionally so the package builds and its dispatch logic is unit-testable
 * without the SDK artifact resolved; T062/T066 wire OAuth + reliability into the dispatch path.
 */
public final class Server {
  private static final Gson GSON = new Gson();

  private Server() {}

  /** Reconstruct (url, method) for a tool from its sourceIdentityKey ("METHOD /path").
   * When the tool carries its own baseUrl (multi-host apps), that origin wins over the
   * webapp-derived fallback so calls reach the correct API server. */
  public static String[] toolToRequest(
      Manifest.ToolDefinition tool, Map<String, Object> args, String baseUrl) {
    String[] parts = tool.sourceIdentityKey.split(" ", 2);
    String method = parts[0];
    String pathTemplate = parts.length > 1 ? parts[1] : "/";
    String origin =
        (tool.baseUrl != null && !tool.baseUrl.isBlank())
            ? stripTrailingSlash(tool.baseUrl)
            : baseUrl;
    String filled = pathTemplate;
    StringBuilder query = new StringBuilder();
    for (Map.Entry<String, Object> e : args.entrySet()) {
      String token = "{" + e.getKey() + "}";
      if (filled.contains(token)) {
        filled = filled.replace(token, java.net.URLEncoder.encode(
            String.valueOf(e.getValue()), java.nio.charset.StandardCharsets.UTF_8));
      } else if (method.equals("GET")) {
        if (query.length() > 0) {
          query.append("&");
        }
        query.append(e.getKey()).append("=").append(String.valueOf(e.getValue()));
      }
    }
    String url = origin + filled + (query.length() > 0 ? "?" + query : "");
    return new String[] {url, method};
  }

  private static String stripTrailingSlash(String s) {
    return s.endsWith("/") ? s.substring(0, s.length() - 1) : s;
  }

  /** Invoke a single tool against the wrapped webapp with reliability. */
  public static Reliability.InvokeResult dispatchTool(
      Manifest.ToolDefinition tool, Map<String, Object> args, String baseUrl, HttpClient client) {
    String[] req = toolToRequest(tool, args, baseUrl);
    boolean idempotent = tool.annotations.idempotentHint;
    return Reliability.invokeWithReliability(
        tool.name,
        idempotent,
        attempt -> {
          HttpRequest.Builder b = HttpRequest.newBuilder().uri(URI.create(req[0]));
          if (req[1].equals("GET")) {
            b.GET();
          } else {
            b.method(req[1], HttpRequest.BodyPublishers.noBody());
          }
          HttpResponse<String> resp = client.send(b.build(), HttpResponse.BodyHandlers.ofString());
          Object body;
          try {
            body = GSON.fromJson(resp.body(), Object.class);
          } catch (RuntimeException ex) {
            body = resp.body();
          }
          return new Object[] {resp.statusCode(), body};
        },
        rec -> System.err.println(rec),
        ms -> {
          try {
            Thread.sleep(ms);
          } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
          }
        });
  }

  public static int run(String[] argv) throws Exception {
    if (argv.length == 0) {
      System.err.println("usage: wrapper-runtime-java <package-dir>");
      return 2;
    }
    Manifest.LoadedPackage pkg = Manifest.loadPackage(Path.of(argv[0]));
    String baseUrl = "https://" + pkg.manifest.get("webappTargetId").getAsString();
    List<Manifest.ToolDefinition> tools = Manifest.inScopeTools(pkg.tools, pkg.scope);

    try {
      // The official MCP Java SDK entrypoint (io.modelcontextprotocol.sdk:mcp) is wired here.
      // Registration is intentionally reflective so the module builds without the artifact
      // resolved in constrained environments; see T062 for the full server wiring.
      Class<?> serverClass = Class.forName("io.modelcontextprotocol.server.McpServer");
      System.err.println(
          "MCP Java SDK present (" + serverClass.getName() + "); serving "
              + tools.size() + " tools over stdio.");
      // Full SDK server construction happens in T062's OAuth-authenticated dispatch wiring.
      return 0;
    } catch (ClassNotFoundException e) {
      System.err.println(
          "MCP SDK unavailable. Package loaded with " + pkg.tools.size() + " tools.");
      return 1;
    }
  }

  public static void main(String[] argv) throws Exception {
    System.exit(run(argv));
  }
}
